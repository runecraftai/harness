# Testing

Landing page for the harness test story: deterministic evals, ratchets and
goldens, and the env-gated E2E benchmark. The detailed framework reference is
[EVAL-FRAMEWORK.md](EVAL-FRAMEWORK.md).

## Suites

| Suite | Command | What it covers |
| --- | --- | --- |
| Full harness suite | `bun run test` (in `packages/harness`) | 1193 tests: unit + CLI + eval lanes (F21 deterministic, F24 guards, F25 verification) + ratchet + goldens |
| E2E offline | `bun test scripts/eval-e2e` (repo root) | 71 tests — env-gated: without `RUNECRAFT_E2E=1` they skip (exit 0, zero tokens) |
| E2E benchmark | `RUNECRAFT_E2E=1 bun run eval:e2e` | real models, versioned rounds in `.specs/features/f22-e2e-benchmark/results/` (not in CI) |
| Lint / build | `bun run lint` / `bun run build` | biome + turbo build |

## Deterministic evals (F21/F26)

Suites/cases/scenarios are TS data under `test/eval/{suites,cases,scenarios}`;
the in-process runner loads, executes and evaluates them with evidence via
`evalTest()` (partial JSONL → merged `last-run.json`). The scenario layer
replays SDLC flows against a local OpenAI-wire fixture — only the tool-call
choice is scripted; each step really executes (bash/git in a disposable repo).

The governance matrix is `test/EVAL-MATRIX.md` (additive policy: entries are
only ever added, never removed; `matrix-consistency.test.ts` pins the
matrix ↔ tests correspondence).

## Ratchets and goldens (F23)

- **Ratchets**: `test/eval/baselines/{known-failures,command-coverage}.txt`
  — fail-only-on-worse non-regression for known failures and command
  coverage. The pass-rate ratchet (E2E) reads committed benchmark rounds.
- **Goldens**: `test/golden/*.golden` (11 files) pin injected assets byte for
  byte (rules sections, MCP configs, chains).
- **Update policy**: ratchets/goldens are never updated in normal work; the
  canonical flow is `bun run eval:ratchet` (red with instructions) → human
  decision → `bun run eval:ratchet --update` → reviewed PR. `--update`
  refuses with `CI=true` (human-in-the-loop, never auto-fix in CI).

Run them with the suite: `bun run test` executes the ratchet and goldens
after the test files; the exit code is preserved (red suite = red PR).

## E2E (F22)

Real-model benchmark, env-gated and fail-closed:

- `RUNECRAFT_E2E=1 bun run eval:e2e` — full round (preflight → probe →
  scenarios in fixed order → atomic per-scenario writes → summary).
- Offline modes without env: `--list-scenarios`, `--dry-run`, `--doctor`.
- Cost cap US$ 10/round (AD-037); exit codes 0 pass · 1 fail/fail-infra ·
  2 cost cap.
- Rounds are committed as evidence (never edited in place) and read
  leniently by the ratchet.

Reference: [EVAL-FRAMEWORK.md](EVAL-FRAMEWORK.md).
