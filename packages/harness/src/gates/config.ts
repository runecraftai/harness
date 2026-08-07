// gates/config.ts — gates configuration (D3).
//
// Repo config: `<repo root>/.runecraft/config.json` (`gates.enabled`).
// Global config: `~/.runecraft/config.json` (kill switch — `gates disable`
// global writes `gates.enabled: false`). The hooks read BOTH files at
// execution time; config is user intent, state.json (F13) is bookkeeping.
//
// Effective (design fluxo 3): `repo.gates.enabled === true &&
// !(global.gates.enabled === false)`. Missing config → "absent" — a hook
// that ran with no config is an abnormal state (enable implies config) and
// the gate denies fail-closed. Present-but-unreadable config → deny pointing
// at the file (never risk interpretation). Exit 0 (`disabled/unmanaged`) only
// when a config is present and explicitly says enabled:false.
import * as fs from "node:fs";
import * as path from "node:path";
import { runecraftDir, type Runtime } from "../config.ts";

export const GATES_SCHEMA_VERSION = 1 as const;

export interface GatesConfig {
  schemaVersion: typeof GATES_SCHEMA_VERSION;
  gates: { enabled: boolean };
}

export interface GatesConfigFile {
  file: string;
  /** file missing (absent) — not an error by itself. */
  absent: boolean;
  /** file present and parseable. */
  ok: boolean;
  config?: GatesConfig;
  /** present but unreadable/invalid — deny with this message (fail-closed). */
  error?: string;
}

/** Repo gates config: `<root>/.runecraft/config.json`. */
export function repoConfigPath(root: string): string {
  return path.join(root, ".runecraft", "config.json");
}

/** Global gates config: `<runecraft global dir>/config.json` (~/.runecraft). */
export function globalConfigPath(rt: Runtime): string {
  return path.join(runecraftDir(rt, "global"), "config.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read + validate one gates config file. Missing → `absent`; JSON invalid or
 * wrong shape → `ok:false` with an error naming the file (deny path).
 */
export function readGatesConfig(file: string): GatesConfigFile {
  if (!fs.existsSync(file)) return { file, absent: true, ok: true };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      file,
      absent: false,
      ok: false,
      error: `${file}: JSON inválido — ${(error as Error).message}`,
    };
  }
  if (
    !isPlainObject(raw) ||
    raw.schemaVersion !== GATES_SCHEMA_VERSION ||
    !isPlainObject(raw.gates) ||
    typeof raw.gates.enabled !== "boolean"
  ) {
    return {
      file,
      absent: false,
      ok: false,
      error: `${file}: config de gates inválido (esperado {"schemaVersion":1,"gates":{"enabled":boolean}} — campos extras não são interpretados)`,
    };
  }
  return {
    file,
    absent: false,
    ok: true,
    config: { schemaVersion: GATES_SCHEMA_VERSION, gates: { enabled: raw.gates.enabled } },
  };
}

export type GatesEffective = "enabled" | "disabled" | "absent";

export interface GatesResolution {
  effective: GatesEffective;
  repo: GatesConfigFile;
  global: GatesConfigFile;
  /** present-but-unreadable config → deny with this message (fail-closed). */
  error?: string;
}

/**
 * Resolve the effective gates state for a repo root. `error` is set when any
 * present config is unreadable/invalid (the gate denies pointing at the file
 * — never risks interpretation). `absent` = no config anywhere (deny with the
 * "config de gates ausente" message). `disabled` = config present with
 * enabled:false (repo or global kill switch) — exit 0.
 */
export function resolveGates(rt: Runtime, root: string): GatesResolution {
  const repo = readGatesConfig(repoConfigPath(root));
  const global = readGatesConfig(globalConfigPath(rt));
  if (!repo.ok) return { effective: "absent", repo, global, error: repo.error };
  if (!global.ok) return { effective: "absent", repo, global, error: global.error };
  if (repo.absent && global.absent) return { effective: "absent", repo, global };
  const repoOn = repo.config?.gates.enabled === true;
  const globalOff = global.config?.gates.enabled === false;
  return {
    effective: repoOn && !globalOff ? "enabled" : "disabled",
    repo,
    global,
  };
}

/** Serialize a gates config (atomic write happens at the caller). */
export function serializeGatesConfig(enabled: boolean): string {
  return `${JSON.stringify({ schemaVersion: GATES_SCHEMA_VERSION, gates: { enabled } }, null, 2)}\n`;
}

/**
 * True when the parsed file holds ONLY known gates keys (schemaVersion +
 * gates.enabled) — the uninstall safety rule for the global kill switch: a
 * config the user extended is preserved (SETM-05), a gates-only file is
 * removed so `disable` never leaves an orphan behind (design fluxo 5).
 */
export function isGatesOnlyConfig(file: GatesConfigFile): boolean {
  if (!file.ok || file.absent || !file.config) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file.file, "utf8")) as Record<string, unknown>;
  } catch {
    // TOCTOU: arquivo mudou entre a leitura original e esta (ou ficou ilegível)
    // — não removível com segurança; preservar (SETM-05 conservador).
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const gates = parsed.gates;
  return (
    isPlainObject(gates) &&
    Object.keys(parsed).every((key) => key === "schemaVersion" || key === "gates") &&
    Object.keys(gates).every((key) => key === "enabled")
  );
}
