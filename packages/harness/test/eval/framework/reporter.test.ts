// framework/reporter.test.ts — EVAL-012: reporter legível (port adaptado do
// reporter.test.ts do arcanum — sem suiteRole do guild; shape estável).
import { describe, expect, test } from "bun:test";
import { formatEvalSummary, formatJobSummaryMarkdown } from "../../../src/eval/reporter.ts";
import type { EvalCaseResult, EvalRunResult } from "../../../src/eval/types.ts";

function makeResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  const passing: EvalCaseResult = {
    caseId: "contains-all-pass",
    status: "passed",
    score: 1,
    normalizedScore: 1,
    maxScore: 1,
    durationMs: 10,
    artifacts: { renderedPrompt: "<Role>a</Role>" },
    assertionResults: [{ evaluatorKind: "contains-all", passed: true, score: 1, maxScore: 1, message: "Found required pattern: <Role>" }],
    errors: [],
  };
  const failing: EvalCaseResult = {
    caseId: "trajectory-degrade",
    status: "failed",
    score: 0,
    normalizedScore: 0,
    maxScore: 1,
    durationMs: 5,
    artifacts: {},
    assertionResults: [
      { evaluatorKind: "trajectory-assertion", passed: false, score: 0, maxScore: 1, message: "Trajectory trace missing or invalid in artifacts — cannot run trajectory assertions" },
    ],
    errors: [],
  };
  return {
    runId: "eval_test",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    suiteId: "constraint-adherence",
    phase: "trajectory",
    summary: { totalCases: 2, passedCases: 1, failedCases: 1, errorCases: 0, totalScore: 1, normalizedScore: 0.5, maxScore: 2 },
    caseResults: [passing, failing],
    ...overrides,
  };
}

describe("EVAL-012 — reporter: formatEvalSummary", () => {
  test("formata um resumo conciso da suite", () => {
    const summary = formatEvalSummary(makeResult());
    expect(summary).toContain("Suite constraint-adherence (trajectory)");
    expect(summary).toContain("Cases: 2");
    expect(summary).toContain("Normalized score: 0.50");
    expect(summary).toContain("Score: 1.00/2.00");
    expect(summary).toContain("Worst results:");
    expect(summary).toContain("trajectory-degrade");
    expect(summary).toContain("Trajectory trace missing or invalid");
  });

  test("todas passando → sem seção de piores resultados", () => {
    const summary = formatEvalSummary(makeResult({ caseResults: [makeResult().caseResults[0]!] }));
    expect(summary).not.toContain("Worst results:");
  });
});

describe("EVAL-012 — reporter: formatJobSummaryMarkdown", () => {
  test("renderiza a tabela Markdown com ids de case e ícones", () => {
    const md = formatJobSummaryMarkdown(makeResult());
    expect(md).toContain("## 🧪 Eval: constraint-adherence");
    expect(md).toContain("**Phase**: `trajectory`");
    expect(md).toContain("1/2 (50.0%)");
    expect(md).toContain("| Case | Result | Score |");
    expect(md).toContain("| contains-all-pass | ✅ Pass | 1.00 |");
    expect(md).toContain("| trajectory-degrade | ❌ Fail | 0.00 |");
    expect(md).toContain("Failed Case Details");
    expect(md).toContain("Trajectory trace missing or invalid");
  });

  test("todas passando → sem detalhes de falha", () => {
    const md = formatJobSummaryMarkdown(makeResult({ caseResults: [makeResult().caseResults[0]!] }));
    expect(md).not.toContain("Failed Case Details");
  });
});
