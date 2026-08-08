# Runecraft Harness

Multi-agent harness for the [Pi coding agent](https://pi.dev): subagent dispatch, verifiable DAG workflows, goal loops with an isolated auditor, and parallel PR review — shipped as `@runecraft/*` packages installable together.

The command is `companion` (alias `harness`); the package is `@runecraft/companion`.

## Quickstart

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

Verify the install:

```bash
companion doctor                        # checks the 4 forks, state, and collisions
pi -p "/tf --help"                      # taskflow responds in a fresh session
```

That is it — a new Pi session loads the extensions from the 4 forks: `/tf` (taskflow), `/goal` (goal-loop-audit), `subagent({action:"list"})` (subagents) and `/pr-review` all respond in the same session.

## Packages

| Package | Purpose |
| --- | --- |
| `@runecraft/subagents` | Dispatch: builtin agents, chains, parallel, acceptance gates, intercom, worktrees, watchdog |
| `@runecraft/taskflow-core` | Host-neutral engine: DAG, FlowIR, runtime, resume/replay/recompute |
| `@runecraft/taskflow` | Pi adapter: `/tf`, tool, DAG TUI, approvals |
| `@runecraft/taskflow-dsl` | Compile-time TypeScript authoring (`.tf.ts` → Taskflow JSON) |
| `@runecraft/goal-loop-audit` | Goal/List/Loop with isolated auditor + regression shield |
| `@runecraft/pr-review` | Parallel tiered PR review |
| `@runecraft/companion` | Umbrella: installs and wires everything |

`@runecraft/taskflow-*` also ships host adapters for Claude Code, Codex, OpenCode and Grok (see `packages/taskflow/README.md`). All versions are pinned in `vendor.manifest.json`.

## Intended usage

- **Subagents** — delegate focused work to child agents (scout/researcher/planner/builder/reviewer/auditor/security): use `subagent(...)` or `/run`, `/chain`, `/parallel`.
- **Taskflow** — verifiable DAG workflows with `/tf`, resume/replay/recompute, and a TUI.
- **Goal loop** — long-running work supervised to verified completion with an isolated auditor: `/goal`, `/list`, `/loop`.
- **PR review** — parallel tiered review of GitHub PRs: `/pr-review <n>`.

Full mental model — when to use which tool, the 7 objective roles, and the routing rules: [`docs/ROUTING.md`](packages/harness/docs/ROUTING.md).

## Known limits

- **Do not install alongside the original upstreams** (`pi-subagents`, `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — commands and tools duplicate. Remove the upstreams before installing the harness.
- **Two-driver rule**: only one supervisor may drive `agent_end` continuations per session. Installing two drivers (e.g. the goal loop plus another loop extension) produces contradictory turns — see [ROUTING.md §2](packages/harness/docs/ROUTING.md) and §7 for details.
- Coexistence with the `gentle-ai` product is detected at runtime (doctor check) — see [ROUTING.md §7](packages/harness/docs/ROUTING.md).

## Troubleshooting

- `companion doctor` — diagnostics for the 4 forks, state, and upstream collisions.
- `companion status` — installed packages, versions, and cross-state report.
- Detailed troubleshooting (doctor/status/uninstall/collision) lives in the [umbrella README](packages/harness/README.md#troubleshooting).

## Docs

- [Umbrella README](packages/harness/README.md) — full user guide: quickstart, agent matrix, configuration, troubleshooting.
- [Docs index](packages/harness/docs/README.md) — ROUTING / EVENTS / MEMORY / PI / EVAL-FRAMEWORK + the upstream sync runbook.

## Development

```bash
bun install
bun run lint
bun run build
bun run vendor --list   # show pinned upstreams
```

Status: pre-release. See `.specs/project/ROADMAP.md`.
