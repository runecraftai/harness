# @runecraft/subagents

Part of [Runecraft Companion](../../README.md), the multi-agent harness for the [Pi coding agent](https://pi.dev).

Inside the harness, `@runecraft/subagents` provides subagent dispatch: builtin agents (scout, researcher, planner, builder, reviewer, auditor, security), chains, parallel runs, acceptance gates, intercom, worktrees and a watchdog. The harness materializes the 7 role agents from this fork into `<cwd>/.pi/agents/` and routes work to them by code — see the agent matrix in the umbrella README.

## Install

Installed automatically as part of `@runecraft/companion`. Standalone:

    pi install npm:@runecraft/subagents

## Docs

- Full guide, quickstart & agent matrix: [root README](../../README.md)
- Mental model / when to use this vs the other tools: [ROUTING.md](../harness/docs/ROUTING.md)

## Relationship to upstream

Fork of `pi-subagents` (nicobailon, MIT), pinned at v0.37.2 (SHA `8063333661476ca48afbca826dc4aab8707c72d3`). Notable divergence: the upstream `install.mjs` path was removed — installation is fully owned by the harness (`companion install`), so the package no longer self-installs.
