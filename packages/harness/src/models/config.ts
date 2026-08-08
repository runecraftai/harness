// models/config.ts — seção `models` no state (D5, PFC-05).
//
// ADITIVA no state.json (F13, schemaVersion 1), freeze por sessão (F24 D12)
// e kill switch `RUNECRAFT_MODELS=0|false|off` (F20 — convenção). Fail-closed
// por módulo (F24 D10): config inválida → defaults seguros + problema
// reportado (doctor). Override por env `RUNECRAFT_MODEL_OVERRIDE`
// (precedente env-gated do judge do F25 — knob determinístico de teste).
//
// Campos (D5): `{enabled: true, default: string|null, override: string|null,
// agents: Record<id, {fallbackChain: FallbackEntry[]}>,
// autoGenerateModelsJson: false}`.
import * as fs from "node:fs";
import { resolveRuntime, statePath, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";
import type { FallbackEntry } from "./types.ts";

/** Config aditiva `models` (D5). */
export interface ModelsConfig {
	/** camada ativa em sessões gerenciadas (default true — fail-closed). */
	enabled: boolean;
	/** default do sistema (string|null — final da precedência D4). */
	default: string | null;
	/** override global (env RUNECRAFT_MODEL_OVERRIDE ?? este — D5). */
	override: string | null;
	/** chains por agente (state models.agents.<id>.fallbackChain — D4). */
	agents: Record<string, { fallbackChain: FallbackEntry[] }>;
	/** geração de models.json no install/sync (D7 — default false). */
	autoGenerateModelsJson: boolean;
}

/** Defaults da seção `models` (D5). */
export function defaultModelsConfig(): ModelsConfig {
	return {
		enabled: true,
		default: null,
		override: null,
		agents: {},
		autoGenerateModelsJson: false,
	};
}

export interface ConfigValidation {
	ok: boolean;
	config?: ModelsConfig;
	/** motivos estáveis (campo + problema) — normalização F21 D10. */
	errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_MODELS=0|false|off` (case-insensitive). */
export function modelsKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
	const raw = env.RUNECRAFT_MODELS?.trim();
	if (raw === undefined || raw === "") return { active: false, value: null };
	const normalized = raw.toLowerCase();
	return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

/** Override por env (D5 — precedente env-gated F25 judge). */
export function modelOverrideEnv(env: NodeJS.ProcessEnv): string | null {
	const raw = env.RUNECRAFT_MODEL_OVERRIDE?.trim();
	return raw !== undefined && raw !== "" ? raw : null;
}

function stringOrNull(value: unknown, field: string, errors: string[]): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string" || value.trim() === "") {
		errors.push(`${field}: esperado string não-vazia ou null`);
		return undefined;
	}
	return value;
}

function parseFallbackEntry(raw: unknown, field: string, errors: string[]): FallbackEntry | undefined {
	if (!isPlainObject(raw)) {
		errors.push(`${field}: esperado objeto {providers, model}`);
		return undefined;
	}
	const providers = raw.providers;
	if (!Array.isArray(providers) || !providers.every((p) => typeof p === "string")) {
		errors.push(`${field}.providers: esperado array de strings`);
		return undefined;
	}
	const model = raw.model;
	if (typeof model !== "string" || model.trim() === "") {
		errors.push(`${field}.model: esperado string não-vazia`);
		return undefined;
	}
	const entry: FallbackEntry = { providers: [...providers], model };
	if (raw.variant !== undefined) {
		if (typeof raw.variant !== "string") {
			errors.push(`${field}.variant: esperado string`);
		} else {
			entry.variant = raw.variant;
		}
	}
	return entry;
}

/**
 * Validação determinística da config bruta (D5). Inválida → fail-closed por
 * módulo (F24 D10): campos inválidos caem no default seguro + reporte.
 */
export function validateModelsConfig(raw: unknown): ConfigValidation {
	if (raw === undefined || raw === null) {
		return { ok: true, config: defaultModelsConfig(), errors: [] };
	}
	if (!isPlainObject(raw)) {
		return { ok: false, errors: [`models: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
	}
	const errors: string[] = [];
	const cfg = defaultModelsConfig();

	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") errors.push("models.enabled: esperado boolean");
		else cfg.enabled = raw.enabled;
	}

	const def = stringOrNull(raw.default, "models.default", errors);
	if (def !== undefined) cfg.default = def;
	const override = stringOrNull(raw.override, "models.override", errors);
	if (override !== undefined) cfg.override = override;

	if (raw.agents !== undefined) {
		if (!isPlainObject(raw.agents)) {
			errors.push("models.agents: esperado objeto (id → {fallbackChain})");
		} else {
			for (const [id, value] of Object.entries(raw.agents)) {
				if (!isPlainObject(value)) {
					errors.push(`models.agents.${id}: esperado objeto {fallbackChain}`);
					continue;
				}
				const chain = value.fallbackChain;
				if (chain === undefined) {
					cfg.agents[id] = { fallbackChain: [] };
					continue;
				}
				if (!Array.isArray(chain)) {
					errors.push(`models.agents.${id}.fallbackChain: esperado array`);
					continue;
				}
				const entries: FallbackEntry[] = [];
				for (let i = 0; i < chain.length; i++) {
					const entry = parseFallbackEntry(chain[i], `models.agents.${id}.fallbackChain[${i}]`, errors);
					if (entry !== undefined) entries.push(entry);
				}
				cfg.agents[id] = { fallbackChain: entries };
			}
		}
	}

	if (raw.autoGenerateModelsJson !== undefined) {
		if (typeof raw.autoGenerateModelsJson !== "boolean") {
			errors.push("models.autoGenerateModelsJson: esperado boolean");
		} else {
			cfg.autoGenerateModelsJson = raw.autoGenerateModelsJson;
		}
	}

	if (errors.length > 0) return { ok: false, config: cfg, errors };
	return { ok: true, config: cfg, errors: [] };
}

export interface ModelsStateRead {
	/** config bruta da seção `models` (undefined quando ausente). */
	models: unknown;
	corrupt: boolean;
}

/** Leitura read-only da seção `models` de um state.json (F13; nunca escreve). */
export function readStateModels(file: string, scope: Scope): ModelsStateRead {
	if (!fs.existsSync(file)) return { models: undefined, corrupt: false };
	const loaded = loadStateReadonly(file, scope);
	if (!loaded.ok) return { models: undefined, corrupt: true };
	return { models: loaded.state.models, corrupt: false };
}

export interface SessionModelsRuntime {
	killSwitch: boolean;
	killSwitchValue: string | null;
	/** config efetiva (defaults com overrides validados — fail-closed). */
	config: ModelsConfig;
	/** problemas de config encontrados (workspace/global) — doctor reporta. */
	problems: string[];
	source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults + problems. */
export function effectiveModels(
	workspace: unknown,
	global: unknown,
	env: NodeJS.ProcessEnv,
): SessionModelsRuntime {
	const kill = modelsKillSwitch(env);
	const ws = isPlainObject(workspace) ? workspace : undefined;
	const gl = isPlainObject(global) ? global : undefined;
	const raw = ws ?? gl ?? undefined;
	const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
	const validation = validateModelsConfig(raw);
	if (!validation.ok) {
		return {
			killSwitch: kill.active,
			killSwitchValue: kill.value,
			config: validation.config ?? defaultModelsConfig(),
			problems: validation.errors,
			source,
		};
	}
	return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de modelos para uma sessão (cwd + env). Freeze: caller. */
export function loadSessionModels(cwd: string, env: NodeJS.ProcessEnv): SessionModelsRuntime {
	const rt = resolveRuntime(cwd, env);
	const workspace = readStateModels(statePath(rt, "workspace"), "workspace");
	const global = readStateModels(statePath(rt, "global"), "global");
	const merged = effectiveModels(workspace.models, global.models, env);
	if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de modelos tratada como ausente (fail-closed)");
	if (global.corrupt) merged.problems.push("global: state.json corrompido — config de modelos tratada como ausente (fail-closed)");
	return merged;
}

/** Congelamento por sessão (padrão F24 D12): captura no init da extensão. */
export class SessionModelsConfig {
	private snapshot: SessionModelsRuntime | null = null;
	private readonly env: NodeJS.ProcessEnv;

	constructor(env: NodeJS.ProcessEnv) {
		this.env = env;
	}

	capture(cwd: string): void {
		this.snapshot = loadSessionModels(cwd, this.env);
	}

	/** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
	frozen(cwd: string): SessionModelsRuntime {
		if (this.snapshot === null) this.capture(cwd);
		return this.snapshot as SessionModelsRuntime;
	}
}
