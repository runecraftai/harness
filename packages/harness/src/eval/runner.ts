// eval/runner.ts — runner in-process de suites (F26, D1/D7).
//
// Port do runner.ts do arcanum com a MESMA semântica (resolve → execute →
// evaluate → assertions → summary) e as adaptações F26:
//   - dados TS via loader (dynamic import — QA-1);
//   - targets prompt-render | single-turn-agent; executors prompt-render |
//     trajectory-run (model-response fora — D9);
//   - trajectory-run usa o transcript REAL do fixture (QA-2);
//   - baseline-diff rodado DEPOIS dos demais evaluators com o resultado cru
//     do case (EVAL-015 — comparador vs ratchet F23);
//   - llm-judge async (tier real env-gated via VerifyDeps.judgeAdapter — F25);
//   - evidência NÃO via storage próprio (D6): os testes de fluxo gravam via
//     evalTest() do F21 → evidence/partial → last-run.json (F23).
import { randomBytes } from "node:crypto";
import * as path from "node:path";
import { runBaselineDiffEvaluator } from "./evaluators/baseline-diff.ts";
import { runDeterministicEvaluator } from "./evaluators/deterministic.ts";
import { runLlmJudgeEvaluator } from "./evaluators/llm-judge.ts";
import { runTrajectoryAssertionEvaluator } from "./evaluators/trajectory-assertion.ts";
import { executeTrajectoryRun } from "./executors/trajectory-run.ts";
import { loadCaseFile, loadCasesForSuite, loadSuite } from "./loader.ts";
import { formatEvalSummary } from "./reporter.ts";
import { executePromptRender, resolvePromptRenderTarget } from "./targets/prompt-render.ts";
import { resolveSingleTurnAgentTarget } from "./targets/single-turn-agent.ts";
import type {
  AssertionResult,
  BaselineDiffEvaluator,
  EvalArtifacts,
  EvalCaseResult,
  EvalRunResult,
  EvalRunSummary,
  ExecutionContext,
  LoadedEvalCase,
  ResolvedTarget,
  RunEvalSuiteOptions,
} from "./types.ts";

function createRunId(): string {
  return `eval_${randomBytes(6).toString("hex")}`;
}

function matchesFilters(evalCase: LoadedEvalCase, filters: RunEvalSuiteOptions["filters"]): boolean {
  if (!filters) return true;

  if (filters.caseIds && filters.caseIds.length > 0 && !filters.caseIds.includes(evalCase.id)) {
    return false;
  }

  if (filters.agents && filters.agents.length > 0) {
    const agent =
      evalCase.target.kind === "prompt-render" ? (evalCase.target.agent ?? "pi") : evalCase.target.agent;
    if (!filters.agents.includes(agent)) {
      return false;
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    const tags = new Set(evalCase.tags ?? []);
    if (!filters.tags.every((tag) => tags.has(tag))) {
      return false;
    }
  }

  return true;
}

function resolveTarget(evalCase: LoadedEvalCase): ResolvedTarget {
  switch (evalCase.target.kind) {
    case "prompt-render":
      return resolvePromptRenderTarget(evalCase.target);
    case "single-turn-agent":
      return resolveSingleTurnAgentTarget(evalCase.target);
  }
}

async function executeExecutor(
  evalCase: LoadedEvalCase,
  resolvedTarget: ResolvedTarget,
  context: ExecutionContext,
): Promise<EvalArtifacts> {
  switch (evalCase.executor.kind) {
    case "prompt-render":
      return executePromptRender(resolvedTarget, evalCase.executor, context);
    case "trajectory-run":
      return executeTrajectoryRun(resolvedTarget, evalCase.executor, context);
  }
}

async function executeCase(evalCase: LoadedEvalCase, context: ExecutionContext): Promise<EvalCaseResult> {
  const started = Date.now();

  try {
    const resolvedTarget = resolveTarget(evalCase);
    const artifacts = await executeExecutor(evalCase, resolvedTarget, context);

    const assertionResults: AssertionResult[] = [];
    const baselineDiffSpecs: BaselineDiffEvaluator[] = [];
    for (const evaluator of evalCase.evaluators) {
      if (evaluator.kind === "llm-judge") {
        assertionResults.push(
          ...(await runLlmJudgeEvaluator(evaluator, artifacts, { judgeAdapter: context.judgeAdapter })),
        );
      } else if (evaluator.kind === "trajectory-assertion") {
        assertionResults.push(...runTrajectoryAssertionEvaluator(evaluator, artifacts));
      } else if (evaluator.kind === "baseline-diff") {
        // EVAL-015: roda com o resultado CRU do case (status/failures antes dele).
        baselineDiffSpecs.push(evaluator);
      } else {
        assertionResults.push(...runDeterministicEvaluator(evaluator, artifacts));
      }
    }

    const rawStatus: EvalCaseResult["status"] = assertionResults.every((result) => result.passed)
      ? "passed"
      : "failed";
    const rawFailures = [
      ...assertionResults.filter((result) => !result.passed).map((result) => result.message),
      ...(artifacts.diagnosis ?? []),
    ];
    for (const spec of baselineDiffSpecs) {
      assertionResults.push(
        ...runBaselineDiffEvaluator(spec, {
          baselineDir: context.baselineDir,
          caseId: evalCase.id,
          status: rawStatus,
          failures: rawFailures,
        }),
      );
    }

    const rawScore = assertionResults.reduce((sum, result) => sum + result.score, 0);
    const maxScore = assertionResults.reduce((sum, result) => sum + result.maxScore, 0);
    const normalizedScore = maxScore > 0 ? rawScore / maxScore : 0;

    return {
      caseId: evalCase.id,
      description: evalCase.description,
      status: assertionResults.every((result) => result.passed) ? "passed" : "failed",
      score: rawScore,
      normalizedScore,
      maxScore,
      durationMs: Date.now() - started,
      artifacts,
      assertionResults,
      errors: [],
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      description: evalCase.description,
      status: "error",
      score: 0,
      normalizedScore: 0,
      maxScore: 0,
      durationMs: Date.now() - started,
      artifacts: {},
      assertionResults: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function buildSummary(caseResults: EvalCaseResult[]): EvalRunSummary {
  const totalScore = caseResults.reduce((sum, result) => sum + result.score, 0);
  const maxScore = caseResults.reduce((sum, result) => sum + result.maxScore, 0);
  return {
    totalCases: caseResults.length,
    passedCases: caseResults.filter((result) => result.status === "passed").length,
    failedCases: caseResults.filter((result) => result.status === "failed").length,
    errorCases: caseResults.filter((result) => result.status === "error").length,
    totalScore,
    normalizedScore: maxScore > 0 ? totalScore / maxScore : 0,
    maxScore,
  };
}

export interface RunEvalSuiteOutput {
  result: EvalRunResult;
  /** v1: [] — a evidência é gravada pelo evalTest() do F21 nos testes de
   *  fluxo (D6 — sem storage próprio). */
  evidencePaths: string[];
  consoleSummary: string;
}

export async function runEvalSuite(options: RunEvalSuiteOptions): Promise<RunEvalSuiteOutput> {
  const suite = await loadSuite(options.suitesDir, options.suite);
  const casesDir = path.join(options.suitesDir, "cases");
  const scenariosDir = path.join(options.suitesDir, "scenarios");
  const baselineDir = path.join(options.suitesDir, "baselines");

  const selectedCases = (await loadCasesForSuite(suite, casesDir)).filter((evalCase) =>
    matchesFilters(evalCase, options.filters),
  );

  const context: ExecutionContext = {
    mode: options.mode ?? "local",
    suitesDir: options.suitesDir,
    casesDir,
    scenariosDir,
    baselineDir,
    beforeSession: options.beforeSession,
    judgeAdapter: options.judgeAdapter,
    runMetadata: options.runMetadata,
  };

  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const caseResults: EvalCaseResult[] = [];
  for (const evalCase of selectedCases) {
    caseResults.push(await executeCase(evalCase, context));
  }
  const finishedAt = new Date().toISOString();

  const result: EvalRunResult = {
    runId,
    startedAt,
    finishedAt,
    suiteId: suite.id,
    phase: suite.phase,
    suiteMetadata: suite.suiteMetadata,
    runMetadata: context.runMetadata,
    summary: buildSummary(caseResults),
    caseResults,
  };

  const consoleSummary = formatEvalSummary(result);
  return { result, evidencePaths: [], consoleSummary };
}

/** Roda UM case pelo caminho (fora de uma suite — casos adversarial que
 *  falham por contrato, EVAL-014 AC3). Caminho relativo a <suitesDir>/cases
 *  ou absoluto. Mesma engine do runEvalSuite (executeCase + context). */
export async function runSingleCase(options: {
  suitesDir: string;
  /** ex.: "adversarial-guard-off.ts" (relativo a <suitesDir>/cases). */
  caseFile: string;
  beforeSession?: RunEvalSuiteOptions["beforeSession"];
  judgeAdapter?: RunEvalSuiteOptions["judgeAdapter"];
  mode?: RunEvalSuiteOptions["mode"];
}): Promise<EvalCaseResult> {
  const casesDir = path.join(options.suitesDir, "cases");
  const filePath = path.isAbsolute(options.caseFile) ? options.caseFile : path.join(casesDir, options.caseFile);
  const evalCase = await loadCaseFile(casesDir, filePath);
  const context: ExecutionContext = {
    mode: options.mode ?? "local",
    suitesDir: options.suitesDir,
    casesDir,
    scenariosDir: path.join(options.suitesDir, "scenarios"),
    baselineDir: path.join(options.suitesDir, "baselines"),
    beforeSession: options.beforeSession,
    judgeAdapter: options.judgeAdapter,
  };
  return executeCase(evalCase, context);
}
