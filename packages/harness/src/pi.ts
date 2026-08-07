// pi.ts — interop with the `pi` binary (F11).
//
// G3 (hybrid, aprovado no design): packages are delegated to `pi install` —
// resolution/dedup/scope belong to pi, the CLI never writes `packages`
// directly. Detection is by binary in PATH (command -v pi) + `pi --version`.
//
// Testability (F21 D1): the binary is resolved from RUNECRAFT_PI_BIN when set
// (default: `pi` from PATH). Pointing it at a fake script is the single fake
// mechanism the suite uses. The exit code of pi is authoritative; stdout and
// stderr are captured for the report.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { piSettingsPath, type Runtime, type Scope } from "./config.ts";

export interface PiResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface PiDetection {
  found: boolean;
  bin: string | null;
  version: string | null;
}

export interface PiListResult {
  packages: string[];
  /** "pi" when parsed from `pi list` stdout, "settings" when the fallback was used. */
  source: "pi" | "settings";
  /** raw error when `pi list` itself failed and the settings fallback was used (design F12 edge). */
  error?: string;
}

export interface PiInterop {
  detect(): PiDetection;
  install(spec: string, scope: Scope): PiResult;
  remove(spec: string, scope: Scope): PiResult;
  list(): PiListResult;
}

/** Exact install command for Pi itself (quickstart) — used by the fail-closed message (CLI-04). */
export function piInstallCommandHint(): string {
  return "npm install -g --ignore-scripts @earendil-works/pi-coding-agent";
}

/** Fail-closed message naming the exact commands to install/configure Pi (CLI-04). */
export function piNotFoundMessage(): string {
  return [
    "@runecraft/harness: binário `pi` não foi detectado no PATH.",
    "O harness orquestra o pi em vez de reimplementar a resolução de packages — instale-o com:",
    "",
    `  ${piInstallCommandHint()}`,
    "",
    "Depois de instalar, rode o harness:",
    "  npx @runecraft/harness install",
    "",
  ].join("\n");
}

/**
 * Resolves the pi binary. Honors RUNECRAFT_PI_BIN (fake pi / explicit path);
 * otherwise falls back to `command -v pi` on PATH.
 */
export function resolvePiBin(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.RUNECRAFT_PI_BIN?.trim();
  if (explicit) return explicit;
  const res = spawnSync("sh", ["-c", "command -v pi"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return null;
}

/** Strips the version from an npm spec: npm:@x/y@1.2.3 → npm:@x/y (pi identity). */
export function npmIdentity(spec: string): string {
  const m = /^npm:(@?[^@]+)(@|$)/.exec(spec);
  if (m?.[1]) return `npm:${m[1]}`;
  return spec;
}

/**
 * Defensive parse of `pi list` stdout. The real format varies between pi
 * versions; entries are recognized as indented non-path tokens:
 *
 *   User packages:
 *     npm:@foo/bar
 *       /abs/path
 *
 * Anything that looks like a path or a header is ignored. Returns the raw
 * specs as printed (npm:.../git:.../local path).
 */
export function parsePiList(stdout: string): string[] {
  const packages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s{2}(\S.*?)\s*$/.exec(line);
    if (!m) continue; // header, blank, or deeper-indented path line
    const token = m[1];
    if (!token || /^[./]/.test(token) || /^(\/|~|\w:[/\\])/.test(token)) continue; // path
    packages.push(token);
  }
  return packages;
}

/** Fallback for `pi list`: read `packages` straight from the scope settings.json. */
export function listFromSettings(rt: Runtime, scope: Scope): string[] {
  const file = piSettingsPath(rt, scope);
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { packages?: unknown };
    if (!Array.isArray(raw.packages)) return [];
    return raw.packages.map((p) => (typeof p === "string" ? p : "")).filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

export function createPiInterop(rt: Runtime): PiInterop {
  const run = (args: string[]): PiResult => {
    const bin = resolvePiBin(rt.env);
    if (!bin) {
      return { ok: false, code: 1, stdout: "", stderr: "pi não encontrado no PATH" };
    }
    const res = spawnSync(bin, args, { encoding: "utf8", env: rt.env, cwd: rt.cwd });
    return {
      ok: res.status === 0,
      code: res.status,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  };

  return {
    detect(): PiDetection {
      const bin = resolvePiBin(rt.env);
      if (!bin) return { found: false, bin: null, version: null };
      const res = run(["--version"]);
      const firstLine = res.stdout.split(/\r?\n/)[0]?.trim();
      return { found: res.ok, bin, version: res.ok ? (firstLine || null) : null };
    },

    install(spec, scope): PiResult {
      // `pi install <source> [-l]` — the flag may appear anywhere in the args
      // (package-manager-cli.js scans all args), `-l` selects project settings.
      return run(scope === "workspace" ? ["install", "-l", spec] : ["install", spec]);
    },

    remove(spec, scope): PiResult {
      return run(scope === "workspace" ? ["remove", "-l", spec] : ["remove", spec]);
    },

    list(): PiListResult {
      const res = run(["list"]);
      if (res.ok) {
        const packages = parsePiList(res.stdout);
        if (packages.length > 0) return { packages, source: "pi" };
        // pi list OK mas sem nada parseável → fallback defensivo de settings (sem erro)
        const fallback = listFromSettings(rt, "global").concat(listFromSettings(rt, "workspace"));
        return { packages: fallback, source: "settings" };
      }
      const fallback = listFromSettings(rt, "global").concat(listFromSettings(rt, "workspace"));
      return {
        packages: fallback,
        source: "settings",
        error: res.stderr.trim() || `pi list falhou com exit code ${res.code ?? "?"}`,
      };
    },
  };
}
