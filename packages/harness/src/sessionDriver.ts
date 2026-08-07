// sessionDriver.ts — active-driver detection for the Pi session (F19 D8).
//
// The goal-loop-audit fork persists its session state as a JSONL ledger at
// <cwd>/.pi-glla/active.jsonl (validated in the fork source 2026-08-07:
// `ledgerPath(cwd)` in extensions/goal-loop-core.ts; the legacy pre-rename
// dir `.pi-gla` is migrated at session start — a read-only fallback reads it
// too). Each line is `{type, value, at}`; the goal state is rebuilt by
// folding the `type: "state"` events exactly like the fork's `readState`.
// Malformed/truncated trailing lines (mid-write kill) are skipped, same as
// the fork (v0.28.6, persistence hardening).
//
// "Who drives the session" = the fork's OWN supervision predicate
// (`isSupervising` in extensions/loops/goal.ts): a loop is active, OR a goal
// with status "active" AND autoContinue. "auditing" is a transient
// completion state (the fork schedules no continuations then), "paused"
// awaits an explicit resume, "complete"/"aborted" are terminal — none of
// them drives. Readable outside the session: the ledger is a plain append-only
// file in the cwd (guarded writes — never corrupts).
//
// Output: "goal-loop" | "direct" | "unknown". Missing ledger → "direct"
// (also covers the glla-not-installed session — no noise). Unreadable
// ledger → "unknown" without crash (F12 edge pattern).
import * as fs from "node:fs";
import * as path from "node:path";

export type DriverState = "goal-loop" | "direct" | "unknown";

/** Shape of the goal object persisted in the ledger (`state` events). */
export interface GllaGoalState {
  status?: unknown;
  autoContinue?: unknown;
}

export interface GllaSnapshot {
  goal: GllaGoalState | null;
  loop: { active?: unknown } | null;
}

export type GllaLedgerRead =
  | { ok: true; snapshot: GllaSnapshot }
  | { ok: false; reason: "missing" | "unreadable" };

/** Ledger path of the fork: <cwd>/.pi-glla/active.jsonl (legacy `.pi-gla`
 *  fallback for read-only access — the fork renames it at session start). */
export function gllaLedgerPath(cwd: string): string {
  const current = path.join(cwd, ".pi-glla", "active.jsonl");
  if (fs.existsSync(current)) return current;
  return path.join(cwd, ".pi-gla", "active.jsonl");
}

/**
 * Read + fold the goal-loop-audit ledger with the fork's `readState`
 * semantics: only `type: "state"` events are folded (`{...state, ...value}`
 * — a later `goal: null` clears it, an absent key keeps the previous), and
 * malformed lines are skipped (a truncated trailing line must not lose the
 * rest of the state).
 */
export function readGllaLedger(cwd: string): GllaLedgerRead {
  const file = gllaLedgerPath(cwd);
  if (!fs.existsSync(file)) return { ok: false, reason: "missing" };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let goal: GllaGoalState | null = null;
  let loop: { active?: unknown } | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt: { type?: unknown; value?: unknown };
    try {
      evt = JSON.parse(line) as { type?: unknown; value?: unknown };
    } catch {
      continue; // linha truncada/malformada — pulada, como no fork
    }
    if (evt.type !== "state") continue;
    const value = evt.value;
    if (value === null || typeof value !== "object") continue;
    const v = value as { goal?: unknown; loop?: unknown };
    if (v.goal === null) goal = null;
    else if (typeof v.goal === "object") goal = v.goal as GllaGoalState;
    if (v.loop === null) loop = null;
    else if (typeof v.loop === "object") loop = v.loop as { active?: unknown };
  }
  return { ok: true, snapshot: { goal, loop } };
}

/**
 * Is the goal-loop driving this Pi session? Mirror of the fork's supervision
 * predicate (`isSupervising`): a loop is active, or a goal is `active` with
 * autoContinue. Missing ledger → "direct"; unreadable ledger → "unknown"
 * (nunca crash — F12 edge pattern).
 */
export function detectActiveDriver(cwd: string): DriverState {
  const read = readGllaLedger(cwd);
  if (!read.ok) return read.reason === "missing" ? "direct" : "unknown";
  const { goal, loop } = read.snapshot;
  if (loop?.active === true) return "goal-loop";
  if (goal?.status === "active" && goal.autoContinue === true) return "goal-loop";
  return "direct";
}
