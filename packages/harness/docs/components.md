# Components

The harness is a meta-package: four **forked components** (bundled via
`bundledDependencies`, referenced by `node_modules/@runecraft/*` paths in the
`pi` manifest) plus a **harness layer** of extensions, guards, verification,
evals, resilience, observability, memory and routing. Versions come from the
committed fork packages (`src/versions.ts`).

## Forked components

| Component | Package(s) | What it does | Where to configure |
| --- | --- | --- | --- |
| Subagent dispatch | `@runecraft/subagents` | builtin agents, chains, parallel, acceptance gates, intercom, worktrees, watchdog | fork settings (`subagents.defaultModel`, …) |
| Task DAG | `@runecraft/taskflow` (Pi adapter) · `@runecraft/taskflow-core` (engine) · `@runecraft/taskflow-dsl` (authoring) | `/tf`, DAG with `dependsOn`, FlowIR, resume/replay/recompute, approvals, budgets | fork settings (taskflow budgets, …) |
| Goal loop with isolated auditor | `@runecraft/goal-loop-audit` | `/goal`, verifiable contract "Done when", isolated auditor, regression_shield, `/loop` with honest metric | fork settings (auditor model, …) |
| PR review | `@runecraft/pr-review` | `/pr-review`, structured verdict, parallel tiers, gate inside a flow | fork settings + harness receipts (F20) |

Relationship to upstreams (pin + SHA per fork): see each fork README
(`packages/{subagents,taskflow,goal-loop-audit,pr-review}/README.md`) and the
umbrella README.

## Harness layer (extensions + machinery)

All extensions are materialized in harness-managed Pi sessions (the `pi`
manifest of `@runecraft/companion`). Kill switches follow the
`RUNECRAFT_<LAYER>=0` pattern (F20).

| Component | What it does | Config / contract |
| --- | --- | --- |
| **Guards** (F24) | real `tool_call` blocking/rewriting (`{ block: true }`) — write-existing-file-guard, ranger-md-only, todo-description-override, todo-continuation-enforcer | `guards.<id>` in state.json; `RUNECRAFT_GUARDS=0` |
| **Verification cascade** (F25) | deterministic cheap→expensive verification on `complete_goal` and `harness verify`: structural / integrity / sufficiency / embedding / judge (LLM env-gated) | `verification` in state.json; `RUNECRAFT_VERIFY=0` |
| **Evals** (F21/F26) | deterministic eval framework: suites/cases/scenarios as TS data, in-process runner, evidence via `evalTest()`, ratchets + goldens (F23) | `bun test test/eval`; [EVAL-FRAMEWORK.md](EVAL-FRAMEWORK.md) |
| **Resilience** (F27) | compaction recovery, continuation prompt re-injection, stall detector with glla-derived thresholds, repetition/identical-output detection, backoff/quota classification | `resilience` in state.json; `RUNECRAFT_RESILIENCE=0` |
| **Observability** (F28) | typed event store (`.runecraft/events/*.jsonl`, prevHash chain), guard-block observation, context monitoring, lessons capture + promotion, export | `harness events` / `harness lessons`; [EVENTS.md](EVENTS.md); `RUNECRAFT_OBSERVABILITY=0` |
| **Memory** (F29) | persistent cross-session memory: SQLite+FTS5 (`bun:sqlite`), 10 `rune_*` tools, `using-runes` skill | `memory` in state.json; `harness memory`; [MEMORY.md](MEMORY.md); `RUNECRAFT_MEMORY=0` |
| **Persona & models** (F30) | persona + rules injection (`before_agent_start` chained), per-agent model resolution, models.json generation, SDD chains | `persona`/`models` in state.json; `harness models` / `harness sdd`; [PI.md](PI.md) |
| **Copilot adapter** (F31) | repo-scoped rules + MCP for VS Code Copilot, detect/inject/remove, conflict handling | `--agent copilot`; [ROUTING.md](ROUTING.md) §8.12 |
| **Coded routing** (F33) | route by code, never by LLM: before_agent_start directive injection, per-session freeze, `RUNECRAFT_ROUTING=0` kill switch | [ROUTING.md](ROUTING.md) §8.14 |

Each component links to its canonical section in [ROUTING.md](ROUTING.md)
§8.5–8.14 for operation details, defaults and thresholds.
