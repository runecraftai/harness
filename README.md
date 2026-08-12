# Runecraft Harness

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Runecraft Harness — multi-agent harness for AI coding agents: four tools (subagents, taskflow, goal-loop, pr-review) with guards, verification, evals, resilience, memory and coded routing, served to Pi and to Claude Code, OpenCode, Codex and VS Code Copilot; a taskflow DAG; and the first CLI action">
</p>

Your own multi-agent harness for the AI coding agents you already use.

## What it does

Runecraft is **not** an AI agent installer. It adapts the agent runtime(s)
already on your machine — if an agent isn't detected, the CLI refuses and
names the exact command you'd run yourself. It equips the agents you use with
four tools:

- **subagent dispatch** — focused child agents with acceptance gates;
- **taskflow** — verifiable DAG workflows with resume, replay and budgets;
- **goal loop** — long-running work supervised to verified completion by an
  isolated auditor;
- **PR review** — parallel, tiered code review with a delivery gate.

…plus the discipline to use them well: **enforced execution guards**, a
**verification cascade**, **persistent memory**, **resilience**, a **typed
event store** and **coded routing**.

**Before**: "I installed Claude Code / Pi / OpenCode, but it's just a chatbot
that writes code."

**After**: your agent has guards, verification, memory and routing — a
controlled multi-agent environment.

## Supported agent integrations

The harness serves agents in three tiers. Tier 1 is the reference
implementation. Tier 2 agents receive the shared non-Pi layer today, with
native parity on the roadmap. Tier 3 agents are detected and guided, never
managed.

| Tier | Agents | Today | Roadmap |
| --- | --- | --- | --- |
| **Tier 1 — full layer** | **Pi** | the four tools + the full harness layer (guards, verification, resilience, memory, routing, persona), as Pi packages | reference implementation |
| **Tier 2 — taskflow + rules** | **Claude Code**, **OpenCode**, **Codex**, **VS Code Copilot** | taskflow-MCP + workflow rules in each agent's native config | native parity per agent (Claude hooks + agent files, Codex hooks + profiles, OpenCode overlay, Copilot runSubagent) |
| **Tier 3 — detect-only** | Cursor, Grok, others | the CLI detects them and names the exact command you'd run yourself | an adapter, when a user actually needs one |

The taskflow-MCP layer is what the non-Pi agents receive — the same DAG
engine (`/tf` on Pi, `taskflow_*` MCP tools elsewhere). Pi is first-class:
the tools and harness layers ship as Pi packages, installed by
`pi install npm:@runecraft/companion`.

## Parity roadmap

Tier 2 is taskflow + rules today, plus the first native-parity slice for
Claude Code — the harness never claims the full layer for a non-Pi agent.
The full surface (subagents, goal-loop, pr-review, guards, memory, model
routing) is being ported to each agent's native configuration: Claude Code
hooks and agent files (B1 shipped: role agents + coded routing), Codex hooks
and profiles, OpenCode overlay agents, Copilot runSubagent. Where a native
surface is missing, only the portable parts travel — Copilot guards reduce
to advisory instructions (no tool-call hook surface), Copilot model routing
to single-model guidance (no per-agent model config) — each marked in the
gap table rather than claimed. The gap table, the native-surface map and
the phased plan live in [`docs/PARITY.md`](packages/harness/docs/PARITY.md).

## How work is routed

| Situation | What the harness does |
| --- | --- |
| A small, already understood change | keeps it direct and inline |
| Exploration across many files, or broad research | delegates to a read-only scout or researcher |
| Multi-phase work with dependencies | runs a taskflow DAG with budgets and approvals |
| Long-running work closable by a verifiable contract | runs a goal loop with an isolated auditor |
| A diff ready for review | dispatches parallel PR review and gates the delivery |

One supervisor per session (two-driver rule). Full mental model:
[`docs/ROUTING.md`](packages/harness/docs/ROUTING.md).

## Quick start

Install for Pi (Tier 1 — full layer):

```bash
pi install npm:@runecraft/companion
```

What you get: the four tools (subagents, taskflow, goal-loop, pr-review)
plus guards, verification, resilience, memory, routing and persona — the
reference implementation.

Install for Claude Code, OpenCode, Codex or Copilot (Tier 2):

```bash
companion install --agent claude-code,opencode,codex   # or: copilot
```

What you get per agent (taskflow + rules today; Claude Code also receives
the B1 parity slice):

- **Claude Code** — taskflow-MCP (`taskflow-claude` in `.mcp.json`) + workflow rules in `CLAUDE.md` + **B1**: 7 role agents in `~/.claude/agents/` (Task-tool delegation, only `builder` spawns) + the coded-routing directive (`runecraft:routing` section).
- **OpenCode** — taskflow-MCP (`taskflow-opencode`) + workflow rules in `AGENTS.md`.
- **Codex** — taskflow-MCP (`taskflow-codex` in `config.toml`) + workflow rules in `AGENTS.md` (solo).
- **VS Code Copilot** — `servers.taskflow` in `.vscode/mcp.json` + `.github/copilot-instructions.md` (repo-scoped).

Verify the install:

```bash
companion doctor                        # 22 checks: forks, state, collisions
companion status                        # cross-state report: agents × components
```

Start using it in a Pi session:

```bash
pi -p "/tf --help"                      # taskflow responds
pi -p "/goal status"                    # goal-loop-audit responds
pi -p "subagent({action:'list'})"       # subagents responds
pi -p "/pr-review --help"               # pr-review responds
```

## Docs

| Your task | Start here |
| --- | --- |
| Understand the mental model | [ROUTING.md](packages/harness/docs/ROUTING.md) |
| Install & operate the CLI | [usage.md](packages/harness/docs/usage.md) |
| Configure an agent | [agents.md](packages/harness/docs/agents.md) |
| Tier model & parity plan | [PARITY.md](packages/harness/docs/PARITY.md) |
| Use the harness in Pi | [PI.md](packages/harness/docs/PI.md) |
| Component map & configuration | [components.md](packages/harness/docs/components.md) |
| Contribute | [CODEBASE-GUIDE.md](packages/harness/docs/CODEBASE-GUIDE.md) |

Full index: [packages/harness/docs/README.md](packages/harness/docs/README.md).

## Known limits

- **Do not install alongside the original upstreams** (`pi-subagents`,
  `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — commands and
  tools duplicate. Remove the upstreams before installing the harness.
- **One supervisor per session** — with a goal active, subagents and
  taskflow are workers under the goal loop (see ROUTING.md §2 and §7).
- Coexistence with other installers is detected at runtime (doctor check) —
  third-party content is never touched.

## Development

```bash
bun install
bun run lint
bun run build
cd packages/harness && bun run test
```

Status: pre-release. See `.specs/project/ROADMAP.md`.
