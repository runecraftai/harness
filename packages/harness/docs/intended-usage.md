# Intended Usage

The Runecraft harness loads four forked tools into a Pi session — `subagents`
(ad-hoc delegation), `taskflow` (multi-phase DAG work), `goal-loop-audit`
(verifiable contract with an isolated auditor) and `pr-review` (structured
review) — and manages non-Pi agents (Claude Code, OpenCode, Codex, Copilot)
through their matrix column: taskflow-MCP + workflow rules.

The four tools overlap; picking the wrong one costs time and, in the worst
case, breaks the session (two-driver rule). Start here in 30 seconds:

1. **Is a goal active?** → the goal-loop drives the session (`harness status`
   shows the driver; see [ROUTING.md](ROUTING.md) §2).
2. **Tool table first** ([ROUTING.md](ROUTING.md) §3) — what each tool does,
   when to use it, when not.
3. **Quick reference** ([ROUTING.md](ROUTING.md) §8) — the 5 common cases.
4. **What your agent actually sees** — the injected text ([ROUTING.md](ROUTING.md) §9).

## When to use which tool

| Tool | When to use it | When not |
| --- | --- | --- |
| **goal-loop-audit** (`/goal`) | closable by a verifiable contract ("Done when"); iteration with an honest metric (`/loop`); work that can be handed to an isolated auditor | no verifiable "Done when"; no honest metric; work that requires driving the session interactively |
| **taskflow** (`/tf`) | multi-phase flows with dependencies; fan-out; reproducibility (resume/replay/recompute); a defined budget | single-file change; interactive debugging; one bash command; a plain quick delegation |
| **subagents** | ad-hoc delegation; a simple dependent sequence; independent parallelism; concurrent editing with worktrees; evidence via acceptance gates | multi-phase flows with dependencies (→ taskflow); session-driving work (→ goal-loop) |
| **pr-review** (`/pr-review`) | reviewing a diff; pre-commit/pre-push gate inside a flow | — |

Full details and contraindications: [ROUTING.md](ROUTING.md) §3.

## Two-driver rule

Only one supervisor may drive `agent_end` continuations per session. With a
goal active, subagents and taskflow enter as **workers** under the goal-loop
driver — never run two drivers in the same session. See [ROUTING.md](ROUTING.md)
§2/§4.

## Hello world SDLC — proof of real use

The canonical example (F7 COEX-05, executed 2026-08-06): a trivial goal with
a "Done when" contract, implemented directly, verified by the isolated
auditor and closed end to end with one command.

- **Flow (F7)**: a trivial goal with a "Done when" contract → implementation
  (directly by the model in the goal loop — COEX-05; dispatch via subagents
  or taskflow also works) → the isolated auditor verifies with evidence
  (regression_shield) → review → the cycle closes (complete_goal survives
  the auditor).
- **Result F7 (COEX-05)**: **PASS** — 2026-08-06.
  - One prompt: `/goal "Create a file greeting.txt whose content is the exact
    text 'hello harness'. Done when: greeting.txt exists in the repo root and
    its content is exactly 'hello harness'."`
  - Wall time: **23.4s** (goal_created → final complete state). Auditor:
    **10.6s**.
  - Tokens (5 model turns): input **22,445** · output **896** · cost
    **≈ US$ 0.004**.
  - Cycle: `goal_created` → `goal_continuation_sent` → implementation (3×
    bash; greeting.txt, 13 bytes) → `complete_goal` (status auditing) →
    isolated auditor (`regressionShieldPassed: true`, `<approved/>`) →
    `goal_archived` complete.

Versioned history (any flow/command change produces a new versioned entry —
never a silent edit): [ROUTING.md](ROUTING.md) §5.
