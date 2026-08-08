// resilience/config.ts — config do F27 (D9, RES-09).
//
// Thresholds de stall/backoff/escalação com DEFAULTS = valores do fork glla
// (provados em campo — atribuição por constante no código abaixo):
//   - HEARTBEAT_STALL_MS / WEDGE_ALERT_DEFAULT_MINUTES / PENDING_LATCH_STUCK_MS
//     / BACKOFF_HARD_CAP_MS / ERROR_RETRY_LADDER_MS → goal-loop-backoff.ts
//   - COMPACTION_GRACE_MS → loops/goal.ts
//   - REPETITION.{toolResultRepeat,similarityThreshold} → goal-loop-repetition.ts
//   - DEFAULT_STALL_ESCALATION_REFIRES → goal-loop-core.ts
// (fork é nosso — AD-001; upstream MIT — atribuição em docs/ROUTING.md seção
// Resilience; padrão F24/F25 de citar a fonte no código.)
//
// Padrão da casa (F24 guardKit / F25 verify config): seção `resilience`
// ADITIVA no state.json (F13, schemaVersion 1 — ao lado de `guards` e
// `verification`), freeze por sessão (D12 — lida no session_start, sem drift
// mid-turn) e kill switch `RUNECRAFT_RESILIENCE=0|false|off` (F20).
//
// Fail-closed por módulo (F24 D10): config inválida → o módulo afetado opera
// com defaults seguros + problema reportado (doctor); a política de escalação
// inválida cai em stop-all (parar é o lado seguro — nada segue em silêncio
// com um contrato quebrado).
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, statePath, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";
import { ESCALATION_POLICIES, type EscalationPolicy } from "./types.ts";

// =================================================================
// Defaults do fork glla (atribuição por constante — fonte citada).
// =================================================================

/** goal-loop-backoff.ts: HEARTBEAT_STALL_MS — silêncio de sessão OCIOSA que
 *  dispara o refire do heartbeat (padrão v0.5.0 do fork). */
export const DEFAULT_HEARTBEAT_STALL_MS = 60_000;
/** goal-loop-backoff.ts: WEDGE_ALERT_DEFAULT_MINUTES (v0.23.3: 45 → 30 —
 *  alerta é notification-only; falso-positivo custa 1 notificação, falso-
 *  negativo custa horas). Sessão OCUPADA + silêncio > limiar = comando preso. */
export const DEFAULT_WEDGE_ALERT_MINUTES = 30;
/** goal-loop-backoff.ts: PENDING_LATCH_STUCK_MS — idle + pending + silêncio
 *  (a continução foi aceita mas o turn trigger caiu — falha pós-compactação). */
export const DEFAULT_PENDING_LATCH_STUCK_MS = 3 * 60_000;
/** loops/goal.ts: COMPACTION_GRACE_MS — maquinário de stall quieto por 3min
 *  após compactação (a sessão substituída precisa assentar). */
export const DEFAULT_COMPACTION_GRACE_MS = 3 * 60_000;
/** goal-loop-core.ts: DEFAULT_STALL_ESCALATION_REFIRES — refires consecutivos
 *  sem turno real antes do supervisor parar ruidosamente (0 = nunca). */
export const DEFAULT_STALL_ESCALATION_REFIRES = 5;
/** goal-loop-backoff.ts: BACKOFF_HARD_CAP_MS — teto duro do backoff. */
export const DEFAULT_BACKOFF_HARD_CAP_MS = 5 * 60_000;
/** goal-loop-backoff.ts: ERROR_RETRY_LADDER_MS (v0.28.25) — cadência de
 *  retry entre erros de provider (5s→3m; orçamento de 5 retries ~5.5m). */
export const DEFAULT_ERROR_RETRY_LADDER_MS = [5_000, 15_000, 45_000, 90_000, 180_000] as const;
/** goal-loop-repetition.ts: REPETITION.toolResultRepeat — últimos N resultados
 *  idênticos de tool (mesma tool + output igual) = sem informação nova. */
export const DEFAULT_REPETITION_THRESHOLD = 3;
/** goal-loop-repetition.ts: REPETITION.similarityThreshold — Jaccard ≥ 0.8
 *  entre outputs consecutivos = near-duplicate. */
export const DEFAULT_IDENTICAL_OUTPUT_SIMILARITY = 0.8;
/** goal-loop-backoff.ts: HEARTBEAT_MAX_NUDGES — nudges sem tool call. */
export const DEFAULT_MAX_NUDGES = 3;
/** goal-loop-repetition.ts: REPETITION.windowRepeat — mesma fingerprint N
 *  vezes na janela rolante = repetição alternada (A-B-A-B). */
export const DEFAULT_WINDOW_REPEAT = 3;

// =================================================================
// Config tipada + defaults
// =================================================================

export interface StallThresholdsConfig {
  /** mesma tool + args normalizados N vezes seguidas → stall:repetition. */
  repetitionThreshold: number;
  /** Jaccard ≥ 0.8 entre outputs consecutivos → stall:identical-output. */
  identicalOutputSimilarity: number;
  /** sessão ocupada + silêncio (minutos) → stall:wedge. */
  wedgeAlertMinutes: number;
  /** sessão ociosa sem progresso (ms) → stall:heartbeat (refire). */
  heartbeatStallMs: number;
  /** idle + pending + silêncio (ms) → stall:pending-latch. */
  pendingLatchStuckMs: number;
  /** quietude pós-compactação (ms) — suppression herdada do fork. */
  postCompactionGraceMs: number;
  /** refires consecutivos antes da escalação parar ruidosamente. */
  stallEscalationRefires: number;
  /** janela de ferramentas do detector de repetição (REPETITION.toolWindow). */
  toolWindow: number;
  /** janela de outputs (REPETITION.textWindow). */
  textWindow: number;
}

export interface BackoffConfig {
  hardCapMs: number;
  errorRetryLadderMs: number[];
}

export interface EscalationConfig {
  /** política de escalação quando a cadeia esgota (D6). */
  policy: EscalationPolicy;
  /** orçamento de escalação (padrão CostLedger F25) — ações de escalada
   *  (re-inject/pause/halt/modelSwitch) contam; esgotado → HALT (stop-all)
   *  ou SKIP registrado (skip-and-continue). */
  maxEscalations: number;
}

/** Config aditiva `resilience` (D9) — defaults = valores do fork glla. */
export interface ResilienceConfig {
  /** camada ativa em sessões gerenciadas (default true — fail-closed). */
  enabled: boolean;
  stall: StallThresholdsConfig;
  backoff: BackoffConfig;
  escalation: EscalationConfig;
}

/** Defaults calibrados (valores do fork glla — ver atribuição acima). */
export function defaultResilienceConfig(): ResilienceConfig {
  return {
    enabled: true,
    stall: {
      repetitionThreshold: DEFAULT_REPETITION_THRESHOLD,
      identicalOutputSimilarity: DEFAULT_IDENTICAL_OUTPUT_SIMILARITY,
      wedgeAlertMinutes: DEFAULT_WEDGE_ALERT_MINUTES,
      heartbeatStallMs: DEFAULT_HEARTBEAT_STALL_MS,
      pendingLatchStuckMs: DEFAULT_PENDING_LATCH_STUCK_MS,
      postCompactionGraceMs: DEFAULT_COMPACTION_GRACE_MS,
      stallEscalationRefires: DEFAULT_STALL_ESCALATION_REFIRES,
      toolWindow: 6,
      textWindow: 3,
    },
    backoff: {
      hardCapMs: DEFAULT_BACKOFF_HARD_CAP_MS,
      errorRetryLadderMs: [...DEFAULT_ERROR_RETRY_LADDER_MS],
    },
    escalation: {
      policy: "stop-all",
      maxEscalations: 3,
    },
  };
}

export interface ConfigValidation {
  ok: boolean;
  config?: ResilienceConfig;
  /** motivos estáveis (campo + problema) — normalização F21 D10. */
  errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_RESILIENCE=0|false|off` (case-insensitive). */
export function resilienceKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
  const raw = env.RUNECRAFT_RESILIENCE?.trim();
  if (raw === undefined || raw === "") return { active: false, value: null };
  const normalized = raw.toLowerCase();
  return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function numberField(
  value: unknown,
  field: string,
  errors: string[],
  opts: { min?: number; max?: number; int?: boolean } = {},
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field}: esperado number, encontrado ${Array.isArray(value) ? "array" : typeof value}`);
    return undefined;
  }
  if (opts.int && !Number.isInteger(value)) {
    errors.push(`${field}: esperado inteiro, encontrado ${value}`);
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    errors.push(`${field}: esperado >= ${opts.min}, encontrado ${value}`);
    return undefined;
  }
  if (opts.max !== undefined && value > opts.max) {
    errors.push(`${field}: esperado <= ${opts.max}, encontrado ${value}`);
    return undefined;
  }
  return value;
}

function numberArrayField(value: unknown, field: string, errors: string[]): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) {
    errors.push(`${field}: esperado number[] não-negativo, encontrado ${Array.isArray(value) ? "array com tipo errado" : typeof value}`);
    return undefined;
  }
  return value;
}

function policyField(value: unknown, errors: string[]): EscalationPolicy | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(ESCALATION_POLICIES as readonly string[]).includes(value)) {
    errors.push(`resilience.escalation.policy: política desconhecida "${String(value)}" (esperado stop-all|skip-and-continue)`);
    return undefined;
  }
  return value as EscalationPolicy;
}

/**
 * Validação determinística da config bruta (D9). Inválida → fail-closed por
 * módulo (F24 D10): os campos inválidos caem no default seguro e o problema
 * é reportado; a política de escalação inválida vira stop-all (nada segue em
 * silêncio com contrato quebrado).
 */
export function validateResilienceConfig(raw: unknown): ConfigValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, config: defaultResilienceConfig(), errors: [] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`resilience: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
  }
  const errors: string[] = [];
  const cfg = defaultResilienceConfig();

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") errors.push("resilience.enabled: esperado boolean");
    else cfg.enabled = raw.enabled;
  }

  const stall = raw.stall;
  if (stall !== undefined) {
    if (!isPlainObject(stall)) {
      errors.push("resilience.stall: esperado objeto");
    } else {
      const repetitionThreshold = numberField(stall.repetitionThreshold, "resilience.stall.repetitionThreshold", errors, { min: 1, int: true });
      const identicalOutputSimilarity = numberField(stall.identicalOutputSimilarity, "resilience.stall.identicalOutputSimilarity", errors, { min: 0, max: 1 });
      const wedgeAlertMinutes = numberField(stall.wedgeAlertMinutes, "resilience.stall.wedgeAlertMinutes", errors, { min: 0, int: true });
      const heartbeatStallMs = numberField(stall.heartbeatStallMs, "resilience.stall.heartbeatStallMs", errors, { min: 0, int: true });
      const pendingLatchStuckMs = numberField(stall.pendingLatchStuckMs, "resilience.stall.pendingLatchStuckMs", errors, { min: 0, int: true });
      const postCompactionGraceMs = numberField(stall.postCompactionGraceMs, "resilience.stall.postCompactionGraceMs", errors, { min: 0, int: true });
      const stallEscalationRefires = numberField(stall.stallEscalationRefires, "resilience.stall.stallEscalationRefires", errors, { min: 0, int: true });
      const toolWindow = numberField(stall.toolWindow, "resilience.stall.toolWindow", errors, { min: 1, int: true });
      const textWindow = numberField(stall.textWindow, "resilience.stall.textWindow", errors, { min: 1, int: true });
      if (repetitionThreshold !== undefined) cfg.stall.repetitionThreshold = repetitionThreshold;
      if (identicalOutputSimilarity !== undefined) cfg.stall.identicalOutputSimilarity = identicalOutputSimilarity;
      if (wedgeAlertMinutes !== undefined) cfg.stall.wedgeAlertMinutes = wedgeAlertMinutes;
      if (heartbeatStallMs !== undefined) cfg.stall.heartbeatStallMs = heartbeatStallMs;
      if (pendingLatchStuckMs !== undefined) cfg.stall.pendingLatchStuckMs = pendingLatchStuckMs;
      if (postCompactionGraceMs !== undefined) cfg.stall.postCompactionGraceMs = postCompactionGraceMs;
      if (stallEscalationRefires !== undefined) cfg.stall.stallEscalationRefires = stallEscalationRefires;
      if (toolWindow !== undefined) cfg.stall.toolWindow = toolWindow;
      if (textWindow !== undefined) cfg.stall.textWindow = textWindow;
    }
  }

  const backoff = raw.backoff;
  if (backoff !== undefined) {
    if (!isPlainObject(backoff)) {
      errors.push("resilience.backoff: esperado objeto");
    } else {
      const hardCapMs = numberField(backoff.hardCapMs, "resilience.backoff.hardCapMs", errors, { min: 1, int: true });
      const errorRetryLadderMs = numberArrayField(backoff.errorRetryLadderMs, "resilience.backoff.errorRetryLadderMs", errors);
      if (hardCapMs !== undefined) cfg.backoff.hardCapMs = hardCapMs;
      if (errorRetryLadderMs !== undefined) cfg.backoff.errorRetryLadderMs = errorRetryLadderMs;
    }
  }

  const escalation = raw.escalation;
  if (escalation !== undefined) {
    if (!isPlainObject(escalation)) {
      errors.push("resilience.escalation: esperado objeto");
    } else {
      const policy = policyField(escalation.policy, errors);
      const maxEscalations = numberField(escalation.maxEscalations, "resilience.escalation.maxEscalations", errors, { min: 1, int: true });
      // Fail-closed: política inválida/ausente → stop-all (parar é o lado seguro).
      cfg.escalation.policy = policy ?? "stop-all";
      if (maxEscalations !== undefined) cfg.escalation.maxEscalations = maxEscalations;
    }
  }

  if (errors.length > 0) return { ok: false, config: cfg, errors };
  return { ok: true, config: cfg, errors: [] };
}

export interface ResilienceStateRead {
  /** config bruta da seção `resilience` (undefined quando ausente). */
  resilience: unknown;
  corrupt: boolean;
}

/** Leitura read-only da seção `resilience` de um state.json (F13; nunca escreve). */
export function readStateResilience(file: string, scope: Scope): ResilienceStateRead {
  if (!fs.existsSync(file)) return { resilience: undefined, corrupt: false };
  const loaded = loadStateReadonly(file, scope);
  if (!loaded.ok) return { resilience: undefined, corrupt: true };
  return { resilience: loaded.state.resilience, corrupt: false };
}

export interface SessionResilienceRuntime {
  killSwitch: boolean;
  killSwitchValue: string | null;
  /** config efetiva (defaults com overrides validados — fail-closed por módulo). */
  config: ResilienceConfig;
  /** problemas de config encontrados (workspace/global) — doctor reporta. */
  problems: string[];
  source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults seguros + problems. */
export function effectiveResilience(workspace: unknown, global: unknown, env: NodeJS.ProcessEnv): SessionResilienceRuntime {
  const kill = resilienceKillSwitch(env);
  const ws = isPlainObject(workspace) ? workspace : undefined;
  const gl = isPlainObject(global) ? global : undefined;
  const raw = ws ?? gl ?? undefined;
  const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
  const validation = validateResilienceConfig(raw);
  if (!validation.ok) {
    return {
      killSwitch: kill.active,
      killSwitchValue: kill.value,
      config: validation.config ?? defaultResilienceConfig(),
      problems: validation.errors,
      source,
    };
  }
  return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de resiliência para uma sessão (cwd + env). D12: congelada pelo caller. */
export function loadSessionResilience(cwd: string, env: NodeJS.ProcessEnv): SessionResilienceRuntime {
  const rt = resolveRuntime(cwd, env);
  const workspace = readStateResilience(statePath(rt, "workspace"), "workspace");
  const global = readStateResilience(statePath(rt, "global"), "global");
  const merged = effectiveResilience(workspace.resilience, global.resilience, env);
  if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de resiliência tratada como ausente (fail-closed)");
  if (global.corrupt) merged.problems.push("global: state.json corrompido — config de resiliência tratada como ausente (fail-closed)");
  return merged;
}

/** Congelamento por sessão (D12): captura no session_start; handlers usam o snapshot. */
export class SessionResilienceConfig {
  private snapshot: SessionResilienceRuntime | null = null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  capture(cwd: string): void {
    this.snapshot = loadSessionResilience(cwd, this.env);
  }

  /** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
  frozen(cwd: string): SessionResilienceRuntime {
    if (this.snapshot === null) this.capture(cwd);
    return this.snapshot as SessionResilienceRuntime;
  }
}

/** Path do log de eventos de resiliência da sessão (append-only — precedente
 *  do verify-verdicts.jsonl do F25 e do ledger do glla). */
export function resilienceEventsPath(cwd: string): string {
  return path.join(cwd, ".runecraft", "resilience-events.jsonl");
}

/** Path do arquivo de metadados de continuação (QA-1 — `.runecraft/continuation.json`). */
export function continuationMetaPath(cwd: string): string {
  return path.join(cwd, ".runecraft", "continuation.json");
}
