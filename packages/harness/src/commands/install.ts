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

export { scanConflicts, type ConflictInfo };

export interface InstallCommandOptions {
  command: "install";
  preset: PresetName;
  components?: string[];
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

export async function runInstall(opts: InstallCommandOptions): Promise<number> {
  const { out, err, rt, scope } = opts;

  // Edge (F11): Node abaixo do piso → warn, não bloqueia.
  const nodeWarn = nodeVersionWarn(opts.nodeVersion);
  if (nodeWarn) err.write(`${nodeWarn}\n`);

  // 1. detectPi — fail-closed com o comando exato (CLI-04).
  const detection = opts.pi.detect();
  if (!detection.found) {
    const message = piNotFoundMessage();
    err.write(message);
    if (opts.json) {
      out.write(`${JSON.stringify({ error: message.trim().split(/\r?\n/)[0], command: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent", installed: [], kept: [], conflicts: [], failed: [] }, null, 2)}\n`);
    }
    return 1;
  }

  // 2. Plano.
  let plan: InstallPlan;
  try {
    plan = buildPlan(opts.preset, opts.components);
  } catch (error) {
    err.write(`@runecraft/harness install: ${(error as Error).message}\n`);
    return 1;
  }

  const filesTouched = filesTouchedByInstall(rt, scope);

  // Colisão com upstreams — scan é somente leitura (CLI-09).
  const installedBefore = opts.pi.list().packages;
  const conflicts = scanConflicts(installedBefore);
  const beforeIdentities = new Set(installedBefore.map(npmIdentity));

  // 3. dry-run — nenhum efeito colateral (CLI-03).
  if (opts.dryRun) {
    const mergeTargets = opts.preset === "full" ? targetsForComponents(plan.components, scope) : undefined;
    out.write(renderDryRun(plan, filesTouched, conflicts, { json: opts.json, tty: opts.isTTY }, mergeTargets));
    return 0;
  }

  // Edge: config dir do Pi ausente → warn (o pi install cria), não bloqueia.
  const settingsFile = piSettingsPath(rt, scope);
  if (!fs.existsSync(path.dirname(settingsFile))) {
    const dir = scope === "global" ? piAgentDir(rt.env) : path.join(rt.cwd, ".pi");
    err.write(`warn: diretório de config do Pi não existe (${dir}) — o \`pi install\` vai criá-lo.\n`);
  }

  // Confirmação: TTY + !--yes pergunta; não-TTY auto-aceita (edge F11).
  if (opts.isTTY && !opts.yes) {
    const confirmed = await confirmInstall(opts, plan.specs.length);
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
      files: filesTouched,
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
  for (const spec of plan.specs) {
    const result = await runPiInstall(opts, spec);
    if (result.ok) {
      if (beforeIdentities.has(npmIdentity(spec))) kept.push(spec);
      else installed.push(spec);
    } else {
      failed.push({ spec, code: result.code, stderr: result.stderr });
    }
  }

  // 6. State upsert — só packages instalados com sucesso (CLI-10).
  const stateFile = statePath(rt, scope);
  const loaded = loadState(stateFile, scope);
  const state: HarnessState = loaded.state;
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
  for (const entry of plan.entries) {
    const spec = `${entry.source}@${entry.version}`;
    if (installed.includes(spec) || kept.includes(spec)) {
      upsertInstalled(state, entry);
    }
  }

  // 7. Merge de settings — só no preset full e só para components com TODOS os
  //    packages instalados ou já presentes (edge F14: fork não instalado →
  //    defaults do fork não aplicados). JSON inválido → abort apontando o
  //    arquivo, nada de settings é modificado (SETM-04); os packages já
  //    instalados permanecem (backup pré-write permite restore — F13).
  const settings: SettingsMergeReport = { created: [], conflicts: [], removed: [], preserved: [] };
  let mergeError: string | undefined;
  if (opts.preset === "full") {
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

  // 8. Relatório (SETM-06 shape; TTY ou --json).
  const report: InstallReport = {
    preset: plan.preset,
    scope,
    components: plan.components,
    specs: plan.specs,
    installed,
    kept,
    conflicts,
    failed,
    backup: snapshot?.file,
    corruptStatePath: loaded.corruptPath && loaded.corruptPath !== stateFile ? loaded.corruptPath : undefined,
    filesTouched,
    notes,
  };
  if (opts.preset === "full") report.settings = settings;
  out.write(renderReport(report, { json: opts.json, tty: opts.isTTY }));

  return failed.length > 0 || mergeError !== undefined ? 1 : 0;
}
