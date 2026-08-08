// observability/config.ts — config do F28 (D9, OBS-11).
//
// Seção `observability` ADITIVA no state.json (F13, schemaVersion 1 — ao lado
// de guards/verification/resilience), freeze por sessão (padrão F24 D12/F27)
// e kill switch `RUNECRAFT_OBSERVABILITY=0|false|off` (F20 — convenção).
// Fail-closed por módulo (F24 D10): config inválida → defaults seguros +
// problema reportado (doctor).
//
// Defaults calibrados no Execute: thresholds 0.8/0.95 = port do
// context-window-monitor do arcanum (checkContextWindow); thresholds de
// lessons (promotion 3 / high 2 / maxAdendo 3) = propostos no design D9.
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, statePath, type Runtime, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";

export interface ContextWindowConfig {
  /** usagePct >= warningPct → action warn (default 0.8 — arcanum). */
  warningPct: number;
  /** usagePct >= criticalPct → action recover (default 0.95 — arcanum). */
  criticalPct: number;
}

export interface LessonsConfig {
  /** count >= promotionThreshold → promovida (default 3). */
  promotionThreshold: number;
  /** priority=high E count >= highPriorityThreshold → promove antes (default 2). */
  highPriorityThreshold: number;
  /** teto de lições por adendo (default 3). */
  maxAdendoLessons: number;
}

/** Config aditiva `observability` (D9). */
export interface ObservabilityConfig {
  /** camada ativa em sessões gerenciadas (default true — fail-closed). */
  enabled: boolean;
  contextWindow: ContextWindowConfig;
  lessons: LessonsConfig;
}

/** Defaults calibrados (valores do arcanum + design D9). */
export function defaultObservabilityConfig(): ObservabilityConfig {
  return {
    enabled: true,
    contextWindow: { warningPct: 0.8, criticalPct: 0.95 },
    lessons: { promotionThreshold: 3, highPriorityThreshold: 2, maxAdendoLessons: 3 },
  };
}

export interface ConfigValidation {
  ok: boolean;
  config?: ObservabilityConfig;
  /** motivos estáveis (campo + problema) — normalização F21 D10. */
  errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_OBSERVABILITY=0|false|off` (case-insensitive). */
export function observabilityKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
  const raw = env.RUNECRAFT_OBSERVABILITY?.trim();
  if (raw === undefined || raw === "") return { active: false, value: null };
  const normalized = raw.toLowerCase();
  return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function pctField(value: unknown, field: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    errors.push(`${field}: esperado number em [0,1], encontrado ${String(value)}`);
    return undefined;
  }
  return value;
}

function intField(value: unknown, field: string, errors: string[], min = 1): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isInteger(value) || value < min) {
    errors.push(`${field}: esperado inteiro >= ${min}, encontrado ${String(value)}`);
    return undefined;
  }
  return value;
}

/**
 * Validação determinística da config bruta (D9). Inválida → fail-closed por
 * módulo (F24 D10): os campos inválidos caem no default seguro e o problema
 * é reportado.
 */
export function validateObservabilityConfig(raw: unknown): ConfigValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, config: defaultObservabilityConfig(), errors: [] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`observability: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
  }
  const errors: string[] = [];
  const cfg = defaultObservabilityConfig();

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") errors.push("observability.enabled: esperado boolean");
    else cfg.enabled = raw.enabled;
  }

  const contextWindow = raw.contextWindow;
  if (contextWindow !== undefined) {
    if (!isPlainObject(contextWindow)) {
      errors.push("observability.contextWindow: esperado objeto");
    } else {
      const warningPct = pctField(contextWindow.warningPct, "observability.contextWindow.warningPct", errors);
      const criticalPct = pctField(contextWindow.criticalPct, "observability.contextWindow.criticalPct", errors);
      if (warningPct !== undefined && criticalPct !== undefined && warningPct >= criticalPct) {
        errors.push("observability.contextWindow: warningPct deve ser < criticalPct");
      } else {
        if (warningPct !== undefined) cfg.contextWindow.warningPct = warningPct;
        if (criticalPct !== undefined) cfg.contextWindow.criticalPct = criticalPct;
      }
    }
  }

  const lessons = raw.lessons;
  if (lessons !== undefined) {
    if (!isPlainObject(lessons)) {
      errors.push("observability.lessons: esperado objeto");
    } else {
      const promotionThreshold = intField(lessons.promotionThreshold, "observability.lessons.promotionThreshold", errors);
      const highPriorityThreshold = intField(lessons.highPriorityThreshold, "observability.lessons.highPriorityThreshold", errors);
      const maxAdendoLessons = intField(lessons.maxAdendoLessons, "observability.lessons.maxAdendoLessons", errors);
      if (promotionThreshold !== undefined) cfg.lessons.promotionThreshold = promotionThreshold;
      if (highPriorityThreshold !== undefined) cfg.lessons.highPriorityThreshold = highPriorityThreshold;
      if (maxAdendoLessons !== undefined) cfg.lessons.maxAdendoLessons = maxAdendoLessons;
    }
  }

  if (errors.length > 0) return { ok: false, config: cfg, errors };
  return { ok: true, config: cfg, errors: [] };
}

export interface ObservabilityStateRead {
  /** config bruta da seção `observability` (undefined quando ausente). */
  observability: unknown;
  corrupt: boolean;
}

/** Leitura read-only da seção `observability` de um state.json (F13; nunca escreve). */
export function readStateObservability(file: string, scope: Scope): ObservabilityStateRead {
  if (!fs.existsSync(file)) return { observability: undefined, corrupt: false };
  const loaded = loadStateReadonly(file, scope);
  if (!loaded.ok) return { observability: undefined, corrupt: true };
  return { observability: loaded.state.observability, corrupt: false };
}

export interface SessionObservabilityRuntime {
  killSwitch: boolean;
  killSwitchValue: string | null;
  /** config efetiva (defaults com overrides validados — fail-closed por módulo). */
  config: ObservabilityConfig;
  /** problemas de config encontrados (workspace/global) — doctor reporta. */
  problems: string[];
  source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults seguros + problems. */
export function effectiveObservability(
  workspace: unknown,
  global: unknown,
  env: NodeJS.ProcessEnv,
): SessionObservabilityRuntime {
  const kill = observabilityKillSwitch(env);
  const ws = isPlainObject(workspace) ? workspace : undefined;
  const gl = isPlainObject(global) ? global : undefined;
  const raw = ws ?? gl ?? undefined;
  const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
  const validation = validateObservabilityConfig(raw);
  if (!validation.ok) {
    return {
      killSwitch: kill.active,
      killSwitchValue: kill.value,
      config: validation.config ?? defaultObservabilityConfig(),
      problems: validation.errors,
      source,
    };
  }
  return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de observabilidade para uma sessão (cwd + env). Freeze: caller. */
export function loadSessionObservability(cwd: string, env: NodeJS.ProcessEnv): SessionObservabilityRuntime {
  const rt = resolveRuntime(cwd, env);
  const workspace = readStateObservability(statePath(rt, "workspace"), "workspace");
  const global = readStateObservability(statePath(rt, "global"), "global");
  const merged = effectiveObservability(workspace.observability, global.observability, env);
  if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de observabilidade tratada como ausente (fail-closed)");
  if (global.corrupt) merged.problems.push("global: state.json corrompido — config de observabilidade tratada como ausente (fail-closed)");
  return merged;
}

/** Congelamento por sessão (padrão F24 D12/F27): captura no session_start. */
export class SessionObservabilityConfig {
  private snapshot: SessionObservabilityRuntime | null = null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  capture(cwd: string): void {
    this.snapshot = loadSessionObservability(cwd, this.env);
  }

  /** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
  frozen(cwd: string): SessionObservabilityRuntime {
    if (this.snapshot === null) this.capture(cwd);
    return this.snapshot as SessionObservabilityRuntime;
  }
}

// ---------------------------------------------------------------------------
// Paths (QA-1a: por sessão; precedente evidence/partial do F21)
// ---------------------------------------------------------------------------

/** Dir dos eventos: `.runecraft/events/` (QA-1a — um arquivo por sessão). */
export function eventsDir(cwd: string): string {
  return path.join(cwd, ".runecraft", "events");
}

/** Arquivo de eventos de UMA sessão (QA-1a — isolamento multi-sessão AD-019). */
export function eventsFileFor(cwd: string, sessionId: string): string {
  return path.join(eventsDir(cwd), `${sessionId}.jsonl`);
}

/** Estado de lessons: `.runecraft/lessons.jsonl` (gitignored — dado derivado). */
export function lessonsFile(cwd: string): string {
  return path.join(cwd, ".runecraft", "lessons.jsonl");
}

/** Memória de time: `.runecraft/lessons/promoted.jsonl` (VERSIONADO — QA-4a). */
export function promotedFile(cwd: string): string {
  return path.join(cwd, ".runecraft", "lessons", "promoted.jsonl");
}
