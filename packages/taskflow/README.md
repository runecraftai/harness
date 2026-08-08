# @runecraft/taskflow

Part of [Runecraft Companion](../../README.md), the multi-agent harness for the [Pi coding agent](https://pi.dev).

This directory vendors the `taskflow` group — 9 packages providing verifiable DAG workflows: a host-neutral engine (`@runecraft/taskflow-core`), the Pi adapter with `/tf`, tool, DAG TUI and approvals (`@runecraft/taskflow`), compile-time TypeScript authoring (`@runecraft/taskflow-dsl`), the MCP layer (`@runecraft/taskflow-mcp-core`) and host runners/delivery for Claude Code, Codex, OpenCode and Grok (`@runecraft/taskflow-{hosts,claude,codex,opencode,grok}`).

## Install

Installed automatically as part of `@runecraft/companion`. Standalone (Pi adapter):

    pi install npm:@runecraft/taskflow

## Docs

- Full guide, quickstart & agent matrix: [root README](../../README.md)
- Mental model / when to use this vs the other tools: [ROUTING.md](../harness/docs/ROUTING.md)
- Internal host-runner architecture: [`hosts/README.md`](hosts/README.md)

## Relationship to upstream

Fork of `taskflow` (heggria, MIT), pinned at v0.2.6 (9 packages, per-package `vendor.json` refs in `vendor.manifest.json`). Notable divergences: the MCP layer was re-vendored into the monorepo (9 packages) and kept in sync three-way against the pinned upstream by the harness sync workflow.
