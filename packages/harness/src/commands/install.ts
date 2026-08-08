// install.ts — orchestration of the install flow (CLI-01..CLI-10).
//
// Flow (design F11):
//   detectPi fail-closed (comando exato) → plano → colisão (warn) → dry-run
//   → confirmação → backup pré-write → pi install por spec (continua em falha)
//   → state upsert → [full: merge de settings (F14) + settingsChanges] → relatório.
//
// Boundaries: state = upsert mínimo (F13 schema completo), backup = snapshot
// pré-write (F13 dedupe/prune/restore), merge = F14 (passo 7 — apenas full).
// Failed components never enter state (CLI-10), never get defaults applied
// (edge F14: fork não instalado → defaults não aplicados), and the pre-write
// snapshot is the manual rollback point.
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  backupsDir,
  filesTouchedByInstall,
  piAgentDir,
  piSettingsPath,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { createSnapshot, type SnapshotResult } from "../backup.ts";
import { applyMerge, MergeError, targetsForComponents } from "../merge.ts";
import { buildPlan, type InstallPlan, type PresetName } from "../plan.ts";
import { npmIdentity, piNotFoundMessage, type PiInterop } from "../pi.ts";
import { loadState, saveState, upsertInstalled, upsertSettingsChange, type HarnessState } from "../state.ts";
import { renderDryRun, renderReport, type FailInfo, type InstallReport, type SettingsMergeReport } from "../report.ts";
import { scanConflicts, type ConflictInfo } from "../conflicts.ts";
import { parseAgentArgs, installAgent, detectOnlyReport } from "../adapters/agentOps.ts";
import { ADAPTERS, SUPPORTED_AGENT_IDS } from "../adapters/registry.ts";
import { firstUnsupported, type ComponentId } from "../matrix.ts";
import { warnOwners, type OwnerEvidence } from "../owners.ts";
import { withRunecraftLock } from "../lock.ts";

export { scanConflicts, type ConflictInfo };

export interface InstallCommandOptions {
  command: "install";
  preset: PresetName;
  components?: string[];
  /** non-Pi agents (F15); undefined = Pi-only (compat F11). */
  agents?: string[];
  dryRun: boolean;
  json: boolean;
  scope: Scope;
  yes: boolean;
  pi: PiInterop;
  rt: Runtime;
  out: TextSink;
  err: TextSink;
  nodeVersion: string;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
}

/** Minimum Node floor for the harness runtime (spec F11 edge case). */
const NODE_MIN_MAJOR = 22;
const NODE_MIN_MINOR = 19;

export function nodeVersionWarn(nodeVersion: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(nodeVersion);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const tooOld = major < NODE_MIN_MAJOR || (major === NODE_MIN_MAJOR && minor < NODE_MIN_MINOR);
  return tooOld
    ? `warn: Node ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ é o piso do harness (atual: ${nodeVersion}). O Pi pode rodar em outro runtime — continuando.`
    : null;
}



function confirmInstall(opts: InstallCommandOptions, count: number): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: opts.stdin, output: process.stdout });
    rl.question(`Instalar ${count} packages via pi (scope ${opts.scope})? [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function runPiInstall(
  opts: InstallCommandOptions,
  spec: string,
): Promise<{ ok: boolean; code: number | null; stderr: string }> {
  const result = opts.pi.install(spec, opts.scope);
  if (!result.ok) {
    // stderr of pi can be empty even on failure — keep a usable hint for the report.
    const stderr = result.stderr.trim() || `pi install falhou com exit code ${result.code ?? "?"}`;
    opts.err.write(`  ✗ ${spec} — ${stderr.split(/\r?\n/)[0]}\n`);
    return { ok: false, code: result.code, stderr };
  }
  return { ok: true, code: result.code, stderr: result.stderr };
}

/** Write-lock wrapper (F18 Riscos: corrida com outro installer). Dry-run não
 *  escreve — roda sem lock. */
export async function runInstall(opts: InstallCommandOptions): Promise<number> {
  if (opts.dryRun) return runInstallLocked(opts);
  try {
    return await withRunecraftLock(opts.rt, opts.scope, "install", () => runInstallLocked(opts));
  } catch (error) {
    opts.err.write(`@runecraft/harness install: ${(error as Error).message}\n`);
    return 1;
  }
}

async function runInstallLocked(opts: InstallCommandOptions): Promise<number> {
  const { out, err, rt, scope } = opts;

  // Edge (F11): Node abaixo do piso → warn, não bloqueia.
  const nodeWarn = nodeVersionWarn(opts.nodeVersion);
  if (nodeWarn) err.write(`${nodeWarn}\n`);

  // ── Agentes não-Pi (F15): --agent pi,claude-code,… · default = Pi-only ──
  const agentArg = opts.agents && opts.agents.length > 0 ? opts.agents : ["pi"];
  const parsedAgents = parseAgentArgs(agentArg);
  const wantPi = agentArg.some((a) => a.split(",").map((s) => s.trim()).includes("pi"));
  const nonPiAgents = parsedAgents.supported;
  const agentOutcomes: Array<{ agentId: string; status: string; detail: string[]; error?: string }> = [];
  const detectOnly: Array<{ agentId: string; guide: string }> = [
    ...parsedAgents.detectOnly.map((id) => detectOnlyReport(id)),
    ...parsedAgents.unknown.map((id) => ({ agentId: id, guide: detectOnlyReport(id).guide })),
  ];

  // --component fora da coluna não-Pi → recusa com o motivo da CÉLULA (F17
  // MATR-03: fail-closed por par agente×componente, fonte = matriz D1). A
  // matriz também é o contrato do dry-run: o v1 aplica sempre a coluna
  // completa dos agentes não-Pi (2 células fixas — decisão D5), `--component`
  // valida com fail-closed em vez de filtrar a coluna.
  if (nonPiAgents.length > 0 && opts.components && opts.components.length > 0) {
    const blocked = firstUnsupported(nonPiAgents, opts.components as ComponentId[]);
    if (blocked) {
      err.write(`@runecraft/harness install: ${blocked.reason} (componente não suportado por ${blocked.agent}).\n`);
      return 1;
    }
  }

  // 1. detectPi — fail-closed com o comando exato (CLI-04). Só quando o plano inclui Pi.
  if (wantPi) {
    const detection = opts.pi.detect();
    if (!detection.found) {
      const message = piNotFoundMessage();
      err.write(message);
      if (opts.json) {
        out.write(`${JSON.stringify({ error: message.trim().split(/\r?\n/)[0], command: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent", installed: [], kept: [], conflicts: [], failed: [] }, null, 2)}\n`);
      }
      return 1;
    }
  }

  // 1b. Detecção por agente não-Pi — fail-closed com comando display-only (F15 AC 1.1/1.2).
  const agentDetection: Array<{ agentId: string; ok: boolean; error?: string }> = [];
  for (const id of nonPiAgents) {
    const adapter = ADAPTERS[id as keyof typeof ADAPTERS];
    const detect = await adapter.detect(rt);
    if (detect.installed) {
      agentDetection.push({ agentId: id, ok: true });
    } else {
      const message = `agente '${id}' não detectado (binário '${adapter.bin}' fora do PATH). Instale com: ${adapter.installHint} (display-only — o harness nunca instala runtimes).`;      err.write(`  ✗ ${id} — ${message}\n`);
      agentDetection.push({ agentId: id, ok: false, error: message });
    }
  }
  const agentFailedDetection = agentDetection.filter((d) => !d.ok);

  // 2. Plano (Pi).
  let plan: InstallPlan | undefined;
  if (wantPi) {
    try {
      plan = buildPlan(opts.preset, opts.components);
    } catch (error) {
      err.write(`@runecraft/harness install: ${(error as Error).message}\n`);
      return 1;
    }
  }

  const filesTouched = filesTouchedByInstall(rt, scope);
  // Alvos dos agentes não-Pi entram no snapshot pré-write (F15 passo 5).
  const agentTargetFiles = nonPiAgents.flatMap((id) => {
    const p = ADAPTERS[id as keyof typeof ADAPTERS].paths(rt);
    return [p.rulesFile, p.mcpFile];
  });

  // Colisão com upstreams — scan é somente leitura (CLI-09).
  const installedBefore = wantPi ? opts.pi.list().packages : [];
  const conflicts = scanConflicts(installedBefore);
  const beforeIdentities = new Set(installedBefore.map(npmIdentity));

  // MXST-04: detecção de donos antes de qualquer escrita. Owners warn
  // (gentle-ai, upstreams Pi, MCP upstream) viram gate de confirmação:
  // TTY → listados antes do prompt (default N); --yes → prossegue com os
  // avisos no relatório; sem TTY e sem --yes → aborta (fail-closed).
  const ownerWarnings = warnOwners(rt, opts.pi);
  for (const w of ownerWarnings) {
    err.write(`  ! ${w.name} (${w.kind}) — ${w.detail}\n`);
  }

  // 3. dry-run — nenhum efeito colateral (CLI-03).
  if (opts.dryRun) {
    if (plan) {
      const mergeTargets = opts.preset === "full" ? targetsForComponents(plan.components, scope) : undefined;
      out.write(renderDryRun(plan, filesTouched, conflicts, { json: opts.json, tty: opts.isTTY }, mergeTargets));
    }
    if (ownerWarnings.length > 0) {
      out.write(
        `Colisões detectadas (${ownerWarnings.length}):\n` +
          ownerWarnings.map((w) => `  ! ${w.name} (${w.kind}) — ${w.detail}`).join("\n") +
          "\n",
      );
    }
    if (nonPiAgents.length > 0) {
      out.write(
        `\nAgentes não-Pi (F15): ${nonPiAgents.join(", ")} — alvos: ${agentTargetFiles.join(", ")}\n` +
        `  (dry-run: nada foi escrito)\n`,
      );
    }
    return 0;
  }

  // Edge: config dir do Pi ausente → warn (o pi install cria), não bloqueia.
  const settingsFile = piSettingsPath(rt, scope);
  if (!fs.existsSync(path.dirname(settingsFile))) {
    const dir = scope === "global" ? piAgentDir(rt.env) : path.join(rt.cwd, ".pi");
    err.write(`warn: diretório de config do Pi não existe (${dir}) — o \`pi install\` vai criá-lo.\n`);
  }

  // Confirmação: TTY + !--yes pergunta; não-TTY auto-aceita (edge F11). Com
  // colisões detectadas (MXST-04), não-TTY sem --yes aborta (fail-closed).
  if (ownerWarnings.length > 0 && !opts.isTTY && !opts.yes) {
    err.write(
      `@runecraft/harness install: ${ownerWarnings.length} colisão(ões) detectada(s) — sem TTY e sem --yes, abortando (fail-closed). ` +
        `Rode com --yes para prosseguir registrando os avisos no relatório.\n`,
    );
    return 1;
  }
  if (opts.isTTY && !opts.yes) {
    const count = (plan?.specs.length ?? 0) + nonPiAgents.length;
    const confirmed = await confirmInstall(opts, count);
    if (!confirmed) {
      err.write("Abortado pelo usuário — nada foi modificado.\n");
      return 1;
    }
  }

  const notes: string[] = [];

  // 4. Backup pré-write (STBK-04): falhou → aborta antes de escrever nada.
  let snapshot: SnapshotResult | undefined;
  try {
    snapshot = createSnapshot({
      files: [...filesTouched, ...agentTargetFiles],
      destDir: backupsDir(rt, scope),
      reason: "install",
      scope,
    });
  } catch (error) {
    err.write(`@runecraft/harness install: falha ao criar o snapshot pré-write — nada foi modificado.\n  ${(error as Error).message}\n`);
    return 1;
  }

  // 5. Instalação por spec com continuação em falha (edge F11).
  const installed: string[] = [];
  const kept: string[] = [];
  const failed: FailInfo[] = [];
  if (plan) {
    for (const spec of plan.specs) {
      const result = await runPiInstall(opts, spec);
      if (result.ok) {
        if (beforeIdentities.has(npmIdentity(spec))) kept.push(spec);
        else installed.push(spec);
      } else {
        failed.push({ spec, code: result.code, stderr: result.stderr });
      }
    }
  }

  // 5b. Agentes não-Pi: inject por agente, falha isolada (D2). O state é
  // carregado UMA vez aqui e reutilizado no passo 6 (mesmo objeto).
  const stateFile0 = statePath(rt, scope);
  const loaded0 = loadState(stateFile0, scope);
  const state0 = loaded0.state;
  for (const id of nonPiAgents) {
    const detection = agentDetection.find((d) => d.agentId === id);
    if (!detection?.ok) continue; // já reportado no fail-closed
    const outcome = await installAgent(id, rt, scope, state0);
    agentOutcomes.push(outcome);
    if (outcome.status === "failed" && outcome.error) {
      err.write(`  ✗ ${id} — ${outcome.error}\n`);
    }
  }
  // State dos agentes é gravado junto com o do Pi no passo 6 (mesmo arquivo).

  // 6. State upsert — só packages instalados com sucesso (CLI-10). O state já
  //    carregado em 5b é o mesmo objeto — não recarregar.
  const stateFile = stateFile0;
  const loaded = loaded0;
  const state: HarnessState = state0;
  if (loaded.corruptPath && loaded.corruptPath !== stateFile) {
    err.write(`warn: state.json corrompido — movido para ${loaded.corruptPath}; state recomeçado.\n`);
  }
  if (loaded.created) state.installedAt = new Date().toISOString();
  if (snapshot) {
    state.preInstall.push({
      file: snapshot.file,
      hash: snapshot.hash,
      backup: path.basename(snapshot.file),
    });
  }
  if (plan) {
    for (const entry of plan.entries) {
      const spec = `${entry.source}@${entry.version}`;
      if (installed.includes(spec) || kept.includes(spec)) {
        upsertInstalled(state, entry);
      }
    }
  }

  // 7. Merge de settings — só no preset full e só para components com TODOS os
  //    packages instalados ou já presentes (edge F14: fork não instalado →
  //    defaults do fork não aplicados). JSON inválido → abort apontando o
  //    arquivo, nada de settings é modificado (SETM-04); os packages já
  //    instalados permanecem (backup pré-write permite restore — F13).
  const settings: SettingsMergeReport = { created: [], conflicts: [], removed: [], preserved: [] };
  let mergeError: string | undefined;
  if (opts.preset === "full" && plan) {
    const okGroups = new Set<string>();
    for (const entry of plan.entries) {
      const spec = `${entry.source}@${entry.version}`;
      if (installed.includes(spec) || kept.includes(spec)) okGroups.add(entry.group);
    }
    const mergeComponents = plan.components.filter((c) => okGroups.has(c));
    if (mergeComponents.length > 0) {
      const targets = targetsForComponents(mergeComponents, scope);
      try {
        const outcome = applyMerge(targets, rt);
        settings.created = outcome.created;
        settings.conflicts = outcome.conflicts;
        // SETM-03: chaves adicionadas registradas no state (upsert por file+path).
        for (const change of outcome.created) {
          upsertSettingsChange(state, { file: change.file, path: change.path, value: change.value });
        }
      } catch (error) {
        mergeError = error instanceof Error ? error.message : String(error);
        if (error instanceof MergeError) {
          err.write(`@runecraft/harness install: merge de settings abortado — ${error.message}\n`);
        } else {
          err.write(`@runecraft/harness install: merge de settings falhou — ${mergeError}\n`);
        }
      }
    }
  }

  try {
    saveState(stateFile, state);
  } catch (error) {
    err.write(`@runecraft/harness install: falha ao gravar o state (${(error as Error).message}).\n`);
    // State é bookkeeping — a instalação ocorreu; reporta o erro mas não falseia o exit.
  }

  // 7b. F30 — materialização das chains SDD em .pi/chains/ (workspace — o fork
  //     subagents descobre chains de <root>/.pi/chains/; D8). Best-effort:
  //     nunca falha o install; asset ausente → nota informativa. No global o
  //     materializar não faz sentido (chains são por projeto).
  if (scope === "workspace") {
    try {
      const { materializeChains } = await import("../sdd/index.ts");
      const materialized = materializeChains({ cwd: rt.cwd });
      if (materialized.copied.length > 0) {
        notes.push(`chains SDD materializadas em .pi/chains/: ${materialized.copied.join(", ")} (F30)`);
      } else if (materialized.skipped.length > 0) {
        notes.push(`chains SDD já presentes em .pi/chains/ (${materialized.skipped.length} — F30)`);
      }
    } catch {
      // best-effort — a materialização nunca quebra o install
    }
  }

  // 8. Relatório (SETM-06 shape; TTY ou --json).
  const report: InstallReport = {
    preset: plan?.preset ?? opts.preset,
    scope,
    components: plan?.components ?? [],
    specs: plan?.specs ?? [],
    installed,
    kept,
    conflicts,
    failed,
    backup: snapshot?.file,
    corruptStatePath: loaded.corruptPath && loaded.corruptPath !== stateFile ? loaded.corruptPath : undefined,
    filesTouched,
    notes,
    warnings: ownerWarnings,
  };
  if (opts.preset === "full" && plan) report.settings = settings;
  if (nonPiAgents.length > 0 || detectOnly.length > 0) {
    report.agents = [
      ...agentOutcomes,
      ...detectOnly.map((d) => ({ agentId: d.agentId, status: "detect-only", detail: [d.guide] })),
      ...agentFailedDetection.map((d) => ({ agentId: d.agentId, status: "failed", detail: [], error: d.error })),
    ];
  }
  out.write(renderReport(report, { json: opts.json, tty: opts.isTTY }));

  const agentFailed = agentOutcomes.some((o) => o.status === "failed") || agentFailedDetection.length > 0;
  return failed.length > 0 || mergeError !== undefined || agentFailed ? 1 : 0;
}
