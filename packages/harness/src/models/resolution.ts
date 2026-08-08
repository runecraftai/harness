// models/resolution.ts — resolução pura de modelo por agente (D4, PFC-04).
//
// Port da SEMÂNTICA do guild (guild/src/agents/model-resolution.ts — lido na
// íntegra) com adaptações honestas (documentadas no docs/PI.md):
//   - precedência: override → custom chain (state) > builtin ({}) →
//     systemDefault → null + warn (o hardcoded default do source
//     "anthropic/claude-opus-4.6" NÃO é portado — o harness não inventa IDs;
//     final = null + warn fail-visible; quem consome decide halt);
//   - TUI paths DROPPED (uiSelectedModel/agentMode/categoryModel — AD-005,
//     decisão 3: roteamento codificado; superfície = state `models` +
//     models.json);
//   - getNextFallbackModel: primeiro modelo disponível APÓS o falho na
//     chain; fim da chain → null (semântica source);
//   - aceita QUALQUER nome de agente (F31 copilot / F32 papéis — source).
//
// PURO por construção: mesmo input → mesmo resultado (F21 D10); sem I/O, sem
// relógio.
import { builtinFallbackChain } from "./defaults.ts";
import type { FallbackEntry } from "./types.ts";

export interface ResolveAgentModelOptions {
	/** modelos disponíveis no registry (models.json do SDK — F21). */
	availableModels: Set<string>;
	/** override explícito (env RUNECRAFT_MODEL_OVERRIDE ?? state models.override). */
	overrideModel?: string;
	/** default do sistema (state models.default). */
	systemDefaultModel?: string;
	/** chain custom (state models.agents.<id>.fallbackChain — precedência
	 *  sobre a builtin, semântica source). */
	customFallbackChain?: FallbackEntry[];
}

export type ResolveOutcome =
	| { model: string; via: "override" | "custom-chain" | "builtin-chain" | "system-default" }
	| { model: null; via: "none"; warning: string };

/** `qualified` de um entry (provider/model) — formato canônico do source. */
function qualifiedModel(entry: FallbackEntry, provider: string): string {
	return `${provider}/${entry.model}`;
}

/**
 * Resolve o modelo de um agente. Precedência (D4):
 *   override → custom chain > builtin → systemDefault → null + warn.
 * NUNCA inventa um ID: sem chain disponível e sem default → null com aviso
 * fail-visible (o caller — F27/CLI — decide halt/escalação).
 */
export function resolveAgentModel(agentName: string, options: ResolveAgentModelOptions): ResolveOutcome {
	const { availableModels, overrideModel, systemDefaultModel, customFallbackChain } = options;

	// 1. Override explícito sempre vence (env RUNECRAFT_MODEL_OVERRIDE ?? state).
	if (overrideModel !== undefined && overrideModel !== null && overrideModel !== "") {
		return { model: overrideModel, via: "override" };
	}

	// 2. Fallback chain — custom (state) > builtin ({} no harness — D4).
	const fallbackChain = customFallbackChain ?? builtinFallbackChain(agentName);
	if (fallbackChain && fallbackChain.length > 0) {
		for (const entry of fallbackChain) {
			for (const provider of entry.providers) {
				const qualified = qualifiedModel(entry, provider);
				if (availableModels.has(qualified)) {
					return { model: qualified, via: customFallbackChain !== undefined ? "custom-chain" : "builtin-chain" };
				}
				if (availableModels.has(entry.model)) {
					return { model: entry.model, via: customFallbackChain !== undefined ? "custom-chain" : "builtin-chain" };
				}
			}
		}
	}

	// 3. System default (state models.default).
	if (systemDefaultModel !== undefined && systemDefaultModel !== null && systemDefaultModel !== "") {
		return { model: systemDefaultModel, via: "system-default" };
	}

	// 4. Nada disponível → null + warn (fail-visible; NADA inventado — D4).
	return {
		model: null,
		via: "none",
		warning: `No model resolved for agent "${agentName}" — no override, no chain match and no system default (harness does not fabricate model ids).`,
	};
}

/**
 * Dado o modelo que falhou e o conjunto de disponíveis, retorna o PRIMEIRO
 * modelo elegível da chain APÓS o falho. Fim da chain (ou agente sem chain)
 * → null (semântica source — getNextFallbackModel).
 */
export function getNextFallbackModel(
	agentName: string,
	failedModel: string,
	availableModels: Set<string>,
	customFallbackChain?: FallbackEntry[] | null,
): string | null {
	const fallbackChain = customFallbackChain ?? builtinFallbackChain(agentName);
	if (!fallbackChain || fallbackChain.length === 0) return null;

	let foundFailed = false;
	for (const entry of fallbackChain) {
		for (const provider of entry.providers) {
			const qualified = qualifiedModel(entry, provider);
			// Pula até passar do modelo falho.
			if (!foundFailed) {
				if (qualified === failedModel || entry.model === failedModel) {
					foundFailed = true;
				}
				continue;
			}
			// Primeiro disponível após o falho.
			if (availableModels.has(qualified)) return qualified;
			if (availableModels.has(entry.model)) return entry.model;
		}
	}

	return null;
}

/** Modelos conhecidos das chains do harness (custom + builtin — port de
 *  getKnownModels; sem registry próprio, reflete apenas chains configuradas). */
export function getKnownModels(chains: Record<string, FallbackEntry[]> = {}): string[] {
	const seen = new Set<string>();
	const models: string[] = [];
	for (const entries of Object.values(chains)) {
		for (const entry of entries) {
			for (const provider of entry.providers) {
				const qualified = qualifiedModel(entry, provider);
				if (!seen.has(qualified)) {
					seen.add(qualified);
					models.push(qualified);
				}
			}
			if (!seen.has(entry.model)) {
				seen.add(entry.model);
				models.push(entry.model);
			}
		}
	}
	return models;
}
