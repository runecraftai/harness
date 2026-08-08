// observability/store.test.ts — event store tipado (T1, D1/D2, OBS-01).
//
// Unit do store: seq monotônico determinístico, prevHash chain, escrita
// best-effort (falha induzida → NUNCA throw — a sessão continua), kill
// switch → zero arquivos, leitura fail-soft (truncado/corrompido → pula),
// identidade (seq, kind, bundle) sem timestamps (F21 D10).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendEvent, GENESIS_PREV_HASH, lastSeqOf, parseEventLine, readEvents, sha256Line, verifyHashChain } from "../../src/observability/store.ts";
import { eventsFileFor } from "../../src/observability/config.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-store-"));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

describe("store — append-only por sessão (D1/QA-1a)", () => {
  test("seq 0..n monotônico e determinístico; header é o primeiro evento; prevHash encadeado", () => {
    const dir = makeTmp();
    try {
      const a = appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "0.1.0", sdk: "0.81.0", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
      const b = appendEvent(dir, "s1", "tool:call", { tool: "read", argsHash: "abc123" }, { bundle: "aaaaaaaaaaaa", now: NOW });
      const c = appendEvent(dir, "s1", "tool:result", { tool: "read", ok: true, durationMs: 0 }, { bundle: "aaaaaaaaaaaa", now: NOW });
      expect(a).toEqual({ ok: true, seq: 0, file: eventsFileFor(dir, "s1") });
      expect(b.ok && b.seq).toBe(1);
      expect(c.ok && c.seq).toBe(2);

      const { events, skipped } = readEvents(eventsFileFor(dir, "s1"));
      expect(skipped).toBe(0);
      expect(events.map((e) => [e.seq, e.kind])).toEqual([
        [0, "session:started"],
        [1, "tool:call"],
        [2, "tool:result"],
      ]);
      // prevHash chain: primeiro = sha256(""); demais = sha256 da linha anterior.
      const rawLines = fs.readFileSync(eventsFileFor(dir, "s1"), "utf8").trim().split("\n");
      expect(events[0]!.prevHash).toBe(GENESIS_PREV_HASH);
      expect(events[1]!.prevHash).toBe(sha256Line(rawLines[0]!));
      expect(events[2]!.prevHash).toBe(sha256Line(rawLines[1]!));
      // Identidade SEM timestamp: `at` vive no payload, nunca no campo base.
      expect(Object.keys(events[0]!)).not.toContain("at");
      expect(typeof (events[0]!.payload as { at?: string }).at).toBe("string");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("2 sessões → arquivos por sessionId (QA-1a — isolamento multi-sessão AD-019)", () => {
    const dir = makeTmp();
    try {
      appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
      appendEvent(dir, "s2", "session:started", { bundleHash: "b".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "bbbbbbbbbbbb", now: NOW });
      expect(fs.existsSync(eventsFileFor(dir, "s1"))).toBe(true);
      expect(fs.existsSync(eventsFileFor(dir, "s2"))).toBe(true);
      expect(readEvents(eventsFileFor(dir, "s1")).events[0]!.seq).toBe(0);
      expect(readEvents(eventsFileFor(dir, "s2")).events[0]!.seq).toBe(0); // seq por sessão
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recovery pós-crash: append após arquivo truncado continua do último seq VÁLIDO", () => {
    const dir = makeTmp();
    try {
      appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
      appendEvent(dir, "s1", "tool:call", { tool: "read", argsHash: "h" }, { bundle: "aaaaaaaaaaaa", now: NOW });
      appendEvent(dir, "s1", "tool:result", { tool: "read", ok: true, durationMs: 0 }, { bundle: "aaaaaaaaaaaa", now: NOW });
      // Trunca a ÚLTIMA linha no meio (crash mid-write) → recovery para o
      // último VÁLIDO (seq 1); o próximo append é o seq 2 (retry consistente).
      const file = eventsFileFor(dir, "s1");
      const content = fs.readFileSync(file, "utf8");
      const lines = content.trim().split("\n");
      fs.writeFileSync(file, `${lines[0]}\n${lines[1]}\n${lines[2]!.slice(0, -25)}\n`, "utf8");
      expect(lastSeqOf(file)).toBe(1);
      const res = appendEvent(dir, "s1", "tool:result", { tool: "read", ok: true, durationMs: 0 }, { bundle: "aaaaaaaaaaaa", now: NOW });
      expect(res.ok && res.seq).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falha de escrita induzida → NUNCA throw; retorna write-failed e a sessão continua (AC 1.3)", () => {
    const dir = makeTmp();
    try {
      // Path inválido: um ARQUIVO no lugar do diretório .runecraft/events/.
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      const blocker = path.join(dir, ".runecraft", "events");
      fs.writeFileSync(blocker, "not-a-dir");
      const res = appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
      if (res.ok) throw new Error("esperava falha de escrita");
      expect(res.reason).toBe("write-failed");
      // O caller segue (NÃO throw): removido o bloqueio, o próximo append
      // grava normalmente — a sessão continua (AC 1.3).
      fs.rmSync(blocker);
      const ok = appendEvent(dir, "s2", "session:started", { bundleHash: "b".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "bbbbbbbbbbbb", now: NOW });
      if (!ok.ok) throw new Error("esperava escrita ok");
      expect(ok.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kill switch RUNECRAFT_OBSERVABILITY=0 → inerte, zero arquivos (AC 1.4)", () => {
    const dir = makeTmp();
    try {
      const res = appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW, env: { RUNECRAFT_OBSERVABILITY: "0" } });
      if (res.ok) throw new Error("esperava kill-switch");
      expect(res.reason).toBe("kill-switch");
      expect(fs.existsSync(path.join(dir, ".runecraft"))).toBe(false);
      // "false"/"off" também desligam (convenção F20).
      for (const value of ["false", "off"]) {
        const r = appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW, env: { RUNECRAFT_OBSERVABILITY: value } });
        if (r.ok) throw new Error("esperava kill-switch");
        expect(r.reason).toBe("kill-switch");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("leitura fail-soft: linha malformada pulada (padrão ledger glla v0.28.6)", () => {
    const dir = makeTmp();
    try {
      const file = eventsFileFor(dir, "s1");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `{"seq":0,"kind":"session:started","sessionId":"s1","bundle":"aaaaaaaaaaaa","prevHash":"${GENESIS_PREV_HASH}","payload":{"bundleHash":"x","at":"2026-01-01T00:00:00.000Z"}}\n{corrompido\n{"seq":2,"kind":"tool:call","sessionId":"s1","bundle":"aaaaaaaaaaaa","prevHash":"h","payload":{"tool":"read","argsHash":"h","at":"2026-01-01T00:00:00.000Z"}}\n`, "utf8");
      const { events, skipped } = readEvents(file);
      expect(events).toHaveLength(2);
      expect(skipped).toBe(1);
      expect(events[1]!.seq).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parseEventLine valida shape base (zero parser — D2)", () => {
    expect(parseEventLine(`{"seq":0,"kind":"session:started","sessionId":"s1","bundle":"aaaaaaaaaaaa","prevHash":"${GENESIS_PREV_HASH}","payload":{}}`)).not.toBeNull();
    expect(parseEventLine(`{"seq":"x","kind":"session:started","sessionId":"s1","bundle":"a","prevHash":"h","payload":{}}`)).toBeNull();
    expect(parseEventLine(`{"seq":0,"kind":"session:started","sessionId":"s1","bundle":"a","payload":{}}`)).toBeNull(); // sem prevHash
    expect(parseEventLine("not json")).toBeNull();
  });

  test("verifyHashChain: violação detectada quando uma linha é adulterada", () => {
    const dir = makeTmp();
    try {
      appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
      appendEvent(dir, "s1", "tool:call", { tool: "read", argsHash: "h" }, { bundle: "aaaaaaaaaaaa", now: NOW });
      appendEvent(dir, "s1", "tool:result", { tool: "read", ok: true, durationMs: 0 }, { bundle: "aaaaaaaaaaaa", now: NOW });
      const file = eventsFileFor(dir, "s1");
      const rawLines = fs.readFileSync(file, "utf8").trim().split("\n");
      const { events } = readEvents(file);
      expect(verifyHashChain(events, rawLines)).toEqual([]);
      // Adultera a linha 1 (tool:call — read→grep) → a linha 2 quebra a chain.
      const tampered = rawLines[1]!.replace("read", "grep");
      const tamperedLines = [rawLines[0]!, tampered, rawLines[2]!];
      const violations = verifyHashChain(events, tamperedLines);
      expect(violations).toHaveLength(1);
      expect(violations[0]!).toContain("seq 2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
