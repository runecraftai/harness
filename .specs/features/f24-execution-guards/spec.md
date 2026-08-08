# F24 — Execution Guards (tool_call blocking) Specification

**Scope:** Large (multi-component: guards como extensões Pi + tests determinísticos + matriz/status)
**Prereq:** F15 ✓ (rules.ts/renderRules — fonte da linguagem de constraints), F20 ✓ (fail-closed + kill switch), F21 ✓ (fixture, materialização de extensões, EVAL-MATRIX, evidência)
**Grupo:** M7 — Garantias (pilares 3–7; F24 = pilar guardrails, determinismo de execução — decisão 3b)

## Problem Statement

O harness hoje garante **assets** (install/sync/rules/receipt no shell), mas não tem controle **dentro da sessão do agente**: o modelo pode sobrescrever um arquivo existente, escrever fora do escopo permitido ou concluir trabalho com todos pendentes — e nada o impede de verdade. No OpenCode, o guild mitigava com hooks que injetam aviso no prompt (a LLM pode ignorar). No Pi, o evento `tool_call` aceita `return { block: true, reason }` — **bloqueio real da execução do tool, não sugestão** (verificado no handoff guild→pi, tabela 4.2; é "a peça que o Guild não consegue garantir no OpenCode"). F24 porta os guards determinísticos do guild para extensões Pi do `@runecraft/harness`, com bloqueio/reescrita reais e config fail-closed.

F24 é a **primeira fatia** de M7 porque: (1) é o maior ganho de determinismo (execução > saída — decisão 3 lista b antes de c); (2) todas as dependências estão COMPLETAS (F15/F20/F21 — nada aguarda F22/tokens); (3) é o substrato do F25 (cascata de verificação usa os denial gates no HALT policy e a integridade de arquivo é domínio do write-guard). A cascata de verificação fica para F25 (próxima).

## Goals

- [ ] Guards determinísticos do guild portados como extensões Pi do harness: `write-existing-file-guard`, `ranger-md-only`, `todo-description-override`, `todo-continuation-enforcer` (+ helper `todo-writer`) — bloqueio/reescrita reais em `tool_call`
- [ ] Fail-closed por padrão (guards ligados em sessões gerenciadas pelo harness) + kill switch (padrão F20) + config por state (F13) com merge (F14)
- [ ] Testes determinísticos offline/$0 na infra do F21 (fixture OpenAI-wire, materialização de extensões) + EVAL-006/007 aditivos na EVAL-MATRIX + evidência JSON para o ratchet do F23
- [ ] Matriz (F17) e doctor/status (F12) honestos: guards são Pi-only; não-Pi = detect-only com guia

## Out of Scope

| Feature | Reason |
| --- | --- |
| Cascata de verificação (estrutural→judge) | F25 (usa os gates do F24) |
| Guards de compaction/continuação (`compaction-recovery`, `compaction-todo-preserver`, `work-continuation`, `start-work-hook`, `context-window-monitor`) | F27/F28 (continuidade e observabilidade) |
| Suite de evals de constraint adherence (evaluator `tool-policy`) | F26 (framework de evals do guild portado lá; sujeitos = guards do F24) |
| Enforcement em agentes não-Pi | Impossível por construção (tool_call é Pi-only); matriz honesta + detect-only |
| Judge LLM / custo de tokens | Fora de escopo; F24 é offline/$0 por construção |
| Config nova (arquivo próprio de guards) | Reusa state.json (F13) + merge (F14); sem superfície nova |

## Gray area (resolver no Design)

1. **Config surface**: onde vive `enabled`/opções por guard (state.json do F13 vs settings.json do Pi) e como o kill switch interage (env vs state).
2. **Escopo do ranger-md-only**: quais agentes são md-only (v1 não há agentes objetivos ainda — F32); lista config vs default.
3. **Nomes de tools**: `write`/`edit` são builtins do Pi; as tools de todo vêm do fork glla — nomes exatos a validar no Execute.
4. **Interação com o F20**: gates de receipt são shell-level; guards são session-level — mesma regra de integridade de arquivo em duas camadas (complementares ou redundantes?).

## User Stories

### P1: Write guard (bloqueio de sobrescrita) ⭐ MVP

**User Story**: Como usuário, quero que o modelo nunca sobrescreva um arquivo existente sem permissão explícita, para que o harness impeça a destruição de trabalho — não apenas sugira.

**Why P1**: É o guard de maior valor (perda irreversível) e a prova do mecanismo `{ block: true }`.

**Acceptance Criteria**:

1. WHEN o modelo chama `write`/`edit` num path que já existe THEN o tool SHALL ser bloqueado com `{ block: true, reason }` e o reason SHALL nomear o guard e o path (sem expor path absoluto do runner — normalização)
2. WHEN o usuário/config permite explicitamente (`allow`/`force`) THEN a sobrescrita SHALL passar (a LLM vê a autorização no reason do bloqueio anterior ou no config)
3. WHEN o path não existe (criação de arquivo novo) THEN o write SHALL passar sem intervenção
4. WHEN `RUNECRAFT_GUARDS=0` (kill switch) THEN todos os guards SHALL estar inativos na sessão

**Independent Test**: sessão Pi com fixture → script induz write sobre arquivo existente → transcript mostra o bloqueio com reason; com allow → passa; kill switch → passa.

### P1: Ranger md-only (escopo de escrita) ⭐ MVP

**User Story**: Como mantenedor, quero restringir agentes designados a escrever apenas `.md`, para que papéis de documentação/auditoria não corrompam código.

**Why P1**: Port direto do `ranger-md-only`; vira a assinatura do papel auditor no F32.

**Acceptance Criteria**:

1. WHEN um agente da lista `mdOnlyAgents` chama `write`/`edit` com extensão ≠ `.md` THEN o tool SHALL ser bloqueado com reason citando a regra
2. WHEN o agente não está na lista THEN o guard SHALL não intervir
3. WHEN a extensão é `.md` (case-insensitive: `.MD` incluído) THEN o write SHALL passar
4. WHEN a lista está vazia (default v1) THEN o guard SHALL estar ativo mas não bloquear nada (pronto para o F32)

**Independent Test**: fixture com agente md-only → write `.ts` bloqueado; `.md` passa; agente fora da lista passa.

### P2: Todo guards (qualidade de entrega)

**User Story**: Como mantenedor, quero que a lista de tarefas seja formatada com "Done when" e que o agente não conclua com todos pendentes, para que a entrega seja verificável.

**Why P2**: Porta `todo-description-override` + `todo-continuation-enforcer` — fecham o loop de "trabalho declarado = trabalho feito".

**Acceptance Criteria**:

1. WHEN o modelo chama a tool de todo (nome do fork glla a validar) THEN o `todo-description-override` SHALL reescrever o input para o formato canônico (critério "Done when" por item) e o tool SHALL executar com o input reescrito
2. WHEN o agente tenta concluir (turn_end/agent_end) com todos pendentes THEN o `todo-continuation-enforcer` SHALL bloquear a conclusão com reason listando os itens pendentes
3. WHEN não há todos pendentes THEN a conclusão SHALL passar
4. WHEN um guard de todo está desabilitado no config THEN ele SHALL não intervir

**Independent Test**: fixture → todowrite com descrição livre → transcript mostra input reescrito; conclusão com pendência → bloqueada; sem pendência → passa.

### P2: Config, status e integração

**User Story**: Como mantenedor, quero ver o estado dos guards no doctor/status e desligá-los pontualmente, para operar o harness com previsibilidade.

**Why P2**: Fecha o ciclo operacional (F12/F13/F14 já existem; F24 os estende).

**Acceptance Criteria**:

1. WHEN `doctor` roda THEN ele SHALL listar os guards com estado (enabled/disabled/mdOnlyAgents) e config válida (schema F13 aditivo)
2. WHEN `status --json` roda THEN ele SHALL incluir a seção `guards` (estado por guard + kill switch)
3. WHEN o config de guards é inválido (ex.: tipo errado) THEN o doctor SHALL reportar e o guard afetado SHALL operar fail-closed (bloqueia, não libera)
4. WHEN `sync` roda THEN ele SHALL re-aplicar o config de guards ao state (idempotente, SETM do F14)

**Independent Test**: fixture → doctor/status refletem config; config quebrada → fail-closed reportado; sync re-aplica.

### P2: Testes determinísticos + evidência

**User Story**: Como mantenedor, quero que os guards sejam verificados offline/$0 em CI com evidência para o ratchet, para que regressão de comportamento nunca passe em silêncio.

**Why P2**: É o padrão F21/F23 aplicado aos guards (o gentle-ai congela até guard population com `.guard-population-baseline`).

**Acceptance Criteria**:

1. WHEN `bun test` roda THEN os testes de guards SHALL rodar offline, sem rede e sem tokens (fixture F21, loopback, apiKey literal)
2. WHEN um guard regride (deixa de bloquear) THEN o teste SHALL falhar com diagnóstico (bloqueio esperado vs transcript recebido)
3. WHEN um teste de guard roda THEN a evidência JSON SHALL ser gravada via `evalTest()` (F21 D10) para o ratchet do F23
4. WHEN um guard novo entra THEN ele SHALL ter entrada na EVAL-MATRIX (EVAL-006/007, aditivo — política D9 do F21) e na seção guards do ROUTING.md

**Independent Test**: desvio induzido (guard desligado no meio do teste) → falha com diagnóstico; CI verde offline.

## Edge Cases

- WHEN o tool de todo do glla muda de nome THEN o teste SHALL falhar apontando o nome esperado (validar no Execute; correção in-place na matriz com nota datada — política F21 D9)
- WHEN o path do write contém symlink THEN o guard SHALL resolver o alvo real para a checagem de existência (evitar bypass por symlink)
- WHEN a extensão é `.MD`/`.Markdown` THEN o ranger SHALL tratar como `.md` (case-insensitive)
- WHEN o reason do bloqueio embute path/timestamp THEN a normalização do F21 (D10) SHALL removê-los na evidência (identidade estável)
- WHEN o config de guards muda no meio de uma sessão THEN os guards SHALL usar o config do início da sessão (estado congelado por sessão — sem drift mid-turn)
- WHEN duas sessões rodam em paralelo (workers) THEN cada uma SHALL ter seu próprio material de extensões (agentDir temp por sessão, padrão F21 D3)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| GUARD-01 | P1: Write guard (AC 1.1/1.3 bloqueio + arquivo novo) | Design | Pending |
| GUARD-02 | P1: Write guard (AC 1.2/1.4 allow/force + kill switch) | Design | Pending |
| GUARD-03 | P1: Ranger md-only (AC 2.1–2.4) | Design | Pending |
| GUARD-04 | P2: Todo override (AC 3.1) | Design | Pending |
| GUARD-05 | P2: Todo enforcer (AC 3.2/3.3/3.4) | Design | Pending |
| GUARD-06 | P2: Config/status/doctor/sync (AC 4.1–4.4) | Design | Pending |
| GUARD-07 | P2: Testes offline/$0 + evidência (AC 5.1–5.3) | Design | Pending |
| GUARD-08 | P2: Matriz/ROUTING honesta (AC 5.4) | Design | Pending |

**Coverage:** 8 total, 0 mapeados, 8 unmapped

## Success Criteria

- [ ] Write sobre arquivo existente bloqueado de verdade em sessão Pi (fixture), com reason; allow/force e kill switch verificados
- [ ] Ranger md-only bloqueia não-`.md` para agentes da lista; default v1 inerte (lista vazia)
- [ ] Todo override reescreve input; enforcer bloqueia conclusão com pendências
- [ ] doctor/status refletem guards; config inválida → fail-closed reportado
- [ ] Suite de guards offline/$0 em CI, com evidência JSON para o F23; EVAL-006/007 na matriz
