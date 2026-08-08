// observability/types.ts — schema do event store tipado do F28 (D1/D2, OBS-01/09).
//
// Discriminated union `EventRecord`: campos base {seq, kind, sessionId, bundle,
// prevHash, payload, runId?, source?} — identidade = (seq, kind, sessionId,
// bundle, argsHash, triggerSignature) — NUNCA timestamps (F21 D10); `at`
// (ISO wall-clock) existe SÓ no payload informacional.
//
// Este schema É o contrato cross-feature (OBS-09/D7): F24/F25/F27 conformam os
// kinds sem retrofit; `verification:started`/`verification:stage` são kinds
// CONTRATO (reservados — v1 não emite; F25 pode emitir no futuro sem
// replanejamento — ver docs/EVENTS.md).
//
// Zero parser: JSON.parse + shape check por kind (fail-soft — padrão ledger
// glla v0.28.6: linhas malformadas puladas). `source`: "sdk" (evento observado
// do SDK), "internal" (gerado pelo harness), "bridge" (materializado de sink
// externo no export — D7).
import type { LessonPriority, LessonTrack } from "./lessons-types.ts";

/** Kinds emitidos na v1 (D2). */
export const EVENT_KINDS = [
  "session:started",
  "session:ended",
  "bundle:changed",
  "context:usage",
  "tokens:usage",
  "tool:call",
  "tool:result",
  "delegation",
  "guard:blocked",
  "verification:verdict",
  "resilience:signal",
  "lesson:captured",
  "lesson:reincidence",
  "lesson:promoted",
  "adendo:injected",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Kinds CONTRATO (reservados — o schema do F28 é o contrato; v1 NÃO emite). */
export const RESERVED_EVENT_KINDS = ["verification:started", "verification:stage"] as const;
export type ReservedEventKind = (typeof RESERVED_EVENT_KINDS)[number];

export type EventSource = "sdk" | "internal" | "bridge";

/** Ação do context-window monitor (port do arcanum — 0.8/0.95). */
export type ContextAction = "none" | "warn" | "recover";

// ---------------------------------------------------------------------------
// Payloads (tipados por kind — D2)
// ---------------------------------------------------------------------------

export interface VersionsPayload {
  harness: string;
  sdk: string;
  forks: Record<string, string>;
}

/** Header da sessão (QA-1): bundleHash FULL (64 hex) só aqui; nos demais
 *  eventos o campo base `bundle` carrega o prefixo curto (12 hex). */
export interface SessionStartedPayload {
  bundleHash: string;
  agentId: string;
  model: string | null;
  /** FORA do hash (D3 — identidade de execução, não de variante). */
  gitHead: string | null;
  versions: VersionsPayload;
  at?: string;
}

/** Agregado de tool por nome (semântica analytics do guild). */
export interface ToolUsage {
  tool: string;
  count: number;
}

/** Agregado de delegação por agente (tool `subagent` — F2). */
export interface DelegationUsage {
  agent: string;
  count: number;
}

/** Totais acumulados de tokens (semântica TokenUsage do guild). */
export interface TokenTotals {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead: number;
  cacheWrite: number;
  totalMessages: number;
}

export interface SessionEndedPayload {
  durationMs: number;
  toolUsage: ToolUsage[];
  delegations: DelegationUsage[];
  totalToolCalls: number;
  totalDelegations: number;
  agentId: string;
  model: string | null;
  tokenTotals: TokenTotals;
  at?: string;
}

export interface BundleChangedPayload {
  bundleHash: string;
  at?: string;
}

export interface ContextUsagePayload {
  usedTokens: number | null;
  maxTokens: number;
  usagePct: number | null;
  action: ContextAction;
  /** sdk = ctx.getContextUsage(); bridge = token-budget do taskflow (read-only). */
  source: "sdk" | "bridge";
  at?: string;
}

export interface TokensUsagePayload {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead: number;
  cacheWrite: number;
  totalMessages: number;
  at?: string;
}

export interface ToolCallPayload {
  tool: string;
  /** sha256 normalizado (chaves ordenadas — F23) dos args; NUNCA args crus. */
  argsHash: string;
  at?: string;
}

export interface ToolResultPayload {
  tool: string;
  ok: boolean;
  /** bloqueio observado via tool_execution_end (F24/F25 — D7a). */
  blocked?: boolean;
  /** guardId que bloqueou (prefixo `<guardId>: msg` — formato F24 D3). */
  guardId?: string;
  reason?: string | null;
  durationMs: number;
  at?: string;
}

export interface DelegationPayload {
  agent: string;
  toolCallId: string;
  durationMs: number;
  at?: string;
}

export interface GuardBlockedPayload {
  guardId: string;
  tool: string;
  reason: string;
  at?: string;
}

export interface VerificationVerdictPayload {
  verifyId: string;
  status: string;
  layer: string | null;
  reason: string | null;
  suggestion: string | null;
  cost: unknown;
  at?: string;
}

export interface ResilienceSignalPayload {
  signal: string;
  detail: Record<string, unknown>;
  at?: string;
}

export interface LessonCapturedPayload {
  lessonId: string;
  triggerSignature: string;
  trigger: string;
  antiPattern: string;
  preferred: string;
  priority: LessonPriority;
  gate: string;
  track: LessonTrack;
  count: number;
  at?: string;
}

export interface LessonReincidencePayload {
  lessonId: string;
  triggerSignature: string;
  count: number;
  at?: string;
}

export interface LessonPromotedPayload {
  lessonId: string;
  triggerSignature: string;
  priority: LessonPriority;
  count: number;
  at?: string;
}

export interface AdendoInjectedPayload {
  track: LessonTrack;
  gate?: string;
  lessonIds: string[];
  /** sha256 do texto do adendo (16 hex) — determinismo (F21 D10). */
  textHash: string;
  at?: string;
}

export type EventPayload =
  | SessionStartedPayload
  | SessionEndedPayload
  | BundleChangedPayload
  | ContextUsagePayload
  | TokensUsagePayload
  | ToolCallPayload
  | ToolResultPayload
  | DelegationPayload
  | GuardBlockedPayload
  | VerificationVerdictPayload
  | ResilienceSignalPayload
  | LessonCapturedPayload
  | LessonReincidencePayload
  | LessonPromotedPayload
  | AdendoInjectedPayload;

// ---------------------------------------------------------------------------
// EventRecord — discriminated union (D2)
// ---------------------------------------------------------------------------

/** Campos base comuns a todo evento (D2). */
export interface EventBaseFields {
  /** int ≥ 0, monotônico por sessão — identidade + ordem (F21 D10). */
  seq: number;
  kind: EventKind;
  sessionId: string;
  /** prefixo curto do bundle (12 hex) da sessão — eventos antigos imutáveis. */
  bundle: string;
  /** sha256 da linha anterior (tamper-evident, D1); primeira linha = sha256(""). */
  prevHash: string;
  source?: EventSource;
  runId?: string;
  payload: EventPayload;
}

export type EventRecord = EventBaseFields;

// ---------------------------------------------------------------------------
// Bundle fingerprint (D3 — OBS-02)
// ---------------------------------------------------------------------------

/** Input canônico do bundle (D3): config sections + settings F14 + renderRules
 *  (F19 puro) + routingVersion + versões. `gitHead` NÃO entra (QA-2a). */
export interface BundleFingerprintInput {
  harnessVersion: string;
  sdkVersion: string;
  forks: Record<string, string>;
  /** sections do state F13: guards / verification / resilience / observability. */
  config: Record<string, unknown>;
  /** settings.json com os prefixos gerenciados do F14 (subagents/taskflow/modelRoles). */
  settings: Record<string, unknown>;
  /** texto de renderRules(agentId) (F19 puro — prompts + roteamento). */
  rules: string;
  routingVersion: string;
}

export interface BundleHash {
  /** sha256 hex completo (64) — header session:started. */
  full: string;
  /** prefixo curto (12 hex) — campo base `bundle` dos eventos. */
  short: string;
}

// Re-export dos tipos de lessons (evita ciclo types ↔ lessons).
export type { LessonPriority, LessonTrack };
