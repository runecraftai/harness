// framework/runner.test.ts — EVAL-012: runner in-process (port adaptado do
// runner.test.ts do arcanum).
//
// Suite sintética em temp dir (dados TS gravados em runtime → dynamic import
// pelo loader): um case por família de evaluator (dispatch de todos os
// kinds), filtros caseIds/tags e DETERMINISMO (2 runs → vereditos idênticos
// — D8). Os kinds section/xml falham POR CONSTRUÇÃO sobre o renderRules do
// harness (markdown, sem seções XML — dead weight documentado, D4:
// consumidores pós-F32); tool-policy mismatch (tool ausente do registry ≠
// esperado) e llm-judge com output vazio (fail determinístico) documentam
// os edges da spec.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import type { EvalCaseResult, EvalRunResult } from "../../../src/eval/types.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-runner-"));
}

/** Projeção determinística de um case (veredito — sem durationMs/runId). */
function verdictProjection(result: EvalRunResult): Array<{
  caseId: string;
  status: string;
  score: number;
  maxScore: number;
  messages: string[];
}> {
  return result.caseResults.map((c: EvalCaseResult) => ({
    caseId: c.caseId,
    status: c.status,
    score: c.score,
    maxScore: c.maxScore,
    messages: c.assertionResults.map((a) => a.message),
  }));
}

function writeSyntheticSuite(dir: string): void {
  fs.mkdirSync(path.join(dir, "suites"), { recursive: true });
  fs.mkdirSync(path.join(dir, "cases"), { recursive: true });
  // baselineDir default = <suitesDir>/baselines (F23 layout): vazio para o
  // baseline-diff exercitar o caminho no-regression (não degraded).
  fs.mkdirSync(path.join(dir, "baselines"), { recursive: true });
  fs.writeFileSync(path.join(dir, "baselines", "known-failures.txt"), "# runecraft harness — known failures (may only shrink)\n");
  const caseFile = (id: string, body: string): void => {
    fs.writeFileSync(path.join(dir, "cases", `${id}.ts`), `export default ${body}`);
  };

  caseFile("contains-all-pass", `{ id: "contains-all-pass", title: "Contains all", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "contains-all", patterns: ["Runecraft workflow rules"] }, { kind: "min-length", min: 100 }], tags: ["smoke"] }`);
  caseFile("ordered-contains-pass", `{ id: "ordered-contains-pass", title: "Ordered", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "ordered-contains", patterns: ["One driver per session", "goal-loop-audit — verifiable contract with an isolated auditor"] }], tags: ["smoke"] }`);
  caseFile("section-xml-fail", `{ id: "section-xml-fail", title: "XML sections (dead weight)", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "section-contains-all", section: "Role", patterns: ["Alpha"] }, { kind: "xml-sections-present", sections: ["Role"] }] }`);
  caseFile("tool-policy-mismatch", `{ id: "tool-policy-mismatch", title: "Tool policy mismatch", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "tool-policy", expectations: { no_such_tool: true } }] }`);
  caseFile("llm-judge-empty", `{ id: "llm-judge-empty", title: "LLM judge empty output", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "llm-judge", expectedContains: ["Runecraft"] }] }`);
  caseFile("trajectory-degrade", `{ id: "trajectory-degrade", title: "Trajectory degrade", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "trajectory-assertion", expectedSequence: ["write"] }] }`);
  caseFile("baseline-diff-pass", `{ id: "baseline-diff-pass", title: "Baseline diff no-regression", phase: "prompt", target: { kind: "prompt-render", agent: "pi" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "baseline-diff" }] }`);

  fs.writeFileSync(
    path.join(dir, "suites", "synthetic-smoke.ts"),
    `export default { id: "synthetic-smoke", title: "Synthetic smoke", phase: "prompt", caseFiles: ["../cases/contains-all-pass.ts", "../cases/ordered-contains-pass.ts", "../cases/section-xml-fail.ts", "../cases/tool-policy-mismatch.ts", "../cases/llm-judge-empty.ts", "../cases/trajectory-degrade.ts", "../cases/baseline-diff-pass.ts"] }`,
  );
}

describe("EVAL-012 — runner in-process (suite sintética TS)", () => {
  test("executa todos os kinds determinísticos + dispatch por família (sem crash)", async () => {
    const dir = makeTmp();
    try {
      writeSyntheticSuite(dir);
      const output = await runEvalSuite({ suitesDir: dir, suite: "synthetic-smoke" });
      const result = output.result;
      expect(result.suiteId).toBe("synthetic-smoke");
      expect(result.summary.totalCases).toBe(7);

      const byId = new Map(result.caseResults.map((c) => [c.caseId, c]));
      expect(byId.get("contains-all-pass")!.status).toBe("passed");
      expect(byId.get("ordered-contains-pass")!.status).toBe("passed");
      // Dead weight (D4): renderRules é markdown, sem seções XML → falha documentada.
      expect(byId.get("section-xml-fail")!.status).toBe("failed");
      expect(byId.get("section-xml-fail")!.assertionResults.every((a) => !a.passed)).toBe(true);
      // tool-policy: tool ausente do registry (prompt-render não expõe tools) ≠ esperado true.
      expect(byId.get("tool-policy-mismatch")!.status).toBe("failed");
      expect(byId.get("tool-policy-mismatch")!.assertionResults[0]!.message).toContain("Tool policy mismatch");
      // llm-judge: output vazio → fail determinístico (sem env → sem tier real).
      expect(byId.get("llm-judge-empty")!.status).toBe("failed");
      expect(byId.get("llm-judge-empty")!.assertionResults.some((a) => a.message.includes("missing 'Runecraft'"))).toBe(true);
      // trajectory-assertion sem trace → degrade com reason (não crasha).
      expect(byId.get("trajectory-degrade")!.status).toBe("failed");
      expect(byId.get("trajectory-degrade")!.assertionResults[0]!.message).toContain("missing or invalid");
      // baseline-diff sobre case que passou → no-regression.
      expect(byId.get("baseline-diff-pass")!.status).toBe("passed");
      expect(byId.get("baseline-diff-pass")!.assertionResults[0]!.message).toContain("No regression");
      // Evidence: [] (D6 — evidência via evalTest nos testes de fluxo).
      expect(output.evidencePaths).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("filtros caseIds/tags selecionam subconjunto", async () => {
    const dir = makeTmp();
    try {
      writeSyntheticSuite(dir);
      const byCaseIds = await runEvalSuite({
        suitesDir: dir,
        suite: "synthetic-smoke",
        filters: { caseIds: ["contains-all-pass", "baseline-diff-pass"] },
      });
      expect(byCaseIds.result.summary.totalCases).toBe(2);
      expect(byCaseIds.result.caseResults.map((c) => c.caseId).sort()).toEqual(["baseline-diff-pass", "contains-all-pass"]);

      const byTags = await runEvalSuite({
        suitesDir: dir,
        suite: "synthetic-smoke",
        filters: { tags: ["smoke"] },
      });
      expect(byTags.result.summary.totalCases).toBe(2);
      expect(byTags.result.caseResults.map((c) => c.caseId).sort()).toEqual(["contains-all-pass", "ordered-contains-pass"]);

      const none = await runEvalSuite({
        suitesDir: dir,
        suite: "synthetic-smoke",
        filters: { caseIds: ["nope"] },
      });
      expect(none.result.summary.totalCases).toBe(0);
      expect(none.result.summary.normalizedScore).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("determinismo: 2 runs da mesma suite → vereditos IDÊNTICOS (D8)", async () => {
    const dir = makeTmp();
    try {
      writeSyntheticSuite(dir);
      const first = await runEvalSuite({ suitesDir: dir, suite: "synthetic-smoke" });
      const second = await runEvalSuite({ suitesDir: dir, suite: "synthetic-smoke" });
      expect(verdictProjection(first.result)).toEqual(verdictProjection(second.result));
      expect(first.result.summary.normalizedScore).toBe(second.result.summary.normalizedScore);
      // Mensagens estáveis — sem path absoluto/timestamp (F21 D10).
      for (const c of first.result.caseResults) {
        for (const a of c.assertionResults) {
          expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(a.message).not.toMatch(os.tmpdir());
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
