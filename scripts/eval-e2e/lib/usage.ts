// eval-e2e/lib/usage.ts — CostLedger da rodada (padrão F25 cost.ts) + tokensApprox.
//
// Fonte de tokens: usage REAL do SDK (pi-ai `Usage` — AssistantMessage.usage
// e ToolResult.usage; verificado no Execute: types.d.ts:288/300). Nunca
// estimativa inventada — se o SDK não expõe usage, tokensApprox = null + nota.
//
// Custo: fonte primária = `usage.cost.total` calculado pelo SDK (pi-ai
// calculateCost sobre a config do modelo — taxas reais do modelo configurado);
// fallback documentado = tabela haiku-class do config.ts (D7). O cap (AD-037:
// US$ 10 default) aborta a rodada com HALT (status limit + rodada parcial).
import type { RateTable, UsageLike } from "../types.ts";

export interface LedgerSummary {
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	costUsd: number;
	capped: boolean;
}

/** Custo estimado pela tabela documentada (fallback — nunca inventa fora dela). */
export function estimateCost(usage: UsageLike, rate: RateTable): number {
	const input = usage.input + usage.cacheRead + usage.cacheWrite;
	return (
		(input / 1_000_000) * rate.input +
		(usage.output / 1_000_000) * rate.output +
		(usage.cacheRead / 1_000_000) * rate.cacheRead +
		(usage.cacheWrite / 1_000_000) * rate.cacheWrite
	);
}

/** Soma de tokens (totalTokens do SDK, ou input+output+cache quando ausente). */
export function usageTotalTokens(usage: UsageLike): number | null {
	if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) return usage.totalTokens;
	const sum = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return sum > 0 ? sum : null;
}

export class CostLedger {
	private readonly capUsd: number;
	private readonly rate: RateTable;
	private tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	private costUsd = 0;
	private capped = false;

	constructor(capUsd: number, rate: RateTable) {
		this.capUsd = capUsd;
		this.rate = rate;
	}

	/** Registra um usage do SDK; true quando o cap foi estourado APÓS o registro. */
	record(usage: UsageLike): boolean {
		if (this.capped) return true;
		this.tokens.input += usage.input;
		this.tokens.output += usage.output;
		this.tokens.cacheRead += usage.cacheRead;
		this.tokens.cacheWrite += usage.cacheWrite;
		this.tokens.total += usageTotalTokens(usage) ?? 0;
		// Fonte primária: cost real do SDK (calculateCost — taxas do modelo).
		const sdkCost = usage.cost?.total;
		this.costUsd +=
			typeof sdkCost === "number" && sdkCost > 0 ? sdkCost : estimateCost(usage, this.rate);
		if (this.costUsd >= this.capUsd) {
			this.capped = true;
			return true;
		}
		return false;
	}

	/** O cap de custo estourou? (HALT — D7/AD-037). */
	get isCapped(): boolean {
		return this.capped;
	}

	get capUsdValue(): number {
		return this.capUsd;
	}

	summary(): LedgerSummary {
		return {
			tokens: { ...this.tokens },
			costUsd: this.costUsd,
			capped: this.capped,
		};
	}

	/** Contabilidade legível (padrão F25 accountingText). */
	accountingText(): string {
		return `US$ ${this.costUsd.toFixed(4)} / ${this.capUsd.toFixed(2)} cap (tokens ${this.tokens.total})`;
	}
}
