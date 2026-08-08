# @runecraft/goal-loop-audit

Part of [Runecraft Companion](../../README.md), the multi-agent harness for the [Pi coding agent](https://pi.dev).

Inside the harness, `@runecraft/goal-loop-audit` provides the goal loop: durable goals driven to verified completion by an isolated auditor in a fresh session, plus list and metric-driven loop modes (`/goal`, `/list`, `/loop`). The harness builds its resilience layer (stall detection, backoff, escalation) on the battle-tested mechanisms of this fork.

## Install

Installed automatically as part of `@runecraft/companion`. Standalone:

    pi install npm:@runecraft/goal-loop-audit

## Docs

- Full guide, quickstart & agent matrix: [root README](../../README.md)
- Mental model / when to use this vs the other tools: [ROUTING.md](../harness/docs/ROUTING.md)

## Relationship to upstream

Fork of `pi-goal-list-loop-audit` (DraconDev, MIT), pinned at 0.28.34 (SHA `21b6bb0abdf5c21c88c976231f312465c3900128`, see `vendor.json`). Notable divergence: renamed to the `@runecraft/*` identity; otherwise behavior-compatible with the upstream test suite.
