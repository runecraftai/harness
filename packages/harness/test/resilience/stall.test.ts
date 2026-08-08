// resilience/stall.test.ts — stall detector PURO (T5, RES-04/D4).
//
// Ports dos padrões do fork glla testados com traces scriptados + relógio
// FAKE (determinismo — 2 runs idênticos): repetition (mesma tool + args
// normalizados ≥ 3), identical-output (fingerprint sha256 / Jaccard ≥ 0.8),
// wedge (sessão ocupada + silêncio), heartbeat (ociosa sem progresso →
// refire com escada), pending-latch, backoff ladder (caps do fork) e
// suppression (audit-in-flight / grace pós-compactação / handle stale →
// ZERO sinais).
import { describe, expect, test } from "bun:test";
import {
  argsHash,
  backoffMs,
  detectStall,
  normalizeToolArgs,
  normalizeForPrint,
  shouldEscalateStall,
  shouldFirePendingLatchWatchdog,
  shouldHeartbeatRefire,
  shouldPauseAfterBackoff,
  shouldWedgeAlert,
  textFingerprint,
  trigramSimilarity,
  type StallTrace,
} from "../../src/resilience/stall.ts";
import { defaultResilienceConfig } from "../../src/resilience/config.ts";

const THRESHOLDS = defaultResilienceConfig().stall;

function baseTrace(overrides: Partial<StallTrace> = {}): StallTrace {
  return {
    toolCalls: [],
    outputs: [],
    lastActivityAt: 0,
    session: { idle: true, pending: false },
    timerPending: false,
    consecutiveStalls: 0,
    lastWedgeAlertAt: 0,
    suppression: { auditInFlight: false, postCompactionGraceUntil: 0, extensionApiStale: false },
    ...overrides,
  };
}

describe("normalização / fingerprints (port goal-loop-repetition.ts)", () => {
  test("normalizeForPrint: ANSI + whitespace + case", () => {
    expect(normalizeForPrint("  Hello\x1b[31m  World \x1b[0m ")).toBe("hello world");
  });

  test("textFingerprint: estável e determinístico", () => {
    expect(textFingerprint("same output text")).toBe(textFingerprint("same output text"));
    expect(textFingerprint("a")).not.toBe(textFingerprint("b"));
    expect(textFingerprint("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("normalizeToolArgs/argsHash: chaves ordenadas (determinístico em qualquer runtime)", () => {
    expect(normalizeToolArgs({ b: 1, a: [3, 2] })).toBe(normalizeToolArgs({ a: [3, 2], b: 1 }));
    expect(argsHash({ path: "x", content: "y" })).toBe(argsHash({ content: "y", path: "x" }));
  });

  test("trigramSimilarity: 0 = nada em comum, 1 = mesmo conjunto, dígitos voláteis apagados", () => {
    expect(trigramSimilarity("retry port 8081", "retry port 8082")).toBeGreaterThan(0.8);
    expect(trigramSimilarity("completely different text here", "totally unrelated words now")).toBeLessThan(0.5);
  });
});

describe("detectStall — repetition (AC1)", () => {
  test("mesma tool + args normalizados 3x seguidas → stall:repetition", () => {
    const hash = argsHash({ command: "echo hi" });
    const trace = baseTrace({
      toolCalls: [
        { tool: "bash", argsHash: hash, at: 1 },
        { tool: "bash", argsHash: hash, at: 2 },
        { tool: "bash", argsHash: hash, at: 3 },
      ],
      lastActivityAt: 3,
    });
    const signals = detectStall(trace, { now: 4, thresholds: THRESHOLDS, supervising: true });
    const rep = signals.find((s) => s.type === "repetition");
    expect(rep).toBeDefined();
    expect(rep!.tool).toBe("bash");
    expect(rep!.argsHash).toBe(hash);
  });

  test("2x apenas → sem sinal (limiar default 3 — toolResultRepeat)", () => {
    const hash = argsHash({ command: "echo hi" });
    const trace = baseTrace({
      toolCalls: [
        { tool: "bash", argsHash: hash, at: 1 },
        { tool: "bash", argsHash: hash, at: 2 },
      ],
    });
    expect(detectStall(trace, { now: 3, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });

  test("args DIFERENTES → sem sinal (mesma tool não é repetição)", () => {
    const trace = baseTrace({
      toolCalls: [
        { tool: "bash", argsHash: argsHash({ command: "a" }), at: 1 },
        { tool: "bash", argsHash: argsHash({ command: "b" }), at: 2 },
        { tool: "bash", argsHash: argsHash({ command: "c" }), at: 3 },
      ],
    });
    expect(detectStall(trace, { now: 4, thresholds: THRESHOLDS, supervising: true }).filter((s) => s.type === "repetition")).toEqual([]);
  });

  test("limiar configurável: repetitionThreshold=2 dispara com 2 chamadas", () => {
    const hash = argsHash({ command: "x" });
    const trace = baseTrace({
      toolCalls: [
        { tool: "read", argsHash: hash, at: 1 },
        { tool: "read", argsHash: hash, at: 2 },
      ],
    });
    const signals = detectStall(trace, { now: 3, thresholds: { ...THRESHOLDS, repetitionThreshold: 2 }, supervising: true });
    expect(signals.some((s) => s.type === "repetition")).toBe(true);
  });
});

describe("detectStall — identical-output (AC2)", () => {
  test("fingerprint igual entre outputs consecutivos → stall:identical-output", () => {
    const trace = baseTrace({
      outputs: [
        { fingerprint: textFingerprint("same reply"), text: "same reply", at: 1 },
        { fingerprint: textFingerprint("same reply"), text: "same reply", at: 2 },
      ],
    });
    const signals = detectStall(trace, { now: 3, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "identical-output")).toBe(true);
  });

  test("Jaccard ≥ 0.8 (near-duplicate com dígitos voláteis) → stall:identical-output", () => {
    const trace = baseTrace({
      outputs: [
        { fingerprint: textFingerprint("retry the build on port 8081"), text: "retry the build on port 8081", at: 1 },
        { fingerprint: textFingerprint("retry the build on port 8082"), text: "retry the build on port 8082", at: 2 },
      ],
    });
    const signals = detectStall(trace, { now: 3, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "identical-output")).toBe(true);
  });

  test("outputs distintos → sem sinal", () => {
    const trace = baseTrace({
      outputs: [
        { fingerprint: textFingerprint("first real analysis"), text: "first real analysis", at: 1 },
        { fingerprint: textFingerprint("second real analysis"), text: "second real analysis", at: 2 },
      ],
    });
    expect(detectStall(trace, { now: 3, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });
});

describe("detectStall — wedge + heartbeat + pending-latch (AC3)", () => {
  test("sessão OCUPADA + silêncio ≥ 30min → stall:wedge (throttle por limiar)", () => {
    const trace = baseTrace({
      session: { idle: false, pending: false },
      lastActivityAt: 0,
    });
    const signals = detectStall(trace, { now: 30 * 60_000, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "wedge")).toBe(true);
  });

  test("sessão ocupada por pouco tempo → sem wedge", () => {
    const trace = baseTrace({ session: { idle: false, pending: false }, lastActivityAt: 0 });
    expect(detectStall(trace, { now: 60_000, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });

  test("sessão OCIOSA + silêncio ≥ heartbeatStallMs → stall:heartbeat (refire)", () => {
    const trace = baseTrace({ session: { idle: true, pending: false }, lastActivityAt: 0 });
    const signals = detectStall(trace, { now: 60_000, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "heartbeat")).toBe(true);
  });

  test("heartbeat respeita a escada exponencial (consecutiveStalls espaça refires)", () => {
    // 1 stall → limiar 60s; 3 stalls → limiar 8min (60s × 2^3).
    const trace = baseTrace({ session: { idle: true, pending: false }, lastActivityAt: 0, consecutiveStalls: 3 });
    const now = 4 * 60_000;
    expect(detectStall(trace, { now, thresholds: THRESHOLDS, supervising: true }).some((s) => s.type === "heartbeat")).toBe(false);
    const signals = detectStall(trace, { now: 8 * 60_000, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "heartbeat")).toBe(true);
  });

  test("idle + pending + silêncio ≥ 3min → stall:pending-latch (latch preso — falha pós-compactação)", () => {
    const trace = baseTrace({ session: { idle: true, pending: true }, lastActivityAt: 0 });
    const signals = detectStall(trace, { now: 3 * 60_000, thresholds: THRESHOLDS, supervising: true });
    expect(signals.some((s) => s.type === "pending-latch")).toBe(true);
    // Latch preso → NÃO dispara heartbeat junto (o re-send não destrava).
    expect(signals.some((s) => s.type === "heartbeat")).toBe(false);
  });

  test("timer de continuação pendente → sem heartbeat (não re-disparar)", () => {
    const trace = baseTrace({ session: { idle: true, pending: false }, timerPending: true, lastActivityAt: 0 });
    expect(detectStall(trace, { now: 60_000, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });
});

describe("detectStall — suppression herdada (padrões do fork)", () => {
  test("audit-in-flight → ZERO sinais", () => {
    const trace = baseTrace({ session: { idle: false, pending: false }, lastActivityAt: 0, suppression: { auditInFlight: true, postCompactionGraceUntil: 0, extensionApiStale: false } });
    expect(detectStall(trace, { now: 60 * 60_000, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });

  test("grace pós-compactação → ZERO sinais (COMPACTION_GRACE_MS)", () => {
    const trace = baseTrace({ session: { idle: false, pending: false }, lastActivityAt: 0, suppression: { auditInFlight: false, postCompactionGraceUntil: 10 * 60_000, extensionApiStale: false } });
    expect(detectStall(trace, { now: 5 * 60_000, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });

  test("extensionApiStale → ZERO sinais (handle invalidado pós-compactação)", () => {
    const trace = baseTrace({ session: { idle: false, pending: false }, lastActivityAt: 0, suppression: { auditInFlight: false, postCompactionGraceUntil: 0, extensionApiStale: true } });
    expect(detectStall(trace, { now: 60 * 60_000, thresholds: THRESHOLDS, supervising: true })).toEqual([]);
  });

  test("sem goal supervisionado → ZERO sinais (stall machinery quieto)", () => {
    const trace = baseTrace({ session: { idle: false, pending: false }, lastActivityAt: 0 });
    expect(detectStall(trace, { now: 60 * 60_000, thresholds: THRESHOLDS, supervising: false })).toEqual([]);
  });
});

describe("determinismo (AC5 — relógio/timestamps injetáveis)", () => {
  test("2 runs com o mesmo trace → sinais IDÊNTICOS (reason sem path/timestamp)", () => {
    const trace = baseTrace({
      session: { idle: false, pending: false },
      lastActivityAt: 0,
      toolCalls: [
        { tool: "bash", argsHash: argsHash({ command: "x" }), at: 1 },
        { tool: "bash", argsHash: argsHash({ command: "x" }), at: 2 },
        { tool: "bash", argsHash: argsHash({ command: "x" }), at: 3 },
      ],
    });
    const opts = { now: 30 * 60_000, thresholds: THRESHOLDS, supervising: true };
    const a = detectStall(trace, opts);
    const b = detectStall(trace, opts);
    expect(a).toEqual(b);
    for (const s of a) {
      expect(s.reason).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(s.reason).not.toContain("/tmp");
    }
  });
});

describe("ports dos predicados (goal-loop-backoff.ts)", () => {
  test("shouldWedgeAlert: gating completo", () => {
    expect(shouldWedgeAlert({ supervising: false, sessionBusy: true, silentMs: 999_999, msSinceLastAlert: 999_999, thresholdMs: 30 * 60_000 })).toBe(false);
    expect(shouldWedgeAlert({ supervising: true, sessionBusy: false, silentMs: 999_999, msSinceLastAlert: 999_999, thresholdMs: 30 * 60_000 })).toBe(false);
    expect(shouldWedgeAlert({ supervising: true, sessionBusy: true, silentMs: 60_000, msSinceLastAlert: 999_999, thresholdMs: 30 * 60_000 })).toBe(false);
    expect(shouldWedgeAlert({ supervising: true, sessionBusy: true, silentMs: 31 * 60_000, msSinceLastAlert: 0, thresholdMs: 30 * 60_000 })).toBe(false);
    expect(shouldWedgeAlert({ supervising: true, sessionBusy: true, silentMs: 31 * 60_000, msSinceLastAlert: 31 * 60_000, thresholdMs: 30 * 60_000 })).toBe(true);
  });

  test("shouldHeartbeatRefire: espaçamento exponencial por stall (v0.28.25)", () => {
    const base = { supervising: true, sessionIdle: true, timerPending: false, stallMs: 60_000 };
    expect(shouldHeartbeatRefire({ ...base, msSinceActivity: 59_000, consecutiveStalls: 0 })).toBe(false);
    expect(shouldHeartbeatRefire({ ...base, msSinceActivity: 60_000, consecutiveStalls: 0 })).toBe(true);
    expect(shouldHeartbeatRefire({ ...base, msSinceActivity: 120_000, consecutiveStalls: 1 })).toBe(true);
    expect(shouldHeartbeatRefire({ ...base, msSinceActivity: 480_000, consecutiveStalls: 3 })).toBe(true);
    expect(shouldHeartbeatRefire({ ...base, msSinceActivity: 300_000, consecutiveStalls: 3 })).toBe(false);
  });

  test("shouldFirePendingLatchWatchdog: idle + pending + silêncio", () => {
    const base = { supervising: true, idle: true, pending: true, timerPending: false, thresholdMs: 3 * 60_000 };
    expect(shouldFirePendingLatchWatchdog({ ...base, silentMs: 3 * 60_000 })).toBe(true);
    expect(shouldFirePendingLatchWatchdog({ ...base, silentMs: 60_000 })).toBe(false);
    expect(shouldFirePendingLatchWatchdog({ ...base, silentMs: 999_999, timerPending: true })).toBe(false);
  });

  test("backoffMs: escadas stuck/error/context + cap duro 5min (fork)", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(4)).toBe(240_000);
    expect(backoffMs(5)).toBe(300_000);
    expect(backoffMs(99)).toBe(300_000); // cap duro
    expect(backoffMs(1, "error")).toBe(5_000);
    expect(backoffMs(2, "error")).toBe(10_000); // 5s × 2^(n-1) — fórmula do fork
    expect(backoffMs(5, "error")).toBe(60_000); // 80s → cap BACKOFF_ERROR_MAX_MS (60s)
    expect(backoffMs(6, "error")).toBe(60_000);
    expect(backoffMs(1, "context")).toBe(30_000);
    expect(backoffMs(10, "context")).toBe(300_000); // cap
  });

  test("shouldPauseAfterBackoff: stuck ≥ 5min OU ≥ 3 iterações ociosas", () => {
    expect(shouldPauseAfterBackoff(300_000, 0)).toBe(true);
    expect(shouldPauseAfterBackoff(60_000, 3)).toBe(true);
    expect(shouldPauseAfterBackoff(60_000, 2)).toBe(false);
  });

  test("shouldEscalateStall: refires ≥ limiar; 0 = nunca escalar (goal-loop-core.ts)", () => {
    expect(shouldEscalateStall(5, 5)).toBe(true);
    expect(shouldEscalateStall(4, 5)).toBe(false);
    expect(shouldEscalateStall(99, 0)).toBe(false);
  });
});
