// framework/constraint-adherence.test.ts — EVAL-014: constraint adherence v1
// (sujeitos F24) via framework; EVAL-012: determinismo da suite real +
// evidência via evalTest() (F21 → partial/*.jsonl → last-run.json no merge).
//
// A suite roda o framework completo: loader (dados TS) → runner →
// single-turn-agent (sessão SDK in-process + fixture) → trajectory-run
// (transcript REAL) → trajectory-assertion + tool-policy. Os cases verdes
// (write-guard-block, ranger-md-only) passam com guards default fail-closed
// (D10). O caso adversarial (guard off no config) FALHA com diagnóstico —
// desvio induzido detectado DENTRO do framework (F24 T7 — nunca passa em
// silêncio). Offline/$0 por construção: loopback, apiKey literal, zero
// fetch externo (classificação fail-infra do setup.ts F21).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { runEvalSuite, runSingleCase } from "../../../src/eval/runner.ts";
import type { EvalCaseResult, EvalRunResult, TrajectoryTrace } from "../../../src/eval/types.ts";
import { EVAL_PARTIAL_DIR } from "../helpers/evalTest.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { writeGuardsState } from "../helpers/guardsState.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const THIS_FILE = "constraint-adherence.test.ts";

/** Projeção determinística dos vereditos (sem durationMs/runId/timestamps). */
function verdictProjection(result: EvalRunResult): Array<{ caseId: string; status: string; score: number; maxScore: number; messages: string[] }> {
  return result.caseResults.map((c: EvalCaseResult) => ({
    caseId: c.caseId,
    status: c.status,
    score: c.score,
    maxScore: c.maxScore,
    messages: c.assertionResults.map((a) => a.message),
  }));
}

describe("EVAL-014 — constraint adherence via framework (sujeitos F24)", () => {
  test("suite verde: write-guard-block + ranger-md-only passam; trace REAL + registry; evidência gravada", async () => {
    await evalTest("EVAL-014: suite constraint-adherence verde — guards F24 via framework", async () => {
      const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "constraint-adherence" });
      const result = output.result;
      expect(result.summary.totalCases).toBe(2);
      expect(result.summary.passedCases).toBe(2);
      expect(result.summary.failedCases).toBe(0);
      expect(result.summary.errorCases).toBe(0);

      const byId = new Map(result.caseResults.map((c) => [c.caseId, c]));

      // write-guard-block: transcript real → sequência + bloqueio + registry.
      const writeCase = byId.get("write-guard-block")!;
      const writeTrace = writeCase.artifacts.trace as TrajectoryTrace;
      expect(writeTrace.delegationSequence).toEqual(["write", "write"]);
      expect(writeTrace.delegationTargets).toEqual(["write"]);
      expect(writeTrace.totalTurns).toBe(3);
      expect(writeCase.artifacts.toolPolicy!.write).toBe(true);
      expect(writeCase.artifacts.toolPolicy!.read).toBe(true);

      // ranger-md-only: mesmo shape de trace (bloqueio ranger), registry real.
      const rangerCase = byId.get("ranger-md-only")!;
      const rangerTrace = rangerCase.artifacts.trace as TrajectoryTrace;
      expect(rangerTrace.delegationSequence).toEqual(["write", "write"]);
      expect(rangerTrace.delegationTargets).toEqual(["write"]);
      expect(rangerTrace.totalTurns).toBe(3);
      expect(rangerCase.artifacts.toolPolicy!.write).toBe(true);

      // Mensagens estáveis (F21 D10 — sem path absoluto/timestamp).
      for (const c of result.caseResults) {
        for (const a of c.assertionResults) {
          expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(a.message).not.toContain(TEST_EVAL_DIR);
        }
      }
    }, { evalId: "EVAL-014" });
    // Evidência via evalTest → partial/<testFile>.jsonl (D6/F21): o append
    // acontece no finally do wrapper — a checagem roda DEPOIS dele, senão o
    // arquivo ainda não existe na primeira execução (CI com checkout limpo).
    const partial = path.join(EVAL_PARTIAL_DIR, `${THIS_FILE}.jsonl`);
    expect(fs.existsSync(partial)).toBe(true);
    const lines = fs.readFileSync(partial, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.some((l) => l.includes('"evalId":"EVAL-014"'))).toBe(true);
  });

  test("determinismo: 2 runs da suite REAL → vereditos idênticos (EVAL-012/D8)", async () => {
    await evalTest("EVAL-012: determinismo da suite real — 2 runs com vereditos idênticos", async () => {
      const first = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "constraint-adherence" });
      const second = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "constraint-adherence" });
      expect(verdictProjection(first.result)).toEqual(verdictProjection(second.result));
      expect(first.result.summary.normalizedScore).toBe(second.result.summary.normalizedScore);
    }, { evalId: "EVAL-012" });
  });

  test("filtro caseIds seleciona subconjunto da suite real", async () => {
    await evalTest("EVAL-014: filtro caseIds na suite real", async () => {
      const output = await runEvalSuite({
        suitesDir: TEST_EVAL_DIR,
        suite: "constraint-adherence",
        filters: { caseIds: ["write-guard-block"] },
      });
      expect(output.result.summary.totalCases).toBe(1);
      expect(output.result.caseResults[0]!.caseId).toBe("write-guard-block");
      expect(output.result.caseResults[0]!.status).toBe("passed");
    }, { evalId: "EVAL-014" });
  });

  test("adversarial (case data): guard off no config → case FALHA com diagnóstico (EVAL-014 AC3)", async () => {
    await evalTest("EVAL-014 adversarial: guard off → o case falha com diagnóstico (nunca passa em silêncio)", async () => {
      const result = await runSingleCase({ suitesDir: TEST_EVAL_DIR, caseFile: "adversarial-guard-off.ts" });
      expect(result.status).not.toBe("passed");
      const diagnosis = [...result.errors, ...result.assertionResults.map((a) => a.message)].join("\n");
      expect(diagnosis).toContain("desvio induzido");
      expect(diagnosis).toContain("write-existing-file-guard");
    }, { evalId: "EVAL-014" });
  });

  test("adversarial (desvio induzido): runner-level beforeSession desliga o guard → case verde falha alto", async () => {
    await evalTest("EVAL-014 adversarial: desvio induzido no runner → case verde vira error com diagnóstico", async () => {
      const output = await runEvalSuite({
        suitesDir: TEST_EVAL_DIR,
        suite: "constraint-adherence",
        filters: { caseIds: ["write-guard-block"] },
        beforeSession: ({ repoDir }) => {
          writeGuardsState(repoDir, { writeExistingFile: { enabled: false } });
        },
      });
      const caseResult = output.result.caseResults[0]!;
      expect(caseResult.status).not.toBe("passed");
      expect(caseResult.errors.join("\n")).toContain("write-existing-file-guard");
    }, { evalId: "EVAL-014" });
  });
});
