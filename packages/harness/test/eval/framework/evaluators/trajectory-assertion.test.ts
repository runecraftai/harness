// framework/evaluators/trajectory-assertion.test.ts — EVAL-013: assertions
// sobre o trace REAL (port adaptado do trajectory-assertion.test.ts do
// arcanum). O HarnessTrace usa a SEMÂNTICA adaptada F26: delegationSequence
// = tool calls reais; delegationTargets = tool calls bloqueados. Cobre:
// expectedSequence/required/forbidden/min-maxTurns; trace ausente → degrade
// com reason; weight distribuído.
import { describe, expect, test } from "bun:test";
import { runTrajectoryAssertionEvaluator } from "../../../../src/eval/evaluators/trajectory-assertion.ts";
import type { EvalArtifacts, TrajectoryAssertionEvaluator, TrajectoryTrace } from "../../../../src/eval/types.ts";

function makeTrace(overrides: Partial<TrajectoryTrace> = {}): TrajectoryTrace {
  return {
    scenarioId: "write-guard-block",
    turns: [],
    delegationSequence: ["write", "write", "read"],
    delegationTargets: ["write"],
    totalTurns: 3,
    completedTurns: 3,
    ...overrides,
  };
}

function makeArtifacts(trace: TrajectoryTrace | null): EvalArtifacts {
  return { trace: trace ?? undefined };
}

describe("EVAL-013 — trajectory-assertion: expectedSequence", () => {
  test("sequência idêntica → pass", () => {
    const spec: TrajectoryAssertionEvaluator = { kind: "trajectory-assertion", expectedSequence: ["write", "write", "read"] };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace()));
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.message).toContain("matches");
  });

  test("sequência fora de ordem → fail com mismatch", () => {
    const spec: TrajectoryAssertionEvaluator = { kind: "trajectory-assertion", expectedSequence: ["read", "write"] };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace()));
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain("mismatch");
  });

  test("comprimento diferente → fail", () => {
    const spec: TrajectoryAssertionEvaluator = { kind: "trajectory-assertion", expectedSequence: ["write"] };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace()));
    expect(results[0]!.passed).toBe(false);
  });
});

describe("EVAL-013 — trajectory-assertion: expectedDelegationTargets (bloqueios F24)", () => {
  test("bloqueios idênticos → pass", () => {
    const spec: TrajectoryAssertionEvaluator = { kind: "trajectory-assertion", expectedDelegationTargets: ["write"] };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace()));
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.message).toContain("Blocked tool calls match");
  });

  test("sem bloqueio observado (guard off) → fail com diagnóstico", () => {
    const spec: TrajectoryAssertionEvaluator = { kind: "trajectory-assertion", expectedDelegationTargets: ["write"] };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace({ delegationTargets: [] })));
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain("expected [write], got []");
  });
});

describe("EVAL-013 — trajectory-assertion: required/forbidden", () => {
  test("requiredAgents: presentes → pass; ausente → fail", () => {
    const pass = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", requiredAgents: ["write", "read"] }, makeArtifacts(makeTrace()));
    expect(pass.every((r) => r.passed)).toBe(true);
    const fail = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", requiredAgents: ["bash"] }, makeArtifacts(makeTrace()));
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toContain("Required tool missing: bash");
  });

  test("forbiddenAgents: ausentes → pass; presente → fail", () => {
    const pass = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", forbiddenAgents: ["bash"] }, makeArtifacts(makeTrace()));
    expect(pass[0]!.passed).toBe(true);
    const fail = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", forbiddenAgents: ["write"] }, makeArtifacts(makeTrace()));
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toContain("Forbidden tool present: write");
  });

  test("requiredDelegationTargets/forbiddenDelegationTargets sobre os bloqueios", () => {
    const pass = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", requiredDelegationTargets: ["write"] }, makeArtifacts(makeTrace()));
    expect(pass[0]!.passed).toBe(true);
    const fail = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", forbiddenDelegationTargets: ["write"] }, makeArtifacts(makeTrace()));
    expect(fail[0]!.passed).toBe(false);
  });
});

describe("EVAL-013 — trajectory-assertion: min/maxTurns", () => {
  test("minTurns dentro → pass; abaixo → fail", () => {
    const pass = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", minTurns: 3 }, makeArtifacts(makeTrace()));
    expect(pass[0]!.passed).toBe(true);
    const fail = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", minTurns: 10 }, makeArtifacts(makeTrace()));
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toContain("below minimum");
  });

  test("maxTurns dentro → pass; acima → fail", () => {
    const pass = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", maxTurns: 5 }, makeArtifacts(makeTrace()));
    expect(pass[0]!.passed).toBe(true);
    const fail = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", maxTurns: 2 }, makeArtifacts(makeTrace()));
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toContain("exceeds maximum");
  });
});

describe("EVAL-013 — trajectory-assertion: edges", () => {
  test("trace ausente → degrade com reason (não crasha)", () => {
    const results = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion", expectedSequence: ["write"] }, makeArtifacts(null));
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain("missing or invalid");
  });

  test("sem assertions específicas → verifica turnos completos", () => {
    const results = runTrajectoryAssertionEvaluator({ kind: "trajectory-assertion" }, makeArtifacts(makeTrace()));
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.message).toContain("3 turns");
  });

  test("weight distribuído entre os tipos de assertion", () => {
    const spec: TrajectoryAssertionEvaluator = {
      kind: "trajectory-assertion",
      weight: 2,
      expectedSequence: ["write", "write", "read"],
      expectedDelegationTargets: ["write"],
      minTurns: 3,
    };
    const results = runTrajectoryAssertionEvaluator(spec, makeArtifacts(makeTrace()));
    expect(results).toHaveLength(3);
    for (const result of results) expect(result.maxScore).toBeCloseTo(2 / 3);
  });
});
