// verify/cost.ts — CostLedger por execução (F25, D7/F3/VER-05).
//
// Guardrails de custo do doc (file integrity, change sufficiency, cost cap):
// o ledger conta por EXECUÇÃO (um complete_goal / um `harness verify`):
//   - cascadeRuns — execuções da cascata (retries inclusos; a 1ª conta como 1)
//   - judgeCalls  — invocações do judge (env-gated)
//   - judgeTokens — estimativa determinística de tokens (chars / 4, arredondado)
// Cap esgotado → HALT SEM judge (o judge nunca roda depois do cap — D7); o
// reason de custo leva a contabilidade (ex.: `cascadeRuns 3/3, judgeCalls 1/2`).
import type { CostCapsConfig } from "./config.ts";
import type { CostSummary } from "./verdict.ts";

/** Estimativa determinística de tokens (chars / 4, mínimo 1) — mesma em qualquer máquina. */
export function estimateTokens(text: string): number {
  const chars = text.length;
  return Math.max(1, Math.ceil(chars / 4));
}

export class CostLedger {
  private readonly caps: CostCapsConfig;
  private cascadeRuns = 0;
  private judgeCalls = 0;
  private judgeTokens = 0;

  constructor(caps: CostCapsConfig) {
    this.caps = caps;
  }

  /** Registra o início de uma execução da cascata; false quando o cap de runs já esgotou. */
  startCascadeRun(): boolean {
    if (this.cascadeRuns >= this.caps.maxCascadeRuns) return false;
    this.cascadeRuns += 1;
    return true;
  }

  get runsUsed(): number {
    return this.cascadeRuns;
  }

  /** O cap de execuções esgotou? (não há mais retries possíveis). */
  get cascadeCapped(): boolean {
    return this.cascadeRuns >= this.caps.maxCascadeRuns;
  }

  /**
   * O judge ainda pode ser chamado? (D7/F3 — cap esgotado → HALT sem judge).
   * `promptTokens` é a estimativa da chamada; false quando qualquer cap impediria.
   */
  canCallJudge(promptTokens: number): boolean {
    if (this.judgeCalls >= this.caps.maxJudgeCalls) return false;
    if (this.caps.maxJudgeTokens > 0 && this.judgeTokens + promptTokens >= this.caps.maxJudgeTokens) return false;
    return true;
  }

  /** Registra uma chamada do judge (calls + promptTokens); soma a resposta depois. */
  recordJudgeCall(promptTokens: number): void {
    this.judgeCalls += 1;
    this.judgeTokens += promptTokens;
  }

  /** Registra os tokens da resposta do judge. */
  recordJudgeReply(replyTokens: number): void {
    this.judgeTokens += replyTokens;
  }

  get callsUsed(): number {
    return this.judgeCalls;
  }

  get tokensUsed(): number {
    return this.judgeTokens;
  }

  /** Contabilidade para o reason de custo (F3): `cascadeRuns 2/3, judgeCalls 1/2, judgeTokens 400/4000`. */
  summary(): CostSummary {
    return {
      cascadeRuns: this.cascadeRuns,
      judgeCalls: this.judgeCalls,
      judgeTokens: this.judgeTokens,
      caps: {
        maxCascadeRuns: this.caps.maxCascadeRuns,
        maxJudgeCalls: this.caps.maxJudgeCalls,
        maxJudgeTokens: this.caps.maxJudgeTokens,
      },
    };
  }

  /** Contabilidade legível para o reason (F3 — normalização F21 D10: sem paths/timestamps). */
  accountingText(): string {
    const s = this.summary();
    return `cascadeRuns ${s.cascadeRuns}/${s.caps.maxCascadeRuns}, judgeCalls ${s.judgeCalls}/${s.caps.maxJudgeCalls}, judgeTokens ${s.judgeTokens}/${s.caps.maxJudgeTokens}`;
  }
}
