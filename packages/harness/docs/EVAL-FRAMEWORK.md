# Runecraft Harness — Eval Framework

> Eval framework of the harness. Suites/cases/scenarios are **TS data**; the
> trajectory trace is the **real transcript** of the harness fixture; the LLM
> judge has **two tiers**; constraint adherence uses the **execution guards**
> as subjects; baseline-diff compares against the **ratchet**. Zero new
> dependencies, fantasy-free, offline and free by construction.

## 1. Where it lives

| Artifact | Path |
| --- | --- |
| Framework (runner/loader/schema/reporter/evaluators/targets/executors) | `packages/harness/src/eval/` |
| TS data — suites | `packages/harness/test/eval/suites/` |
| TS data — cases | `packages/harness/test/eval/cases/` |
| TS data — scenarios (scripted scenarios of the fixture) | `packages/harness/test/eval/scenarios/` |
| Framework tests | `packages/harness/test/eval/framework/` |
| Evidence: `evalTest()` → `evidence/partial/*.jsonl` → merge → `last-run.json` | `test/eval/evidence/` |
| Ratchets: baselines + goldens | `test/eval/baselines/`, `test/golden/` |
| Governance registry | `test/EVAL-MATRIX.md` |

## 2. Provenance

The framework ports the eval subsystem of the predecessor project this
harness was ported from. The port keeps the same concepts —
suites, cases, scenarios, deterministic evaluators, trajectory assertions, an
LLM judge and baseline diffing — while adapting them to the harness runtime:

- Schemas are hand-rolled with zero dependencies (the source used zod).
- Suites/cases/scenarios load as TypeScript modules via dynamic import.
- Evidence is produced by the harness fixture via `evalTest()` — the eval
  runner has no storage of its own.
- Executors that called paid model APIs (model-response, github-models-api,
  openrouter-api) are NOT ported (per-call cost). The two deterministic
  targets are prompt rendering and a single-turn agent session (in-process
  SDK session).

## 3. Semantic adaptations

- **TrajectoryTrace**: `delegationSequence` = names of the tool calls of the
  real transcript (fixture reply tool); `delegationTargets` = tool calls
  BLOCKED by the guards (derived from the reason in the conversation —
  guard reason-id patterns); `turns.agent` = the session agent ("main").
- **tool-policy**: the registry = the union of the tools seen in the REAL
  fixture requests; an absent tool = disabled (false). A mismatch is
  documented in the message (`expected X, received undefined`).
- **llm-judge**: substring tier WITHOUT alias normalization (the source
  normalized fantasy role aliases — this framework has no aliases); real tier
  ONLY with `RUNECRAFT_VERIFY_LLM_JUDGE=1`, strict parse reuses the verify
  judge response parser; invalid/timeout → fail-closed; empty output →
  deterministic fail.
- **baseline-diff**: a case failing with a NEW identity vs the ratchet's
  `known-failures.txt` → regression; frozen → pass; case passed →
  no-regression; missing baseline → degraded. Identity is 2-part
  `caseId<TAB>normalizedMessage` (distinct from the 3-part evidence
  identity); reuses the shared `normalizeMessage`/`parseBaselineLines`
  (single source in `src/eval/baselines.ts`).

## 4. Evaluator subset (honest)

| Kind | Status | Rationale |
| --- | --- | --- |
| contains-all / contains-any / excludes-all / ordered-contains / min-length | ported as-is | central content/order vocabulary |
| section-contains-all / xml-sections-present | ported as-is, ZERO v1 cases | XML prompts of the predecessor agents do not exist here — documented dead weight until the role agents provide them |
| tool-policy | ported adapted | real session registry (enumeration validated at execution) |
| trajectory-assertion | ported adapted | real trace, not the source's mock-text |
| llm-judge | two tiers | substring offline + real env-gated |
| baseline-diff | IMPLEMENTED | reserved in the source; vs the ratchet |

## 5. Eval-coverage categories — dependency table

| Category | Subject | Status | When |
| --- | --- | --- | --- |
| Constraint adherence | execution guards (write-existing-file-guard, ranger-md-only, todo-*) | ✅ available | now |
| Tool-use correctness | role agents (single-turn-agent with the real tools of the roles) | ✅ available | now |
| Routing completeness | role agents + coded router (classification → delegation) | ✅ complete | now |
| Compaction recovery | resilience layer (continuation, todo preserver, stall, classify+fallback, recovery flow) | ✅ available | now |
| Model failover | persona & models layer (model resolution, fallback chain) | ✅ available | now |
| Memory | memory layer (rune_* tools + runes.db) | ✅ available | now |

All six categories are covered. Notable case themes:

- **Constraint adherence** uses the guards as subjects (write-guard-block,
  ranger-md-only, adversarial guard-off) with the REAL transcript trace
  (trajectory-assertion + tool-policy); the adversarial guard-off case fails
  with a diagnostic (induced deviation — never passes silently).
- **Tool-use correctness** proves the role allowlists via tool-policy over
  the REAL session registry (scout read-only, builder writer, auditor
  md-only) and via the ranger-md-only guard with the auditor in the default
  (a real session with `RUNECRAFT_AGENT_ID=auditor`).
- **Routing completeness** proves the coded router: a pure classifier
  (thresholds in constants — route by CODE, never by LLM; route catalog as
  data mapped to the roles), pilot coordination via 5 `.chain.md` chains with
  a verdict gate, `before_agent_start` hook with per-session freeze, kill
  switch `RUNECRAFT_ROUTING=0` and the one-driver rule. Routing is proven by
  real trajectory (fixture sessions with the routing extension materialized
  → delegation via the `subagent` tool in the transcript + the typed
  `delegation` event) and by pure unit/fixture tests. Honest limitation: the
  trajectory-run trace only exposes tool names — the target agent lives in
  the `delegation` event of the observability layer.
- **Model failover** proves model resolution (precedence override → custom
  chain > builtin → systemDefault → null + warn) and the model switch
  (light→strong via getNextFallbackModel; exhausted chain → halt + human
  escalation) via the models.json fixture.
- **Memory** proves round-trip, the 10 tools in the fixture, cross-session,
  search/context semantics, compaction, the observability bridge, config/kill
  switch, determinism and privacy (no raw args in the event store).

**Extensibility**: a new case = 1 suite/case/scenario TS + 1 additive entry
in the matrix. The runner/loader/evaluators do NOT change.

## 6. Determinism and evidence

- Messages without absolute paths/timestamps; fantasy aliases removed.
- Determinism proven by test: 2 runs of the suite (synthetic AND real) →
  identical verdicts (status/score/messages).
- Evidence via `evalTest()` in the flow tests →
  `evidence/partial/*.jsonl` → merge → `last-run.json`; the ratchet covers it
  (see [testing.md](testing.md)).
- The LLM judge is never in CI: env off by construction (preloads); spies in
  the tests prove zero invocations without env.
