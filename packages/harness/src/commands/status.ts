// status.ts — cross-state status table (F12, LIFE-07).
//
// Triple source (design G3): `pi list` (real) × state.json (managed by the
// harness) × versions.ts (expected pins). Six rows, one per catalog package,
// grouped by logical component. States: ok · ausente · colisão · órfão.
//   ok       installed with the expected version
//   ausente  not present in `pi list`
//   colisão  installed but the recorded/actual version diverges from the pin
//   órfão    present in `pi list` but NOT in state (installed by hand — the
//            harness never claims it)
//
// TTY = table; `--json` = machine-readable; nothing managed → suggestion to
// install (LIFE 4.3). Also reused by the /harness extension (CLI-07) via
// buildStatusMessage.
import {
  resolveRuntime,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { createPiInterop, npmIdentity, type PiInterop } from "../pi.ts";
import { loadState, loadStateReadonly, type InstalledEntry } from "../state.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { scanConflicts, type ConflictInfo } from "../conflicts.ts";
import { execFileSync } from "node:child_process";
import { ADAPTERS, DETECT_ONLY_GUIDES, SUPPORTED_AGENT_IDS } from "../adapters/registry.ts";
import { detectCopilotSync } from "../adapters/copilot.ts";
import { hasSection } from "../adapters/rules.ts";
import { isUpstreamMcpEntry } from "../adapters/mcpConfig.ts";
import { COMPONENTS } from "../plan.ts";
import { AGENTS, MATRIX, type ComponentId, type MatrixAgentId } from "../matrix.ts";
import { detectOwners, type OwnerEvidence } from "../owners.ts";
import { detectActiveDriver, type DriverState } from "../sessionDriver.ts";
import { computeGatesStatus, type GatesStatusReport } from "./gates.ts";
import { repoRoot } from "../gates/git.ts";
import type { AgentId } from "../adapters/types.ts";
import type { AgentRecord, HarnessState } from "../state.ts";
import { GUARD_IDS, effectiveGuards, killSwitchState, type GuardRuntime } from "../guards/guardKit.ts";
import { effectiveVerification, verifyKillSwitch } from "../verify/config.ts";
import { judgeEnvEnabled } from "../verify/stages/judge.ts";
import { effectiveModels, modelsKillSwitch, modelOverrideEnv } from "../models/config.ts";
import { resolveAvailableModels } from "../models/registry.ts";
import { agentsForList, chainForAgent } from "../models/cli.ts";
import { resolveAgentModel } from "../models/resolution.ts";
import { planRoleAgents } from "../agents/materialize.ts";
import { ROLE_IDS } from "../agents/catalog.ts";
import { effectiveRouting, routingKillSwitch, enabledRoutes, mandatoryOf } from "../routing/config.ts";
import { ROUTE_THRESHOLD } from "../routing/classifier.ts";
import { DELEGATABLE_ROUTE_IDS } from "../routing/routes.ts";
import { planPilotChains, PILOT_CHAIN_NAMES } from "../routing/materialize.ts";

export type RowState = "ok" | "ausente" | "colisão" | "órfão" | "upstream";

/** Upstream package name that collides per component domain (F18 two-driver). */
const DOMAIN_UPSTREAM: Record<string, string> = {
  subagents: "pi-subagents",
  taskflow: "pi-taskflow",
  "goal-loop-audit": "pi-goal-list-loop-audit",
  "pr-review": "pi-pr-review",
};

/** Per-cell agent state (F17 D3): configs reais × state × coluna da matriz. */
export type AgentCellState =
  | "ok"
  | "ausente"
  | "não gerenciado"
  | "colisão"
  | "órfã"
  | "—";

export interface StatusAgentComponent {
  component: string;
  /** false for matrix cells marked unsupported (fail-closed per cell). */
  supported: boolean;
  /** cell state; undefined when unsupported (reason carries the message). */
  state?: AgentCellState;
  /** unsupported reason (e.g. "subagents é extensão Pi; use --agent pi"). */
  reason?: string;
}

export interface StatusRow {
  /** package name, e.g. @runecraft/subagents */
  package: string;
  /** logical component group, e.g. subagents */
  group: string;
  /** version found in the real state (state or pi list) — null when not installed */
  installed: string | null;
  /** version pinned by versions.ts */
  expected: string;
  state: RowState;
  /** registered in the harness state (managed vs. installed by hand) */
  managed: boolean;
  /** version recorded in state.json (may diverge from `expected`). */
  stateVersion?: string;
}

export interface StatusReport {
  scope: Scope;
  rows: StatusRow[];
  /** upstream collisions found in `pi list` (F18 treats them; here reported) */
  collisions: ConflictInfo[];
  piDetected: boolean;
  piListSource: "pi" | "settings";
  /** raw error when `pi list` failed and the settings fallback was used. */
  piListError?: string;
  /** no state entries in this scope → render the install suggestion */
  nothingManaged: boolean;
  /** F17 D3: agents × matrix columns, crossed with real configs + state. */
  agents: StatusAgent[];
  /** F18: owners detected across managed files (outro installer, upstreams, MCP, usuário). */
  owners: OwnerEvidence[];
  /** owners with severity warn (install gate mirrors this list). */
  warnings: OwnerEvidence[];
  /** F19 D8: active driver of the Pi session (leitura do ledger do glla). */
  session: { driver: DriverState };
  /** F20: delivery gates status (config repo/global + hooks + receipts + .gitignore). */
  gates: GatesStatusReport | null;
  /** F24: execution guards (estado por guard do scope + kill switch). */
  guards: GuardsStatus;
  /** F25: verification cascade (config efetiva do scope + kill switch + judge env). */
  verification: VerificationStatus;
  /** F30: model routing (config efetiva + kill switch + resolução por agente). */
  models: ModelsStatus;
  /** F32: papéis objetivos (materialização .pi/agents/ + registros do state). */
  roleAgents: RoleAgentsStatusReport;
  /** F33: coded routing (config efetiva + kill switch + rotas habilitadas). */
  routing: RoutingStatus;
}

/** F33 (D6): seção routing do status — config efetiva + kill switch + rotas
 *  habilitadas/obrigatórias (fail-visible no status — D6). */
export interface RoutingStatus {
  killSwitch: boolean;
  killSwitchValue: string | null;
  enabled: boolean;
  valid: boolean;
  error?: string;
  source: "workspace" | "global" | "default";
  threshold: number;
  /** rotas habilitadas (catálogo filtrado — config aditiva). */
  enabledRoutes: string[];
  /** rotas obrigatórias efetivas (ex.: security). */
  mandatoryRoutes: string[];
  /** pilot chains materializadas no escopo workspace (file-level). */
  pilotChains: { installed: string[]; preserved: string[]; missing: string[]; total: number };
}

/** F32 (T5): seção dos papéis objetivos do status — file-level (arquivo
 *  presente/preservado/ausente) × state-level (registrado com contentHash) +
 *  dependência do componente subagents (fork ausente → dados inertes — F17). */
export interface RoleAgentsStatusReport {
  /** componente subagents presente no state/pi list (fork disponível?). */
  forkPresent: boolean;
  /** papéis cujo arquivo materializado == asset (instalados). */
  installed: string[];
  /** papéis com arquivo editado pelo usuário (preservados — F19 D7). */
  preserved: string[];
  /** papéis sem arquivo materializado. */
  missing: string[];
  /** papéis registrados no state com contentHash. */
  registered: string[];
  total: number;
}

/** F24: seção guards do status (D9 — Pi-only honesto: guards são extensão Pi). */
export interface GuardsStatus {
  killSwitch: boolean;
  killSwitchValue: string | null;
  guards: Array<{
    id: GuardRuntime["id"];
    enabled: boolean;
    valid: boolean;
    error?: string;
    mdOnlyAgents?: string[];
    source: GuardRuntime["source"];
  }>;
}

/** F25: seção verification do status (D9 — estado da config + kill switch + judge). */
export interface VerificationStatus {
  killSwitch: boolean;
  killSwitchValue: string | null;
  judgeEnabled: boolean;
  enabled: boolean;
  valid: boolean;
  error?: string;
  source: "workspace" | "global" | "default";
  thresholds: { embedding: { min: number; max: number }; sufficiency: { minRatio: number; maxRatio: number; scopePaths: string[] } };
}

/** F30: seção models do status (D7 — config efetiva + kill switch + override
 *  + resolução por agente com a chain atual). */
export interface ModelsStatus {
  killSwitch: boolean;
  killSwitchValue: string | null;
  enabled: boolean;
  valid: boolean;
  error?: string;
  source: "workspace" | "global" | "default";
  override: string | null;
  default: string | null;
  /** resolução por agente (hosts + chains configuradas). */
  agents: Array<{
    agent: string;
    chain: Array<{ providers: string[]; model: string }>;
    resolved: string | null;
    via: string;
    warning?: string;
  }>;
}

export interface StatusAgent {
  agent: string;
  detected: boolean;
  managed: boolean;
  /** cells of the matrix column + orphan targets (state rows without a cell). */
  components: StatusAgentComponent[];
  /** detect-only agents (outside the matrix): manual-config guide. */
  guide?: string;
}

export interface StatusCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  pi: PiInterop;
  scope: Scope;
}

/** Catalog order: 4 components × their packages (design: 6 rows, grouped). */
export function catalogPackages(): Array<{ name: string; group: string; expected: string }> {
  const rows: Array<{ name: string; group: string; expected: string }> = [];
  for (const componentName of ["subagents", "taskflow", "goal-loop-audit", "pr-review"]) {
    const def = COMPONENTS[componentName];
    if (!def) continue;
    for (const pkg of def.packages) {
      const expected = HARNESS_VERSIONS[pkg];
      if (!expected) continue;
      rows.push({ name: pkg, group: componentName, expected });
    }
  }
  return rows;
}

/** Version of `name` as reported by `pi list` (null when the spec has no pin). */
function versionFromPiList(packages: string[], name: string): string | null {
  const identity = `npm:${name}`;
  const found = packages.find((p) => npmIdentity(p) === identity);
  if (!found) return null;
  const m = /^npm:.*@(.+)$/.exec(found);
  return m?.[1] ?? null;
}

export function computeStatusReport(rt: Runtime, scope: Scope, pi: PiInterop): StatusReport {
  const loaded = loadState(statePath(rt, scope), scope);
  const state = loaded.state;
  const list = pi.list();
  const identities = new Set(list.packages.map(npmIdentity));
  const piDetected = pi.detect().found;

  const rows: StatusRow[] = [];
  // F18: upstream do mesmo domínio presente → two-driver. "colisão" = nosso
  // componente instalado junto com o upstream; "upstream" = só o upstream
  // (nosso ausente).
  const upstreamByDomain = new Map<string, string>();
  for (const conflict of scanConflicts(list.packages)) {
    const name = npmIdentity(conflict.package).replace(/^npm:/, "").split("/").pop() ?? "";
    for (const [domain, upstream] of Object.entries(DOMAIN_UPSTREAM)) {
      if (name === upstream) upstreamByDomain.set(domain, upstream);
    }
  }
  for (const { name, group, expected } of catalogPackages()) {
    const entry: InstalledEntry | undefined = state.components[name];
    const inPi = identities.has(`npm:${name}`);
    let installed: string | null = null;
    if (entry) {
      installed = entry.version;
    } else if (inPi) {
      installed = versionFromPiList(list.packages, name);
    }
    let rowState: RowState;
    const upstreamDomain = upstreamByDomain.get(group);
    if (upstreamDomain) {
      // two-driver (F7): o domínio tem o upstream instalado
      rowState = entry || inPi ? "colisão" : "upstream";
    } else if (!inPi) {
      rowState = "ausente";
    } else if (entry && entry.version === expected) {
      rowState = "ok";
    } else if (entry) {
      rowState = "colisão";
    } else {
      rowState = "órfão";
    }
    rows.push({
      package: name,
      group,
      installed,
      expected,
      state: rowState,
      managed: Boolean(entry),
      stateVersion: entry?.version,
    });
  }

  const owners = detectOwners(rt, pi);
  const root = repoRoot(rt.cwd);
  return {
    scope,
    rows,
    collisions: scanConflicts(list.packages),
    piDetected,
    piListSource: list.source,
    piListError: list.error,
    nothingManaged: Object.keys(state.components).length === 0 && Object.keys(state.agents).length === 0,
    agents: buildStatusAgents(rt, state, piDetected, identities, list.packages),
    owners: owners.owners,
    warnings: owners.owners.filter((o) => o.severity === "warn"),
    // F19 D8: o driver é conceito da coluna Pi — o ledger do glla no cwd da
    // sessão (a linha TTY vira "—" quando pi não é detectado).
    session: { driver: detectActiveDriver(rt.cwd) },
    // F20: seção gates (null fora de repo git).
    gates: root !== null ? computeGatesStatus(rt, root) : null,
    // F24: guards do SCOPE (state deste scope × global do env) + kill switch.
    guards: computeGuardsStatus(rt, scope, state),
    // F25: verification do SCOPE (workspace > global > default) + kill switch + judge.
    verification: computeVerificationStatus(rt, scope, state),
    // F30: models do SCOPE (workspace > global > default) + kill switch + resolução.
    models: computeModelsStatus(rt, scope, state),
    // F32 (T5): papéis objetivos — materialização file-level × registros do
    // state + dependência do componente subagents (fork ausente → inertes).
    roleAgents: computeRoleAgentsStatus(rt, scope, state, identities),
    // F33 (D6): coded routing — config efetiva + kill switch + rotas/chains.
    routing: computeRoutingStatus(rt, scope, state),
  };
}

/** F33 (D6): estado efetivo do roteamento codificado para o scope (mesmo
 *  merge do routing/config.ts — workspace > global > default; rotas
 *  habilitadas = catálogo filtrado; pilot chains file-level no workspace). */
export function computeRoutingStatus(rt: Runtime, scope: Scope, state: HarnessState): RoutingStatus {
  const globalFile = statePath(rt, "global");
  const globalRaw = (() => {
    const loaded = loadStateReadonly(globalFile, "global");
    return loaded.ok ? loaded.state.routing : undefined;
  })();
  const scopeLayer = scope === "workspace" ? state.routing : undefined;
  const globalLayer = scope === "global" ? state.routing : globalRaw;
  const merged = effectiveRouting(scopeLayer, globalLayer, rt.env);
  const kill = routingKillSwitch(rt.env);
  const cfg = merged.config;
  const enabled = enabledRoutes(cfg);
  const enabledRoutesList = DELEGATABLE_ROUTE_IDS.filter((id) => enabled.has(id));
  const mandatoryRoutesList = DELEGATABLE_ROUTE_IDS.filter((id) => mandatoryOf(cfg, id));
  const pilotChains = { installed: [], preserved: [], missing: [], total: PILOT_CHAIN_NAMES.length } as RoutingStatus["pilotChains"];
  if (scope === "workspace") {
    const plans = planPilotChains(rt.cwd, state.piChains);
    for (const plan of plans) {
      if (plan.status === "missing") pilotChains.missing.push(`${plan.name}.chain.md`);
      else if (plan.status === "edited") pilotChains.preserved.push(`${plan.name}.chain.md`);
      else pilotChains.installed.push(`${plan.name}.chain.md`);
    }
  }
  return {
    killSwitch: kill.active,
    killSwitchValue: kill.value,
    enabled: cfg?.enabled ?? false,
    valid: cfg !== undefined,
    ...(cfg === undefined ? { error: merged.problems.join("; ") } : {}),
    source: merged.source,
    threshold: cfg?.threshold.direct ?? ROUTE_THRESHOLD,
    enabledRoutes: enabledRoutesList,
    mandatoryRoutes: mandatoryRoutesList,
    pilotChains,
  };
}

/** F32 (T5): estado dos papéis objetivos no status (file × state × fork). */
export function computeRoleAgentsStatus(
  rt: Runtime,
  scope: Scope,
  state: HarnessState,
  identities: Set<string>,
): RoleAgentsStatusReport {
  const forkPresent = identities.has("npm:@runecraft/subagents");
  if (scope !== "workspace") {
    // Papéis são repo-scoped (QA-2a) — o status global reporta a dependência
    // apenas; sem alvos no scope.
    return { forkPresent, installed: [], preserved: [], missing: [...ROLE_IDS], registered: [], total: ROLE_IDS.length };
  }
  const plans = planRoleAgents(rt.cwd, state.piAgents);
  const installed: string[] = [];
  const preserved: string[] = [];
  const missing: string[] = [];
  for (const plan of plans) {
    if (plan.status === "missing") missing.push(plan.roleId);
    else if (plan.status === "edited") preserved.push(plan.roleId);
    else installed.push(plan.roleId);
  }
  const registered = Object.keys(state.piAgents ?? {});
  return { forkPresent, installed, preserved, missing, registered, total: ROLE_IDS.length };
}

/** F30: estado efetivo do roteamento de modelos para o scope (mesmo merge do
 *  models/config.ts — workspace > global > default; resolução por agente via
 *  src/models/ — D4/D7). */
export function computeModelsStatus(rt: Runtime, scope: Scope, state: HarnessState): ModelsStatus {
  const globalFile = statePath(rt, "global");
  const globalRaw = (() => {
    const loaded = loadStateReadonly(globalFile, "global");
    return loaded.ok ? loaded.state.models : undefined;
  })();
  const scopeLayer = scope === "workspace" ? state.models : undefined;
  const globalLayer = scope === "global" ? state.models : globalRaw;
  const merged = effectiveModels(scopeLayer, globalLayer, rt.env);
  const kill = modelsKillSwitch(rt.env);
  const cfg = merged.config;
  const override = modelOverrideEnv(rt.env) ?? cfg.override;
  const available = resolveAvailableModels(rt.env).models;
  const agents = agentsForList(cfg).map((agent) => {
    const chain = chainForAgent(cfg, agent);
    const outcome = resolveAgentModel(agent, {
      availableModels: available,
      overrideModel: override ?? undefined,
      systemDefaultModel: cfg.default ?? undefined,
      customFallbackChain: chain,
    });
    return {
      agent,
      chain: chain.map((e) => ({ providers: e.providers, model: e.model })),
      resolved: outcome.model,
      via: outcome.via,
      ...(outcome.model === null ? { warning: outcome.warning } : {}),
    };
  });
  return {
    killSwitch: kill.active,
    killSwitchValue: kill.value,
    enabled: cfg?.enabled ?? false,
    valid: cfg !== undefined,
    ...(cfg === undefined ? { error: merged.problems.join("; ") } : {}),
    source: merged.source,
    override,
    default: cfg?.default ?? null,
    agents,
  };
}

/** F25: estado efetivo da verificação para o scope (mesmo merge do config.ts). */
export function computeVerificationStatus(rt: Runtime, scope: Scope, state: HarnessState): VerificationStatus {
  const globalFile = statePath(rt, "global");
  const globalRaw = (() => {
    const loaded = loadStateReadonly(globalFile, "global");
    return loaded.ok ? loaded.state.verification : undefined;
  })();
  const scopeLayer = scope === "workspace" ? state.verification : undefined;
  const globalLayer = scope === "global" ? state.verification : globalRaw;
  const merged = effectiveVerification(scopeLayer, globalLayer, rt.env);
  const kill = verifyKillSwitch(rt.env);
  const cfg = merged.config;
  return {
    killSwitch: kill.active,
    killSwitchValue: kill.value,
    judgeEnabled: judgeEnvEnabled(rt.env),
    enabled: cfg?.enabled ?? false,
    valid: cfg !== undefined,
    ...(cfg === undefined ? { error: merged.problems.join("; ") } : {}),
    source: merged.source,
    thresholds: cfg
      ? {
          embedding: { min: cfg.thresholds.embedding.min, max: cfg.thresholds.embedding.max },
          sufficiency: {
            minRatio: cfg.thresholds.sufficiency.minRatio,
            maxRatio: cfg.thresholds.sufficiency.maxRatio,
            scopePaths: cfg.thresholds.sufficiency.scopePaths,
          },
        }
      : { embedding: { min: 0, max: 0 }, sufficiency: { minRatio: 0, maxRatio: 0, scopePaths: [] } },
  };
}

/** F24: estado efetivo dos guards para o scope (o state do scope é a camada
 *  de maior prioridade; o global entra como fallback — D2 workspace > global). */
export function computeGuardsStatus(rt: Runtime, scope: Scope, state: HarnessState): GuardsStatus {
  const globalFile = statePath(rt, "global");
  const globalRaw = (() => {
    const loaded = loadStateReadonly(globalFile, "global");
    return loaded.ok ? loaded.state.guards : undefined;
  })();
  const scopeLayer = scope === "workspace" ? state.guards : undefined;
  const globalLayer = scope === "global" ? state.guards : globalRaw;
  const merged = effectiveGuards(scopeLayer, globalLayer, rt.env);
  const kill = killSwitchState(rt.env);
  return {
    killSwitch: kill.active,
    killSwitchValue: kill.value,
    guards: GUARD_IDS.map((id) => {
      const g = merged.guards[id];
      return {
        id,
        enabled: g.enabled,
        valid: g.valid,
        ...(g.error ? { error: g.error } : {}),
        ...(id === "rangerMdOnly" ? { mdOnlyAgents: (g.options as { mdOnlyAgents: string[] }).mdOnlyAgents } : {}),
        source: g.source,
      };
    }),
  };
}

/**
 * F17 D3 — agents da matriz cruzando 3 fontes: configs reais (seção/entry) ×
 * state (targets registrados) × coluna esperada (MATRIX). Pi entra com as
 * células pi-packages (grupos; estado vem da tabela de packages) + rules
 * native; os não-Pi com as células da coluna deles; detect-only curados
 * (cursor, grok, …) com guia quando o binário é detectado.
 */
function buildStatusAgents(
  rt: Runtime,
  state: HarnessState,
  piDetected: boolean,
  piIdentities: Set<string>,
  piPackages: string[],
): StatusAgent[] {
  const agents: StatusAgent[] = [];

  // Pi (matrix row "pi"): cells pi-packages × 4 groups + rules native.
  const piComponents: StatusAgentComponent[] = [];
  for (const component of ["subagents", "taskflow", "goal-loop-audit", "pr-review"] as const) {
    const cell = MATRIX.pi[component];
    const def = COMPONENTS[component];
    if (cell?.kind !== "pi-packages" || !def) continue;
    const allPresent = def.packages.every((pkg) => state.components[pkg] !== undefined && piIdentities.has(`npm:${pkg}`));
    piComponents.push({ component, supported: true, state: allPresent ? "ok" : "ausente" });
  }
  piComponents.push({ component: "rules", supported: true, state: "ok" }); // native
  agents.push({
    agent: "pi",
    detected: piDetected,
    managed: Object.keys(state.components).length > 0,
    components: piComponents,
  });

  // Non-Pi matrix rows: rules/mcp cells evaluated against real configs.
  for (const id of SUPPORTED_AGENT_IDS) {
    // F31 (D6): copilot detecta por bin 'code'/'code-insiders' OU dir de
    // extensão github.copilot* (a extensão é o sinal real — CLI nem sempre
    // no PATH); os demais por bin no PATH.
    const detected =
      id === "copilot" ? detectCopilotSync(rt.env).installed : agentBinOnPath(ADAPTERS[id].bin, rt.env);
    const record = state.agents[id];
    agents.push({
      agent: id,
      detected,
      managed: record !== undefined,
      components: nonPiAgentComponents(rt, id, detected, record),
    });
  }

  // Detect-only (outside the matrix): detected → informative row with guide.
  for (const id of Object.keys(DETECT_ONLY_GUIDES)) {
    if (!agentBinOnPath(id, rt.env)) continue;
    agents.push({
      agent: id,
      detected: true,
      managed: false,
      components: [],
      guide: DETECT_ONLY_GUIDES[id],
    });
  }

  return agents;
}

/** Cells of a non-Pi agent's matrix column + orphan targets (F17 D3). */
function nonPiAgentComponents(
  rt: Runtime,
  agentId: AgentId,
  detected: boolean,
  record: AgentRecord | undefined,
): StatusAgentComponent[] {
  const adapter = ADAPTERS[agentId];
  const paths = adapter.paths(rt);
  const components: StatusAgentComponent[] = [];

  for (const component of Object.keys(MATRIX[agentId]) as ComponentId[]) {
    const cell = MATRIX[agentId][component];
    if (cell?.kind === "unsupported") {
      components.push({ component, supported: false, reason: cell.reason });
      continue;
    }
    if (cell?.kind === "rules") {
      components.push({
        component,
        supported: true,
        state: rulesCellState(detected, record, paths.rulesFile, cell.section),
      });
    } else if (cell?.kind === "mcp") {
      components.push({
        component,
        supported: true,
        state: mcpCellState(rt, adapter, detected, record),
      });
    }
  }

  // Orphan targets: registered in the state but no cell in the current column
  // (matrix changed between CLI versions — D6 reports, never removes).
  for (const target of record?.targets ?? []) {
    if (MATRIX[agentId][target.component as ComponentId] === undefined) {
      components.push({ component: target.component, supported: true, state: "órfã" });
    }
  }

  return components;
}

function rulesCellState(
  detected: boolean,
  record: AgentRecord | undefined,
  rulesFile: string,
  section: string,
): AgentCellState {
  if (!detected) return "—";
  if (!record) return "não gerenciado";
  const registered = record.targets.some((t) => t.kind === "rules" && t.section === section);
  if (!registered) return "ausente";
  return hasSection(rulesFile, section) ? "ok" : "ausente";
}

function mcpCellState(
  rt: Runtime,
  adapter: (typeof ADAPTERS)[AgentId],
  detected: boolean,
  record: AgentRecord | undefined,
): AgentCellState {
  if (!detected) return "—";
  let fingerprint: string | null;
  try {
    fingerprint = adapter.readMcpFingerprint(rt);
  } catch {
    return record ? "ausente" : "não gerenciado"; // config ilegível — check 11 aponta
  }
  // Colisão upstream é um fato da config real — vale também para agentes
  // não gerenciados (entry instalada à mão). O install nunca a sobrescreve.
  if (fingerprint !== null && isUpstreamMcpEntry(adapter.readMcpEntry(rt))) return "colisão";
  if (!record) return "não gerenciado";
  const registered = record.targets.find((t) => t.kind === "mcp");
  if (registered) {
    if (fingerprint === null) return "ausente";
    if (fingerprint === registered.contentHash) return "ok";
    // Entry divergente (edição do usuário, sem upstream): config do harness
    // não está lá; uninstall preserva + reporta (SETM-05).
    return "ausente";
  }
  return fingerprint === null ? "ausente" : "ausente";
}

/** Síncrono (status é read-only) — `command -v` via sh. */
function agentBinOnPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${bin} 2>/dev/null`], {
      env: env as Record<string, string>,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function renderStatus(report: StatusReport, opts: { tty: boolean }): string {
  const colors: Record<RowState, string> = {
    ok: "\u001b[32m",
    ausente: "\u001b[31m",
    colisão: "\u001b[33m",
    órfão: "\u001b[2m",
    upstream: "\u001b[33m",
  };
  const RESET = "\u001b[0m";
  const DIM = "\u001b[2m";
  const YELLOW = "\u001b[33m";
  const colored = (s: string, color: string) => (opts.tty ? `${color}${s}${RESET}` : s);
  const c = (s: string, state: RowState) => (opts.tty ? `${colors[state]}${s}${RESET}` : s);
  const lines = [`@runecraft/companion status (scope ${report.scope})`];
  lines.push(`${"Package".padEnd(36)}${"Grupo".padEnd(18)}${"Instalado".padEnd(11)}${"Esperado".padEnd(11)}Estado`);
  for (const row of report.rows) {
    lines.push(
      `${(`npm:${row.package}`).padEnd(36)}${row.group.padEnd(18)}${(row.installed ?? "—").padEnd(11)}${row.expected.padEnd(11)}${c(row.state, row.state)}`,
    );
  }
  for (const collision of report.collisions) {
    lines.push(`warn: colisão com upstream ${collision.package} — ${collision.suggestion} (two-driver — F18)`);
  }
  // F19 D8: linha do driver ativo (two-driver rule). Sem Pi → "—" (goal-loop
  // é extensão Pi — F17); ledger ausente/ilegível → "sessão (direto)"/"não avaliado".
  if (!report.piDetected) {
    lines.push("driver: — (goal-loop é extensão Pi — coluna sem Pi não tem driver)");
  } else if (report.session.driver === "goal-loop") {
    lines.push("driver: goal-loop (dirige a sessão via agent_end — subagents/taskflow entram como workers)");
  } else if (report.session.driver === "direct") {
    lines.push("driver: sessão (direto) — subagents/taskflow são workers compatíveis");
  } else {
    lines.push("driver: não avaliado (estado do goal-loop ilegível — sem crash)");
  }
  if (report.owners.length > 0) {
    lines.push("");
    lines.push("Owners (detecção F18):");
    for (const owner of report.owners) {
      const mark = owner.severity === "warn" ? colored("!", YELLOW) : colored("=", DIM);
      lines.push(`  ${mark} ${owner.name} (${owner.kind}) — ${owner.detail}`);
    }
  }
  // F20: seção Gates (config repo/global + effective + hooks + receipts).
  if (report.gates !== null) {
    lines.push("");
    lines.push("Gates (F20):");
    const g = report.gates;
    lines.push(`  effective: ${g.effective}`);
    lines.push(`  repo config: ${g.repo.present ? (g.repo.enabled === true ? "enabled" : g.repo.enabled === false ? "disabled" : "inválido") : "ausente"}`);
    lines.push(`  global (kill switch): ${g.global.present ? (g.global.enabled === false ? "disabled" : g.global.enabled === true ? "enabled" : "inválido") : "ausente"}`);
    lines.push(
      `  hooks: pre-commit ${g.hooks.preCommit.section ? "✓" : "—"} · pre-push ${g.hooks.prePush.section ? "✓" : "—"} (${g.hooks.dir})`,
    );
    lines.push(`  receipts: ${g.receipts.count}${g.receipts.latest ? ` (mais recente ${g.receipts.latest})` : ""}`);
    if (g.gitignore.lines.length === 0) {
      lines.push(`  .gitignore: linhas de gates ausentes (${g.gitignore.file})`);
    }
  }
  // F24: seção Guards (estado por guard + kill switch).
  lines.push("");
  lines.push("Guards (F24):");
  if (report.guards.killSwitch) {
    lines.push(`  kill switch: RUNECRAFT_GUARDS=${report.guards.killSwitchValue} ATIVO — todos os guards inativos`);
  } else {
    lines.push("  kill switch: RUNECRAFT_GUARDS off");
  }
  for (const guard of report.guards.guards) {
    const state = guard.enabled ? "enabled" : "disabled";
    const valid = guard.valid ? "" : ` · config inválida (fail-closed: ${guard.error ?? "?"})`;
    const agents = guard.mdOnlyAgents ? ` · mdOnlyAgents: [${guard.mdOnlyAgents.join(", ")}]` : "";
    lines.push(`  ${guard.id.padEnd(26)}${state} (fonte ${guard.source})${agents}${valid}`);
  }
  lines.push("  (guards são extensão Pi — agentes não-Pi não têm enforcement; ver ROUTING.md seção Guards)");
  // F25: seção Verification (config efetiva + kill switch + judge env).
  lines.push("");
  lines.push("Verification (F25):");
  const v = report.verification;
  if (v.killSwitch) {
    lines.push(`  kill switch: RUNECRAFT_VERIFY=${v.killSwitchValue} ATIVO — cascata inativa`);
  } else {
    lines.push("  kill switch: RUNECRAFT_VERIFY off");
  }
  const vState = v.enabled ? "enabled" : "disabled";
  const vValid = v.valid ? "" : ` · config inválida (fail-closed: ${v.error ?? "?"})`;
  lines.push(`  cascade: ${vState} (fonte ${v.source})${vValid}`);
  if (v.valid) {
    lines.push(`  thresholds: embedding [${v.thresholds.embedding.min}, ${v.thresholds.embedding.max}] · sufficiency ${v.thresholds.sufficiency.minRatio}..${v.thresholds.sufficiency.maxRatio}${v.thresholds.sufficiency.scopePaths.length > 0 ? ` · scopePaths [${v.thresholds.sufficiency.scopePaths.join(", ")}]` : ""}`);
  }
  lines.push(v.judgeEnabled ? "  judge LLM: ATIVO (RUNECRAFT_VERIFY_LLM_JUDGE=1)" : "  judge LLM: off (env nao definido — CI offline)");
  // F30: seção Models (config efetiva + kill switch + resolução por agente).
  lines.push("");
  lines.push("Models (F30):");
  const m = report.models;
  if (m.killSwitch) {
    lines.push(`  kill switch: RUNECRAFT_MODELS=${m.killSwitchValue} ATIVO — roteamento inativo`);
  } else {
    lines.push("  kill switch: RUNECRAFT_MODELS off");
  }
  const mState = m.enabled ? "enabled" : "disabled";
  const mValid = m.valid ? "" : ` · config inválida (fail-closed: ${m.error ?? "?"})`;
  lines.push(`  routing: ${mState} (fonte ${m.source})${mValid}`);
  lines.push(`  override: ${m.override ?? "—"} · default: ${m.default ?? "null (nada inventado — fim = null + warn)"}`);
  for (const agent of m.agents) {
    const chainText = agent.chain.length === 0 ? "—" : agent.chain.map((e) => `${e.providers.join("/")}:${e.model}`).join(" → ");
    const resolved = agent.resolved ?? `null${agent.warning !== undefined ? " + warn" : ""}`;
    lines.push(`  ${agent.agent.padEnd(10)}chain: ${chainText} · resolvido: ${resolved} (via ${agent.via})`);
  }
  // F33: seção Routing (config efetiva + kill switch + rotas habilitadas/chains).
  lines.push("");
  lines.push("Routing (F33):");
  const r = report.routing;
  if (r.killSwitch) {
    lines.push(`  kill switch: RUNECRAFT_ROUTING=${r.killSwitchValue} ATIVO — roteamento inativo`);
  } else {
    lines.push("  kill switch: RUNECRAFT_ROUTING off");
  }
  const rState = r.enabled ? "enabled" : "disabled";
  const rValid = r.valid ? "" : ` · config inválida (fail-closed: ${r.error ?? "?"})`;
  lines.push(`  routing: ${rState} (fonte ${r.source}) · threshold ${r.threshold}${rValid}`);
  lines.push(`  rotas habilitadas: ${r.enabledRoutes.join(", ") || "—"}`);
  lines.push(`  obrigatórias: ${r.mandatoryRoutes.join(", ") || "—"}`);
  lines.push(
    `  pilot chains: ${r.pilotChains.installed.length} instaladas · ${r.pilotChains.preserved.length} preservadas (editadas) · ${r.pilotChains.missing.length} faltando (${r.pilotChains.total} total — .pi/chains/)`,
  );
  const agents = report.agents.filter((a) => a.detected || a.managed);
  if (agents.length > 0) {
    lines.push("");
    lines.push("Agentes (matriz):");
    for (const agent of agents) {
      if (agent.agent === "pi") continue; // Pi coberto pela tabela de packages
      if (agent.guide) {
        lines.push(`  ${agent.agent.padEnd(12)} detect-only — ${agent.guide}`);
        continue;
      }
      const state = agent.managed ? "gerenciado" : "não gerenciado";
      const cells = agent.components
        .filter((c) => c.supported)
        .map((c) => `${c.component}: ${c.state ?? "?"}`)
        .join(" · ");
      const unsupported = agent.components.filter((c) => !c.supported).map((c) => c.component);
      lines.push(`  ${agent.agent.padEnd(12)}${agent.detected ? "detectado" : "—"} · ${state}${cells ? ` · ${cells}` : ""}`);
      if (unsupported.length > 0) {
        const reasons = [...new Set(agent.components.filter((c) => !c.supported).map((c) => c.reason ?? ""))];
        lines.push(`    não suportado: ${unsupported.join(", ")} (${reasons.join(" | ")})`);
      }
      const note = AGENTS[agent.agent as MatrixAgentId]?.note;
      if (note) lines.push(`    note: ${note}`);
    }
  }
  // F32 (T5): seção Role agents — papéis objetivos (file × state × fork).
  lines.push("");
  lines.push("Role agents (F32):");
  const ra = report.roleAgents;
  if (!ra.forkPresent) {
    lines.push("  dependência: fork subagents NÃO presente — papéis são dados inertes (matriz F17)");
  } else if (report.scope !== "workspace") {
    lines.push("  escopo global: papéis são repo-scoped (instale no workspace — .pi/agents/)");
  } else {
    lines.push(`  instalados (${ra.installed.length}/${ra.total}): ${ra.installed.join(", ") || "—"}`);
    if (ra.preserved.length > 0) lines.push(`  preservados (editados — sync nunca sobrescreve): ${ra.preserved.join(", ")}`);
    if (ra.missing.length > 0) lines.push(`  ausentes (rode \`harness sync\`): ${ra.missing.join(", ")}`);
    lines.push(`  registrados no state: ${ra.registered.join(", ") || "—"}`);
  }
  if (!report.piDetected) lines.push("warn: binário `pi` não detectado — a coluna Instalado pode estar incompleta");
  if (report.piListError) lines.push(`warn: \`pi list\` falhou (${report.piListError}) — coluna Instalado usa o fallback de settings.json`);
  if (report.nothingManaged) {
    lines.push("");
    lines.push("nada instalado pelo harness — rode `npx @runecraft/companion install`.");
  }
  return `${lines.join("\n")}\n`;
}

export function renderStatusJson(report: StatusReport): string {
  return `${JSON.stringify(
    {
      scope: report.scope,
      piDetected: report.piDetected,
      session: { driver: report.session.driver },
      source: report.piListSource,
      piListError: report.piListError ?? null,
      collisions: report.collisions,
      packages: report.rows.map((r) => ({
        package: `npm:${r.package}`,
        component: r.group,
        installed: r.installed,
        expected: r.expected,
        state: r.state,
        managed: r.managed,
      })),
      agents: report.agents.map((a) => ({
        agent: a.agent,
        detected: a.detected,
        managed: a.managed,
        ...(a.guide ? { guide: a.guide } : {}),
        components: a.components.map((c) =>
          c.supported
            ? { component: c.component, supported: true, state: c.state }
            : { component: c.component, supported: false, reason: c.reason },
        ),
      })),
      owners: report.owners,
      warnings: report.warnings,
      ...(report.gates !== null ? { gates: report.gates } : {}),
      guards: {
        killSwitch: report.guards.killSwitch,
        killSwitchValue: report.guards.killSwitchValue,
        guards: report.guards.guards,
      },
      roleAgents: {
        forkPresent: report.roleAgents.forkPresent,
        installed: report.roleAgents.installed,
        preserved: report.roleAgents.preserved,
        missing: report.roleAgents.missing,
        registered: report.roleAgents.registered,
        total: report.roleAgents.total,
      },
      verification: report.verification,
      models: {
        killSwitch: report.models.killSwitch,
        killSwitchValue: report.models.killSwitchValue,
        enabled: report.models.enabled,
        valid: report.models.valid,
        ...(report.models.error !== undefined ? { error: report.models.error } : {}),
        source: report.models.source,
        override: report.models.override,
        default: report.models.default,
        agents: report.models.agents,
      },
      routing: {
        killSwitch: report.routing.killSwitch,
        killSwitchValue: report.routing.killSwitchValue,
        enabled: report.routing.enabled,
        valid: report.routing.valid,
        ...(report.routing.error !== undefined ? { error: report.routing.error } : {}),
        source: report.routing.source,
        threshold: report.routing.threshold,
        enabledRoutes: report.routing.enabledRoutes,
        mandatoryRoutes: report.routing.mandatoryRoutes,
        pilotChains: report.routing.pilotChains,
      },
      suggestion: report.nothingManaged ? "npx @runecraft/companion install" : null,
    },
    null,
    2,
  )}\n`;
}

export async function runStatusCommand(opts: StatusCommandOptions): Promise<number> {
  const report = computeStatusReport(opts.rt, opts.scope, opts.pi);
  if (opts.json) opts.out.write(renderStatusJson(report));
  else opts.out.write(renderStatus(report, { tty: false }));
  return 0;
}

/**
 * Compact status message for the /harness extension (CLI-07): real cross-state
 * logic, one line per scope with state-recorded packages + versions. Nothing
 * managed → install instruction.
 */
export function buildStatusMessage(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const rt = resolveRuntime(cwd, env);
  const parts: string[] = [];
  for (const scope of ["global", "workspace"] as const) {
    const report = computeStatusReport(rt, scope, createPiInterop(rt));
    const managed = report.rows.filter((r) => r.managed);
    if (managed.length === 0) continue;
    parts.push(`${scope}: ${managed.map((r) => `${r.package}@${r.stateVersion ?? r.expected}`).join(", ")}`);
  }
  if (parts.length === 0) {
    return "harness: nada instalado ainda — rode `npx @runecraft/companion install`.";
  }
  return `harness: ${parts.join(" · ")} (estado completo: npx @runecraft/companion status)`;
}
