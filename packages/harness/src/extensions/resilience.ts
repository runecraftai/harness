// src/extensions/resilience.ts — wiring Pi do F27 (D1/D2/D3/D4/D5/D6).
//
// Registra a camada de resiliência como extensão Pi. Cada handler é THIN —
// a decisão vive nos módulos puros de src/resilience/:
//
//   session_start           → freeze config (D12) + ownership de sessão
//                             (scoping D2) + trigger fallback honesto
//                             (QA-2: reason=resume|reload)
//   session_before_compact  → snapshot taskList (D3 — fonte: ledger)
//   session_compact         → marca compactedAt + grace (D1) + pending
//   before_agent_start      → buildContinuationPrompt → systemPrompt
//                             ENCADEADO (SDK types.d.ts ~790: "If multiple
//                             extensions return this, they are chained" —
//                             verificado no runner.js emitBeforeAgentStart:
//                             currentSystemPrompt é re-passado por extensão)
//   tool_call/tool_result/turn_end/agent_settled → observações reais do
//                             detector de stall (D4 — ctx.isIdle()/
//                             hasPendingMessages: types.d.ts 224/232)
//   tool_call (halt)        → HALT REAL (bloqueio — padrão F25) quando a
//                             política esgotou a escalação
//   /start-work             → resume explícito de restart (F1-4 seguro:
//                             injeção explícita, nunca automática em startup)
//
// Kill switch RUNECRAFT_RESILIENCE=0 → todos os handlers inertes (F20).
// Config inválida → fail-closed por módulo (F24 D10 — defaults seguros +
// problema reportado). Nada de console.log: logger dedicado em stderr
// (regra do guild) + log de eventos `.runecraft/resilience-events.jsonl`
// (append-only — precedente do verify-verdicts.jsonl do F25).
import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionCompactEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionResilienceConfig, resilienceEventsPath } from "../resilience/config.ts";
import {
  buildContinuationPrompt,
  deriveContinuationState,
  emptyContinuationMeta,
  isSessionScoped,
  isSupervisedGoal,
  readContinuationMeta,
  readGoalState,
  writeContinuationMeta,
} from "../resilience/continuation.ts";
import { captureTaskListSnapshot } from "../resilience/todo-preserver.ts";
import { argsHash, detectStall, textFingerprint, type StallTrace } from "../resilience/stall.ts";
import { classifyFailure } from "../resilience/classify.ts";
import { EscalationBudget, resolveFallbackAction } from "../resilience/fallback.ts";
import type { ContinuationMetaFile } from "../resilience/types.ts";

export interface ResilienceDeps {
  /** env override (testes) — default process.env. */
  env?: NodeJS.ProcessEnv;
  /** relógio injetável (determinismo — D4). */
  now?: () => number;
  /** sink de eventos (testes) — default resilienceEventsPath(cwd). */
  eventsFile?: (cwd: string) => string;
  /** identity de sessão injetável (testes) — default ctx.sessionManager.getSessionId(). */
  sessionId?: (ctx: ExtensionContext) => string | null;
}

/** Logger dedicado (regra do guild: sem console.log; stderr, não stdout). */
const log = {
  debug(message: string): void {
    if (process.env.RUNECRAFT_RESILIENCE_DEBUG === "1" || process.env.RUNECRAFT_RESILIENCE_DEBUG === "true") {
      process.stderr.write(`[runecraft:resilience] ${message}\n`);
    }
  },
  warn(message: string): void {
    process.stderr.write(`[runecraft:resilience] warn: ${message}\n`);
  },
};

/** Grava um evento no log da sessão (append-only, best-effort — nunca derruba o handler). */
function recordEvent(file: string, type: string, value: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ type, value, at: new Date().toISOString() })}\n`, "utf8");
  } catch {
    // best-effort — log nunca derruba o handler (padrão F25 recordSessionVerdict).
  }
}

/**
 * Registra a camada de resiliência no Pi. Carregado apenas em sessões
 * gerenciadas pelo harness (D8 — mecanismo H1/F6, validado no F21).
 */
export function installResilience(pi: ExtensionAPI, deps: ResilienceDeps = {}): void {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const sessionConfig = new SessionResilienceConfig(env);

  // Estado da sessão (um por processo de extensão).
  let continuationPending = false;
  let haltPending: { reason: string } | null = null;
  // Orçamento de escalação (padrão CostLedger F25): recalibrado no
  // session_start com o cap da config congelada (D12).
  let budget = new EscalationBudget(3);

  // Observações para o detector de stall (eventos REAIS do SDK — D4).
  const trace: StallTrace = {
    toolCalls: [],
    outputs: [],
    lastActivityAt: 0,
    session: { idle: true, pending: false },
    timerPending: false,
    consecutiveStalls: 0,
    lastWedgeAlertAt: 0,
    suppression: { auditInFlight: false, postCompactionGraceUntil: 0, extensionApiStale: false },
  };

  const sessionIdOf = (ctx: ExtensionContext): string | null => {
    if (deps.sessionId) return deps.sessionId(ctx);
    try {
      return ctx.sessionManager.getSessionId() ?? null;
    } catch {
      return null;
    }
  };

  const eventsFile = (cwd: string): string => (deps.eventsFile ? deps.eventsFile(cwd) : resilienceEventsPath(cwd));

  const readMeta = (cwd: string): ContinuationMetaFile => {
    const read = readContinuationMeta(cwd);
    return read.ok ? read.meta : emptyContinuationMeta();
  };

  /** Recalibra o orçamento de escalação na sessão (config congelada — D12). */
  const syncBudget = (cwd: string): void => {
    const frozen = sessionConfig.frozen(cwd);
    budget = new EscalationBudget(frozen.config.escalation.maxEscalations);
  };

  // ---------------------------------------------------------------
  // session_start — freeze config + ownership + trigger fallback (QA-2)
  // ---------------------------------------------------------------
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
    sessionConfig.capture(ctx.cwd);
    syncBudget(ctx.cwd);
    const frozen = sessionConfig.frozen(ctx.cwd);
    for (const problem of frozen.problems) log.warn(`config: ${problem}`);
    if (frozen.killSwitch || !frozen.config.enabled) return;

    const goalRead = readGoalState(ctx.cwd);
    if (!goalRead.ok) return;
    const state = deriveContinuationState(goalRead.goal, readMeta(ctx.cwd));
    if (state === null || !isSupervisedGoal(state)) return;

    // Ownership de sessão (scoping D2): a sessão que vê o goal ativo registra-se.
    const sessionId = sessionIdOf(ctx);
    if (sessionId === null) return;
    writeContinuationMeta(ctx.cwd, { ...readMeta(ctx.cwd), lastSessionId: sessionId });

    // Trigger fallback honesto (QA-2): `session_start reason=resume|reload` —
    // a recarga pós-compactação é documentada no módulo compaction do SDK
    // ("after compaction the session is reloaded"). startup/new/fork NÃO
    // disparam injeção automática (semântica atual do glla v0.28.21+ — hold;
    // e uma sessão nova compartilhando o agentDir não deve herdar a
    // continuação sem ação explícita — o /start-work cobre o resume de restart).
    if (event.reason === "resume" || event.reason === "reload") {
      continuationPending = true;
      recordEvent(eventsFile(ctx.cwd), "continuation_pending", { reason: event.reason });
      log.debug(`continuation pending (session_start reason=${event.reason})`);
    }
  });

  // ---------------------------------------------------------------
  // session_before_compact — snapshot (D3) + metadados (D1)
  // ---------------------------------------------------------------
  pi.on("session_before_compact", (event, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    const goalRead = readGoalState(ctx.cwd);
    if (!goalRead.ok || goalRead.goal === null) return;
    const meta = readMeta(ctx.cwd);
    const snapshot = captureTaskListSnapshot(goalRead.goal);
    writeContinuationMeta(ctx.cwd, { ...meta, taskListSnapshot: snapshot, compactedAt: new Date().toISOString() });
    recordEvent(eventsFile(ctx.cwd), "snapshot", { reason: event.reason, hasSnapshot: snapshot !== null });
    log.debug(`taskList snapshot captured (reason=${event.reason})`);
  });

  // ---------------------------------------------------------------
  // session_compact — grace pós-compactação (padrão glla) + pending
  // ---------------------------------------------------------------
  pi.on("session_compact", (event: SessionCompactEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    // Grace pós-compactação (D1 — COMPACTION_GRACE_MS do fork): o maquinário
    // de stall fica quieto enquanto a sessão substituída assenta.
    trace.suppression.postCompactionGraceUntil = now() + frozen.config.stall.postCompactionGraceMs;
    continuationPending = true;
    recordEvent(eventsFile(ctx.cwd), "compacted", { reason: event.reason });
    log.debug(`session compacted (reason=${event.reason}) — continuation pending`);
  });

  // ---------------------------------------------------------------
  // before_agent_start — continuação encadeada (D2/F2 — SUCCESS CRITERION 1)
  // ---------------------------------------------------------------
  pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: ExtensionContext): { systemPrompt?: string } | undefined => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return undefined;
    if (!continuationPending) return undefined;
    const goalRead = readGoalState(ctx.cwd);
    if (!goalRead.ok) return undefined;
    const meta = readMeta(ctx.cwd);
    const state = deriveContinuationState(goalRead.goal, meta);
    if (state === null) return undefined;
    // Scoping de sessão (D2 — AC4): sessão que não é a do goal → sem injeção.
    if (!isSessionScoped(state, sessionIdOf(ctx))) {
      log.debug("continuation skipped — session not scoped to the goal");
      return undefined;
    }
    const prompt = buildContinuationPrompt(state, path.basename(ctx.cwd));
    if (prompt === null) return undefined;
    continuationPending = false;
    writeContinuationMeta(ctx.cwd, { ...meta, continuationCount: meta.continuationCount + 1 });
    recordEvent(eventsFile(ctx.cwd), "continuation_injected", { marker: "runecraft:continuation", continuationCount: meta.continuationCount + 1 });
    log.debug("continuation injected (systemPrompt chained)");
    // ENCADEADO (não sobrescreve outras extensões): anexa ao systemPrompt
    // corrente — o runner passa o resultado de cada extensão para a próxima.
    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });

  // ---------------------------------------------------------------
  // Observações reais para o detector de stall (D4 — F4)
  // ---------------------------------------------------------------
  pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch) return undefined;
    const at = now();
    trace.toolCalls.push({ tool: event.toolName, argsHash: argsHash(event.input ?? {}), at });
    trace.lastActivityAt = at;
    trace.consecutiveStalls = 0; // atividade real reseta a escada (padrão do fork)
    // HALT REAL (F25 — bloqueio): a política esgotou a escalação → bloqueia
    // a próxima tool call com o reason (o único ponto com bloqueio real no Pi
    // 0.81.0 — validado no Execute F24: só tool_call bloqueia).
    if (haltPending !== null) {
      const reason = haltPending.reason;
      haltPending = null;
      log.warn(`halt: ${reason}`);
      return { block: true, reason };
    }
    return undefined;
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch) return;
    const at = now();
    trace.lastActivityAt = at;
    if (event.isError) {
      const text = Array.isArray(event.content)
        ? event.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
        : String(event.content ?? "");
      if (text.trim().length > 0) {
        const classification = classifyFailure({ error: text });
        if (classification.class !== "agent") {
          recordEvent(eventsFile(ctx.cwd), "tool_error", { tool: event.toolName, class: classification.class });
          log.debug(`tool_error class=${classification.class} (${event.toolName})`);
        }
      }
    }
  });

  pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch) return;
    const at = now();
    const text = extractMessageText(event.message);
    if (text.trim().length > 0) {
      trace.outputs.push({ fingerprint: textFingerprint(text), text, at });
    }
    if (event.toolResults !== undefined && event.toolResults.length > 0) {
      trace.lastActivityAt = at;
      trace.consecutiveStalls = 0;
    }
  });

  // ---------------------------------------------------------------
  // agent_settled — avaliação do detector + política (F4/F5/F6).
  // ---------------------------------------------------------------
  const applyStallAction = (kind: string, reason: string): void => {
    if (kind === "halt") {
      haltPending = { reason };
      return;
    }
    if (kind === "pause") {
      log.warn(`pause recomendado: ${reason}`);
      return;
    }
    if (kind === "modelSwitch") {
      log.debug(`modelSwitch NO-OP (fronteira F30): ${reason}`);
      return;
    }
    // retry / re-inject-continuation: a continuação é re-injetada no próximo
    // before_agent_start (mecanismo primário D2) — aqui apenas sinalizamos.
    log.debug(`stall action ${kind}: ${reason}`);
  };

  pi.on("agent_settled", (event: AgentSettledEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    const cfg = frozen.config;
    let idle = true;
    let pending = false;
    try {
      idle = ctx.isIdle();
      pending = ctx.hasPendingMessages();
    } catch {
      return; // ctx inválido — próxima avaliação (padrão do fork)
    }
    trace.session = { idle, pending };

    const goalRead = readGoalState(ctx.cwd);
    if (!goalRead.ok) return;
    const state = deriveContinuationState(goalRead.goal, readMeta(ctx.cwd));
    const supervising = state !== null && isSupervisedGoal(state);

    const signals = detectStall(trace, { now: now(), thresholds: cfg.stall, supervising });
    if (signals.length === 0) return;

    for (const signal of signals) {
      trace.consecutiveStalls += 1;
      recordEvent(eventsFile(ctx.cwd), `stall:${signal.type}`, { ...(signal.detail ?? {}) });
      log.warn(`stall:${signal.type} — ${signal.reason}`);

      const classification = classifyFailure({ stallSignals: [signal] });
      const decision = resolveFallbackAction({
        trigger: "stall",
        classification,
        policy: cfg.escalation.policy,
        escalation: cfg.escalation,
        stallEscalationRefires: cfg.stall.stallEscalationRefires,
        consecutiveStalls: trace.consecutiveStalls,
        budget,
      });
      recordEvent(eventsFile(ctx.cwd), "fallback", {
        trigger: "stall",
        action: decision.action?.kind ?? null,
        verdict: decision.verdict,
      });
      if (decision.action !== null) applyStallAction(decision.action.kind, decision.action.reason);
      else log.debug(`fallback skip (verdict=skip): ${decision.verdict}`);
    }
  });

  // ---------------------------------------------------------------
  // /start-work — resume explícito de restart (F1-4 seguro; design D2:
  //  "comando start-work (resume de goal/taskList do ledger → context
  //  injection)"; fallback honesto: injeção explícita, nunca automática).
  // ---------------------------------------------------------------
  pi.registerCommand("start-work", {
    description:
      "Retoma o goal ativo do ledger: injeta o prompt de continuação (goal, progresso, tarefas pendentes) na sessão atual.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const frozen = sessionConfig.frozen(ctx.cwd);
      if (frozen.killSwitch || !frozen.config.enabled) {
        ctx.ui.notify("resilience layer inactive (RUNECRAFT_RESILIENCE=0 or disabled)", "warning");
        return;
      }
      const goalRead = readGoalState(ctx.cwd);
      if (!goalRead.ok) {
        ctx.ui.notify("no goal ledger found — start a goal first (/goal start)", "warning");
        return;
      }
      const meta = readMeta(ctx.cwd);
      const state = deriveContinuationState(goalRead.goal, meta);
      if (state === null || !isSupervisedGoal(state)) {
        ctx.ui.notify("no active goal to resume", "warning");
        return;
      }
      const sessionId = sessionIdOf(ctx);
      if (sessionId !== null) {
        writeContinuationMeta(ctx.cwd, { ...meta, lastSessionId: sessionId });
      }
      const prompt = buildContinuationPrompt(state, path.basename(ctx.cwd));
      if (prompt === null) {
        ctx.ui.notify("active goal has no task list — nothing to resume", "warning");
        return;
      }
      writeContinuationMeta(ctx.cwd, { ...readMeta(ctx.cwd), continuationCount: readMeta(ctx.cwd).continuationCount + 1 });
      recordEvent(eventsFile(ctx.cwd), "start_work_injected", {});
      ctx.ui.notify("continuation prompt injected — resuming the active goal", "info");
      pi.sendUserMessage(prompt);
    },
  });
}

/** Texto de uma AgentMessage (content string ou array de text blocks). */
function extractMessageText(message: unknown): string {
  if (message === null || typeof message !== "object") return "";
  const m = message as { content?: unknown };
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((c) => {
        if (c !== null && typeof c === "object" && (c as { type?: unknown }).type === "text") {
          const t = (c as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/** Factory da extensão (convenção do SDK — jiti.import resolve o DEFAULT
 *  export; mesmo padrão do extensions/guards.ts do F24). */
export default function registerResilience(pi: ExtensionAPI): void {
  installResilience(pi);
}
