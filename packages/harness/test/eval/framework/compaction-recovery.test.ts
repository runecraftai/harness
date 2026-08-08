// framework/compaction-recovery.test.ts — EVAL-017..021: Resilience & Continuity
// (F27) via framework F26.
//
// Categoria compaction-recovery do eval-coverage (bloqueada no F26 — "após
// F27") agora com entradas (EVAL-MATRIX v5). Tudo determinístico e offline/$0
// (QA-5 — sem compactação real no fixture; o trigger é exercitado via handler
// exportado com eventos scriptados):
//   EVAL-017 continuation builder (puro) — marker/progresso/pendências,
//     scoping, determinismo, invariante D7;
//   EVAL-018 todo preserver — snapshot/restore decisions (D3/D7);
//   EVAL-019 stall detection — traces scriptados + relógio fake (D4);
//   EVAL-020 classify + fallback policy — multi-trigger, stop-all/skip-and-
//     continue, orçamento, modelSwitch NO-OP (D5/D6);
//   EVAL-021 fluxo completo de recuperação — wiring com eventos scriptados
//     (session_compact sintético → before_agent_start encadeado) + invariante
//     F24 em sessão glla REAL (suite recovery-flow: pendências completáveis →
//     complete_goal verde, sem phantom-block AD-024).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import type { EvalRunResult, TrajectoryTrace } from "../../../src/eval/types.ts";
import { EVAL_PARTIAL_DIR, evalTest } from "../helpers/evalTest.ts";
import { buildContinuationPrompt, deriveContinuationState, isSessionScoped, readGoalState } from "../../../src/resilience/continuation.ts";
import { decideRestore, captureTaskListSnapshot, restorePayload } from "../../../src/resilience/todo-preserver.ts";
import { argsHash, backoffMs, detectStall, textFingerprint } from "../../../src/resilience/stall.ts";
import { classifyFailure, isQuotaError } from "../../../src/resilience/classify.ts";
import { EscalationBudget, resolveFallbackAction } from "../../../src/resilience/fallback.ts";
import { defaultResilienceConfig } from "../../../src/resilience/config.ts";
import type { ContinuationTask } from "../../../src/resilience/types.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const THIS_FILE = "compaction-recovery.test.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-f27-"));
}

function task(id: string, title: string, status: string): ContinuationTask {
  return { id, title, status };
}

/** Ledger fake no formato validado do glla (.pi-glla/active.jsonl). */
function writeLedger(cwd: string, goal: Record<string, unknown> | null): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function activeGoal3of5(): Record<string, unknown> {
  return {
    status: "active",
    id: "g1",
    objective: "Ship F27",
    autoContinue: true,
    taskList: {
      version: 1,
      tasks: [
        task("1", "T1", "complete"),
        task("2", "T2", "complete"),
        task("3", "T3", "complete"),
        task("4", "T4", "pending"),
        task("5", "T5", "in_progress"),
      ],
    },
  };
}

const META = { workSummary: null, continuationCount: 0, stallCount: 0, lastSessionId: "s1" };
const THRESHOLDS = defaultResilienceConfig().stall;
const ESCALATION = defaultResilienceConfig().escalation;

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

describe("EVAL-017 — continuation builder (puro, determinístico)", () => {
  test("goal 3/5 → prompt com marker, progresso 3/5 e pendências 4,5 (nunca completas)", async () => {
    await evalTest("EVAL-017: continuation builder — goal 3/5 → marker/progresso/próxima; determinismo", async () => {
      const dir = makeTmp();
      try {
        writeLedger(dir, activeGoal3of5());
        const read = readGoalState(dir);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        const state = deriveContinuationState(read.goal, META)!;
        const prompt = buildContinuationPrompt(state, "repo")!;
        expect(prompt).toContain("<!-- runecraft:continuation -->");
        expect(prompt).toContain("Goal: Ship F27");
        expect(prompt).toContain("Progress: 3/5 tasks complete");
        expect(prompt).toContain("T4");
        expect(prompt).toContain("T5");
        expect(prompt).not.toContain("- 1. T1"); // D7: completas nunca re-injetadas
        // 2 runs idênticos (AC5 — F21 D10).
        const again = buildContinuationPrompt(state, "repo");
        expect(again).toBe(prompt);
        expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        expect(prompt).not.toContain(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-017" });
  });

  test("goal completo → null; sessão não-scoped → isSessionScoped false (AC4)", async () => {
    await evalTest("EVAL-017: goal completo → null; sessão errada → null (scoping)", async () => {
      const dir = makeTmp();
      try {
        writeLedger(dir, { ...activeGoal3of5(), status: "complete", autoContinue: false });
        const read = readGoalState(dir);
        if (!read.ok) return;
        const state = deriveContinuationState(read.goal, META)!;
        expect(buildContinuationPrompt(state, "repo")).toBeNull();
        expect(isSessionScoped(state, "sess-other")).toBe(false); // ownership em "s1"
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-017" });
  });
});

describe("EVAL-018 — todo preserver (D3/D7)", () => {
  test("snapshot capturado; sobreviveu → no-op; wipe → no-op com D7; payload deriva do atual", async () => {
    await evalTest("EVAL-018: todo preserver — snapshot/restore decisions; payload só do ledger atual", async () => {
      const dir = makeTmp();
      try {
        writeLedger(dir, activeGoal3of5());
        const read = readGoalState(dir);
        if (!read.ok) return;
        const snapshot = captureTaskListSnapshot(read.goal);
        expect(snapshot).toHaveLength(5);

        // Sobreviveu (ledger intacto pós-compactação) → no-op (semântica arcanum).
        const survived = decideRestore(snapshot!, snapshot);
        expect(survived.action).toBe("no-op");
        expect(survived.reason).toContain("survived compaction");

        // Ledger sem taskList → no-op SEMPRE (invariante D7 — snapshot nunca é re-injetado).
        const wiped = decideRestore(null, snapshot);
        expect(wiped.action).toBe("no-op");
        expect(wiped.reason).toContain("never re-injected");

        // Payload de restore: pendências do ATUAL no formato v1 do propose_task_list.
        const state = deriveContinuationState(read.goal, META)!;
        expect(restorePayload(state)).toEqual({ tasks: [{ title: "T4" }, { title: "T5" }] });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-018" });
  });
});

describe("EVAL-019 — stall detection (puro + determinismo)", () => {
  test("repetição 3x / output idêntico / wedge / heartbeat com relógio fake", async () => {
    await evalTest("EVAL-019: stall — repetition 3x, output idêntico, wedge, heartbeat (relógio fake)", async () => {
      const hash = argsHash({ command: "echo same" });
      const base = {
        toolCalls: [
          { tool: "bash", argsHash: hash, at: 1 },
          { tool: "bash", argsHash: hash, at: 2 },
          { tool: "bash", argsHash: hash, at: 3 },
        ],
        outputs: [
          { fingerprint: textFingerprint("retry on port 8081"), text: "retry on port 8081", at: 1 },
          { fingerprint: textFingerprint("retry on port 8082"), text: "retry on port 8082", at: 2 },
        ],
        lastActivityAt: 1,
        session: { idle: false, pending: false },
        timerPending: false,
        consecutiveStalls: 0,
        lastWedgeAlertAt: 0,
        suppression: { auditInFlight: false, postCompactionGraceUntil: 0, extensionApiStale: false },
      };
      const signals = detectStall(base, { now: 31 * 60_000, thresholds: THRESHOLDS, supervising: true });
      expect(signals.some((s) => s.type === "repetition")).toBe(true);
      expect(signals.some((s) => s.type === "identical-output")).toBe(true);
      expect(signals.some((s) => s.type === "wedge")).toBe(true);
      // Determinismo: 2 runs → mesmos sinais.
      expect(signals).toEqual(detectStall(base, { now: 31 * 60_000, thresholds: THRESHOLDS, supervising: true }));
      // Heartbeat com sessão ociosa.
      const idle = { ...base, session: { idle: true, pending: false }, lastActivityAt: 0 };
      expect(detectStall(idle, { now: 60_000, thresholds: THRESHOLDS, supervising: true }).some((s) => s.type === "heartbeat")).toBe(true);
      // Backoff ladder (fork).
      expect(backoffMs(5)).toBe(300_000);
    }, { evalId: "EVAL-019" });
  });
});

describe("EVAL-020 — classify + fallback policy (D5/D6)", () => {
  test("429/timeout/stall → classe + sugestão; stop-all esgota → HALT; skip-and-continue → skip; orçamento → HALT; modelSwitch NO-OP", async () => {
    await evalTest("EVAL-020: classify+fallback — multi-trigger, escalação, orçamento, modelSwitch NO-OP", async () => {
      // Classificação (D5).
      expect(isQuotaError("429 rate limit")).toBe(true);
      expect(classifyFailure({ error: "429 Retry-After: 30" }).class).toBe("infra");
      expect(classifyFailure({ timedOut: true }).class).toBe("infra");
      expect(classifyFailure({ stallSignals: [{ type: "repetition", reason: "r", at: 0 }] }).class).toBe("agent");
      expect(classifyFailure({}).class).toBe("unknown");

      // Fallback (D6): trigger → ação certa.
      expect(resolveFallbackAction({ trigger: "rate-limit", policy: "stop-all", escalation: ESCALATION, budget: new EscalationBudget(3) }).action!.kind).toBe("retry");
      expect(resolveFallbackAction({ trigger: "stall", policy: "stop-all", escalation: ESCALATION, budget: new EscalationBudget(3), consecutiveStalls: 1 }).action!.kind).toBe("re-inject-continuation");

      // stop-all: orçamento esgotado → HALT com reason.
      const budget = new EscalationBudget(1);
      budget.spend();
      const halt = resolveFallbackAction({ trigger: "stall", policy: "stop-all", escalation: ESCALATION, budget });
      expect(halt.action!.kind).toBe("halt");
      expect(halt.action!.reason).toContain("escalation budget exhausted");

      // skip-and-continue: orçamento esgotado → veredito skip (padrão F25 SKIP).
      const budget2 = new EscalationBudget(1);
      budget2.spend();
      const skip = resolveFallbackAction({ trigger: "stall", policy: "skip-and-continue", escalation: ESCALATION, budget: budget2 });
      expect(skip.action).toBeNull();
      expect(skip.verdict).toBe("skip");

      // modelSwitch: interface NO-OP (fronteira F30 — nunca toca settings/modelRoles).
      const switched = resolveFallbackAction({ trigger: "rate-limit", retryCount: 1, policy: "stop-all", escalation: ESCALATION, budget: new EscalationBudget(3) });
      expect(switched.action!.kind).toBe("modelSwitch");
      expect(switched.action!.noop).toBe(true);
      expect(Object.keys(switched.action!)).not.toContain("model");
    }, { evalId: "EVAL-020" });
  });
});

describe("EVAL-021 — fluxo completo de recuperação (invariante F24 + wiring)", () => {
  test("wiring QA-5: session_compact sintético → before_agent_start devolve systemPrompt ENCADEADO com o marker", async () => {
    await evalTest("EVAL-021: wiring — session_compact sintético → continuação injetada (systemPrompt encadeado)", async () => {
      // Handler exportado com evento scriptado (QA-5): fake pi dirige o
      // installResilience — session_start (resume) registra ownership, o
      // session_compact sintético marca pending e o before_agent_start anexa
      // o prompt de continuação ao systemPrompt corrente (chaining real —
      // runner.js emitBeforeAgentStart).
      const { installResilience } = await import("../../../src/extensions/resilience.ts");
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        writeLedger(repo, activeGoal3of5());
        const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
        const commands = new Map();
        const fakePi = {
          on(event: string, h: (e: unknown, c: unknown) => unknown) {
            const list = handlers.get(event) ?? [];
            list.push(h);
            handlers.set(event, list);
          },
          registerCommand(name: string, opts: unknown) {
            commands.set(name, opts);
          },
          sendUserMessage() {},
          getSessionName() {
            return undefined;
          },
        };
        installResilience(fakePi as never, { env: process.env });
        const ctx = {
          cwd: repo,
          mode: "rpc",
          hasUI: false,
          ui: {},
          sessionManager: { getSessionId: () => "sess-1" },
          modelRegistry: {},
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
        await emit("session_start", { type: "session_start", reason: "resume" });
        await emit("session_compact", { type: "session_compact", compactionEntry: {}, fromExtension: false, reason: "threshold", willRetry: false });
        const result = (await emit("before_agent_start", { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} })) as { systemPrompt?: string } | undefined;
        expect(result).toBeDefined();
        expect(result!.systemPrompt!.startsWith("BASE_PROMPT\n\n")).toBe(true); // encadeado, não sobrescreve
        expect(result!.systemPrompt!).toContain("runecraft:continuation");
        expect(result!.systemPrompt!).toContain("Progress: 3/5 tasks complete");
        expect(result!.systemPrompt!).toContain("T4");
        expect(result!.systemPrompt!).toContain("T5");
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-021" });
  });

  test("invariante F24 em sessão glla REAL: recovery-flow verde — pendências completáveis → complete_goal verde", async () => {
    await evalTest("EVAL-021: invariante F24 — suite compaction-recovery verde (complete_goal sem phantom-block)", async () => {
      const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "compaction-recovery" });
      const result = output.result;
      expect(result.summary.totalCases).toBe(1);
      expect(result.summary.passedCases).toBe(1);
      expect(result.summary.failedCases).toBe(0);
      expect(result.summary.errorCases).toBe(0);
      const recovery = result.caseResults[0]!;
      expect(recovery.caseId).toBe("recovery-flow");
      const trace = recovery.artifacts.trace as TrajectoryTrace;
      // O complete_goal bloqueado (pendências 4,5) é o alvo do trace — o
      // enforcer F24 bloqueou; após completar 4 e 5 o complete_goal passa.
      expect(trace.delegationTargets).toContain("complete_goal");
      expect(trace.delegationSequence).toContain("complete_goal");
      // Mensagens estáveis (F21 D10).
      for (const a of recovery.assertionResults) {
        expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        expect(a.message).not.toContain(TEST_EVAL_DIR);
      }
    }, { evalId: "EVAL-021" });
  });

  test("composição: pending do builder == pendências do enforcer (mesma derivação do ledger)", async () => {
    await evalTest("EVAL-021: composição — a continuação re-injeta exatamente o conjunto completável", async () => {
      const dir = makeTmp();
      try {
        writeLedger(dir, activeGoal3of5());
        // Builder (F27): pendências derivadas do ledger.
        const read = readGoalState(dir);
        if (!read.ok) return;
        const state = deriveContinuationState(read.goal, META)!;
        const promptPending = state.pending.map((t) => t.id).sort();
        expect(promptPending).toEqual(["4", "5"]);
        // Enforcer (F24): o MESMO ledger → as pendências que bloqueiam
        // complete_goal são as mesmas que a continuação re-injeta.
        const { readGllaTaskList, collectPendingTasks } = await import("../../../src/guards/todo-writer.ts");
        const enforcer = readGllaTaskList(dir);
        expect(enforcer.ok).toBe(true);
        if (enforcer.ok && enforcer.tasks) {
          const enforcerPending = collectPendingTasks(enforcer.tasks).map((p) => p.split(" ")[0]).sort();
          expect(enforcerPending).toEqual(promptPending);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-021" });
  });

  test("evidência gravada no partial (evalTest → last-run.json no merge)", async () => {
    await evalTest("EVAL-021: evidência via evalTest gravada (partial jsonl)", async () => {
      const partial = path.join(EVAL_PARTIAL_DIR, `${THIS_FILE}.jsonl`);
      expect(fs.existsSync(partial)).toBe(true);
      const lines = fs.readFileSync(partial, "utf8").trim().split("\n").filter(Boolean);
      expect(lines.some((l) => l.includes('"evalId":"EVAL-021"'))).toBe(true);
    }, { evalId: "EVAL-021" });
  });
});
