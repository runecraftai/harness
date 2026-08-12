# Project agent memory

This file is the project's committed base for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Architecture: parity layer (B0/B1)

- **Capability manifest (B0)** — `packages/harness/src/capabilities/manifest.ts` is the single source of truth for per-agent capability claims (hooks/subagents/mcp/models/guards + taskflow/goal-loop/pr-review/memory/persona/sdds). `matrix.ts` unsupported-cell reasons, `doctor` check 25 (digest) and `status` (Capabilities section) all consume it. Future parity phases (B2..B8, PARITY.md roadmap) update the manifest FIRST; the digest golden test catches drift.
- **Claude Code roles + routing (B1)** — 7 role agents live in `packages/harness/claude-agents/*.md` (Claude agent-file format) and are three-way materialized to `~/.claude/agents/` by `install`/`sync` (`src/adapters/claudeAgents.ts` — mirror of F32 `src/agents/materialize.ts`, state section `claudeAgents`). The coded-routing directive is a second CLAUDE.md section `runecraft:routing` rendered from `src/routing/claudeSection.ts` — same ROUTE_CATALOG as the F33 Pi classifier; only the `builder` role carries the `Agent` (Task) delegation tool (QA-5 mirror).
- Doctor check numbering: 1–23 (F12..F33), 24 = Claude role agents (B1), 25 = capability manifest (B0). Eval lane: `test/eval/framework/parity.test.ts` EVAL-079..084; `MIN_EVIDENCE_FILES = 22` in `test/eval/ratchet-run.ts` (bump when a new evidence file joins).

## Build & test

- Package: `packages/harness` — `bun test` (suite + ratchet chained), `bun run typecheck` (tsc), `bun run eval:ratchet --update` absorbs new coverage/goldens into `test/eval/baselines/`. Root `bun run lint` (biome) ignores `packages/**` by design — the harness gates are typecheck + tests.
- Goldens: `test/golden/*.golden` (injected content byte-locked, incl. `section-routing-claude.golden`). Regenerate with `bun run eval:ratchet --update` (refuses with CI=true).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
