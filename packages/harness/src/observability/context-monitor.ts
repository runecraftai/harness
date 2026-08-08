// observability/context-monitor.ts — port do context-window-monitor do arcanum
// (D4, OBS-04) → action none|warn|recover (thresholds 0.8/0.95).
//
// `checkContextWindow` é PURO (port literal do hook OpenCode do guild,
// supersedido AD-001): mesmo input → mesma decisão (relógio/uso injetáveis —
// determinismo F21 D10). Fontes de sinal no Pi (QA-5a): `ctx.getContextUsage()`
// (ContextUsage {tokens, contextWindow, percent} — API tipada do SDK 0.81.0,
// validada no Execute) + leitura READ-ONLY do token-budget do taskflow
// (shape VERIFICADO em `.pi/taskflows/runs/token-budget/*.json`; NUNCA escreve
// em `.pi/`) + `shouldCompact` (puro, SDK) como checagem sob demanda.
import type { ContextAction } from "./types.ts";

export interface ContextWindowInput {
  /** tokens de contexto estimados (null = desconhecido — pós-compactação). */
  usedTokens: number | null;
  /** janela do modelo ativo (0/ausente → desconhecido). */
  maxTokens: number;
}

export interface ContextWindowThresholds {
  warningPct: number;
  criticalPct: number;
}

export interface ContextWindowDecision {
  action: ContextAction;
  /** uso percentual (null quando desconhecido). */
  usagePct: number | null;
  /** mensagem determinística (null quando none/desconhecido). */
  message: string | null;
}

/**
 * Port puro do checkContextWindow do arcanum (0.8 → warn, 0.95 → recover).
 * Desconhecido (tokens null ou maxTokens <= 0) → none sem mensagem.
 */
export function checkContextWindow(
  input: ContextWindowInput,
  thresholds: ContextWindowThresholds,
): ContextWindowDecision {
  if (input.usedTokens === null || input.maxTokens <= 0 || input.usedTokens < 0) {
    return { action: "none", usagePct: null, message: null };
  }
  const usagePct = input.maxTokens > 0 ? input.usedTokens / input.maxTokens : 0;
  if (usagePct >= thresholds.criticalPct) {
    return {
      action: "recover",
      usagePct,
      message: `context window at ${Math.round(usagePct * 100)}% — recover (compact or checkpoint)`,
    };
  }
  if (usagePct >= thresholds.warningPct) {
    return {
      action: "warn",
      usagePct,
      message: `context window at ${Math.round(usagePct * 100)}% — warn`,
    };
  }
  return { action: "none", usagePct, message: null };
}

// ---------------------------------------------------------------------------
// Bridge read-only: token-budget do taskflow (QA-5 — shape verificado)
// ---------------------------------------------------------------------------

export interface TokenBudgetPhaseUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** gauge point-in-time (NÃO aditivo — semântica do taskflow usage.ts). */
  contextTokens: number;
}

export interface TokenBudgetRun {
  runId: string;
  maxTokens: number | null;
  status: string | null;
  /** agregado across phases (contextTokens = último phase — gauge). */
  usage: TokenBudgetPhaseUsage;
}

/**
 * Parse de UM arquivo token-budget-<id>.json (shape real verificado:
 * {runId, def.budget.maxTokens, status, phases: {<id>: {usage: {...}}}} —
 * `phases` é OBJECT keyed por phase id no disco). Tolerante a variações
 * (array) sem fabricação: campos ausentes → defaults zero.
 */
export function parseTokenBudgetRun(raw: unknown): TokenBudgetRun | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.runId !== "string") return null;

  const def = p.def as Record<string, unknown> | undefined;
  const budget = def?.budget as Record<string, unknown> | undefined;
  const maxTokens = typeof budget?.maxTokens === "number" ? budget.maxTokens : null;

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
  let lastContextTokens = 0;
  const phasesRaw = p.phases;
  if (phasesRaw !== null && typeof phasesRaw === "object") {
    const phases: unknown[] = Array.isArray(phasesRaw)
      ? phasesRaw
      : Object.values(phasesRaw as Record<string, unknown>);
    for (const phase of phases) {
      if (phase === null || typeof phase !== "object") continue;
      const u = (phase as Record<string, unknown>).usage as Record<string, unknown> | undefined;
      if (u === null || typeof u !== "object") continue;
      usage.input += num(u.input);
      usage.output += num(u.output);
      usage.cacheRead += num(u.cacheRead);
      usage.cacheWrite += num(u.cacheWrite);
      usage.cost += num(u.cost);
      const ctx = num(u.contextTokens);
      if (ctx > 0) lastContextTokens = ctx;
    }
  }
  usage.contextTokens = lastContextTokens;

  return {
    runId: p.runId,
    maxTokens,
    status: typeof p.status === "string" ? p.status : null,
    usage,
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
