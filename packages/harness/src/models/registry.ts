// models/registry.ts — availableModels a partir do models.json do SDK (D7,
// PFC-04/07).
//
// Path REAL de resolução validado no Execute (F30): o SDK 0.81.0 carrega o
// models.json de `<agentDir>/models.json` — agentDir = env PI_CODING_AGENT_DIR
// ?? ~/.pi/agent (node_modules/@earendil-works/pi-coding-agent/dist/
// core/model-runtime.js:59 — `modelsPath = options.modelsPath ??
// join(getAgentDir(), "models.json")`; config.js:412-425 getAgentDir/
// getModelsPath). NÃO é settings.json nem ~/.pi/models.json.
//
// O harness resolve o mesmo arquivo via piAgentDir(env) (RUNECRAFT_PI_HOME ??
// ~/.pi/agent — config.ts) — o mesmo default do SDK; testes redirecionam com
// RUNECRAFT_PI_HOME (o fixture F21 injeta via PI_CODING_AGENT_DIR). O registry
// é INJETÁVEL (o fixture fornece o Set — F21); o default lê o arquivo e
// devolve o conjunto de ids disponíveis (qualificados provider/model + id
// puro — semântica do source). Ilegível/ausente → [] + warn (fail-closed sem
// crash — edge da spec).
import * as fs from "node:fs";
import * as path from "node:path";
import { piAgentDir } from "../config.ts";

/** Path do models.json do SDK (mesmo default do ModelRuntime — D7). */
export function modelsJsonPath(env: NodeJS.ProcessEnv): string {
	return path.join(piAgentDir(env), "models.json");
}

export interface AvailableModelsRead {
	/** ids disponíveis (qualificados `provider/model` + ids puros). */
	models: Set<string>;
	/** path lido (ou null quando ausente/ilegível). */
	path: string | null;
	/** problemas (fail-closed — sem crash). */
	warnings: string[];
}

/**
 * Lê os modelos disponíveis do models.json do SDK. Ausente/ilegível →
 * conjunto vazio + warning (o caller cai para override/chain/default — D7).
 * Determinístico: mesma entrada → mesmo conjunto.
 */
export function resolveAvailableModels(env: NodeJS.ProcessEnv = process.env): AvailableModelsRead {
	const file = modelsJsonPath(env);
	if (!fs.existsSync(file)) {
		return { models: new Set(), path: null, warnings: [`models.json não encontrado em ${file}`] };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return { models: new Set(), path: file, warnings: [`models.json ilegível em ${file}`] };
	}
	if (typeof raw !== "object" || raw === null) {
		return { models: new Set(), path: file, warnings: [`models.json sem shape de objeto em ${file}`] };
	}
	const providers = (raw as { providers?: unknown }).providers;
	if (typeof providers !== "object" || providers === null) {
		return { models: new Set(), path: file, warnings: [`models.json sem seção providers em ${file}`] };
	}
	const models = new Set<string>();
	for (const [providerId, provider] of Object.entries(providers as Record<string, unknown>)) {
		if (typeof provider !== "object" || provider === null) continue;
		const list = (provider as { models?: unknown }).models;
		if (!Array.isArray(list)) continue;
		for (const entry of list) {
			if (typeof entry !== "object" || entry === null) continue;
			const id = (entry as { id?: unknown }).id;
			if (typeof id !== "string" || id === "") continue;
			models.add(`${providerId}/${id}`);
			models.add(id);
		}
	}
	return { models, path: file, warnings: [] };
}
