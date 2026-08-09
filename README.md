# Runecraft Harness

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Runecraft Harness — multi-agent harness for AI coding agents: four tools (subagents, taskflow, goal-loop, pr-review) with guards, verification, evals, resilience, memory and coded routing, served to Pi and to Claude Code, OpenCode, Codex and VS Code Copilot; a taskflow DAG; and the first CLI action">
</p>

Your own multi-agent harness for the AI coding agents you already use — with
**enforced execution guards, a deterministic verification cascade, evals with
ratchets and goldens, resilience, a typed event store, persistent memory and
coded routing**.

The command is `companion` (alias `harness`); the package is
`@runecraft/companion`.

## What it does

Runecraft is **not** an AI agent installer. It adapts the agent runtime(s)
already on your machine — if an agent isn't detected, the CLI refuses and
names the exact command you'd run yourself. It equips your agents with four
tools (subagent dispatch, verifiable DAG workflows, goal loops with an
isolated auditor, parallel PR review) plus the harness layer: guards that
actually block, verification with thresholds in code, deterministic evals,
resilience, a typed event store, persistent memory and coded routing.

**Before**: "I installed Claude Code / Pi / OpenCode, but it's just a chatbot
that writes code."

**After**: your agent has guards, verification, memory, evals and routing — a
controlled multi-agent environment.

## Proof

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

## Supported agent integrations

| Agent | Delegation model | What it gets |
| --- | --- | --- |
| **Pi** | Full (package-managed subagents) | the four tools + the full harness layer (guards, verification, evals, resilience, observability, memory, persona, coded routing) |
| **Claude Code** | rules + MCP | taskflow-MCP (`taskflow-claude` in `.mcp.json`) + workflow rules in `CLAUDE.md` |
| **OpenCode** | rules + MCP | taskflow-MCP (`taskflow-opencode`) + workflow rules in `AGENTS.md` |
| **Codex** | rules + MCP (solo) | taskflow-MCP (`taskflow-codex` in `config.toml`) + workflow rules in `AGENTS.md` |
| **VS Code Copilot** | repo-scoped rules + MCP | `servers.taskflow` in `.vscode/mcp.json` + `.github/copilot-instructions.md` |
| Others | detect-only | the CLI detects them and names the exact command you'd run yourself |

Pi is first-class: the four tools and the harness layers ship as Pi
packages/extensions, installed by `pi install npm:@runecraft/companion`. The
taskflow-MCP layer is what the non-Pi agents receive — the same DAG engine
(`/tf` on Pi, `taskflow_*` MCP tools elsewhere).

## How work is routed

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

## Quickstart

Pi (first-class):

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

Claude Code, OpenCode, Codex or Copilot:

```bash
companion install --agent claude-code,opencode,codex   # or: copilot
```

Verify the install — read-only, works before any agent is configured:

```bash
companion doctor                        # 22 checks: forks, state, collisions
companion status                        # cross-state report: agents × components
```

That is it — a new Pi session loads the extensions of all four forks plus the
harness layer (guards, verification, resilience, observability, memory,
persona, routing); Claude Code / OpenCode / Codex / Copilot get the
taskflow-MCP layer and workflow rules.

## Docs

| Your task | Start here |
| --- | --- |
| Understand the mental model | [ROUTING.md](packages/harness/docs/ROUTING.md) |
| Install & operate the CLI | [usage.md](packages/harness/docs/usage.md) |
| Configure an agent | [agents.md](packages/harness/docs/agents.md) |
| Use the harness in Pi | [PI.md](packages/harness/docs/PI.md) |
| Component map & configuration | [components.md](packages/harness/docs/components.md) |
| Evals, ratchets & E2E | [testing.md](packages/harness/docs/testing.md) |
| Contribute | [CODEBASE-GUIDE.md](packages/harness/docs/CODEBASE-GUIDE.md) |

Full index: [packages/harness/docs/README.md](packages/harness/docs/README.md).

## Known limits

- **Do not install alongside the original upstreams** (`pi-subagents`,
  `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — commands and
  tools duplicate. Remove the upstreams before installing the harness.
- **Two-driver rule**: only one supervisor may drive `agent_end`
  continuations per session (see ROUTING.md §2 and §7).
- Coexistence with other installers is detected at runtime (doctor check) —
  third-party content is never touched.

## Development

```bash
bun install
bun run lint
bun run build
cd packages/harness && bun run test   # 1196 tests + ratchet + goldens
bun test scripts/eval-e2e             # 71 offline tests (env-gated skip)
```

Status: pre-release. See `.specs/project/ROADMAP.md`.
