# Runecraft Harness

Multi-agent harness for the [Pi coding agent](https://pi.dev): subagent dispatch, verifiable DAG workflows, goal loops with an isolated auditor, and parallel PR review — shipped as `@runecraft/*` packages installable together.

## Packages

| Package | Purpose |
| --- | --- |
| `@runecraft/subagents` | Dispatch: builtin agents, chains, parallel, acceptance gates, intercom, worktrees, watchdog |
| `@runecraft/taskflow-core` | Host-neutral engine: DAG, FlowIR, runtime, resume/replay/recompute |
| `@runecraft/taskflow` | Pi adapter: `/tf`, tool, DAG TUI, approvals |
| `@runecraft/taskflow-dsl` | Compile-time TypeScript authoring (`.tf.ts` → Taskflow JSON) |
| `@runecraft/goal-loop-audit` | Goal/List/Loop with isolated auditor + regression shield |
| `@runecraft/pr-review` | Parallel tiered PR review |
| `@runecraft/harness` | Umbrella: installs and wires everything |

## Development

```bash
bun install
bun run lint
bun run build
bun run vendor --list   # show pinned upstreams
```

Status: pre-release. See `.specs/project/ROADMAP.md`.
