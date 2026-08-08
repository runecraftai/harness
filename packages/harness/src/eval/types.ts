// eval/types.ts — tipos do framework de evals (F26, D1/D8).
//
// Port RPG-free do types.ts do arcanum (packages/guild/src/features/evals/
// types.ts — supersedido, AD-001): MESMA semântica do ciclo
// resolve → execute → evaluate → assertions → summary, SEM aliases de
// tema (thread→rogue etc.), SEM agentes do guild pré-F32. Diferenças
// deliberadas vs a fonte:
//   - EvalTargetKind: prompt-render | single-turn-agent (sem builtin-agent-
//     prompt/custom-agent-prompt/trajectory-agent — os agentes do guild
//     ficam para o F32; o prompt do harness é renderRules() do F19).
//   - ExecutorKind: prompt-render | trajectory-run (model-response fora —
//     custo por chamada, D9; reavaliar com F22/F32).
//   - HarnessScenario: cenário de dados = ScriptedScenario do fixture F21
//     (QA-2 — trace REAL, não o replay mock-text do arcanum).
//   - TrajectoryTrace adaptado: delegationSequence = sequência de tool
//     calls do transcript real; delegationTargets = tool calls BLOQUEADOS
//     pelos guards F24 (documentado no case EVAL-014).

/** Fases de eval (port as-is do arcanum — sem tema RPG). */
export const EVAL_PHASES = ["prompt", "routing", "trajectory", "experimental"] as const;
export type EvalPhase = (typeof EVAL_PHASES)[number];

export const EVAL_ROUTING_KINDS = ["identity", "intent", "trajectory", "other"] as const;
export type EvalRoutingKind = (typeof EVAL_ROUTING_KINDS)[number];

export const EVAL_TARGET_KINDS = ["prompt-render", "single-turn-agent"] as const;
export type EvalTargetKind = (typeof EVAL_TARGET_KINDS)[number];

export const EXECUTOR_KINDS = ["prompt-render", "trajectory-run"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export const EVALUATOR_KINDS = [
  "contains-all",
  "contains-any",
  "excludes-all",
  "section-contains-all",
  "ordered-contains",
  "xml-sections-present",
  "tool-policy",
  "min-length",
  "llm-judge",
  "baseline-diff",
  "trajectory-assertion",
] as const;
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];

// --- Targets (D3) ---

/** Target de prompt do harness: renderRules() do F19 (v1 sem cases — os
 *  goldens do F23 já cobrem o render; consumidores pós-F30/F32). */
export interface PromptRenderTarget {
  kind: "prompt-render";
  /** id de agente da matriz (F17) — default "pi". */
  agent?: string;
}

/** Setup de workspace ANTES da sessão abrir (config de guards F24 no
 *  state.json do repo — D12: lida no session_start). Shape estrutural do
 *  beforeSession do fixture F21 (evalFixture.ts). */
export interface SessionSetupContext {
  base: string;
  repoDir: string;
  agentDir: string;
  env: NodeJS.ProcessEnv;
}

export type SessionSetupHandler = (ctx: SessionSetupContext) => void;

/** Target de sessão única: sessão SDK in-process com o fixture F21
 *  (helpers/sdkSession.ts) → transcript real → trace + tool registry. */
export interface SingleTurnAgentTarget {
  kind: "single-turn-agent";
  /** id do agente da sessão (default "main" — RUNECRAFT_AGENT_ID do F24). */
  agent: string;
  /** prompt de usuário (default: scenario.prompt). */
  input?: string;
  /** allowlist de tools da sessão (default: todas as extensões — config 1). */
  tools?: string[];
  /** bindExtensions (default true — session_start registra tools/config). */
  bindExtensions?: boolean;
  /** setup pré-sessão (ex.: state.json com guards F24 — adversarial). */
  beforeSession?: SessionSetupHandler;
}

export type EvalTarget = PromptRenderTarget | SingleTurnAgentTarget;

// --- Executors (D9) ---

export interface PromptRenderExecutor {
  kind: "prompt-render";
}

export interface TrajectoryRunExecutor {
  kind: "trajectory-run";
  /** id do cenário → scenarios/<id>.ts (QA-2: ScriptedScenario do fixture). */
  scenarioRef: string;
}

export type ExecutorSpec = PromptRenderExecutor | TrajectoryRunExecutor;

// --- Evaluators (D4) ---

export interface WeightedEvaluatorSpec {
  weight?: number;
}

export interface ContainsAllEvaluator extends WeightedEvaluatorSpec {
  kind: "contains-all";
  patterns: string[];
}

export interface ContainsAnyEvaluator extends WeightedEvaluatorSpec {
  kind: "contains-any";
  patterns: string[];
}

export interface ExcludesAllEvaluator extends WeightedEvaluatorSpec {
  kind: "excludes-all";
  patterns: string[];
}

export interface SectionContainsAllEvaluator extends WeightedEvaluatorSpec {
  kind: "section-contains-all";
  section: string;
  patterns: string[];
}

export interface OrderedContainsEvaluator extends WeightedEvaluatorSpec {
  kind: "ordered-contains";
  patterns: string[];
}

export interface XmlSectionsPresentEvaluator extends WeightedEvaluatorSpec {
  kind: "xml-sections-present";
  sections: string[];
}

export interface ToolPolicyEvaluator extends WeightedEvaluatorSpec {
  kind: "tool-policy";
  /** expectations: tool → deve estar habilitado (true) ou ausente (false).
   *  Tool ausente do registry da sessão = false (adaptação F26 — o registry
   *  do harness é a união dos tools dos requests reais do fixture). */
  expectations: Record<string, boolean>;
}

export interface MinLengthEvaluator extends WeightedEvaluatorSpec {
  kind: "min-length";
  min: number;
}

export interface LlmJudgeEvaluator extends WeightedEvaluatorSpec {
  kind: "llm-judge";
  rubricRef?: string;
  expectedContains?: string[];
  expectedAnyOf?: string[];
  forbiddenContains?: string[];
}

export interface BaselineDiffEvaluator extends WeightedEvaluatorSpec {
  kind: "baseline-diff";
  /** nome do baseline no baselineDir (default "known-failures.txt" — F23). */
  baselineRef?: string;
}

export interface TrajectoryAssertionEvaluator extends WeightedEvaluatorSpec {
  kind: "trajectory-assertion";
  assertionRef?: string;
  expectedSequence?: string[];
  expectedDelegationTargets?: string[];
  requiredAgents?: string[];
  requiredDelegationTargets?: string[];
  forbiddenAgents?: string[];
  forbiddenDelegationTargets?: string[];
  minTurns?: number;
  maxTurns?: number;
}

export type EvaluatorSpec =
  | ContainsAllEvaluator
  | ContainsAnyEvaluator
  | ExcludesAllEvaluator
  | SectionContainsAllEvaluator
  | OrderedContainsEvaluator
  | XmlSectionsPresentEvaluator
  | ToolPolicyEvaluator
  | MinLengthEvaluator
  | LlmJudgeEvaluator
  | BaselineDiffEvaluator
  | TrajectoryAssertionEvaluator;

// --- Dados (D2: TS modules — QA-1) ---

export interface EvalSuiteMetadata {
  title: string;
  routingKind?: EvalRoutingKind;
  familyId?: string;
  familyTitle?: string;
  viewId?: string;
  viewTitle?: string;
}

export interface EvalSuiteManifest {
  id: string;
  title: string;
  phase: EvalPhase;
  caseFiles: string[];
  suiteMetadata?: EvalSuiteMetadata;
  tags?: string[];
}

export interface EvalCase {
  id: string;
  title: string;
  description?: string;
  phase: EvalPhase;
  target: EvalTarget;
  executor: ExecutorSpec;
  evaluators: EvaluatorSpec[];
  tags?: string[];
  notes?: string;
}

export interface LoadedEvalSuiteManifest extends EvalSuiteManifest {
  filePath: string;
}

export interface LoadedEvalCase extends EvalCase {
  filePath: string;
}

// --- Cenários (QA-2: ScriptedScenario do fixture F21) ---

export type HarnessScenarioReply =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "text"; text: string };

export interface HarnessScenarioStep {
  expect?: unknown;
  reply: HarnessScenarioReply;
}

/** Shape estrutural do ScriptedScenario do fixture F21 (counter+switch).
 *  Os dados TS sob test/eval/scenarios constroem com o helper `script()`
 *  do fixture — o executor faz o cast no ponto de uso (único lugar que
 *  toca o fixture F21). */
export interface HarnessScenarioScript {
  id: string;
  description: string;
  steps: HarnessScenarioStep[];
  stepFor(n: number): HarnessScenarioStep | undefined;
  summary(): string;
}

export interface HarnessScenario {
  id: string;
  title: string;
  description?: string;
  /** prompt de usuário da sessão (default: target.input ?? este). */
  prompt?: string;
  withRepo?: boolean;
  tools?: string[];
  bindExtensions?: boolean;
  beforeSession?: SessionSetupHandler;
  /** script real do fixture (contador+switch — escolha fakeada, execução real). */
  scenario: HarnessScenarioScript;
}

// --- Artefatos / resultados (port as-is, RPG-free) ---

export interface AgentPromptMetadataArtifact {
  agent: string;
  description?: string;
  sourceKind: "composer" | "default";
}

export interface EvalArtifacts {
  renderedPrompt?: string;
  agentMetadata?: AgentPromptMetadataArtifact;
  toolPolicy?: Record<string, boolean>;
  promptLength?: number;
  modelOutput?: string;
  judgeOutput?: string;
  trace?: unknown;
  tokens?: number;
  cost?: number;
  baselineDelta?: unknown;
  /** diagnóstico adversarial do fixture F21 (desvio induzido — EVAL-014). */
  diagnosis?: string[];
}

export interface AssertionResult {
  evaluatorKind: EvaluatorKind;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
}

export interface EvalCaseResult {
  caseId: string;
  description?: string;
  status: "passed" | "failed" | "error";
  score: number;
  normalizedScore: number;
  maxScore: number;
  durationMs: number;
  artifacts: EvalArtifacts;
  assertionResults: AssertionResult[];
  errors: string[];
}

export interface EvalRunSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  totalScore: number;
  normalizedScore: number;
  maxScore: number;
}

export type EvalRunSource = "local" | "ci" | "scheduled" | "workflow_dispatch";

export interface EvalRunMetadata {
  provider?: string;
  model?: string;
  modelKey?: string;
  source?: EvalRunSource;
  repo?: string;
  branch?: string;
  commitSha?: string;
  runGroup?: string;
  workflow?: string;
  job?: string;
  matrix?: Record<string, string>;
}

export interface EvalRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  suiteId: string;
  phase: EvalPhase;
  suiteMetadata?: EvalSuiteMetadata;
  runMetadata?: EvalRunMetadata;
  summary: EvalRunSummary;
  caseResults: EvalCaseResult[];
}

export interface ResolvedTarget {
  target: EvalTarget;
  artifacts: EvalArtifacts;
}

export interface ExecutionContext {
  mode: "local" | "ci" | "hosted";
  suitesDir: string;
  casesDir: string;
  scenariosDir: string;
  /** baselineDir default: <suitesDir>/baselines (F23 — test/eval/baselines). */
  baselineDir: string;
  /** override de setup pré-sessão (testes adversarial — runner-level). */
  beforeSession?: SessionSetupHandler;
  /** adaptador de judge do F25 (VerifyDeps.judgeAdapter) — tier real do
   *  llm-judge, env-gated por RUNECRAFT_VERIFY_LLM_JUDGE=1 (D4/D9). */
  judgeAdapter?: (request: { prompt: string; timeoutMs: number }) => Promise<
    | { ok: true; raw: string }
    | { ok: false; error: string }
  >;
  runMetadata?: EvalRunMetadata;
}

export interface RunnerFilters {
  caseIds?: string[];
  agents?: string[];
  tags?: string[];
}

export interface RunEvalSuiteOptions {
  /** dir com suites/ (ex.: test/eval — lane do framework). */
  suitesDir: string;
  suite: string;
  filters?: RunnerFilters;
  mode?: ExecutionContext["mode"];
  beforeSession?: SessionSetupHandler;
  judgeAdapter?: ExecutionContext["judgeAdapter"];
  runMetadata?: EvalRunMetadata;
}

export interface EvalLoadErrorContext {
  filePath: string;
  detail: string;
}

// --- Baseline determinístico (port do arcanum baseline.ts — adaptado) ---

export interface DeterministicBaselineCase {
  caseId: string;
  status: EvalCaseResult["status"];
  normalizedScore: number;
  assertionPassed: number;
  assertionFailed: number;
  errorCount: number;
}

export interface DeterministicBaseline {
  version: 1;
  suiteId: string;
  phase: EvalPhase;
  generatedAt: string;
  normalizedScore: number;
  cases: DeterministicBaselineCase[];
}

export interface BaselineComparisonOptions {
  scoreDropTolerance?: number;
}

export interface BaselineComparison {
  outcome: "no-regression" | "informational-diff" | "regression";
  regressions: string[];
  informational: string[];
}

// --- Trajectory (QA-2: transcript REAL do fixture) ---

export interface TrajectoryTurn {
  turn: number;
  role: "user" | "assistant";
  agent?: string;
  content: string;
  mockResponse?: string;
  expectedDelegation?: string;
}

export interface TrajectoryScenario {
  id: string;
  title: string;
  description?: string;
  agents: string[];
  turns: TrajectoryTurn[];
}

export interface TrajectoryTurnResult {
  turn: number;
  agent: string;
  role: "user" | "assistant";
  response: string;
  expectedDelegation?: string;
  observedDelegation?: string | null;
  durationMs: number;
}

/** Trace do transcript REAL do ScriptedScenario (QA-2 — não o mock-text do
 *  arcanum). Adaptação de campos (documentada no case EVAL-014):
 *   - delegationSequence = nomes das tool calls do transcript (ordem real);
 *   - delegationTargets   = tool calls BLOQUEADOS pelos guards F24 (ordem);
 *   - turns.agent         = "main" (agente da sessão — sem guild agents);
 *   - turns.observedDelegation = nome da tool call do turno (null p/ texto). */
export interface TrajectoryTrace {
  scenarioId: string;
  turns: TrajectoryTurnResult[];
  delegationSequence: string[];
  delegationTargets?: string[];
  totalTurns: number;
  completedTurns: number;
}

export function isTrajectoryTrace(trace: unknown): trace is TrajectoryTrace {
  if (!trace || typeof trace !== "object") return false;
  const t = trace as Record<string, unknown>;
  return (
    typeof t.scenarioId === "string" &&
    Array.isArray(t.turns) &&
    Array.isArray(t.delegationSequence) &&
    (t.delegationTargets === undefined || Array.isArray(t.delegationTargets)) &&
    typeof t.totalTurns === "number" &&
    typeof t.completedTurns === "number"
  );
}
