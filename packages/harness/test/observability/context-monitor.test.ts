// observability/context-monitor.test.ts — context monitor + token state (T4,
// D4, OBS-04/05).
//
// Port puro do checkContextWindow (0.8 → warn, 0.95 → recover); token-state
// (updateUsage só com inputTokens > 0; latest não cumulativo); parse do
// token-budget do taskflow (fixture com o shape REAL verificado em
// `.pi/taskflows/runs/token-budget/<id>.json` — `phases` OBJECT keyed por
// phase id, usage{input,output,cacheRead,cacheWrite,cost,contextTokens}).
import { describe, expect, test } from "bun:test";
import { checkContextWindow, parseTokenBudgetRun } from "../../src/observability/context-monitor.ts";
import { TokenState } from "../../src/observability/token-state.ts";

const THRESHOLDS = { warningPct: 0.8, criticalPct: 0.95 };

describe("context-monitor — port puro do checkContextWindow (0.8/0.95)", () => {
  test("usagePct 0.85 → warn; 0.97 → recover; 0.5 → none", () => {
    expect(checkContextWindow({ usedTokens: 850, maxTokens: 1000 }, THRESHOLDS).action).toBe("warn");
    expect(checkContextWindow({ usedTokens: 970, maxTokens: 1000 }, THRESHOLDS).action).toBe("recover");
    expect(checkContextWindow({ usedTokens: 500, maxTokens: 1000 }, THRESHOLDS).action).toBe("none");
    // Exatos no limiar (inclusivos — D5).
    expect(checkContextWindow({ usedTokens: 800, maxTokens: 1000 }, THRESHOLDS).action).toBe("warn");
    expect(checkContextWindow({ usedTokens: 950, maxTokens: 1000 }, THRESHOLDS).action).toBe("recover");
  });

  test("desconhecido (tokens null / maxTokens 0) → none sem mensagem (pós-compactação)", () => {
    expect(checkContextWindow({ usedTokens: null, maxTokens: 1000 }, THRESHOLDS)).toEqual({ action: "none", usagePct: null, message: null });
    expect(checkContextWindow({ usedTokens: 500, maxTokens: 0 }, THRESHOLDS)).toEqual({ action: "none", usagePct: null, message: null });
  });

  test("determinismo: 2 runs com o mesmo input → mesma decisão", () => {
    const input = { usedTokens: 870, maxTokens: 1000 };
    expect(checkContextWindow(input, THRESHOLDS)).toEqual(checkContextWindow(input, THRESHOLDS));
  });
});

describe("token-state — port do session-token-state (OBS-05)", () => {
  test("updateUsage só com inputTokens > 0; LATEST não cumulativo", () => {
    const state = new TokenState();
    state.updateUsage(0);
    expect(state.snapshot().usedTokens).toBe(0);
    state.updateUsage(-5);
    expect(state.snapshot().usedTokens).toBe(0);
    state.setContextLimit(1000);
    state.updateUsage(300);
    state.updateUsage(500); // latest, não cumulativo
    expect(state.snapshot()).toEqual({ maxTokens: 1000, usedTokens: 500 });
    // setContextLimit não sobrescreve usedTokens.
    state.setContextLimit(2000);
    expect(state.snapshot()).toEqual({ maxTokens: 2000, usedTokens: 500 });
    state.clearSession();
    expect(state.snapshot()).toEqual({ maxTokens: 0, usedTokens: 0 });
  });
});

describe("token-budget do taskflow — parse do shape REAL (QA-5, bridge)", () => {
  test("parse do fixture (phases OBJECT keyed por phase id — shape verificado no disco)", () => {
    const run = parseTokenBudgetRun({
      runId: "token-budget-msirwcbr-46e167",
      flowName: "token-budget",
      def: { name: "token-budget", budget: { maxTokens: 10 } },
      status: "completed",
      phases: {
        run: {
          id: "run",
          status: "done",
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 7, turns: 0 },
        },
      },
    });
    expect(run).not.toBeNull();
    expect(run!.runId).toBe("token-budget-msirwcbr-46e167");
    expect(run!.maxTokens).toBe(10);
    expect(run!.status).toBe("completed");
    expect(run!.usage).toEqual({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 7 });
  });

  test("agrega across phases; contextTokens = gauge do último phase (não aditivo)", () => {
    const run = parseTokenBudgetRun({
      runId: "r1",
      def: { budget: { maxTokens: 2000 } },
      phases: {
        a: { usage: { input: 100, output: 10, cacheRead: 5, cacheWrite: 2, cost: 0.5, contextTokens: 900 } },
        b: { usage: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.2, contextTokens: 1200 } },
      },
    });
    expect(run!.usage.input).toBe(150);
    expect(run!.usage.output).toBe(15);
    expect(run!.usage.contextTokens).toBe(1200); // último phase (latest, não soma)
  });

  test("shape inválido → null (fail-soft, sem fabricação)", () => {
    expect(parseTokenBudgetRun(null)).toBeNull();
    expect(parseTokenBudgetRun({})).toBeNull();
    expect(parseTokenBudgetRun({ runId: "x", phases: [] })).not.toBeNull(); // phases ausente é tolerado
  });
});
