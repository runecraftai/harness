// cli.ts — flag parsing (node:util.parseArgs) and in-process dispatch (F21 D1).
//
// dispatch(argv, ctx) is the testable entry of layer 1: it returns an exit
// code and writes only to ctx-provided sinks. bin/harness.ts is a thin wrapper
// (shebang + process.exit(dispatch(...))). All pi interaction goes through
// ctx.pi, which defaults to spawn via RUNECRAFT_PI_BIN — the single fake-pi
// mechanism the F21 suite uses.
import { parseArgs } from "node:util";
import { resolveEffectiveScope, resolveRuntime, type Runtime, type Scope, type TextSink } from "./config.ts";
import { createPiInterop, piNotFoundMessage, type PiInterop } from "./pi.ts";
import { helpText, isPreset, validateComponents, versionText, type PresetName } from "./plan.ts";
import { runInstall, type InstallCommandOptions } from "./commands/install.ts";
import { runDoctorCommand, type DoctorCommandOptions } from "./commands/doctor.ts";
import { runStatusCommand, type StatusCommandOptions } from "./commands/status.ts";
import { runSyncCommand, type SyncCommandOptions } from "./commands/sync.ts";
import { runUninstallCommand, type UninstallCommandOptions } from "./commands/uninstall.ts";
import { runRestoreCommand, type RestoreCommandOptions } from "./commands/restore.ts";
import { runBackupsCommand, type BackupsCommandOptions } from "./commands/backups.ts";

export interface DispatchContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: TextSink;
  stderr?: TextSink;
  /** stdin for confirmation prompts (default process.stdin). */
  stdin?: NodeJS.ReadableStream;
  /** pi interop override (defaults to spawn via RUNECRAFT_PI_BIN). */
  pi?: PiInterop;
  /** node version override for the <22.19 edge-case warn (default process.versions.node). */
  nodeVersion?: string;
  /** TTY override for the confirmation prompt (default process.stdout.isTTY). */
  isTTY?: boolean;
}

export const COMMANDS = [
  "install",
  "doctor",
  "status",
  "sync",
  "uninstall",
  "restore",
  "backups",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export interface CliOptions {
  command: CommandName;
  component?: string[];
  preset: PresetName;
  dryRun: boolean;
  json: boolean;
  scope: Scope;
  /** true when --scope was passed explicitly (status/sync/uninstall default dynamically). */
  scopeSet: boolean;
  yes: boolean;
  /** uninstall: remove everything the harness manages. */
  all: boolean;
  /** positionals after the command (restore <name>). */
  args: string[];
  /** backups: pin a snapshot against prune (--keep <name>). */
  keep?: string;
  help: boolean;
  version: boolean;
}

export interface ParseResult {
  ok: boolean;
  options: CliOptions;
  error?: string;
}

export function parseCliArgs(argv: string[]): ParseResult {
  if (argv.length === 0 || argv.some((a) => a === "-h" || a === "--help")) {
    return {
      ok: true,
      options: {
        command: "install",
        preset: "minimal",
        dryRun: false,
        json: false,
        scope: "global",
        scopeSet: false,
        yes: false,
        all: false,
        args: [],
        help: true,
        version: false,
      },
    };
  }
  if (argv.some((a) => a === "-v" || a === "--version")) {
    return {
      ok: true,
      options: {
        command: "install",
        preset: "minimal",
        dryRun: false,
        json: false,
        scope: "global",
        scopeSet: false,
        yes: false,
        all: false,
        args: [],
        help: false,
        version: true,
      },
    };
  }

  let positionals: string[];
  let values: {
    component?: string[];
    preset?: string;
    "dry-run"?: boolean;
    json?: boolean;
    scope?: string;
    yes?: boolean;
    all?: boolean;
    keep?: string;
  };
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        component: { type: "string", multiple: true },
        preset: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        scope: { type: "string" },
        yes: { type: "boolean" },
        all: { type: "boolean" },
        keep: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    return { ok: false, options: unsetOptions(), error: `flags inválidas: ${(error as Error).message}` };
  }

  const command = positionals[0] as CommandName | undefined;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    return {
      ok: false,
      options: unsetOptions(),
      error: command ? `comando desconhecido: ${command}` : "nenhum comando informado",
    };
  }

  const positionalArgs = positionals.slice(1);
  if (command === "restore" && positionalArgs.length > 1) {
    return {
      ok: false,
      options: unsetOptions(),
      error: `restore aceita um único nome de snapshot (recebeu: ${positionalArgs.join(", ")})`,
    };
  }

  const scope = (values.scope ?? "global") as Scope;
  if (scope !== "global" && scope !== "workspace") {
    return { ok: false, options: unsetOptions(), error: `--scope inválido: ${scope} (esperado global|workspace)` };
  }
  const preset = values.preset ?? "minimal";
  if (!isPreset(preset)) {
    return { ok: false, options: unsetOptions(), error: `--preset inválido: ${preset} (esperado minimal|full)` };
  }

  const component = values.component as string[] | undefined;
  const validated = validateComponents(component ?? []);
  if (validated.invalid.length > 0) {
    return {
      ok: false,
      options: unsetOptions(),
      error: `--component inválido: ${validated.invalid.join(", ")} (esperado: subagents, taskflow, goal-loop-audit, pr-review)`,
    };
  }

  return {
    ok: true,
    options: {
      command,
      // validateComponents já splitou vírgulas; componente vazio = preset default
      component: validated.ok.length > 0 ? validated.ok : undefined,
      preset,
      dryRun: Boolean(values["dry-run"]),
      json: Boolean(values.json),
      scope,
      scopeSet: values.scope !== undefined,
      yes: Boolean(values.yes),
      all: Boolean(values.all),
      args: positionalArgs,
      keep: values.keep,
      help: false,
      version: false,
    },
  };
}

function unsetOptions(): CliOptions {
  return {
    command: "install",
    preset: "minimal",
    dryRun: false,
    json: false,
    scope: "global",
    scopeSet: false,
    yes: false,
    all: false,
    args: [],
    help: false,
    version: false,
  };
}

/**
 * In-process CLI entry (F21 D1). Returns the process exit code.
 */
export async function dispatch(argv: string[], ctx: DispatchContext = {}): Promise<number> {
  const out = ctx.stdout ?? process.stdout;
  const err = ctx.stderr ?? process.stderr;
  const parsed = parseCliArgs(argv);

  if (!parsed.ok) {
    err.write(`@runecraft/harness: ${parsed.error}\n`);
    err.write("Rode `npx @runecraft/harness --help` para ver os comandos e flags.\n");
    return 1;
  }

  const { options } = parsed;
  if (options.help) {
    out.write(helpText());
    return 0;
  }
  if (options.version) {
    out.write(versionText());
    return 0;
  }

  const rt: Runtime = resolveRuntime(ctx.cwd, ctx.env);
  const pi = ctx.pi ?? createPiInterop(rt);

  if (options.command === "install") {
    const opts: InstallCommandOptions = {
      command: options.command,
      preset: options.preset,
      components: options.component,
      dryRun: options.dryRun,
      json: options.json,
      scope: options.scope,
      yes: options.yes,
      pi,
      rt,
      out,
      err,
      nodeVersion: ctx.nodeVersion ?? process.versions.node,
      isTTY: ctx.isTTY ?? Boolean(process.stdout.isTTY),
      stdin: ctx.stdin ?? process.stdin,
    };
    return runInstall(opts);
  }

  const base = {
    json: options.json,
    out,
    err,
    rt,
    pi,
  };
  const effectiveScope = resolveEffectiveScope(rt, options.scope, options.scopeSet);
  switch (options.command) {
    case "doctor": {
      const opts: DoctorCommandOptions = base;
      return runDoctorCommand(opts);
    }
    case "status": {
      const opts: StatusCommandOptions = { ...base, scope: effectiveScope };
      return runStatusCommand(opts);
    }
    case "sync": {
      const opts: SyncCommandOptions = { ...base, dryRun: options.dryRun, scope: effectiveScope };
      return runSyncCommand(opts);
    }
    case "uninstall": {
      const opts: UninstallCommandOptions = {
        ...base,
        all: options.all,
        components: options.component,
        yes: options.yes,
        scope: effectiveScope,
        isTTY: ctx.isTTY ?? Boolean(process.stdout.isTTY),
        stdin: ctx.stdin ?? process.stdin,
      };
      return runUninstallCommand(opts);
    }
    case "restore": {
      const opts: RestoreCommandOptions = {
        json: options.json,
        out,
        err,
        rt,
        scope: effectiveScope,
        name: options.args[0],
      };
      return runRestoreCommand(opts);
    }
    case "backups": {
      const opts: BackupsCommandOptions = {
        json: options.json,
        out,
        err,
        rt,
        scope: effectiveScope,
        keep: options.keep,
      };
      return runBackupsCommand(opts);
    }
    default:
      err.write(`@runecraft/harness: comando desconhecido ${options.command}\n`);
      return 1;
  }
}
