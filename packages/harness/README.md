# @runecraft/companion

Runecraft Harness — umbrella meta-package for the [Pi coding agent](https://pi.dev). Installs and wires the four forked components (`@runecraft/subagents`, `@runecraft/taskflow` group, `@runecraft/goal-loop-audit`, `@runecraft/pr-review`) in a single command.

## What it is

The harness ships as a meta-package: the forks are bundled via `bundledDependencies` and their resources are referenced by `node_modules/@runecraft/*` paths in the `pi` manifest (the standard meta-package pattern documented in Pi's docs/packages.md). Versions come from the committed fork packages (see `src/versions.ts`).

| Capability | Package | Entry (manifest `pi`) |
| --- | --- | --- |
| Subagent dispatch | `@runecraft/subagents` 0.37.2 | `node_modules/@runecraft/subagents/index.ts` + `skills/` + `prompts/` |
| Task DAG (`/tf`) | `@runecraft/taskflow` 0.2.6 | `node_modules/@runecraft/taskflow/dist/index.js` + `skills/` |
| Taskflow engine + DSL (libs) | `@runecraft/taskflow-core` 0.2.6 · `@runecraft/taskflow-dsl` 0.2.6 | no `pi` resources (libs only) |
| Goal loop with isolated auditor (`/goal`) | `@runecraft/goal-loop-audit` 0.28.34 | `node_modules/@runecraft/goal-loop-audit/extensions/loops/goal.ts` |
| PR code review | `@runecraft/pr-review` 1.11.4 | `node_modules/@runecraft/pr-review/extensions/index.ts` + `prompts/` |

## Quickstart

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

The CLI is `companion` (alias `harness`). Verify the install:

```bash
companion doctor                        # read-only diagnostics (6 checks, pass/warn/fail + remedy)
companion status                        # cross-state report: pi list × state × manifest
pi -p "/tf --help"                      # taskflow responds
pi -p "/goal status"                    # goal-loop-audit responds
pi -p "subagent({action:'list'})"       # subagents responds
pi -p "/pr-review --help"               # pr-review responds
```

A new Pi session loads the extensions of all four forks: `/tf`, `/goal`, `subagent({action:"list"})` and `/pr-review` respond in the same session.

## Intended usage

**Role agents.** The harness ships 7 professional roles, materialized as data-driven agents in `<cwd>/.pi/agents/` via `companion install`/`sync` (project scope; three-way merge by content — your edits are preserved):

| Role | Identity | Tools (allowlist) | Delegation |
| --- | --- | --- | --- |
| `planner` | plans only — never implements | read, grep, find, ls, intercom | never |
| `builder` | executes the plan, verifies before reporting | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | only: scout + reviewer |
| `reviewer` | `[APPROVE]`/`[REJECT]` verdict + ≤3 blocking issues (read-only) | read, grep, find, ls, bash, intercom | never |
| `auditor` | compliance audit (writes only `.md`) | read, grep, find, ls, bash, write, intercom | never |
| `scout` | read-only codebase recon, reports on return | read, grep, find, ls, intercom | never |
| `researcher` | external research with sources (read-only) | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | never |
| `security` | read-only security review (triage + fast-exit) | read, grep, find, ls, bash, intercom | never |

**Non-Pi agents.** The CLI also manages non-Pi agents in the same detect/inject/remove pattern: Claude Code (`claude-code`), OpenCode (`opencode`), Codex (`codex`) and Copilot for VS Code (`copilot`; aliases `vscode`, `vscode-copilot`, `github-copilot`). Copilot receives repo-scoped rules in `.github/copilot-instructions.md` plus MCP in `.vscode/mcp.json` (`servers.taskflow`, reusing the `@runecraft/taskflow-claude` host).

**When to use which tool** — full mental model, the 7 routing rules and the two-driver limits: [`docs/ROUTING.md`](docs/ROUTING.md).

## Configuration

Each fork ships its own defaults and docs (`subagents.defaultModel`, the goal-loop-audit auditor model, taskflow budgets, …). The recommended `settings.json` block covering all four packages (merge of defaults) is delivered by the harness CLI — `companion install` writes it; see the doctor output for the effective state.

## Troubleshooting

- `companion doctor` — read-only diagnostics: 6 checks with pass/warn/fail and a remedy for each failure.
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

Each fork's README documents its relationship to the upstream and the notable divergences.

## Docs

- [Docs index](docs/README.md) — ROUTING / EVENTS / MEMORY / PI / EVAL-FRAMEWORK + usage guides.
