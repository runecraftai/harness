// helpers.ts — test sandbox for the F11/F21 suite.
//
// Every test runs against tmp dirs: RUNECRAFT_PI_HOME (fake ~/.pi/agent),
// RUNECRAFT_HOME (fake ~/.runecraft), and RUNECRAFT_PI_BIN (fake pi script).
// dispatch() is exercised in-process with captured stdout/stderr.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dispatch } from "../src/cli.ts";

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export interface Sandbox {
  dir: string;
  piHome: string;
  runecraftHome: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

export interface SandboxOptions {
  /** spec substring that makes the fake pi fail install (continuation test). */
  fail?: string;
  piVersion?: string;
  /** makes the fake pi `list` exit 1 (simulates a corrupt pi binary). */
  piListFail?: boolean;
}

export function makeSandbox(opts: SandboxOptions = {}): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-f11-"));
  const piHome = path.join(dir, "pi-agent");
  const runecraftHome = path.join(dir, "runecraft");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RUNECRAFT_PI_BIN: path.join(FIXTURES_DIR, "fake-pi.mjs"),
    RUNECRAFT_PI_HOME: piHome,
    RUNECRAFT_HOME: runecraftHome,
  };
  if (opts.fail) env.FAKE_PI_FAIL = opts.fail;
  if (opts.piVersion) env.FAKE_PI_VERSION = opts.piVersion;
  if (opts.piListFail) env.FAKE_PI_LIST_FAIL = "1";
  return {
    dir,
    piHome,
    runecraftHome,
    env,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(String(chunk));
  }
  get text(): string {
    return this.chunks.join("");
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** project cwd (workspace scope tests) */
  cwd?: string;
  /** override the fake pi binary; "" disables the env var (pi absent) */
  piBin?: string;
  isTTY?: boolean;
  /** override the reported node version (edge: warn Node < 22.19) */
  nodeVersion?: string;
  /** stdin for confirmation prompts (default: empty stream — readline resolves immediately) */
  stdin?: NodeJS.ReadableStream;
}

export async function runHarness(sb: Sandbox, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const stdout = new StringSink();
  const stderr = new StringSink();
  const env: NodeJS.ProcessEnv = { ...sb.env };
  if (opts.piBin !== undefined) {
    // Never allow falling through to a real `pi` on the host: an empty value
    // points at a nonexistent path (fail-closed), same as a wrong override.
    env.RUNECRAFT_PI_BIN = opts.piBin === "" ? path.join(sb.dir, "no-such-pi") : opts.piBin;
  }
  const code = await dispatch(args, {
    cwd: opts.cwd ?? sb.dir,
    env,
    stdout,
    stderr,
    stdin: opts.stdin ?? emptyStdin(),
    isTTY: opts.isTTY ?? false,
    nodeVersion: opts.nodeVersion,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** A stdin that answers nothing — readline still resolves the prompt. */
function emptyStdin(): NodeJS.ReadableStream {
  return new Readable({
    read() {
      this.push(null);
    },
  }) as NodeJS.ReadableStream;
}

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

export function settingsFile(sb: Sandbox): string {
  return path.join(sb.piHome, "settings.json");
}

export function stateFile(sb: Sandbox): string {
  return path.join(sb.runecraftHome, "state.json");
}

/**
 * Sandbox com PATH mínimo (symlinks para sh e node apenas): testes que
 * checam resumos/counts do doctor não podem depender dos bins reais do
 * ambiente (claude/opencode/codex podem estar instalados na máquina).
 */
export function makeSandboxCleanPath(): Sandbox {
  const sb = makeSandbox();
  const clean = path.join(sb.dir, "cleanbin");
  fs.mkdirSync(clean, { recursive: true });
  const resolveBin = (bin: string): string => {
    const out = require("node:child_process").execFileSync("sh", ["-c", `command -v ${bin}`], {
      encoding: "utf8",
    }) as string;
    return out.trim().split(/\r?\n/)[0] ?? "";
  };
  for (const bin of ["sh", "node"]) {
    try {
      fs.symlinkSync(resolveBin(bin), path.join(clean, bin));
    } catch {
      // sh/node ausentes no ambiente: PATH vazio ainda isola os bins de agentes
    }
  }
  sb.env.PATH = clean;
  return sb;
}

export function backupsDir(sb: Sandbox): string {
  return path.join(sb.runecraftHome, "backups");
}

export function writeSettings(sb: Sandbox, packages: string[]): void {
  const file = settingsFile(sb);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ packages }, null, 2));
}

/** Appends packages to the scope settings, preserving every existing key (simulates a manual pi install). */
export function appendPackages(sb: Sandbox, packages: string[]): void {
  const file = settingsFile(sb);
  const settings = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  const current = Array.isArray(settings.packages) ? (settings.packages as unknown[]) : [];
  settings.packages = [...current, ...packages];
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}
