// framework/evaluators/deterministic.test.ts — EVAL-013: os 8 evaluators
// determinísticos (port adaptado do deterministic.test.ts do arcanum —
// mensagens RPG-free). Cobre: patterns passam/falham por kind, weight
// distribuído (distributeWeight — semântica arcanum), prompt vazio
// determinístico, tool-policy mismatch com reason, determinismo (2 runs
// idênticos — mensagens estáveis, F21 D10).
import { describe, expect, test } from "bun:test";
import { runDeterministicEvaluator } from "../../../../src/eval/evaluators/deterministic.ts";
import type { EvalArtifacts } from "../../../../src/eval/types.ts";

const ARTIFACTS: EvalArtifacts = {
  renderedPrompt: "<Role>Alpha</Role>\n<Review>Beta</Review>",
  toolPolicy: { write: false },
};

describe("EVAL-013 — contains-all / contains-any / excludes-all", () => {
  test("contains-all: todos os patterns presentes → pass", () => {
    const results = runDeterministicEvaluator({ kind: "contains-all", patterns: ["Alpha", "Beta"] }, ARTIFACTS);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("contains-all: pattern ausente → fail com reason estável", () => {
    const results = runDeterministicEvaluator({ kind: "contains-all", patterns: ["Alpha", "Nope"] }, ARTIFACTS);
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.passed).toBe(false);
    expect(results[1]!.message).toBe("Missing required pattern: Nope");
  });

  test("contains-any: um pattern basta", () => {
    const pass = runDeterministicEvaluator({ kind: "contains-any", patterns: ["Alpha", "Ghost"] }, ARTIFACTS);
    expect(pass[0]!.passed).toBe(true);
    const fail = runDeterministicEvaluator({ kind: "contains-any", patterns: ["Ghost", "Other"] }, ARTIFACTS);
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toContain("Expected one of:");
  });

  test("excludes-all: pattern proibido ausente → pass; presente → fail", () => {
    const pass = runDeterministicEvaluator({ kind: "excludes-all", patterns: ["forbidden"] }, ARTIFACTS);
    expect(pass[0]!.passed).toBe(true);
    const fail = runDeterministicEvaluator({ kind: "excludes-all", patterns: ["Alpha"] }, ARTIFACTS);
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toBe("Forbidden pattern present: Alpha");
  });
});

describe("EVAL-013 — section-contains-all / ordered-contains / xml-sections-present", () => {
  test("section-contains-all: pattern dentro da seção → pass", () => {
    const results = runDeterministicEvaluator({ kind: "section-contains-all", section: "Role", patterns: ["Alpha"] }, ARTIFACTS);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("section-contains-all: pattern fora da seção → fail", () => {
    const results = runDeterministicEvaluator({ kind: "section-contains-all", section: "Role", patterns: ["Beta"] }, ARTIFACTS);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  test("section-contains-all: seção ausente → fail com reason", () => {
    const results = runDeterministicEvaluator({ kind: "section-contains-all", section: "Plan", patterns: ["Alpha"] }, ARTIFACTS);
    expect(results.every((r) => !r.passed)).toBe(true);
    expect(results[0]!.message).toContain("Missing section Plan");
  });

  test("ordered-contains: ordem correta passa; fora de ordem falha", () => {
    const pass = runDeterministicEvaluator({ kind: "ordered-contains", patterns: ["<Role>", "<Review>"] }, ARTIFACTS);
    expect(pass.every((r) => r.passed)).toBe(true);
    const fail = runDeterministicEvaluator({ kind: "ordered-contains", patterns: ["<Review>", "<Role>"] }, ARTIFACTS);
    expect(fail.some((r) => !r.passed)).toBe(true);
    expect(fail[1]!.message).toContain("missing or out of order");
  });

  test("xml-sections-present: tags abertas e fechadas presentes → pass", () => {
    const results = runDeterministicEvaluator({ kind: "xml-sections-present", sections: ["Role"] }, ARTIFACTS);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("xml-sections-present: tag ausente → fail", () => {
    const results = runDeterministicEvaluator({ kind: "xml-sections-present", sections: ["Plan"] }, ARTIFACTS);
    expect(results[0]!.passed).toBe(false);
  });
});

describe("EVAL-013 — tool-policy / min-length / weight / prompt vazio", () => {
  test("tool-policy: expectation casa com o registry → pass", () => {
    const results = runDeterministicEvaluator({ kind: "tool-policy", expectations: { write: false } }, ARTIFACTS);
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.message).toContain("Tool policy matches for write: false");
  });

  test("tool-policy mismatch: tool ausente do registry ≠ esperado → fail com reason (undefined ≠ false documentado)", () => {
    const results = runDeterministicEvaluator({ kind: "tool-policy", expectations: { missing_tool: true } }, ARTIFACTS);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain("Tool policy mismatch for missing_tool: expected true, received undefined");
  });

  test("min-length: abaixo do mínimo → fail com comprimento no reason", () => {
    const fail = runDeterministicEvaluator({ kind: "min-length", min: 9999 }, ARTIFACTS);
    expect(fail[0]!.passed).toBe(false);
    expect(fail[0]!.message).toMatch(/below minimum/);
    const pass = runDeterministicEvaluator({ kind: "min-length", min: 1 }, ARTIFACTS);
    expect(pass[0]!.passed).toBe(true);
  });

  test("weight distribuído por item (distributeWeight — semântica arcanum)", () => {
    const results = runDeterministicEvaluator({ kind: "contains-all", patterns: ["a", "b", "c"], weight: 3 }, ARTIFACTS);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.maxScore === 1)).toBe(true);
  });

  test("prompt vazio → comportamento determinístico (score 0 / weight total)", () => {
    const results = runDeterministicEvaluator({ kind: "contains-all", patterns: ["x"], weight: 2 }, {});
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.score).toBe(0);
    expect(results[0]!.maxScore).toBe(2); // weight total (1 item)
    const minLength = runDeterministicEvaluator({ kind: "min-length", min: 1 }, {});
    expect(minLength[0]!.passed).toBe(false);
  });

  test("determinismo: 2 runs com os mesmos inputs → mesmos vereditos e mensagens", () => {
    const spec = { kind: "contains-all" as const, patterns: ["Alpha", "Ghost"], weight: 4 };
    const first = runDeterministicEvaluator(spec, ARTIFACTS);
    const second = runDeterministicEvaluator(spec, ARTIFACTS);
    expect(first).toEqual(second);
    // Mensagens estáveis — sem path absoluto/timestamp (F21 D10).
    for (const result of first) expect(result.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
