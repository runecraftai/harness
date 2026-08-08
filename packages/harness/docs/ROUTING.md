# Runecraft Harness — Routing & Mental Model

> Canonical routing guide of the Runecraft harness (design F19, D1). It is the
> human-facing companion of the injected `runecraft:workflow` rules section
> (appendix, section 9): the injected text is rendered by `renderRules()` from
> the same source of truth, and the golden test keeps render × appendix in sync
> byte for byte (D9 — divergence is red).

## 1. Purpose & 30-second usage

The Runecraft harness loads four forked tools into a Pi session —
`subagents` (ad-hoc delegation), `taskflow` (multi-phase DAG work),
`goal-loop-audit` (verifiable contract with an isolated auditor) and
`pr-review` (structured review) — and manages non-Pi agents (Claude Code,
OpenCode, Codex) through their matrix column: taskflow-MCP + workflow rules.

The four tools overlap; picking the wrong one costs time and, in the worst
case, breaks the session (two-driver rule — section 2). Use this document in
30 seconds:

1. **Is a goal active?** → the goal-loop drives the session (sections 2/4;
   `harness status` shows the driver).
2. **Table first** (section 3) — what each tool does, when to use it, when not.
3. **Quick reference** (section 8) — the 5 common cases.
4. **What your agent actually sees** — the injected text (section 9).

Terminology — two senses of "gate" (reviewed 2026-08-05):

- **gate** (lowercase) — a machine check phase of a taskflow (eval/expect).
- **gates** (hooks, F20) — the delivery hooks (pre-commit/pre-push) of the
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
`harness status` shows the active driver (`driver: goal-loop` /
`driver: sessão (direto)`); `harness doctor` check 16 reports it.

## 3. Tool table

Facts verified 2026-08-05 in the fork sources (pins: subagents 0.37.2 ·
taskflow 0.2.6 · goal-loop-audit 0.28.34 · pr-review 1.11.4 — AD-003). Each
row cites real capabilities only; rows marked *(derivado do roteamento —
validar no Execute)* derive from the routing of the other tools, not from an
explicit contraindication in the fork docs.

| Tool | What it does (facts) | When to use it | Contraindication |
| --- | --- | --- | --- |
| **goal-loop-audit** | goal with a contract "Done when"; "Prose closes nothing... The ONLY way to close it is a complete_goal tool call that survives the isolated auditor"; isolated auditor (fresh session, no extensions/skills/prompts, read/grep/find/ls/bash only, cannot see the implementer's conversation); regression_shield: evidence required per contract item (`<approved/>` without `<evidence>` → disapproval); drafting → active → auditing → complete cycle; continuation via `agent_end`; `/loop` requires a numeric metric via the `measure` command ("A loop never completes") | closable by a verifiable contract ("Done when"); iteration with an honest metric (`/loop`); work that can be handed to an isolated auditor | no verifiable "Done when"; no honest metric for `/loop` (→ use `/goal`); work that requires you to drive the session interactively |
| **taskflow** | DAG with `dependsOn` ("Phase order in the phases array is documentation, not execution order"); FlowIR with content hash per phase; resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only); approvals (human) vs gate (agent); budgets maxUSD/maxTokens (a run ends blocked); eval (zero tokens) / expect (validated JSON contract, fail closed) | multi-phase flows with dependencies; fan-out; reproducibility (resume/replay/recompute); a defined budget | single-file change; interactive debugging; one bash command; "single quick delegation... the plain subagent tool is fine" |
| **subagents** | chains (sequential; each step receives `{previous}`); parallel (concurrent; concurrency/failFast); acceptance gates auto/attested/checked/verified (verify runs commands; "Child-reported command success does not count"); intercom (`contact_supervisor`); worktrees (each child in its own worktree; clean tree required); watchdog (adversarial diff review at `agent_end`); "Use only one writer against the active worktree at a time" | ad-hoc delegation; a simple dependent sequence; independent parallelism; concurrent editing with worktrees; evidence via acceptance gates | multi-phase flows with dependencies and re-execution (→ taskflow); session-driving work (→ goal-loop). *(derivado do roteamento — validar no Execute: the fork docs list no explicit contraindication.)* |
| **pr-review** | structured validated JSON (verdict; findings P0–nit with blocking/confidence); 5 passes by default; parallel dispatch by tiers; optional verification against the exact head; gate inside a flow (F20, AD-011) | reviewing a diff; pre-commit/pre-push gate inside a flow | *(derivado do roteamento — validar no Execute: no contraindication documented in the fork.)* |

## 4. Two-driver in depth

- **Goal active** (`harness status` → `driver: goal-loop`): the goal-loop
  schedules the session's continuations via `agent_end`. subagents and
  taskflow are still usable — as **workers**. Their completions do not
  schedule continuations; the goal-loop remains the single driver.
- **No active goal** (`driver: sessão (direto)`): the session is driven
  directly (you or the model); subagents and taskflow are compatible workers.
- **Violation signals**: two supervisors scheduling continuations into one
  session produce contradictory turns — duplicated follow-ups, clobbered
  session handles, or both loops fighting over the turn.
- **Never**: start a second goal (or a second loop) while a goal is active in
  the same session/cwd; run two drivers "just for one turn". Close or pause
  the active goal first.

## 5. Hello world SDLC

The canonical example (F7 COEX-05, executed 2026-08-06): a trivial goal with
a "Done when" contract, implemented directly, verified by the isolated
auditor and closed end to end with one command.

### Hello world SDLC — v2026-08-06

- **Flow (F7)**: a trivial goal with a "Done when" contract → implementation
  (directly by the model in the goal loop — COEX-05; dispatch via subagents
  or taskflow also works) → the isolated auditor verifies with evidence
  (regression_shield) → review → the cycle closes (complete_goal survives
  the auditor).
- **Result F7 (COEX-05)**: **PASS** — 2026-08-06.
  - One prompt: `/goal "Create a file greeting.txt whose content is the exact
    text 'hello harness'. Done when: greeting.txt exists in the repo root and
    its content is exactly 'hello harness'."`
  - Wall time: **23.4s** (goal_created → final complete state). Auditor:
    **10.6s** (deepseek-v4-flash, thinking high).
  - Tokens (5 model turns): input **22,445** · output **896** · cacheRead
    **109,824** · cost **≈ US$ 0.004**.
  - Cycle (transcript `.pi-glla/active.jsonl`, repo `coex05`):
    `goal_created` → `goal_continuation_sent` → implementation (3× bash;
    greeting.txt, 13 bytes) → `complete_goal` (status auditing) → isolated
    auditor (read-only tools: ls, stat, od -c, wc -c, cmp;
    `regressionShieldPassed: true`, `<approved/>`) → `goal_archived`
    complete (`stopReason: auditor deepseek-v4-flash approved`,
    `reviewer_fired`).
- **Reproduction**: disposable test repo; exact commands/times/tokens in
  `.specs/features/f7-coexistence-validation/scenarios.md` (COEX-05).

**Version history:**

| Version | Date | Result | Delta |
| --- | --- | --- | --- |
| v2026-08-06 | 2026-08-06 | COEX-05 PASS — 1 prompt, 23.4s wall, auditor 10.6s, ≈ US$ 0.004 | first canonical entry (F7) |

Rule: any flow/command change between versions produces a new versioned
entry — never silently edit the current example.

## 6. Limits per agent

What each matrix column (F17) actually has — the injected rules (section 9)
never cite a tool outside the column.

| Agent | Column |
| --- | --- |
| **Pi** | full column: subagents + taskflow + goal-loop-audit + pr-review (extensions) + rules (native). The injected rules cover all 4 tools + two-driver + worker rule. |
| **Claude Code** | taskflow-MCP + workflow rules (`runecraft:workflow` in ~/.claude/CLAUDE.md). No goal-loop/subagents/pr-review — Pi extensions only. |
| **OpenCode** | taskflow-MCP + workflow rules (AGENTS.md). Same limits. |
| **Codex** | taskflow-MCP + workflow rules (AGENTS.md). Solo agent (no permissions/output styles — F17); the injected rules are the shared non-Pi template. |
| **Other agents (cursor, grok, …)** | detect-only with a manual MCP guide (no adapter in v1). |

## 7. Coexistence

- The harness manages exactly the `runecraft:workflow` block: append on
  insert, in-place update by the stable id, nothing beyond the markers (F18
  section engine).
- **gentle-ai**: `gentle-ai:` marker sections are other owners' content —
  the harness never touches them (append/upsert only of the runecraft: block;
  detected in `harness status` Owners / `harness doctor` check 14).
- **User edits**: a rules section the user edited is preserved and reported
  (`preserved (edited)`) — the sync never overwrites it; `uninstall` also
  preserves it.
- **Upstream collisions**: an upstream package of the same domain next to our
  fork is reported as a collision (two-driver) — never removed automatically.

## 8. Quick reference (5 cases)

Verified against the D2 capability table (section 3) — the Independent Test
of the spec (ROUT-01).

| Case | Route |
| --- | --- |
| Multi-phase feature with dependencies and re-execution | taskflow |
| Quick delegation of a single subtask | subagents |
| Iterate with an honest numeric metric | goal-loop (`/loop`) |
| Close a task with a verifiable contract + isolated auditor | goal-loop (`/goal`) |
| Review a diff before merge | pr-review |

## 8.5 Guards — execution guards do harness (F24)

Os guards são extensões Pi do harness que BLOQUEIAM/REESCREVEM tool calls de
verdade no loop do agente (`pi.on("tool_call")` + `{ block: true, reason }`)
— diferente do OpenCode/guild, onde o mesmo guard era um aviso no prompt que
a LLM podia ignorar. Só rodam em sessões gerenciadas pelo harness (agentDir
materializado pelo install); agentes não-Pi (Claude Code/OpenCode/Codex) NÃO
têm enforcement — a coluna deles na matriz é detect-only com guia (ADPT-03).

| Guard (config `guards.<id>` no state.json) | O que bloqueia/reescreve | Config |
| --- | --- | --- |
| `write-existing-file-guard` (`writeExistingFile`) | `write` sobre arquivo JÁ EXISTENTE → `{ block: true, reason: "write-existing-file-guard: ..." }` (path relativo ao cwd — nunca absoluto). Arquivo novo passa. `edit` NÃO é bloqueado (é mutation de arquivo existente — validado no Execute). | `options.allow: string[]` (paths relativos) · `options.force: boolean` (libera tudo) |
| `ranger-md-only` (`rangerMdOnly`) | `write`/`edit` de não-`.md` (case-insensitive: `.MD`/`.Markdown` contam) para agentes da lista `mdOnlyAgents` → block. v1: lista VAZIA por default (guarda ativo, inerte — F32 registra o papel auditor). | `options.mdOnlyAgents: string[]` · agente atual = `RUNECRAFT_AGENT_ID` (default `main`) |
| `todo-description-override` (`todoDescriptionOverride`) | Reescreve o input de `propose_task_list` do glla para o formato canônico `"<título> — Done when: ..."` (nunca bloqueia — a reescrita É a política). | `enabled` |
| `todo-continuation-enforcer` (`todoContinuationEnforcer`) | `complete_goal` com tarefas pendentes no ledger do glla (`.pi-glla/active.jsonl`) → block listando os itens (id + título). | `enabled` |

**Operação:**

- **Fail-closed por padrão**: guards LIGADOS em sessões gerenciadas; desligar é
  config explícita (`guards.<id>.enabled: false`). Config inválida de UM guard
  → ele opera fail-closed (bloqueia, não libera) e os demais seguem (D10); o
  doctor reporta.
- **Kill switch**: `RUNECRAFT_GUARDS=0` (env) → todos os guards inativos.
- **Congelado por sessão**: a config é lida no `session_start` e vale durante
  a sessão (sem drift mid-turn).
- **Config**: seção aditiva `guards` do state.json (F13, schemaVersion 1) —
  sem arquivo novo; `harness status` mostra o estado por guard, `harness
  doctor` check 18 valida, `harness sync` re-aplica os defaults quando a
  seção está ausente.
- **Tool names do glla (validado no Execute F24)**: NÃO existe
  `todowrite`/`todoresolve` no fork goal-loop-audit — a task list é
  `propose_task_list`, o status é `update_task_status`/`complete_task` e a
  conclusão é `complete_goal`. O enforcer usa `tool_call` de `complete_goal`
  (turn_end/agent_end NÃO bloqueiam no Pi 0.81.0 — runner.js).

## 8.6 Verification — cascata de verificação do harness (F25)

A cascata de verificação (determinismo de SAÍDA — AD-022 d6) roda no
`complete_goal` do enforcer F24 (DEPOIS do check de pendências — ordem
determinística D11) e via CLI `harness verify` (MESMA engine pura
`runVerificationCascade` — D1). Cascata cheap→expensive com short-circuit:

| Camada (config `verification.policy.onFail.<id>`) | O que verifica | Falha → |
| --- | --- | --- |
| `structural` | scripts do repo (lint/typecheck/test — `bun run <script>`, timeout 120s; defaults detectados no package.json da raiz git; override `structural.commands`) | skip (veredito + sugestão — QA-1) |
| `integrity` | arquivos protegidos = domínio do write-guard F24 (rastreados no HEAD, realpath; exceções `allow`/`force` do F24) — DELETE ou SUBSTITUIÇÃO INTEGRAL → reason-id F24 (`write-existing-file-guard`) | halt (bloqueia — QA-1) |
| `sufficiency` | QA-2: escopo de arquivos (`thresholds.sufficiency.scopePaths`; vazio = não aplica) + proporção `added+deleted tokens ∈ [minRatio, maxRatio] × |spec|` → `empty`/`oversized`/`scope-violation` | halt (bloqueia — QA-1) |
| `embedding` | similaridade local determinística (char n-gram n=3 TF + cosseno, zero deps/rede — D4): `score ≥ max → pass`, `≤ min → fail`, meio → gray | skip (veredito + sugestão) |
| `judge` | LLM env-gated SÓ na zona cinza (`RUNECRAFT_VERIFY_LLM_JUDGE=1`); prompt de faithfulness versionado (spec derivado, nunca auto-avaliação); JSON estrito `{verdict, confidence, reasons[]}`; inválido/timeout → fail-closed contabilizado no cap | skip (veredito + sugestão) |

**Operação:**

- **Fail-closed por padrão**: cascata LIGADA em sessões gerenciadas
  (defaults QA-1: integrity/sufficiency halt; structural/embedding/judge skip).
- **Kill switch**: `RUNECRAFT_VERIFY=0` → cascata inativa (sessão e CLI — exit 0).
- **Congelado por sessão**: config lida no `session_start` (D12 — sem drift mid-turn).
- **Cost caps** (`verification.costCaps`): `maxCascadeRuns`/`maxJudgeCalls`/`maxJudgeTokens`
  por execução; cap esgotado → HALT sem judge (reason com contabilidade).
- **Degrade** (`verification.degrade`): `embeddingUnavailable` default `skip`
  (veredito degraded registrado — sem essa evidência não é violação);
  `grayZoneNoJudge` default `fail` (fail-closed: CI não certifica caso duvidoso
  sem judge — CLI exit 1).
- **Config**: seção aditiva `verification` do state.json (F13, schemaVersion 1) —
  sem arquivo novo; inválida → fail-closed (sessão bloqueia com motivo; CLI exit 3);
  `harness status` mostra a seção, `harness doctor` check 19 valida.
- **CLI `harness verify`**: exit codes 0 pass/skip/degraded · 1 fail · 2 halt ·
  3 config/infra; `--json` = `{ok, checks[], warnings[], verdict}` (shape do
  verify-gate do arcanum); escopo = working tree do repo (goal ativo via ledger
  F19 quando presente); judge nunca sem env (CI/merge gate F20 offline).
- **Vereditos de sessão**: gravados no log `.runecraft/verify-verdicts.jsonl`
  (append-only, precedente do ledger do glla — o Pi 0.81.0 não permite anotar
  tool_call que passa, validado no Execute: `ToolCallEventResult` = `{block, reason}`).

**Port verification-reminder/verify-gate (arcanum → F25, D12)**: a fonte real
foi recuperada do checkout `~/Projects/arcanum` (supersedido — AD-001):
`packages/guild/src/hooks/verification-reminder.ts` (prompt "Verification
Required": diff/checks/validação de comportamento/gate decision) e
`packages/guild/src/tools/verify-gate.ts` (runner de checks com timeout +
`{ok, checks[], warnings[]}`). O que era TEXTO DE PROMPT vira MECANISMO:

| Arcanum (guild, OpenCode) | F25 (harness, Pi) | Onde |
| --- | --- | --- |
| `verification-reminder` (prompt — "strong persistent prompt injection, not a kernel-level completion block") | Gate real: veredito + sugestão acionável estruturada; o conteúdo semântico do prompt (diff/checks/validação de comportamento/gate decision) vira `suggestions.ts` por camada | `src/verify/suggestions.ts` |
| `verify-gate` (tool com `{ok, checks[], warnings[]}`, exec com timeout) | Runner da camada 1 (structural) + shape do report do CLI `--json` | `src/verify/stages/structural.ts` + `src/commands/verify.ts` |
| (sem enforcement no OpenCode — aviso ignorável) | Bloqueio HARD via `{block:true}` em complete_goal (política halt) + cost caps → HALT | `src/verify/engine.ts` (D7/D8) |

## 8.7 Evals — framework de evals do harness (F26)

O harness tem um framework de evals portado do arcanum (sem tema RPG, zero
deps novas — AD-026): suites/cases/scenarios são **dados TS** sob
`test/eval/{suites,cases,scenarios}`; o runner in-process (`src/eval/`)
carrega (dynamic import), executa e avalia com evidência via `evalTest()`
(F21 — mesmo contrato dos fluxos da matriz). Referência completa:
`docs/EVAL-FRAMEWORK.md` (mapeamento arcanum→harness cobrindo TODOS os
arquivos do framework + tabela de dependência das 5 categorias).

| Conceito | O que é | Onde vive |
| --- | --- | --- |
| Suite | manifest TS (id/phase/caseFiles) | `test/eval/suites/*.ts` |
| Case | caso declarativo (target + executor + evaluators) | `test/eval/cases/*.ts` |
| Scenario | ScriptedScenario do fixture F21 (escolha fakeada, execução real) | `test/eval/scenarios/*.ts` |
| Evaluators | 8 determinísticos + trajectory-assertion + llm-judge (2 tiers) + baseline-diff | `src/eval/evaluators/` |
| Targets | prompt-render (renderRules F19) · single-turn-agent (sessão SDK) | `src/eval/targets/` |
| Evidência | `evalTest()` → `evidence/partial/*.jsonl` → `last-run.json` (F21) | `test/eval/evidence/` |

- **Constraint-adherence v1 (EVAL-014)** é a única categoria com cases hoje:
  os guards F24 (write-existing-file-guard, ranger-md-only) como sujeitos,
  com o trace REAL do transcript (trajectory-assertion + tool-policy) e o
  adversarial guard-off falhando com diagnóstico (desvio induzido — nunca
  passa em silêncio). Delta vs EVAL-006/007 documentado nos cases (D6 — sem
  double-test).
- **Categorias bloqueadas**: tool-use/routing (F32), compaction (F27),
  failover (F30) — sem entrada na matriz até os sujeitos existirem (política
  aditiva F21 D9); a tabela de dependência é o contrato (`docs/EVAL-FRAMEWORK.md` §5).
- **Judge LLM**: o llm-judge tem tier substring offline (sempre) + tier real
  SÓ com `RUNECRAFT_VERIFY_LLM_JUDGE=1` via `VerifyDeps.judgeAdapter` (F25) —
  nunca em CI (env off por construção).
- **Rodar**: `bun test test/eval` (lane F21/F24/F25 + framework) — offline/$0;
  o ratchet F23 (piso 14) cobre a evidência nova.

## 9. Appendix: injected text (golden)

The exact text injected by `renderRules(agentId)` (source of truth: design
F19 "Conteúdo dos templates (v1)" — D5/D6). The golden test asserts
`renderRules(agentId)` == the corresponding block below byte for byte;
divergence is red (D9). The markers are stable block delimiters; the text
between them is what the section engine injects (the `runecraft:workflow`
markers themselves are F15/F18 concerns).

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

## 10. Last verified

- **2026-08-05**: capability table (section 3) verified against the fork
  sources — pins subagents 0.37.2 · taskflow 0.2.6 · goal-loop-audit 0.28.34 ·
  pr-review 1.11.4 (AD-003). Contraindications marked *(derivado do roteamento
  — validar no Execute)* derive from routing, not from fork docs.
- **2026-08-06**: hello world (section 5) executed end to end (F7 COEX-05,
  PASS — real timings/tokens in `.specs/features/f7-coexistence-validation/
  scenarios.md`).
- **2026-08-07**: driver detection validated against the goal-loop-audit
  source — state ledger `.pi-glla/active.jsonl` and the supervision predicate
  `isSupervising` (goal `active` + autoContinue, or loop active).
- **2026-08-07**: Guards (section 8.5) verified against the pi SDK 0.81.0
  source — `tool_call` blocks via `{ block: true, reason }` (runner.js
  emitToolCall short-circuits); `turn_end`/`agent_end`/`agent_settled` handler
  results are IGNORED (only `session_before_*` cancels) → the todo enforcer
  hooks `complete_goal` (tool_call). glla tool names validated in the fork:
  no `todowrite`/`todoresolve` — `propose_task_list`/`update_task_status`/
  `complete_task`/`complete_goal`; ledger `.pi-glla/active.jsonl` (F24).
- **2026-08-08**: Verification (section 8.6) validated in the Execute F25 —
  `complete_goal` payload = `{completionSummary, verificationSummary,
  newObjective}` (fork goal.ts); handler de `tool_call` PODE ser async
  (runner awaits handlers); spec da sessão = objective do ledger (a glla
  limpa o texto no start — "Done when" vira verificationContract);
  `ToolCallEventResult` não permite anotar tool_call que passa (veredito
  skip/degraded vai para o log `.runecraft/verify-verdicts.jsonl`);
  auditor do glla reprova evidência que não cobre o contrato (approved
  genérico do fixture não serve para qualquer goal); diff do working tree
  exclui `.pi-glla/` e `.runecraft/` (bookkeeping do harness).
- **Revalidation checklist** (on fork bumps via F10, or new limitations found
  in F7/F22): table facts → section 3; injected text → section 9 +
  `WORKFLOW_RULES_VERSION` bump; hello world → new versioned entry
  (section 5).
