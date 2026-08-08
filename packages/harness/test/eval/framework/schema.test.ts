// framework/schema.test.ts — EVAL-012: validação runtime hand-rolled do
// framework (port adaptado do schema.test.ts do arcanum — zero deps).
//
// O zod NÃO existe no dep tree (validado no Execute); os validators são
// hand-rolled (src/eval/schema.ts). Cobre: case válido por kind, kind
// desconhecido → hint, campos inválidos → motivo claro, weight/patterns
// vazios → comportamento determinístico do schema.
import { describe, expect, test } from "bun:test";
import { formatKindHint, validateCase, validateEvaluatorSpec, validateScenario, validateSuiteManifest } from "../../../src/eval/schema.ts";

describe("EVAL-012 — schema: cases válidos por kind (hand-rolled, zero deps)", () => {
  test("case prompt-render com evaluators determinísticos passa", () => {
    const result = validateCase({
      id: "smoke",
      title: "Smoke",
      phase: "prompt",
      target: { kind: "prompt-render", agent: "pi" },
      executor: { kind: "prompt-render" },
      evaluators: [
        { kind: "contains-all", patterns: ["<Role>"] },
        { kind: "contains-any", patterns: ["a", "b"] },
        { kind: "excludes-all", patterns: ["forbidden"] },
        { kind: "section-contains-all", section: "Role", patterns: ["Alpha"] },
        { kind: "ordered-contains", patterns: ["a", "b"] },
        { kind: "xml-sections-present", sections: ["Role", "Review"] },
        { kind: "tool-policy", expectations: { write: true } },
        { kind: "min-length", min: 10 },
        { kind: "llm-judge", expectedContains: ["x"], weight: 2 },
        { kind: "baseline-diff" },
        { kind: "trajectory-assertion", minTurns: 1 },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("case trajectory (single-turn-agent + trajectory-run) passa", () => {
    const result = validateCase({
      id: "write-guard-block",
      title: "Write guard",
      phase: "trajectory",
      target: { kind: "single-turn-agent", agent: "main", input: "do it" },
      executor: { kind: "trajectory-run", scenarioRef: "write-guard-block" },
      evaluators: [
        { kind: "trajectory-assertion", expectedSequence: ["write"], expectedDelegationTargets: ["write"], minTurns: 1, maxTurns: 3 },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("kind desconhecido → rejeitado com motivo + hint", () => {
    const result = validateCase({
      id: "bad",
      title: "Bad",
      phase: "prompt",
      target: { kind: "wrong", agent: "pi" },
      executor: { kind: "prompt-render" },
      evaluators: [{ kind: "contains-all", patterns: ["x"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = result.issues.map((i) => i.message).join("\n");
    expect(messages).toContain("target.kind esperado um de [prompt-render, single-turn-agent]");
  });

  test("evaluator kind desconhecido → hint com os kinds permitidos (formato arcanum)", () => {
    const result = validateEvaluatorSpec({ kind: "magic-llm", weight: 1 }, "evaluators[0]");
    expect(result.length).toBeGreaterThan(0);
    const hint = formatKindHint({ evaluators: [{ kind: "magic-llm" }] });
    expect(hint).toContain("Allowed evaluator.kind values");
    expect(hint).toContain("contains-all");
    expect(hint).toContain("trajectory-assertion");
    expect(result[0]!.message).toContain("evaluator.kind");
  });

  test("patterns vazio → rejeitado (schema — min 1)", () => {
    const result = validateEvaluatorSpec({ kind: "contains-all", patterns: [] });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.message).toContain("patterns esperado mínimo 1 item");
  });

  test("weight inválido (0 ou negativo) → rejeitado", () => {
    const zero = validateEvaluatorSpec({ kind: "contains-all", patterns: ["x"], weight: 0 });
    expect(zero.length).toBeGreaterThan(0);
    const negative = validateEvaluatorSpec({ kind: "contains-all", patterns: ["x"], weight: -1 });
    expect(negative.length).toBeGreaterThan(0);
  });

  test("expectations do tool-policy com valor não-boolean → rejeitado", () => {
    const result = validateEvaluatorSpec({ kind: "tool-policy", expectations: { write: "yes" } });
    expect(result.length).toBeGreaterThan(0);
  });

  test("executor trajectory-run sem scenarioRef → rejeitado", () => {
    const result = validateCase({
      id: "bad",
      title: "Bad",
      phase: "trajectory",
      target: { kind: "single-turn-agent", agent: "main" },
      executor: { kind: "trajectory-run" },
      evaluators: [{ kind: "min-length", min: 1 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "executor.scenarioRef")).toBe(true);
  });
});

describe("EVAL-012 — schema: suite manifest + cenário", () => {
  test("suite manifest válida passa", () => {
    const result = validateSuiteManifest({
      id: "constraint-adherence",
      title: "Constraint Adherence v1",
      phase: "trajectory",
      caseFiles: ["../cases/write-guard-block.ts"],
      tags: ["constraint-adherence"],
    });
    expect(result.ok).toBe(true);
  });

  test("suite sem caseFiles → rejeitada", () => {
    const result = validateSuiteManifest({ id: "x", title: "X", phase: "trajectory", caseFiles: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.message).toContain("caseFiles esperado mínimo 1 item");
  });

  test("cenário válido (shape do ScriptedScenario do fixture F21) passa", () => {
    const result = validateScenario({
      id: "write-guard-block",
      title: "Write guard",
      prompt: "do it",
      withRepo: true,
      scenario: {
        id: "write-guard-block",
        description: "x",
        steps: [{ expect: undefined, reply: { kind: "tool", name: "write", args: {} } }],
        stepFor: () => undefined,
        summary: () => "1:write",
      },
    });
    expect(result.ok).toBe(true);
  });

  test("cenário sem script → rejeitado", () => {
    const result = validateScenario({ id: "x", title: "X" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "scenario")).toBe(true);
  });
});
