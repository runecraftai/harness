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
| **Copilot (VS Code)** | taskflow-MCP (`servers.taskflow` in `.vscode/mcp.json`) + workflow rules (`.github/copilot-instructions.md`) — repo-scoped (F31). Same limits; the injected rules are the shared non-Pi template (reuso F19). |
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

- **Constraint-adherence v1 (EVAL-014)** e **Compaction-recovery (F27,
  EVAL-017..021)** são as categorias com cases hoje: os guards F24
  (write-existing-file-guard, ranger-md-only) e a resiliência do F27 como
  sujeitos, com o trace REAL do transcript (trajectory-assertion +
  tool-policy) e o adversarial guard-off falhando com diagnóstico (desvio
  induzido — nunca passa em silêncio). Delta vs EVAL-006/007/014 documentado
  nos cases (D6 — sem double-test).
- **Categorias bloqueadas**: tool-use/routing (F32), failover (F30) — sem
  entrada na matriz até os sujeitos existirem (política aditiva F21 D9); a
  tabela de dependência é o contrato (`docs/EVAL-FRAMEWORK.md` §5).
- **Judge LLM**: o llm-judge tem tier substring offline (sempre) + tier real
  SÓ com `RUNECRAFT_VERIFY_LLM_JUDGE=1` via `VerifyDeps.judgeAdapter` (F25) —
  nunca em CI (env off por construção).
- **Rodar**: `bun test test/eval` (lane F21/F24/F25 + framework) — offline/$0;
  o ratchet F23 (piso 15) cobre a evidência nova.

## 8.8 Resilience & Continuity — camada de resiliência do harness (F27)

A camada de resiliência (M7, pilar 6 do doc do usuário) porta os hooks do
arcanum (compaction-recovery / compaction-todo-preserver / work-continuation
/ start-work-hook — supersedidos, AD-001) para MECANISMOS REAIS do Pi 0.81.0:

| Mecanismo | Existe (SDK 0.81.0 / fork glla / harness) — evidência | F27 constrói |
| --- | --- | --- |
| Evento de compactação | SDK: `session_before_compact`/`session_compact` no union de eventos (types.d.ts linhas 432/444) + `shouldCompact` puro (compaction.d.ts) | Trigger primário (D1) + fallback honesto `session_start reason=resume|reload` |
| Re-escrita de system prompt | SDK: `BeforeAgentStartEventResult.systemPrompt` encadeável (types.d.ts ~790; runner.js emitBeforeAgentStart re-passou currentSystemPrompt) | Continuation hook `src/extensions/resilience.ts` (D2) |
| Estado de goal/taskList | ledger glla `.pi-glla/active.jsonl` (F24 ✓; F19 isSupervising) | Fonte de verdade da continuação + `.runecraft/continuation.json` (D2/QA-1) |
| Tools de todos | glla `propose_task_list`/`update_task_status` (F24 ✓ — NÃO há todowrite) | Todo preserver (D3) |
| Sinais de stall | SDK: `turn_start{turnIndex,timestamp}`/`turn_end{toolResults}`/`agent_end`/`tool_call`/`agent_settled` + `ctx.isIdle()`/`hasPendingMessages()` (types.d.ts 224/232) | Entrada do detector (D4) |
| Maquinário de stall provado | glla: heartbeat/escalação, pending-latch watchdog, wedge alert, grace pós-compactação, extensionApiStale (loops/goal.ts) | Port puro em `src/resilience/stall.ts` (D4) |
| Repetição/output idêntico | glla `goal-loop-repetition.ts` (fingerprint sha256, Jaccard 0.8, toolResultRepeat 3) | Detector `repetition`/`identical-output` (D4) |
| Backoff | glla `goal-loop-backoff.ts` (stuck/error/context, hard cap 5min) | Ladder no detector/política (D4/D6) |
| Rate-limit/quota | glla `quota-retry.ts` `isQuotaError`/`parseQuotaError` | Reuso no classificador `src/resilience/classify.ts` (D5) |
| Política retry/skip/halt + orçamento | F25 `RETRY/SKIP/HALT` + `cost.ts` CostLedger | Política de escalação + budget (D6) |
| Sugestão acionável | F25 `suggestions.ts` | Classificador `suggestion` (D5) |
| Troca de modelo | F30 (model-resolution) — NÃO existe no F27 | Interface `FallbackAction.modelSwitch` NO-OP (D6 — fronteira explícita) |
| Planos markdown / workflow | F32/F33 — NÃO existem no F27 | Outline; F27 resume do ledger apenas |

**Operação**: a extensão `extensions/resilience.ts` (materializada nas sessões
gerenciadas do harness) observa compactação (`session_before_compact` →
snapshot do taskList; `session_compact` → grace 3min + continuação pendente),
`session_start reason=resume|reload` (fallback honesto — QA-2) e re-injeta o
prompt de continuação via `before_agent_start` (systemPrompt ENCADEADO —
nunca sobrescreve outras extensões). O detector de stall observa eventos reais
(`tool_call`/`tool_result`/`turn_end`/`agent_settled`) com limiares do fork
glla (configuráveis via state.json `resilience` — defaults fail-closed),
kill switch `RUNECRAFT_RESILIENCE=0`. Estado: ledger glla (goal/taskList) +
`.runecraft/continuation.json` (metadados do harness) + `.runecraft/
resilience-events.jsonl` (log append-only). Comando `/start-work` resume o
goal ativo explicitamente (restart/resume — nunca automático em startup).

**Fronteira F30 (travada — AD-027)**: `modelSwitch` é interface com
implementação NO-OP; o F27 NÃO resolve modelo (settings/modelRoles são do
runtime do Pi / F30). Invariante D7 (AD-024): a continuação re-injeta
pendências SÓ do ledger atual — nunca re-injeta task completa (teste
adversarial dedicado em `test/resilience/invariant.test.ts`).

**Atribuição (AD-002)**: os padrões de stall/backoff/quota são portes dos
mecanismos do fork goal-loop-audit (MIT, Copyright (c) 2026 dracon — nosso
fork AD-001); cada port cita o arquivo-fonte no código (constantes com os
valores exatos: HEARTBEAT_STALL_MS, WEDGE_ALERT_DEFAULT_MINUTES,
PENDING_LATCH_STUCK_MS, COMPACTION_GRACE_MS, DEFAULT_STALL_ESCALATION_REFIRES,
REPETITION.*, BACKOFF_HARD_CAP_MS).

## 8.9 Observability & Lessons — event store, bundles e lessons do harness (F28)

A camada de observabilidade (M7, pilar 7 do doc do usuário — "Eventos tipados
em event store auditável … exportável pra Langfuse/OTel") porta os hooks do
arcanum (context-window-monitor / session-token-state / analytics —
supersedidos, AD-001) para MECANISMOS REAIS do Pi 0.81.0 + taskflow:

| Mecanismo | Existe (SDK 0.81.0 / fork glla / taskflow / harness) — evidência | F28 constrói |
| --- | --- | --- |
| Escrita append-only best-effort | F25 `recordSessionVerdict` (try/catch, "nunca derruba o handler") ✓ | `src/observability/store.ts` (D1 — mesmo padrão + prevHash chain) |
| Logging sem stdout | F24 `guardLog` (stderr, `[runecraft:guards]`) ✓ | Reuso do guardLog (mesmo prefixo obs) |
| Estado por sessão | F27 `.runecraft/continuation.json` (schema v1, append/atomic) ✓ | `lessons.jsonl` (estado) + `events/` (append-only) |
| Contexto/tokens | taskflow `.pi/taskflows/runs/token-budget/*.json` (shape verificado) ✓; SDK `ctx.getContextUsage()` (`ContextUsage` tipado) ✓; `shouldCompact` puro ✓ | context-monitor + token-state (D4) + leitura read-only |
| Reescrita de system prompt | SDK `before_agent_start` → systemPrompt encadeado (types.d.ts "If multiple extensions return this, they are chained") ✓ | Injeção do adendo de lessons (D6 — marker `<!-- runecraft:lessons -->`) |
| Observação de bloqueio | SDK `tool_execution_end` (isError + reason no result.content — agent-loop.js `createErrorToolResult`) ✓; o `tool_call` NÃO expõe o block (runner.js short-circuit — validado no Execute) | `guard:blocked` live (D7a) |
| Fingerprint canônico | F23 sort/normalize (chaves ordenadas) ✓; F19 renderRules puro ✓ | `src/observability/bundle.ts` (D3) |
| Captura de lessons | Nenhum (novo domínio) | `src/observability/lessons.ts` (D5/D6) |
| Export | Nenhum (sinks fragmentados) | `src/observability/export.ts` + `docs/EVENTS.md` (D7/D8) |
| Memória de time | F29 (runes) — futuro | `promoted.jsonl` versionado (D5) — F29 consome |
| OTel/Langfuse SDK | Nenhum (zero deps travado) | Tabela de mapeamento em `docs/EVENTS.md`; implementação adiada (nota datada 2026-08-08) |

**Operação**: a extensão `extensions/observability.ts` (materializada nas
sessões gerenciadas do harness — manifest do package) grava eventos tipados em
`.runecraft/events/<sessionId>.jsonl` (header `session:started` com o bundle
full + prefixo 12 hex nos demais), observa bloqueios via `tool_execution_end`
(→ `guard:blocked` + lesson), monitora contexto (getContextUsage + token-
budget read-only) e injeta adendo de lessons via `before_agent_start` (trilhas
planning = promovidas no início; execution = lições do gate que falhou no
turno seguinte — chaining preservado). Lessons em `.runecraft/lessons.jsonl`
(estado, gitignored); promoção → `.runecraft/lessons/promoted.jsonl`
(VERSIONADO — memória de time). CLI: `harness events export --format jsonl
[--session <id>] [--include-external]` (determinístico + bridges) e `harness
lessons list|promote <id>|archive <id>`. Kill switch
`RUNECRAFT_OBSERVABILITY=0` (F20). O contrato do schema (kinds, fronteiras,
mapeamento OTel/Langfuse) vive em `docs/EVENTS.md` (OBS-09 — schema É o
contrato de F24/F25/F27).

## 8.10 Memory — memória persistente cross-session (F29)

A camada de memória (M7, pilar 7 do doc do usuário — "memória durável
consultável por tool") porta o pacote `runes` do arcanum (supersedido,
AD-001/AD-002) para MECANISMOS REAIS do Pi 0.81.0:

| Mecanismo | Existe (SDK 0.81.0 / runes / harness) — evidência | F29 constrói |
| --- | --- | --- |
| SQLite + FTS5 + WAL em Bun | `bun:sqlite` builtin (Bun 1.3.14) ✓ — probes: WAL `"wal"`, FTS5 diacríticos, schema real executa | `src/memory/client.ts` + `schema.sql` AS-IS (D1/D4) |
| Registro de tools Pi | `pi.registerTool(defineTool(...))` ✓ (fork glla goal.ts:2621+) | `src/memory/tools.ts` — 10 × `rune_*` (D3) |
| Extensão Pi do harness | `extensions/{guards,resilience,observability}.ts` + manifest `pi.extensions` ✓ | `extensions/memory.ts` (D3) |
| Config aditiva + freeze + kill switch | state.ts `guards`/`verification`/`resilience`/`observability` ✓ (F24 D12) | `src/memory/config.ts` seção `memory` (D5) |
| Fixture determinística | F21 ScriptedScenario + materialização de extensões ✓ | evals EVAL-030..038 (D11) |
| Memória de time versionada | F28 `lessons/promoted.jsonl` ✓ | bridge import-lessons (D7) |
| DRY relógio/id (determinismo) | F28 monitor injetável ✓ (F21 D10) | DI clock/idGen no Repository (D6) |
| CLI subcomando | dispatch F11 (install/verify/lessons...) ✓ | `harness memory` (D8) |
| Drift check FTS | `bin/runes.ts` doctor ✓ | `src/memory/cli.ts` doctor [--purge] (D8) |
| argsHash (privacidade) | F28 D2 (tool:call/result hashed) ✓ | garantia MEM-09 + EVAL-038 (D10) |

**Operação**: a extensão `extensions/memory.ts` (materializada nas sessões
gerenciadas — manifest do package) registra os 10 tools `rune_*` no
`session_start` (mesmo padrão do glla), com o DB local `.runecraft/memory/
runes.db` (WAL — o arquivo É a memória cross-session; D2 honesto:
`appendEntry` é log de sessão e não persiste). A skill `using-runes`
(manifest `pi.skills`) instrui o agente a chamar `rune_context` no início,
`rune_save` em decisão/correção, `rune_search` antes de agir, curadoria
top-10 por categoria e "não salvar secrets" (QA-2 — tool-driven, zero rewrite
de prompt). Bridge F28: `harness memory import-lessons` (idempotente,
`where_ref="lesson:<id>"`; fonte read-only — F28 dono; default
`importLessonsOnStart: false`). CLI: `harness memory search|stats|doctor
[--purge]|import-lessons`. Kill switch `RUNECRAFT_MEMORY=0` (F20 — camada
inerte, zero tools/arquivos). Config no state `memory` (freeze por sessão).
Referência completa: `docs/MEMORY.md`. Evals: EVAL-030..038 (matriz v7).

**Fronteira F28 (travada — D7)**: F28 é dono de `lessons/promoted.jsonl` e
events/; F29 importa read-only e idempotente (nunca reescreve a fonte, nunca
sobrescreve memória do usuário). F30 (model routing) e F33 (routing) NÃO são
tocados por F29.

## 8.11 Pi First-Class — persona, rules, model routing & SDD (F30)

O Pi agora é cidadão de primeira classe (M8, F30): persona + rules injetadas
na sessão via `before_agent_start` encadeado, roteamento de modelo por agente
(pi/opencode/claude/codex), modelSwitch do F27 implementado, geração de
models.json e assets SDD versionados. Referência completa: `docs/PI.md`.

| Mecanismo | Existe (SDK 0.81.0 / harness) — evidência | F30 constrói |
| --- | --- | --- |
| before_agent_start chaining | resilience.ts:216 + observability.ts:359 (append + markers) ✓ | `extensions/persona.ts` (D1) |
| Regras do Pi | `renderRules("pi")` = PI_RULES (rulesContent.ts:26, golden F19) ✓ | `src/persona/rules.ts` (reuso read-only) |
| Variante por sessão | SDK session_start reason (F27: resume/reload) ✓ | `src/persona/first-message.ts` (port) |
| Model resolution | NENHUM no harness (só no guild) | `src/models/resolution.ts` (D4) |
| Model switch | F27 FallbackActionKind.modelSwitch NO-OP (types.ts:115) ✓ | `src/models/switch.ts` (D6) |
| Registry de modelos | `ModelRuntime.create({modelsPath})` + getModel (F21/AD-021) ✓ | `src/models/registry.ts` (path real validado) |
| models.json fixture | `renderModelsJson(port)` (test/eval/layer2/fixture) ✓ | evals EVAL-042/043 (D10) |
| Estado aditivo + kill switch | state.ts schemaVersion 1 (AD-013); RUNECRAFT_*_0 ✓ | seções `models`+`persona` (D5) |
| Chains | `.pi/chains/*.chain.md` + discoverAgentsAll (fork subagents) ✓ | `assets/sdd/chains/sdd-*.chain.md` (D8) |
| CLI subcomando | dispatch F11 (install/verify/lessons/memory...) ✓ | `harness models|sdd|plans` (D7/D8/D9) |
| Eval framework | F26 runner/evaluators + EVAL-MATRIX ✓ | suite pi.ts EVAL-039..048 (D10) |

**Operação**: a extensão `extensions/persona.ts` (materializada nas sessões
gerenciadas — manifest do package) injeta persona + PI_RULES (markers
`<!-- runecraft:persona -->` / `<!-- runecraft:rules -->`) no
`before_agent_start` ENCADEADO (append — ordem de registro = ordem de
append; EVAL-040) e aplica a variante de primeira mensagem UMA vez por
sessão inicial (reason resume|reload → sem variante — F27 dono da
continuação). Kill switches `RUNECRAFT_PERSONA=0` / `RUNECRAFT_MODELS=0`
(F20). Config `persona`/`models` aditivas no state (freeze por sessão — F24
D12; inválida → defaults + reporte — fail-closed F24 D10). Resolução de
modelo por agente com precedência override → custom chain > builtin →
systemDefault → null + warn (nada inventado — D4). `harness models
generate` (determinístico, 2 runs byte-idênticos) + `harness models
list|doctor` + seção Models no status + check 20 no doctor. SDD:
`harness sdd new|chains` + `harness plans archive` (`.runecraft/plans/`).
Evals: EVAL-039..048 (matriz v8 — categoria failover desbloqueada no F26).

**Fronteiras (D11)**: F27 dono da interface modelSwitch (F30 implementa em
`src/models/switch.ts` — zero mudanças em src/resilience/); F19 dono de
PI_RULES (F30 reusa read-only); F28/F27 donos de continuation/lessons (a
persona só anexa); F31 independente; F32 consome o config `models`.

## 8.12 Copilot (VS Code) — adapter do harness (F31)

O Copilot (VS Code) é o 5º agente do M8 (AD-022 decisão 8) com adapter no
padrão F15 (`harness install --agent copilot`; aliases `vscode`/
`vscode-copilot`/`github-copilot` — a nomenclatura do gentle-ai é aceita
como alias, sem adotar o id). Alvos **repo-scoped** (workspace = cwd — QA-4):

| Alvo | Arquivo | Conteúdo gerenciado |
| --- | --- | --- |
| Regras | `.github/copilot-instructions.md` | seção `runecraft:workflow` (marcadores html F18) — conteúdo = `renderRules("copilot")` = o template não-Pi do F19 (reuso read-only, zero texto novo) |
| MCP | `.vscode/mcp.json` | entry `servers.taskflow` — schema VS Code `{type: "stdio", command, args?, env?}` (sem `${input:...}` — o Agent Host não lê o arquivo diretamente: o VS Code repassa os servers) |

**Host MCP reusado (QA-2/D4):** o servidor é o `@runecraft/taskflow-claude`
(stdio genérico — `resolveMcpBin("claude")`; env > dev fork > npx pin com
guard anti-upstream). **NUNCA `@runecraft/taskflow-copilot`** (não existe nos
packages taskflow — fabricação fora de escopo). Alternativa user-level
documentada: `~/.copilot/mcp-config.json` (lido nativamente pelo Agent Host)
— fora do default (escopo repo-level do harness).

**Detecção (D6):** bin `code`/`code-insiders` no PATH **OU** dirs de extensão
`github.copilot*`/`github.copilot-chat*` sob `~/.vscode*/extensions` (a
extensão é o sinal real — o CLI `code` nem sempre está no PATH). Ausente →
install recusa **fail-closed display-only** (zero writes) com hint; status e
doctor (check 21) reportam detect-only informativo — o harness nunca instala
runtimes.

**Matriz (D8):** coluna copilot = taskflow-MCP + rules + 4 células
`unsupported` (subagents/goal-loop-audit/pr-review/guards — "é extensão Pi;
use --agent pi"; guards sem enforcement em agentes não-Pi — F24).

**Two-driver com o gentle-ai (D10):** o gentle-ai gerencia o Copilot em
**user-level** (`~/.copilot/...`, legado `~/.github/copilot-instructions.md`
na HOME — auto-removido por versões novas do gentle-ai; persona do VS Code
via `SystemPromptFile(homeDir)`). O harness F31 é **repo-level** — **sem
colisão de path**, mas com sobreposição SEMÂNTICA: o VS Code fornece ambos os
conjuntos ao modelo (prioridade personal > repo). O `owners.ts` detecta o
state `~/.gentle-ai/state.json` + marcadores `<!-- gentle-ai:` e o install com
colisão exige `--yes` (gate MXST-04); conteúdo do usuário em
`.github/copilot-instructions.md`/`.vscode/mcp.json` é sempre preservado e
reportado — o harness nunca remove/reescreve nada alheio.

**Governança:** goldens `mcp-copilot.golden` (arquivo mcp.json COMPLETO —
desvio documentado do F23 D4: nesting 2 níveis `servers.taskflow`); evals
EVAL-049..056 (matriz v9); F19 dono do conteúdo das regras (`renderRules`
intocado — copilot recebe o NON_PI_RULES existente).

## 8.13 Objective Role Agents — papéis objetivos do harness (F32)

O harness entrega 7 papéis profissionais objetivos como **agentes-dados**
(`agents/*.md` versionados no pacote → materializados em `<cwd>/.pi/agents/`
via `harness install/sync` — escopo projeto, QA-2a). O fork `@runecraft/subagents`
descobre `.pi/agents/*.md` nativamente (`resolveNearestProjectAgentDirs` +
`loadAgentsFromDir` — agents.ts) e o arquivo de escopo projeto **shadowa** o
builtin homônimo (`mergeAgentsForScope` — projeto > builtin). Agentes são
DADOS: extensíveis por construção (qualquer `.md` novo no dir é descoberto) e
editáveis pelo usuário (o sync faz three-way por conteúdo — F19 D7: edição
preservada, nunca auto-cura). Zero tema de fantasia (decisão 2 — deny-list nos
evals).

### Os 7 papéis (D3 — allowlist fail-closed: o que não está na lista não existe)

| Papel | Identidade | Tools (allowlist) | Constraints | Delegação |
| --- | --- | --- | --- | --- |
| planner | planos apenas, 2 modos (interactive/automatic), clarificação por escopo, NUNCA implementa | read, grep, find, ls, intercom | read-only; `acceptanceRole: read-only`; `output: plan.md` (persistido pelo runtime) | nunca |
| builder | executa o plano, verifica antes de reportar; único papel escritor | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | writer; `defaultReads: plan.md` | ÚNICO papel com `subagent` (QA-5a): spawna scout (recon) + reviewer (verificação) |
| reviewer | veredito `[APPROVE]/[REJECT]` + resumo + ≤3 blocking issues, approval bias; plan review + work review | read, grep, find, ls, bash, intercom | read-only (SEM edit/write — endurecido vs builtin); in-loop | nunca |
| auditor | auditoria de conformidade; write restrito a `.md` (guard F24) | read, grep, find, ls, bash, write, intercom | md-only (default `guards.rangerMdOnly.mdOnlyAgents=[auditor]` — D7) | nunca |
| scout | recon de codebase, reporta no retorno | read, grep, find, ls, intercom | read-only; `output: context.md` | nunca |
| researcher | pesquisa externa, cita fontes | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | read-only; `output: research.md` | nunca |
| security | revisão de segurança/conformidade, triage + fast-exit, classes de vulnerabilidade | read, grep, find, ls, bash, intercom | read-only; veredito estruturado | nunca |

### Mapeamento honesto builtin ↔ papel (D2 — QA-1)

| Papel objetivo | Builtin do fork | Relação |
| --- | --- | --- |
| planner | planner | **shadow compatível** — o builtin já era read-only com `output: plan.md` sem tool write |
| reviewer | reviewer | **shadow endurecido** — o builtin tinha edit/write; o papel remove (allowlist read-only ENFORÇA o que os fluxos do fork já pedem por instrução — "Reviewers must not edit files") |
| scout | scout | **shadow endurecido** — o builtin tinha bash/write; o papel remove (`output: context.md` persistido pelo runtime) |
| researcher | researcher | **shadow endurecido** — o builtin tinha write; o papel remove (`output: research.md`) |
| builder | — | **novo** (sem builtin homônimo; papel escritor — semântica extraída do default.ts do arcanum) |
| auditor | — | **novo** (AD-022 decisão 3: papel de auditoria; guard md-only assina o papel) |
| security | — | **novo** (revisão de segurança — semântica extraída do default.ts do arcanum) |
| worker/oracle/advisor/context-builder/delegate | — | **preservados** (sem contraparte objetiva — fluxos genéricos do fork continuam) |

Artefatos `output:` (plan.md/context.md/research.md) são **persistidos pelo
runtime do fork**, não pelo agente (single-output.ts: agente sem tool de
mutação → "Return the complete artifact… The runtime will persist it").

### Delegação (D5 — QA-5a)

O mecanismo de spawn do planejador do arcanum (spawn-wizard) vira um
**template renderizado**
(`src/agents/delegation.ts` — `renderDelegationPrompt`): instrui o delegador a
usar a tool `subagent` (F2 — a delegação observada no F28) com `agent:
"<papel>"` e lista os alvos válidos (`buildKeyTriggersSection` — D4). Política
v1: **só o builder spawna** (scout + reviewer); os demais papéis NÃO têm a
tool `subagent` no allowlist (fail-closed — não spawnam; espelho da política
de spawn do planejador do arcanum: o planejador nunca spawna). A orquestração
codificada (keyword-detector) é o F33 — consumindo estes papéis por dados
(outline).

### Composição de review (D6)

O reviewer é um agente **read-only in-loop** (veredito `[APPROVE]/[REJECT]` +
≤3 blocking issues). O fluxo de review de PR continua com o **pr-review (F5)**
+ **receipts (F20)** — fronteira explícita (loop tools do pr-review são gated
fora de `/pr-review` ativo — F21 AD-021; o reviewer NÃO é wrapper). Variantes
de modelo do reviewer (`review_models` → `reviewer-review-<key>`) são
**interface de dados F30** (`models.agents.reviewer.review_models` /
`models.agents.security.review_models`) — fan-out/collation permanece no fork
pr-review.

### Modelos (D8 — QA-4a)

Os 7 ids de papel são ids válidos de `state.models.agents.<id>.fallbackChain`
(F30 D5/D11) — **nenhum chain default no código** (F30 D4: zero IDs
inventados; modelos vêm do models.json do SDK via `harness models generate`).
Exemplo de config do USUÁRIO com a semântica de classes do arcanum
(AGENT_MODEL_REQUIREMENTS — lido no Execute; NUNCA default):

```jsonc
{ "models": { "agents": {
  "planner":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "pesado-1" }] },
  "researcher":{ "fallbackChain": [{ "providers": ["provider-a"], "model": "pesado-1" }] },
  "security":  { "fallbackChain": [{ "providers": ["provider-a"], "model": "pesado-1" }] },
  "builder":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "leve-1" }] },
  "scout":     { "fallbackChain": [{ "providers": ["provider-a"], "model": "leve-1" }] },
  "reviewer":  { "fallbackChain": [{ "providers": ["provider-a"], "model": "medio-1" }] },
  "auditor":   { "fallbackChain": [{ "providers": ["provider-a"], "model": "medio-1" }] }
} } }
```

(pesado = planner/researcher/security · leve = builder/scout · médio =
reviewer/auditor — semântica extraída do arcanum.)

### Fronteiras (D10)

- **F24** é o dono do guard `rangerMdOnly` — F32 muda só o **default de
  config** (`mdOnlyAgents += "auditor"` em guardKit.ts); o guard fica INTOCADO.
- **F30** é o dono de `src/models/` — F32 consome por contrato de ids.
- **F33** é o dono da orquestração codificada — F32 entrega agentes +
  templates (outline).
- **F19** é o dono do renderRules — F32 não toca `rulesContent.ts`.
- **F5/F20** donos do review de PR/receipts — o reviewer é in-loop.
- Fork subagents consumido READ-ONLY (zero mudança).
- Identidade: o fork seta `PI_SUBAGENT_CHILD_AGENT` (não `RUNECRAFT_AGENT_ID`)
  — a bridge documentada (adendo before_agent_start do F28,
  `src/agents/identity.ts`) traduz a identidade do child para o env que o
  guard lê (validado no Execute F32).

Evals: EVAL-057..066 (matriz v10 — categorias tool-use correctness e routing
completeness desbloqueadas).

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
- **2026-08-08**: Resilience (section 8.8) verified in the Execute F27 —
  `session_before_compact`/`session_compact`/`before_agent_start`/
  `session_start{reason}`/`ctx.isIdle()`/`hasPendingMessages()` no SDK
  0.81.0 (types.d.ts); `BeforeAgentStartEventResult.systemPrompt` chained
  (runner.js emitBeforeAgentStart); `createAgentSession` aceita
  `sessionStartEvent` (reason=resume simula o fallback honesto QA-2);
  glla v0.28.34 restore gate HOLDs goals ativos no session load (não
  auto-resume por default) → F27 injeta só quando o goal segue ativo
  (autoresume=on) ou após session_compact mid-session; limitação honesta:
  emissão real de `session_compact` no fixture não viável (QA-5 — handler
  exportado com eventos scriptados cobre o trigger; evals usam evento
  sintético, sem fabricação).
- **2026-08-08**: Observability (section 8.9) verified in the Execute F28 —
  `ContextEvent` = só messages (sem tokens): a fonte de contexto é a API
  tipada `ctx.getContextUsage()` (`ContextUsage {tokens, contextWindow,
  percent}` — types.d.ts do pi-coding-agent) + token-budget do taskflow
  (shape real: `phases` OBJECT keyed com `usage{input,output,cacheRead,
  cacheWrite,cost,contextTokens,turns}`) + `shouldCompact` puro; o resultado
  do `tool_call` NÃO expõe o block F24 (runner.js short-circuit no primeiro
  `{block:true}`) e chamadas bloqueadas NÃO emitem `tool_result` (agent-loop
  pula afterToolCall p/ resultados imediatos) — a observação real é o
  `tool_execution_end` (isError + reason `<guardId>: msg` no result.content);
  `before_agent_start` é por prompt do usuário (o adendo execution entra no
  próximo before_agent_start); `session_end` não existe no SDK 0.81.0 — o
  fechamento usa `agent_end` + `session_shutdown` (idempotente).
- **2026-08-09**: Memory (section 8.10) verified in the Execute F29 —
  `defineTool` usa `parameters` TypeBox (`TParams extends TSchema` — types.d.ts
  do pi-coding-agent; TypeBox já é peerDep do harness e usado pelo fork glla:
  zero deps novas); `ExtensionContext.cwd` é a fonte do diretório do repo
  (registro das tools no `session_start` — síncrono, padrão glla, sem race no
  primeiro request); bun:sqlite (Bun 1.3.14) executa o schema.sql REAL do runes
  (WAL, FTS5 diacríticos, triggers real-table→FTS5); o argsHash do F28 é
  sha256 prefixo 16 hex (nunca args crus — EVAL-038 asserta o sentinel ausente
  do event store); `PRAGMA busy_timeout` do bun:sqlite expõe a coluna
  `timeout` (não `busy_timeout`).
- **2026-08-10**: Copilot (F31, section 8.12) — adapter repo-scoped do 5º
  agente M8: rules `.github/copilot-instructions.md` (marker `runecraft:workflow`;
  conteúdo = NON_PI_RULES do F19 — reuso read-only), MCP `.vscode/mcp.json`
  `servers.taskflow` (schema VS Code verificado — `type: "stdio"` + command;
  sem `${input:...}`: o Agent Host NÃO lê o arquivo — o VS Code repassa),
  host MCP reusado `@runecraft/taskflow-claude` (QA-2 — nunca inventar
  `taskflow-copilot`), detecção bin `code`/`code-insiders` OU extensão
  `github.copilot*` (fail-closed display-only), two-driver gentle-ai
  user-level × repo-level (sobreposição SEMÂNTICA — owners + gate MXST-04),
  coluna na matriz (mcp+rules + 4 unsupported Pi-only), doctor check 21,
  golden `mcp-copilot.golden` + EVAL-049..056 (matriz v9).
- **2026-08-12**: Role agents (F32, section 8.13) verified in the Execute —
  fork subagents descobre `.pi/agents/*.md` nativamente (`loadAgentsFromDir`
  agents.ts:1306; `resolveNearestProjectAgentDirs` agents.ts:1493; shadowing
  projeto > builtin via `mergeAgentsForScope` agent-selection.ts); frontmatter
  aceito = flat `key: value` (parseFrontmatter frontmatter.ts); tools
  observadas nos builtins = `read,grep,find,ls,bash,edit,write,intercom,
  contact_supervisor,web_search,fetch_content,get_search_content` + `subagent`
  (review-loop.md) — `glob` NÃO é tool do fork; `output:` é persistido pelo
  runtime para agentes sem tool de mutação (single-output.ts
  formatOutputPathInstruction); o fork NÃO seta `RUNECRAFT_AGENT_ID` por
  dispatch (seta `PI_SUBAGENT_CHILD_AGENT` — pi-args.ts:26/354) → bridge
  documentada no design (adendo before_agent_start do F28 —
  src/agents/identity.ts) SEM tocar o guard; `contact_supervisor` é
  bridge-gated (não registrado em sessão sem canal de supervisor — fora do
  tool-policy do EVAL-060); o default `guards.rangerMdOnly.mdOnlyAgents`
  agora é `["auditor"]` (D7 — guard intocado); EVAL-057..066 (matriz v10).
- **Revalidation checklist** (on fork bumps via F10, or new limitations found
  in F7/F22): table facts → section 3; injected text → section 9 +
  `WORKFLOW_RULES_VERSION` bump; hello world → new versioned entry
  (section 5).
