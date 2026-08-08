// resilience/stall.ts — stall detection PURO (D4, RES-04).
//
// Port dos padrões PROVADOS EM CAMPO do fork goal-loop-audit (fork é nosso —
// AD-001; upstream MIT — atribuição por função abaixo; os arquivos-fonte do
// fork são citados em cada port):
//   - heartbeat refire + escada de stall (consecutiveStalls/escalation) e
//     wedge alert (sessão OCUPADA + silêncio = comando pendurado) e pending-
//     latch watchdog (continuation aceita mas turn trigger caiu) e grace
//     pós-compactação e suppression audit-in-flight/extensionApiStale
//     → loops/goal.ts + goal-loop-backoff.ts;
//   - repetição/output idêntico (fingerprint sha256, Jaccard ≥ 0.8,
//     toolResultRepeat) → goal-loop-repetition.ts;
//   - backoff ladder (stuck/error/context, hard cap 5min) → goal-loop-backoff.ts.
//
// TUDO PURO: relógio e timestamps INJETÁVEIS (determinismo — 2 runs com o
// mesmo trace produzem os mesmos sinais; F21 D10 — sem path/timestamp no
// reason). A entrada observa eventos REAIS do SDK (tool_call/turn_end/
// agent_settled + ctx.isIdle()/hasPendingMessages() — API de contexto
// verificada no types.d.ts linhas 224/232).
import { createHash } from "node:crypto";
import type { StallSignal, StallSignalType } from "./types.ts";
import { DEFAULT_HEARTBEAT_STALL_MS, DEFAULT_MAX_NUDGES, DEFAULT_WEDGE_ALERT_MINUTES, type BackoffConfig, type StallThresholdsConfig } from "./config.ts";

// =================================================================
// Normalização / fingerprints (port de goal-loop-repetition.ts)
// =================================================================

/** Strip ANSI, colapsa whitespace, lowercase (canonical form — port de
 *  `normalizeForPrint` do goal-loop-repetition.ts). */
export function normalizeForPrint(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Fingerprint estável curto de um output (sha256 dos primeiros 4000 chars
 *  do canonical form, 16 hex — port de `textFingerprint`). */
export function textFingerprint(text: string): string {
  return createHash("sha256").update(normalizeForPrint(text).slice(0, 4000)).digest("hex").slice(0, 16);
}

/** Dígitos são voláteis (contadores/timestamps) — apagados para que
 *  "tente a porta 8081" ≈ "tente a porta 8082" (port de `canonical`). */
function canonical(text: string): string {
  return normalizeForPrint(text).replace(/\d+/g, "#");
}

function wordTrigrams(text: string): Set<string> {
  const words = canonical(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < 3) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + 3 <= words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Similaridade de Jaccard sobre trigramas de palavras: 0 = nada em comum,
 *  1 = mesmo conjunto (port de `trigramSimilarity` do goal-loop-repetition.ts). */
export function trigramSimilarity(a: string, b: string): number {
  const sa = wordTrigrams(a);
  const sb = wordTrigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/** Hash estável de args normalizados de tool (JSON com chaves ordenadas —
 *  determinístico em qualquer runtime). O detector de repetição compara
 *  tool+argsHash (mesma ferramenta com os MESMOS args normalizados). */
export function normalizeToolArgs(args: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = stable((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(stable(args ?? {}));
}

export function argsHash(args: unknown): string {
  return createHash("sha256").update(normalizeToolArgs(args)).digest("hex").slice(0, 16);
}

// =================================================================
// Ports dos predicados do fork (goal-loop-backoff.ts — mesmos shapes)
// =================================================================

export interface WedgeInput {
  supervising: boolean;
  /** sessão OCUPADA (mid-turn) — sessão ociosa e quieta é o heartbeat, não o wedge. */
  sessionBusy: boolean;
  silentMs: number;
  /** ms desde o último wedge alert (throttle — alerta no máx. 1x por limiar). */
  msSinceLastAlert: number;
  /** limiar em ms; 0 desliga o alerta. */
  thresholdMs: number;
}

/** Deve o wedge alert disparar agora? (port de `shouldWedgeAlert`). */
export function shouldWedgeAlert(input: WedgeInput): boolean {
  if (!input.supervising) return false;
  if (!input.sessionBusy) return false;
  if (input.thresholdMs <= 0) return false;
  if (input.silentMs < input.thresholdMs) return false;
  return input.msSinceLastAlert >= input.thresholdMs;
}

export interface HeartbeatInput {
  supervising: boolean;
  /** ctx.isIdle() && !ctx.hasPendingMessages() */
  sessionIdle: boolean;
  timerPending: boolean;
  msSinceActivity: number;
  stallMs?: number;
  /** refires consecutivos de stall — espaça os refires exponencialmente
   *  (1m, 2m, 4m, 8m cap — v0.28.25 do fork). */
  consecutiveStalls?: number;
}

/** Deve o heartbeat refazer o refire da continuação agora? (port de
 *  `shouldHeartbeatRefire` — inclui o espaçamento exponencial). */
export function shouldHeartbeatRefire(input: HeartbeatInput): boolean {
  if (!input.supervising) return false;
  if (!input.sessionIdle) return false;
  if (input.timerPending) return false;
  const stallMs = input.stallMs ?? DEFAULT_HEARTBEAT_STALL_MS;
  const scale = 2 ** Math.min(input.consecutiveStalls ?? 0, 3);
  return input.msSinceActivity >= stallMs * scale;
}

export interface PendingLatchInput {
  supervising: boolean;
  idle: boolean;
  pending: boolean;
  timerPending: boolean;
  silentMs: number;
  thresholdMs: number;
}

/** Deve o pending-latch watchdog contar um stall agora? (port de
 *  `shouldFirePendingLatchWatchdog` — nunca re-envia: a mensagem JÁ está
 *  na fila do pi; re-sends não destravam o trigger caído). */
export function shouldFirePendingLatchWatchdog(input: PendingLatchInput): boolean {
  if (!input.supervising) return false;
  if (!input.idle || !input.pending) return false;
  if (input.timerPending) return false;
  if (input.thresholdMs <= 0) return false;
  return input.silentMs >= input.thresholdMs;
}

// =================================================================
// Backoff ladder (port de goal-loop-backoff.ts)
// =================================================================

/** Backoff antes do próximo passo, baseado em iterações sem progresso.
 *  Modos: "stuck" (escada [0,30s,60s,120s,240s,5min]), "error" (5s→60s
 *  exponencial — separado do cap de stuck) e "context" (30s × n, cap 5min).
 *  Cap duro: 5min (BACKOFF_HARD_CAP_MS). */
export function backoffMs(stuckCount: number, mode: "stuck" | "error" | "context" = "stuck", backoff: BackoffConfig = { hardCapMs: 300_000 }): number {
  if (mode === "error") {
    // Fork (goal-loop-backoff.ts): BACKOFF_ERROR_BASE_MS * 2^(n-1), cap no
    // BACKOFF_ERROR_MAX_MS (60s) — separado do cap de stuck (5min).
    return Math.min(5_000 * 2 ** Math.max(0, stuckCount - 1), 60_000);
  }
  if (mode === "context") {
    return Math.min(30_000 * Math.max(1, stuckCount), backoff.hardCapMs);
  }
  const schedule = [0, 30_000, 60_000, 120_000, 240_000, backoff.hardCapMs];
  const idx = Math.max(0, Math.min(schedule.length - 1, stuckCount));
  return schedule[idx] ?? backoff.hardCapMs;
}

/** Deve pausar após o backoff? (stuck ≥ 5min OU ≥ 3 iterações ociosas —
 *  port de `shouldPauseAfterBackoff`). */
export function shouldPauseAfterBackoff(stuckElapsedMs: number, idleIterCount: number, hardCapMs = 300_000): boolean {
  if (stuckElapsedMs >= hardCapMs) return true;
  if (idleIterCount >= 3) return true;
  return false;
}

// =================================================================
// detectStall — orquestrador PURO (D4/F4)
// =================================================================

/** Trace de observações registradas pelo wiring da extensão (eventos reais
 *  do SDK: tool_call, turn_end outputs, agent_settled + ctx.isIdle/
 *  hasPendingMessages). Tudo com timestamps do relógio INJETÁVEL. */
export interface StallTrace {
  /** tool calls observadas, em ordem (tool_call events). */
  toolCalls: Array<{ tool: string; argsHash: string; at: number }>;
  /** outputs de assistant em ordem (turn_end) — fingerprint + texto canônico
   *  (para Jaccard). O runtime registra via `textFingerprint`/`normalizeForPrint`. */
  outputs: Array<{ fingerprint: string; text: string; at: number }>;
  /** último timestamp de atividade real (tool_call/turn_end com tool). */
  lastActivityAt: number;
  /** estado da sessão no momento da avaliação (agent_settled). */
  session: { idle: boolean; pending: boolean };
  /** um timer de continuação já está agendado? (não re-disparar). */
  timerPending: boolean;
  /** refires consecutivos de stall (contador do runtime — reset em atividade real). */
  consecutiveStalls: number;
  /** último wedge alert (throttle). */
  lastWedgeAlertAt: number;
  /** suppression herdada (padrões do fork — não reimplementados): audit em
   *  voo (completionAuditInFlight), grace pós-compactação e handle stale. */
  suppression: {
    auditInFlight: boolean;
    postCompactionGraceUntil: number;
    extensionApiStale: boolean;
  };
}

export interface StallDetectOptions {
  now: number;
  thresholds: StallThresholdsConfig;
  /** supervisionando? (goal ativo + autoContinue — predicado do fork). */
  supervising: boolean;
}

/** Monta um sinal determinístico (reason sem path/timestamp — F21 D10). */
function signal(type: StallSignalType, reason: string, at: number, extra: { tool?: string; argsHash?: string; detail?: Record<string, unknown> } = {}): StallSignal {
  return { type, reason, at, ...extra };
}

/**
 * Detecta sinais de stall no trace (PURO — determinístico). Ordem de
 * avaliação (F4): suppression primeiro (audit-in-flight/grace/stale →
 * ZERO sinais — padrão do fork), depois pending-latch, wedge, heartbeat e
 * repetição/output idêntico (janelas rolantes). `supervising` desliga tudo
 * quando não há goal supervisionável (stall machinery quieto).
 */
export function detectStall(trace: StallTrace, opts: StallDetectOptions): StallSignal[] {
  const out: StallSignal[] = [];
  if (!opts.supervising) return out;
  const { now, thresholds } = opts;

  // Suppression herdada (padrões do fork — loops/goal.ts): qualquer uma
  // ativa → maquinário quieto.
  if (trace.suppression.auditInFlight) return out;
  if (trace.suppression.extensionApiStale) return out;
  if (trace.suppression.postCompactionGraceUntil > now) return out;

  const silentMs = now - trace.lastActivityAt;
  const supervising = true;

  // Pending-latch watchdog (v0.26.5): idle + pending + silêncio ≥ limiar.
  if (
    shouldFirePendingLatchWatchdog({
      supervising,
      idle: trace.session.idle,
      pending: trace.session.pending,
      timerPending: trace.timerPending,
      silentMs,
      thresholdMs: thresholds.pendingLatchStuckMs,
    })
  ) {
    out.push(
      signal(
        "pending-latch",
        "a queued continuation never started its turn — pi's pending-message latch appears stuck (known post-compaction failure)",
        now,
        { detail: { silentMs } },
      ),
    );
    return out; // latch preso → não re-dispara refire (o re-send não destrava)
  }

  // Wedge alert (v0.23.2): sessão OCUPADA + silêncio ≥ limiar (comando preso).
  if (
    shouldWedgeAlert({
      supervising,
      sessionBusy: !trace.session.idle,
      silentMs,
      msSinceLastAlert: now - trace.lastWedgeAlertAt,
      thresholdMs: thresholds.wedgeAlertMinutes * 60_000,
    })
  ) {
    out.push(
      signal(
        "wedge",
        "session is busy but silent — likely a hung command holding the goal (test/build/dev server without a timeout)",
        now,
        { detail: { silentMs } },
      ),
    );
  }

  // Heartbeat refire (v0.5.0/v0.28.25): ociosa + sem progresso ≥ stallMs × 2^stalls.
  if (
    shouldHeartbeatRefire({
      supervising,
      sessionIdle: trace.session.idle && !trace.session.pending,
      timerPending: trace.timerPending,
      msSinceActivity: silentMs,
      stallMs: thresholds.heartbeatStallMs,
      consecutiveStalls: trace.consecutiveStalls,
    })
  ) {
    out.push(
      signal(
        "heartbeat",
        `session stalled while idle — re-firing continuation (stall ${trace.consecutiveStalls}/${thresholds.stallEscalationRefires})`,
        now,
        { detail: { silentMs, consecutiveStalls: trace.consecutiveStalls } },
      ),
    );
  }

  // Repetição de tool (REPETITION.toolResultRepeat): mesma tool + args
  // normalizados N vezes seguidas na janela (toolWindow).
  const toolWindow = trace.toolCalls.slice(-thresholds.toolWindow);
  if (toolWindow.length >= thresholds.repetitionThreshold) {
    const tail = toolWindow.slice(-thresholds.repetitionThreshold);
    const first = tail[0]!;
    if (tail.every((c) => c.tool === first.tool && c.argsHash === first.argsHash)) {
      out.push(
        signal(
          "repetition",
          `same tool called ${tail.length}x with identical normalized args — no new information (toolResultRepeat)`,
          now,
          { tool: first.tool, argsHash: first.argsHash, detail: { count: tail.length } },
        ),
      );
    }
  }

  // Output idêntico (REPETITION.similarityThreshold): últimos 2 outputs com
  // fingerprint igual OU Jaccard ≥ 0.8 → sem informação nova.
  const textWindow = trace.outputs.slice(-thresholds.textWindow);
  if (textWindow.length >= 2) {
    const prev = textWindow[textWindow.length - 2]!;
    const last = textWindow[textWindow.length - 1]!;
    const similarity = trigramSimilarity(prev.text, last.text);
    if (prev.fingerprint === last.fingerprint || similarity >= thresholds.identicalOutputSimilarity) {
      out.push(
        signal("identical-output", "identical or near-duplicate assistant output across turns — no new information (sha256 fingerprint / Jaccard)", now, {
          detail: { fingerprint: last.fingerprint, similarity: Number(similarity.toFixed(3)) },
        }),
      );
    }
  }

  return out;
}

/** Refire escalou? (port de `shouldEscalateStall` do goal-loop-core.ts:
 *  refires consecutivos ≥ limiar; 0 = nunca escalar). */
export function shouldEscalateStall(consecutiveStalls: number, threshold: number): boolean {
  return threshold > 0 && consecutiveStalls >= threshold;
}

/** Conta o turno para nudges (port de `accountTurnForNudges`): turno
 *  supervisionado sem tool call = nudge (sem progresso real). */
export function accountTurnForNudges(toolCalls: number, currentNudges: number): number {
  return toolCalls > 0 ? 0 : currentNudges + 1;
}

export { DEFAULT_HEARTBEAT_STALL_MS, DEFAULT_MAX_NUDGES, DEFAULT_WEDGE_ALERT_MINUTES };
