// verify/stages/embedding.ts — camada 4: filtro grosso local determinístico (F25, D4/D5/VER-07/08).
//
// Opção (a) travada no design D4: vetores TF de char n-gram (n=3) + cosseno —
// implementação PURA (Map/hash, zero deps, zero rede), O(|spec|+|output|).
// Determinismo: mesmo input → mesmo score em qualquer máquina/CI (Map com
// chaves string — ordem de iteração estável para as MESMAS chaves; os vetores
// são somados por chave, a norma é calculada sobre as chaves do documento).
// Scores arredondados em 4 casas (tolerância documentada nos testes).
//
// Boundaries (D5 — inclusivos, edge da spec): `score >= max → pass`,
// `score <= min → fail`, `min < score < max → gray` (escalada SÓ aí).
// Spec ausente/output vazio/indisponível → política `degrade.embeddingUnavailable`
// (default skip + veredito `degraded` registrado — QA-3). Output vazio COM
// spec → score 0 → fail (≤ min), determinístico.
import type { EmbeddingThresholds } from "../config.ts";
import { embeddingDegradedReason, embeddingFailReason } from "../suggestions.ts";
import type { StageResult } from "../verdict.ts";

export const NGRAM_N = 3 as const;

/** Vetor TF de char n-gram (Map chave → contagem). Chaves string estáveis. */
export function ngramTf(text: string, n: number): Map<string, number> {
  const tf = new Map<string, number>();
  const normalized = text.toLowerCase();
  if (normalized.length < n) {
    // Texto curto demais para n-gram completo: usa o próprio texto como chave
    // (degenerado mas determinístico — 1 n-gram parcial).
    tf.set(normalized, 1);
    return tf;
  }
  for (let i = 0; i <= normalized.length - n; i += 1) {
    const key = normalized.slice(i, i + n);
    tf.set(key, (tf.get(key) ?? 0) + 1);
  }
  return tf;
}

/** Cosseno entre dois vetores TF (0 quando um deles é vazio). */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, count] of a) {
    normA += count * count;
    const other = b.get(key);
    if (other !== undefined) dot += count * other;
  }
  for (const count of b.values()) {
    normB += count * count;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/** Score de similaridade spec↔output (4 casas — determinismo numérico documentado). */
export function embeddingScore(spec: string, output: string): number {
  const specTf = ngramTf(spec, NGRAM_N);
  const outputTf = ngramTf(output, NGRAM_N);
  const score = cosineSimilarity(specTf, outputTf);
  return Math.round(score * 10_000) / 10_000;
}

export type EmbeddingVerdict = "pass" | "fail" | "gray" | "degraded";

export interface EmbeddingStageResult extends StageResult {
  /** score da similaridade (null quando degradado). */
  score: number | null;
  /** veredito bruto da camada (gray é resolvido pelo engine — D5). */
  verdict: EmbeddingVerdict;
}

export interface EmbeddingStageInput {
  spec: string | null;
  output: string | null;
  thresholds: EmbeddingThresholds;
}

/**
 * Camada 4 (D5): score → pass/fail/gray pelos boundaries inclusivos.
 * Spec ausente → degraded (QA-3). Output ausente com spec → score 0 → fail.
 */
export function embeddingStage(input: EmbeddingStageInput): EmbeddingStageResult {
  const { spec, output, thresholds } = input;
  if (spec === null || spec.trim().length === 0) {
    return {
      layer: "embedding",
      status: "degraded",
      reasonId: "verification-cascade",
      reason: embeddingDegradedReason(),
      suggestion: "veredito degradado registrado — sem a evidência da spec não é violação (embeddingUnavailable)",
      score: null,
      verdict: "degraded",
      detail: { reason: "spec-missing" },
    };
  }
  const score = embeddingScore(spec, output ?? "");
  if (score >= thresholds.max) {
    return {
      layer: "embedding",
      status: "pass",
      reasonId: "verification-cascade",
      reason: `score ${score.toFixed(4)} >= max ${thresholds.max} — output fiel à spec`,
      suggestion: "",
      score,
      verdict: "pass",
      detail: { score, min: thresholds.min, max: thresholds.max },
    };
  }
  if (score <= thresholds.min) {
    return {
      layer: "embedding",
      status: "fail",
      reasonId: "verification-cascade",
      reason: embeddingFailReason(score, thresholds.min),
      suggestion: "revise a saída contra a spec — o output deve cobrir o escopo declarado (validação de comportamento: o código faz o que foi pedido?)",
      score,
      verdict: "fail",
      detail: { score, min: thresholds.min, max: thresholds.max },
    };
  }
  // Gray (D5): a decisão de escalar é do ENGINE (judge se env ativo; senão
  // grayZoneNoJudge) — a camada reporta o score e o intervalo como status
  // "pass" DIFERIDO (verdict "gray"): só o engine resolve o desfecho.
  return {
    layer: "embedding",
    status: "pass",
    reasonId: "verification-cascade",
    reason: `zona cinza (${thresholds.min} < score ${score.toFixed(4)} < ${thresholds.max}) — resolução pelo engine`,
    suggestion: "",
    score,
    verdict: "gray",
    detail: { gray: true, score, min: thresholds.min, max: thresholds.max },
  };
}
