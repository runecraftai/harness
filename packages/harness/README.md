# @runecraft/companion

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Runecraft Harness — multi-agent harness for AI coding agents: four tools (subagents, taskflow, goal-loop, pr-review) with guards, verification, evals, resilience, memory and coded routing, served to Pi and to Claude Code, OpenCode, Codex and VS Code Copilot; a taskflow DAG; and the first CLI action">
</p>

**Turn Pi from a powerful coding agent into a controlled development
harness** — and give Claude Code, OpenCode, Codex and VS Code Copilot the same
taskflow backbone, via the `companion` CLI.

`@runecraft/companion` is the Pi-native package of the [Runecraft
ecosystem](https://github.com/runecraftai/harness): it installs and wires four
tools (`@runecraft/subagents`, the `@runecraft/taskflow` group,
`@runecraft/goal-loop-audit`, `@runecraft/pr-review`) **plus the harness
layer** — enforced guards, verification cascade, evals with ratchets and
goldens, resilience, a typed event store, persistent memory, persona and
coded routing — in a single command.

## The problem

Most coding-agent sessions fail for operational reasons, not model reasons:

- the agent jumps into code before requirements are clear;
- one request quietly becomes a huge multi-area diff;
- tests run late, or not at all;
- reviewers get handed a wall of changes;
- subagents are available, but the parent session has no orchestration
  discipline.

The harness fixes the workflow around the agent. It is **not** an AI agent
installer: it adapts the agent runtime(s) already on your machine, and if an
agent isn't detected, the CLI refuses and names the exact command you'd run
yourself.

## What it adds

| Capability | What it does |
| --- | --- |
| **Subagent dispatch** | builtin agents, chains, parallel execution, acceptance gates, intercom, worktrees, watchdog (`subagent(...)`, `/run`, `/chain`, `/parallel`) |
| **Task DAG** (`/tf`) | verifiable DAG workflows: `dependsOn`, FlowIR, resume/replay/recompute, approvals vs gates, budgets — the same engine served to non-Pi agents via MCP |
| **Goal loop** (`/goal`) | goals with a "Done when" contract, supervised to verified completion by an isolated auditor (regression shield); `/loop` with an honest metric |
| **PR review** (`/pr-review`) | parallel tiered review of GitHub PRs, with a receipt gate at commit/push time |
| **Execution guards** (F24) | real `{ block: true }` tool-call blocking — `write` on existing files, read-only roles writing non-`.md`, todo discipline — not prompt advice |
| **Verification cascade** (F25) | deterministic cheap→expensive verification (structural → integrity → sufficiency → embedding → judge), thresholds in code, cost caps, fail-closed |
| **Evals + ratchets** (F21/F23/F26) | deterministic eval framework, fail-only-on-worse ratchets, golden assets pinned byte-for-byte |
| **Resilience** (F27) | compaction recovery, continuation re-injection, stall/repetition detection, quota classification |
| **Typed event store** (F28) | append-only `.jsonl` events with a prevHash chain, guard-block observation, lessons capture |
| **Memory** (F29) | persistent cross-session SQLite+FTS5 memory with 10 `rune_*` tools and the `using-runes` skill |
| **Coded routing** (F33) | tasks routed by pure code with explicit thresholds — never by the LLM |
| **Persona & models** (F30) | persona + rules injection, per-agent model resolution, SDD chains |

## Proof

<p align="center">
  <img src="./assets/readme/proof.svg" width="100%" alt="Evidence: 1193 deterministic tests, 11 golden assets pinned byte-for-byte, 71 E2E offline tests, 23.4s versioned hello-world SDLC run">
</p>

- **1193 deterministic tests**, offline, zero tokens — with ratchets and 11
  pinned goldens (F21/F23/F26).
- **Guards that actually block** (F24) — real `{ block: true }` tool-call
  blocks, not prompt advice.
- **Verification cascade with thresholds in code** (F25) — judge LLM
  env-gated, never in CI.
- **Resilience with stall detection** (F27) — the goal-loop-audit's proven
  thresholds.
- **Typed event store** (F28) — prevHash chain, guard-block observation,
  lessons.
- **Coded router** (F33) — route by code, never by LLM.
- **E2E benchmark** (F22) — real models, env-gated, cost-capped, versioned
  committed rounds.

## Install

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

The CLI is `companion` (alias `harness`).

### Quick start

Verify the install — read-only, works before anything is configured:

```bash
companion doctor                        # 22 checks: forks, state, collisions
companion status                        # cross-state report: pi list × state × manifest
```

Then open Pi in a project:

```bash
pi -p "/tf --help"                      # taskflow responds
pi -p "/goal status"                    # goal-loop-audit responds
pi -p "subagent({action:'list'})"       # subagents responds
pi -p "/pr-review --help"               # pr-review responds
```

A new Pi session loads the extensions of all four forks plus the harness
layer: `/tf`, `/goal`, `subagent({action:"list"})` and `/pr-review` respond
in the same session, with guards, verification, resilience, observability,
memory, persona and routing active.

### Non-Pi agents

The same CLI manages Claude Code, OpenCode, Codex and VS Code Copilot in the
same detect/inject/remove pattern:

```bash
companion install --agent claude-code,opencode,codex   # or: copilot
```

They receive the taskflow-MCP layer (the same DAG engine as `/tf`) plus
workflow rules — see [docs/agents.md](docs/agents.md) for the full matrix.

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
[`docs/ROUTING.md`](docs/ROUTING.md).

## Intended usage

**Role agents.** The harness ships 7 professional roles, materialized as
data-driven agents in `<cwd>/.pi/agents/` via `companion install`/`sync`
(project scope; three-way merge by content — your edits are preserved):

| Role | Identity | Tools (allowlist) | Delegation |
| --- | --- | --- | --- |
| `planner` | plans only — never implements | read, grep, find, ls, intercom | never |
| `builder` | executes the plan, verifies before reporting | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | only: scout + reviewer |
| `reviewer` | `[APPROVE]`/`[REJECT]` verdict + ≤3 blocking issues (read-only) | read, grep, find, ls, bash, intercom | never |
| `auditor` | compliance audit (writes only `.md`) | read, grep, find, ls, bash, write, intercom | never |
| `scout` | read-only codebase recon, reports on return | read, grep, find, ls, intercom | never |
| `researcher` | external research with sources (read-only) | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | never |
| `security` | read-only security review (triage + fast-exit) | read, grep, find, ls, bash, intercom | never |

**Non-Pi agents.** Claude Code (`claude-code`), OpenCode (`opencode`), Codex
(`codex`) and Copilot for VS Code (`copilot`; aliases `vscode`,
`vscode-copilot`, `github-copilot`). Copilot receives repo-scoped rules in
`.github/copilot-instructions.md` plus MCP in `.vscode/mcp.json`
(`servers.taskflow`, reusing the `@runecraft/taskflow-claude` host).

See [docs/agents.md](docs/agents.md) for the full matrix and
[docs/ROUTING.md](docs/ROUTING.md) for the mental model.

## Configuration

Each fork ships its own defaults and docs (`subagents.defaultModel`, the
goal-loop-audit auditor model, taskflow budgets, …). The recommended
`settings.json` block covering all four packages (merge of defaults) is
delivered by the harness CLI — `companion install` writes it; see the doctor
output for the effective state. The harness layers add their own sections
(`guards`, `verification`, `resilience`, `observability`, `memory`,
`persona`, `models`) — see [docs/components.md](docs/components.md).

## Troubleshooting

- `companion doctor` — read-only diagnostics: pass/warn/fail checks with a remedy for each failure.
- `companion status` — installed packages and versions, cross-state report (pi list × state × manifest), install suggestion when nothing is managed.
- `companion sync` — idempotent reconciliation: reinstalls what the harness manages and is missing.
- `companion uninstall` — managed removal: removes **only** what the harness installed (`--component <id>` / `--all`).
- `companion restore <name>` / `companion backups` — snapshot restore and listing.
- **Collision warning**: do not install alongside the original upstreams (`pi-subagents`, `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — commands and tools duplicate. Remove the upstreams before installing the harness.

## Relationship to upstreams

| Package | Upstream | Pinned | README |
| --- | --- | --- | --- |
| `@runecraft/subagents` | `pi-subagents` (nicobailon) | v0.37.2 | [subagents](../subagents/README.md) |
| `@runecraft/taskflow` (group) | `taskflow` (heggria) | v0.2.6 | [taskflow](../taskflow/README.md) |
| `@runecraft/goal-loop-audit` | `pi-goal-list-loop-audit` (DraconDev) | 0.28.34 | [goal-loop-audit](../goal-loop-audit/README.md) |
| `@runecraft/pr-review` | `pi-pr-review` (10ego) | v1.11.4 | [pr-review](../pr-review/README.md) |

Each fork's README documents its relationship to the upstream and the
notable divergences. The forks are committed source in this repo — there is
no sync workflow.

## Docs

- [Docs index](docs/README.md) — ROUTING / EVENTS / MEMORY / PI / EVAL-FRAMEWORK + intended-usage / usage / agents / components / CODEBASE-GUIDE / testing.
