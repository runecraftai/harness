// uninstall.ts — managed removal (F12, LIFE-03/04/05 + F14 SETM-05).
//
// Removes ONLY what the harness manages (source of truth: state.json):
//   - state entries → `pi remove <source>` (per package)
//   - `createdFiles` (config files the harness created from scratch) → deleted
//   - `settingsChanges` (F14 merge additions) → removed only when the current
//     value still matches the registered default; user-edited keys are
//     preserved and reported (SETM 2.2)
//   - entries are then removed from state
// Anything else is preserved: packages installed by hand (orphans), upstreams,
// user config keys not registered in settingsChanges.
//
// `--component` removes a subset (LIFE 2.1) — including only the settings
// changes owned by those components; `--all` the full harness (LIFE 2.2);
// neither → error (uninstall must be explicit). A backup is taken before any
// modification (LIFE 2.4) and the state reflects the removal (LIFE 2.5).
// Corrupt state → conservative mode: nothing is removed.
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  backupsDir,
  filesTouchedByInstall,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { createSnapshot } from "../backup.ts";
import { componentForSettingsChange, removeSettingsChanges, type MergeChange } from "../merge.ts";
import { npmIdentity, type PiInterop } from "../pi.ts";
import { loadState, saveState, type InstalledEntry } from "../state.ts";
import { scanConflicts } from "../conflicts.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { parseAgentArgs, uninstallAgent } from "../adapters/agentOps.ts";
import type { AgentId } from "../adapters/types.ts";
import { SUPPORTED_AGENT_IDS } from "../adapters/registry.ts";
import { withRunecraftLock } from "../lock.ts";
import { hooksDirFor, removeGatesHooks, removeGitignoreLinesIfUnchanged, gitignorePath, GITIGNORE_LINES } from "../gates/hook.ts";
import { repoRoot } from "../gates/git.ts";
import {
  repoConfigPath as gatesRepoConfigPath,
  globalConfigPath as gatesGlobalConfigPath,
  readGatesConfig,
  isGatesOnlyConfig,
} from "../gates/config.ts";

export interface UninstallCommandOptions {
  json: boolean;
  /** --all: remove every package the harness manages. */
  all: boolean;
  /** --component list (groups); mutually exclusive with --all. */
  components?: string[];
  /** F15: non-Pi agents to remove (--agent claude-code,…). */
  agents?: string[];
  yes: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  pi: PiInterop;
  scope: Scope;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
}

export interface UninstallReport {
  scope: Scope;
  removed: string[];
  removedFiles: string[];
  /** F14 SETM-05: settings keys removed (value still matched the registered default). */
  removedSettings: MergeChange[];
  /** F14 SETM-05: settings keys preserved because the user edited them. */
  preservedSettings: MergeChange[];
  /** catalog packages present in `pi list` but not in state — never touched. */
  preserved: string[];
  failed: Array<{ spec: string; code: number | null; stderr: string }>;
  backup?: string;
  corruptStatePath?: string;
  notes: string[];
  /** F15: non-Pi agents removed by this run. */
  agentsRemoved: string[];
  /** F20: delivery gates cleanup (hooks, config, .gitignore — receipts PRESERVADOS). */
  gates?: {
    removedHooks: string[];
    deletedHooks: string[];
    removedConfigs: string[];
    gitignoreRemoved: string[];
    gitignorePreserved: string[];
    notes: string[];
  };
}

/** Package names (state keys) to remove, given the selection flags (flags validated by the caller). */
export function resolveUninstallSelection(
  state: Record<string, InstalledEntry>,
  all: boolean,
  components: string[] | undefined,
): string[] {
  if (all) return Object.keys(state);
  return Object.entries(state)
    .filter(([, entry]) => components?.includes(entry.group))
    .map(([name]) => name);
}

function confirmUninstall(opts: UninstallCommandOptions, count: number): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: opts.stdin, output: process.stdout });
    rl.question(`Remover ${count} packages gerenciados via pi (scope ${opts.scope})? [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function renderUninstall(report: UninstallReport, opts: { tty: boolean }): string {
  const c = (s: string, color: string) => (opts.tty ? `${color}${s}\u001b[0m` : s);
  const lines = [`@runecraft/companion uninstall (scope ${report.scope})`];
  for (const note of report.notes) lines.push(`${c("note:", "\u001b[2m")} ${note}`);
  if (report.removed.length > 0) {
    lines.push(`${c(`Removido (${report.removed.length}):`, "\u001b[32m")}`);
    for (const spec of report.removed) lines.push(`  ${c("✓", "\u001b[32m")} ${spec}`);
  }
  if (report.removedFiles.length > 0) {
    lines.push(`${c(`Arquivos de config criados pelo harness removidos (${report.removedFiles.length}):`, "\u001b[32m")}`);
    for (const file of report.removedFiles) lines.push(`  ${c("✓", "\u001b[32m")} ${file}`);
  }
  if (report.removedSettings.length > 0) {
    lines.push(`${c(`Settings removidos (defaults do harness — ${report.removedSettings.length}):`, "\u001b[32m")}`);
    for (const change of report.removedSettings) lines.push(`  ${c("✓", "\u001b[32m")} ${change.path.join(".")}`);
  }
  if (report.preservedSettings.length > 0) {
    lines.push(`${c(`Settings preservados — valor editado pelo usuário após o install (${report.preservedSettings.length}):`, "\u001b[33m")}`);
    for (const change of report.preservedSettings) {
      lines.push(`  ${c("=", "\u001b[33m")} ${change.path.join(".")} = ${JSON.stringify(change.value)}`);
    }
    lines.push(`  ${c("nada foi removido dessas chaves — edição do usuário vence.", "\u001b[2m")}`);
  }
  if (report.preserved.length > 0) {
    lines.push(`${c(`Preservado (instalado à mão / fora do state — não removido) (${report.preserved.length}):`, "\u001b[2m")}`);
    for (const spec of report.preserved) lines.push(`  ${c("=", "\u001b[2m")} ${spec}`);
  }
  if (report.gates && (report.gates.removedHooks.length > 0 || report.gates.deletedHooks.length > 0 || report.gates.removedConfigs.length > 0 || report.gates.gitignoreRemoved.length > 0)) {
    lines.push(`${c("Delivery gates (F20):", "\u001b[32m")}`);
    for (const hook of report.gates.removedHooks) lines.push(`  ${c("✓", "\u001b[32m")} seção runecraft:gates removida de ${hook}`);
    for (const hook of report.gates.deletedHooks) lines.push(`  ${c("✓", "\u001b[32m")} hook removido (criado do zero pelo harness): ${hook}`);
    for (const config of report.gates.removedConfigs) lines.push(`  ${c("✓", "\u001b[32m")} config de gates removido: ${config}`);
    for (const line of report.gates.gitignoreRemoved) lines.push(`  ${c("✓", "\u001b[32m")} linha removida do .gitignore: ${line}`);
    lines.push(`  ${c("receipts preservados (contrato de entrega — RCPT-08 AC 4.3; remoção manual documentada).", "\u001b[2m")}`);
  }
  for (const note of report.gates?.notes ?? []) {
    lines.push(`${c("note:", "\u001b[2m")} ${note}`);
  }
  if (report.failed.length > 0) {
    lines.push(`${c(`Falhou (${report.failed.length}):`, "\u001b[31m")}`);
    for (const fail of report.failed) {
      lines.push(`  ${c("✗", "\u001b[31m")} ${fail.spec} (exit ${fail.code ?? "?"})`);
      const detail = fail.stderr.trim();
      if (detail) lines.push(`    ${detail.split(/\r?\n/)[0]}`);
    }
  }
  if (report.backup) lines.push(`${c(`Backup pré-remoção: ${report.backup}`, "\u001b[2m")}`);
  if (report.corruptStatePath) lines.push(`${c(`state.json corrompido foi movido para ${report.corruptStatePath}`, "\u001b[33m")}`);
  return `${lines.join("\n")}\n`;
}

export function renderUninstallJson(report: UninstallReport): string {
  return `${JSON.stringify(
    {
      scope: report.scope,
      removed: report.removed,
      removedFiles: report.removedFiles,
      removedSettings: report.removedSettings.map((c) => ({ file: c.file, path: c.path.join(".") })),
      preservedSettings: report.preservedSettings.map((c) => ({ file: c.file, path: c.path.join("."), value: c.value })),
      preserved: report.preserved,
      failed: report.failed,
      backup: report.backup ?? null,
      notes: report.notes,
      ...(report.gates ? { gates: report.gates } : {}),
    },
    null,
    2,
  )}\n`;
}

/** Write-lock wrapper (F18 Riscos: corrida com outro installer). */
export async function runUninstallCommand(opts: UninstallCommandOptions): Promise<number> {
  try {
    return await withRunecraftLock(opts.rt, opts.scope, "uninstall", () => runUninstallCommandLocked(opts));
  } catch (error) {
    opts.err.write(`@runecraft/companion uninstall: ${(error as Error).message}\n`);
    return 1;
  }
}

async function runUninstallCommandLocked(opts: UninstallCommandOptions): Promise<number> {
  const { out, err, rt, scope } = opts;
  const stateFile = statePath(rt, scope);

  // `--agent pi` = fluxo F12 atual (design F15 D6): remove os packages do Pi
  // como `--all` faria. Nota: como --all, também remove agentes não-Pi
  // registrados (comportamento idêntico a `uninstall --all`).
  const agentsNoPi = (opts.agents ?? []).filter((a) => !a.split(",").map((s) => s.trim()).includes("pi"));
  const piOnly = opts.agents !== undefined && agentsNoPi.length === 0 && !opts.all && !opts.components;
  if (piOnly) {
    opts = { ...opts, agents: undefined, all: true };
  }

  // Validação de seleção primeiro (uso explícito obrigatório): nada de
  // uninstall acidental. `--all` e `--component` são mutuamente exclusivos.
  if (opts.all && opts.components && opts.components.length > 0) {
    const message = "@runecraft/companion uninstall: use `--all` ou `--component`, não ambos";
    if (opts.json)
      out.write(renderUninstallJson({ scope, removed: [], removedFiles: [], removedSettings: [], preservedSettings: [], preserved: [], failed: [], notes: [message], agentsRemoved: [] }));
    else err.write(`${message}\n`);
    return 1;
  }
  if (!opts.all && (!opts.components || opts.components.length === 0) && (!opts.agents || opts.agents.length === 0)) {
    const message = "@runecraft/companion uninstall: especifique o que remover: `--all`, `--component <a,b>` ou `--agent <a,b>`";
    if (opts.json)
      out.write(renderUninstallJson({ scope, removed: [], removedFiles: [], removedSettings: [], preservedSettings: [], preserved: [], failed: [], notes: [message], agentsRemoved: [] }));
    else err.write(`${message}\n`);
    return 1;
  }

  const loaded = loadState(stateFile, scope);

  // F15: agentes não-Pi a remover (--agent). Remoção content-based (D6/D7).
  const agentIds = agentsNoPi.length > 0
    ? parseAgentArgs(agentsNoPi).supported
    : opts.all
      ? Object.keys(loaded.state.agents).filter((id) => (SUPPORTED_AGENT_IDS as readonly string[]).includes(id))
      : [];

  // Modo conservador (edge F12): state corrompido → nada pode ser atribuído ao
  // harness com segurança → nada é removido.
  if (loaded.corruptPath && loaded.corruptPath !== stateFile) {
    const message = `warn: state.json corrompido — movido para ${loaded.corruptPath}; uninstall abortado em modo conservador (nada foi removido).`;
    if (opts.json) {
      out.write(
        renderUninstallJson({ scope, removed: [], removedFiles: [], removedSettings: [], preservedSettings: [], preserved: [], failed: [], corruptStatePath: loaded.corruptPath, notes: [message], agentsRemoved: [] }),
      );
    } else {
      err.write(`${message}\n`);
    }
    return 1;
  }
  if (loaded.created) {
    const message = "nada gerenciado pelo harness neste scope — nada a remover.";
    if (opts.json) {
      out.write(renderUninstallJson({ scope, removed: [], removedFiles: [], removedSettings: [], preservedSettings: [], preserved: [], failed: [], notes: [message], agentsRemoved: [] }));
    } else {
      out.write(`@runecraft/companion uninstall (scope ${scope}): ${message}\n`);
    }
    return 0;
  }

  const selected = resolveUninstallSelection(loaded.state.components, opts.all, opts.components);
  const notes: string[] = [];
  // F20: um repo com SÓ gates gerenciados (enable sem install de packages) também
  // deve ser limpo pelo uninstall (hooks/config/.gitignore). Sem packages e sem
  // agentes, o fluxo só segue quando existem artefatos de gates no state.
  const hasGatesArtifacts = (() => {
    // config.json (repo .runecraft/ ou global ~/.runecraft/), hooks e .gitignore
    const gatesLike = (file: string): boolean =>
      file.endsWith("/pre-commit") ||
      file.endsWith("/pre-push") ||
      file.endsWith("/config.json") ||
      file.endsWith(".gitignore");
    if (loaded.state.createdFiles.some(gatesLike)) return true;
    const ignoreFiles = loaded.state.createdFiles.filter((f) => f.endsWith(".gitignore"));
    return loaded.state.settingsChanges.some((c) => ignoreFiles.includes(c.file));
  })();
  if (selected.length === 0 && agentIds.length === 0 && !hasGatesArtifacts) {
    const message = "nenhum package registrado no state para os componentes selecionados — nada a remover.";
    if (opts.json) {
      out.write(renderUninstallJson({ scope, removed: [], removedFiles: [], removedSettings: [], preservedSettings: [], preserved: [], failed: [], notes: [message], agentsRemoved: [] }));
    } else {
      out.write(`@runecraft/companion uninstall (scope ${scope}): ${message}\n`);
    }
    return 0;
  }
  if (hasGatesArtifacts && selected.length === 0 && agentIds.length === 0) {
    const message = "nenhum package registrado — limpando delivery gates (hooks/config/.gitignore; receipts preservados).";
    notes.push(message);
  }

  // Confirmação (TTY + !--yes); não-TTY auto-aceita (edge F11).
  if (opts.isTTY && !opts.yes) {
    const confirmed = await confirmUninstall(opts, selected.length);
    if (!confirmed) {
      err.write("Abortado pelo usuário — nada foi modificado.\n");
      return 1;
    }
  }

  // Backup pré-write (LIFE 2.4): falhou → aborta antes de modificar qualquer coisa.
  // Alvos dos agentes não-Pi entram no snapshot (F15 D6: remoção reversível).
  // F20: hooks/config/.gitignore dos gates entram também (reversível — F13).
  const agentTargetFiles = agentIds.flatMap((id) => {
    const record = loaded.state.agents[id];
    return record ? record.targets.map((t) => t.file) : [];
  });
  const gatesSnapshotFiles = (() => {
    const files: string[] = [];
    const root = repoRoot(rt.cwd);
    if (root !== null) {
      for (const hook of ["pre-commit", "pre-push"]) {
        const file = path.join(hooksDirFor(root), hook);
        if (fs.existsSync(file)) files.push(file);
      }
      const repoConfig = gatesRepoConfigPath(root);
      if (fs.existsSync(repoConfig)) files.push(repoConfig);
      const ignore = gitignorePath(root);
      if (fs.existsSync(ignore)) files.push(ignore);
    }
    if (scope === "global") {
      const globalConfig = gatesGlobalConfigPath(rt);
      if (fs.existsSync(globalConfig)) files.push(globalConfig);
    }
    return files;
  })();
  let backupFile: string | undefined;
  try {
    const snapshot = createSnapshot({
      files: [...filesTouchedByInstall(rt, scope), ...loaded.state.createdFiles, ...agentTargetFiles, ...gatesSnapshotFiles],
      destDir: backupsDir(rt, scope),
      reason: "uninstall",
      scope,
    });
    backupFile = snapshot.file;
  } catch (error) {
    err.write(
      `@runecraft/companion uninstall: falha ao criar o snapshot pré-write — nada foi modificado.\n  ${(error as Error).message}\n`,
    );
    return 1;
  }

  // F15: remoção por agente (só o gerenciado; edições do usuário preservadas).
  const agentDetails: string[] = [];
  let agentFailed = false;
  for (const id of agentIds) {
    const outcome = await uninstallAgent(id as AgentId, rt, loaded.state);
    agentDetails.push(...outcome.detail.map((d) => `${outcome.agentId}: ${d}`));
    if (outcome.status === "failed" && outcome.error) {
      agentFailed = true;
      err.write(`  ✗ ${id} — ${outcome.error}\n`);
    }
  }

  const removed: string[] = [];
  const failed: UninstallReport["failed"] = [];
  for (const name of selected) {
    const entry = loaded.state.components[name];
    if (!entry) continue;
    const identity = npmIdentity(entry.source);
    const result = opts.pi.remove(identity, scope);
    if (result.ok) {
      removed.push(identity);
      delete loaded.state.components[name];
    } else {
      const stderr = result.stderr.trim() || `pi remove falhou com exit code ${result.code ?? "?"}`;
      failed.push({ spec: identity, code: result.code, stderr });
      err.write(`  ✗ ${identity} — ${stderr.split(/\r?\n/)[0]}\n`);
    }
  }

  // F20: delivery gates cleanup — hooks (família shell F18), config.json do
  // repo, linhas do .gitignore (SETM-05 — só as exatas que adicionamos) e
  // kill switch global (~/.runecraft/config.json criado por disable). Receipts
  // PRESERVADOS sempre (RCPT-08 AC 4.3 — contrato de entrega, nunca apagado
  // por gate/uninstall; remoção manual documentada).
  const gatesReport: UninstallReport["gates"] = {
    removedHooks: [],
    deletedHooks: [],
    removedConfigs: [],
    gitignoreRemoved: [],
    gitignorePreserved: [],
    notes: [],
  };
  {
    const root = repoRoot(rt.cwd);
    if (root !== null) {
      const hooks = removeGatesHooks(hooksDirFor(root), loaded.state.createdFiles);
      gatesReport.removedHooks.push(...hooks.removed);
      gatesReport.deletedHooks.push(...hooks.deleted);
      for (const untouched of hooks.untouched) {
        gatesReport.notes.push(`hook preservado (sem seção runecraft:gates): ${untouched}`);
      }
      const repoConfig = gatesRepoConfigPath(root);
      if (fs.existsSync(repoConfig) && (loaded.state.createdFiles.includes(repoConfig) || isGatesOnlyConfig(readGatesConfig(repoConfig)))) {
        try {
          fs.rmSync(repoConfig, { force: true });
          gatesReport.removedConfigs.push(repoConfig);
        } catch (error) {
          gatesReport.notes.push(`config de gates do repo não pôde ser removido: ${(error as Error).message}`);
        }
      }
      const ignore = removeGitignoreLinesIfUnchanged(root);
      gatesReport.gitignoreRemoved.push(...ignore.removed);
      gatesReport.gitignorePreserved.push(...ignore.preserved);
      if (gatesReport.gitignorePreserved.length > 0) {
        gatesReport.notes.push(
          `linhas de gates do .gitignore preservadas (editadas pelo usuário — SETM-05): ${gatesReport.gitignorePreserved.join(", ")}`,
        );
      }
    }
    // Kill switch global (~/.runecraft/config.json) — não deixar órfão.
    if (scope === "global") {
      const globalConfig = gatesGlobalConfigPath(rt);
      if (fs.existsSync(globalConfig) && (loaded.state.createdFiles.includes(globalConfig) || isGatesOnlyConfig(readGatesConfig(globalConfig)))) {
        try {
          fs.rmSync(globalConfig, { force: true });
          gatesReport.removedConfigs.push(globalConfig);
        } catch (error) {
          gatesReport.notes.push(`kill switch global não pôde ser removido: ${(error as Error).message}`);
        }
      }
    }
    // settingsChanges das linhas do .gitignore registradas pelo gates enable —
    // limpas do state quando a linha foi de fato removida.
    if (gatesReport.gitignoreRemoved.length > 0 && repoRoot(rt.cwd) !== null) {
      const root = repoRoot(rt.cwd) as string;
      const ignoreFile = gitignorePath(root);
      const removedKeys = new Set(GITIGNORE_LINES.map((line) => JSON.stringify([line])));
      loaded.state.settingsChanges = loaded.state.settingsChanges.filter(
        (entry) => !(entry.file === ignoreFile && removedKeys.has(JSON.stringify(entry.path))),
      );
    }
  }

  // createdFiles (config criado do zero pelo harness) → remoção inteira (design F13).
  const removedFiles: string[] = [];
  const keptCreatedFiles: string[] = [];
  for (const file of loaded.state.createdFiles) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
        removedFiles.push(file);
      } catch (error) {
        keptCreatedFiles.push(`${file} (${(error as Error).message})`);
      }
    }
  }

  for (const kept of keptCreatedFiles) notes.push(`arquivo de config criado pelo harness não pôde ser removido: ${kept}`);
  if (failed.length > 0) {
    notes.push("packages com falha de remoção permanecem no state (conservador) — corrija e rode `harness uninstall` de novo.");
  }

  // settingsChanges (F14 SETM-05): remove as chaves que o harness adicionou —
  // mas só quando o valor atual ainda é o default registrado. Chave editada
  // pelo usuário após o install é preservada e reportada (SETM 2.2). --all
  // remove de todos os components; --component só do component selecionado.
  const removedSettings: MergeChange[] = [];
  const preservedSettings: MergeChange[] = [];
  if (loaded.state.settingsChanges.length > 0) {
    const selectedGroups = new Set<string>();
    if (opts.all) {
      for (const entry of Object.values(loaded.state.components)) selectedGroups.add(entry.group);
    } else if (opts.components) {
      for (const component of opts.components) selectedGroups.add(component);
    }
    const targeted = opts.all
      ? [...loaded.state.settingsChanges]
      : loaded.state.settingsChanges.filter((entry) => {
          const owner = componentForSettingsChange(entry, rt, scope);
          return owner !== null && selectedGroups.has(owner);
        });
    if (targeted.length > 0) {
      const outcome = removeSettingsChanges(targeted, rt, scope);
      removedSettings.push(...outcome.removed);
      preservedSettings.push(...outcome.preserved);
      const removedKeys = new Set(outcome.removed.map((c) => JSON.stringify([c.file, c.path])));
      loaded.state.settingsChanges = loaded.state.settingsChanges.filter(
        (entry) => !removedKeys.has(JSON.stringify([entry.file, entry.path])),
      );
      if (preservedSettings.length > 0) {
        notes.push(
          "settings editados após o install foram preservados (remoção ignorada) — valor do usuário vence.",
        );
      }
      if (backupFile) {
        notes.push(
          `alternativa de reversão: \`harness restore ${path.basename(backupFile)}\` restaura a config deste uninstall (F13).`,
        );
      }
    }
  }

  // Packages presentes no pi list fora do state (órfãos do catálogo) e upstreams
  // → preservados (LIFE 2.3 / edge F12): o harness nunca remove o que não gerencia.
  const list = opts.pi.list();
  if (list.error) {
    // Edge F12: uninstall opera com fallback de settings.json + warn.
    opts.err.write(`warn: \`pi list\` falhou (${list.error}) — usando fallback de settings.json.\n`);
  }
  const preserved: string[] = [];
  const removedSet = new Set(removed.map(npmIdentity));
  const upstreamSet = new Set(scanConflicts(list.packages).map((c) => npmIdentity(c.package)));
  for (const spec of list.packages) {
    const identity = npmIdentity(spec);
    if (removedSet.has(identity)) continue;
    const bare = identity.replace(/^npm:/, "");
    if (HARNESS_VERSIONS[bare] !== undefined || upstreamSet.has(identity)) preserved.push(spec);
  }

  try {
    saveState(stateFile, loaded.state);
  } catch (error) {
    err.write(`@runecraft/companion uninstall: falha ao gravar o state (${(error as Error).message}).\n`);
  }

  const report: UninstallReport = {
    scope,
    removed,
    removedFiles,
    removedSettings,
    preservedSettings,
    preserved,
    failed,
    backup: backupFile,
    notes: [...notes, ...agentDetails],
    agentsRemoved: agentIds,
    gates: gatesReport,
  };
  if (opts.json) out.write(renderUninstallJson(report));
  else out.write(renderUninstall(report, { tty: false }));

  return failed.length > 0 || agentFailed ? 1 : 0;
}
