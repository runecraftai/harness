// observability/recorder.test.ts — session recorder (T3, D4, OBS-03).
//
// Port do SessionTracker/analytics do guild: agregados corretos de trace
// scriptado (3 tools + 1 delegação), determinismo (2 runs → mesma sequência
// de identidade), session:ended sem toolUsage → campos vazios (não
// undefined), delegação SÓ para `subagent`, durationMs/at = payload
// informacional (relógio fake — nunca entra no assert de identidade).
import { describe, expect, test } from "bun:test";
import { SessionRecorder, type RecorderSink } from "../../src/observability/session-recorder.ts";
import type { EventKind } from "../../src/observability/types.ts";

interface RecordedEvent {
  kind: EventKind;
  payload: Record<string, unknown>;
}

function runScriptedSession(nowStart: number, nowEnd: number): { events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const sink: RecorderSink = { append: (kind, payload) => events.push({ kind, payload }) };
  let clock = nowStart;
  const recorder = new SessionRecorder({
    sessionId: "s1",
    bundleShort: "abcdef012345",
    agentId: "main",
    model: "eval-model",
    bundleHash: "a".repeat(64),
    versions: { harness: "0.1.0", sdk: "0.81.0", forks: { "@runecraft/subagents": "0.37.2" } },
    gitHead: null,
    sink,
    now: () => clock,
  });
  recorder.startSession();
  recorder.trackToolCall("read", "hash-read-1");
  recorder.trackToolResult({ tool: "read", ok: true, durationMs: 10 });
  recorder.trackToolCall("write", "hash-write-1");
  recorder.trackToolResult({ tool: "write", ok: false, blocked: true, guardId: "writeExistingFile", reason: "write-existing-file-guard: write blocked — target already exists: README.md", durationMs: 5 });
  recorder.trackDelegation({ agent: "worker", toolCallId: "call_1", durationMs: 100 });
  recorder.trackTokenUsage({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5 });
  recorder.trackTokenUsage({ input: 20, output: 5, cacheRead: 0, cacheWrite: 0 }, 0);
  clock = nowEnd;
  recorder.endSession();
  return { events };
}

describe("recorder — agregados do trace scriptado (D4)", () => {
  test("sequência de kinds correta: started → tool:* → delegation → tokens → ended", () => {
    const { events } = runScriptedSession(1000, 2000);
    expect(events.map((e) => e.kind)).toEqual([
      "session:started",
      "tool:call",
      "tool:result",
      "tool:call",
      "tool:result",
      "delegation",
      "tokens:usage",
      "tokens:usage",
      "session:ended",
    ]);
    const ended = events.find((e) => e.kind === "session:ended")!.payload as Record<string, unknown>;
    expect(ended.durationMs).toBe(1000); // relógio fake — determinístico
    expect(ended.totalToolCalls).toBe(2);
    expect(ended.totalDelegations).toBe(1);
    expect(ended.toolUsage).toEqual([
      { tool: "read", count: 1 },
      { tool: "write", count: 1 },
    ]);
    expect(ended.delegations).toEqual([{ agent: "worker", count: 1 }]);
    expect(ended.tokenTotals).toEqual({ input: 120, output: 55, cacheRead: 10, cacheWrite: 5, totalMessages: 1 });
    expect(ended.agentId).toBe("main");
    expect(ended.model).toBe("eval-model");
    const header = events.find((e) => e.kind === "session:started")!.payload as Record<string, unknown>;
    expect(header.bundleHash).toBe("a".repeat(64));
    expect(header.versions).toEqual({ harness: "0.1.0", sdk: "0.81.0", forks: { "@runecraft/subagents": "0.37.2" } });
    // tool:call registra argsHash (NUNCA args crus).
    const toolCall = events.find((e) => e.kind === "tool:call")!.payload as Record<string, unknown>;
    expect(toolCall.argsHash).toBe("hash-read-1");
    expect(Object.keys(toolCall)).not.toContain("args");
    // tool:result com bloqueio expõe guardId/reason.
    const blocked = events.find((e) => e.kind === "tool:result" && e.payload.tool === "write")!.payload as Record<string, unknown>;
    expect(blocked.blocked).toBe(true);
    expect(blocked.guardId).toBe("writeExistingFile");
  });

  test("determinismo: 2 runs → mesma sequência de identidade (payload volátil excluído)", () => {
    const a = runScriptedSession(1000, 2000);
    const b = runScriptedSession(1000, 2000);
    const identity = (events: RecordedEvent[]) =>
      events.map((e) => ({
        kind: e.kind,
        seq: undefined, // seq é do store — aqui a ordem é a sequência
        keys: Object.keys(e.payload).sort(),
        argsHash: e.payload.argsHash ?? null,
        triggerSignature: e.payload.triggerSignature ?? null,
      }));
    expect(identity(a.events)).toEqual(identity(b.events));
  });

  test("session:ended sem tools/delegações → campos vazios (não undefined)", () => {
    const events: RecordedEvent[] = [];
    const sink: RecorderSink = { append: (kind, payload) => events.push({ kind, payload }) };
    const recorder = new SessionRecorder({
      sessionId: "s1",
      bundleShort: "abcdef012345",
      agentId: "main",
      model: null,
      bundleHash: "a".repeat(64),
      versions: { harness: "x", sdk: "y", forks: {} },
      gitHead: null,
      sink,
      now: () => 0,
    });
    recorder.startSession();
    recorder.endSession();
    const ended = events.find((e) => e.kind === "session:ended")!.payload as Record<string, unknown>;
    expect(ended.toolUsage).toEqual([]);
    expect(ended.delegations).toEqual([]);
    expect(ended.totalToolCalls).toBe(0);
    expect(ended.tokenTotals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalMessages: 0 });
  });

  test("startSession idempotente; endSession idempotente", () => {
    const events: RecordedEvent[] = [];
    const sink: RecorderSink = { append: (kind, payload) => events.push({ kind, payload }) };
    const recorder = new SessionRecorder({
      sessionId: "s1",
      bundleShort: "abcdef012345",
      agentId: "main",
      model: null,
      bundleHash: "a".repeat(64),
      versions: { harness: "x", sdk: "y", forks: {} },
      gitHead: null,
      sink,
      now: () => 0,
    });
    recorder.startSession();
    recorder.startSession(); // no-op
    recorder.endSession();
    recorder.endSession(); // no-op
    expect(events.filter((e) => e.kind === "session:started")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "session:ended")).toHaveLength(1);
  });
});
