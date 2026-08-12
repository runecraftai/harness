# Runecraft Harness — Routing & Mental Model

> Canonical routing guide of the Runecraft harness. This document is the
> human-facing companion of the injected `runecraft:workflow` rules
> (appendix, section 9): the injected text is rendered by `renderRules()`
> from the same source of truth, and the golden test keeps the rendered
> output and the appendix in sync byte for byte.

## 1. Purpose & 30-second usage

The Runecraft harness loads four forked tools into a Pi session —
`subagents` (ad-hoc delegation), `taskflow` (multi-phase DAG work),
`goal-loop-audit` (verifiable contract with an isolated auditor) and
`pr-review` (structured review) — and manages non-Pi agents (Claude Code,
OpenCode, Codex, Copilot) through their matrix column: taskflow-MCP +
workflow rules.

The four tools overlap; picking the wrong one costs time and, in the worst
case, breaks the session (two-driver rule — section 2). Use this document in
30 seconds:

1. **Is a goal active?** → the goal-loop drives the session (sections 2 and 4;
   `harness status` shows the driver).
2. **Table first** (section 3) — what each tool does, when to use it, when not.
3. **Quick reference** (section 8) — the 5 common cases.
4. **What your agent actually sees** — the injected text (section 9).

Terminology — two senses of "gate":

- **gate** (lowercase) — a machine check phase of a taskflow (eval/expect).
- **gates** (hooks) — the delivery hooks (pre-commit/pre-push) of the
  harness.

The routing rules are **advisory** in v1: the harness documents and injects
them; automatic routing by the CLI is out of scope (Future).

## 2. One driver per session

The goal-loop directs the session via `agent_end`; per the goal-loop-audit
docs:

> any plugin that drives agent turns on agent_end conflicts — two supervisors
> scheduling continuations into one session produce contradictory turns.
> **One driver at a time**.

Definitions:

- **driver** — the component that schedules the session's continuations. The
  goal-loop is the driver while a goal is active (or a loop is running).
- **worker** — work dispatched inside the session that does not schedule a
  continuation: subagents and taskflow.

Rule: with a goal active, subagents and taskflow enter as **workers** under
the goal-loop driver. Never run two drivers in the same session.
`harness status` shows the active driver (goal-loop, or direct session when
no goal is active); `harness doctor` check 16 reports it.

## 3. Tool table

Facts verified 2026-08-05 against the fork sources (pins: subagents 0.37.2 ·
taskflow 0.2.6 · goal-loop-audit 0.28.34 · pr-review 1.11.4). Each row cites
real capabilities only; rows marked *(derived from routing)* derive from the
routing of the other tools, not from an explicit contraindication in the fork
docs.

| Tool | What it does (facts) | When to use it | Contraindication |
| --- | --- | --- | --- |
| **goal-loop-audit** | goal with a contract "Done when"; "Prose closes nothing... The ONLY way to close it is a complete_goal tool call that survives the isolated auditor"; isolated auditor (fresh session, no extensions/skills/prompts, read/grep/find/ls/bash only, cannot see the implementer's conversation); regression_shield: evidence required per contract item (`<approved/>` without `<evidence>` → disapproval); drafting → active → auditing → complete cycle; continuation via `agent_end`; `/loop` requires a numeric metric via the `measure` command ("A loop never completes") | closable by a verifiable contract ("Done when"); iteration with an honest metric (`/loop`); work that can be handed to an isolated auditor | no verifiable "Done when"; no honest metric for `/loop` (→ use `/goal`); work that requires you to drive the session interactively |
| **taskflow** | DAG with `dependsOn` ("Phase order in the phases array is documentation, not execution order"); FlowIR with content hash per phase; resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only); approvals (human) vs gate (agent); budgets maxUSD/maxTokens (a run ends blocked); eval (zero tokens) / expect (validated JSON contract, fail closed) | multi-phase flows with dependencies; fan-out; reproducibility (resume/replay/recompute); a defined budget | single-file change; interactive debugging; one bash command; "single quick delegation... the plain subagent tool is fine" |
| **subagents** | chains (sequential; each step receives `{previous}`); parallel (concurrent; concurrency/failFast); acceptance gates auto/attested/checked/verified (verify runs commands; "Child-reported command success does not count"); intercom (`contact_supervisor`); worktrees (each child in its own worktree; clean tree required); watchdog (adversarial diff review at `agent_end`); "Use only one writer against the active worktree at a time" | ad-hoc delegation; a simple dependent sequence; independent parallelism; concurrent editing with worktrees; evidence via acceptance gates | multi-phase flows with dependencies and re-execution (→ taskflow); session-driving work (→ goal-loop). *(derived from routing)* |
| **pr-review** | structured validated JSON (verdict; findings P0–nit with blocking/confidence); 5 passes by default; parallel dispatch by tiers; optional verification against the exact head; gate inside a flow | reviewing a diff; pre-commit/pre-push gate inside a flow | *(derived from routing: no contraindication documented in the fork.)* |

## 4. Two-driver in depth

- **Goal active** (`harness status` → goal-loop driver): the goal-loop
  schedules the session's continuations via `agent_end`. subagents and
  taskflow are still usable — as **workers**. Their completions do not
  schedule continuations; the goal-loop remains the single driver.
- **No active goal** (direct session): the session is driven directly (you
  or the model); subagents and taskflow are compatible workers.
- **Violation signals**: two supervisors scheduling continuations into one
  session produce contradictory turns — duplicated follow-ups, clobbered
  session handles, or both loops fighting over the turn.
- **Never**: start a second goal (or a second loop) while a goal is active in
  the same session/cwd; run two drivers "just for one turn". Close or pause
  the active goal first.

## 5. Hello world SDLC

The canonical example (executed 2026-08-06): a trivial goal with a "Done
when" contract, implemented directly, verified by the isolated auditor and
closed end to end with one command.

### Hello world SDLC — v2026-08-06

- **Flow**: a trivial goal with a "Done when" contract → implementation
  (directly by the model in the goal loop; dispatch via subagents or taskflow
  also works) → the isolated auditor verifies with evidence
  (regression_shield) → review → the cycle closes (complete_goal survives
  the auditor).
- **Result**: **PASS** — 2026-08-06.
  - One prompt: `/goal "Create a file greeting.txt whose content is the exact
    text 'hello harness'. Done when: greeting.txt exists in the repo root and
    its content is exactly 'hello harness'."`
  - Wall time: **23.4s** (goal_created → final complete state). Auditor:
    **10.6s** (deepseek-v4-flash, thinking high).
  - Tokens (5 model turns): input **22,445** · output **896** · cacheRead
    **109,824** · cost **≈ US$ 0.004**.
  - Cycle (transcript `.pi-glla/active.jsonl`): `goal_created` →
    `goal_continuation_sent` → implementation (3× bash; greeting.txt, 13
    bytes) → `complete_goal` (status auditing) → isolated auditor (read-only
    tools: ls, stat, od -c, wc -c, cmp; `regressionShieldPassed: true`,
    `<approved/>`) → `goal_archived` complete (`stopReason: auditor
    deepseek-v4-flash approved`, `reviewer_fired`).
- **Reproduction**: disposable test repo with the same one-line goal; the
  transcript is stored in `.pi-glla/active.jsonl`.

**Version history:**

| Version | Date | Result | Delta |
| --- | --- | --- | --- |
| v2026-08-06 | 2026-08-06 | PASS — 1 prompt, 23.4s wall, auditor 10.6s, ≈ US$ 0.004 | first canonical entry |

Rule: any flow/command change between versions produces a new versioned
entry — never silently edit the current example.

## 6. Limits per agent

What each matrix column actually has — the injected rules (section 9) never
cite a tool outside the column.

| Agent | Column |
| --- | --- |
| **Pi** | full column: subagents + taskflow + goal-loop-audit + pr-review (extensions) + rules (native). The injected rules cover all 4 tools + two-driver + worker rule. |
| **Claude Code** | taskflow-MCP + workflow rules (`runecraft:workflow` in ~/.claude/CLAUDE.md) + **B1**: 7 role agents in `~/.claude/agents/` (Task-tool delegation, only the builder spawns) + coded-routing directive (`runecraft:routing` section). No goal-loop/pr-review/guards — Pi extensions only (planned native surface: PARITY.md). |
| **OpenCode** | taskflow-MCP + workflow rules (AGENTS.md). Same limits. |
| **Codex** | taskflow-MCP + workflow rules (AGENTS.md). Solo agent (no permissions/output styles); the injected rules are the shared non-Pi template. |
| **Copilot (VS Code)** | taskflow-MCP (`servers.taskflow` in `.vscode/mcp.json`) + workflow rules (`.github/copilot-instructions.md`) — repo-scoped. Same limits; the injected rules are the shared non-Pi template. |
| **Other agents (cursor, grok, …)** | detect-only with a manual MCP guide (no adapter in v1). |

This table is the v1 truth. The tier model and the parity roadmap (what
non-Pi agents will get next, and through which native surface) live in
[PARITY.md](PARITY.md).

## 7. Coexistence

- The harness manages exactly the `runecraft:workflow` block: append on
  insert, in-place update by the stable id, nothing beyond the markers
  (section engine).
- **Other installers**: `gentle-ai:` marker sections are third-party content —
  the harness never touches them (append/upsert only of the runecraft: block;
  detected in `harness status` Owners / `harness doctor` check 14).
- **User edits**: a rules section the user edited is preserved and reported
  (`preserved (edited)`) — the sync never overwrites it; `uninstall` also
  preserves it.
- **Upstream collisions**: an upstream package of the same domain next to our
  fork is reported as a collision (two-driver) — never removed automatically.

## 8. Quick reference (5 cases)

Verified against the capability table (section 3).

| Case | Route |
| --- | --- |
| Multi-phase feature with dependencies and re-execution | taskflow |
| Quick delegation of a single subtask | subagents |
| Iterate with an honest numeric metric | goal-loop (`/loop`) |
| Close a task with a verifiable contract + isolated auditor | goal-loop (`/goal`) |
| Review a diff before merge | pr-review |

## 8.5 Guards — execution guards

Guards are harness Pi extensions that really BLOCK or REWRITE tool calls in
the agent loop (`pi.on("tool_call")` + `{ block: true, reason }`). They only
run in harness-managed sessions (agentDir materialized by the install);
non-Pi agents have no enforcement today — their matrix guard cells carry the
planned native surface (Claude Code/Codex PreToolUse hooks, OpenCode
permission overlay — [PARITY.md](PARITY.md) B2). Copilot has no tool-call
hook surface, so its guard stays detect-only in v1 and on the roadmap (B2).

| Guard (config `guards.<id>` in state.json) | What it blocks/rewrites | Config |
| --- | --- | --- |
| `write-existing-file-guard` (`writeExistingFile`) | `write` over an EXISTING file → `{ block: true, reason: "write-existing-file-guard: ..." }` (path relative to the cwd — never absolute). New files pass. `edit` is NOT blocked (it mutates an existing file). | `options.allow: string[]` (relative paths) · `options.force: boolean` (allows everything) |
| `ranger-md-only` (`rangerMdOnly`) | `write`/`edit` of non-`.md` files (case-insensitive: `.MD`/`.Markdown` count) for agents in the `mdOnlyAgents` list → block. Default list: `["auditor"]`. | `options.mdOnlyAgents: string[]` · current agent = `RUNECRAFT_AGENT_ID` (default `main`) |
| `todo-description-override` (`todoDescriptionOverride`) | Rewrites the input of the goal-loop `propose_task_list` tool to the canonical `"<title> — Done when: ..."` format (never blocks — the rewrite IS the policy). | `enabled` |
| `todo-continuation-enforcer` (`todoContinuationEnforcer`) | `complete_goal` with pending tasks in the goal-loop ledger (`.pi-glla/active.jsonl`) → block listing the items (id + title). | `enabled` |

**Operation:**

- **Fail-closed by default**: guards are ON in managed sessions; turning them
  off is explicit config (`guards.<id>.enabled: false`). Invalid config of ONE
  guard → it operates fail-closed (blocks, never opens) and the others
  continue; the doctor reports.
- **Kill switch**: `RUNECRAFT_GUARDS=0` (env) → all guards inactive.
- **Frozen per session**: config is read at `session_start` and holds for the
  session (no mid-turn drift).
- **Config**: additive `guards` section of state.json (schemaVersion 1) — no
  new file; `harness status` shows the state per guard, `harness doctor`
  check 18 validates, `harness sync` re-applies the defaults when the section
  is absent.
- **Goal-loop tool names**: the fork has no `todowrite`/`todoresolve` — the
  task list is `propose_task_list`, the status tools are
  `update_task_status`/`complete_task`, and the conclusion is
  `complete_goal`. The enforcer hooks the `complete_goal` tool call
  (turn_end/agent_end do not block in the Pi SDK 0.81.0).

## 8.6 Verification — verification cascade

The verification cascade (deterministic OUTPUT) runs on the `complete_goal`
tool call of the todo enforcer (section 8.5) — AFTER the pending-tasks check,
in a deterministic order — and via the CLI `harness verify` (the SAME pure
engine `runVerificationCascade`). The cascade goes cheap→expensive with
short-circuiting:

| Layer (config `verification.policy.onFail.<id>`) | What it verifies | Failure → |
| --- | --- | --- |
| `structural` | repo scripts (lint/typecheck/test — `bun run <script>`, timeout 120s; defaults detected in the git root package.json; override `structural.commands`) | skip (verdict + suggestion) |
| `integrity` | protected files = the write-guard domain (section 8.5) (tracked in HEAD, realpath; exceptions `allow`/`force` of the write guard) — DELETE or FULL REPLACEMENT → guard reason-id | halt (blocks) |
| `sufficiency` | file scope (`thresholds.sufficiency.scopePaths`; empty = does not apply) + ratio `added+deleted tokens ∈ [minRatio, maxRatio] × |spec|` → `empty`/`oversized`/`scope-violation` | halt (blocks) |
| `embedding` | local deterministic similarity (char n-gram n=3 TF + cosine, zero deps/network): `score ≥ max → pass`, `≤ min → fail`, middle → gray | skip (verdict + suggestion) |
| `judge` | LLM env-gated ONLY in the gray zone (`RUNECRAFT_VERIFY_LLM_JUDGE=1`); versioned faithfulness prompt (never self-evaluation); strict JSON `{verdict, confidence, reasons[]}`; invalid/timeout → fail-closed counted against the cap | skip (verdict + suggestion) |

**Operation:**

- **Fail-closed by default**: the cascade is ON in managed sessions (defaults:
  integrity/sufficiency halt; structural/embedding/judge skip).
- **Kill switch**: `RUNECRAFT_VERIFY=0` → cascade inactive (session and CLI —
  exit 0).
- **Frozen per session**: config read at `session_start` (no mid-turn drift).
- **Cost caps** (`verification.costCaps`): `maxCascadeRuns`/`maxJudgeCalls`/
  `maxJudgeTokens` per execution; a spent cap → HALT without judge (reason
  with accounting).
- **Degrade** (`verification.degrade`): `embeddingUnavailable` default `skip`
  (degraded verdict recorded — missing evidence is not a violation);
  `grayZoneNoJudge` default `fail` (fail-closed: CI does not certify a
  doubtful case without a judge — CLI exit 1).
- **Config**: additive `verification` section of state.json (schemaVersion 1)
  — no new file; invalid → fail-closed (session blocks with reason; CLI
  exit 3); `harness status` shows the section, `harness doctor` check 19
  validates.
- **CLI `harness verify`**: exit codes 0 pass/skip/degraded · 1 fail ·
  2 halt · 3 config/infra; `--json` = `{ok, checks[], warnings[], verdict}`;
  scope = the repo working tree (active goal via ledger when present); the
  judge never runs without env (CI/merge gates are offline).
- **Session verdicts**: recorded in the append-only log
  `.runecraft/verify-verdicts.jsonl` (the Pi SDK 0.81.0 does not allow
  annotating a passing tool call — `ToolCallEventResult` = `{block, reason}`).

## 8.7 Evals — eval framework

The harness ships an eval framework with suites/cases/scenarios as **TS
data** under `test/eval/{suites,cases,scenarios}`; the in-process runner
(`src/eval/`) loads (dynamic import), executes and evaluates with evidence
via `evalTest()`. Full reference: `docs/EVAL-FRAMEWORK.md`.

| Concept | What it is | Where it lives |
| --- | --- | --- |
| Suite | TS manifest (id/phase/caseFiles) | `test/eval/suites/*.ts` |
| Case | declarative case (target + executor + evaluators) | `test/eval/cases/*.ts` |
| Scenario | scripted scenario of the fixture (fake tool-call choice, real execution) | `test/eval/scenarios/*.ts` |
| Evaluators | 8 deterministic + trajectory-assertion + llm-judge (2 tiers) + baseline-diff | `src/eval/evaluators/` |
| Targets | prompt-render (renderRules) · single-turn-agent (SDK session) | `src/eval/targets/` |
| Evidence | `evalTest()` → `evidence/partial/*.jsonl` → merged `last-run.json` | `test/eval/evidence/` |

- **Suites today**: constraint adherence (the execution guards as subjects),
  compaction recovery (the resilience layer), memory, observability,
  persona/models, role agents, coded routing, and the Copilot adapter. The
  adversarial guard-off case fails with a diagnostic (induced deviation —
  never passes silently).
- **LLM judge**: substring tier offline (always) + real tier ONLY with
  `RUNECRAFT_VERIFY_LLM_JUDGE=1` via the verify judge adapter (section 8.6) —
  never in CI (env off by construction).
- **Run**: `bun test test/eval` — offline/$0; the ratchet covers the new
  evidence (see `docs/EVAL-FRAMEWORK.md` and `docs/testing.md`).

## 8.8 Resilience & Continuity — resilience layer

The resilience layer ports the continuation machinery into REAL mechanisms
of the Pi SDK 0.81.0:

| Mechanism | Exists (SDK / forks / harness) | The harness builds |
| --- | --- | --- |
| Compaction event | SDK: `session_before_compact`/`session_compact` in the event union + pure `shouldCompact` | primary trigger + honest fallback `session_start reason=resume\|reload` |
| System prompt rewrite | SDK: `BeforeAgentStartEventResult.systemPrompt` chainable | continuation hook `src/extensions/resilience.ts` |
| Goal/taskList state | goal-loop ledger `.pi-glla/active.jsonl` | source of truth for continuation + `.runecraft/continuation.json` |
| All tools | goal-loop `propose_task_list`/`update_task_status` (no `todowrite`) | todo preserver |
| Stall signals | SDK: `turn_start{turnIndex,timestamp}`/`turn_end{toolResults}`/`agent_end`/`tool_call`/`agent_settled` + `ctx.isIdle()`/`hasPendingMessages()` | detector input |
| Proven stall machinery | goal-loop: heartbeat/escalation, pending-latch watchdog, wedge alert, grace after compaction, extensionApiStale | pure port in `src/resilience/stall.ts` |
| Repetition/identical output | goal-loop repetition detection (fingerprint sha256, Jaccard 0.8, toolResultRepeat 3) | `repetition`/`identical-output` detectors |
| Backoff | goal-loop backoff (stuck/error/context, hard cap 5min) | ladder in detector/policy |
| Rate-limit/quota | goal-loop quota-retry `isQuotaError`/`parseQuotaError` | reused in `src/resilience/classify.ts` |
| Retry/skip/halt policy + budget | verification layer `RETRY/SKIP/HALT` + `cost.ts` CostLedger | escalation policy + budget |
| Actionable suggestion | verification `suggestions.ts` | classifier `suggestion` |
| Model switch | model-resolution layer (section 8.11) — NOT part of this layer | interface `FallbackAction.modelSwitch` (implemented in the models layer) |
| Markdown plans / workflow | role agents + coded routing (sections 8.13/8.14) — NOT part of this layer | outline; this layer resumes from the ledger only |

**Operation**: the extension `extensions/resilience.ts` (materialized in
harness-managed sessions) observes compaction (`session_before_compact` →
snapshot of the taskList; `session_compact` → 3min grace + pending
continuation), `session_start reason=resume|reload` (honest fallback) and
re-injects the continuation prompt via `before_agent_start` (systemPrompt
CHAINED — never overwrites other extensions). The stall detector observes
real events (`tool_call`/`tool_result`/`turn_end`/`agent_settled`) with
goal-loop thresholds (configurable via state.json `resilience` — defaults
fail-closed); kill switch `RUNECRAFT_RESILIENCE=0`. State: goal-loop ledger
(goal/taskList) + `.runecraft/continuation.json` (harness metadata) +
`.runecraft/resilience-events.jsonl` (append-only log). The `/start-work`
command resumes the active goal explicitly (restart/resume — never automatic
at startup).

**Boundary**: `modelSwitch` is an interface implemented by the models layer
(section 8.11); this layer does NOT resolve models. Invariant: the
continuation re-injects pending items ONLY from the current ledger — it
never re-injects a full task list (dedicated adversarial test in
`test/resilience/invariant.test.ts`).

**Pattern origins**: the stall/backoff/quota patterns are ports of the
goal-loop-audit fork mechanisms; each port cites the source file in the code
(constants with the exact values: HEARTBEAT_STALL_MS,
WEDGE_ALERT_DEFAULT_MINUTES, PENDING_LATCH_STUCK_MS, COMPACTION_GRACE_MS,
DEFAULT_STALL_ESCALATION_REFIRES, REPETITION.*, BACKOFF_HARD_CAP_MS).

## 8.9 Observability & Lessons — event store, bundles and lessons

The observability layer provides typed events in an auditable append-only
event store, exportable to Langfuse/OTel in the future:

| Mechanism | Exists (SDK / forks / harness) | The harness builds |
| --- | --- | --- |
| Append-only best-effort writes | verification `recordSessionVerdict` (try/catch, never crashes the handler) | `src/observability/store.ts` (same pattern + prevHash chain) |
| Logging without stdout | guardLog (stderr, `[runecraft:guards]`) | reuses guardLog (same prefix) |
| Per-session state | `.runecraft/continuation.json` (schema v1, append/atomic) | `lessons.jsonl` (state) + `events/` (append-only) |
| Context/tokens | taskflow `.pi/taskflows/runs/token-budget/*.json`; SDK `ctx.getContextUsage()` (typed `ContextUsage`); pure `shouldCompact` | context-monitor + token-state + read-only access |
| System prompt rewrite | SDK `before_agent_start` → chained systemPrompt | lessons addendum injection (marker `<!-- runecraft:lessons -->`) |
| Block observation | SDK `tool_execution_end` (isError + reason in result.content); the `tool_call` does NOT expose the block | `guard:blocked` live |
| Canonical fingerprint | ratchet sort/normalize (sorted keys); pure renderRules | `src/observability/bundle.ts` |
| Lesson capture | none (new domain) | `src/observability/lessons.ts` |
| Export | none (fragmented sinks) | `src/observability/export.ts` + `docs/EVENTS.md` |
| Team memory | memory layer (section 8.10) — future | versioned `promoted.jsonl` (consumed by the memory layer) |
| OTel/Langfuse SDK | none (zero-deps locked) | mapping table in `docs/EVENTS.md`; implementation deferred (dated note 2026-08-08) |

**Operation**: the extension `extensions/observability.ts` (materialized in
harness-managed sessions) writes typed events to
`.runecraft/events/<sessionId>.jsonl` (header `session:started` with the full
bundle + 12-hex prefix on the rest), observes blocks via `tool_execution_end`
(→ `guard:blocked` + lesson), monitors context (getContextUsage + read-only
token-budget) and injects the lessons addendum via `before_agent_start`
(planning track = promoted at start; execution track = lessons from the gate
that failed in the next turn — chaining preserved). Lessons live in
`.runecraft/lessons.jsonl` (state, gitignored); promotion →
`.runecraft/lessons/promoted.jsonl` (VERSIONED — team memory). CLI:
`harness events export --format jsonl [--session <id>] [--include-external]`
(deterministic + bridges) and `harness lessons list|promote <id>|archive
<id>`. Kill switch `RUNECRAFT_OBSERVABILITY=0`. The schema contract (kinds,
boundaries, OTel/Langfuse mapping) lives in `docs/EVENTS.md`.

## 8.10 Memory — persistent cross-session memory

The memory layer provides durable memory queryable by tool:

| Mechanism | Exists (SDK / runes / harness) | The harness builds |
| --- | --- | --- |
| SQLite + FTS5 + WAL | `bun:sqlite` (Bun 1.3.14) · `node:sqlite`/DatabaseSync (Node ≥22.19) — probes: WAL `"wal"`, FTS5 diacritics, real schema executes | `src/memory/client.ts` (dual driver) + `schema.sql` AS-IS |
| Pi tool registration | `pi.registerTool(defineTool(...))` | `src/memory/tools.ts` — 10 × `rune_*` |
| Harness Pi extension | `extensions/{guards,resilience,observability}.ts` + `pi.extensions` manifest | `extensions/memory.ts` |
| Additive config + freeze + kill switch | state.ts sections (same pattern as other layers) | `src/memory/config.ts` section `memory` |
| Deterministic fixture | scripted scenarios + extension materialization | memory evals |
| Versioned team memory | observability `lessons/promoted.jsonl` | import-lessons bridge |
| DRY clock/id (determinism) | injectable clock/idGen | DI clock/idGen in the Repository |
| CLI subcommand | CLI dispatch (install/verify/lessons...) | `harness memory` |
| FTS drift check | doctor-style check | `src/memory/cli.ts` doctor [--purge] |
| argsHash (privacy) | hashed tool:call/result | privacy guarantee + eval |

**Operation**: the extension `extensions/memory.ts` (materialized in
harness-managed sessions) registers the 10 `rune_*` tools at `session_start`
(same pattern as the goal-loop fork), with the local DB
`.runecraft/memory/runes.db` (WAL — the file IS the cross-session memory;
`appendEntry` is a session log and does not persist). The skill `using-runes`
(manifest `pi.skills`) instructs the agent to call `rune_context` at the
start, `rune_save` on a decision/correction, `rune_search` before acting,
top-10 curation per category, and "do not save secrets" (tool-driven, zero
prompt rewrite). Bridge: `harness memory import-lessons` (idempotent,
`where_ref="lesson:<id>"`; read-only source; default
`importLessonsOnStart: false`). CLI: `harness memory search|stats|doctor
[--purge]|import-lessons`. Kill switch `RUNECRAFT_MEMORY=0` (inert layer,
zero tools/files). Config in state `memory` (frozen per session). Full
reference: `docs/MEMORY.md`.

**Boundary**: the observability layer owns `lessons/promoted.jsonl` and
`events/`; the memory layer imports read-only and idempotently (never
rewrites the source, never overwrites user memory). Model routing
(section 8.11) and coded routing (section 8.14) are not touched by this
layer.

## 8.11 Pi First-Class — persona, rules, model routing & SDD

Pi is a first-class citizen: persona + rules injected into the session via
chained `before_agent_start`, per-agent model routing
(pi/opencode/claude/codex), model switching, models.json generation and
versioned SDD assets. Full reference: `docs/PI.md`.

| Mechanism | Exists (SDK / harness) | The harness builds |
| --- | --- | --- |
| before_agent_start chaining | resilience + observability extensions (append + markers) | `extensions/persona.ts` |
| Pi rules | `renderRules("pi")` = PI_RULES (rulesContent.ts) | `src/persona/rules.ts` (read-only reuse) |
| Per-session variant | SDK session_start reason (resume/reload) | `src/persona/first-message.ts` (port) |
| Model resolution | none in the harness | `src/models/resolution.ts` |
| Model switch | interface in the resilience layer | `src/models/switch.ts` |
| Model registry | `ModelRuntime.create({modelsPath})` + getModel | `src/models/registry.ts` (validated real path) |
| models.json fixture | `renderModelsJson(port)` (eval fixture) | models evals |
| Additive state + kill switch | state.ts schemaVersion 1; RUNECRAFT_*_0 pattern | `models` + `persona` sections |
| Chains | `.pi/chains/*.chain.md` + agent discovery (subagents fork) | `assets/sdd/chains/sdd-*.chain.md` |
| CLI subcommand | CLI dispatch (install/verify/lessons/memory...) | `harness models|sdd|plans` |
| Eval framework | runner/evaluators | pi suite |

**Operation**: the extension `extensions/persona.ts` (materialized in
harness-managed sessions) injects persona + PI_RULES (markers
`<!-- runecraft:persona -->` / `<!-- runecraft:rules -->`) in the CHAINED
`before_agent_start` (append — registration order = append order) and applies
the first-message variant ONCE per initial session (reason resume|reload →
no variant — the resilience layer owns continuation). Kill switches
`RUNECRAFT_PERSONA=0` / `RUNECRAFT_MODELS=0`. Config `persona`/`models`
additive in the state (frozen per session; invalid → defaults + report —
fail-closed). Model resolution per agent with precedence override → custom
chain > builtin → systemDefault → null + warn (nothing invented).
`harness models generate` (deterministic, 2 runs byte-identical) + `harness
models list|doctor` + Models section in status + doctor check 20. SDD:
`harness sdd new|chains` + `harness plans archive` (`.runecraft/plans/`).

**Boundaries**: the resilience layer owns the modelSwitch interface (the
models layer implements it in `src/models/switch.ts` — zero changes in
`src/resilience/`); renderRules/PI_RULES are owned elsewhere (read-only
reuse); the observability/resilience layers own continuation/lessons (the
persona only appends); the Copilot adapter is independent; the role agents
consume the `models` config.

## 8.12 Copilot (VS Code) — harness adapter

Copilot (VS Code) is a fifth managed agent with an adapter in the standard
pattern (`harness install --agent copilot`; aliases `vscode`/
`vscode-copilot`/`github-copilot` — another installer's naming is accepted as
an alias, without adopting its id). Targets are **repo-scoped** (workspace =
cwd):

| Target | File | Managed content |
| --- | --- | --- |
| Rules | `.github/copilot-instructions.md` | `runecraft:workflow` section (html markers) — content = `renderRules("copilot")` = the shared non-Pi template (read-only reuse, zero new text) |
| MCP | `.vscode/mcp.json` | entry `servers.taskflow` — VS Code schema `{type: "stdio", command, args?, env?}` (no `${input:...}` — the Agent Host does not read the file directly: VS Code forwards the servers) |

**Host MCP reused**: the server is `@runecraft/taskflow-claude` (generic
stdio — `resolveMcpBin("claude")`; env > dev fork > npx pin with anti-upstream
guard). There is NO `@runecraft/taskflow-copilot` package — never fabricate
one. A user-level alternative is documented: `~/.copilot/mcp-config.json`
(read natively by the Agent Host) — outside the default (repo-level harness
scope).

**Detection**: `code`/`code-insiders` binary on PATH OR extension dirs
`github.copilot*`/`github.copilot-chat*` under `~/.vscode*/extensions` (the
extension is the real signal — the `code` CLI is not always on PATH). Absent →
install refuses **fail-closed display-only** (zero writes) with a hint;
status and doctor (check 21) report detect-only — the harness never installs
runtimes.

**Matrix**: the copilot column = taskflow-MCP + rules + 4 `unsupported` cells
(subagents/goal-loop-audit/pr-review/guards — "is a Pi extension; use
`--agent pi`" + "planned: <native mechanism>"; phase attribution lives in
[PARITY.md](PARITY.md)). Guards: VS Code exposes no tool-call hook surface —
Copilot guards stay detect-only in v1 and on the roadmap (PARITY.md B2).

**Two-driver with another installer**: another installer manages Copilot at
**user-level** (`~/.copilot/...`, legacy `~/.github/copilot-instructions.md`
in HOME — auto-removed by newer versions of that installer; VS Code persona
via `SystemPromptFile(homeDir)`). The harness adapter is **repo-level** — **no
path collision**, but SEMANTIC overlap: VS Code provides both sets to the
model (personal takes priority over repo). `owners.ts` detects the state
`~/.gentle-ai/state.json` + `<!-- gentle-ai:` markers, and an install with a
collision requires `--yes`; user content in
`.github/copilot-instructions.md`/`.vscode/mcp.json` is always preserved and
reported — the harness never removes or rewrites foreign content.

**Governance**: golden `mcp-copilot.golden` (the COMPLETE mcp.json file);
evals for the adapter; the rules content stays owned by `renderRules`
(untouched — copilot receives the existing non-Pi rules).

## 8.13 Objective Role Agents — objective roles

The harness ships 7 professional objective roles as **data-driven agents**
(`agents/*.md` versioned in the package → materialized in `<cwd>/.pi/agents/`
via `harness install/sync` — project scope). The `@runecraft/subagents` fork
discovers `.pi/agents/*.md` natively and the project-scope file **shadows**
the same-named builtin (project > builtin). Agents are DATA: extensible by
construction (any new `.md` in the dir is discovered) and user-editable (the
sync does a three-way merge by content — edits preserved, never auto-healed).
Zero fantasy theme.

### The 7 roles (fail-closed allowlist: what is not in the list does not exist)

| Role | Identity | Tools (allowlist) | Constraints | Delegation |
| --- | --- | --- | --- | --- |
| planner | plans only, 2 modes (interactive/automatic), clarification by scope, NEVER implements | read, grep, find, ls, intercom | read-only; `acceptanceRole: read-only`; `output: plan.md` (persisted by the runtime) | never |
| builder | executes the plan, verifies before reporting; the only writer role | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | writer; `defaultReads: plan.md` | ONLY role with `subagent`: spawns scout (recon) + reviewer (verification) |
| reviewer | verdict `[APPROVE]/[REJECT]` + summary + ≤3 blocking issues, approval bias; plan review + work review | read, grep, find, ls, bash, intercom | read-only (NO edit/write — hardened vs builtin); in-loop | never |
| auditor | compliance audit; write restricted to `.md` (ranger-md-only guard) | read, grep, find, ls, bash, write, intercom | md-only (default `guards.rangerMdOnly.mdOnlyAgents=[auditor]`) | never |
| scout | codebase recon, reports on return | read, grep, find, ls, intercom | read-only; `output: context.md` | never |
| researcher | external research, cites sources | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | read-only; `output: research.md` | never |
| security | security/compliance review, triage + fast-exit, vulnerability classes | read, grep, find, ls, bash, intercom | read-only; structured verdict | never |

### Honest builtin ↔ role mapping

| Objective role | Fork builtin | Relationship |
| --- | --- | --- |
| planner | planner | **shadow compatible** — the builtin was already read-only with `output: plan.md` and no write tool |
| reviewer | reviewer | **shadow hardened** — the builtin had edit/write; the role removes them (read-only allowlist ENFORCES what the fork flows already request by instruction — "Reviewers must not edit files") |
| scout | scout | **shadow hardened** — the builtin had bash/write; the role removes them (`output: context.md` persisted by the runtime) |
| researcher | researcher | **shadow hardened** — the builtin had write; the role removes it (`output: research.md`) |
| builder | — | **new** (no same-named builtin; writer role) |
| auditor | — | **new** (audit role; the md-only guard signs the role) |
| security | — | **new** (security review) |
| worker/oracle/advisor/context-builder/delegate | — | **preserved** (no objective counterpart — generic fork flows continue) |

`output:` artifacts (plan.md/context.md/research.md) are **persisted by the
fork runtime**, not by the agent: an agent without mutation tools returns the
complete artifact and the runtime persists it.

### Delegation

The delegation prompt is a **rendered template**
(`src/agents/delegation.ts` — `renderDelegationPrompt`): it instructs the
delegator to use the `subagent` tool with `agent: "<role>"` and lists the
valid targets (`buildKeyTriggersSection`). v1 policy: **only the builder
spawns** (scout + reviewer); the other roles do NOT have `subagent` in their
allowlist (fail-closed — they cannot spawn; mirrors the spawn policy of the
original planner: the planner never spawns). The coded orchestration
(keyword-detector, section 8.14) consumes these roles by data (outline).

### Review composition

The reviewer is a **read-only in-loop** agent (verdict `[APPROVE]/[REJECT]` +
≤3 blocking issues). PR review continues with **pr-review** + **receipts**
(explicit boundary — the pr-review loop tools are gated outside an active
`/pr-review`; the reviewer is NOT a wrapper). Reviewer model variants
(`review_models` → `reviewer-review-<key>`) are data of the models layer
(`models.agents.reviewer.review_models` /
`models.agents.security.review_models`) — fan-out/collation stays in the
pr-review fork.

### Models

The 7 role ids are valid `state.models.agents.<id>.fallbackChain` ids —
**no default chain in code** (zero invented ids; models come from the SDK
models.json via `harness models generate`). Example USER config with class
semantics (heavy = planner/researcher/security · light = builder/scout ·
medium = reviewer/auditor — never a default):

```jsonc
{ "models": { "agents": {
  "planner":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "heavy-1" }] },
  "researcher":{ "fallbackChain": [{ "providers": ["provider-a"], "model": "heavy-1" }] },
  "security":  { "fallbackChain": [{ "providers": ["provider-a"], "model": "heavy-1" }] },
  "builder":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "light-1" }] },
  "scout":     { "fallbackChain": [{ "providers": ["provider-a"], "model": "light-1" }] },
  "reviewer":  { "fallbackChain": [{ "providers": ["provider-a"], "model": "medium-1" }] },
  "auditor":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "medium-1" }] }
} } }
```

### Boundaries

- The guards layer owns the `rangerMdOnly` guard — this layer changes only
  the config default (`mdOnlyAgents += "auditor"`); the guard code is
  untouched.
- The models layer owns `src/models/` — this layer consumes it by id contract.
- Coded routing (section 8.14) owns the orchestration — this layer delivers
  agents + templates (outline).
- renderRules stays untouched.
- PR review/receipts own PR review — the reviewer is in-loop.
- The subagents fork is consumed READ-ONLY (zero changes).
- Identity: the fork sets `PI_SUBAGENT_CHILD_AGENT` (not
  `RUNECRAFT_AGENT_ID`) — the documented bridge (`src/agents/identity.ts`)
  translates the child identity to the env the guard reads.

## 8.14 Coded Routing & Pilot Coordination — coded routing

The harness routes each task by **PURE CODE**: the deterministic classifier
(`src/routing/classifier.ts`) turns text/file features into a route, with
explicit thresholds in constants — NEVER an LLM, never probabilistic. The
category semantics come from the original prompt-composer; the probabilistic
mechanism (an LLM choosing the route) is NOT ported, and the fantasy-theme
injection was dropped (zero deterministic value). The hook is
`before_agent_start` (STOP RULES — the first message IS the prompt).

### Route categories (7 routes × role × keywords × threshold)

| Route | Role | Pilot chain | High signals (×2) | Medium signals (×1) | Priority | Mandatory |
| --- | --- | --- | --- | --- | --- | --- |
| explore | scout | explore.chain.md | locate, trace, where is, find where, map the codebase, codebase recon, recon | explore, navigate, codebase, understand the code, module boundaries | 1 | no |
| research | researcher | research.chain.md | research, look up docs, look up documentation, external docs, check the docs, search the web, read the docs, find documentation | documentation, sources, cite, best practices, compare | 2 | no |
| review | reviewer | — (no chain in v1) | review, validate, check my work, approve, verify my changes, code review, review my | assess, quality, verdict, audit, verify, feedback, check the | 3 | no |
| implement | builder | implement.chain.md | implement, build, refactor, add feature, port, fix, execute the plan, write the code, create the | modify, update, edit, create, add, execute, code changes, todo list | 4 | no |
| planning | planner | plan.chain.md | plan, planning, break down, roadmap, spec, specification, design, redesign, scope, task list, decompose, estimate, architecture | outline, approach, strategy, steps, todos, milestones, requirements | 5 | no |
| security | security | security.chain.md | auth, authentication, authorization, crypto, cryptographic, token(s), secret(s), password(s), session(s), cors, oauth, oidc, saml, .env, input validation, signature(s), csrf, xss, credential(s), encrypt(ion), sanitize | security, vulnerability, threat, privilege, permissions, exploit, injection, data breach, leak | 6 | **YES** (high signal bypasses the threshold) |
| direct | — | — | — | — | 0 | fail-closed default |

**Features**: prompt/task text (case-insensitive; single-word keywords with
token boundary, phrases by substring); spec-driven development — the presence
of a project spec file (specPath injected by the caller) or a mention of the
spec directory in the text → **+2 planning**. File count (`git status`) does
NOT enter the initial route — it is a CHAIN gate (≥3 files → review step).
`ROUTE_THRESHOLD = 2` (constant): score ≥ 2 → route; score < 2 → `direct`
(fail-closed). Tie → deterministic priority (security > planning > implement
> review > research > explore). Empty/unreadable input → `direct`.

### Pilot coordination — chains

The workflow engine (steps/gates/artifacts) becomes **5 pilot chains**
versioned (`chains/*.chain.md` in the real fork format — front-matter
`name`+`description` + `## <role>` sections; materialized in
`<cwd>/.pi/chains/` with three-way merge by content + contentHash):

| Chain | Steps | Gate |
| --- | --- | --- |
| implement.chain.md | builder (executes) → reviewer (gate) → builder (summary/handoff) | verdict `[APPROVE]/[REJECT]` + ≤3 blocking issues |
| plan.chain.md | planner (plan.md) → reviewer (gate) → builder (executes) → reviewer (work review) | structured verdict |
| research.chain.md | researcher (brief with sources) | — |
| explore.chain.md | scout (read-only recon) | — |
| security.chain.md | builder (implements) → security (audit: triage + fast-exit, vulnerability classes) → builder (fixes) → reviewer (gate) | structured verdict |

Selection: route ≠ `direct` → chain from the catalog (1:1 in v1); **chain
missing in `.pi/chains/` → `direct` + warn** (fail-closed — never invents a
route/chain; the review route has no chain in v1 → same). `REJECT` at a gate
→ pause/fail. Model per step: `models.agents.<role>.fallbackChain` (id
contract; end-of-chain → null + warn, nothing invented).

### Delegation

The `subagent` tool of the fork is the native equivalent (child session +
prompt + return). The ROUTING DIRECTIVE (marker `<!-- runecraft:routing -->`)
injected in `before_agent_start` instructs the session with
`renderDelegationPrompt` + `buildKeyTriggersSection` (valid targets
name/description/tools). The QA-5 policy is PRESERVED: only the builder has
`subagent` in its allowlist; the ORCHESTRATION belongs to the chain (the fork
runtime spawns the steps), not to the role — non-delegator roles do not spawn.

### Config, kill switch and boundaries

- **Additive config** `state.routing` (schemaVersion 1):
  `{enabled, threshold: {direct}, routes: {<id>: {enabled?, mandatory?}}}` —
  defaults in code; frozen per session; disabled routes are not selectable.
- **Kill switch** `RUNECRAFT_ROUTING=0|false|off` → inert extension.
- **Two-driver**: a session supervised by the goal-loop (`sessionDriver` —
  active loop OR active goal + autoContinue) → routing INERT (the loop is the
  pilot; see section 2).
- **Resilience**: fallback does NOT re-route (route frozen per session;
  `modelSwitch` changes MODEL, never route).
- **Models**: per-role models via `models.agents.<id>` (id contract).
- **Observability**: lessons inform PROMPTS (addendum intact), NEVER routes —
  route = pure function of input (contract test).
- **Role agents**: catalog read-only; delegation policy preserved.

## 8.15 Claude Code parity (B0/B1) — capability manifest + roles + routing

Phase B0 (capability manifest) and B1 (Claude Code roles + routing) shipped:
what each agent CLAIMS per capability now lives in one place
(`src/capabilities/manifest.ts`), and Claude Code receives two of the four
tools through its native surface.

### Capability manifest (B0)

- Per-agent feature claims (hooks / subagents / mcp / models / guards +
taskflow / goal-loop / pr-review / memory / persona / sdds) as a single
source of truth — install refusal reasons (`matrix.ts` cells), `doctor`
check 25 and `status` (Capabilities section) all read from it.
- `companion doctor` check 25 digests the manifest (byte-stable sha256,
gentle-ai `manifest_test.go` pattern): drift between the manifest and the
consumers is a red test, not a silent copy.
- Honesty rules: Copilot declares `none` for guards/hooks (no hook surface —
recon §4.4); goal-loop is `none` for all non-Pi agents (commander decision
D2 — taskflow + subagents are the documented substitutes, B7 stays future).

### Roles + routing for Claude Code (B1)

- **7 role agents** (`planner`/`builder`/`reviewer`/`auditor`/`scout`/
`researcher`/`security` — `claude-agents/*.md`, Claude agent-file format:
frontmatter name/description/tools + system prompt) materialized to
`~/.claude/agents/` by `companion install --agent claude-code` / `sync`
(three-way by content — user edits preserved, F19 D7). The fork's `subagent`
tool stays Pi-only; delegation uses the native **Task tool** (the `Agent`
tool) naming the role. Only the `builder` role carries the delegation tool
in its allowlist (QA-5 mirror); non-delegator roles never spawn.
- **Coded-routing directive as a CLAUDE.md section**: `runecraft:routing` is
injected by the marker engine (F18) next to `runecraft:workflow` — a
deterministic directive rendered from the SAME route catalog as the F33
classifier (thresholds explicit, security MANDATORY, fail-closed direct,
delegation via Task tool). Claude Code has no extension surface, so the
agent applies the directive; the deterministic classifier remains the
Pi-side mechanism, and B8 asserts parity via evals.
- Verified via `companion doctor` check 24 (Claude role agents) and the
status Claude role agents / Routing sections.

## 9. Appendix: injected text (golden)

The exact text injected by `renderRules(agentId)` — the same source of truth
that feeds the golden test below. The golden test asserts
`renderRules(agentId)` equals the corresponding block byte for byte;
divergence is red. The markers are stable block delimiters; the text between
them is what the section engine injects. The blocks are pinned and must not
be edited by hand.

<!-- BEGIN runecraft:golden:pi -->
Runecraft workflow rules (v1)

Four tools overlap. Pick by situation — the wrong pick costs time or breaks the session.
If a goal is active, it drives the session: see "One driver".

## One driver per session
- The goal-loop directs the session: it schedules continuations via agent_end.
- subagents and taskflow run as WORKERS under the active driver.
- Never have two drivers in one session — two supervisors scheduling continuations
  into one session produce contradictory turns.

## goal-loop-audit — verifiable contract with an isolated auditor
- Use when the work can be stated as a goal with a "Done when" contract.
- Prose closes nothing. The ONLY way to close a goal is a complete_goal tool call
  that survives the isolated auditor: a fresh session (no extensions/skills/prompts;
  read/grep/find/ls/bash only) that cannot see your conversation.
- Evidence is required per contract item: <approved/> without <evidence> is disapproved.
- Cycle: drafting → active → auditing → complete; continuation via agent_end.
- /loop requires an honest numeric metric measured with the measure command
  ("A loop never completes" without one). No honest metric? Use /goal.
- Contraindicated: no verifiable "Done when"; no honest metric for /loop; work that
  requires you to drive the session interactively.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- eval (zero tokens) / expect (validated JSON contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (the plain subagent tool is fine).

## subagents — ad-hoc delegation
- Use for chains (each step receives {previous}) or parallel (concurrency/failFast).
- Acceptance gates (auto/attested/checked/verified): verify runs commands —
  child-reported command success does not count.
- intercom (contact_supervisor); worktrees (each child in its own worktree; clean
  tree required); watchdog (adversarial diff review at agent_end).
- One writer against the active worktree at a time.
- Contraindicated: multi-phase flows with dependencies and reruns (use taskflow);
  session-driving work (use goal-loop).

## pr-review — structured review
- Use for reviewing a diff: structured JSON (verdict; findings P0–nit with
  blocking/confidence), 5 passes by default, parallel dispatch by tiers, optional
  verification against the exact head.
<!-- END runecraft:golden:pi -->

<!-- BEGIN runecraft:golden:non-pi -->
Runecraft workflow rules (v1)

You have taskflow-MCP for structured multi-phase work. Pick by situation.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- Review/verification inside a flow: eval (zero tokens) and expect (validated JSON
  contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (do it directly in the session).
<!-- END runecraft:golden:non-pi -->

## 10. Verification log

The routing guide is validated against the source of truth on each change.
Recent verification runs:

- **2026-08-05**: capability table (section 3) verified against the fork
  sources — pins subagents 0.37.2 · taskflow 0.2.6 · goal-loop-audit 0.28.34 ·
  pr-review 1.11.4. Contraindications marked *(derived from routing)* derive
  from routing, not from fork docs.
- **2026-08-06**: hello world (section 5) executed end to end — PASS, with
  real timings and token counts.
- **2026-08-07**: driver detection validated against the goal-loop-audit
  source — state ledger `.pi-glla/active.jsonl` and the supervision predicate
  `isSupervising` (goal `active` + autoContinue, or loop active).
- **2026-08-07**: Guards (section 8.5) verified against the Pi SDK 0.81.0
  source — tool calls are blocked via `{ block: true, reason }`;
  `turn_end`/`agent_end`/`agent_settled` handler results are IGNORED (only
  `session_before_*` cancels) → the todo enforcer hooks the `complete_goal`
  tool call. Goal-loop tool names validated in the fork: no
  `todowrite`/`todoresolve` — `propose_task_list`/`update_task_status`/
  `complete_task`/`complete_goal`; ledger `.pi-glla/active.jsonl`.
- **2026-08-08**: Verification (section 8.6) validated — `complete_goal`
  payload = `{completionSummary, verificationSummary, newObjective}`; tool-call
  handlers may be async; the session spec = the ledger objective (the
  goal-loop clears the text at start — "Done when" becomes the verification
  contract); tool-call results cannot annotate a passing call (skip/degraded
  verdicts go to `.runecraft/verify-verdicts.jsonl`); the auditor rejects
  evidence that does not cover the contract; the working tree diff excludes
  `.pi-glla/` and `.runecraft/` (harness bookkeeping).
- **2026-08-08**: Resilience (section 8.8) verified — the SDK exposes
  `session_before_compact`/`session_compact`/`before_agent_start`/
  `session_start{reason}`/`ctx.isIdle()`/`hasPendingMessages()`;
  `BeforeAgentStartEventResult.systemPrompt` is chained; the goal-loop
  restore gate HOLDS active goals at session load (no auto-resume by
  default) → the harness injects only when the goal stays active
  (autoresume=on) or after a mid-session compaction; honest limitation: a
  real `session_compact` emission is not feasible in the fixture (a scripted
  event covers the trigger; evals use a synthetic event, nothing fabricated).
- **2026-08-08**: Observability (section 8.9) verified — the SDK `context`
  event carries only messages (no tokens), so the context source is the typed
  `ctx.getContextUsage()` API (`ContextUsage {tokens, contextWindow,
  percent}`) plus the taskflow token budget; the `tool_call` result does NOT
  expose a guard block (the runner short-circuits at the first `{block:true}`)
  and blocked calls do not emit `tool_result` — the real observation is
  `tool_execution_end` (isError + reason `<guardId>: msg`); `before_agent_start`
  fires per user prompt (the execution addendum enters at the next one);
  there is no `session_end` in the SDK 0.81.0 — shutdown uses `agent_end` +
  `session_shutdown` (idempotent).
- **2026-08-09**: Memory (section 8.10) verified — `defineTool` uses TypeBox
  parameters; the extension registers the `rune_*` tools synchronously at
  `session_start` (no race on the first request); `bun:sqlite` (Bun 1.3.14)
  and `node:sqlite` (Node ≥22.19) both run the real runes schema (WAL, FTS5
  diacritics, real-table→FTS5 triggers); tool arguments are hashed (sha256,
  16-hex prefix) and never stored raw; `PRAGMA busy_timeout` in bun:sqlite
  exposes the column `timeout` (not `busy_timeout`).
- **2026-08-10**: Copilot (section 8.12) — repo-scoped adapter for the fifth
  managed agent: rules in `.github/copilot-instructions.md` (marker
  `runecraft:workflow`; content = the non-Pi rules — read-only reuse), MCP in
  `.vscode/mcp.json` `servers.taskflow` (VS Code schema verified — `type:
  "stdio"` + command; no `${input:...}`: the Agent Host does not read the
  file — VS Code forwards), MCP host reused `@runecraft/taskflow-claude`
  (never fabricate `taskflow-copilot`), detection via `code`/`code-insiders`
  binary OR `github.copilot*` extension dirs (fail-closed display-only),
  semantic overlap with a user-level installer handled via owners detection +
  an install confirmation gate, matrix column (MCP + rules + 4 unsupported
  Pi-only cells), doctor check 21, golden `mcp-copilot.golden`.
- **2026-08-12**: Role agents (section 8.13) verified — the subagents fork
  discovers `.pi/agents/*.md` natively (project > builtin shadowing);
  frontmatter accepted = flat `key: value`; tools observed in the builtins =
  `read,grep,find,ls,bash,edit,write,intercom,contact_supervisor,web_search,
  fetch_content,get_search_content` + `subagent` (review-loop.md) — `glob` is
  NOT a fork tool; `output:` is persisted by the runtime for agents without
  mutation tools; the fork sets `PI_SUBAGENT_CHILD_AGENT` (not
  `RUNECRAFT_AGENT_ID`) on dispatch → the documented identity bridge
  (`src/agents/identity.ts`) translates the child identity to the env the
  guard reads; `contact_supervisor` is bridge-gated (not registered in a
  session without a supervisor channel); the default
  `guards.rangerMdOnly.mdOnlyAgents` is now `["auditor"]` (guard untouched).
- **2026-08-13**: Coded routing (section 8.14) verified — the classifier is
  pure code over text features with explicit thresholds; security is
  mandatory on high signals; the directive is injected via
  `before_agent_start` (no input event on the harness surface — the first
  message IS the prompt).

**Revalidation checklist** (on fork bumps or newly found limitations): table
facts → section 3; injected text → section 9 (bump the workflow rules
version); hello world → new versioned entry (section 5).
