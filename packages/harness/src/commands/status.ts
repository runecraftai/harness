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
import { loadState, type InstalledEntry } from "../state.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { scanConflicts, type ConflictInfo } from "../conflicts.ts";
import { execFileSync } from "node:child_process";
import { ADAPTERS, SUPPORTED_AGENT_IDS } from "../adapters/registry.ts";
import { COMPONENTS } from "../plan.ts";

export type RowState = "ok" | "ausente" | "colisão" | "órfão";

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
  /** F15/T8: non-Pi agents (detected + managed). */
  agents: Array<{ agent: string; detected: boolean; managed: boolean }>;
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
    if (!inPi) {
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

  return {
    scope,
    rows,
    collisions: scanConflicts(list.packages),
    piDetected,
    piListSource: list.source,
    piListError: list.error,
    nothingManaged: Object.keys(state.components).length === 0 && Object.keys(state.agents).length === 0,
    agents: SUPPORTED_AGENT_IDS.map((id) => ({
      agent: id,
      detected: agentBinOnPath(ADAPTERS[id].bin, rt.env),
      managed: state.agents[id] !== undefined,
    })),
  };
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
  };
  const RESET = "\u001b[0m";
  const c = (s: string, state: RowState) => (opts.tty ? `${colors[state]}${s}${RESET}` : s);
  const lines = [`@runecraft/harness status (scope ${report.scope})`];
  lines.push(`${"Package".padEnd(36)}${"Grupo".padEnd(18)}${"Instalado".padEnd(11)}${"Esperado".padEnd(11)}Estado`);
  for (const row of report.rows) {
    lines.push(
      `${(`npm:${row.package}`).padEnd(36)}${row.group.padEnd(18)}${(row.installed ?? "—").padEnd(11)}${row.expected.padEnd(11)}${c(row.state, row.state)}`,
    );
  }
  for (const collision of report.collisions) {
    lines.push(`warn: colisão com upstream ${collision.package} — ${collision.suggestion} (tratamento no F18)`);
  }
  const agents = report.agents.filter((a) => a.detected || a.managed);
  if (agents.length > 0) {
    lines.push("");
    lines.push("Agentes não-Pi (F15):");
    for (const agent of agents) {
      const state = agent.managed ? "gerenciado" : "detectado (não gerenciado)";
      lines.push(`  ${agent.agent.padEnd(12)}${state}`);
    }
  }
  if (!report.piDetected) lines.push("warn: binário `pi` não detectado — a coluna Instalado pode estar incompleta");
  if (report.piListError) lines.push(`warn: \`pi list\` falhou (${report.piListError}) — coluna Instalado usa o fallback de settings.json`);
  if (report.nothingManaged) {
    lines.push("");
    lines.push("nada instalado pelo harness — rode `npx @runecraft/harness install`.");
  }
  return `${lines.join("\n")}\n`;
}

export function renderStatusJson(report: StatusReport): string {
  return `${JSON.stringify(
    {
      scope: report.scope,
      piDetected: report.piDetected,
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
      agents: report.agents.map((a) => ({ agent: a.agent, detected: a.detected, managed: a.managed })),
      suggestion: report.nothingManaged ? "npx @runecraft/harness install" : null,
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
    return "harness: nada instalado ainda — rode `npx @runecraft/harness install`.";
  }
  return `harness: ${parts.join(" · ")} (estado completo: npx @runecraft/harness status)`;
}
