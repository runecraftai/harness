// commands/gates.ts — `harness gates enable|disable|status|run` (design fluxo 3/5).
//
//   enable   → escreve .runecraft/config.json (gates.enabled:true, atômico) +
//              instala hooks pre-commit/pre-push (família shell F18) + garante
//              linhas .runecraft/receipts/ e .runecraft/config.json no
//              .gitignore (append idempotente, escopo fino) + backup F13 +
//              registra createdFiles/settingsChanges no state do workspace.
//   disable  → backup antes; kill switch GLOBAL por default (~/.runecraft/
//              config.json gates.enabled:false) com prompt no TTY; --scope
//              workspace → .runecraft/config.json; [--dry-run] [--json].
//   status   → repo/global/effective + hooks + receipts + .gitignore + --json.
//   run      → delega ao gates/run.ts (chamado pelos hooks; debug direto).
//
// Repo operations resolve o root via `dirname(git rev-parse --git-common-dir)`
// (worktrees → root do repo principal). O state/backups do workspace usam um
// Runtime com cwd = root (o `.runecraft` do repo fica sempre no root).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  backupsDir,
  resolveRuntime,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { createSnapshot } from "../backup.ts";
import { loadState, saveState, upsertSettingsChange, type HarnessState, type SettingsChange } from "../state.ts";
import { repoConfigPath, globalConfigPath, resolveGates, serializeGatesConfig, type GatesResolution } from "../gates/config.ts";
import {
  ensureGitignoreLines,
  gitignoreGatesLines,
  gitignorePath,
  HOOK_NAMES,
  hooksDirFor,
  installGatesHooks,
  removeGatesHooks,
  hasGatesSection,
} from "../gates/hook.ts";
import { repoRoot } from "../gates/git.ts";
import { runGatesHook, type GateHookName } from "../gates/run.ts";
import { scanReceipts } from "../receipt/store.ts";

// ---------------------------------------------------------------------------
// state helpers (repo root runtime)
// ---------------------------------------------------------------------------

/** Runtime with cwd = repo root (workspace state/backups live at the root). */
function rtAtRoot(rt: Runtime, root: string): Runtime {
  return resolveRuntime(root, rt.env);
}

function addCreatedFile(state: HarnessState, file: string): void {
  if (!state.createdFiles.includes(file)) state.createdFiles.push(file);
}

function registerGitignoreChanges(state: HarnessState, gitignoreFile: string, added: string[]): void {
  for (const line of added) {
    const change: SettingsChange = { file: gitignoreFile, path: [line], value: line };
    upsertSettingsChange(state, change);
  }
}

/** Files to snapshot before a gates-enable write (only existing files are captured). */
function gatesWriteSnapshotFiles(root: string, hooks: string[]): string[] {
  const files: string[] = [];
  const config = repoConfigPath(root);
  if (fs.existsSync(config)) files.push(config);
  for (const hook of hooks) {
    if (fs.existsSync(hook)) files.push(hook);
  }
  const ignore = gitignorePath(root);
  if (fs.existsSync(ignore)) files.push(ignore);
  return files;
}

// ---------------------------------------------------------------------------
// enable
// ---------------------------------------------------------------------------

export interface GatesEnableResult {
  root: string;
  configFile: string;
  hooksDir: string;
  hooksWritten: string[];
  hooksCreated: string[];
  hooksUnchanged: string[];
  gitignoreAdded: string[];
  backup?: string;
  dryRun: boolean;
}

export function renderGatesEnable(result: GatesEnableResult): string {
  const lines = [`@runecraft/harness gates enable (repo ${result.root})`];
  lines.push(`  config: ${result.configFile} → {"gates":{"enabled":true}}`);
  lines.push(`  hooks: ${result.hooksDir}`);
  for (const hook of result.hooksWritten) lines.push(`    ✓ ${path.basename(hook)} (${result.hooksCreated.includes(hook) ? "criado" : "seção upserted"})`);
  for (const hook of result.hooksUnchanged) lines.push(`    = ${path.basename(hook)} (já em sync)`);
  if (result.gitignoreAdded.length > 0) {
    lines.push(`  .gitignore adicionado (${result.gitignoreAdded.length}): ${result.gitignoreAdded.join(", ")}`);
  }
  if (result.backup) lines.push(`  backup pré-write: ${result.backup}`);
  if (result.dryRun) lines.push("  DRY-RUN — nada foi modificado.");
  return `${lines.join("\n")}\n`;
}

export function renderGatesEnableJson(result: GatesEnableResult): string {
  return `${JSON.stringify(
    {
      command: "enable",
      root: result.root,
      dryRun: result.dryRun,
      config: { file: result.configFile, enabled: true },
      hooks: { dir: result.hooksDir, written: result.hooksWritten, created: result.hooksCreated, unchanged: result.hooksUnchanged },
      gitignore: { file: gitignorePath(result.root), added: result.gitignoreAdded },
      backup: result.backup ?? null,
    },
    null,
    2,
  )}\n`;
}

/** `harness gates enable` — always targets the repo (root). Dry-run: report only. */
export async function runGatesEnable(
  rt: Runtime,
  opts: { dryRun: boolean; json: boolean; out: TextSink; err: TextSink },
): Promise<number> {
  const root = repoRoot(rt.cwd);
  if (root === null) {
    opts.err.write("@runecraft/harness gates: enable exige um repositório git (git rev-parse falhou)\n");
    return 1;
  }
  const rtRoot = rtAtRoot(rt, root);
  const configFile = repoConfigPath(root);
  const hooks = HOOK_NAMES.map((name) => path.join(hooksDirFor(root), name));
  const ignoreFile = gitignorePath(root);

  const result: GatesEnableResult = {
    root,
    configFile,
    hooksDir: hooksDirFor(root),
    hooksWritten: [],
    hooksCreated: [],
    hooksUnchanged: [],
    gitignoreAdded: [],
    dryRun: opts.dryRun,
  };

  if (opts.dryRun) {
    result.hooksWritten = hooks;
    result.hooksCreated = hooks.filter((h) => !fs.existsSync(h));
    const ignore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
    result.gitignoreAdded = [".runecraft/receipts/", ".runecraft/config.json"].filter(
      (line) => !ignore.split(/\r?\n/).includes(line),
    );
    if (opts.json) opts.out.write(renderGatesEnableJson(result));
    else opts.out.write(renderGatesEnable(result));
    return 0;
  }

  // Backup (F13) BEFORE any write — config + hooks + .gitignore que existem.
  try {
    const snapshot = createSnapshot({
      files: gatesWriteSnapshotFiles(root, hooks),
      destDir: backupsDir(rtRoot, "workspace"),
      reason: "gates-enable",
      scope: "workspace",
    });
    result.backup = snapshot.file;
  } catch (error) {
    opts.err.write(
      `@runecraft/harness gates: falha ao criar o snapshot pré-write — nada foi modificado.\n  ${(error as Error).message}\n`,
    );
    return 1;
  }

  // 1. config (atômico tmp+rename).
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const tmp = `${configFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, serializeGatesConfig(true), "utf8");
  fs.renameSync(tmp, configFile);

  // 2. hooks (seções shell; shebang em arquivo novo; chmod +x; sem BOM).
  const install = installGatesHooks(hooksDirFor(root));
  result.hooksWritten = install.written;
  result.hooksCreated = install.created;
  result.hooksUnchanged = install.unchanged;

  // 3. .gitignore (escopo fino).
  const ignore = ensureGitignoreLines(root);
  result.gitignoreAdded = ignore.added;

  // 4. State (workspace): createdFiles + settingsChanges das linhas do .gitignore.
  const stateFile = statePath(rtRoot, "workspace");
  const loaded = loadState(stateFile, "workspace");
  if (loaded.corruptPath && loaded.corruptPath !== stateFile) {
    opts.err.write(`warn: state.json corrompido — movido para ${loaded.corruptPath}; state recomeçado.\n`);
  }
  addCreatedFile(loaded.state, configFile);
  for (const hook of install.created) addCreatedFile(loaded.state, hook);
  if (ignore.created) addCreatedFile(loaded.state, ignoreFile);
  registerGitignoreChanges(loaded.state, ignoreFile, ignore.added);
  try {
    saveState(stateFile, loaded.state);
  } catch (error) {
    opts.err.write(`@runecraft/harness gates: falha ao gravar o state (${(error as Error).message}).\n`);
  }

  if (opts.json) opts.out.write(renderGatesEnableJson(result));
  else opts.out.write(renderGatesEnable(result));
  return 0;
}

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

export interface GatesDisableOptions {
  rt: Runtime;
  scope: Scope;
  dryRun: boolean;
  json: boolean;
  yes: boolean;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
  out: TextSink;
  err: TextSink;
}

export interface GatesDisableResult {
  scope: Scope;
  file: string;
  enabled: false;
  dryRun: boolean;
  backup?: string;
  confirmed?: boolean;
  notes: string[];
}

function renderGatesDisable(result: GatesDisableResult): string {
  const lines = [
    `@runecraft/harness gates disable (${result.scope})`,
    `  ${result.file} → {"gates":{"enabled":false}}`,
  ];
  for (const note of result.notes) lines.push(`  note: ${note}`);
  if (result.backup) lines.push(`  backup pré-write: ${result.backup}`);
  if (result.dryRun) lines.push("  DRY-RUN — nada foi modificado.");
  return `${lines.join("\n")}\n`;
}

function renderGatesDisableJson(result: GatesDisableResult): string {
  return `${JSON.stringify(
    {
      command: "disable",
      scope: result.scope,
      file: result.file,
      enabled: false,
      dryRun: result.dryRun,
      backup: result.backup ?? null,
      notes: result.notes,
    },
    null,
    2,
  )}\n`;
}

function confirmGlobalDisable(stdin: NodeJS.ReadableStream): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: process.stdout });
    rl.question(
      "Desligar os delivery gates GLOBALMENTE (~/.runecraft/config.json, todos os repos)? [y/N] ",
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

/**
 * `harness gates disable` — kill switch. Default scope: GLOBAL (todos os
 * repos), com prompt no TTY (não surpreender — decisão 4). `--scope
 * workspace` → repo (requer git root). Non-TTY segue sem prompt (impossível
 * perguntar — padrão uninstall); `--yes` pula o prompt.
 */
export async function runGatesDisable(opts: GatesDisableOptions): Promise<number> {
  const { rt, scope, out, err } = opts;
  const notes: string[] = [];
  const root = repoRoot(rt.cwd);
  if (scope === "workspace" && root === null) {
    err.write("@runecraft/harness gates: --scope workspace exige um repositório git\n");
    return 1;
  }
  const rtScope = scope === "workspace" && root !== null ? rtAtRoot(rt, root) : rt;
  const file = scope === "workspace" && root !== null ? repoConfigPath(root) : globalConfigPath(rtScope);

  const result: GatesDisableResult = {
    scope,
    file,
    enabled: false,
    dryRun: opts.dryRun,
    notes,
  };

  // Prompt (TTY + !--yes + global): o default é N — aborta a não ser que o
  // usuário confirme explicitamente.
  let confirmed = true;
  if (scope === "global" && opts.isTTY && !opts.yes) {
    confirmed = await confirmGlobalDisable(opts.stdin);
    result.confirmed = confirmed;
    if (!confirmed) {
      err.write("Abortado pelo usuário — nada foi modificado.\n");
      return 1;
    }
  }
  if (opts.dryRun) {
    if (opts.json) out.write(renderGatesDisableJson(result));
    else out.write(renderGatesDisable(result));
    return 0;
  }

  // Backup (F13) antes de escrever.
  try {
    const snapshot = createSnapshot({
      files: [file].filter((f) => fs.existsSync(f)),
      destDir: backupsDir(rtScope, scope),
      reason: "gates-disable",
      scope,
    });
    result.backup = snapshot.file;
  } catch (error) {
    err.write(`@runecraft/harness gates: falha ao criar o snapshot pré-write — nada foi modificado.\n  ${(error as Error).message}\n`);
    return 1;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, serializeGatesConfig(false), "utf8");
  fs.renameSync(tmp, file);

  // State: createdFiles (para o uninstall global remover o kill switch órfão).
  const stateFile = statePath(rtScope, scope);
  const loaded = loadState(stateFile, scope);
  addCreatedFile(loaded.state, file);
  try {
    saveState(stateFile, loaded.state);
  } catch (error) {
    err.write(`@runecraft/harness gates: falha ao gravar o state (${(error as Error).message}).\n`);
  }

  if (scope === "global") {
    notes.push("kill switch global ativo — hooks continuam instalados mas inertes (reportam disabled/unmanaged, exit 0).");
  } else {
    notes.push("repo off — os hooks deste repo reportam disabled/unmanaged (exit 0); outros repos seguem conforme config deles.");
  }
  if (opts.json) out.write(renderGatesDisableJson(result));
  else out.write(renderGatesDisable(result));
  return 0;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export interface GatesStatusReport {
  root: string;
  repo: { file: string; present: boolean; enabled?: boolean; error?: string };
  global: { file: string; present: boolean; enabled?: boolean; error?: string };
  effective: "enabled" | "disabled" | "absent";
  hooks: {
    dir: string;
    preCommit: { present: boolean; section: boolean };
    prePush: { present: boolean; section: boolean };
  };
  receipts: { count: number; latest?: string };
  gitignore: { file: string; lines: string[] };
}

export function computeGatesStatus(rt: Runtime, root: string): GatesStatusReport {
  const resolution: GatesResolution = resolveGates(rt, root);
  const hooksDir = hooksDirFor(root);
  const hookState = (name: string): { present: boolean; section: boolean } => {
    const file = path.join(hooksDir, name);
    return { present: fs.existsSync(file), section: hasGatesSection(file) };
  };
  const scanned = scanReceipts(root);
  const valid = scanned.filter((s) => s.receipt);
  return {
    root,
    repo: {
      file: repoConfigPath(root),
      present: !resolution.repo.absent,
      enabled: resolution.repo.config?.gates.enabled,
      error: resolution.repo.error,
    },
    global: {
      file: globalConfigPath(rt),
      present: !resolution.global.absent,
      enabled: resolution.global.config?.gates.enabled,
      error: resolution.global.error,
    },
    effective: resolution.effective,
    hooks: { dir: hooksDir, preCommit: hookState("pre-commit"), prePush: hookState("pre-push") },
    receipts: {
      count: valid.length,
      latest: valid[0]?.receipt?.issuedAt,
    },
    gitignore: { file: gitignorePath(root), lines: gitignoreGatesLines(root) },
  };
}

export function renderGatesStatus(report: GatesStatusReport): string {
  const lines = [`@runecraft/harness gates status (${report.root})`];
  const label = (value: boolean | undefined, present: boolean, error?: string): string => {
    if (error) return `erro (${error})`;
    if (!present) return "ausente";
    return value === true ? "enabled" : value === false ? "disabled" : "inválido";
  };
  lines.push(`  repo:   ${label(report.repo.enabled, report.repo.present, report.repo.error)} (${report.repo.file})`);
  lines.push(`  global: ${label(report.global.enabled, report.global.present, report.global.error)} (${report.global.file})`);
  lines.push(`  effective: ${report.effective}`);
  lines.push(
    `  hooks (${report.hooks.dir}): pre-commit ${report.hooks.preCommit.section ? "seção runecraft:gates ✓" : report.hooks.preCommit.present ? "presente sem seção" : "ausente"} · pre-push ${report.hooks.prePush.section ? "seção runecraft:gates ✓" : report.hooks.prePush.present ? "presente sem seção" : "ausente"}`,
  );
  lines.push(
    `  receipts: ${report.receipts.count}${report.receipts.latest ? ` (mais recente ${report.receipts.latest})` : ""}`,
  );
  lines.push(`  .gitignore: ${report.gitignore.lines.length > 0 ? report.gitignore.lines.join(", ") : "linhas de gates ausentes"}`);
  return `${lines.join("\n")}\n`;
}

export function renderGatesStatusJson(report: GatesStatusReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// run (delegates to gates/run.ts)
// ---------------------------------------------------------------------------

function readStreamAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stream.on("data", (chunk: unknown) => {
      data += String(chunk);
    });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(data));
  });
}

export async function runGatesRun(
  rt: Runtime,
  hook: string,
  stdin: NodeJS.ReadableStream,
  out: TextSink,
  err: TextSink,
): Promise<number> {
  if (hook !== "pre-commit" && hook !== "pre-push") {
    err.write(`@runecraft/harness gates run: hook inválido '${hook}' (esperado pre-commit|pre-push)\n`);
    return 1;
  }
  const stdinText = hook === "pre-push" ? await readStreamAll(stdin) : undefined;
  return runGatesHook({ rt, hook: hook as GateHookName, stdinText, out, err });
}

// ---------------------------------------------------------------------------
// dispatch entry
// ---------------------------------------------------------------------------

export interface GatesCommandOptions {
  rt: Runtime;
  subcommand: string;
  args: string[];
  scope: Scope;
  scopeSet: boolean;
  dryRun: boolean;
  json: boolean;
  yes: boolean;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
  out: TextSink;
  err: TextSink;
}

export async function runGatesCommand(opts: GatesCommandOptions): Promise<number> {
  const { out, err, rt } = opts;
  switch (opts.subcommand) {
    case "enable":
      return runGatesEnable(rt, { dryRun: opts.dryRun, json: opts.json, out, err });
    case "disable":
      return runGatesDisable({
        rt,
        scope: opts.scope,
        dryRun: opts.dryRun,
        json: opts.json,
        yes: opts.yes,
        isTTY: opts.isTTY,
        stdin: opts.stdin,
        out,
        err,
      });
    case "status": {
      const root = repoRoot(rt.cwd);
      if (root === null) {
        err.write("@runecraft/harness gates: status exige um repositório git\n");
        return 1;
      }
      const report = computeGatesStatus(rt, root);
      if (opts.json) out.write(renderGatesStatusJson(report));
      else out.write(renderGatesStatus(report));
      return 0;
    }
    case "run":
      return runGatesRun(rt, opts.args[0] ?? "", opts.stdin, out, err);
    default:
      err.write(`@runecraft/harness gates: subcomando desconhecido '${opts.subcommand}' (esperado enable|disable|status|run)\n`);
      return 1;
  }
}
