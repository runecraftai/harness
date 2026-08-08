// eval-e2e/usage.test.ts — cost accounting (AD-037: US$ 10 cap) + tokensApprox.
//
// Fonte de tokens: usage REAL do SDK (nunca estimativa inventada — STOP RULE).
// Custo: cost do SDK (calculateCost — taxas reais do modelo) quando presente;
// fallback documentado = tabela haiku-class do config.ts (D7). Cap → HALT.
import { describe, expect, test } from "bun:test";
import { DEFAULT_COST_CAP_USD, DEFAULT_RATE_TABLE } from "./config.ts";
import { CostLedger, estimateCost, usageTotalTokens } from "./lib/usage.ts";
import type { UsageLike } from "./types.ts";

function usage(partial: Partial<UsageLike>): UsageLike {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { total: 0 },
		...partial,
	};
}

describe("CostLedger (padrão F25 — caps → HALT)", () => {
	test("cost do SDK é a fonte primária; tabela é fallback documentado", () => {
		const ledger = new CostLedger(DEFAULT_COST_CAP_USD, DEFAULT_RATE_TABLE);
		// usage com cost real do SDK (calculateCost — taxas do modelo).
		ledger.record(usage({ input: 1_000_000, output: 100_000, cost: { total: 1.5 } }));
		expect(ledger.summary().costUsd).toBeCloseTo(1.5, 6);
		expect(ledger.isCapped).toBe(false);
	});

	test("sem cost do SDK → estimativa pela tabela documentada (nunca inventa)", () => {
		const ledger = new CostLedger(DEFAULT_COST_CAP_USD, DEFAULT_RATE_TABLE);
		ledger.record(usage({ input: 1_000_000, output: 1_000_000 }));
		// input $0.80/M + output $4/M = $4.80
		expect(ledger.summary().costUsd).toBeCloseTo(4.8, 6);
	});

	test("cap estourado → capped (HALT semantics)", () => {
		const ledger = new CostLedger(1, DEFAULT_RATE_TABLE); // cap de US$ 1
		expect(ledger.record(usage({ input: 5_000_000, output: 5_000_000, cost: { total: 20 } }))).toBe(
			true,
		);
		expect(ledger.isCapped).toBe(true);
		expect(ledger.accountingText()).toContain("cap");
	});

	test("cap NÃO estoura antes do limite (acumula)", () => {
		const ledger = new CostLedger(10, DEFAULT_RATE_TABLE);
		for (let i = 0; i < 5; i += 1) {
			ledger.record(usage({ input: 100_000, output: 10_000, cost: { total: 0.1 } }));
		}
		expect(ledger.isCapped).toBe(false);
		expect(ledger.summary().costUsd).toBeCloseTo(0.5, 6);
	});

	test("recorde após capped não muda mais (HALT)", () => {
		const ledger = new CostLedger(1, DEFAULT_RATE_TABLE);
		ledger.record(usage({ cost: { total: 2 } }));
		ledger.record(usage({ cost: { total: 5 } }));
		expect(ledger.summary().costUsd).toBeCloseTo(2, 6);
	});
});

describe("tokensApprox (honestidade — SDK expõe ou null)", () => {
	test("totalTokens do SDK é usado", () => {
		expect(usageTotalTokens(usage({ input: 10, output: 5, totalTokens: 100 }))).toBe(100);
	});

	test("sem totalTokens → soma input+output+cache (fallback honesto)", () => {
		expect(usageTotalTokens(usage({ input: 10, output: 5, cacheRead: 3 }))).toBe(18);
	});

	test("zero usage → null (nunca inventa)", () => {
		expect(usageTotalTokens(usage({}))).toBeNull();
	});
});

describe("estimateCost (tabela D7 — documentada)", () => {
	test("taxas haiku-class da tabela default", () => {
		expect(DEFAULT_RATE_TABLE.input).toBe(0.8);
		expect(DEFAULT_RATE_TABLE.output).toBe(4);
	});
	test("fórmula input/output/cache", () => {
		expect(
			estimateCost(
				usage({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000 }),
				DEFAULT_RATE_TABLE,
			),
		).toBeCloseTo(5.68, 6);
	});
});
