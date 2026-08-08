// verify/verdict.ts — tipos e constantes da cascata de verificação (F25, D2/D5/D8).
//
// Camadas da cascata (D2 — cheap→expensive com short-circuit):
//   1 structural  — scripts do repo (lint/typecheck/test) com timeout
//   2 integrity   — domínio do write-guard F24 (existência/hash, realpath)
//   3 sufficiency — escopo de arquivos + proporção de tamanho (QA-2)
//   4 embedding   — similaridade local determinística (char n-gram TF + cosseno)
//   5 judge       — LLM env-gated, SÓ na zona cinza (D5/D6)
//
// Status de estágio (D2): pass | fail | degraded. `degraded` = camada
// indisponível (sem scripts/spec) — NÃO short-circuita (a cascata segue);
// `fail` em camada barata impede as mais caras. Boundaries de score (D5):
// `score >= max → pass`, `score <= min → fail`, senão gray — inclusivos,
// documentados no código (edge da spec).
export const VERIFY_REASON_ID = "verification-cascade" as const;

/** Ids estáveis das camadas (prefixo/razão — normalização F21 D10). */
export const LAYER_IDS = ["structural", "integrity", "sufficiency", "embedding", "judge"] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export type StageStatus = "pass" | "fail" | "degraded";

/** Uma camada executada (D2): motivo classificado + sugestão acionável. */
export interface StageResult {
  layer: LayerId;
  status: StageStatus;
  /** reasonId do F24 quando a camada herda o domínio do guard (integrity). */
  reasonId: string;
  /** motivo classificado (sem path absoluto/timestamp — F21 D10). */
  reason: string;
  /** sugestão acionável (conteúdo semântico do verification-reminder — D12). */
  suggestion: string;
  /** detalhe estruturado por camada (ex.: comando falho, score, arquivos). */
  detail?: Record<string, unknown>;
}

/** Ação da política por camada (D7/D8): retry → re-roda; skip → registra; halt → bloqueia. */
export type PolicyAction = "retry" | "skip" | "halt";

/** Política resolvida para a primeira falha da cascata (D8). */
export interface PolicyResolution {
  layer: LayerId;
  action: PolicyAction;
  /** retry: tentativas adicionais permitidas (policy.retry.maxRuns). */
  retriesLeft?: number;
}

export type VerdictStatus = "pass" | "skip" | "degraded" | "fail" | "halt";

/** Veredito final de UMA execução da cascata (D8/D10). */
export interface Verdict {
  /** true quando o report é ok (todas as camadas passaram; degraded conta como ok). */
  ok: boolean;
  status: VerdictStatus;
  verifyId: string;
  /** resultados das camadas que RODARAM (ordem; short-circuit visível). */
  stages: StageResult[];
  /** razão estável do veredito (halt → reason do block; skip/fail → registro). */
  reason: string | null;
  /** sugestão do estágio que resolveu o veredito (null quando pass). */
  suggestion: string | null;
  /** contabilidade de custo da execução (D7/F3). */
  cost: CostSummary;
  /** estado do judge na execução (env) — diagnóstico honesto (VER-10). */
  judge: { enabled: boolean };
}

export interface CostSummary {
  cascadeRuns: number;
  judgeCalls: number;
  judgeTokens: number;
  caps: { maxCascadeRuns: number; maxJudgeCalls: number; maxJudgeTokens: number };
}

/** Veredito de pass (helper dos testes). */
export function passVerdict(stages: StageResult[], cost: CostSummary, judgeEnabled: boolean): Verdict {
  return {
    ok: true,
    status: "pass",
    verifyId: VERIFY_REASON_ID,
    stages,
    reason: null,
    suggestion: null,
    cost,
    judge: { enabled: judgeEnabled },
  };
}
