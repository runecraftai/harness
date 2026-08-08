// models/switch.ts — implementação da interface modelSwitch do F27 (D6,
// PFC-06).
//
// O F27 deixou `FallbackActionKind.modelSwitch` como INTERFACE NO-OP
// (src/resilience/types.ts:115; fallback.ts:129-131 — "modelSwitch
// (interface; implementação NO-OP no F27 — F30 resolve)"; ModelSwitchInterface
// em fallback.ts:175). O F30 implementa a resolução REAL: leve → forte via
// getNextFallbackModel (chain do agente); chain esgotada → halt + escalação
// humana (QA-2a — a ação halt do F27 + handoff humano = o "humano" do
// leve→forte→humano).
//
// Fronteira D11: ZERO mudanças nos arquivos do F27 (fallback.ts/types.ts
// intactos — EVAL-043 asserta o diff). A APLICAÇÃO da troca (mecanismo do
// SDK) = geração do models.json (D7 — o SDK 0.81.0 não tem API de troca em
// runtime; validado no Execute). O ponto de consumo documentado: a engine do
// F27 devolve `{kind: "modelSwitch", noop: true}`; quem consome (CLI doctor /
// extensão) chama resolveModelSwitch e aplica via geração — sem tocar o F27.
import { getNextFallbackModel } from "./resolution.ts";
import type { FallbackEntry } from "./types.ts";

export type ModelSwitchResult =
	| { kind: "switch"; model: string; from: string; chain: FallbackEntry[] }
	| { kind: "halt"; reason: string; escalation: "human" };

export interface ResolveModelSwitchOptions {
	/** modelo que falhou (origem da troca — leve→forte). */
	failedModel: string;
	/** modelos disponíveis no registry (models.json — F21). */
	availableModels: Set<string>;
	/** chain do agente (state models.agents.<id>.fallbackChain). */
	chain: FallbackEntry[];
}

/**
 * Resolve a troca de modelo (implementação da interface modelSwitch do F27):
 * próximo modelo disponível APÓS o falho na chain; chain esgotada → halt +
 * escalação humana. PURO — determinístico (mesmo input → mesmo resultado).
 */
export function resolveModelSwitch(agentName: string, options: ResolveModelSwitchOptions): ModelSwitchResult {
	const { failedModel, availableModels, chain } = options;
	const next = getNextFallbackModel(agentName, failedModel, availableModels, chain);
	if (next === null) {
		return {
			kind: "halt",
			reason: "model-chain exhausted",
			escalation: "human",
		};
	}
	return { kind: "switch", model: next, from: failedModel, chain };
}
