# CODEBASE-GUIDE

Guide for contributors and maintainers of the Runecraft Harness monorepo.

## Repository map

Bun workspaces + turbo monorepo:

```
repo root/
├── packages/
│   ├── harness/          # @runecraft/companion — the umbrella package (this repo's product)
│   ├── subagents/        # @runecraft/subagents — fork (committed source)
│   ├── taskflow/         # @runecraft/taskflow group — 9 packages (committed source)
│   │   ├── core/ pi/ dsl/ mcp-core/ hosts/
│   │   └── codex/ claude/ opencode/ grok/
│   ├── goal-loop-audit/  # @runecraft/goal-loop-audit — fork (committed source)
│   └── pr-review/        # @runecraft/pr-review — fork (committed source)
├── scripts/
│   ├── eval-e2e/         # E2E benchmark (real models, env-gated)
│   └── tsconfig.json
├── package.json          # root scripts: lint/build/test (turbo), eval:e2e, test:eval-e2e
└── tsconfig.base.json
```

`packages/harness/` structure: `src/` (CLI, adapters, extensions, guards,
verification, evals, resilience, observability, memory, routing, persona),
`test/` (suite + eval lanes), `docs/` (shipped docs, EN), `skills/`
(shipped Pi skills), `agents/` (the 7 role agents), `assets/` + `chains/`
(SDD chains), `bin/` (CLI entry), `scripts/` (prepack, gen-versions).

## Mental model

Three layers:

1. **Forks** (`packages/{subagents,taskflow,goal-loop-audit,pr-review}`) —
   committed source, pinned versions. They provide the tools (`/tf`, `/goal`,
   `subagent`, `/pr-review`).
2. **Harness layer** (`packages/harness/src/*`) — extensions + machinery
   that run inside harness-managed Pi sessions: guards (F24), verification
   cascade (F25), evals/ratchets/goldens (F21/F23/F26), resilience (F27),
   observability (F28), memory (F29), persona/models (F30), coded routing
   (F33). See [components.md](components.md).
3. **CLI** (`companion`/`harness`) — install/sync/uninstall/status/doctor/
   restore + the harness subcommands (verify, events, lessons, memory,
   models, sdd, plans).

## Maintainer playbook

### Test commands

- Full harness suite (deterministic, offline): `bun run test` in
  `packages/harness` (1193 tests; runs the eval lanes + ratchet + goldens).
- E2E offline tests (env-gated): `bun test scripts/eval-e2e` at the repo root
  (71 tests — without `RUNECRAFT_E2E=1` they skip, exit 0, zero tokens).
- Real-model E2E benchmark: `RUNECRAFT_E2E=1 bun run eval:e2e` (not in CI).
- Lint: `bun run lint` (biome). Build: `bun run build` (turbo).
- Goldens/ratchets: never run with `--update` in normal work — the ratchet
  (`eval:ratchet`) and goldens must stay green; updates are deliberate,
  human-reviewed actions ([testing.md](testing.md)).

### Conventions

- **Language (AD-038)**: shipped docs (READMEs, `docs/`) are **EN**; code
  comments and `.specs/` are **PT-BR**. New docs pages follow this split.
- **Fork edits**: the 12 fork packages are committed source — never edit
  their code or tests; only README-level relationship notes are touched
  deliberately. There is **no sync workflow** and no vendoring machinery:
  forks live in this repo as source.
- **Third-party fingerprints are data, not branding**: the coexistence
  detection (owner detection in `src/owners.ts`, doctor check 14, eval
  preflight markers) matches real third-party fingerprints — the state file
  path `~/.gentle-ai/state.json`, the marker prefix `gentle-ai:` and the npm
  name `gentle-pi` in `src/plan.ts`. Keep these literals intact; only
  presentation (owner display name, comments, docs prose) is generic.
- **No new dependencies**: the repo runs on bun builtins + the forks +
  jiti/typescript/yaml. New code must not add deps.

### Where the contracts live

| Contract | Location |
| --- | --- |
| Fork versions (single source of truth) | `packages/*/package.json` → generated `packages/harness/src/versions.ts` (`bun run generate:versions`) |
| Routing golden chain (F19) | `docs/ROUTING.md` §9 ↔ `renderRules()` — pinned by `test/f19-routing.test.ts` |
| Eval ratchets | `test/eval/baselines/{known-failures,command-coverage,e2e-passrate}.txt` |
| Golden assets | `test/golden/*.golden` (11) — pinned by `test/eval/goldens.test.ts` |
| E2E round schema | `scripts/eval-e2e/types.ts` — committed rounds in `.specs/features/f22-e2e-benchmark/results/` (read leniently) |
| Eval matrix governance | `test/EVAL-MATRIX.md` (additive policy: entries only ever added, never removed) |
