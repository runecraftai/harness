// observability/cli.test.ts — CLI do F28 (T7, D8/D5, OBS-10/07).
//
// `harness events export --format jsonl [--session] [--include-external]`
// (merge determinístico + bridges + verificação prevHash) e
// `harness lessons list|promote <id>|archive <id>` via dispatch in-process
// (contrato F11 — mesmo caminho do CLI real). Kill switch → inativo exit 0.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dispatch } from "../../src/cli.ts";
import { appendEvent } from "../../src/observability/store.ts";
import { applyCapture, writeLessonsFile, writePromotedFile } from "../../src/observability/lessons.ts";

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(String(chunk));
  }
  get text(): string {
    return this.chunks.join("");
  }
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-cli-"));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

async function dispatchIn(dir: string, args: string[], env: NodeJS.ProcessEnv = { ...process.env }) {
  const out = new StringSink();
  const err = new StringSink();
  const code = await dispatch(args, { env, cwd: dir, stdout: out, stderr: err, isTTY: false });
  return { code, stdout: out.text, stderr: err.text };
}

function seedStore(dir: string, sessionId = "s1"): void {
  appendEvent(dir, sessionId, "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
  appendEvent(dir, sessionId, "tool:call", { tool: "read", argsHash: "h1" }, { bundle: "aaaaaaaaaaaa", now: NOW });
}

describe("harness events export (D8/OBS-10)", () => {
  test("export jsonl determinístico (2 runs byte-idênticos) com filtro --session", async () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      seedStore(dir, "s2");
      const first = await dispatchIn(dir, ["events", "export", "--format", "jsonl"]);
      const second = await dispatchIn(dir, ["events", "export", "--format", "jsonl"]);
      expect(first.code).toBe(0);
      expect(first.stdout).toBe(second.stdout); // byte-idêntico
      const events = first.stdout.trim().split("\n").map((l) => JSON.parse(l)) as Array<{ sessionId: string; seq: number }>;
      expect(events.map((e) => `${e.sessionId}:${e.seq}`)).toEqual(["s1:0", "s1:1", "s2:0", "s2:1"]);
      const only = await dispatchIn(dir, ["events", "export", "--session", "s2"]);
      const onlyEvents = only.stdout.trim().split("\n").map((l) => JSON.parse(l)) as Array<{ sessionId: string }>;
      expect(onlyEvents.every((e) => e.sessionId === "s2")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--include-external materializa bridges (verification:verdict + resilience:signal)", async () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      fs.mkdirSync(path.join(dir, ".pi-glla"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".runecraft", "verify-verdicts.jsonl"), `${JSON.stringify({ verifyId: "v1", status: "halt", layer: "integrity", reason: "r", suggestion: "s", cost: {} })}\n`);
      fs.writeFileSync(path.join(dir, ".pi-glla", "active.jsonl"), `${JSON.stringify({ type: "heartbeat_refire", value: { nudgesSoFar: 2 }, at: "2026-08-07T00:00:00.000Z" })}\n`);
      const result = await dispatchIn(dir, ["events", "export", "--include-external"]);
      expect(result.code).toBe(0);
      const events = result.stdout.trim().split("\n").map((l) => JSON.parse(l)) as Array<{ kind: string; source: string }>;
      const verdict = events.find((e) => e.kind === "verification:verdict")!;
      expect(verdict.source).toBe("bridge");
      const signal = events.find((e) => e.kind === "resilience:signal")!;
      expect(signal.source).toBe("bridge");
      const again = await dispatchIn(dir, ["events", "export", "--include-external"]);
      expect(again.stdout).toBe(result.stdout); // determinismo com bridges
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kill switch → inativo, exit 0; --format inválido → erro", async () => {
    const dir = makeTmp();
    try {
      seedStore(dir, "s1");
      const kill = await dispatchIn(dir, ["events", "export"], { ...process.env, RUNECRAFT_OBSERVABILITY: "0" });
      expect(kill.code).toBe(0);
      expect(kill.stdout).toContain("inativa");
      const bad = await dispatchIn(dir, ["events", "export", "--format", "otel"]);
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("otel");
      expect(bad.stderr).toContain("v1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("harness lessons list|promote|archive (D5/OBS-07)", () => {
  test("list vazio → exit 0 com mensagem; captura → list mostra a lição; promote força → promoted.jsonl; archive sai do adendo", async () => {
    const dir = makeTmp();
    try {
      const empty = await dispatchIn(dir, ["lessons", "list"]);
      expect(empty.code).toBe(0);
      expect(empty.stdout).toContain("nenhuma lição");

      // Seed de uma lesson no lessons.jsonl (estado).
      const file = path.join(dir, ".runecraft", "lessons.jsonl");
      const promoted = path.join(dir, ".runecraft", "lessons", "promoted.jsonl");
      const captured = applyCapture(
        [],
        { trigger: "write blocked", antiPattern: "repeating", preferred: "fix first", priority: "med", gate: "writeExistingFile", track: "execution" },
        0,
        { promotionThreshold: 3, highPriorityThreshold: 2 },
      );
      writeLessonsFile(file, captured.records);

      const list = await dispatchIn(dir, ["lessons", "list"]);
      expect(list.code).toBe(0);
      expect(list.stdout).toContain("write blocked");

      // promote <id> força a promoção (versionada).
      const id = captured.record.lessonId;
      const promotedResult = await dispatchIn(dir, ["lessons", "promote", id]);
      expect(promotedResult.code).toBe(0);
      expect(promotedResult.stdout).toContain("promovida");
      expect(fs.existsSync(promoted)).toBe(true);
      expect(fs.readFileSync(promoted, "utf8")).toContain(id);

      // promote de id inexistente → erro exit 1.
      const missing = await dispatchIn(dir, ["lessons", "promote", "nope"]);
      expect(missing.code).toBe(1);

      // archive <id> → status archived (sai do adendo/promoted).
      const archived = await dispatchIn(dir, ["lessons", "archive", id]);
      expect(archived.code).toBe(0);
      const listAfter = await dispatchIn(dir, ["lessons", "list"]);
      expect(listAfter.stdout).toContain("[A]");
      expect(fs.readFileSync(promoted, "utf8")).not.toContain(id);

      // subcomando desconhecido → erro.
      const bad = await dispatchIn(dir, ["lessons", "frobnicate"]);
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("list|promote|archive");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
