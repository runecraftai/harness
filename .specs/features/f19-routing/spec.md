# F19 — Routing & Mental Model Specification

**Scope:** Medium (doc versionada de trigger rules + template de regras injetáveis + hello world)
**Prereq:** F7 ✓ (cenários de coexistência — base do hello world)
**Grupo:** WORK (F19–F20) — o harness vira mental model (AD-011)

## Problem Statement

Os 4 forks são ferramentas sobrepostas: chain de subagents vs DAG de taskflow vs goal loop com auditor — escolher errado custa tempo e, no pior caso, quebra a sessão (two-driver rule). O harness precisa de **regras de roteamento explícitas** (quando usar cada ferramenta), com critérios objetivos extraídos das capacidades reais (pesquisa 2026-08-05), documentadas e **injetáveis** — o texto das regras é exatamente o conteúdo da seção `runecraft:workflow` que o F15 injeta nos agentes (F17 D1).

## Goals

- [ ] Documento de trigger rules versionado (`.specs/features/f19-routing/` + doc do produto no F8): roteamento por situação com critérios objetivos, contra-indicações e o limite two-driver
- [ ] Template determinístico das regras (`rules.ts` do F15) — conteúdo final definido aqui
- [ ] Hello world SDLC (base F7) como intended-usage reproduzível
- [ ] Doctor/status referenciam o driver ativo (quando um goal dirige a sessão)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Roteamento automático pelo CLI (o harness decide por você) | v1 é regras documentadas + injetadas; automação é Future |
| SDD (Spec-Driven Development) com artefatos duráveis | O gentle-ai tem; nosso v1 é roteamento orgânico (AD-008) |
| Model routing por fase (modelos diferentes por fase) | F14 cobre models por role no Pi; não-Pi fica para F8 docs |
| Rota de "escalação" com lineage/authority | F20 receipt leve não tem authority store (AD-011) |

## Gray area (resolver no Design)

**Formato do documento**: (a) um `ROUTING.md` canônico no repo do harness + trechos injetados nos agentes, ou (b) o documento É o template (uma fonte, renderizada por agente com variações). **Recomendado: (a)** — doc canônico para humanos + template derivado (mais curto, focado no agente) para a seção `runecraft:workflow`.

**Conteúdo por agente**: agentes não-Pi (Claude/OpenCode/Codex) não têm goal-loop/subagents — as regras injetadas neles cobrem só o que existe (taskflow + review via gate MCP?); o Pi recebe as regras completas. Definir a variação por coluna da matriz (F17).

## User Stories

### P1: Trigger rules documentadas ⭐ MVP

**User Story**: Como dev usuário, quero saber em 30 segundos qual ferramenta usar para meu caso, para não perder tempo com a escolha errada (ou quebrar a sessão).

**Why P1**: É o mental model do produto — sem ele, o harness é só 4 packages empilhados.

**Acceptance Criteria** (critérios baseados nos fatos da pesquisa — não inventar capacidades):

1. WHEN o documento de routing é lido THEN ele SHALL conter, para cada ferramenta: o que ela faz, o sinal de uso e a contra-indicação (goal loop: "done precisa de leitor", iteração, métrica honesta obrigatória no `/loop`; taskflow: multi-fase com `dependsOn`, fan-out, budget, resume/replay/recompute — contra-indicado para single-file change e debugging interativo; subagents: delegação ad-hoc, chain com dependência, parallel independente, worktree para edição concorrente, acceptance gates para evidência; review: diff pontual, gate dentro de fluxo, auditor isolado)
2. WHEN o documento é lido THEN ele SHALL explicitar a **two-driver rule**: goal-loop dirige a sessão via `agent_end`; subagents e taskflow entram como workers; nunca dois drivers na mesma sessão
3. WHEN o documento é lido THEN ele SHALL trazer o hello world SDLC (do F7) como exemplo canônico: goal com contrato → dispatch → auditor → review → entrega

**Independent Test**: leitura do documento → para 5 casos de uso dados, a ferramenta indicada confere com a tabela de capacidades dos forks.

### P1: Regras injetáveis ⭐ MVP

**User Story**: Como dev usuário, quero que as regras estejam dentro do meu agente (Pi, Claude, OpenCode, Codex), para a decisão de roteamento acontecer na hora, não só na doc.

**Why P1**: Fecha o ciclo: F15 injeta a seção `runecraft:workflow` — este conteúdo é o produto.

**Acceptance Criteria**:

1. WHEN o F15 injeta a seção `runecraft:workflow` THEN o conteúdo SHALL ser renderizado do template de regras do F19 (determinístico, idempotente — rerun não muda o texto)
2. WHEN o agente é o Pi THEN as regras SHALL cobrir as 4 ferramentas + two-driver
3. WHEN o agente é Claude/OpenCode/Codex THEN as regras SHALL cobrir só o que a coluna dele suporta (F17): taskflow-MCP + review; sem menção a goal-loop/subagents
4. WHEN o template muda entre versões do CLI THEN o sync (F12/F15) SHALL atualizar a seção (upsert por ID — F18)

**Independent Test**: render do template por agente → conteúdo confere com a coluna da matriz; sync após mudança de template → seção atualizada no lugar.

### P2: Driver ativo no doctor/status

**User Story**: Como dev usuário, quero ver qual driver está ativo na sessão, para saber se posso disparar trabalho concorrente sem violar a two-driver rule.

**Why P2**: O limite two-driver é o risco central (F7); visibilidade evita o erro.

**Acceptance Criteria**:

1. WHEN um goal está ativo na sessão Pi THEN o status SHALL indicar "driver: goal-loop" (leitura de estado do glla — a validar no Execute)
2. WHEN nenhum goal/loop ativo THEN o status SHALL indicar "driver: sessão (direto)" e lembrar que subagents/taskflow são workers compatíveis

**Independent Test**: sessão com goal ativo → status mostra o driver.

## Edge Cases

- WHEN o usuário tem gentle-ai instalado (marcadores `gentle-ai:`) THEN as regras do harness SHALL não conflitar com as dele (coexistência F18 — append)
- WHEN um agente não-Pi pede goal-loop nas regras (mencionar o que não existe) THEN o template SHALL não citar ferramentas fora da coluna (AC 1.3)
- WHEN o template referencia o `/loop` sem métrica honesta THEN SHALL incluir o redirecionamento ("sem métrica → use /goal")
- WHEN o hello world muda entre versões THEN o doc SHALL versionar o exemplo (data + resultado do F7)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ROUT-01 | P1: Trigger rules (AC 1.1 tabela por ferramenta) | Design | Pending |
| ROUT-02 | P1: Trigger rules (AC 1.2 two-driver) | Design | Pending |
| ROUT-03 | P1: Trigger rules (AC 1.3 hello world) | Design | Pending |
| ROUT-04 | P1: Regras injetáveis (AC 2.1 template determinístico) | Design | Pending |
| ROUT-05 | P1: Regras injetáveis (AC 2.2/2.3 variação por agente) | Design | Pending |
| ROUT-06 | P1: Regras injetáveis (AC 2.4 sync atualiza) | Design | Pending |
| ROUT-07 | P2: Driver ativo (AC 3.1/3.2) | Design | Pending |

**Coverage:** 7 total, 0 mapeados, 7 unmapped

## Success Criteria

- [ ] Documento de routing validado contra as capacidades reais dos forks (5 casos de uso conferidos)
- [ ] Template injetável renderizado por agente (variação por coluna da matriz), idempotente
- [ ] Hello world SDLC reproduzível a partir da doc (F7)
