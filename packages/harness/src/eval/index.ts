// eval/index.ts — exports públicos do framework de evals (F26, D1).
//
// Port do index.ts do arcanum (extensão registry-based): target/executor/
// evaluator novos = tipos + schema + handler; o runner não muda (D5).
// storage.ts do arcanum NÃO portado (D6 — evidência via evalTest() do F21).

export type {
  EvalPhase,
  EvalRoutingKind,
  EvalTarget,
  ExecutorSpec,
  EvaluatorSpec,
  EvalSuiteManifest,
  EvalSuiteMetadata,
  EvalCase,
  LoadedEvalCase,
  LoadedEvalSuiteManifest,
  EvalArtifacts,
  AssertionResult,
  EvalCaseResult,
  EvalRunMetadata,
  EvalRunResult,
  EvalRunSummary,
  RunEvalSuiteOptions,
  RunnerFilters,
  HarnessScenario,
  HarnessScenarioScript,
  TrajectoryScenario,
  TrajectoryTurn,
  TrajectoryTrace,
  TrajectoryTurnResult,
  TrajectoryAssertionEvaluator,
  SingleTurnAgentTarget,
  PromptRenderTarget,
} from "./types.ts";

export { isTrajectoryTrace } from "./types.ts";

export { validateCase, validateSuiteManifest, validateScenario, formatSchemaIssues, formatKindHint } from "./schema.ts";
export { EvalConfigError, loadSuite, loadCaseFile, loadCasesForSuite, loadScenario, resolveSuitePath } from "./loader.ts";
export { resolvePromptRenderTarget, executePromptRender } from "./targets/prompt-render.ts";
export { resolveSingleTurnAgentTarget } from "./targets/single-turn-agent.ts";
export { executeTrajectoryRun, buildHarnessTrace, deriveToolPolicy, deriveBlockedTools } from "./executors/trajectory-run.ts";
export { runDeterministicEvaluator } from "./evaluators/deterministic.ts";
export { runLlmJudgeEvaluator, buildEvalJudgePrompt, EVAL_JUDGE_PROMPT_VERSION } from "./evaluators/llm-judge.ts";
export { runTrajectoryAssertionEvaluator } from "./evaluators/trajectory-assertion.ts";
export { runBaselineDiffEvaluator, caseFailureIdentity } from "./evaluators/baseline-diff.ts";
export { formatEvalSummary, formatJobSummaryMarkdown } from "./reporter.ts";
export type { RunEvalSuiteOutput } from "./runner.ts";
export { runEvalSuite, runSingleCase } from "./runner.ts";
