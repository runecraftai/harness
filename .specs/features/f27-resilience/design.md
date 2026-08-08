# F27 Design — Resilience & Continuity

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-027)
**Decisões aprovadas (usuário/briefing, travadas):** pilar 6 do doc do usuário (stall ≠ só timeout/rate-limit; fallback chain multi-trigger; escalação parar-tudo/pular-e-seguir; classificação agente-vs-infra) · zero deps novas · offline/$0 · escopo packages/harness · fronteira F30 (model switching) explícita · EVAL-MATRIX aditivo v5 com notas datadas (F21 D9) · evidência via evalTest (F21) · nada sai sem AD · mecanismos citados EXISTEM no SDK 0.81.0 ou no fork (evidência abaixo) · llm-judge/env-gated NÃO usado (tudo determinístico offline)

## Contexto

F21 entregou a infra determinística (fixture OpenAI-wire, ScriptedScenario, evalTest → evidência, EVAL-MATRIX). F24 entregou os guards (`src/guards/`) com bloqueio real de `tool_call`, enforcer de `complete_goal`, ledger do glla `.pi-glla/active.jsonl` como estado de goal (goal.taskList v1) e **achados críticos**: glla NÃO tem `todowrite`/`todoresolve` — tools reais `propose_task_list`/`update_task_status`/`complete_task`/`complete_goal`; `turn_end`/`agent_end` NÃO bloqueiam (só `tool_call`); identidade de agente via `RUNECRAFT_AGENT_ID`; AD-024 (stale taskList → phantom-block). F25 entregou RETRY/SKIP/HALT + CostLedger (`src/verify/cost.ts`) + padrão de sugestões (`suggestions.ts`). F19 entregou o sessionDriver lendo o ledger com o predicado `isSupervising` do fork. F26 entregou o framework eval (`src/eval/`) com a tabela de dependência marcando compaction-recovery como **bloqueada até F27**.

**Fonte do port — arcanum (`packages/guild/src/hooks/`, lido na íntegra):** `compaction-recovery.ts` (recovery em 3 camadas por execution-lease: workflow-owned → plan-owned → identity-only, com heal de ownership e switchAgent), `compaction-todo-preserver.ts` (snapshot/restore de todos via `client.session.todo` — API OpenCode, inexistente no Pi), `work-continuation.ts` (CONTINUATION_MARKER `<!-- guild:continuation -->`, progresso do plano, scoping de sessão, **detecção de progresso estagnado — MAX_STALE_CONTINUATIONS=3 com auto-pause** — precursor do stall), `start-work-hook.ts` (comando `/start-work` → valida plano → cria/resume execution → context injection). Eram hooks de prompt-injection no OpenCode; o port ao Pi usa MECANISMOS REAIS.

**Evidência no SDK 0.81.0 (verificada em `packages/harness/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`):**
1. Eventos de compactação NO UNION DE EVENTOS: `SessionBeforeCompactEvent { type: "session_before_compact" }` e `SessionCompactEvent { type: "session_compact" }` (grep: linhas 52–53 e 64–65 da janela 380–700) — **o Pi EMITE compactação**; não há evento inventado.
2. `ContextEvent { type: "context" }` (mesma janela, linha 110) — candidato a fallback/monitor de janela de contexto; **shape exato a validar no Execute**.
3. `BeforeAgentStartEventResult { message?, systemPrompt? }` — doc: "Replace the system prompt for this turn. If multiple extensions return this, they are chained." (linha 790) — **re-escrita encadeável de system prompt verificada** (confirmado também no handoff guild→pi: "before_agent_start reescreve o system prompt (encadeável)").
4. `SessionStartEvent { reason: "startup" | "reload" | "new" | "resume" | "fork", previousSessionFile? }` — trigger de continuação para sessão resumida.
5. Sinais de stall observáveis: `turn_start { turnIndex, timestamp }`, `turn_end { turnIndex, message, toolResults }`, `agent_end { messages }`, `agent_settled` ("no automatic retry, compaction, or queued continuation will run"), `tool_call` (com resultado bloqueável — F24), `tool_execution_start`.
6. `dist/core/compaction/compaction.d.ts`: `shouldCompact(contextTokens, contextWindow, settings)`, `CompactionSettings`/`DEFAULT_COMPACTION_SETTINGS`, `CompactionResult`/`CompactionDetails` — lógica de compactação é função pura; "The session manager handles I/O, and after compaction the session is reloaded" — **o session manager recarrega a sessão = `session_start reason=reload`** (cadeia de fallback do trigger).

**Evidência no fork do glla (`packages/goal-loop-audit/extensions/`):**
7. `loops/goal.ts`: **maquinário de stall provado em campo** — heartbeat refire (`HEARTBEAT_STALL_MS`, `consecutiveStalls`, `stallEscalationRefires` → `escalateStallNow` = parada ruidosa), pending-latch watchdog (`PENDING_LATCH_STUCK_MS` — "pi's pending-message latch appears stuck (known post-compaction failure)"), wedge alert (`WEDGE_ALERT_DEFAULT_MINUTES` — sessão OCUPADA + silêncio = comando pendurado), post-compaction grace (`COMPACTION_GRACE_MS = 3 * 60_000`), `extensionApiStale` (handle invalidado pós-compactação — "compaction triggers it in pi 0.82.x"), eventos no ledger (`pending_latch_stuck`, `wedge_alert`, `heartbeat_refire`), `completionAuditInFlight` (stall quieto durante audit).
8. `goal-loop-repetition.ts`: detectores puros — `textFingerprint` (sha256, normalização ANSI/whitespace), Jaccard ≥ 0.8, `toolResultRepeat = 3` (últimos N resultados idênticos de tool = sem informação nova), `toollessIterations = 2`, degenerados (frase/palavra repetida), escada `hardResetAfter = 3` / `maxInterventions = 5`.
9. `goal-loop-backoff.ts`: `backoffMs(stuckCount, mode: stuck|error|context)` — caps (hard 5min; error 5s→60s exponencial; context 30s×n), `shouldPauseAfterBackoff` (stuck ≥ 5min OU ≥ 3 iterações ociosas).
10. `quota-retry.ts`: `isQuotaError` (`/429|quota|rate.?limit|temporarily|credits?|key limit exceeded|insufficient.?balance|too many requests/i`), `parseQuotaError` (Retry-After / prosa; default 3600s) — **classificação infra de rate-limit pronta para reuso**.

**Taskflow:** `core/src/resources/backend.ts` e `runtime/phases/{reduce,race}.ts` mencionam token-budget/resume (grep por arquivo) — candidato a monitor de janela de contexto (QA-2b); **detalhes não verificados — validar no Execute** se escolhido.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Trigger de compactação = eventos nativos** (RES-01): primário `session_compact`/`session_before_compact` (types.d.ts ✓); captura de snapshot no `session_before_compact` (taskList + estado de continuação); ação de continuação após `session_compact`/`session_start reason=reload|resume`. Fallback honesto se o evento não disparar no runtime real: `context` event (shape a validar) e/ou `session_start reason=resume` (a recarga pós-compactação é documentada no módulo compaction do SDK). Monitor de janela de contexto via taskflow token-budget NÃO é primário (detalhes não verificados) | O Pi JÁ emite compactação (evidência 1/6); regra do briefing: "se o SDK tem o evento, não inventar" — a limitação (se `session_compact` não disparar em produção) é documentada e o fallback cobre. Sem evento inventado |
| D2 | **Continuação = before_agent_start rewrite + ledger glla + `.runecraft/continuation.json`** (RES-02, QA-1 recomendado): fonte de verdade de goal/taskList = ledger (F19/F24); metadados do harness (work summary, contadores de continuação/stall, snapshot de progresso p/ preserver) = arquivo novo `.runecraft/continuation.json` (schema v1, append/atomic — padrão F20). Builder PURO `buildContinuationPrompt(state) → string | null` com marker `<!-- runecraft:continuation -->`, goal, progresso `completed/total`, diretório, instruções determinísticas (restaurar todos via `propose_task_list`; continuar da primeira tarefa não checada; nunca re-executar completas; `complete_goal` só com tudo checado). Scoping de sessão herdado do work-continuation do arcanum (última session_id do ledger). Camada 1 do recovery do arcanum (workflow-owned) fica outline — sem workflow no harness pré-F33 | (1) antes_agent_start é o mecanismo REAL verificado (evidência 3, encadeável); (2) ledger já é o estado de goal (F24) — duplicar em state.json do F13 criaria dois donos; (3) arquivo próprio isola metadados de continuação do schema do F13 (aditivo, sem migração). Determinismo offline: builder é função pura testada |
| D3 | **Todo preserver = tools glla + ledger** (RES-03): snapshot do `goal.taskList` no `session_before_compact` (lido do ledger — fonte única, não API); restauração via `propose_task_list`/`update_task_status` (tools REAIS do glla — F24) se a taskList sumir pós-compactação; no-op se sobreviveu (semântica do arcanum: "todos survived compaction, skipping restore"). Sem API OpenCode (`client.session.todo` — não existe no Pi) | F24 provou o shape real das tools; o arcanum lia a API do OpenCode (não portável) — o equivalente Pi é o par ledger+tools. Restauração idempotente e não-competitiva com o enforcer (RES-07) |
| D4 | **Stall detector = port PURO dos padrões do glla + eventos SDK** (RES-04, QA-4 recomendado): `src/resilience/stall.ts` com detectores determinísticos — `repetition` (mesma tool + args normalizados ≥ N; output hash igual; fingerprint/Jaccard — padrão goal-loop-repetition), `wedge` (sessão ocupada + silêncio > limiar — padrão wedge alert), `heartbeat` (ociosa sem progresso > limiar → refire com escada de stall — padrão heartbeat/escalation), backoff ladder (`backoffMs` padrão). Relógio e timestamps INJETÁVEIS (determinismo); observa eventos reais do SDK (tool_call, turn_start/turn_end timestamps, agent_end, ctx.isIdle/hasPendingMessages — API de contexto). Stall suppression herdada: audit-in-flight e pós-compactação grace (padrões do fork — não reimplementar) | O fork é nosso (AD-001) e o maquinário é PROVADO EM CAMPO (evidência 7–9) — portar como módulos puros com atribuição (LICENSE-THIRD-PARTY AD-002 quando copiar trechos) evita reinventar e mantém o determinismo offline. Limiares configuráveis (config RES-09) com defaults = os do fork |
| D5 | **Classificação agente-vs-infra = puro + sugestão** (RES-05): `src/resilience/classify.ts` — inputs (exit code, erro de tool, timeout — padrão AD-024 SIGTERM/SIGKILL, rate-limit via `isQuotaError` do glla, stall signals, repetição); saída `{ class: "agent" | "infra" | "unknown", reason, suggestion }` com sugestão acionável no formato `suggestions.ts` do F25. infra → retry/fallback/backoff; agent → re-inject/pause/halt; unknown → fail-closed (HALT com reason) | Determinístico (zero LLM — F27 não usa judge); reuso dos padrões existentes (F25 suggestions, glla quota) sem duplicação |
| D6 | **Fallback chain = MECANISMO; model switching = F30** (RES-06, QA-3 recomendado): `src/resilience/fallback.ts` — engine de política multi-trigger (rate-limit + timeout + stall + falha repetida); política de escalação `stop-all` (HALT com reason — padrão F25) vs `skip-and-continue` (SKIP + veredito no log — padrão F25); orçamento de escalação reusando padrões do CostLedger F25; ações reais no F27: `retry`, `re-inject-continuation` (D2), `pause`, `halt`; ação `modelSwitch` = INTERFACE (`FallbackAction`), implementação NO-OP documentada — F30 (model-resolution) implementa. CLI-level retry com env de modelo NÃO implementado agora: duplica o domínio do F30 (resolução de modelo é do F30; settings/modelRoles é runtime do Pi) | Briefing: "o gatilho importa tanto quanto a chain" — F27 entrega os gatilhos e a política; a cadeia leve→forte→humano é resolução de modelo (F30). Fronteira explícita evita replanejamento; F33 já depende de "fallback chains (F27)" para orquestração |
| D7 | **Invariante F24 = teste dedicado** (RES-07): continuação deriva pendentes SÓ do ledger ATUAL (goal.taskList v1); re-injeção de tarefa já completada → teste vermelho com diagnóstico; regressão AD-024 coberta por teste (stale taskList de goal anterior não bloqueia nem é re-injetada); taskList re-injetada respeita formato v1 (todo-continuation-enforcer F24 sem drift) | AD-024 é o modo de falha real (phantom-block deadlock); a re-injeção do F27 é exatamente o vetor — invariante vira acceptance criteria e teste de regressão |
| D8 | **Evals = EVAL-017..021 framework-driven** (RES-08, QA-5 recomendado): suite `test/eval/suites/compaction-recovery.ts` (formato F26) — casos: EVAL-017 continuation builder (puro; goal 3/5 → prompt contém marker/progresso/próxima; determinismo), EVAL-018 todo-preserver (scripted propose_task_list → wipe → restore; sobreviveu → no-op), EVAL-019 stall (ScriptedScenario replaya chamadas idênticas → detector dispara ≤ N turnos), EVAL-020 classify+fallback (unit multi-trigger/stop-all/skip-and-continue/orçamento), EVAL-021 fluxo completo (goal ativo → compactação scriptada (QA-5) → continuação re-injeta → agente completa → complete_goal verde — invariante RES-07 no fluxo). Viabilidade de emitir `session_compact` real no fixture: **validar no Execute**; fallback: handler exportado invocado com evento sintético (determinístico offline) | F26 prometeu a categoria após F27 (tabela de dependência); fixture F21 prova o padrão (EVAL-006/007); sem duplicação (delta documentado no case) |
| D9 | **Config + kill switch** (RES-09): thresholds de stall/backoff/política de escalação via state schema v1 ADITIVO (F13) sob `resilience` (padrão `guards`/`verification` do F24/F25 — freeze por sessão); kill switch `RUNECRAFT_RESILIENCE=0`; docs: tabela de mecanismos (SDK/fork → F27) + seção no ROUTING.md; testes offline/$0 na lane F21 | Padrão da casa (F24/F25 config aditiva + kill switch + freeze); zero deps novas; determinismo por construção |

## Arquitetura — módulos

```
packages/harness/
├── src/resilience/
│   ├── index.ts              # exports públicos
│   ├── types.ts              # CompactionPhase, ContinuationState, StallSignal, FailureClass, FallbackPolicy, FallbackAction (modelSwitch = interface)
│   ├── config.ts             # thresholds (stall/backoff/escalação) + kill switch RUNECRAFT_RESILIENCE=0; schema v1 aditivo no state (D9)
│   ├── continuation.ts       # PURO: readGoalState(ledger) → ContinuationState → buildContinuationPrompt(state) → string|null (marker, progresso, scoping de sessão, invariante D7) (D2)
│   ├── todo-preserver.ts     # snapshot(taskList) no session_before_compact; restore via propose_task_list/update_task_status; no-op se sobreviveu (D3)
│   ├── stall.ts              # PURO: detectStall(trace, clock, thresholds) → StallSignal[] — repetition/identical-output/wedge/heartbeat + backoff ladder (D4)
│   ├── classify.ts           # PURO: classifyFailure(input) → { class, reason, suggestion } (D5)
│   └── fallback.ts           # engine: trigger → policy (stop-all|skip-and-continue) → actions (retry/re-inject/pause/halt/modelSwitch-iface); budget (padrão F25) (D6)
├── src/extensions/resilience.ts   # wiring Pi: on(session_before_compact|session_compact|session_start|before_agent_start|tool_call|turn_end) (D1/D2/D3/D4)
├── test/resilience/               # unit puro (builder/detector/classifier/policy — relógio fake, traces scriptados) + integração fixture (ScriptedScenario)
└── test/eval/suites/compaction-recovery.ts + cases EVAL-017..021 (D8)
```

## Fluxos

### F1 — Observação de compactação (RES-01)

```
1. session_before_compact → snapshot: goal.taskList do ledger + ContinuationState (work summary, progresso) em .runecraft/continuation.json
2. session_compact → marca compactedAt (grace pós-compactação — padrão glla, 3min)
3. Fallback: session_start reason=resume|reload (recarga pós-compactação — doc do módulo compaction) e/ou context event (shape a validar)
4. session_start reason=startup com goal ativo no ledger → continuação também (resume de restart — semântica do glla "active goal auto-resumes")
```

### F2 — Continuação (RES-02)

```
1. before_agent_start (próximo turno pós-compactação/resume) → buildContinuationPrompt(ContinuationState)
2. null (sem goal ativo / pausado / sessão não-scoped) → sem rewrite
3. prompt → BeforeAgentStartEventResult.systemPrompt (encadeado com outras extensões — doc do SDK)
4. agente restaura todos (propose_task_list — F3) e continua da primeira tarefa não checada
5. determinismo: builder puro, sem timestamp/path absoluto (F21 D10)
```

### F3 — Todo preservation (RES-03)

```
session_before_compact → snapshot taskList (ledger)
session_compact/session_start → taskList sumiu? restore via propose_task_list/update_task_status : no-op (debug)
nunca compete com enforcer F24 (formato v1; RES-07)
```

### F4 — Stall detection (RES-04)

```
turn_end/tool_call/agent_end + ctx.isIdle()/hasPendingMessages() + relógio injetável
→ detectStall: repetition (tool+args normalizados ≥ N; output hash igual) | wedge (ocupada+silêncio) | heartbeat (ociosa sem progresso)
→ backoff ladder (padrão glla); stall suppression (audit-in-flight, pós-compactação grace, extensionApiStale)
→ StallSignal[] → classifica (F5) → política (F6)
```

### F5 — Classificação (RES-05)

```
input (exit code, erro, timeout AD-024, isQuotaError, stall signals) → puro
→ { class: agent|infra|unknown, reason, suggestion } (formato suggestions.ts F25)
→ infra: retry/backoff/fallback · agent: re-inject/pause/halt · unknown: fail-closed HALT
```

### F6 — Fallback chain (RES-06)

```
trigger (rate-limit|timeout|stall|falha repetida) → política configurada
→ stop-all: cadeia esgota → HALT com reason + sugestão (sem loop infinito)
→ skip-and-continue: registra veredito no log e segue (padrão F25 SKIP)
→ orçamento de escalação (padrão CostLedger F25) → esgotou → HALT
→ actions: retry | re-inject-continuation | pause | halt | modelSwitch (interface — F30 implementa; F27 = NO-OP documentado)
```

### F7 — CI

```
bun test test/eval (preloads F21/F24/F25/F26) → EVAL-017..021 offline/$0; consistência matriz↔suites (v5);
evidência last-run.json; sem regressão pós-F26; RUNECRAFT_RESILIENCE=0 não afeta a suite (kill switch testado)
```

## Mapeamento arcanum → harness (hooks do port)

| Arcanum (packages/guild/src/hooks/) | Harness (packages/harness) | Mecanismo real no Pi |
| --- | --- | --- |
| `compaction-recovery.ts` (3 camadas por lease + heal) | `src/resilience/continuation.ts` + `continuation-hook.ts` (camadas: goal(taskList) → work summary → identity-only; heal = re-derivar do ledger) | `session_before_compact`/`session_compact` + `before_agent_start` rewrite (D1/D2) |
| `compaction-todo-preserver.ts` (snapshot/restore via `client.session.todo`) | `src/resilience/todo-preserver.ts` (snapshot/restore taskList) | ledger glla + `propose_task_list`/`update_task_status` (D3 — API OpenCode NÃO existe no Pi) |
| `work-continuation.ts` (CONTINUATION_MARKER, progresso, scoping, MAX_STALE_CONTINUATIONS) | `src/resilience/continuation.ts` (marker `runecraft:continuation`, scoping) + `stall.ts` (stale-progress → stall) | antes_agent_start encadeável; ledger (D2/D4) |
| `start-work-hook.ts` (/start-work → plano → context injection) | comando `start-work` (resume de goal/taskList do ledger → context injection via continuation builder); discovery de planos → F32 | comando Pi (registro de comando — validar no Execute: glla registra /goal//list//loop) (D2) |
| `work-state.ts`/`plan-fs-repository.ts` (planos markdown) | NÃO portado — plano/plan-file é F32; F27 usa ledger | — |

## Tabela de mecanismos (o que existe → o que F27 constrói)

| Mecanismo | Existe (SDK 0.81.0 / fork / harness) — evidência | F27 constrói |
| --- | --- | --- |
| Evento de compactação | SDK: `session_before_compact`/`session_compact` (types.d.ts ✓) + `shouldCompact` puro (compaction.d.ts ✓) | Trigger primário (D1) + fallback (`context`/`session_start resume`) |
| Re-escrita de system prompt | SDK: `BeforeAgentStartEventResult.systemPrompt` encadeável (✓) | Continuation hook (D2) |
| Estado de goal/taskList | glla ledger `.pi-glla/active.jsonl` (F24 ✓; F19 isSupervising) | Fonte de verdade da continuação + `.runecraft/continuation.json` (D2) |
| Tools de todos | glla `propose_task_list`/`update_task_status` (F24 ✓ — NÃO há todowrite) | Todo preserver (D3) |
| Sinais de stall observáveis | SDK: `turn_start{turnIndex,timestamp}`/`turn_end{toolResults}`/`agent_end`/`tool_call`/`agent_settled` (✓) | Entrada do detector (D4) |
| Maquinário de stall provado | glla: heartbeat/escalação, pending-latch watchdog, wedge alert, grace pós-compactação, extensionApiStale, audit-in-flight (✓ — loops/goal.ts) | Port puro em `stall.ts` com atribuição (D4) |
| Repetição/output idêntico | glla `goal-loop-repetition.ts` puro (fingerprint sha256, Jaccard, toolResultRepeat) (✓) | Detector `repetition`/`identical-output` (D4) |
| Backoff | glla `goal-loop-backoff.ts` (stuck/error/context, hard cap 5min) (✓) | Ladder no detector/política (D4/D6) |
| Rate-limit/quota | glla `quota-retry.ts` `isQuotaError`/`parseQuotaError` (✓) | Reuso no classificador (D5) |
| Política retry/skip/halt + orçamento | F25 `RETRY/SKIP/HALT` + `cost.ts` CostLedger (✓) | Política de escalação + budget (D6) |
| Sugestão acionável | F25 `suggestions.ts` (✓) | Classificador `suggestion` (D5) |
| Troca de modelo | F30 (model-resolution) — NÃO existe no F27 | Interface `FallbackAction.modelSwitch` (D6) |
| Planos markdown / wizard | F32 (wizard/planner) — NÃO existe no F27 | Outline; F27 resume do ledger apenas |
| Workflow/orquestração | F33 (coded routing/bard) — NÃO existe no F27 | Outline (camada 1 do recovery do arcanum) |

## EVAL-MATRIX — entradas aditivas v5 (política F21 D9)

| ID | Fluxo | Ferramentas | Script esperado | Notas |
| --- | --- | --- | --- | --- |
| EVAL-017 | continuation builder puro | eval (suites/compaction-recovery) | 1. goal 3/5 no ledger → prompt contém marker/progresso/próxima tarefa; 2. goal completo → null; 3. sessão não-scoped → null; 4. 2 runs idênticos | determinismo (F21 D10); invariante D7 (nunca re-injeta completa) |
| EVAL-018 | todo preserver | eval (suites/compaction-recovery) | 1. snapshot no session_before_compact; 2. taskList sumiu → restore via propose_task_list (tools reais); 3. sobreviveu → no-op | sem API OpenCode; idempotente |
| EVAL-019 | stall detection | eval (suites/compaction-recovery) + fixture | 1. ScriptedScenario replaya chamadas idênticas → repetition ≤ N turnos; 2. output igual → identical-output; 3. silêncio (relógio fake) → wedge/heartbeat | limiares configuráveis; determinismo |
| EVAL-020 | classify + fallback policy | eval (suites/compaction-recovery) | 1. 429/timeout/stall/repetição → classe certa + sugestão; 2. stop-all esgota → HALT; 3. skip-and-continue → veredito no log; 4. orçamento esgotado → HALT; 5. modelSwitch = NO-OP interface | multi-trigger; fronteira F30 |
| EVAL-021 | fluxo completo pós-compactação | eval (suites/compaction-recovery) + fixture | 1. goal ativo → compactação scriptada (QA-5: evento sintético via handler exportado; viabilidade de evento real a validar); 2. continuação re-injeta pendentes; 3. agente completa → complete_goal verde (invariante F24) | delta vs EVAL-006/007/014 documentado; sem double-test |

Nota datada v5: categoria compaction-recovery do eval-coverage (bloqueada no F26 — "após F27") agora com entradas; tool-use/routing (F32) e failover (F30) permanecem SEM entradas (política aditiva — nada sai sem AD); tabela de dependência atualizada no design do F26/D5.

## Integração CI

- **Roda com**: mesma lane F21/F24/F25/F26 — `bun test test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM (F27 é determinístico por construção — sem judge)
- **Evidência**: `evalTest()` grava nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (identidade estável — F21 D10)
- **Consistência**: `matrix-consistency.test.ts` v5 varre `test/eval/suites` incluindo compaction-recovery
- **Kill switch**: `RUNECRAFT_RESILIENCE=0` testado (camada inerte; suite continua verde)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **`session_compact`/`session_before_compact` não dispararem no runtime real** (eventos existem nos tipos; comportamento efetivo a validar) | Fallback documentado: `context` event + `session_start reason=resume|reload` (recarga pós-compactação documentada no módulo compaction do SDK); evals usam evento sintético (handler exportado) — honesto, sem inventar |
| **Shape do `context` event** (tokens/janela) não verificado | Validar no Execute; não é primário (D1); se ausente, fallback fica só em session_start |
| **Stall falso-positivo em trabalho legítimo** (retry com espera, comandos longos) | Limiares configuráveis com defaults do glla (provados em campo); detector usa args normalizados + fingerprints; wedge usa sessão-ocupada (não ociosa) |
| **Deadlock AD-024 (phantom-block) via re-injeção** | Invariante D7: pendentes derivam SÓ do ledger atual; teste adversarial dedicado (re-injeção de completa → vermelho) |
| **Handle de extensão invalidado pós-compactação (0.82.x)** | Padrão `extensionApiStale` do fork: maquinário quieto após warning terminal; goal auto-resume no restart (ledger) |
| **Multi-sessão no mesmo cwd** (ledger por cwd — AD-019) | Scoping de sessão (última session_id do ledger) — semântica do work-continuation do arcanum |
| **Duplicação com F26/EVAL-006/007/014** | D8: casos novos = fluxo de compactação; delta documentado no case; sem re-assertar guard behavior |
| **Fronteira F30 borrada** (troca de modelo) | `modelSwitch` é interface + NO-OP documentado; F27 não toca settings/modelRoles; risco de escopo vira critério de aceite |
| **Copiar trechos do glla (licença — AD-002)** | Fork é nosso (AD-001), mas trechos do upstream têm MIT; atribuição via LICENSE-THIRD-PARTY.md ao copiar padrões literais (D4) |
| **Registro de comando Pi (`/start-work`)** não verificado nos tipos | glla registra /goal//list//loop (prova de que o mecanismo existe); API exata a validar no Execute — fallback: trigger por `before_agent_start` com detecção de prompt (sem comando) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| RES-01 | P1: Observação de compactação | D1 + extension wiring (session_before_compact/session_compact/session_start/context) + EVAL-021 |
| RES-02 | P1: Continuação pós-compaction | D2 + continuation.ts + before_agent_start rewrite + EVAL-017/021 |
| RES-03 | P1: Todo preserver | D3 + todo-preserver.ts + EVAL-018 |
| RES-04 | P1: Stall detection | D4 + stall.ts (port glla) + EVAL-019 |
| RES-05 | P1: Classificação agente-vs-infra | D5 + classify.ts (reuso isQuotaError/suggestions) + EVAL-020 |
| RES-06 | P2: Fallback chain | D6 + fallback.ts (multi-trigger/escalação/budget/modelSwitch-iface) + EVAL-020 |
| RES-07 | P2: Invariante F24 | D7 + teste adversarial (AD-024) + EVAL-021 |
| RES-08 | P2: Evals compaction-recovery | D8 + suite/cases EVAL-017..021 + EVAL-MATRIX v5 |
| RES-09 | P2: Config + docs | D9 + config.ts (schema aditivo, kill switch) + docs/ROUTING |

**Cobertura:** 9/9 mapeados. Edges da spec: sem goal → null (D2) · pausado → null (D2) · sessão errada → scoping (D2) · sem snapshot → no-op (D3) · evento não dispara → fallback (D1) · stall legítimo → limiares (D4) · audit-in-flight/grace/stale → suppression (D4) · taskList vazia → invariante (D7) · duplicação EVAL-006/007/014 → delta no case (D8) · determinismo → D2/D4 (relógio injetável).

**Pontos a validar no Execute** (consolidado): disparo real de `session_compact`/`session_before_compact` na sessão SDK (e possibilidade de emiti-los no fixture); shape do `context` event; valores exatos dos thresholds do glla (HEARTBEAT_STALL_MS, PENDING_LATCH_STUCK_MS, WEDGE_ALERT_DEFAULT_MINUTES — ler do fork na implementação); API de registro de comando Pi (/start-work); shape do ledger para leitura de taskList (F24 já consome — confirmar campos); interação do rewrite de system prompt com outras extensões (ordem de chaining); taskflow token-budget como monitor (se QA-2b escolhido).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Estado de continuação** (D2): (a) **recomendado — ledger glla (fonte de verdade) + `.runecraft/continuation.json` (metadados do harness)**; (b) estender state.json F13 (schema v1 aditivo); (c) só arquivo próprio
2. **QA-2 — Trigger de compactação** (D1): (a) **recomendado — eventos nativos `session_before_compact`/`session_compact` primários + fallback `context`/`session_start resume`**; (b) monitor de janela de contexto via taskflow token-budget como primário
3. **QA-3 — Ações da fallback chain** (D6): (a) **recomendado — engine + ações reais {retry, re-inject, pause, halt} + `modelSwitch` interface (F30 implementa)**; (b) troca de modelo já (env/modelRoles) — duplica F30; (c) só engine, sem ações
4. **QA-4 — Fonte do stall detector** (D4): (a) **recomendado — port puro dos padrões provados do glla** (heartbeat/wedge/repetition/backoff, com atribuição); (b) detector novo só com eventos crus do SDK
5. **QA-5 — Evals de compactação** (D8): (a) **recomendado — unit puro + integração via handler exportado com evento sintético** (determinístico offline; viabilidade de evento real no fixture a validar no Execute); (b) compactação real no fixture (disparar shouldCompact)
