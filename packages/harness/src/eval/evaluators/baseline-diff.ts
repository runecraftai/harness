// eval/evaluators/baseline-diff.ts — comparador de regressão vs ratchet F23
// (F26, D4/D6/QA-5).
//
// O baseline-diff do arcanum era RESERVADO ("reserved for a later phase and
// is not implemented yet" — deterministic.ts); F26 o IMPLEMENTA comparando o
// resultado do case atual contra o baseline do F23 (test/eval/baselines/
// known-failures.txt — formato `identidade<TAB>...` do ratchet). Reuso da
// infra F23 SEM duplicação: normalizeMessage (normalize.ts — identidade
// estável, sem path/timestamp) e sortLines (sort.ts — colação pinada).
//
// Semântica (EVAL-015): falha do case com identidade NOVA no baseline →
// regression (fail com reason caseId + métrica); falha congelada → pass
// (informacional); case passou → pass (no-regression); baseline ausente →
// degraded informacional (não falha infra).
//
// Namespace: as identidades de falha de EVAL-CASE são 2-partes
// `caseId<TAB>mensagemNormalizada` — namespace próprio, distinto da
// identidade 3-partes da evidência do F21 (testFile/testName/mensagem);
// documentado no docs/EVAL-FRAMEWORK.md (T10).
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeMessage } from "../../../test/eval/normalize.ts";
import { parseBaselineLines } from "../../../test/eval/ratchet.ts";
import type { AssertionResult, BaselineDiffEvaluator, EvalCaseResult } from "../types.ts";

/** Identidade de falha de um case do framework (2-partes — namespace F26). */
export function caseFailureIdentity(caseId: string, normalizedMessage: string): string {
  const id = caseId.replace(/[\t\n\r]/g, " ");
  const message = normalizedMessage.replace(/[\t\n\r]/g, " ");
  return `${id}\t${message}`;
}

function getWeight(spec: BaselineDiffEvaluator): number {
  return spec.weight ?? 1;
}

export interface BaselineDiffContext {
  baselineDir: string;
  caseId: string;
  status: EvalCaseResult["status"];
  /** mensagens de falha do case (assertions falhas + errors) — cruas. */
  failures: string[];
}

/** Compara o case atual contra o baseline F23 (pure — fs de leitura). */
export function runBaselineDiffEvaluator(
  spec: BaselineDiffEvaluator,
  ctx: BaselineDiffContext,
): AssertionResult[] {
  const weight = getWeight(spec);
  const baselineName = spec.baselineRef ?? "known-failures.txt";
  const baselinePath = path.join(ctx.baselineDir, baselineName);

  let baselineSet: Set<string>;
  try {
    baselineSet = parseBaselineLines(fs.readFileSync(baselinePath, "utf8"));
  } catch {
    // Baseline ausente/ilegível → degrade informacional (EVAL-015 AC2):
    // passa sem certificar (não falha infra).
    return [
      {
        evaluatorKind: "baseline-diff",
        passed: true,
        score: weight,
        maxScore: weight,
        message: `Baseline unavailable — degraded (informational): ${baselineName} não encontrado`,
      },
    ];
  }

  if (ctx.status === "passed") {
    return [
      {
        evaluatorKind: "baseline-diff",
        passed: true,
        score: weight,
        maxScore: weight,
        message: `No regression for case ${ctx.caseId}: case passed`,
      },
    ];
  }

  const newFailures = ctx.failures.filter(
    (message) => !baselineSet.has(caseFailureIdentity(ctx.caseId, normalizeMessage(message))),
  );

  if (newFailures.length === 0) {
    return [
      {
        evaluatorKind: "baseline-diff",
        passed: true,
        score: weight,
        maxScore: weight,
        message: `No new regression for case ${ctx.caseId}: failure(s) frozen in baseline`,
      },
    ];
  }

  const perItem = newFailures.length > 0 ? weight / newFailures.length : weight;
  return newFailures.map((message) => ({
    evaluatorKind: "baseline-diff",
    passed: false,
    score: 0,
    maxScore: perItem,
    message: `Regression for case ${ctx.caseId}: new failure not in baseline — ${normalizeMessage(message)}`,
  }));
}
