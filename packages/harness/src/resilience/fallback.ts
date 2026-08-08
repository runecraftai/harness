// resilience/fallback.ts — fallback chain MECANISMO (D6, RES-06).
//
// Engine de política multi-trigger (rate-limit | timeout | stall | falha
// repetida | erro): trigger → política de escalação (stop-all | skip-and-
// continue — padrão F25) → ação real da cadeia. Orçamento de escalação
// reusando o padrão CostLedger do F25 (cost.ts — caps duros → HALT).
//
// Ações REAIS no F27: retry | re-inject-continuation | pause | halt.
// `modelSwitch` é INTERFACE (fronteira F30 — travada): o F27 devolve a ação
// com `noop: true` quando configurada (o F30 implementa a resolução real);
// este módulo NUNCA toca settings/modelRoles/env de modelo.
//
// Política (D6): `stop-all` → cadeia esgotada = HALT com reason + sugestão
// (sem loop infinito); `skip-and-continue` → veredito registrado no log e
// segue (padrão F25 SKIP). Orçamento esgotado → HALT sem mais tentativas.
import type { EscalationConfig, ResilienceConfig } from "./config.ts";
import type { EscalationPolicy, FallbackAction, FallbackActionKind, FallbackTrigger, FailureClassification } from "./types.ts";
import { RESILIENCE_REASON_ID } from "./classify.ts";

/** Orçamento de escalação (padrão CostLedger F25): conta ações de escalada;
 *  esgotado → sem mais tentativas (HALT no stop-all / SKIP no skip-and-continue). */
export class EscalationBudget {
  private used = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** Registra uma escalada; false quando o orçamento já esgotou. */
  spend(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }

  get escalationsUsed(): number {
    return this.used;
  }

  get exhausted(): boolean {
    return this.used >= this.max;
  }

  /** Contabilidade para o reason (F3 — normalização F21 D10: sem path/timestamp). */
  accountingText(): string {
    return `escalations ${this.used}/${this.max}`;
  }
}

/** Resultado da engine (D6). `action` null = skip-and-continue esgotado
 *  (veredito registrado, sem ação — padrão F25 SKIP). */
export interface FallbackDecision {
  /** ação da cadeia (null quando a política skip-and-continue registra e segue). */
  action: FallbackAction | null;
  /** orçamento esgotado nesta decisão? (HALT sem mais tentativas). */
  budgetExhausted: boolean;
  /** veredito para o log (padrão F25 SKIP/HALT): "halt" | "skip" | "action". */
  verdict: "halt" | "skip" | "action";
}

/** Entrada da engine (PURO — determinística). */
export interface FallbackEngineInput {
  trigger: FallbackTrigger;
  /** classificação da falha (F5) — usada quando trigger = "error". */
  classification?: FailureClassification;
  policy: EscalationPolicy;
  /** config de escalação (política + orçamento). */
  escalation: EscalationConfig;
  /** thresholds de stall (escada de refires — gate do trigger stall). */
  stallEscalationRefires?: number;
  /** trigger = "stall": refires consecutivos observados. */
  consecutiveStalls?: number;
  /** trigger = rate-limit|timeout: retries já tentados — a 1ª vez retry;
   *  persistente (>= 1) → modelSwitch (interface — F30). */
  retryCount?: number;
  budget: EscalationBudget;
}

function action(kind: FallbackActionKind, reason: string, extra: Partial<FallbackAction> = {}): FallbackAction {
  return { kind, reason, ...extra };
}

/** Reason estável (formato F25 suggestions — `<id>: <camada> — <motivo>; <sug>`). */
export function fallbackReason(motivo: string, suggestion: string): string {
  return `${RESILIENCE_REASON_ID}: fallback — ${motivo}; ${suggestion}`;
}

/**
 * Resolve a ação da cadeia para o trigger (PURO — D6/F6). Regras:
 *  - rate-limit/timeout → retry com backoff (infra — o trabalho não é o
 *    problema); orçamento permite → modelSwitch (interface NO-OP — F30).
 *  - stall → re-inject-continuation (gatilho de progresso parado, não erro);
 *    escada de refires esgotada (stallEscalationRefires) → política decide.
 *  - repeated-failure → re-inject-continuation (agent — sem progresso).
 *  - error → pela classificação: infra → retry; agent → re-inject; unknown →
 *    HALT fail-closed.
 *  - orçamento de escalação esgotado → stop-all: HALT; skip-and-continue:
 *    SKIP registrado (veredito no log — padrão F25).
 */
export function resolveFallbackAction(input: FallbackEngineInput): FallbackDecision {
  const { trigger, policy, escalation, budget } = input;

  const escalate = (kind: FallbackActionKind, reason: string, suggestion: string): FallbackDecision => {
    if (budget.exhausted) {
      if (policy === "stop-all") {
        return {
          action: action("halt", fallbackReason(`escalation budget exhausted (${budget.accountingText()})`, suggestion)),
          budgetExhausted: true,
          verdict: "halt",
        };
      }
      return {
        action: null,
        budgetExhausted: true,
        verdict: "skip",
      };
    }
    budget.spend();
    return { action: action(kind, fallbackReason(reason, suggestion)), budgetExhausted: false, verdict: "action" };
  };

  if (trigger === "rate-limit") {
    const classification = input.classification;
    if (classification && classification.class !== "infra") {
      return escalate("halt", `trigger rate-limit mas classificação é ${classification.class} (${classification.reason})`, "fail-closed: HALT — reclassifique antes de escalar");
    }
    if ((input.retryCount ?? 0) >= 1) {
      // Persistente: a cadeia leve→forte sobe para modelSwitch (interface —
      // F30 implementa; F27 devolve NO-OP documentado e segue).
      const switched = escalate("modelSwitch", "rate-limit persistente — modelSwitch (interface; implementação NO-OP no F27 — F30 resolve)", "F30 implementa a troca de modelo; F27 registra e segue (fronteira explícita)");
      if (switched.action !== null && !switched.budgetExhausted) switched.action.noop = true;
      return switched;
    }
    return escalate("retry", "rate-limit/quota — retry com backoff após a janela do upstream", "retry após o Retry-After (infra); não re-execute o trabalho");
  }

  if (trigger === "timeout") {
    if ((input.retryCount ?? 0) >= 1) {
      const switched = escalate("modelSwitch", "timeout persistente — modelSwitch (interface; NO-OP no F27 — F30 resolve)", "F30 implementa a troca de modelo; F27 registra e segue");
      if (switched.action !== null && !switched.budgetExhausted) switched.action.noop = true;
      return switched;
    }
    return escalate("retry", "timeout — retry com backoff (infra)", "retry após backoff; verifique o limite do comando antes de re-executar");
  }

  if (trigger === "stall") {
    const stalls = input.consecutiveStalls ?? 0;
    const refires = input.stallEscalationRefires ?? 5;
    if (stalls >= refires) {
      return escalate("halt", `stall escada esgotada (${stalls}/${refires} refires sem turno real)`, "HALT com reason — a continuação não está aterrissando (wedge/stale API); restart pi e /goal resume");
    }
    return escalate("re-inject-continuation", `stall (${stalls}/${refires}) — re-inject da continuação`, "re-inject o prompt de continuação (D2) — o gatilho é progresso parado, não erro");
  }

  if (trigger === "repeated-failure") {
    return escalate("re-inject-continuation", "falha repetida sem progresso — re-inject com nova abordagem", "re-inject-continuation instruindo nova abordagem; se repetir, pause para decisão");
  }

  // trigger === "error" — pela classificação (F5).
  const classification = input.classification;
  if (classification === undefined) {
    return escalate("halt", "erro sem classificação — fail-closed", "classifique a falha antes de escalar (agent vs infra)");
  }
  if (classification.class === "infra") {
    return escalate("retry", `infra (${classification.reason}) — retry com backoff`, classification.suggestion);
  }
  if (classification.class === "agent") {
    return escalate("re-inject-continuation", `agent (${classification.reason}) — re-inject com nova abordagem`, classification.suggestion);
  }
  return escalate("halt", `unknown (${classification.reason}) — fail-closed HALT`, classification.suggestion);
}

/** A interface modelSwitch: o F30 implementa; o F27 expõe o contrato. */
export interface ModelSwitchInterface {
  /** Resolve a troca de modelo (leve → forte → humano — F30). NO-OP no F27. */
  switchModel?(action: FallbackAction): Promise<void>;
}
