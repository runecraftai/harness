# Runecraft Harness

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Runecraft Harness — multi-agent harness for the Pi coding agent: four tools (subagents, taskflow, goal-loop, pr-review) with guards, verification, evals, resilience, memory and coded routing; a taskflow DAG; and the install command">
</p>

Your own multi-agent harness for the [Pi coding agent](https://pi.dev) — with
**enforced execution guards, a deterministic verification cascade, evals with
ratchets and goldens, resilience, a typed event store, persistent memory and
coded routing**. It loads four tools into a Pi session (subagent dispatch,
verifiable DAG workflows, goal loops with an isolated auditor, parallel PR
review) and manages non-Pi agents (Claude Code, OpenCode, Codex, Copilot).

The command is `companion` (alias `harness`); the package is
`@runecraft/companion`.

## Proof / value

<p align="center">
  <img src="./assets/readme/proof.svg" width="100%" alt="Evidence: 1193 deterministic tests, 11 golden assets pinned byte-for-byte, 71 E2E offline tests, 23.4s versioned hello-world SDLC run">
</p>

A harness that verifies its own work, at every layer:

- **1193 deterministic tests** in the repo — offline, zero tokens, with
  **ratchets** (fail-only-on-worse: known failures, command coverage, E2E
  pass rate) and **11 golden assets** pinned byte-for-byte (F21/F23/F26).
- **Guards that actually block** (F24): `write` on existing files and
  non-`.md` writes by read-only roles are real `{ block: true }` tool-call
  blocks — not prompt advice.
- **Verification cascade with thresholds in code** (F25): structural →
  integrity → sufficiency → embedding → judge (LLM env-gated, never in CI),
  with cost caps and a fail-closed policy.
- **Resilience with stall detection** (F27): compaction recovery,
  continuation re-injection, stall/repetition detection with the
  goal-loop-audit's proven thresholds.
- **Typed event store** (F28): append-only `.jsonl` events with a prevHash
  chain, guard-block observation, lessons capture and export.
- **Coded router** (F33): tasks are routed by pure code with explicit
  thresholds — never by the LLM.
- **E2E benchmark** (F22): real models, env-gated (`RUNECRAFT_E2E=1`),
  cost-capped, with versioned committed rounds.

Parity with the patterns you already know: spec-driven development
(versioned `sdd` chains, F30), receipts for delivery gates (F20), persistent
cross-session memory (F29), persona + model routing (F30), and snapshot
backup/restore (F13).

## Quickstart

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

Verify the install:

```bash
companion doctor                        # read-only diagnostics (pass/warn/fail + remedy)
companion status                        # cross-state report: pi list × state × manifest
pi -p "/tf --help"                      # taskflow responds
pi -p "/goal status"                    # goal-loop-audit responds
pi -p "subagent({action:'list'})"       # subagents responds
pi -p "/pr-review --help"               # pr-review responds
```

That is it — a new Pi session loads the extensions of all four forks plus the
harness layer (guards, verification, resilience, observability, memory,
persona, routing).

## Core workflow

| Tool | What it does | When to use it | When not |
| --- | --- | --- | --- |
| **goal-loop-audit** (`/goal`) | goal with a "Done when" contract, verified by an isolated auditor (regression shield) | closable by a verifiable contract; iteration with an honest metric (`/loop`) | no verifiable "Done when"; interactive driving |
| **taskflow** (`/tf`) | DAG with `dependsOn`, resume/replay/recompute, approvals vs gates, budgets | multi-phase flows with dependencies; reproducibility; a defined budget | single-file change; interactive debugging |
| **subagents** | chains, parallel, acceptance gates, intercom, worktrees, watchdog | ad-hoc delegation; independent parallelism; evidence via acceptance gates | multi-phase flows with dependencies (→ taskflow); session-driving work (→ goal-loop) |
| **pr-review** (`/pr-review`) | structured verdict, parallel tiers, gate inside a flow | reviewing a diff; pre-commit/pre-push gate | — |

Two-driver rule: only one supervisor drives `agent_end` continuations per
session; with a goal active, subagents and taskflow are workers under the
goal-loop. Full mental model, the 7 objective roles and routing rules:
[`docs/ROUTING.md`](packages/harness/docs/ROUTING.md).

## Docs

- [Docs index](packages/harness/docs/README.md) — ROUTING / EVENTS / MEMORY /
  PI / EVAL-FRAMEWORK + intended-usage / usage / agents / components /
  CODEBASE-GUIDE / testing.
- [Umbrella README](packages/harness/README.md) — components, configuration,
  troubleshooting.

## Known limits

- **Do not install alongside the original upstreams** (`pi-subagents`,
  `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — commands and
  tools duplicate. Remove the upstreams before installing the harness.
- Coexistence with other installers is detected at runtime (doctor check) —
  see [ROUTING.md §7](packages/harness/docs/ROUTING.md).

## Development

```bash
bun install
bun run lint
bun run build
cd packages/harness && bun run test   # 1193 tests + ratchet + goldens
bun test scripts/eval-e2e             # 71 offline tests (env-gated skip)
```

Status: pre-release. See `.specs/project/ROADMAP.md`.
