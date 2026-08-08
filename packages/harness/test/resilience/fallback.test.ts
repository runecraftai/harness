// resilience/fallback.test.ts — fallback chain MECANISMO (T7, RES-06/D6).
//
// Unit com policy fakes: cada trigger mapeia para a ação/política certa;
// stop-all esgota → HALT com reason; skip-and-continue → veredito registrado;
// orçamento esgotado → HALT sem mais tentativas; modelSwitch = interface
// NO-OP (nunca toca settings/modelRoles — fronteira F30); kill switch inerte
// (testado no extension wiring / config).
import { describe, expect, test } from "bun:test";
import { EscalationBudget, resolveFallbackAction, type FallbackEngineInput } from "../../src/resilience/fallback.ts";
import { defaultResilienceConfig } from "../../src/resilience/config.ts";
import { classifyFailure } from "../../src/resilience/classify.ts";
import type { EscalationConfig } from "../../src/resilience/config.ts";

const ESCALATION: EscalationConfig = defaultResilienceConfig().escalation;

function input(overrides: Partial<FallbackEngineInput>): FallbackEngineInput {
  return {
    trigger: "error",
    policy: "stop-all",
    escalation: ESCALATION,
    budget: new EscalationBudget(ESCALATION.maxEscalations),
    ...overrides,
  };
}

describe("multi-trigger → ação certa (AC1 — D6)", () => {
  test("rate-limit (1ª vez) → retry (infra)", () => {
    const d = resolveFallbackAction(input({ trigger: "rate-limit" }));
    expect(d.action!.kind).toBe("retry");
    expect(d.verdict).toBe("action");
  });

  test("timeout (1ª vez) → retry", () => {
    expect(resolveFallbackAction(input({ trigger: "timeout" })).action!.kind).toBe("retry");
  });

  test("stall → re-inject-continuation (gatilho de progresso, não erro)", () => {
    const d = resolveFallbackAction(input({ trigger: "stall", consecutiveStalls: 2 }));
    expect(d.action!.kind).toBe("re-inject-continuation");
  });

  test("stall com escada esgotada → HALT (D6 — parada ruidosa, sem loop)", () => {
    const d = resolveFallbackAction(input({ trigger: "stall", consecutiveStalls: 5, stallEscalationRefires: 5 }));
    expect(d.action!.kind).toBe("halt");
    expect(d.action!.reason).toContain("escada esgotada");
  });

  test("repeated-failure → re-inject-continuation", () => {
    expect(resolveFallbackAction(input({ trigger: "repeated-failure" })).action!.kind).toBe("re-inject-continuation");
  });

  test("error classificada infra → retry", () => {
    const d = resolveFallbackAction(input({ trigger: "error", classification: classifyFailure({ error: "429 quota" }) }));
    expect(d.action!.kind).toBe("retry");
  });

  test("error classificada agent → re-inject-continuation", () => {
    const d = resolveFallbackAction(input({ trigger: "error", classification: classifyFailure({ stallSignals: [{ type: "repetition", reason: "r", at: 0 }] }) }));
    expect(d.action!.kind).toBe("re-inject-continuation");
  });

  test("error sem classificação → HALT fail-closed", () => {
    const d = resolveFallbackAction(input({ trigger: "error" }));
    expect(d.action!.kind).toBe("halt");
  });

  test("error unknown → HALT fail-closed (D5 — nada segue com contrato quebrado)", () => {
    const d = resolveFallbackAction(input({ trigger: "error", classification: classifyFailure({}) }));
    expect(d.action!.kind).toBe("halt");
    expect(d.action!.reason).toContain("unknown");
  });
});

describe("política de escalação (AC2 — stop-all vs skip-and-continue)", () => {
  test("stop-all: orçamento esgotado → HALT com reason + sugestão", () => {
    const budget = new EscalationBudget(1);
    budget.spend(); // esgota
    const d = resolveFallbackAction(input({ trigger: "stall", budget }));
    expect(d.action!.kind).toBe("halt");
    expect(d.budgetExhausted).toBe(true);
    expect(d.action!.reason).toContain("escalation budget exhausted");
  });

  test("skip-and-continue: orçamento esgotado → veredito skip registrado (sem ação — padrão F25 SKIP)", () => {
    const budget = new EscalationBudget(1);
    budget.spend();
    const d = resolveFallbackAction(input({ trigger: "stall", policy: "skip-and-continue", budget }));
    expect(d.action).toBeNull();
    expect(d.verdict).toBe("skip");
    expect(d.budgetExhausted).toBe(true);
  });

  test("orçamento com folga → ações escalam dentro do cap; esgota exatamente no cap", () => {
    const budget = new EscalationBudget(2);
    const d1 = resolveFallbackAction(input({ trigger: "stall", budget, consecutiveStalls: 1 }));
    expect(d1.action!.kind).toBe("re-inject-continuation");
    expect(budget.escalationsUsed).toBe(1);
    const d2 = resolveFallbackAction(input({ trigger: "stall", budget, consecutiveStalls: 2 }));
    expect(d2.action!.kind).toBe("re-inject-continuation");
    expect(budget.escalationsUsed).toBe(2);
    const d3 = resolveFallbackAction(input({ trigger: "stall", budget, consecutiveStalls: 3 }));
    expect(d3.action!.kind).toBe("halt"); // esgotou → HALT sem mais tentativas (AC3)
  });
});

describe("modelSwitch — interface NO-OP (AC4 — fronteira F30)", () => {
  test("rate-limit persistente (retryCount >= 1) → modelSwitch com noop=true", () => {
    const d = resolveFallbackAction(input({ trigger: "rate-limit", retryCount: 1 }));
    expect(d.action!.kind).toBe("modelSwitch");
    expect(d.action!.noop).toBe(true);
    expect(d.action!.reason).toContain("F30");
  });

  test("timeout persistente → modelSwitch noop (interface)", () => {
    const d = resolveFallbackAction(input({ trigger: "timeout", retryCount: 1 }));
    expect(d.action!.kind).toBe("modelSwitch");
    expect(d.action!.noop).toBe(true);
  });

  test("NUNCA toca settings/modelRoles (nada de modelo no F27)", () => {
    // A engine só devolve a ação — não há chamada de setModel/registerProvider
    // em lugar nenhum do módulo; a interface é o contrato do F30.
    const d = resolveFallbackAction(input({ trigger: "rate-limit", retryCount: 1 }));
    expect(d.action!.kind).toBe("modelSwitch");
    expect(Object.keys(d.action!)).not.toContain("model");
    expect(Object.keys(d.action!)).not.toContain("settings");
  });
});

describe("determinismo", () => {
  test("2 runs com a mesma entrada → mesma decisão (sem timestamp/path)", () => {
    const a = resolveFallbackAction(input({ trigger: "stall", consecutiveStalls: 1 }));
    const b = resolveFallbackAction(input({ trigger: "stall", consecutiveStalls: 1 }));
    expect(a).toEqual(b);
    expect(a.action!.reason).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(a.action!.reason).not.toContain("/tmp");
  });
});
