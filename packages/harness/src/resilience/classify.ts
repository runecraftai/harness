// resilience/classify.ts — classificação de falha agente-vs-infra (D5, RES-05).
//
// Classificador DETERMINÍSTICO (zero LLM — sem judge/env-gated): inputs
// (exit code, erro de tool, timeout — padrão AD-024 SIGTERM/SIGKILL,
// rate-limit/quota via `isQuotaError` do fork glla, sinais de stall,
// repetição) → `{ class: agent|infra|unknown, reason, suggestion }`.
//
// Reuso de padrões existentes (sem duplicação):
//   - `isQuotaError`/`parseQuotaError` do fork (extensions/quota-retry.ts —
//     reimplementação clean-room do regex/shape documentado; a semântica é a
//     mesma: /429|quota|rate.?limit|.../ + Retry-After, default 3600s);
//   - formato do reason/sugestão do F25 (`suggestions.ts` — formatReason).
//
// Mapa (D5): infra → retry/backoff/fallback · agent → re-inject/pause/halt ·
// unknown → fail-closed (HALT com reason — nada segue com contrato quebrado).
import type { FailureClassification, StallSignal } from "./types.ts";
import { formatReason, type ReasonParts } from "../verify/suggestions.ts";

/** Reason-id da camada de resiliência (prefixo estável — F21 D10). */
export const RESILIENCE_REASON_ID = "resilience" as const;

/** Match 429/quota/rate-limit/credit exhaustion (port da semântica de
 *  `isQuotaError` do fork glla — extensions/quota-retry.ts). */
export function isQuotaError(error: string | undefined): boolean {
  if (!error) return false;
  return /429|quota|rate.?limit|temporarily|credits?|key limit exceeded|insufficient.?balance|too many requests/i.test(error);
}

export interface QuotaInfo {
  retryAfterSec: number;
  fromUpstream: boolean;
}

/** Parse da janela de retry (port de `parseQuotaError` do fork): header
 *  `Retry-After: N`, prosa `retry after N seconds`/`retry in Nm`, default
 *  3600s quando não há hint. */
export function parseQuotaError(error: string, defaultRetryAfterSec = 3600): QuotaInfo {
  let m = error.match(/retry-after:\s*(\d+)/i);
  if (m) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec) && sec >= 0) return { retryAfterSec: sec, fromUpstream: true };
  }
  m = error.match(/retry (?:after|in)\s+(\d+)\s*(s|sec|seconds|m|min|minutes|h|hours?)/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    const mult = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
    if (Number.isFinite(n) && n >= 0) return { retryAfterSec: n * mult, fromUpstream: true };
  }
  return { retryAfterSec: defaultRetryAfterSec, fromUpstream: false };
}

/** Exit codes de infra (padrão AD-024 — processo morto/timeout pelo SO ou
 *  pelo GNU timeout): 124 = timeout, 137 = SIGKILL, 143 = SIGTERM. */
export function isInfraExitCode(exitCode: number): boolean {
  return exitCode === 124 || exitCode === 137 || exitCode === 143;
}

export interface FailureInput {
  /** exit code do comando (tool bash / script). */
  exitCode?: number;
  /** texto de erro da tool (stderr / mensagem). */
  error?: string;
  /** o comando excedeu o timeout (struct timeout do F25). */
  timedOut?: boolean;
  /** sinais de stall do detector (F4). */
  stallSignals?: StallSignal[];
  /** falhas repetidas consecutivas (mesmo erro N vezes). */
  repeatedFailures?: number;
}

export function classifyReason(parts: Omit<ReasonParts, "reasonId">): string {
  return formatReason({ reasonId: RESILIENCE_REASON_ID, ...parts });
}

/**
 * Classifica a falha (PURO — determinístico). Ordem das regras (a primeira
 * que casa ganha — D5):
 *  1. quota/rate-limit (isQuotaError) → infra + retry com Retry-After;
 *  2. timeout explícito ou exit code de infra (124/137/143) → infra;
 *  3. sinais de stall (qualquer um) → agent + re-inject/pause;
 *  4. falha repetida → agent (sem progresso);
 *  5. exit ≠ 0 sem outro sinal → agent (comando falhou — corrigir);
 *  6. sem evidência → unknown (fail-closed — HALT com reason).
 */
export function classifyFailure(input: FailureInput): FailureClassification {
  const error = input.error ?? "";

  if (isQuotaError(error)) {
    const quota = parseQuotaError(error);
    const hint = quota.fromUpstream ? `(Retry-After: ${quota.retryAfterSec}s)` : "(default 3600s)";
    const suggestion = "retry com backoff após a janela do upstream (fallback chain: retry; não re-execute o trabalho)";
    return {
      class: "infra",
      reason: classifyReason({ layer: "classify", motivo: `rate-limit/quota ${hint}`, suggestion }),
      suggestion,
    };
  }

  if (input.timedOut === true || (input.exitCode !== undefined && isInfraExitCode(input.exitCode))) {
    const suggestion = "retry com backoff (infra); verifique o ambiente antes de re-executar o trabalho";
    return {
      class: "infra",
      reason: classifyReason({
        layer: "classify",
        motivo: input.timedOut === true ? "timeout (comando excedeu o limite)" : `exit ${input.exitCode} (processo morto pelo SO — SIGKILL/SIGTERM/timeout)`,
        suggestion,
      }),
      suggestion,
    };
  }

  if (input.stallSignals !== undefined && input.stallSignals.length > 0) {
    const kinds = input.stallSignals.map((s) => s.type).join(",");
    const suggestion = "re-inject-continuation ou pause — o gatilho é stall (progresso parado), não erro de infra";
    return {
      class: "agent",
      reason: classifyReason({ layer: "classify", motivo: `stall detectado (${kinds}) — o agente parou de progredir`, suggestion }),
      suggestion,
    };
  }

  if (input.repeatedFailures !== undefined && input.repeatedFailures >= 3) {
    const suggestion = "re-inject-continuation com nova abordagem ou pause para decisão (não repetir o mesmo passo)";
    return {
      class: "agent",
      reason: classifyReason({ layer: "classify", motivo: `falha repetida (${input.repeatedFailures}x) — mesmo erro sem progresso`, suggestion }),
      suggestion,
    };
  }

  if (input.exitCode !== undefined && input.exitCode !== 0) {
    const suggestion = "corrija o comando/abordagem e re-tente (agente); se o ambiente estiver quebrado, pause e reporte";
    return {
      class: "agent",
      reason: classifyReason({ layer: "classify", motivo: `comando falhou (exit ${input.exitCode})`, suggestion }),
      suggestion,
    };
  }

  const suggestion = "fail-closed: HALT com reason — nada segue em silêncio com classificação indefinida";
  return {
    class: "unknown",
    reason: classifyReason({ layer: "classify", motivo: "falha sem evidência classificável (sem exit code, erro, timeout ou stall)", suggestion }),
    suggestion,
  };
}
