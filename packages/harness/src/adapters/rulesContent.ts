// adapters/rulesContent.ts — workflow rules injected per agent (F19 D5/D6).
//
// F19 is the OWNER of the rules text (design F19 "Conteúdo dos templates
// (v1)" — a fonte de verdade do conteúdo). F15 delivers the mechanism
// (markers/upsert/BOM/CRLF) and F17 the matrix column; the injected section
// `runecraft:workflow` is rendered deterministically here.
//
// Determinism (D5): renderRules is a pure function — the templates are
// constant literals; NO Date/timestamp, locale, env (RUNECRAFT_*), fork
// version or session data in the text. Rerun = byte-identical (F15
// idempotency). An intentional text change must bump WORKFLOW_RULES_VERSION
// (the sync detects the change via contentHash and updates in place — D7).
//
// Column variation (D6): Pi = all 4 tools + two-driver + worker rule;
// claude-code/opencode/codex = ONE shared text with taskflow-MCP + review
// via gate only — no goal-loop/subagents/pr-review mentions (the absence
// test greps `goal|loop|subagent|pr-review|auditor`).
import type { MatrixAgentId } from "../matrix.ts";

/** Version of the injected workflow rules text (D5). Bump on intentional
 *  text changes — the sync reports `template vN→vM` and re-applies the
 *  section in place (D7). */
export const WORKFLOW_RULES_VERSION = "1";

/** Template Pi (D6): 4 ferramentas + two-driver + worker rule. */
const PI_RULES = `Runecraft workflow rules (v1)

Four tools overlap. Pick by situation — the wrong pick costs time or breaks the session.
If a goal is active, it drives the session: see "One driver".

## One driver per session
- The goal-loop directs the session: it schedules continuations via agent_end.
- subagents and taskflow run as WORKERS under the active driver.
- Never have two drivers in one session — two supervisors scheduling continuations
  into one session produce contradictory turns.

## goal-loop-audit — verifiable contract with an isolated auditor
- Use when the work can be stated as a goal with a "Done when" contract.
- Prose closes nothing. The ONLY way to close a goal is a complete_goal tool call
  that survives the isolated auditor: a fresh session (no extensions/skills/prompts;
  read/grep/find/ls/bash only) that cannot see your conversation.
- Evidence is required per contract item: <approved/> without <evidence> is disapproved.
- Cycle: drafting → active → auditing → complete; continuation via agent_end.
- /loop requires an honest numeric metric measured with the measure command
  ("A loop never completes" without one). No honest metric? Use /goal.
- Contraindicated: no verifiable "Done when"; no honest metric for /loop; work that
  requires you to drive the session interactively.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- eval (zero tokens) / expect (validated JSON contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (the plain subagent tool is fine).

## subagents — ad-hoc delegation
- Use for chains (each step receives {previous}) or parallel (concurrency/failFast).
- Acceptance gates (auto/attested/checked/verified): verify runs commands —
  child-reported command success does not count.
- intercom (contact_supervisor); worktrees (each child in its own worktree; clean
  tree required); watchdog (adversarial diff review at agent_end).
- One writer against the active worktree at a time.
- Contraindicated: multi-phase flows with dependencies and reruns (use taskflow);
  session-driving work (use goal-loop).

## pr-review — structured review
- Use for reviewing a diff: structured JSON (verdict; findings P0–nit with
  blocking/confidence), 5 passes by default, parallel dispatch by tiers, optional
  verification against the exact head.`;

/** Template não-Pi (D6): um único texto para claude-code/opencode/codex. */
const NON_PI_RULES = `Runecraft workflow rules (v1)

You have taskflow-MCP for structured multi-phase work. Pick by situation.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- Review/verification inside a flow: eval (zero tokens) and expect (validated JSON
  contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (do it directly in the session).`;

/**
 * Render the injected workflow rules for an agent (D5/D6). Returns ONLY the
 * section body — the `runecraft:workflow` markers and the upsert
 * (BOM/CRLF/newline) are F15/F18 concerns. Pure: same input → same bytes.
 */
export function renderRules(agentId: MatrixAgentId): string {
  return agentId === "pi" ? PI_RULES : NON_PI_RULES;
}

/**
 * F15/F17 API kept intact (install/sync call sites pass non-Pi adapter ids):
 * the rendered text is the F19 non-Pi template (D6 — a single shared text).
 */
export function renderWorkflowRules(_agentName: string): string {
  return NON_PI_RULES;
}
