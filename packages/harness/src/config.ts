// config.ts — path/env resolution for the harness CLI (F11).
//
// Testability (F21 D1): every user-facing path is overridable through env so
// tests run against tmp dirs without touching the real machine:
//   RUNECRAFT_PI_BIN  → fake pi binary (single fake mechanism for the pi interop)
//   RUNECRAFT_PI_HOME → pi agent dir (default ~/.pi/agent)
//   RUNECRAFT_HOME    → runecraft global dir (default ~/.runecraft)
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Scope = "global" | "workspace";

export const SCOPES: readonly Scope[] = ["global", "workspace"];

/** Minimal write sink — process.stdout/stderr satisfy it structurally. */
export interface TextSink {
  write(chunk: string): void;
}

/** Resolved runtime: cwd and env come from the dispatch context or the process. */
export interface Runtime {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function resolveRuntime(cwd: string | undefined, env: NodeJS.ProcessEnv | undefined): Runtime {
  return { cwd: cwd ?? process.cwd(), env: env ?? process.env };
}

/** Pi agent dir: where pi keeps settings.json, npm/ etc. (default ~/.pi/agent). */
export function piAgentDir(env: NodeJS.ProcessEnv): string {
  return env.RUNECRAFT_PI_HOME ?? path.join(os.homedir(), ".pi", "agent");
}

/** Runecraft dir for the scope: global ~/.runecraft, workspace <cwd>/.runecraft. */
export function runecraftDir(rt: Runtime, scope: Scope): string {
  if (scope === "workspace") return path.join(rt.cwd, ".runecraft");
  return rt.env.RUNECRAFT_HOME ?? path.join(os.homedir(), ".runecraft");
}

/** settings.json written by pi for the scope (global ~/.pi/agent, project .pi/). */
export function piSettingsPath(rt: Runtime, scope: Scope): string {
  if (scope === "workspace") return path.join(rt.cwd, ".pi", "settings.json");
  return path.join(piAgentDir(rt.env), "settings.json");
}

/** pr-review.json — own config file of the pr-review fork (AD-012: user ~/.pi/agent, project <repo>/.pi). */
export function prReviewConfigPath(rt: Runtime, scope: Scope): string {
  if (scope === "workspace") return path.join(rt.cwd, ".pi", "pr-review.json");
  return path.join(piAgentDir(rt.env), "pr-review.json");
}

/**
 * goal-loop-audit settings — own file of the fork (experimento F14: global
 * ~/.pi/agent/pi-goal-list-loop-audit.settings.json, project <repo>/.pi-glla/settings.json).
 */
export function gllaSettingsPath(rt: Runtime, scope: Scope): string {
  if (scope === "workspace") return path.join(rt.cwd, ".pi-glla", "settings.json");
  return path.join(piAgentDir(rt.env), "pi-goal-list-loop-audit.settings.json");
}

/** state.json for the scope (F13 schema v1, minimal subset in F11). */
export function statePath(rt: Runtime, scope: Scope): string {
  return path.join(runecraftDir(rt, scope), "state.json");
}

/**
 * Non-Pi agent config homes (F15 D9): env override > platform default.
 * The config dir is informative (binary on PATH = installed); inject creates
 * dirs when missing. OpenCode honors $XDG_CONFIG_HOME when absolute.
 *
 * HOME comes from the RUNTIME env (rt.env) so fixtures can redirect it —
 * never os.homedir() (process HOME), which would leak into the real ~.
 */
export function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? os.homedir();
}

export function claudeCodeHome(env: NodeJS.ProcessEnv): string {
  return env.RUNECRAFT_CLAUDE_HOME ?? path.join(homeDir(env), ".claude");
}

export function opencodeHome(env: NodeJS.ProcessEnv): string {
  if (env.RUNECRAFT_OPENCODE_HOME) return env.RUNECRAFT_OPENCODE_HOME;
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "opencode");
  return path.join(homeDir(env), ".config", "opencode");
}

export function codexHome(env: NodeJS.ProcessEnv): string {
  return env.RUNECRAFT_CODEX_HOME ?? path.join(homeDir(env), ".codex");
}

/** Snapshot dir for backups (F13; F11 writes the pre-write snapshot here). */
export function backupsDir(rt: Runtime, scope: Scope): string {
  return path.join(runecraftDir(rt, scope), "backups");
}

/**
 * User-config files the install/sync/uninstall operations touch for the scope
 * (pre-write snapshot set). state.json is intentionally NOT included: state is
 * harness bookkeeping, not user config (edge F13 — a state-only change must not
 * create a backup). Config files created by the harness (createdFiles) are added
 * by the commands that touch them (uninstall deletes them whole).
 *
 * pr-review.json is included (design F13): the F14 merge target list may touch
 * it in future versions — the snapshot must cover it before any write. The
 * goal-loop-audit settings file is NOT included in v1: the harness never writes
 * it (defaults do fork já valem na ausência; experimento F14).
 */
export function filesTouchedByInstall(rt: Runtime, scope: Scope): string[] {
  return [piSettingsPath(rt, scope), prReviewConfigPath(rt, scope)];
}

export function isScope(value: string | undefined): value is Scope {
  return value === "global" || value === "workspace";
}

/**
 * Effective scope for state-reading commands (status/sync/uninstall, design F12):
 * an explicit --scope wins; otherwise the workspace is used when it has a
 * state.json (a project-scoped harness exists), else global.
 */
export function resolveEffectiveScope(rt: Runtime, requested: Scope, explicit: boolean): Scope {
  if (explicit) return requested;
  if (fs.existsSync(path.join(rt.cwd, ".runecraft", "state.json"))) return "workspace";
  return "global";
}
