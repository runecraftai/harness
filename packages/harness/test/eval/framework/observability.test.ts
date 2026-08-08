// framework/observability.test.ts — EVAL-022..029: Observability & Lessons
// (F28) via framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — F28 é determinístico por
// construção):
//   EVAL-022 determinismo do store (sessão scriptada 2x → MESMA sequência
//     (seq, kind, bundle, argsHash, triggerSignature); payload volátil —
//     at/durationMs/cost — excluído do assert, documentado);
//   EVAL-023 bundle hash estável (mesma config → mesmo hash; mudança →
//     diferente; gitHead fora);
//   EVAL-024 session recorder (agregados tool/delegation/token de eventos
//     scriptados);
//   EVAL-025 context monitor + token state (0.85 → warn; 0.97 → recover;
//     parse do token-budget fixture — shape REAL verificado);
//   EVAL-026 lesson capture em gate failure induzido (bloqueio F24 via
//     tool_execution_end + veredito F25 halt no sweep de fim de sessão —
//     4 campos + triggerSignature; dedupe);
//   EVAL-027 reincidência + promoção (3x → promoted.jsonl + evento; high+2;
//     promote <id> força);
//   EVAL-028 adendo (filtro por gate, ≤3, marker, 2 runs idênticos; planning
//     track; sem lessons → null);
//   EVAL-029 export round-trip (jsonl determinístico 2 runs byte-idênticos +
//     bridges verify-verdicts/ledger → source:"bridge" + prevHash) + suite
//     observability verde (case observability-block: guard F24 bloqueia numa
//     sessão REAL com a extensão do F28 → guard:blocked no store).
//
// Delta vs EVAL-006/007/014/019 documentado em cada case (D6 — sem
// double-test): o mecanismo do guard/veredito/stall já é coberto pelos
// EVALs existentes; os cases novos cobrem a OBSERVAÇÃO do F28.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import type { EvalRunResult } from "../../../src/eval/types.ts";
import { evalTest, EVAL_PARTIAL_DIR } from "../helpers/evalTest.ts";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { script, type ScriptedScenario } from "../layer2/fixture/scenarios.ts";
import { appendEvent, GENESIS_PREV_HASH } from "../../../src/observability/store.ts";
import { computeBundleHash, canonicalJson } from "../../../src/observability/bundle.ts";
import { checkContextWindow, parseTokenBudgetRun } from "../../../src/observability/context-monitor.ts";
import { TokenState } from "../../../src/observability/token-state.ts";
import { SessionRecorder, type RecorderSink } from "../../../src/observability/session-recorder.ts";
import {
  applyCapture,
  buildLessonAdendo,
  triggerSignatureOf,
  LESSONS_MARKER,
  readLessonsFile,
  writeLessonsFile,
  writePromotedFile,
} from "../../../src/observability/lessons.ts";
import { exportEvents } from "../../../src/observability/export.ts";
import { detectBlockFromText, installObservability } from "../../../src/extensions/observability.ts";
import type { LessonRecord } from "../../../src/observability/lessons-types.ts";
import type { BundleFingerprintInput, EventKind } from "../../../src/observability/types.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const THIS_FILE = "observability.test.ts";

const OBSERVABILITY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/observability.ts",
);

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-f28-"));
}

function appendObservabilityExtension(agentDir: string): void {
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (!extensions.includes(OBSERVABILITY_EXTENSION)) extensions.push(OBSERVABILITY_EXTENSION);
  settings.extensions = extensions;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

/** Projeção determinística dos vereditos (sem durationMs/runId/timestamps). */
function verdictProjection(result: EvalRunResult): Array<{ caseId: string; status: string; score: number; maxScore: number; messages: string[] }> {
  return result.caseResults.map((c) => ({
    caseId: c.caseId,
    status: c.status,
    score: c.score,
    maxScore: c.maxScore,
    messages: c.assertionResults.map((a) => a.message),
  }));
}

const BUNDLE_BASE: BundleFingerprintInput = {
  harnessVersion: "0.1.0",
  sdkVersion: "0.81.0",
  forks: { "@runecraft/subagents": "0.37.2" },
  config: { guards: { writeExistingFile: { enabled: true } } },
  settings: { subagents: { modelScope: { enforce: false } } },
  rules: "stable rules",
  routingVersion: "1",
};

// ---------------------------------------------------------------------------
// EVAL-022 — determinismo do store (2 runs → mesma sequência de identidade)
// ---------------------------------------------------------------------------

describe("EVAL-022 — event store determinismo (D1/D2)", () => {
  test("sessão scriptada 2x → mesma sequência (seq, kind, bundle, argsHash, triggerSignature); payload volátil excluído", async () => {
    await evalTest(
      "EVAL-022: store determinístico — 2 runs com a mesma sequência de identidade (seq/kind/bundle/argsHash/triggerSignature)",
      async () => {
        const run = async (): Promise<Array<{ seq: number; kind: string; bundle: string; argsHash: string | null; triggerSignature: string | null }>> => {
          const dir = makeTmp();
          try {
            appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: "g", versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
            appendEvent(dir, "s1", "tool:call", { tool: "write", argsHash: "deadbeef001" }, { bundle: "aaaaaaaaaaaa", now: NOW });
            appendEvent(dir, "s1", "guard:blocked", { guardId: "writeExistingFile", tool: "write", reason: "write-existing-file-guard: write blocked" }, { bundle: "aaaaaaaaaaaa", now: NOW });
            appendEvent(dir, "s1", "lesson:captured", { lessonId: "l1", triggerSignature: triggerSignatureOf("write blocked by writeExistingFile", "writeExistingFile"), trigger: "t", antiPattern: "a", preferred: "p", priority: "med", gate: "writeExistingFile", track: "execution", count: 1 }, { bundle: "aaaaaaaaaaaa", now: NOW });
            const { readEvents } = await import("../../../src/observability/store.ts");
            return readEvents(path.join(dir, ".runecraft", "events", "s1.jsonl")).events.map((e) => ({
              seq: e.seq,
              kind: e.kind,
              bundle: e.bundle,
              argsHash: (e.payload as { argsHash?: string }).argsHash ?? null,
              triggerSignature: (e.payload as { triggerSignature?: string }).triggerSignature ?? null,
            }));
          } finally {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        };
        expect(await run()).toEqual(await run());
        expect((await run()).map((e) => e.kind)).toEqual(["session:started", "tool:call", "guard:blocked", "lesson:captured"]);
      },
      { evalId: "EVAL-022" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-023 — bundle hash estável
// ---------------------------------------------------------------------------

describe("EVAL-023 — bundle hash estável (D3)", () => {
  test("mesma config+prompts → mesmo hash; mudança → diferente; gitHead fora; canonical sort", async () => {
    await evalTest(
      "EVAL-023: bundle — estável/muda/gitHead fora/chaves ordenadas",
      async () => {
        expect(computeBundleHash(BUNDLE_BASE)).toEqual(computeBundleHash(BUNDLE_BASE));
        const changed = computeBundleHash({ ...BUNDLE_BASE, config: { guards: { writeExistingFile: { enabled: false } } } });
        expect(changed.full).not.toBe(computeBundleHash(BUNDLE_BASE).full);
        // gitHead NÃO é campo do input (QA-2a — identidade de variante).
        expect(canonicalJson(BUNDLE_BASE)).not.toContain("gitHead");
        // Chaves desordenadas → mesmo hash (canonical — padrão sort F23).
        const shuffled: BundleFingerprintInput = {
          routingVersion: BUNDLE_BASE.routingVersion,
          rules: BUNDLE_BASE.rules,
          settings: BUNDLE_BASE.settings,
          config: BUNDLE_BASE.config,
          forks: BUNDLE_BASE.forks,
          sdkVersion: BUNDLE_BASE.sdkVersion,
          harnessVersion: BUNDLE_BASE.harnessVersion,
        };
        expect(computeBundleHash(shuffled)).toEqual(computeBundleHash(BUNDLE_BASE));
        expect(computeBundleHash(BUNDLE_BASE).short).toHaveLength(12);
      },
      { evalId: "EVAL-023" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-024 — session recorder (agregados)
// ---------------------------------------------------------------------------

describe("EVAL-024 — session recorder (D4)", () => {
  test("3 tools + 1 delegação → session:ended com toolUsage/delegations/tokenTotals corretos", async () => {
    await evalTest(
      "EVAL-024: recorder — agregados de trace scriptado (3 tools + 1 delegação)",
      async () => {
        const events: Array<{ kind: EventKind; payload: Record<string, unknown> }> = [];
        const sink: RecorderSink = { append: (kind, payload) => events.push({ kind, payload }) };
        let clock = 0;
        const recorder = new SessionRecorder({
          sessionId: "s1",
          bundleShort: "abcdef012345",
          agentId: "main",
          model: "eval-model",
          bundleHash: "a".repeat(64),
          versions: { harness: "x", sdk: "y", forks: {} },
          gitHead: null,
          sink,
          now: () => clock,
        });
        recorder.startSession();
        for (const tool of ["read", "grep", "read"]) {
          recorder.trackToolCall(tool, `hash-${tool}`);
          recorder.trackToolResult({ tool, ok: true, durationMs: 1 });
        }
        recorder.trackDelegation({ agent: "worker", toolCallId: "c1", durationMs: 5 });
        recorder.trackTokenUsage({ input: 10, output: 2, cacheRead: 1, cacheWrite: 0 });
        clock = 100;
        recorder.endSession();
        const ended = events.find((e) => e.kind === "session:ended")!.payload as Record<string, unknown>;
        expect(ended.totalToolCalls).toBe(3);
        expect(ended.totalDelegations).toBe(1);
        expect(ended.toolUsage).toEqual([
          { tool: "grep", count: 1 },
          { tool: "read", count: 2 },
        ]);
        expect(ended.delegations).toEqual([{ agent: "worker", count: 1 }]);
        expect(ended.durationMs).toBe(100);
        expect(ended.tokenTotals).toEqual({ input: 10, output: 2, cacheRead: 1, cacheWrite: 0, totalMessages: 1 });
        // Delegação SÓ para `subagent` — aqui o caller decide; o recorder não
        // inventa delegação para outras tools.
        const delegationKinds = events.filter((e) => e.kind === "delegation");
        expect(delegationKinds).toHaveLength(1);
      },
      { evalId: "EVAL-024" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-025 — context monitor + token state + token-budget fixture
// ---------------------------------------------------------------------------

describe("EVAL-025 — context monitor + token state (D4)", () => {
  test("0.85 → warn; 0.97 → recover; 0.5 → none; parse do token-budget real; updateUsage só > 0", async () => {
    await evalTest(
      "EVAL-025: context monitor thresholds + token-budget bridge + token state",
      async () => {
        const TH = { warningPct: 0.8, criticalPct: 0.95 };
        expect(checkContextWindow({ usedTokens: 850, maxTokens: 1000 }, TH).action).toBe("warn");
        expect(checkContextWindow({ usedTokens: 970, maxTokens: 1000 }, TH).action).toBe("recover");
        expect(checkContextWindow({ usedTokens: 500, maxTokens: 1000 }, TH).action).toBe("none");
        // Fixture com o shape REAL verificado no disco (phases OBJECT keyed).
        const run = parseTokenBudgetRun({
          runId: "token-budget-msirwcbr-46e167",
          def: { budget: { maxTokens: 1000 } },
          status: "completed",
          phases: { run: { usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 870, turns: 1 } } },
        })!;
        expect(run.usage.contextTokens).toBe(870);
        expect(checkContextWindow({ usedTokens: run.usage.contextTokens, maxTokens: run.maxTokens ?? 0 }, TH).action).toBe("warn");
        // Token state: latest não cumulativo; só inputTokens > 0.
        const state = new TokenState();
        state.setContextLimit(1000);
        state.updateUsage(0);
        expect(state.snapshot().usedTokens).toBe(0);
        state.updateUsage(300);
        state.updateUsage(870);
        expect(state.snapshot()).toEqual({ maxTokens: 1000, usedTokens: 870 });
      },
      { evalId: "EVAL-025" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-026 — lesson capture em gate failure induzido
// ---------------------------------------------------------------------------

describe("EVAL-026 — lesson capture em gate failure (D5)", () => {
  test("bloqueio F24 (tool_execution_end) → lesson 4 campos + gate=guardId; veredito F25 halt → lesson gate=layer", async () => {
    await evalTest(
      "EVAL-026: lesson em gate failure — bloqueio F24 + veredito halt (4 campos + triggerSignature)",
      async () => {
        // (a) Detecção pura do bloqueio pelo reason `<guardId>: msg` (F24 D3).
        const detected = detectBlockFromText("write-existing-file-guard: write blocked — target already exists: README.md");
        expect(detected).toEqual({ gate: "writeExistingFile", reason: "write-existing-file-guard: write blocked — target already exists: README.md" });
        expect(detectBlockFromText("command not found")).toBeNull();
        expect(detectBlockFromText("verification-cascade: integrity — diff vazio; faça uma mudança")).toEqual({ gate: "verification", reason: "verification-cascade: integrity — diff vazio; faça uma mudança" });

        // (b) Captura com 4 campos via handler exportado (wiring — eventos scriptados).
        const base = makeTmp();
        try {
          const repo = path.join(base, "repo");
          fs.mkdirSync(repo, { recursive: true });
          // Veredito halt do F25 seedado no sink (sweep de fim de sessão).
          fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
          fs.writeFileSync(
            path.join(repo, ".runecraft", "verify-verdicts.jsonl"),
            `${JSON.stringify({ verifyId: "v1", status: "halt", layer: "integrity", reason: "diff vazio", suggestion: "faça uma mudança", cost: {} })}\n`,
          );
          const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
          const fakePi = {
            on(event: string, h: (e: unknown, c: unknown) => unknown) {
              const list = handlers.get(event) ?? [];
              list.push(h);
              handlers.set(event, list);
            },
            registerCommand() {},
            sendUserMessage() {},
            getSessionName() {
              return undefined;
            },
          };
          installObservability(fakePi as never, {
            env: { ...process.env },
            now: () => 0,
            isoNow: NOW,
            collectBundle: () => BUNDLE_BASE,
            gitHead: () => null,
          });
          const ctx = {
            cwd: repo,
            mode: "rpc",
            hasUI: false,
            ui: {},
            sessionManager: { getSessionId: () => "sess-1" },
            modelRegistry: {},
            model: { id: "m" },
            isIdle: () => true,
            isProjectTrusted: () => true,
            signal: undefined,
            abort: () => {},
            hasPendingMessages: () => false,
            shutdown: () => {},
            getContextUsage: () => undefined,
            compact: () => {},
            getSystemPrompt: () => "",
          };
          const emit = async (t: string, e: unknown) => {
            let result: unknown;
            for (const h of handlers.get(t) ?? []) result = await h(e, ctx);
            return result;
          };
          await emit("session_start", { type: "session_start", reason: "startup" });
          await emit("tool_execution_end", {
            type: "tool_execution_end",
            toolCallId: "c1",
            toolName: "write",
            result: { content: [{ type: "text", text: "write-existing-file-guard: write blocked — target already exists: README.md" }], details: {} },
            isError: true,
          });
          await emit("agent_end", { type: "agent_end", messages: [] });

          const events = fs
            .readFileSync(path.join(repo, ".runecraft", "events", "sess-1.jsonl"), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l)) as Array<{ kind: string; payload: Record<string, unknown> }>;
          const captured = events.find((e) => e.kind === "lesson:captured" && e.payload.gate === "writeExistingFile")!;
          expect(captured).toBeDefined();
          expect(captured.payload.trigger).toBe("write blocked by writeExistingFile");
          expect(captured.payload.antiPattern).toContain("continue calling write");
          expect(captured.payload.preferred).toContain("fix the condition flagged by writeExistingFile");
          expect(captured.payload.priority).toBe("med");
          expect(typeof captured.payload.triggerSignature).toBe("string");
          expect(captured.payload.triggerSignature).toBe(triggerSignatureOf("write blocked by writeExistingFile", "writeExistingFile"));

          // Veredito F25 halt (sweep do agent_end) → lesson com gate = layer.
          const verdictLesson = events.find((e) => e.kind === "lesson:captured" && e.payload.gate === "integrity")!;
          expect(verdictLesson).toBeDefined();
          expect(verdictLesson.payload.trigger).toBe("verification halt on integrity");
          expect(verdictLesson.payload.priority).toBe("high");
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-026" },
    );
  });

  test("dedupe: mesmo trigger+gate → reincidência, não duplicação", async () => {
    await evalTest("EVAL-026: dedupe por triggerSignature (mesmo trigger+gate = mesmo record)", async () => {
      const r1 = applyCapture([], { trigger: "t", antiPattern: "a", preferred: "p", priority: "med", gate: "g1", track: "execution" }, 0, { promotionThreshold: 3, highPriorityThreshold: 2 });
      const r2 = applyCapture(r1.records, { trigger: "t", antiPattern: "a", preferred: "p", priority: "med", gate: "g1", track: "execution" }, 1, { promotionThreshold: 3, highPriorityThreshold: 2 });
      expect(r2.outcome).toBe("reincidence");
      expect(r2.records).toHaveLength(1);
      expect(r2.record.count).toBe(2);
    }, { evalId: "EVAL-026" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-027 — reincidência + promoção
// ---------------------------------------------------------------------------

describe("EVAL-027 — reincidência + promoção (D5)", () => {
  test("3 captures → count=3 → promoted.jsonl + evento lesson:promoted; high+2 → promove antes; promote <id> força", async () => {
    await evalTest(
      "EVAL-027: reincidência 3x → promoção; high+2 antecipa; promote força",
      async () => {
        const dir = makeTmp();
        try {
          const stateFile = path.join(dir, "lessons.jsonl");
          const promotedFile = path.join(dir, "promoted.jsonl");
          let records: LessonRecord[] = [];
          let promotedEvent = false;
          for (let seq = 0; seq < 3; seq++) {
            const result = applyCapture(records, { trigger: "same failure", antiPattern: "repeat", preferred: "learn", priority: "med", gate: "g1", track: "execution" }, seq, { promotionThreshold: 3, highPriorityThreshold: 2 });
            records = result.records;
            writeLessonsFile(stateFile, records);
            writePromotedFile(promotedFile, records);
            if (result.events.some((e) => e.kind === "lesson:promoted")) promotedEvent = true;
          }
          expect(promotedEvent).toBe(true);
          expect(records[0]!.count).toBe(3);
          expect(records[0]!.status).toBe("promoted");
          expect(fs.readFileSync(promotedFile, "utf8")).toContain(records[0]!.lessonId);
          // Evento lesson:promoted no resultado da 3ª captura.
          const third = applyCapture([], { trigger: "x", antiPattern: "a", preferred: "p", priority: "med", gate: "g2", track: "execution" }, 0, { promotionThreshold: 3, highPriorityThreshold: 2 });
          expect(third.events.map((e) => e.kind)).toEqual(["lesson:captured"]);

          // high + 2 → promove antes.
          let high: LessonRecord[] = [];
          const h1 = applyCapture(high, { trigger: "h", antiPattern: "a", preferred: "p", priority: "high", gate: "g3", track: "execution" }, 0, { promotionThreshold: 3, highPriorityThreshold: 2 });
          high = h1.records;
          expect(h1.promoted).toBeNull();
          const h2 = applyCapture(high, { trigger: "h", antiPattern: "a", preferred: "p", priority: "high", gate: "g3", track: "execution" }, 1, { promotionThreshold: 3, highPriorityThreshold: 2 });
          expect(h2.promoted).not.toBeNull();
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-027" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-028 — adendo
// ---------------------------------------------------------------------------

describe("EVAL-028 — adendo (D6)", () => {
  function seeded(): LessonRecord[] {
    const a = applyCapture([], { trigger: "ta", antiPattern: "aa", preferred: "pa", priority: "med", gate: "gate-x", track: "execution" }, 0, { promotionThreshold: 3, highPriorityThreshold: 2 }).record;
    const b = applyCapture([], { trigger: "tb", antiPattern: "ab", preferred: "pb", priority: "high", gate: "gate-x", track: "execution" }, 1, { promotionThreshold: 3, highPriorityThreshold: 2 }).record;
    const c = applyCapture([], { trigger: "tc", antiPattern: "ac", preferred: "pc", priority: "low", gate: "gate-y", track: "execution" }, 2, { promotionThreshold: 3, highPriorityThreshold: 2 }).record;
    return [a, b, c];
  }

  test("filtro por gate (nunca vaza), ≤3, ordenado, marker; 2 runs idênticos; sem lessons → null; planning = promoted", async () => {
    await evalTest(
      "EVAL-028: adendo — filtro gate, ≤3, marker, determinismo, null sem lessons, planning",
      async () => {
        const records = seeded();
        const adendo = buildLessonAdendo(records, { gate: "gate-x", track: "execution", max: 3 })!;
        expect(adendo).toContain(LESSONS_MARKER);
        expect(adendo).not.toContain("tc"); // gate-y não vaza
        expect(adendo.split("\n").slice(1)).toHaveLength(2); // só as do gate-x (≤3)
        expect(adendo.split("\n")[1]).toContain("tb"); // high primeiro
        expect(adendo).toMatch(/Gatilho: tb · Anti-padrão: ab · Padrão preferido: pb \(Phigh\)/);
        // 2 runs → texto IDÊNTICO (F21 D10 — sem $TMP/$TS).
        expect(buildLessonAdendo(records, { gate: "gate-x", track: "execution", max: 3 })).toBe(adendo);
        expect(adendo).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        // Sem lessons do gate → null.
        expect(buildLessonAdendo(records, { gate: "gate-none", track: "execution", max: 3 })).toBeNull();
        // Planning: só promovidas.
        expect(buildLessonAdendo(records, { track: "planning", max: 3 })).toBeNull();
        const promoted = records.map((r) => (r.lessonId === records[0]!.lessonId ? { ...r, status: "promoted" as const } : r));
        const planning = buildLessonAdendo(promoted, { track: "planning", max: 3 })!;
        expect(planning).toContain("ta");
        expect(planning).not.toContain("tb");
      },
      { evalId: "EVAL-028" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-029 — export round-trip + suite observability (integração REAL)
// ---------------------------------------------------------------------------

describe("EVAL-029 — export round-trip (D8)", () => {
  test("2 runs byte-idênticos + bridges (source bridge) + prevHash verificado", async () => {
    await evalTest(
      "EVAL-029: export — byte-idêntico + bridges verify-verdicts/ledger + prevHash",
      async () => {
        const dir = makeTmp();
        try {
          appendEvent(dir, "s1", "session:started", { bundleHash: "a".repeat(64), agentId: "main", model: null, gitHead: null, versions: { harness: "x", sdk: "y", forks: {} } }, { bundle: "aaaaaaaaaaaa", now: NOW });
          appendEvent(dir, "s1", "tool:call", { tool: "read", argsHash: "h1" }, { bundle: "aaaaaaaaaaaa", now: NOW });
          fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
          fs.mkdirSync(path.join(dir, ".pi-glla"), { recursive: true });
          fs.writeFileSync(path.join(dir, ".runecraft", "verify-verdicts.jsonl"), `${JSON.stringify({ verifyId: "v1", status: "fail", layer: "structural", reason: "lint", suggestion: "fix", cost: {} })}\n`);
          fs.writeFileSync(path.join(dir, ".pi-glla", "active.jsonl"), `${JSON.stringify({ type: "pending_latch_stuck", value: { consecutiveStalls: 2 }, at: "2026-08-07T00:00:00.000Z" })}\n`);
          const first = exportEvents({ cwd: dir, includeExternal: true });
          const second = exportEvents({ cwd: dir, includeExternal: true });
          expect(first.lines).toEqual(second.lines); // byte-idêntico
          expect(first.hashViolations).toEqual([]); // prevHash ok
          const events = first.lines.map((l) => JSON.parse(l)) as Array<{ kind: string; source: string }>;
          expect(events.find((e) => e.kind === "verification:verdict" && e.source === "bridge")).toBeDefined();
          expect(events.find((e) => e.kind === "resilience:signal" && e.source === "bridge")).toBeDefined();
          // Linha malformada → fail-soft.
          fs.appendFileSync(path.join(dir, ".runecraft", "verify-verdicts.jsonl"), "{corrompido\n");
          const third = exportEvents({ cwd: dir, includeExternal: true });
          expect(third.skipped).toBe(1);
          expect(third.lines).toEqual(first.lines); // pulada sem quebrar o determinismo
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-029" },
    );
  });

  test("suite observability verde + guard:blocked REAL no store (sessão glla fixture)", async () => {
    await evalTest(
      "EVAL-026/029: suite observability verde + guard:blocked no store em sessão REAL",
      async () => {
        const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "observability" });
        const result = output.result;
        expect(result.summary.totalCases).toBe(1);
        expect(result.summary.passedCases).toBe(1);
        expect(result.summary.failedCases).toBe(0);
        expect(result.summary.errorCases).toBe(0);
        expect(result.caseResults[0]!.caseId).toBe("observability-block");
        // Mensagens estáveis (F21 D10).
        for (const a of result.caseResults[0]!.assertionResults) {
          expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(a.message).not.toContain(TEST_EVAL_DIR);
        }
      },
      { evalId: "EVAL-026" },
    );
  });

  test("sessão REAL com guards + observability: guard:blocked + lesson + adendo no store tipado", async () => {
    await evalTest(
      "EVAL-026/029: fixture real — write bloqueado → guard:blocked no .runecraft/events/<sessionId>.jsonl",
      async () => {
        const scenario: ScriptedScenario = {
          id: "F28-real-block",
          description: "bloqueio F24 observado pelo F28 (não é fluxo da matriz)",
          ...script([
            { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "README.md", content: "overwrite attempt" } } },
            { expect: { toolsSubset: ["read"] }, reply: { kind: "tool", name: "read", args: { path: "README.md" } } },
            { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
            { expect: { toolsSubset: ["read"] }, reply: { kind: "tool", name: "read", args: { path: "README.md" } } },
            { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done again" } },
          ]),
        };
        const fx = await setupEvalFixture({
          scenario,
          withRepo: true,
          beforeSession: ({ agentDir }) => {
            appendObservabilityExtension(agentDir);
          },
        });
        try {
          await fx.session.session.prompt("Update the repository: overwrite README.md, then stop.");
          // Segundo prompt (turno seguinte) → before_agent_start com o adendo
          // execution pendente (lição do gate que falhou — D6/F4).
          await fx.session.session.prompt("Continue.");
          const sessionId = fx.session.session.sessionId;
          const eventsFile = path.join(fx.repo!.dir, ".runecraft", "events", `${sessionId}.jsonl`);
          expect(fs.existsSync(eventsFile)).toBe(true);
          const events = fs
            .readFileSync(eventsFile, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l)) as Array<{ kind: string; seq: number; bundle: string; prevHash: string; payload: Record<string, unknown> }>;
          // Header: session:started com bundleHash full e prefixo 12 hex.
          const header = events[0]!;
          expect(header.kind).toBe("session:started");
          expect(header.seq).toBe(0);
          expect((header.payload.bundleHash as string).length).toBe(64);
          expect(header.bundle).toHaveLength(12);
          expect(header.prevHash).toBe(GENESIS_PREV_HASH);
          // Observação REAL do bloqueio (tool_execution_end — D7a).
          const blocked = events.find((e) => e.kind === "guard:blocked")!;
          expect(blocked).toBeDefined();
          expect(blocked.payload.guardId).toBe("writeExistingFile");
          expect(blocked.payload.reason).toContain("write-existing-file-guard:");
          // Lesson capturada (OBS-06) + adendo injetado no turno seguinte (D6).
          const captured = events.find((e) => e.kind === "lesson:captured")!;
          expect(captured.payload.gate).toBe("writeExistingFile");
          expect(typeof captured.payload.triggerSignature).toBe("string");
          const injected = events.find((e) => e.kind === "adendo:injected")!;
          expect(injected).toBeDefined();
          expect(injected.payload.track).toBe("execution");
          expect((injected.payload.lessonIds as string[]).length).toBe(1);
          // State de lessons com o record.
          const lessons = readLessonsFile(path.join(fx.repo!.dir, ".runecraft", "lessons.jsonl"));
          expect(lessons).toHaveLength(1);
          expect(lessons[0]!.count).toBe(1);
          // seq monotônico (0..n).
          const seqs = events.map((e) => e.seq);
          expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
          // Determinismo de identidade do store: seq/kind/bundle estáveis.
          expect(events.every((e) => typeof e.bundle === "string" && e.bundle.length === 12)).toBe(true);
          // fixture sem diagnóstico (nenhum desvio induzido).
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-029" },
    );
  });

  test("evidência gravada no partial (evalTest → last-run.json no merge)", async () => {
    await evalTest("EVAL-022..029: evidência via evalTest gravada (partial jsonl)", async () => {
      const partial = path.join(EVAL_PARTIAL_DIR, `${THIS_FILE}.jsonl`);
      expect(fs.existsSync(partial)).toBe(true);
      const lines = fs.readFileSync(partial, "utf8").trim().split("\n").filter(Boolean);
      for (const id of ["EVAL-022", "EVAL-023", "EVAL-024", "EVAL-025", "EVAL-026", "EVAL-027", "EVAL-028", "EVAL-029"]) {
        expect(lines.some((l) => l.includes(`"evalId":"${id}"`))).toBe(true);
      }
    }, { evalId: "EVAL-029" });
  });
});
