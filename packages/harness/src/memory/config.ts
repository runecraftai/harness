// memory/config.ts — config do F29 (D5, MEM-05).
//
// Seção `memory` ADITIVA no state.json (F13, schemaVersion 1 — ao lado de
// guards/verification/resilience/observability), freeze por sessão (padrão
// F24 D12) e kill switch `RUNECRAFT_MEMORY=0|false|off` (F20 — convenção).
// Fail-closed por módulo (F24 D10): config inválida → defaults seguros +
// problema reportado (guardLog/doctor).
//
// Campos (D5): `{enabled: true, categoryCap: 10, disabledTools: [],
// importLessonsOnStart: false}`. Campos do source NÃO portados:
// `importance_floor` (achado honesto — parsed, nunca enforced), 
// `disabled_skills` (skill-system OpenCode, n/a no Pi), `data_dir` JSONC
// (→ env RUNECRAFT_MEMORY_DATA_DIR + state).
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, statePath, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";
import { DEFAULT_CATEGORY_CAP } from "./repository.ts";

/** Config aditiva `memory` (D5). */
export interface MemoryConfig {
	/** camada ativa em sessões gerenciadas (default true — fail-closed). */
	enabled: boolean;
	/** softCap por categoria na compaction (default 10 — source). */
	categoryCap: number;
	/** tools rune_* desabilitadas (port do disabled_tools do source). */
	disabledTools: string[];
	/** import de lessons do F28 no init da extensão (QA-3: default false). */
	importLessonsOnStart: boolean;
}

/** Defaults do source (category_cap default 10 — D5). */
export function defaultMemoryConfig(): MemoryConfig {
	return {
		enabled: true,
		categoryCap: DEFAULT_CATEGORY_CAP,
		disabledTools: [],
		importLessonsOnStart: false,
	};
}

export interface ConfigValidation {
	ok: boolean;
	config?: MemoryConfig;
	/** motivos estáveis (campo + problema) — normalização F21 D10. */
	errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_MEMORY=0|false|off` (case-insensitive). */
export function memoryKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
	const raw = env.RUNECRAFT_MEMORY?.trim();
	if (raw === undefined || raw === "") return { active: false, value: null };
	const normalized = raw.toLowerCase();
	return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function intField(value: unknown, field: string, errors: string[], min = 1, max = 1000): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || Number.isNaN(value) || !Number.isInteger(value) || value < min || value > max) {
		errors.push(`${field}: esperado inteiro em [${min}, ${max}], encontrado ${String(value)}`);
		return undefined;
	}
	return value;
}

/**
 * Validação determinística da config bruta (D5). Inválida → fail-closed por
 * módulo (F24 D10): os campos inválidos caem no default seguro e o problema
 * é reportado.
 */
export function validateMemoryConfig(raw: unknown): ConfigValidation {
	if (raw === undefined || raw === null) {
		return { ok: true, config: defaultMemoryConfig(), errors: [] };
	}
	if (!isPlainObject(raw)) {
		return { ok: false, errors: [`memory: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
	}
	const errors: string[] = [];
	const cfg = defaultMemoryConfig();

	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") errors.push("memory.enabled: esperado boolean");
		else cfg.enabled = raw.enabled;
	}

	const categoryCap = intField(raw.categoryCap, "memory.categoryCap", errors, 1, 1000);
	if (categoryCap !== undefined) cfg.categoryCap = categoryCap;

	if (raw.disabledTools !== undefined) {
		if (!Array.isArray(raw.disabledTools) || !raw.disabledTools.every((t) => typeof t === "string")) {
			errors.push("memory.disabledTools: esperado array de strings");
		} else {
			cfg.disabledTools = [...raw.disabledTools];
		}
	}

	if (raw.importLessonsOnStart !== undefined) {
		if (typeof raw.importLessonsOnStart !== "boolean") {
			errors.push("memory.importLessonsOnStart: esperado boolean");
		} else {
			cfg.importLessonsOnStart = raw.importLessonsOnStart;
		}
	}

	if (errors.length > 0) return { ok: false, config: cfg, errors };
	return { ok: true, config: cfg, errors: [] };
}

export interface MemoryStateRead {
	/** config bruta da seção `memory` (undefined quando ausente). */
	memory: unknown;
	corrupt: boolean;
}

/** Leitura read-only da seção `memory` de um state.json (F13; nunca escreve). */
export function readStateMemory(file: string, scope: Scope): MemoryStateRead {
	if (!fs.existsSync(file)) return { memory: undefined, corrupt: false };
	const loaded = loadStateReadonly(file, scope);
	if (!loaded.ok) return { memory: undefined, corrupt: true };
	return { memory: loaded.state.memory, corrupt: false };
}

export interface SessionMemoryRuntime {
	killSwitch: boolean;
	killSwitchValue: string | null;
	/** config efetiva (defaults com overrides validados — fail-closed por módulo). */
	config: MemoryConfig;
	/** problemas de config encontrados (workspace/global) — doctor reporta. */
	problems: string[];
	source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults seguros + problems. */
export function effectiveMemory(
	workspace: unknown,
	global: unknown,
	env: NodeJS.ProcessEnv,
): SessionMemoryRuntime {
	const kill = memoryKillSwitch(env);
	const ws = isPlainObject(workspace) ? workspace : undefined;
	const gl = isPlainObject(global) ? global : undefined;
	const raw = ws ?? gl ?? undefined;
	const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
	const validation = validateMemoryConfig(raw);
	if (!validation.ok) {
		return {
			killSwitch: kill.active,
			killSwitchValue: kill.value,
			config: validation.config ?? defaultMemoryConfig(),
			problems: validation.errors,
			source,
		};
	}
	return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de memória para uma sessão (cwd + env). Freeze: caller. */
export function loadSessionMemory(cwd: string, env: NodeJS.ProcessEnv): SessionMemoryRuntime {
	const rt = resolveRuntime(cwd, env);
	const workspace = readStateMemory(statePath(rt, "workspace"), "workspace");
	const global = readStateMemory(statePath(rt, "global"), "global");
	const merged = effectiveMemory(workspace.memory, global.memory, env);
	if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de memória tratada como ausente (fail-closed)");
	if (global.corrupt) merged.problems.push("global: state.json corrompido — config de memória tratada como ausente (fail-closed)");
	return merged;
}

/** Congelamento por sessão (padrão F24 D12): captura no init da extensão. */
export class SessionMemoryConfig {
	private snapshot: SessionMemoryRuntime | null = null;
	private readonly env: NodeJS.ProcessEnv;

	constructor(env: NodeJS.ProcessEnv) {
		this.env = env;
	}

	capture(cwd: string): void {
		this.snapshot = loadSessionMemory(cwd, this.env);
	}

	/** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
	frozen(cwd: string): SessionMemoryRuntime {
		if (this.snapshot === null) this.capture(cwd);
		return this.snapshot as SessionMemoryRuntime;
	}
}

/** Path da memória de time do F28 (bridge MEM-06): `.runecraft/lessons/promoted.jsonl`. */
export function promotedLessonsPath(cwd: string): string {
	return path.join(cwd, ".runecraft", "lessons", "promoted.jsonl");
}
