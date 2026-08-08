// persona/config.ts — seção `persona` no state (D5, PFC-05).
//
// ADITIVA no state.json (F13, schemaVersion 1 — ao lado de guards/
// verification/resilience/observability/memory), freeze por sessão (padrão
// F24 D12) e kill switch `RUNECRAFT_PERSONA=0|false|off` (F20 — convenção).
// Fail-closed por módulo (F24 D10): config inválida → defaults seguros +
// problema reportado (doctor).
//
// Campos (D5): `{enabled: true, rulesInjector: {enabled: true,
// toolCallLevel: false}, firstMessageVariant: {enabled: true}}`.
// toolCallLevel = flag P2 (QA-3 — tool-call-level NÃO é portado em v1;
// default false e o parser aceita o campo para futuro sem quebrar).
import * as fs from "node:fs";
import { resolveRuntime, statePath, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";

/** Config aditiva `persona` (D5). */
export interface PersonaConfig {
	/** camada ativa em sessões gerenciadas (default true — fail-closed). */
	enabled: boolean;
	/** injeção das regras de workflow (reuso renderRules("pi") — F19). */
	rulesInjector: {
		enabled: boolean;
		/** flag P2 (QA-3): tool-call-level do guild NÃO portado em v1. */
		toolCallLevel: boolean;
	};
	/** variante de primeira mensagem (port fiel — D3). */
	firstMessageVariant: {
		enabled: boolean;
	};
}

/** Defaults da seção `persona` (D5). */
export function defaultPersonaConfig(): PersonaConfig {
	return {
		enabled: true,
		rulesInjector: { enabled: true, toolCallLevel: false },
		firstMessageVariant: { enabled: true },
	};
}

export interface ConfigValidation {
	ok: boolean;
	config?: PersonaConfig;
	/** motivos estáveis (campo + problema) — normalização F21 D10. */
	errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_PERSONA=0|false|off` (case-insensitive). */
export function personaKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
	const raw = env.RUNECRAFT_PERSONA?.trim();
	if (raw === undefined || raw === "") return { active: false, value: null };
	const normalized = raw.toLowerCase();
	return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function booleanField(raw: unknown, field: string, errors: string[], target: { enabled: boolean }): void {
	if (raw === undefined) return;
	if (typeof raw !== "boolean") {
		errors.push(`${field}: esperado boolean`);
		return;
	}
	target.enabled = raw;
}

/**
 * Validação determinística da config bruta (D5). Inválida → fail-closed por
 * módulo (F24 D10): campos inválidos caem no default seguro + reporte.
 */
export function validatePersonaConfig(raw: unknown): ConfigValidation {
	if (raw === undefined || raw === null) {
		return { ok: true, config: defaultPersonaConfig(), errors: [] };
	}
	if (!isPlainObject(raw)) {
		return { ok: false, errors: [`persona: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
	}
	const errors: string[] = [];
	const cfg = defaultPersonaConfig();

	booleanField(raw.enabled, "persona.enabled", errors, cfg);

	if (raw.rulesInjector !== undefined) {
		if (!isPlainObject(raw.rulesInjector)) {
			errors.push("persona.rulesInjector: esperado objeto");
		} else {
			booleanField(raw.rulesInjector.enabled, "persona.rulesInjector.enabled", errors, cfg.rulesInjector);
			if (raw.rulesInjector.toolCallLevel !== undefined) {
				if (typeof raw.rulesInjector.toolCallLevel !== "boolean") {
					errors.push("persona.rulesInjector.toolCallLevel: esperado boolean");
				} else {
					cfg.rulesInjector.toolCallLevel = raw.rulesInjector.toolCallLevel;
				}
			}
		}
	}

	if (raw.firstMessageVariant !== undefined) {
		if (!isPlainObject(raw.firstMessageVariant)) {
			errors.push("persona.firstMessageVariant: esperado objeto");
		} else {
			booleanField(raw.firstMessageVariant.enabled, "persona.firstMessageVariant.enabled", errors, cfg.firstMessageVariant);
		}
	}

	if (errors.length > 0) return { ok: false, config: cfg, errors };
	return { ok: true, config: cfg, errors: [] };
}

export interface PersonaStateRead {
	/** config bruta da seção `persona` (undefined quando ausente). */
	persona: unknown;
	corrupt: boolean;
}

/** Leitura read-only da seção `persona` de um state.json (F13; nunca escreve). */
export function readStatePersona(file: string, scope: Scope): PersonaStateRead {
	if (!fs.existsSync(file)) return { persona: undefined, corrupt: false };
	const loaded = loadStateReadonly(file, scope);
	if (!loaded.ok) return { persona: undefined, corrupt: true };
	return { persona: loaded.state.persona, corrupt: false };
}

export interface SessionPersonaRuntime {
	killSwitch: boolean;
	killSwitchValue: string | null;
	/** config efetiva (defaults com overrides validados — fail-closed). */
	config: PersonaConfig;
	/** problemas de config encontrados (workspace/global) — doctor reporta. */
	problems: string[];
	source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults + problems. */
export function effectivePersona(
	workspace: unknown,
	global: unknown,
	env: NodeJS.ProcessEnv,
): SessionPersonaRuntime {
	const kill = personaKillSwitch(env);
	const ws = isPlainObject(workspace) ? workspace : undefined;
	const gl = isPlainObject(global) ? global : undefined;
	const raw = ws ?? gl ?? undefined;
	const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
	const validation = validatePersonaConfig(raw);
	if (!validation.ok) {
		return {
			killSwitch: kill.active,
			killSwitchValue: kill.value,
			config: validation.config ?? defaultPersonaConfig(),
			problems: validation.errors,
			source,
		};
	}
	return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de persona para uma sessão (cwd + env). Freeze: caller. */
export function loadSessionPersona(cwd: string, env: NodeJS.ProcessEnv): SessionPersonaRuntime {
	const rt = resolveRuntime(cwd, env);
	const workspace = readStatePersona(statePath(rt, "workspace"), "workspace");
	const global = readStatePersona(statePath(rt, "global"), "global");
	const merged = effectivePersona(workspace.persona, global.persona, env);
	if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de persona tratada como ausente (fail-closed)");
	if (global.corrupt) merged.problems.push("global: state.json corrompido — config de persona tratada como ausente (fail-closed)");
	return merged;
}

/** Congelamento por sessão (padrão F24 D12): captura no init da extensão. */
export class SessionPersonaConfig {
	private snapshot: SessionPersonaRuntime | null = null;
	private readonly env: NodeJS.ProcessEnv;

	constructor(env: NodeJS.ProcessEnv) {
		this.env = env;
	}

	capture(cwd: string): void {
		this.snapshot = loadSessionPersona(cwd, this.env);
	}

	/** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
	frozen(cwd: string): SessionPersonaRuntime {
		if (this.snapshot === null) this.capture(cwd);
		return this.snapshot as SessionPersonaRuntime;
	}
}
