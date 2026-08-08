# F27 — Resilience & Continuity Specification

**Scope:** Large (multi-component: continuidade pós-compaction, re-injeção de tarefa pendente, todo preservation, stall detection, classificação de falha agente-vs-infra, política de escalação/fallback chains — pilar 6)
**Prereq:** F21 ✓ (fixture ScriptedScenario — scriptar stall/recovery), F24 ✓ (guards, enforcer complete_goal, ledger glla), F26 ✓ (framework eval — casos de compaction-recovery na categoria eval-coverage)
**Grupo:** M7 — Garantias (pilar 6 do doc do usuário: "Stall — agente parou de progredir. Mesma ferramenta em loop, output igual, stream parado. Fallback chain — cadeia entre modelos: leve → forte → humano. Escalation policy — cadeia esgota: parar tudo ou pular-e-seguir. Failure classification — agente ou infra? Tratamento diferente. O gatilho da fallback chain importa tanto quanto a chain: stall e timeout precisam disparar fallback, não só rate-limit. Detecção de estagnação observa progresso real, não só erros.")

## Problem Statement

O harness garante a **execução** (F24: bloqueio real de `tool_call`, enforcer de `complete_goal`) e a **saída** (F25: cascata com RETRY/SKIP/HALT). Mas a **continuidade** não existe: se a sessão do Pi compacta o contexto (ou o usuário resume/reinicia), o agente perde o fio — o goal ativo e as tarefas pendentes do ledger do glla (`.pi-glla/active.jsonl`, F24) não são re-injetados, e nada detecta que o agente **parou de progredir** (mesma ferramenta em loop, output idêntico, stream parado). O arcanum (supersedido — AD-001) resolve isso com 4 hooks OpenCode (`compaction-recovery`, `compaction-todo-preserver`, `work-continuation`, `start-work-hook`), mas eram **prompt injection no OpenCode** — não portáveis; o port ao Pi exige mecanismos reais.

**Fatos verificados (sem fabricação):** o Pi SDK 0.81.0 **emite eventos de compactação nativos** — `session_before_compact` e `session_compact` no union de eventos de `dist/core/extensions/types.d.ts` — e o módulo `dist/core/compaction/compaction.d.ts` expõe `shouldCompact(contextTokens, contextWindow, settings)` (lógica pura; o session manager faz I/O e recarrega a sessão). `before_agent_start` retorna `BeforeAgentStartEventResult.systemPrompt` — "Replace the system prompt for this turn. If multiple extensions return this, they are chained" — o mecanismo de re-escrita encadeável do system prompt (documentado no handoff guild→pi). O fork do glla (`packages/goal-loop-audit`) já contém maquinário de stall **provado em campo**: heartbeat refire com escalação (`consecutiveStalls`/`stallEscalationRefires`), pending-latch watchdog pós-compactação, wedge alert (sessão ocupada + silêncio = comando pendurado), detecção de repetição (ferramenta igual + output igual = sem informação nova) e backoff com hard cap — mais `quota-retry.ts` (`isQuotaError`/`parseQuotaError` com Retry-After). F27 porta esses mecanismos para o harness como módulos puros + wiring de extensão Pi, com estado persistido no ledger do glla (fonte de verdade de goal/taskList — F19/F24) e política de escalação config-driven (reuso dos padrões RETRY/SKIP/HALT e CostLedger do F25).

## Goals

- [ ] **Continuidade pós-compaction**: observar `session_before_compact`/`session_compact` (eventos nativos do SDK — trigger primário; fallback: `context` event / `session_start reason=resume|reload`) e re-injetar no turno seguinte, via re-escrita de system prompt (`before_agent_start`), um prompt de continuação determinístico: goal ativo, progresso, próxima tarefa pendente e instruções de restauração de todos — derivados do ledger do glla + estado de continuação do harness
- [ ] **Todo preserver**: snapshot do `goal.taskList` antes da compactação e restauração via tools reais do glla (`propose_task_list`/`update_task_status` — F24 provou que NÃO existem `todowrite`/`todoresolve`) se a compactação limpar os todos
- [ ] **Stall detection**: detector determinístico com limiares configuráveis — (a) chamadas repetidas idênticas de ferramenta (tool+args normalizados, output igual), (b) silêncio com sessão ocupada (wedge) e (c) silêncio com sessão ociosa (heartbeat/refire) — observando eventos reais do SDK (`tool_call`, `turn_start/turn_end` com timestamps, `agent_end`) e reutilizando os padrões puros do fork do glla (repetition/backoff) — sem reinventar
- [ ] **Classificação de falha agente-vs-infra**: classificador determinístico (exit code, timeout, rate-limit/quota, stall, repetição) com sugestão acionável — reuso do padrão `suggestions.ts` do F25 e de `isQuotaError` do glla
- [ ] **Fallback chains (mecanismo)**: engine de política multi-trigger (rate-limit + timeout + stall + falha repetida) com política de escalação (`stop-all` vs `skip-and-continue`) e orçamento de escalação (padrões CostLedger do F25); a **troca de modelo em si é fronteira do F30** — F27 entrega o mecanismo e a interface `FallbackAction.modelSwitch` (F30 implementa)
- [ ] **Invariante F24**: a continuação re-injetada NUNCA briga com o enforcer — tarefas re-injetadas sempre completáveis (sem phantom-block deadlock do AD-024 — teste de regressão dedicado)
- [ ] **Evals**: casos de compaction-recovery implementáveis AGORA via fixture F21 (fluxo scriptado: goal ativo → compactação → prompt de continuação re-injeta pendentes → agente completa) como EVAL-017..021 no EVAL-MATRIX v5 (formato framework-driven do F26)
- [ ] Governança: EVAL-MATRIX v5 aditivo com notas datadas; docs com tabela de mecanismos (o que existe no SDK/fork → o que F27 constrói); sem regressão

## Out of Scope

| Feature | Reason |
| --- | --- |
| Troca real de modelo (fallback leve→forte→humano) | Domínio do F30 (model-resolution); F27 entrega a política/mecanismo + interface `modelSwitch` — decisão D6 |
| Planos markdown/plan-files do arcanum (`work-state`, `plan-fs-repository`, `/start-work` discovery) | Planos/wizard são F32; workflow/orquestração F33 — F27 resume do ledger (goal+taskList), não cria planos |
| Workflows do arcanum (`getActiveWorkflowInstance`, workflow-* recovery) | Não existe equivalente no harness pré-F33; a camada 1 do recovery (workflow-owned) vira outline |
| Auditor/review do glla (reviewer.ts, goal-loop-auditor.ts) | F28/F32; stall suppression de audit-in-flight é reutilizada, não reimplementada |
| Replanejar F21/F24/F25/F26 | Reuso de padrões (fixture, guards/ledger, RETRY/SKIP/HALT+CostLedger, framework eval) — integração aditiva |
| Concorrência multi-sessão no mesmo cwd | Limite do fork do glla (ledger por cwd — documentado no AD-019); F27 herda e documenta |
| Observabilidade (event store, analytics) | F28 — F27 grava no ledger glla (appendLedger) como o fork já faz; sem store próprio |
| packages/guild, .guild/, .pi/ | Arcanum supersedido (AD-001); port semântico com mecanismos reais do Pi |

## Gray area (resolver antes do Execute — 5 decisões do usuário)

Escopo travado (políticas F21/F24/F25/F26). Cinco pontos abertos — opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Onde vive o estado de continuação**: (a) **recomendado** — ledger glla como fonte de verdade de goal/taskList (F19/F24) + arquivo novo `.runecraft/continuation.json` para metadados do harness (work summary, contadores de continuação/stall, snapshot de progresso) · (b) estender o state.json do F13 (schema v1 aditivo) · (c) só arquivo próprio (sem ledger)
- **QA-2 — Semântica do trigger de compactação**: (a) **recomendado** — eventos nativos `session_compact`/`session_before_compact` como trigger primário (types verificados) + fallback `context` event / `session_start reason=resume|reload` quando o evento não disparar (a validar no Execute se o fixture consegue emiti-los) · (b) monitor de janela de contexto por contagem de tokens (taskflow token-budget) como primário
- **QA-3 — Escopo das ações da fallback chain no F27**: (a) **recomendado** — engine de política + ações reais {retry, re-inject-continuation, pause, halt} + `modelSwitch` como interface implementada pelo F30 · (b) implementar troca de modelo já (env/modelRoles) — duplica F30 · (c) só engine de política, sem ações
- **QA-4 — Fonte do detector de stall**: (a) **recomendado** — portar para módulos puros do harness os padrões JÁ provados do fork do glla (heartbeat/watchdog/wedge + repetition + backoff — o fork é nosso, AD-001) com atribuição · (b) detector novo só com eventos crus do SDK (turn/tool_call timestamps)
- **QA-5 — Determinismo dos evals de compactação**: (a) **recomendado** — unit puro (continuation builder, detector, classificador, política) + integração via handler exportado invocado com eventos scriptados (simulação de `session_start resume` + `session_compact` sintético) · (b) tentar compactação real no fixture (disparar `shouldCompact` na sessão SDK — viabilidade a validar no Execute)

**Já decidido (não é gray area):** zero deps novas; offline/$0; escopo packages/harness; requirement IDs RES-0x; EVAL-MATRIX aditivo (v5) com notas datadas (F21 D9); nada sai sem AD; fronteira F30 explícita (model switching); evidência via `evalTest()` (F21); mecanismos citados existem no SDK 0.81.0 ou no fork (evidência no design D1–D6); llm-judge/env-gated NÃO usado em F27 (tudo determinístico offline).

## User Stories

### P1: Continuidade pós-compaction (recovery + todo preserver + continuation) ⭐ MVP — RES-01/02/03

**User Story**: Como usuário, quero que uma sessão compactada (ou resumida) continue o goal ativo do ponto exato — goal, progresso e tarefas pendentes re-injetados — para nenhum trabalho ser perdido nem refeito.

**Why P1**: É o port central (compaction-recovery/work-continuation/start-work-hook); sem isso o agente recomeça do zero após cada compactação.

**Acceptance Criteria**:

1. WHEN `session_compact`/`session_before_compact` é emitido (ou fallback: `session_start reason=resume|reload`) THEN o harness captura o snapshot do `goal.taskList` (ledger glla) e registra o estado de continuação (goal, progresso, work summary)
2. WHEN o próximo turno começa THEN `before_agent_start` reescreve o system prompt (encadeado — `BeforeAgentStartEventResult.systemPrompt`) com prompt de continuação determinístico: marker `<!-- runecraft:continuation -->`, goal, progresso `completed/total`, diretório, "continue da primeira tarefa não checada" — SEM re-executar tarefas completas
3. WHEN a compactação limpou os todos THEN a restauração usa as tools reais do glla (`propose_task_list`/`update_task_status`) — NUNCA API OpenCode (`client.session.todo` — inexistente no Pi)
4. WHEN o goal está completo, pausado, ou a sessão não é a sessão do goal THEN NENHUM prompt de continuação é injetado (scoping de sessão — semântica do work-continuation do arcanum)
5. WHEN o prompt é gerado 2x com o mesmo estado THEN o texto é IDÊNTICO (determinismo — sem timestamps/paths absolutos, F21 D10)

**Independent Test**: fixture F21 (ScriptedScenario) — goal ativo com 3/5 tarefas → evento de compactação scriptado → continuation builder (puro) → prompt contém goal/3/5/próxima tarefa; 2 runs idênticos; goal completo → null; sessão errada → null.

### P1: Stall detection & failure classification — RES-04/05

**User Story**: Como mantenedor, quero que o harness detecte que o agente parou de progredir (não só timeout/rate-limit) e classifique a falha como agente ou infra, para o gatilho certo disparar a resposta certa.

**Why P1**: Pilar 6 do usuário — "o gatilho da fallback chain importa tanto quanto a chain: stall e timeout precisam disparar fallback, não só rate-limit"; detecção observa progresso real, não só erros.

**Acceptance Criteria**:

1. WHEN o agente chama a MESMA ferramenta com args normalizados iguais N vezes seguidas (default 3 — limiar configurável) THEN detector emite sinal `stall:repetition` (ferramenta + hash de args)
2. WHEN o output é idêntico entre turnos (fingerprint sha256 / Jaccard ≥ 0.8 — padrão do glla `goal-loop-repetition`) THEN detector emite `stall:identical-output`
3. WHEN a sessão está ocupada (turn em andamento) e silenciosa por > limiar THEN detector emite `stall:wedge` (comando pendurado — padrão glla wedge alert); sessão ociosa sem progresso por > limiar → `stall:heartbeat` (refire/escadação)
4. WHEN o classificador recebe um erro THEN classifica determinístico: infra (rate-limit/quota via `isQuotaError`, timeout, rede, exit≠0 de ferramenta de infra) vs agente (stall, repetição, validação falhando, sem progresso) com sugestão acionável (padrão `suggestions.ts` do F25)
5. WHEN o detector roda 2x com o mesmo trace THEN sinais idênticos (determinismo; relógio injetável)

**Independent Test**: unit puro com traces scriptados (repetição 3x, output idêntico, silêncio com relógio fake, 429 com Retry-After) → sinais esperados; integração: ScriptedScenario replaya stall (chamadas idênticas repetidas) → detector dispara dentro de N turnos.

### P2: Fallback chain (mecanismo multi-trigger + escalação) — RES-06

**User Story**: Como usuário, quero que a cadeia de fallback dispare por QUALQUER gatilho (rate-limit, timeout, stall, falha repetida) e siga a política de escalação configurada (parar tudo ou pular-e-seguir), para a cadeia esgotada não virar loop infinito nem silêncio.

**Why P2**: F30 é dono da resolução de modelo; o MECANISMO (multi-trigger, política, orçamento, classificação) é harness e desbloqueia F30/F33 (fallback chains citadas no F33).

**Acceptance Criteria**:

1. WHEN qualquer trigger (rate-limit/timeout/stall/falha repetida) é emitido THEN a engine consulta a política configurada e produz uma ação da cadeia (retry / re-inject-continuation / pause / halt / `modelSwitch` — interface)
2. WHEN a política é `stop-all` THEN a cadeia esgotada para TUDO com reason + sugestão (HALT com reason — padrão F25); `skip-and-continue` → registra e segue (SKIP com veredito no log — padrão F25)
3. WHEN o orçamento de escalação esgota THEN HALT sem mais tentativas (padrões `cost.ts`/CostLedger do F25 — sem duplicação de mecânica)
4. WHEN `modelSwitch` é acionado THEN a engine chama a interface — F30 implementa a resolução real; F27 tem implementação NO-OP documentada (fronteira explícita)
5. WHEN o env `RUNECRAFT_RESILIENCE=0` THEN toda a camada fica inerte (kill switch — padrão F24/F25)

**Independent Test**: unit com policy fakes — cada trigger mapeia para a ação/política certa; stop-all vs skip-and-continue; orçamento esgotado → HALT; modelSwitch NO-OP documentado; kill switch desliga tudo.

### P2: Invariante com o enforcer F24 (sem phantom-block) — RES-07

**User Story**: Como mantenedor, quero que a continuação re-injetada seja sempre completável pelo enforcer do F24, para o bug do AD-024 (stale taskList → phantom-block deadlock) nunca voltar.

**Why P2**: O deadlock AD-024 é o modo de falha real da interação continuação×guards; F27 é quem introduz a re-injeção — precisa provar a invariante.

**Acceptance Criteria**:

1. WHEN a continuação re-injeta tarefas THEN a fonte é o estado ATUAL do ledger (goal.taskList v1) — nunca snapshot obsoleto de goal anterior (regressão AD-024)
2. WHEN o agente completa todas as tarefas do ledger THEN `complete_goal` passa SEM bloqueio fantasma (reason F24 ausente)
3. WHEN tarefas completas são re-injetadas por engano THEN o teste falha com diagnóstico (invariante: re-injeção deriva apenas de unchecked tasks)
4. WHEN o guard `todo-continuation-enforcer` (F24) roda sobre a continuação THEN a taskList re-injetada respeita o formato v1 (sem drift)

**Independent Test**: fixture — goal 3/5 → compactação scriptada → continuação re-injeta tarefa 4 (não 3) → agente completa 4 e 5 → `complete_goal` verde; cenário adversarial (snapshot obsoleto) → teste vermelho com diagnóstico.

### P2: Evals de compaction-recovery + governança — RES-08/09

**User Story**: Como mantenedor, quero os casos de compaction-recovery como dados do framework F26 (EVAL-017..021) e a matriz v5, para a categoria do eval-coverage (bloqueada no F26 — "após F27") ter casa no harness agora.

**Why P2**: F26 tabela de dependência prometeu a categoria após F27; evidência determinística da resiliência sem custo de tokens.

**Acceptance Criteria**:

1. WHEN a suite `compaction-recovery` roda THEN os cases EVAL-017..021 executam no runner do F26 offline/$0 (fixture ScriptedScenario + handler exportado com eventos scriptados — QA-5)
2. WHEN o case de continuação roda THEN o fluxo scriptado prova: goal ativo → compactação → prompt re-injeta pendentes → agente completa → evidência no last-run.json (evalTest F21)
3. WHEN o case de stall roda THEN o stall scriptado (chamadas idênticas) dispara o detector com determinismo
4. WHEN a matriz roda THEN EVAL-MATRIX v5 aditiva (EVAL-017..021 + notas datadas) e o teste de consistência varrer a nova suite
5. WHEN `bun test` roda THEN sem regressão (pós-F26) + novos verdes offline/$0; zero chamadas LLM

**Independent Test**: cada case valida schema F26; determinismo 2 runs; consistência matriz↔suites; evidência no last-run.json.

## Edge Cases

- WHEN não há goal ativo no ledger THEN nenhum prompt de continuação (null — sem ruído; padrão identity-only do arcanum)
- WHEN o goal está pausado THEN nenhuma continuação (semântica work-continuation)
- WHEN a sessão não é a sessão do goal (multi-sessão/ledger por cwd — AD-019) THEN scoping de sessão bloqueia a injeção
- WHEN a compactação ocorre sem snapshot prévio THEN todo-preserver é no-op (não falha; debug)
- WHEN `session_compact` não dispara no runtime real THEN fallback `context` event / `session_start reason=resume|reload` (a validar no Execute; sem inventar evento)
- WHEN o stall é legítimo (backoff/retry com espera) THEN detector usa args normalizados + fingerprints + limiares configuráveis (falso-positivo documentado; threshold default do glla)
- WHEN o audit do glla está em voo THEN stall machinery fica quieto (padrão `completionAuditInFlight` do fork — não reimplementar)
- WHEN o handle da extensão é invalidado pós-compactação (comportamento 0.82.x citado no fork) THEN maquinário de stall fica quieto e a mensagem terminal já foi emitida (padrão `extensionApiStale`)
- WHEN a taskList está vazia/apenas tarefas completas THEN continuação deriva do ledger apenas (invariante RES-07; sem tarefa fantasma)
- WHEN o mesmo comportamento já é coberto por EVAL-006/007/014 THEN sem duplicação — casos novos cobrem o fluxo de compactação (delta documentado no case)
- WHEN um caso roda 2x THEN vereditos idênticos (mensagens sem $TMP/$TS — F21 D10)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| RES-01 | P1: Observação de compactação (session_before_compact/session_compact + fallback) | Design | Pending |
| RES-02 | P1: Continuação pós-compaction (continuation builder + before_agent_start rewrite + scoping) | Design | Pending |
| RES-03 | P1: Todo preserver (snapshot/restore taskList via tools glla) | Design | Pending |
| RES-04 | P1: Stall detection (repetition/identical-output/wedge/heartbeat) | Design | Pending |
| RES-05 | P1: Classificação de falha agente-vs-infra + sugestão | Design | Pending |
| RES-06 | P2: Fallback chain (multi-trigger, escalação stop-all/skip-and-continue, orçamento, modelSwitch interface) | Design | Pending |
| RES-07 | P2: Invariante F24 (sem phantom-block; regressão AD-024) | Design | Pending |
| RES-08 | P2: Evals compaction-recovery (EVAL-017..021) + EVAL-MATRIX v5 | Design | Pending |
| RES-09 | P2: Config surface + docs (mecanismos, ROUTING) | Design | Pending |

**Coverage:** 9 total, 0 mapeados, 9 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Tabela de mecanismos (SDK 0.81.0/fork → F27) documentada com evidência nos tipos/fonte (sem fabricação)
- [ ] Trigger de compactação definido com evidência (eventos nativos `session_before_compact`/`session_compact` + fallback honesto) e limitação documentada (validação no Execute)
- [ ] Continuação determinística offline: goal ativo 3/5 → prompt re-injeta pendentes → agente completa → evidência (fixture F21); 2 runs idênticos
- [ ] Stall detector dispara em trace scriptado (chamadas idênticas repetidas, output igual, silêncio com relógio fake) — determinístico, limiares configuráveis
- [ ] Classificador agente-vs-infra unit com sugestão acionável; fallback engine multi-trigger com política stop-all/skip-and-continue + orçamento (padrões F25)
- [ ] Invariante F24 provada por teste (re-injeção de task completada → falha com diagnóstico; regressão AD-024 coberta)
- [ ] EVAL-017..021 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v5 aditivo com notas datadas; sem regressão pós-F26
- [ ] Fronteira F30 explícita: `modelSwitch` é interface; F27 não resolve modelo
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
