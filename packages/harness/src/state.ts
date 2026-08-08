// state.ts — state.json for the harness (F13, STBK-01..03).
//
// Schema (design F13, schemaVersion 1): per-package `components` entries with
// `group`, plus `createdFiles` (config files created from scratch — removed
// whole on uninstall), `settingsChanges` (exact merge additions — F14 owns
// them) and `preInstall` (per-operation snapshot records). Rules:
//   - atomic write (STBK-03)
//   - upsert per component, install only touches affected entries (STBK-01)
//   - corrupted state is never silently overwritten: moved aside with a warn
//     suffix before a fresh state starts (conservative — STBK-03)
//   - additive migration (AD-013): schemaVersion stays 1 forever; future
//     sections (F17 `agents`) must survive a load→save round-trip. parseState
//     therefore preserves unknown top-level keys instead of dropping them.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Scope } from "./config.ts";
import type { GuardsConfig } from "./guards/guardKit.ts";
import { defaultGuardsConfig } from "./guards/guardKit.ts";
import type { VerificationConfig } from "./verify/config.ts";
import { defaultVerificationConfig } from "./verify/config.ts";
import type { ResilienceConfig } from "./resilience/config.ts";
import { defaultResilienceConfig } from "./resilience/config.ts";
import type { ObservabilityConfig } from "./observability/config.ts";
import { defaultObservabilityConfig } from "./observability/config.ts";
import type { MemoryConfig } from "./memory/config.ts";
import { defaultMemoryConfig } from "./memory/config.ts";
import type { ModelsConfig } from "./models/config.ts";
import { defaultModelsConfig } from "./models/config.ts";
import type { PersonaConfig } from "./persona/config.ts";
import { defaultPersonaConfig } from "./persona/config.ts";
import type { RoleAgentRecord } from "./agents/materialize.ts";

export interface InstalledEntry {
  /** logical component group, e.g. "taskflow" (taskflow-core/pi/dsl share it) */
  group: string;
  /** npm source without version, e.g. npm:@runecraft/taskflow-core */
  source: string;
  version: string;
  installedAt: string;
}

/** One snapshot record pushed per pre-write backup (design F13 `preInstall`). */
export interface PreInstallRecord {
  /** absolute path of the snapshot .tar.gz */
  file: string;
  /** sha256 of the snapshot content (dedupe key) */
  hash: string;
  /** snapshot file name, e.g. runecraft-<ts>.tar.gz */
  backup: string;
}

/** Exact addition made by the merge engine (design F13; SETM-03 — F14 fills it). */
export interface SettingsChange {
  /** config file the addition landed in */
  file: string;
  /** JSON path into the file, e.g. ["subagents","watchdog","main","model"] */
  path: string[];
  /** the exact default applied */
  value: unknown;
}

/**
 * One managed target of a non-Pi agent (F15/F17 D2). Kind `rules` = a marker
 * section in a text file; kind `mcp` = an MCP server entry in a host config.
 */
export type AgentTarget =
  | {
      kind: "rules";
      /** logical component (matrix column), e.g. "rules" */
      component: string;
      /** absolute path of the rules file (CLAUDE.md / AGENTS.md) */
      file: string;
      /** marker section id, e.g. "runecraft:workflow" */
      section: string;
      /** sha256 of the normalized section content (F17 D2; SETM-05 basis) */
      contentHash: string;
      /** template version rendered at the last inject (F19 D7: sync reports template vN→vM). */
      rulesVersion?: string;
    }
  | {
      kind: "mcp";
      /** logical component (matrix column), e.g. "taskflow" */
      component: string;
      /** absolute path of the host MCP config file */
      file: string;
      /** entry key inside the config, e.g. "taskflow" */
      entry: string;
      /** resolved fork binary (diagnostic; edit detection uses contentHash) */
      bin: string;
      /** sha256 of the canonical entry JSON (command/args) — D7 fingerprint */
      contentHash: string;
    };

/** State record for one managed non-Pi agent (F17 D2, implemented in F15). */
export interface AgentRecord {
  installedAt: string;
  harnessVersion: string;
  targets: AgentTarget[];
}

export interface HarnessState {
  schemaVersion: 1;
  scope: Scope;
  installedAt?: string;
  components: Record<string, InstalledEntry>;
  /** config files created from scratch by the harness (removed whole on uninstall). */
  createdFiles: string[];
  /** exact additions made by the merge engine (F14). */
  settingsChanges: SettingsChange[];
  /** hashes + backup names for files touched at install time. */
  preInstall: PreInstallRecord[];
  /** managed non-Pi agents (F15/F17 D2; aditivo, schemaVersion permanece 1). */
  agents: Record<string, AgentRecord>;
  /** papéis objetivos materializados em <cwd>/.pi/agents/ (F32 D1/T5 —
   *  contentHash por papel; aditivo, schemaVersion permanece 1 — o
   *  materialize.ts valida em runtime; ausente = nada materializado). */
  piAgents?: Record<string, RoleAgentRecord>;
  /** execution guards config (F24 D2; aditivo, schemaVersion permanece 1 — o
   *  guardKit valida em runtime; ausente = defaults fail-closed). */
  guards?: GuardsConfig;
  /** verification cascade config (F25 D9; aditivo, schemaVersion permanece 1 —
   *  o config.ts valida em runtime; ausente = defaults fail-closed). */
  verification?: VerificationConfig;
  /** resilience & continuity config (F27 D9; aditivo, schemaVersion permanece 1 —
   *  o config.ts valida em runtime; ausente = defaults do fork glla). */
  resilience?: ResilienceConfig;
  /** observability & lessons config (F28 D9; aditivo, schemaVersion permanece 1 —
   *  o config.ts valida em runtime; ausente = defaults). */
  observability?: ObservabilityConfig;
  /** memory config (F29 D5; aditivo, schemaVersion permanece 1 — o config.ts
   *  valida em runtime; ausente = defaults). */
  memory?: MemoryConfig;
  /** model routing config (F30 D5; aditivo, schemaVersion permanece 1 — o
   *  config.ts valida em runtime; ausente = defaults). */
  models?: ModelsConfig;
  /** persona config (F30 D5; aditivo, schemaVersion permanece 1 — o
   *  config.ts valida em runtime; ausente = defaults). */
  persona?: PersonaConfig;
}

export const STATE_SCHEMA_VERSION = 1 as const;

export function emptyState(scope: Scope): HarnessState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    scope,
    components: {},
    createdFiles: [],
    settingsChanges: [],
    preInstall: [],
    agents: {},
    piAgents: {},
    // F24: fail-closed por padrão — o estado declara os guards LIGADOS (D10).
    guards: defaultGuardsConfig(),
    // F25: fail-closed por padrão — o estado declara a cascata de verificação LIGADA (D9).
    verification: defaultVerificationConfig(),
    // F27: fail-closed por padrão — o estado declara a camada de resiliência LIGADA (D9).
    resilience: defaultResilienceConfig(),
    // F28: fail-closed por padrão — o estado declara a camada de observabilidade LIGADA (D9).
    observability: defaultObservabilityConfig(),
    // F29: fail-closed por padrão — o estado declara a camada de memória LIGADA (D5).
    memory: defaultMemoryConfig(),
    // F30: fail-closed por padrão — o estado declara o roteamento de modelos LIGADO (D5).
    models: defaultModelsConfig(),
    // F30: fail-closed por padrão — o estado declara a camada de persona LIGADA (D5).
    persona: defaultPersonaConfig(),
  };
}

export interface LoadResult {
  state: HarnessState;
  /** true when the file did not exist (caller may set installedAt). */
  created: boolean;
  /** previous path when the file was corrupt and moved aside. */
  corruptPath?: string;
}

/**
 * Parses state.json without side effects; null when missing or unreadable/corrupt.
 * Unknown top-level keys are preserved (additive migration, AD-013): future
 * sections (F17 `agents`) survive a load→save round-trip with schemaVersion 1.
 */
function parseState(file: string, scope: Scope): HarnessState | null {
  if (!fs.existsSync(file)) return null;
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION) return null;
  if (typeof raw.components !== "object" || raw.components === null) return null;
  return {
    // Keep every key of the on-disk state, then normalize the known ones — an
    // additive round-trip never drops sections this version does not know yet.
    ...raw,
    schemaVersion: STATE_SCHEMA_VERSION,
    scope: raw.scope === "global" || raw.scope === "workspace" ? raw.scope : scope,
    installedAt: typeof raw.installedAt === "string" ? raw.installedAt : undefined,
    components: raw.components as Record<string, InstalledEntry>,
    createdFiles: Array.isArray(raw.createdFiles) ? (raw.createdFiles as string[]) : [],
    settingsChanges: Array.isArray(raw.settingsChanges) ? (raw.settingsChanges as SettingsChange[]) : [],
    preInstall: Array.isArray(raw.preInstall) ? (raw.preInstall as PreInstallRecord[]) : [],
    agents: raw.agents && typeof raw.agents === "object" ? (raw.agents as Record<string, AgentRecord>) : {},
    piAgents: raw.piAgents && typeof raw.piAgents === "object" ? (raw.piAgents as Record<string, RoleAgentRecord>) : {},
  };
}

/**
 * Loads state.json. Missing → fresh state. Corrupt → the file is moved to
 * `<file>.corrupt-<ts>` (never clobbered) and a fresh state is returned.
 */
export function loadState(file: string, scope: Scope): LoadResult {
  if (!fs.existsSync(file)) return { state: emptyState(scope), created: true };
  const state = parseState(file, scope);
  if (state === null) {
    const corruptPath = moveCorruptAside(file);
    return { state: emptyState(scope), created: true, corruptPath };
  }
  return { state, created: false };
}

export type LoadReadonlyResult =
  | { ok: true; state: HarnessState; created: boolean }
  | { ok: false; reason: "corrupt"; file: string };

/**
 * Read-only variant of loadState (LIFE-01: doctor never modifies files).
 * Parses without moving the file aside; corrupt state is reported as
 * `{ok:false, reason:"corrupt"}` and left untouched for a later repair.
 */
export function loadStateReadonly(file: string, scope: Scope): LoadReadonlyResult {
  if (!fs.existsSync(file)) return { ok: true, state: emptyState(scope), created: true };
  const state = parseState(file, scope);
  if (state === null) return { ok: false, reason: "corrupt", file };
  return { ok: true, state, created: false };
}

function moveCorruptAside(file: string): string {
  const corruptPath = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, corruptPath);
  } catch {
    // Last resort: leave the corrupt file untouched and write nothing yet.
    return file;
  }
  return corruptPath;
}

/** Upsert a package entry (STBK-01): install/uninstall/sync touch only affected keys. */
export function upsertInstalled(
  state: HarnessState,
  entry: { name: string; group: string; source: string; version: string },
  installedAt = new Date().toISOString(),
): void {
  state.components[entry.name] = {
    group: entry.group,
    source: entry.source,
    version: entry.version,
    installedAt,
  };
}

/**
 * Upsert a settings change (SETM-03, F14): an entry for the same (file, path)
 * is replaced instead of duplicated — re-running the merge after the user
 * deleted a default-created key keeps the registry clean.
 */
export function upsertSettingsChange(state: HarnessState, change: SettingsChange): void {
  const index = state.settingsChanges.findIndex(
    (existing) =>
      existing.file === change.file &&
      existing.path.length === change.path.length &&
      existing.path.every((seg, i) => seg === change.path[i]),
  );
  if (index === -1) state.settingsChanges.push(change);
  else state.settingsChanges[index] = change;
}

/** Register (or replace) a managed agent record (F15; F17 D2). */
export function upsertAgent(state: HarnessState, agentId: string, record: AgentRecord): void {
  state.agents[agentId] = record;
}

/** Drop an agent record entirely (uninstall F15; F17 D2 cleanup). */
export function removeAgent(state: HarnessState, agentId: string): void {
  delete state.agents[agentId];
}

/** Atomic write: tmp + rename (STBK-03). Creates parent dirs. */
export function saveState(file: string, state: HarnessState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
