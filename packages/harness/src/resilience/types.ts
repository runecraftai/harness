// resilience/types.ts — tipos do F27 Resilience & Continuity (D1/D2/D4/D5/D6).
//
// Camada de resiliência do harness (M7 — pilar 6 do doc do usuário): stall
// detection, classificação agente-vs-infra, fallback chain (mecanismo) e
// continuidade pós-compactação. Tipos sem imports externos novos (zero deps).
//
// Fronteira F30 (D6 — travada): `FallbackActionKind.modelSwitch` é INTERFACE;
// o F27 entrega o mecanismo + implementação NO-OP documentada. Este módulo
// NÃO toca model/env/modelRoles (domínio do F30).
export type CompactionPhase = "none" | "before" | "compacted";

/** Status de goal do fork glla (validado no Execute F24 — goal-loop-core.ts). */
export type GoalStatus = "active" | "auditing" | "complete" | "paused" | "aborted";

/** Task do ledger do glla (formato v1 — F24 todo-writer.ts). */
export interface ContinuationTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "complete" | string;
  subtasks?: ContinuationTask[];
}

/**
 * Estado de continuação do harness (D2, QA-1): o goal/taskList vive no ledger
 * do glla (fonte de verdade — F19/F24); os metadados do harness (work summary,
 * contadores, snapshot p/ preserver, scoping de sessão) vivem em
 * `.runecraft/continuation.json` (schema v1, escrita atômica — padrão F20).
 *
 * Invariante D7 (AD-024): `pending` é derivado SOMENTE do taskList ATUAL do
 * ledger — nunca de snapshot obsoleto de goal anterior (regressão do
 * phantom-block deadlock coberta por teste adversarial).
 */
export interface ContinuationState {
  goalId: string;
  objective: string;
  status: GoalStatus;
  autoContinue: boolean;
  /** taskList ATUAL do ledger (null quando o goal não tem — D7: sem fantasma). */
  taskList: ContinuationTask[] | null;
  completed: number;
  total: number;
  /** pendências derivadas do taskList atual (status !== "complete", recursivo). */
  pending: ContinuationTask[];
  /** metadados do harness (`.runecraft/continuation.json`). */
  workSummary: string | null;
  continuationCount: number;
  stallCount: number;
  /** scoping de sessão (D2 — work-continuation do arcanum): a sessão que
   *  "viu" o goal ativo por último. Sessão diferente → sem injeção. */
  lastSessionId: string | null;
}

/** Schema v1 do `.runecraft/continuation.json` (QA-1, D2). */
export interface ContinuationMetaFile {
  schemaVersion: 1;
  /** última sessão que supervisionou o goal ativo (scoping — D2). */
  lastSessionId: string | null;
  /** resumo de trabalho do harness (escrito pelo usuário/harness). */
  workSummary: string | null;
  /** contador de continuações injetadas (diagnóstico — stall do arcanum
   *  MAX_STALE_CONTINUATIONS precursor). */
  continuationCount: number;
  /** contador de sinais de stall observados. */
  stallCount: number;
  /** snapshot do taskList no último session_before_compact (preserver D3). */
  taskListSnapshot: ContinuationTask[] | null;
  /** ISO da última compactação observada (grace pós-compactação — D1). */
  compactedAt: string | null;
}

/** Tipos de sinal de stall (D4 — port dos padrões do fork glla). */
export const STALL_SIGNAL_TYPES = [
  "repetition",
  "identical-output",
  "wedge",
  "heartbeat",
  "pending-latch",
] as const;
export type StallSignalType = (typeof STALL_SIGNAL_TYPES)[number];

/** Sinal de stall determinístico (relógio injetável — 2 runs idênticos). */
export interface StallSignal {
  type: StallSignalType;
  /** razão estável (sem path absoluto/timestamp — F21 D10). */
  reason: string;
  tool?: string;
  argsHash?: string;
  detail?: Record<string, unknown>;
  /** valor do relógio na detecção (injetável). */
  at: number;
}

/** Classe de falha (D5): agente (comportamento) vs infra (ambiente) vs unknown. */
export type FailureClass = "agent" | "infra" | "unknown";

/** Classificação determinística de falha (D5) — zero LLM (sem judge/env-gated). */
export interface FailureClassification {
  class: FailureClass;
  /** motivo estável (formato suggestions.ts F25). */
  reason: string;
  /** sugestão acionável (formato suggestions.ts F25). */
  suggestion: string;
  detail?: Record<string, unknown>;
}

/** Gatilhos da fallback chain (D6 — "o gatilho importa tanto quanto a chain"). */
export const FALLBACK_TRIGGERS = ["rate-limit", "timeout", "stall", "repeated-failure", "error"] as const;
export type FallbackTrigger = (typeof FALLBACK_TRIGGERS)[number];

/** Política de escalação (D6): parar tudo vs pular-e-seguir (padrão F25). */
export const ESCALATION_POLICIES = ["stop-all", "skip-and-continue"] as const;
export type EscalationPolicy = (typeof ESCALATION_POLICIES)[number];

/** Ações da fallback chain (D6 — QA-3 recomendado): ações reais no F27 +
 *  `modelSwitch` como INTERFACE (F30 implementa a resolução real). */
export const FALLBACK_ACTION_KINDS = [
  "retry",
  "re-inject-continuation",
  "pause",
  "halt",
  "modelSwitch",
] as const;
export type FallbackActionKind = (typeof FALLBACK_ACTION_KINDS)[number];

export interface FallbackAction {
  kind: FallbackActionKind;
  /** razão estável (F21 D10). */
  reason: string;
  suggestion?: string;
  detail?: Record<string, unknown>;
  /** true quando a ação é a INTERFACE modelSwitch com implementação NO-OP no
   *  F27 (fronteira F30 — a engine registra e segue, nunca resolve modelo). */
  noop?: boolean;
}
