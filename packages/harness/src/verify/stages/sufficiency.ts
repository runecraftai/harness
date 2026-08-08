// verify/stages/sufficiency.ts — camada 3: suficiência de mudança (F25, QA-2/VER-04).
//
// Critério composto QA-2 (recomendado, travado):
//   (i)  escopo de arquivos — todo arquivo do diff ∈ escopo do goal
//        (`thresholds.sufficiency.scopePaths`; manifesto do goal via ledger
//        não carrega paths no formato do glla — validado no Execute — então o
//        escopo declarado é o config; vazio = a checagem de escopo não se
//        aplica, documentado) → senão `scope-violation`
//   (ii) proporção — added+deleted tokens ∈ [minRatio, maxRatio] × |spec|
//        (spec em tokens, whitespace) → senão `empty` (diff vazio) ou
//        `oversized`; boundaries INCLUSIVOS (>= minRatio e <= maxRatio passam)
// Sem spec (baseline de tamanho ausente) → degraded (QA-3 — a camada segue;
// a política `degrade.embeddingUnavailable` decide o veredito final).
import * as path from "node:path";
import { countTokens, type RepoState } from "../repo.ts";
import { sufficiencyDegradedReason, sufficiencyEmptyReason, sufficiencyOversizedReason, sufficiencyScopeViolationReason } from "../suggestions.ts";
import type { SufficiencyThresholds } from "../config.ts";
import type { StageResult } from "../verdict.ts";

export interface SufficiencyStageInput {
  repo: RepoState;
  spec: string | null;
  thresholds: SufficiencyThresholds;
}

function normalizeScope(p: string): string {
  return p.trim().replace(/^\.\//, "").split(path.sep).join("/");
}

/** O arquivo está dentro de algum path de escopo declarado (prefixo). */
function inScope(file: string, scopePaths: string[]): boolean {
  const normalized = normalizeScope(file);
  return scopePaths.some((p) => {
    const scope = normalizeScope(p);
    return normalized === scope || normalized.startsWith(`${scope}/`);
  });
}

/**
 * Camada 3 (QA-2): diff vazio → `empty` (sugestão "mudança ausente");
 * diff desproporcional → `oversized`; arquivo fora do escopo →
 * `scope-violation`. Sem spec → degraded (nenhum baseline). Política default
 * halt (QA-1 — suficiência é guardrail HARD).
 */
export function sufficiencyStage(input: SufficiencyStageInput): StageResult {
  const diff = input.repo.diff;
  const spec = input.spec;

  // Sem diff (fora de repo git) não há baseline de mudança — degraded, não
  // "empty" (a ausência de diff por infra não é conclusão sem trabalho).
  if (diff === null) {
    return {
      layer: "sufficiency",
      status: "degraded",
      reasonId: "verification-cascade",
      reason: sufficiencyDegradedReason(),
      suggestion: "repo git indisponível — sem baseline de diff a suficiência não é avaliada (sem essa evidência não é violação)",
      detail: { baseline: "missing" },
    };
  }

  // (i) escopo de arquivos — aplica apenas com escopo DECLARADO.
  if (diff !== null && input.thresholds.scopePaths.length > 0) {
    for (const file of diff.files) {
      if (!inScope(file, input.thresholds.scopePaths)) {
        return {
          layer: "sufficiency",
          status: "fail",
          reasonId: "verification-cascade",
          reason: sufficiencyScopeViolationReason(file, input.thresholds.scopePaths),
          suggestion: `restrinja as mudanças a ${input.thresholds.scopePaths.join(", ")} — git diff --stat e ajuste o escopo declarado`,
          detail: { file, scopePaths: input.thresholds.scopePaths },
        };
      }
    }
  }

  // (ii) proporção — sem spec não há baseline (degraded, QA-3).
  if (spec === null || spec.trim().length === 0) {
    return {
      layer: "sufficiency",
      status: "degraded",
      reasonId: "verification-cascade",
      reason: sufficiencyDegradedReason(),
      suggestion: "defina o objetivo/escopo do goal para habilitar a checagem de proporção (sem essa evidência não é violação)",
      detail: { baseline: "missing" },
    };
  }

  const diffTokens = diff !== null ? diff.addedTokens + diff.deletedTokens : 0;
  const specTokens = countTokens(spec);
  const ratio = diffTokens / Math.max(1, specTokens);
  const minTokens = input.thresholds.minRatio * specTokens;
  const maxTokens = input.thresholds.maxRatio * specTokens;

  if (diffTokens < minTokens) {
    return {
      layer: "sufficiency",
      status: "fail",
      reasonId: "verification-cascade",
      reason: sufficiencyEmptyReason(),
      suggestion: "produza a mudança declarada no goal — git diff --stat deve mostrar o trabalho concluído (a conclusão sem diff não é verificável)",
      detail: { diffTokens, specTokens, minTokens: Math.floor(minTokens) },
    };
  }
  if (diffTokens > maxTokens) {
    return {
      layer: "sufficiency",
      status: "fail",
      reasonId: "verification-cascade",
      reason: sufficiencyOversizedReason(diffTokens, Math.ceil(maxTokens)),
      suggestion: "reduza o diff ao escopo do goal — git diff --stat e revise o que está além do declarado (mudança ∝ escopo)",
      detail: { diffTokens, specTokens, maxTokens: Math.ceil(maxTokens) },
    };
  }

  return {
    layer: "sufficiency",
    status: "pass",
    reasonId: "verification-cascade",
    reason: `mudança proporcional (${diffTokens}/${specTokens} tokens, ratio ${ratio.toFixed(3)})`,
    suggestion: "",
    detail: { diffTokens, specTokens, ratio: Number(ratio.toFixed(3)) },
  };
}
