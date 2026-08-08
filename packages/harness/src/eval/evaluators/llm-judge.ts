// eval/evaluators/llm-judge.ts — dois tiers (F26, D4/D9/QA-3).
//
// Tier substring (sempre, offline): port do arcanum (llm-judge.ts) SEM o
// normalizeAliases (D8 — o arcanum tinha aliases RPG thread→rogue etc.;
// aqui não há aliases — mensagens RPG-free). Tier real (SÓ com
// RUNECRAFT_VERIFY_LLM_JUDGE=1 — padrão F25): VerifyDeps.judgeAdapter com
// critérios do spec; parse estrito (parseJudgeResponse do F25); inválido/
// timeout → fail-closed; output vazio → fail determinístico SEM chamar o
// adaptador. CI nunca invoca o tier real (env off por construção — setup.ts
// dos preloads; spy nos testes).
import { judgeEnvEnabled, parseJudgeResponse, type JudgeResponse } from "../../verify/stages/judge.ts";
import type { AssertionResult, EvalArtifacts, LlmJudgeEvaluator } from "../types.ts";

/** Versão do prompt do judge de evals (estável — F21 D10). */
export const EVAL_JUDGE_PROMPT_VERSION = 1 as const;

export const EVAL_JUDGE_TIMEOUT_MS = 60_000 as const;

/** Adaptador injetável (mesmo shape do VerifyDeps.judgeAdapter do F25). */
export interface LlmJudgeAdapter {
  (request: { prompt: string; timeoutMs: number }): Promise<
    | { ok: true; raw: string }
    | { ok: false; error: string }
  >;
}

export interface LlmJudgeContext {
  judgeAdapter?: LlmJudgeAdapter;
  env?: NodeJS.ProcessEnv;
}

function getWeight(spec: LlmJudgeEvaluator): number {
  return spec.weight ?? 1;
}

/** Prompt versionado com os critérios do spec (derivado dos patterns — nunca
 *  auto-avaliação; mesmo contrato de fail-closed do F25). */
export function buildEvalJudgePrompt(spec: LlmJudgeEvaluator, output: string): string {
  const lines = [
    `You are an eval judge (harness, prompt v${EVAL_JUDGE_PROMPT_VERSION}).`,
    "Judge whether the OUTPUT satisfies the criteria below.",
    `- Must contain ALL of: ${(spec.expectedContains ?? []).join(", ") || "(none)"}`,
    `- Must contain AT LEAST ONE of: ${(spec.expectedAnyOf ?? []).join(", ") || "(none)"}`,
    `- Must NOT contain ANY of: ${(spec.forbiddenContains ?? []).join(", ") || "(none)"}`,
    'Answer STRICTLY as JSON: {"verdict": "pass"|"fail", "confidence": <0..1>, "reasons": [<string>]}.',
    "",
    "=== OUTPUT ===",
    output,
  ];
  return lines.join("\n");
}

/** Tier substring (port do arcanum, RPG-free — SEM normalizeAliases). */
function substringTier(spec: LlmJudgeEvaluator, output: string): AssertionResult[] {
  const expected = spec.expectedContains ?? [];
  const expectedAnyOf = spec.expectedAnyOf ?? [];
  const forbidden = spec.forbiddenContains ?? [];
  const totalChecks = expected.length + forbidden.length + (expectedAnyOf.length > 0 ? 1 : 0);
  const perItem = totalChecks > 0 ? getWeight(spec) / totalChecks : getWeight(spec);
  const results: AssertionResult[] = [];

  const outputLower = output.toLowerCase();

  for (const pattern of expected) {
    const passed = outputLower.includes(pattern.toLowerCase());
    results.push({
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Judge check passed: output contains '${pattern}'`
        : `Judge check failed: output missing '${pattern}'`,
    });
  }

  if (expectedAnyOf.length > 0) {
    const matchedPattern = expectedAnyOf.find((pattern) => outputLower.includes(pattern.toLowerCase()));
    const passed = matchedPattern !== undefined;
    results.push({
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Judge check passed: output contains one of '${expectedAnyOf.join("', '")}' (matched '${matchedPattern}')`
        : `Judge check failed: output missing all of '${expectedAnyOf.join("', '")}'`,
    });
  }

  for (const pattern of forbidden) {
    const passed = !outputLower.includes(pattern.toLowerCase());
    results.push({
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Judge check passed: output excludes '${pattern}'`
        : `Judge check failed: output contains forbidden '${pattern}'`,
    });
  }

  if (results.length === 0) {
    results.push({
      evaluatorKind: spec.kind,
      passed: output.length > 0,
      score: output.length > 0 ? getWeight(spec) : 0,
      maxScore: getWeight(spec),
      message: output.length > 0 ? "Judge check passed: model output present" : "Judge check failed: empty model output",
    });
  }

  return results;
}

function failClosed(message: string, weight: number): AssertionResult {
  return {
    evaluatorKind: "llm-judge",
    passed: false,
    score: 0,
    maxScore: weight,
    message,
  };
}

/** Tier real (env-gated — F25). Nunca chamado sem RUNECRAFT_VERIFY_LLM_JUDGE=1. */
async function realTier(
  spec: LlmJudgeEvaluator,
  output: string,
  adapter: LlmJudgeAdapter | undefined,
): Promise<AssertionResult> {
  const weight = getWeight(spec);

  if (adapter === undefined) {
    return failClosed(
      "Judge check failed (fail-closed): RUNECRAFT_VERIFY_LLM_JUDGE=1 mas nenhum adaptador de judge disponível — wiring do adaptador é o contrato (F25)",
      weight,
    );
  }

  const prompt = buildEvalJudgePrompt(spec, output);
  let reply: { ok: true; raw: string } | { ok: false; error: string };
  try {
    reply = await adapter({ prompt, timeoutMs: EVAL_JUDGE_TIMEOUT_MS });
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!reply.ok) {
    return failClosed(`Judge check failed (fail-closed): adaptador devolveu erro — ${reply.error}`, weight);
  }

  const parsed = parseJudgeResponse(reply.raw);
  if (!parsed.ok) {
    return failClosed(`Judge check failed (fail-closed): resposta inválida — ${parsed.error}`, weight);
  }

  const response: JudgeResponse = parsed.response;
  const passed = response.verdict === "pass";
  return {
    evaluatorKind: spec.kind,
    passed,
    score: passed ? weight : 0,
    maxScore: weight,
    message: passed
      ? `Judge verdict: pass (confidence ${response.confidence.toFixed(2)})`
      : `Judge verdict: fail (confidence ${response.confidence.toFixed(2)}) — reasons: ${response.reasons.join("; ")}`,
  };
}

export async function runLlmJudgeEvaluator(
  spec: LlmJudgeEvaluator,
  artifacts: EvalArtifacts,
  ctx: LlmJudgeContext = {},
): Promise<AssertionResult[]> {
  const output = artifacts.modelOutput ?? "";
  const results = substringTier(spec, output);

  // Tier real: SÓ com o env ativo (padrão F25 — CI nunca tem o env).
  if (!judgeEnvEnabled(ctx.env ?? process.env)) {
    return results;
  }

  // Output vazio → veredito determinístico (fail) sem invocar o adaptador.
  if (output.trim().length === 0) {
    results.push({
      evaluatorKind: spec.kind,
      passed: false,
      score: 0,
      maxScore: getWeight(spec),
      message: "Judge check failed: empty model output (deterministic — real tier not invoked)",
    });
    return results;
  }

  results.push(await realTier(spec, output, ctx.judgeAdapter));
  return results;
}
