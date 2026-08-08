// observability/session-recorder.ts — port do SessionTracker/analytics do guild
// (D4, OBS-03) → eventos session:started/ended, tool:call/result, delegation,
// tokens:usage no store do F28.
//
// Semântica do `.guild/analytics/session-summaries.jsonl` (SessionSummary:
// sessionId, startedAt/endedAt, durationMs, toolUsage[], delegations[],
// totalToolCalls, totalDelegations, agentName, model, totalCost,
// tokenUsage{input/output/reasoning/cacheRead/cacheWrite/totalMessages}) —
// port SEMÂNTICO (o arcanum é supersedido, AD-001): o recorder acumula os
// agregados em memória e materializa session:started (header) + session:ended
// (agregados) no event store. Delegação = tool `subagent` (F2 — equivalente
// de task/call_guild_agent do guild); NUNCA toda tool.
//
// Determinismo (F21 D10): identidade = (seq, kind, bundle, argsHash,
// triggerSignature); durationMs/at = payload informacional (relógio injetável).
import type { EventKind } from "./types.ts";
import type { DelegationUsage, TokenTotals, ToolUsage } from "./types.ts";

/** Entrada de tokens acumulada (semântica TokenUsage do guild). */
export interface TokenUsageInput {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TrackToolResultInput {
  tool: string;
  ok: boolean;
  /** bloqueio observado (tool_execution_end — F24/F25). */
  blocked?: boolean;
  guardId?: string;
  reason?: string | null;
  durationMs: number;
}

export interface TrackDelegationInput {
  agent: string;
  toolCallId: string;
  durationMs: number;
}

/** Sink de eventos injetável (a extensão liga no store do F28). */
export interface RecorderSink {
  append(kind: EventKind, payload: Record<string, unknown>): void;
}

export interface SessionRecorderOptions {
  sessionId: string;
  /** prefixo curto do bundle (12 hex) — D3. */
  bundleShort: string;
  agentId: string;
  model: string | null;
  /** full hash do bundle (64 hex) — header session:started (QA-1). */
  bundleHash: string;
  versions: { harness: string; sdk: string; forks: Record<string, string> };
  gitHead: string | null;
  sink: RecorderSink;
  /** relógio injetável (epoch ms — determinismo em teste). */
  now?: () => number;
}

/**
 * Recorder de sessão (port do SessionTracker — D4). `startSession` é
 * idempotente (só o primeiro header vale — a sessão não re-abre).
 */
export class SessionRecorder {
  private readonly sessionId: string;
  /** prefixo curto do bundle (12 hex — D3) — acessível à extensão (store). */
  readonly bundleShort: string;
  private readonly agentId: string;
  private readonly model: string | null;
  private readonly bundleHash: string;
  private readonly versions: SessionRecorderOptions["versions"];
  private readonly gitHead: string | null;
  private readonly sink: RecorderSink;
  private readonly now: () => number;

  private started = false;
  private ended = false;
  private readonly startedAt: number;
  private readonly toolUsage = new Map<string, number>();
  private readonly delegations = new Map<string, number>();
  private totalToolCalls = 0;
  private totalDelegations = 0;
  private tokenTotals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalMessages: 0 };
  private toolResults = new Map<string, { ok: number; blocked: number }>();

  constructor(opts: SessionRecorderOptions) {
    this.sessionId = opts.sessionId;
    this.bundleShort = opts.bundleShort;
    this.agentId = opts.agentId;
    this.model = opts.model;
    this.bundleHash = opts.bundleHash;
    this.versions = opts.versions;
    this.gitHead = opts.gitHead;
    this.sink = opts.sink;
    this.now = opts.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** session:started (header — QA-1). Idempotente: segunda chamada é no-op. */
  startSession(): void {
    if (this.started) return;
    this.started = true;
    this.sink.append("session:started", {
      bundleHash: this.bundleHash,
      agentId: this.agentId,
      model: this.model,
      gitHead: this.gitHead,
      versions: this.versions,
    });
  }

  /** tool:call (argsHash sha256 normalizado — NUNCA args crus, D2/edge). */
  trackToolCall(tool: string, argsHash: string): void {
    this.totalToolCalls += 1;
    this.toolUsage.set(tool, (this.toolUsage.get(tool) ?? 0) + 1);
    this.sink.append("tool:call", { tool, argsHash });
  }

  /** tool:result (ok/blocked?/guardId?/reason?/durationMs — D4). */
  trackToolResult(input: TrackToolResultInput): void {
    const entry = this.toolResults.get(input.tool) ?? { ok: 0, blocked: 0 };
    if (input.ok) entry.ok += 1;
    if (input.blocked) entry.blocked += 1;
    this.toolResults.set(input.tool, entry);
    this.sink.append("tool:result", {
      tool: input.tool,
      ok: input.ok,
      ...(input.blocked !== undefined ? { blocked: input.blocked } : {}),
      ...(input.guardId !== undefined ? { guardId: input.guardId } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      durationMs: input.durationMs,
    });
  }

  /** delegação (tool `subagent` — F2; equivalente de task/call_guild_agent). */
  trackDelegation(input: TrackDelegationInput): void {
    this.totalDelegations += 1;
    this.delegations.set(input.agent, (this.delegations.get(input.agent) ?? 0) + 1);
    this.sink.append("delegation", {
      agent: input.agent,
      toolCallId: input.toolCallId,
      durationMs: input.durationMs,
    });
  }

  /** tokens acumulados (semântica analytics — trackTokenUsage). */
  trackTokenUsage(usage: TokenUsageInput, messagesDelta = 1): void {
    this.tokenTotals = {
      input: this.tokenTotals.input + usage.input,
      output: this.tokenTotals.output + usage.output,
      ...(usage.reasoning !== undefined
        ? { reasoning: (this.tokenTotals.reasoning ?? 0) + usage.reasoning }
        : {}),
      cacheRead: this.tokenTotals.cacheRead + usage.cacheRead,
      cacheWrite: this.tokenTotals.cacheWrite + usage.cacheWrite,
      totalMessages: this.tokenTotals.totalMessages + messagesDelta,
    };
    this.sink.append("tokens:usage", {
      input: this.tokenTotals.input,
      output: this.tokenTotals.output,
      ...(this.tokenTotals.reasoning !== undefined ? { reasoning: this.tokenTotals.reasoning } : {}),
      cacheRead: this.tokenTotals.cacheRead,
      cacheWrite: this.tokenTotals.cacheWrite,
      totalMessages: this.tokenTotals.totalMessages,
    });
  }

  /** session:ended com os agregados (D4 — toolUsage/delegations/tokenTotals). Idempotente. */
  endSession(): void {
    if (!this.started || this.ended) return;
    this.ended = true;
    const toolUsage: ToolUsage[] = [...this.toolUsage.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
    const delegations: DelegationUsage[] = [...this.delegations.entries()]
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
    this.sink.append("session:ended", {
      durationMs: this.now() - this.startedAt,
      toolUsage,
      delegations,
      totalToolCalls: this.totalToolCalls,
      totalDelegations: this.totalDelegations,
      agentId: this.agentId,
      model: this.model,
      tokenTotals: this.tokenTotals,
    });
  }
}
