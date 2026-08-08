// guards/guardKit.ts — toolkit compartilhado dos execution guards (F24, D1/D2/D3/D12).
//
// Cada guard é uma decisão pura (evento fake → { block, reason } | undefined)
// registrada no registry (index.ts). Este módulo é dono de:
//   - tipos de config (D2: state.json aditivo `guards`, schemaVersion 1)
//   - defaults fail-closed (D10: guards ligados em sessões gerenciadas)
//   - kill switch por env `RUNECRAFT_GUARDS=0` (padrão F20)
//   - congelamento por sessão (D12: config lida no session_start, sem drift mid-turn)
//   - `block()` (D3: reason `<guardId>: <mensagem>`, nunca path absoluto/timestamp)
//   - logger dedicado (regra do guild: nada de console.log; stderr, não stdout)
//
// Isolamento por guard (D10): a validação de config é PER-GUARD — um guard com
// config inválida opera fail-closed (bloqueia, não libera) sem desligar os outros.
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, statePath, type Runtime, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";

export const GUARD_IDS = [
  "writeExistingFile",
  "rangerMdOnly",
  "todoDescriptionOverride",
  "todoContinuationEnforcer",
] as const;

export type GuardId = (typeof GUARD_IDS)[number];

/** Config de um guard no state.json (D2): `guards.<id> = { enabled, options? }`. */
export interface GuardEntry {
  enabled?: boolean;
  options?: Record<string, unknown>;
}

/** Seção `guards` do state.json — aditiva, schemaVersion permanece 1 (AD-013). */
export interface GuardsConfig {
  writeExistingFile?: GuardEntry;
  rangerMdOnly?: GuardEntry;
  todoDescriptionOverride?: GuardEntry;
  todoContinuationEnforcer?: GuardEntry;
}

/** Default fail-closed (D10): todos ligados; ranger v1 inerte (lista vazia — D5). */
export function defaultGuardsConfig(): GuardsConfig {
  return {
    writeExistingFile: { enabled: true },
    rangerMdOnly: { enabled: true, options: { mdOnlyAgents: [] } },
    todoDescriptionOverride: { enabled: true },
    todoContinuationEnforcer: { enabled: true },
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Estado efetivo de UM guard após validação (isolada — D10). */
export interface GuardRuntime {
  id: GuardId;
  /** config válida → enabled do state (default true); inválida → true (fail-closed). */
  enabled: boolean;
  /** shape da config válido (doctor reporta; inválida opera fail-closed). */
  valid: boolean;
  /** descrição do problema (config inválida). */
  error?: string;
  /** options tipadas (presentes apenas quando valid === true). */
  options: WriteOptions | RangerOptions | TodoOptions;
  /** de onde veio a config (diagnóstico status/doctor). */
  source: "workspace" | "global" | "default";
}

export interface WriteOptions {
  allow: string[];
  force: boolean;
}

export interface RangerOptions {
  mdOnlyAgents: string[];
}

export interface TodoOptions {
  // todo guards não têm options em v1 (D2: { enabled } apenas)
}

/** Config efetiva da sessão (D12): congelada no session_start. */
export interface SessionGuardsConfig {
  killSwitch: boolean;
  killSwitchValue: string | null;
  guards: Record<GuardId, GuardRuntime>;
  /** problemas de config encontrados (workspace/global) — reportados pelo doctor. */
  problems: string[];
}

/** Kill switch (F20): `RUNECRAFT_GUARDS=0|false|off` (case-insensitive) → guards inativos. */
export function killSwitchState(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
  const raw = env.RUNECRAFT_GUARDS?.trim();
  if (raw === undefined || raw === "") return { active: false, value: null };
  const normalized = raw.toLowerCase();
  return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function boolField(entry: GuardEntry, key: keyof GuardEntry & string): { ok: boolean; value: boolean; error?: string } {
  const v = entry[key];
  if (v === undefined) return { ok: true, value: true };
  if (typeof v !== "boolean") return { ok: false, value: true, error: `\`${key}\` esperado boolean, encontrado ${Array.isArray(v) ? "array" : typeof v}` };
  return { ok: true, value: v };
}

function stringArrayField(entry: GuardEntry, key: string): { ok: boolean; value: string[]; error?: string } {
  const options = entry.options;
  if (options === undefined) return { ok: true, value: [] };
  if (!isPlainObject(options)) {
    return { ok: false, value: [], error: `\`options\` esperado objeto, encontrado ${Array.isArray(options) ? "array" : typeof options}` };
  }
  const v = options[key];
  if (v === undefined) return { ok: true, value: [] };
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    return { ok: false, value: [], error: `\`options.${key}\` esperado string[], encontrado ${Array.isArray(v) ? "array com tipo errado" : typeof v}` };
  }
  return { ok: true, value: v };
}

/** options do write guard: `allow` (paths relativos) + `force` (libera tudo). */
function writeOptions(entry: GuardEntry): { ok: boolean; allow: string[]; force: boolean; error?: string } {
  const errors: string[] = [];
  let allow: string[] = [];
  let force = false;
  const options = entry.options;
  if (options !== undefined) {
    if (!isPlainObject(options)) {
      errors.push(`\`options\` esperado objeto, encontrado ${Array.isArray(options) ? "array" : typeof options}`);
    } else {
      if (options.allow !== undefined) {
        if (!Array.isArray(options.allow) || !options.allow.every((x) => typeof x === "string")) {
          errors.push(`\`options.allow\` esperado string[], encontrado ${Array.isArray(options.allow) ? "array com tipo errado" : typeof options.allow}`);
        } else {
          allow = options.allow;
        }
      }
      if (options.force !== undefined) {
        if (typeof options.force !== "boolean") {
          errors.push(`\`options.force\` esperado boolean, encontrado ${typeof options.force}`);
        } else {
          force = options.force;
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, allow, force, error: errors.join("; ") };
  return { ok: true, allow, force };
}

/** Validação isolada da entry de UM guard (D10). Inválida → fail-closed (enabled, sem options). */
export function validateGuardEntry(id: GuardId, entry: unknown): { runtime: GuardRuntime; error?: string } {
  if (!isPlainObject(entry)) {
    return {
      runtime: { id, enabled: true, valid: false, error: `entry esperada objeto, encontrado ${Array.isArray(entry) ? "array" : typeof entry}`, options: {} as TodoOptions, source: "default" },
      error: `\`${id}\`: entry esperada objeto, encontrado ${Array.isArray(entry) ? "array" : typeof entry}`,
    };
  }
  const typed = entry as GuardEntry;
  const enabled = boolField(typed, "enabled");
  const errors: string[] = [];
  if (!enabled.ok) errors.push(enabled.error!);

  if (id === "writeExistingFile") {
    const write = writeOptions(typed);
    if (!write.ok) errors.push(write.error!);
    if (errors.length > 0) {
      return {
        runtime: { id, enabled: true, valid: false, error: errors.join("; "), options: { allow: [], force: false }, source: "default" },
        error: `\`${id}\`: ${errors.join("; ")}`,
      };
    }
    return {
      runtime: { id, enabled: enabled.value, valid: true, options: { allow: write.allow, force: write.force }, source: "default" },
    };
  }

  if (id === "rangerMdOnly") {
    const agents = stringArrayField(typed, "mdOnlyAgents");
    if (!agents.ok) errors.push(agents.error!);
    if (errors.length > 0) {
      return {
        runtime: { id, enabled: true, valid: false, error: errors.join("; "), options: { mdOnlyAgents: [] }, source: "default" },
        error: `\`${id}\`: ${errors.join("; ")}`,
      };
    }
    return {
      runtime: { id, enabled: enabled.value, valid: true, options: { mdOnlyAgents: agents.value }, source: "default" },
    };
  }

  // todo guards: apenas { enabled } em v1.
  if (errors.length > 0) {
    return {
      runtime: { id, enabled: true, valid: false, error: errors.join("; "), options: {}, source: "default" },
      error: `\`${id}\`: ${errors.join("; ")}`,
    };
  }
  return { runtime: { id, enabled: enabled.value, valid: true, options: {}, source: "default" } };
}

/** Merge efetivo por guard: workspace > global > default (D12/D10). */
export function effectiveGuards(workspace: unknown, global: unknown, env: NodeJS.ProcessEnv): SessionGuardsConfig {
  const kill = killSwitchState(env);
  const problems: string[] = [];
  const guards = {} as Record<GuardId, GuardRuntime>;

  for (const id of GUARD_IDS) {
    const ws = isPlainObject(workspace) ? workspace[id] : undefined;
    const gl = isPlainObject(global) ? global[id] : undefined;
    const entry = ws ?? gl ?? defaultGuardsConfig()[id];
    const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
    const { runtime, error } = validateGuardEntry(id, entry);
    runtime.source = source;
    if (error) problems.push(`${source}: ${error}`);
    guards[id] = runtime;
  }

  return { killSwitch: kill.active, killSwitchValue: kill.value, guards, problems };
}

export interface StateGuardsRead {
  /** config bruta da seção `guards` (undefined quando ausente). */
  guards: unknown;
  /** state.json ilegível/corrompido → fail-closed (tratado como sem config). */
  corrupt: boolean;
}

/** Leitura read-only da seção `guards` de um state.json (F13; nunca escreve). */
export function readStateGuards(file: string, scope: Scope): StateGuardsRead {
  if (!fs.existsSync(file)) return { guards: undefined, corrupt: false };
  const loaded = loadStateReadonly(file, scope);
  if (!loaded.ok) return { guards: undefined, corrupt: true };
  return { guards: loaded.state.guards, corrupt: false };
}

/** Resolve a config efetiva de guards para uma sessão (cwd + env). D12: congelada pelo caller. */
export function loadSessionGuards(cwd: string, env: NodeJS.ProcessEnv): SessionGuardsConfig {
  const rt = resolveRuntime(cwd, env);
  const workspace = readStateGuards(statePath(rt, "workspace"), "workspace");
  const global = readStateGuards(statePath(rt, "global"), "global");
  const merged = effectiveGuards(workspace.guards, global.guards, env);
  if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de guards tratada como ausente (fail-closed)");
  if (global.corrupt) merged.problems.push("global: state.json corrompido — config de guards tratada como ausente (fail-closed)");
  return merged;
}

/** Congelamento por sessão (D12): captura no session_start; handlers usam o snapshot. */
export class SessionGuardConfig {
  private snapshot: SessionGuardsConfig | null = null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  capture(cwd: string): void {
    this.snapshot = loadSessionGuards(cwd, this.env);
  }

  /** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo — o
   *  session_start do bindExtensions já capturou; sem ele, o primeiro uso vale). */
  frozen(cwd: string): SessionGuardsConfig {
    if (this.snapshot === null) this.capture(cwd);
    return this.snapshot as SessionGuardsConfig;
  }
}

/** D3: prefixo do reason = nome kebab do guard (estável p/ a normalização do F21),
 *  NÃO o id camelCase da config (D2). O spec nomeia os guards como
 *  write-existing-file-guard / ranger-md-only / todo-description-override /
 *  todo-continuation-enforcer — é esse o prefixo que a LLM vê e que o F23 normaliza. */
export const GUARD_REASON_IDS: Record<GuardId, string> = {
  writeExistingFile: "write-existing-file-guard",
  rangerMdOnly: "ranger-md-only",
  todoDescriptionOverride: "todo-description-override",
  todoContinuationEnforcer: "todo-continuation-enforcer",
};

/** Bloqueio no shape exato do Pi (D3): reason `<guardId>: <mensagem>`. */
export function block(guardId: GuardId, message: string): { block: true; reason: string } {
  return { block: true, reason: `${GUARD_REASON_IDS[guardId]}: ${message}` };
}

/** Path do input relativo ao cwd para o reason (D3: nunca absoluto). */
export function relPath(cwd: string, inputPath: string): string {
  const joined = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
  const rel = path.relative(cwd, joined);
  if (rel === "") return ".";
  return rel.split(path.sep).join("/");
}

/** Logger dedicado (regra do guild: sem console.log). Nada sai para stdout da sessão. */
export const guardLog = {
  debug(message: string): void {
    if (process.env.RUNECRAFT_GUARDS_DEBUG === "1" || process.env.RUNECRAFT_GUARDS_DEBUG === "true") {
      process.stderr.write(`[runecraft:guards] ${message}\n`);
    }
  },
  warn(message: string): void {
    process.stderr.write(`[runecraft:guards] warn: ${message}\n`);
  },
};
