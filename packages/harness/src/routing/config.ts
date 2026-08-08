// routing/config.ts — seção `routing` no state (F33, D6; RTE-03/06).
//
// ADITIVA no state.json (F13, schemaVersion 1), freeze por sessão (F24 D12)
// e kill switch `RUNECRAFT_ROUTING=0|false|off` (F20 — convenção). Fail-closed
// por módulo (F24 D10): config inválida → defaults seguros + problema
// reportado (doctor). Defaults = constantes do classificador (D3).
//
// Campos (D6): `{enabled: true, threshold: {direct: 2},
// routes: {<id>: {enabled?, mandatory?}}}` — o catálogo default vive no
// CÓDIGO (routes.ts); a config é override aditivo (rotas desabilitadas não
// são selecionáveis; mandatory é ajustável — fail-closed continua).
import * as fs from "node:fs";
import { resolveRuntime, statePath, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";
import { ROUTE_CATALOG, ROUTE_IDS, type RouteId } from "./routes.ts";
import { ROUTE_THRESHOLD } from "./classifier.ts";

/** Override por rota (D6 — aditivo; ausente = default do catálogo). */
export interface RoutingRouteOverride {
  enabled?: boolean;
  mandatory?: boolean;
}

/** Config aditiva `routing` (D6). */
export interface RoutingConfig {
  /** camada ativa em sessões gerenciadas (default true — fail-closed). */
  enabled: boolean;
  /** threshold da decisão (D3 — default ROUTE_THRESHOLD = 2). */
  threshold: { direct: number };
  /** overrides por rota (id → {enabled, mandatory}) — aditivo. */
  routes: Partial<Record<RouteId, RoutingRouteOverride>>;
}

/** Defaults da seção `routing` (D6 — defaults no CÓDIGO; fail-visible). */
export function defaultRoutingConfig(): RoutingConfig {
  return {
    enabled: true,
    threshold: { direct: ROUTE_THRESHOLD },
    routes: {},
  };
}

export interface ConfigValidation {
  ok: boolean;
  config?: RoutingConfig;
  /** motivos estáveis (campo + problema) — normalização F21 D10. */
  errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_ROUTING=0|false|off` (case-insensitive). */
export function routingKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
  const raw = env.RUNECRAFT_ROUTING?.trim();
  if (raw === undefined || raw === "") return { active: false, value: null };
  const normalized = raw.toLowerCase();
  return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function numberField(
  value: unknown,
  field: string,
  errors: string[],
  opts: { min?: number; int?: boolean } = {},
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field}: esperado number, encontrado ${Array.isArray(value) ? "array" : typeof value}`);
    return undefined;
  }
  if (opts.int && !Number.isInteger(value)) {
    errors.push(`${field}: esperado inteiro, encontrado ${value}`);
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    errors.push(`${field}: esperado >= ${opts.min}, encontrado ${value}`);
    return undefined;
  }
  return value;
}

/**
 * Validação determinística da config bruta (D6). Inválida → fail-closed por
 * módulo (F24 D10): campos inválidos caem no default seguro + reporte.
 * Rotas desconhecidas são rejeitadas (fail-closed — nunca inventa rota).
 */
export function validateRoutingConfig(raw: unknown): ConfigValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, config: defaultRoutingConfig(), errors: [] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`routing: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
  }
  const errors: string[] = [];
  const cfg = defaultRoutingConfig();

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") errors.push("routing.enabled: esperado boolean");
    else cfg.enabled = raw.enabled;
  }

  const threshold = raw.threshold;
  if (threshold !== undefined) {
    if (!isPlainObject(threshold)) {
      errors.push("routing.threshold: esperado objeto");
    } else {
      const direct = numberField(threshold.direct, "routing.threshold.direct", errors, { min: 1, int: true });
      if (direct !== undefined) cfg.threshold.direct = direct;
    }
  }

  const routes = raw.routes;
  if (routes !== undefined) {
    if (!isPlainObject(routes)) {
      errors.push("routing.routes: esperado objeto (id → {enabled?, mandatory?})");
    } else {
      for (const [id, value] of Object.entries(routes)) {
        if (!(ROUTE_IDS as readonly string[]).includes(id)) {
          errors.push(`routing.routes.${id}: rota desconhecida (esperado ${ROUTE_IDS.join("|")})`);
          continue;
        }
        const routeId = id as RouteId;
        if (routeId === "direct") {
          errors.push("routing.routes.direct: rota direct é o fail-closed — não configura");
          continue;
        }
        if (!isPlainObject(value)) {
          errors.push(`routing.routes.${id}: esperado objeto {enabled?, mandatory?}`);
          continue;
        }
        const override: RoutingRouteOverride = {};
        if (value.enabled !== undefined) {
          if (typeof value.enabled !== "boolean") errors.push(`routing.routes.${id}.enabled: esperado boolean`);
          else override.enabled = value.enabled;
        }
        if (value.mandatory !== undefined) {
          if (typeof value.mandatory !== "boolean") errors.push(`routing.routes.${id}.mandatory: esperado boolean`);
          else override.mandatory = value.mandatory;
        }
        cfg.routes[routeId] = override;
      }
    }
  }

  if (errors.length > 0) return { ok: false, config: cfg, errors };
  return { ok: true, config: cfg, errors: [] };
}

/** Conjunto de rotas habilitadas efetivo (catálogo filtrado — D6). */
export function enabledRoutes(config: RoutingConfig): Set<RouteId> {
  const enabled = new Set<RouteId>();
  for (const id of ROUTE_IDS) {
    if (id === "direct") continue;
    const override = config.routes[id];
    const isEnabled = override?.enabled ?? true;
    if (isEnabled) enabled.add(id);
  }
  return enabled;
}

/** mandatory efetivo por rota (override aditivo — D6). */
export function mandatoryOf(config: RoutingConfig, route: RouteId): boolean {
  return config.routes[route]?.mandatory ?? ROUTE_CATALOG[route].mandatory;
}

export interface RoutingStateRead {
  /** config bruta da seção `routing` (undefined quando ausente). */
  routing: unknown;
  corrupt: boolean;
}

/** Leitura read-only da seção `routing` de um state.json (F13; nunca escreve). */
export function readStateRouting(file: string, scope: Scope): RoutingStateRead {
  if (!fs.existsSync(file)) return { routing: undefined, corrupt: false };
  const loaded = loadStateReadonly(file, scope);
  if (!loaded.ok) return { routing: undefined, corrupt: true };
  return { routing: loaded.state.routing, corrupt: false };
}

export interface SessionRoutingRuntime {
  killSwitch: boolean;
  killSwitchValue: string | null;
  /** config efetiva (defaults com overrides validados — fail-closed). */
  config: RoutingConfig;
  /** problemas de config encontrados (workspace/global) — doctor reporta. */
  problems: string[];
  source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → defaults + problems. */
export function effectiveRouting(
  workspace: unknown,
  global: unknown,
  env: NodeJS.ProcessEnv,
): SessionRoutingRuntime {
  const kill = routingKillSwitch(env);
  const ws = isPlainObject(workspace) ? workspace : undefined;
  const gl = isPlainObject(global) ? global : undefined;
  const raw = ws ?? gl ?? undefined;
  const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
  const validation = validateRoutingConfig(raw);
  if (!validation.ok) {
    return {
      killSwitch: kill.active,
      killSwitchValue: kill.value,
      config: validation.config ?? defaultRoutingConfig(),
      problems: validation.errors,
      source,
    };
  }
  return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config!, problems: [], source };
}

/** Resolve a config efetiva de routing para uma sessão (cwd + env). Freeze: caller. */
export function loadSessionRouting(cwd: string, env: NodeJS.ProcessEnv): SessionRoutingRuntime {
  const rt = resolveRuntime(cwd, env);
  const workspace = readStateRouting(statePath(rt, "workspace"), "workspace");
  const global = readStateRouting(statePath(rt, "global"), "global");
  const merged = effectiveRouting(workspace.routing, global.routing, env);
  if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de routing tratada como ausente (fail-closed)");
  if (global.corrupt) merged.problems.push("global: state.json corrompido — config de routing tratada como ausente (fail-closed)");
  return merged;
}

/** Congelamento por sessão (padrão F24 D12): captura no session_start. */
export class SessionRoutingConfig {
  private snapshot: SessionRoutingRuntime | null = null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  capture(cwd: string): void {
    this.snapshot = loadSessionRouting(cwd, this.env);
  }

  /** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
  frozen(cwd: string): SessionRoutingRuntime {
    if (this.snapshot === null) this.capture(cwd);
    return this.snapshot as SessionRoutingRuntime;
  }
}
