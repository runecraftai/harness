// models/types.ts — tipos do roteamento de modelo (D4, PFC-04).
//
// Port RPG-free dos tipos do guild (guild/src/agents/model-resolution.ts —
// lido na íntegra): MESMA semântica de FallbackEntry/AgentModelRequirement,
// SEM aliases de tema. Tipos puros — sem zod (zero deps novas).
/** Entrada de uma chain de fallback (port do source — mesma semântica). */
export interface FallbackEntry {
	/** providers que oferecem o modelo (ex.: ["anthropic"]). */
	providers: string[];
	/** id do modelo (ex.: "claude-sonnet-4.6"). */
	model: string;
	/** variante opcional (source — não usado no harness v1). */
	variant?: string;
}

/** Requisito de modelo de um agente (port — o harness não tem registry
 *  próprio; chains vêm do state models.agents.<id>.fallbackChain — D4). */
export interface AgentModelRequirement {
	fallbackChain: FallbackEntry[];
}
