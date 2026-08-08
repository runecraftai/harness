// models/generate.ts — geração determinística do models.json a partir do
// state `models` (D7, PFC-07).
//
// O mecanismo real do SDK é o models.json: ModelRuntime.create({modelsPath})
// + getModel (F21/AD-021 — provado pela fixture); model-runtime.js e
// model-registry.js não expõem switchModel/setModel/reloadModels (validado no
// Execute F30) — a geração é a superfície de APLICAÇÃO do roteamento: as
// chains do state (models.agents.<id>.fallbackChain) declaram QUAIS modelos
// existem por provider — o models.json gerado os torna disponíveis ao SDK.
// Nota (fix cleric F30): `AgentSession.setModel`/`ExtensionAPI.setModel`
// EXISTEM no SDK (agent-session.js:1194 / loader.js:283 — incl. cycleModel);
// o wiring in-process fica para F31/F32 — geração + reload é o caminho
// determinístico e testável offline.
//
// Determinístico por construção (F21 D10): chaves ordenadas (canonicalJson —
// padrão F23), sem timestamp/path absoluto; 2 runs → byte-idêntico. O shape
// é o do renderModelsJson do F21 estendido: providers por provider-id com
// `models: [{id, name}]`. Config de provider (baseUrl/api/apiKey) NÃO é
// inventada: vem do models.json existente (merge preserva) ou de env
// (RUNECRAFT_MODELS_PROVIDER_<ID>_BASEURL/API/APIKEY — testes/fixture); na
// ausência, o campo é omitido (o schema do SDK aceita providers sem baseUrl —
// model-config.js ProviderConfigSchema, todos opcionais).
import { canonicalJson } from "../observability/bundle.ts";
import type { ModelsConfig } from "./config.ts";
import type { FallbackEntry } from "./types.ts";

export interface ModelsGenerateOptions {
	/** providers existentes do models.json atual (merge aditivo — D7). */
	existing?: Record<string, unknown>;
	/** env com overrides de provider (RUNECRAFT_MODELS_PROVIDER_<ID>_*). */
	env?: NodeJS.ProcessEnv;
}

/** Normaliza o id de provider para o sufixo de env (ex.: "openai" → "OPENAI"). */
function envKey(provider: string, suffix: string, env: NodeJS.ProcessEnv): string | undefined {
	const raw = env[`RUNECRAFT_MODELS_PROVIDER_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`]?.trim();
	return raw !== undefined && raw !== "" ? raw : undefined;
}

interface ProviderSpec {
	models: Map<string, string>;
	/** config de nível de provider herdada do models.json existente. */
	inherited: Record<string, unknown>;
	/** provider referenciado por env (config nova — sem invenção). */
	envConfig: Record<string, unknown>;
}

/** Coleta os providers/models referenciados pelas chains (merge determinístico). */
function collectProviders(config: ModelsConfig, existing: Record<string, unknown> | undefined): Map<string, ProviderSpec> {
	const providers = new Map<string, ProviderSpec>();
	const existingProviders = (existing?.providers as Record<string, unknown> | undefined) ?? {};
	const addModel = (providerId: string, modelId: string): void => {
		let spec = providers.get(providerId);
		if (spec === undefined) {
			const inherited = (existingProviders[providerId] as Record<string, unknown> | undefined) ?? {};
			const inheritedModels = Array.isArray(inherited.models)
				? (inherited.models as Array<Record<string, unknown>>)
				: [];
			const merged = new Map<string, string>();
			for (const m of inheritedModels) {
				if (typeof m?.id === "string") merged.set(m.id, typeof m.name === "string" ? m.name : m.id);
			}
			const { models: _drop, ...rest } = inherited;
			spec = { models: merged, inherited: rest, envConfig: {} };
			providers.set(providerId, spec);
		}
		spec.models.set(modelId, modelId);
	};

	// Chains por agente (ordem estável: ids ordenados — determinismo).
	for (const agentId of Object.keys(config.agents).sort()) {
		const chain = config.agents[agentId]?.fallbackChain ?? [];
		for (const entry of chain) addEntryModels(entry, addModel);
	}

	// Merge aditivo (D7): providers EXISTENTES do models.json atual entram
	// mesmo quando não referenciados por chain — nunca destrói config do
	// usuário (providerOut.models vazio → só a config herdada).
	for (const providerId of Object.keys(existingProviders)) {
		if (!providers.has(providerId)) addModel(providerId, "__preserve__");
	}
	return providers;
}

/** Remove o marcador de preservação (__preserve__ nunca entra no output). */
function stripPreserveMarker(spec: ProviderSpec): void {
	spec.models.delete("__preserve__");
}

/** Registra os modelos de um entry (provider(s) × model). */
function addEntryModels(entry: FallbackEntry, addModel: (provider: string, model: string) => void): void {
	for (const provider of entry.providers) addModel(provider, entry.model);
}

/** Render final (PURO — determinístico; chaves ordenadas). */
export function renderModelsJsonFromConfig(config: ModelsConfig, opts: ModelsGenerateOptions = {}): string {
	const env = opts.env ?? process.env;
	const existing = opts.existing;
	const providers = collectProviders(config, existing);
	const existingProviders = (existing?.providers as Record<string, unknown> | undefined) ?? {};

	const out: Record<string, unknown> = { providers: {} };
	for (const providerId of [...providers.keys()].sort()) {
		const spec = providers.get(providerId)!;
		stripPreserveMarker(spec);
		const models = [...spec.models.keys()].sort().map((id) => ({ id, name: id }));
		const providerOut: Record<string, unknown> = {};
		// 1. Config herdada do models.json existente (merge preserva — D7).
		for (const key of Object.keys(spec.inherited).sort()) providerOut[key] = spec.inherited[key];
		// 2. Overrides de env (testes/fixture — loopback/API).
		const baseUrl = envKey(providerId, "BASEURL", env);
		const api = envKey(providerId, "API", env);
		const apiKey = envKey(providerId, "APIKEY", env);
		if (baseUrl !== undefined) providerOut.baseUrl = baseUrl;
		if (api !== undefined) providerOut.api = api;
		if (apiKey !== undefined) providerOut.apiKey = apiKey;
		// 3. Models (sempre — o coração da geração).
		if (models.length > 0 || existingProviders[providerId] !== undefined) {
			providerOut.models = models;
		}
		(out.providers as Record<string, unknown>)[providerId] = providerOut;
	}

	return `${canonicalJson(out)}\n`;
}
