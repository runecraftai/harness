// observability/export.test.ts — export jsonl determinístico + bridges (T7,
// D7/D8, OBS-09/10).
//
// 2 runs → byte-idêntico; bridge mapeia linha→evento (verify-verdicts.jsonl
// seedado → verification:verdict; ledger glla + continuation.json +
// resilience-events.jsonl → resilience:signal — source:"bridge"); prevHash
// violado → aviso; linha malformada pulada (fail-soft); --session anexa
// bridges com seq virtual N+1.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendEvent, GENESIS_PREV_HASH } from "../../src/observability/store.ts";
import { exportEvents, listStoreSessions, BRIDGE_SESSION_ID } from "../../src/observability/export.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-export-"));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

function seedStore(dir: string, sessionId = "s1"): void {
  appendEvent(dir, sessionId, "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
  appendEvent(dir, sessionId, "tool:call", { tool: "read", argsHash: "h1" }, { bundle: "aaaaaaaaaaaa", now: NOW });
  appendEvent(dir, sessionId, "tool:result", { tool: "read", ok: true, durationMs: 0 }, { bundle: "aaaaaaaaaaaa", now: NOW });
}

function seedSinks(dir: string): void {
  fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".pi-glla"), { recursive: true });
  // verify-verdicts.jsonl (F25 — shape real do recordSessionVerdict).
  fs.writeFileSync(
    path.join(dir, ".runecraft", "verify-verdicts.jsonl"),
    `${JSON.stringify({ verifyId: "v1", status: "halt", layer: "integrity", reason: "diff vazio", suggestion: "faça uma mudança", cost: { cascadeRuns: 1 } })}\n`,
  );
  // ledger glla (F24/F27 — shape real do appendLedger).
  fs.writeFileSync(
    path.join(dir, ".pi-glla", "active.jsonl"),
    `${JSON.stringify({ type: "state", value: { goal: null }, at: "2026-08-07T00:00:00.000Z" })}\n${JSON.stringify({ type: "wedge_alert", value: { silentMs: 123 }, at: "2026-08-07T00:00:01.000Z" })}\n`,
  );
  // continuation.json (F27 — shape real).
  fs.writeFileSync(
    path.join(dir, ".runecraft", "continuation.json"),
    JSON.stringify({ schemaVersion: 1, lastSessionId: "s1", workSummary: null, continuationCount: 2, stallCount: 1, taskListSnapshot: null, compactedAt: null }),
  );
  // resilience-events.jsonl (F27).
  fs.writeFileSync(
    path.join(dir, ".runecraft", "resilience-events.jsonl"),
    `${JSON.stringify({ type: "continuation_injected", value: { continuationCount: 2 }, at: "2026-08-07T00:00:02.000Z" })}\n`,
  );
}

describe("export — determinismo e merge (D8)", () => {
  test("2 runs → byte-output IDÊNTICO; ordenação (sessionId, seq)", () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      seedStore(dir, "s2");
      const first = exportEvents({ cwd: dir, includeExternal: false });
      const second = exportEvents({ cwd: dir, includeExternal: false });
      expect(first.lines).toEqual(second.lines);
      const parsed = first.lines.map((l) => JSON.parse(l)) as Array<{ sessionId: string; seq: number }>;
      const order = parsed.map((e) => `${e.sessionId}:${e.seq}`);
      expect(order).toEqual([...order].sort()); // s1 antes de s2; seq asc por sessão
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bridges (--include-external): verification:verdict + resilience:signal com source bridge", () => {
    const dir = makeTmp();
    try {
      seedStore(dir);
      seedSinks(dir);
      const result = exportEvents({ cwd: dir, includeExternal: true });
      const events = result.lines.map((l) => JSON.parse(l)) as Array<{ kind: string; source: string; payload: Record<string, unknown> }>;
      const verdict = events.find((e) => e.kind === "verification:verdict")!;
      expect(verdict.source).toBe("bridge");
      expect(verdict.payload.status).toBe("halt");
      expect(verdict.payload.layer).toBe("integrity");
      const signal = events.find((e) => e.kind === "resilience:signal" && e.payload.signal === "wedge_alert")!;
      expect(signal.source).toBe("bridge");
      expect(signal.payload.detail).toEqual({ silentMs: 123 });
      const continuation = events.find((e) => e.kind === "resilience:signal" && e.payload.signal === "continuation")!;
      expect((continuation.payload.detail as { continuationCount: number }).continuationCount).toBe(2);
      const injected = events.find((e) => e.kind === "resilience:signal" && e.payload.signal === "continuation_injected")!;
      expect(injected).toBeDefined();
      // O `state` do ledger NÃO vira sinal (só pending_latch_stuck/wedge_alert/heartbeat_refire).
      expect(events.filter((e) => e.kind === "resilience:signal" && e.payload.signal === "state")).toHaveLength(0);
      // 2 runs com bridges → byte-idêntico.
      const again = exportEvents({ cwd: dir, includeExternal: true });
      expect(again.lines).toEqual(result.lines);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--session anexa bridges à sessão com seq virtual N+1 (D8)", () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      seedSinks(dir);
      const result = exportEvents({ cwd: dir, includeExternal: true, session: "s1" });
      const events = result.lines.map((l) => JSON.parse(l)) as Array<{ kind: string; sessionId: string; seq: number; source?: string }>;
      expect(events.every((e) => e.sessionId === "s1")).toBe(true);
      const storeMax = Math.max(...events.filter((e) => e.source !== "bridge").map((e) => e.seq));
      const bridgeSeqs = events.filter((e) => e.source === "bridge").map((e) => e.seq);
      expect(bridgeSeqs[0]).toBe(storeMax + 1);
      // seq monotônico global na sessão (mesmo contrato do store).
      const seqs = events.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      // --session inexistente → sem bridges (nada a anexar).
      const none = exportEvents({ cwd: dir, includeExternal: true, session: "ghost" });
      expect(none.lines).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prevHash violado → aviso no resultado (stderr é do comando); linha malformada pulada", () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      const file = path.join(dir, ".runecraft", "events", "s1.jsonl");
      // Adultera a linha 1 (tool:call) sem atualizar o prevHash da linha 2.
      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      const tampered = lines[1]!.replace('"read"', '"grep"');
      fs.writeFileSync(file, `${lines[0]}\n{corrompido\n${tampered}\n${lines[2]}\n`, "utf8");
      const result = exportEvents({ cwd: dir, includeExternal: false });
      expect(result.skipped).toBe(1);
      expect(result.hashViolations.length).toBeGreaterThan(0);
      expect(result.hashViolations[0]!).toContain("seq 2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("listStoreSessions + bundle do header (12 hex)", () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      seedStore(dir, "s2");
      expect(listStoreSessions(path.join(dir, ".runecraft", "events"))).toEqual(["s1", "s2"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
