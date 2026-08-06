# F23 — Ratchet Baselines Specification

**Scope:** Medium (baselines de não-regressão + goldens de assets)
**Prereq:** F21 ✓ (suite determinística), F22 ✓ (resultados E2E)
**Grupo:** EVAL (F21–F23) — AD-010

## Problem Statement

Testes pegam regressão quando alguém roda; ratchets pegam **crescimento silencioso**. O gentle-ai congela baselines com a filosofia "freezing today's violations and refusing growth is the part that pays for itself": identidade estável (nunca linha), fail-only-on-worse, colação pinada (`LC_ALL=C`), `--update` explícito. Verificado (pesquisa 2026-08-05): `.refusal-ratchet-baseline.txt` (keyed por (file, mensagem), "may only shrink"), `.deadcode-baseline.txt` (falha se ENTRAM símbolos, avisa se saem), `.guard-population-baseline.txt` (declarações `guard:population` congeladas com sha256). F23 transfere os 3 padrões para o harness TS + goldens de assets (drift de prompts/templates).

## Goals

- [ ] Ratchet de falhas conhecidas da suite determinística: baseline keyed por identidade estável; CI falha se ENTRA falha nova, avisa se sai; `--update` explícito
- [ ] Golden files de assets (templates de regras do F19, seção `runecraft:workflow`, prompts) — drift detection em unit test
- [ ] Tendência de pass rate do E2E (F22): fail-only-on-worse por versão
- [ ] Colação pinada e normalização (os 3 padrões gentle-ai)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Deadcode para TS | Ferramenta do gentle-ai é Go (x/tools); TS equivalentes imaturos — trocar por métrica de cobertura de comandos |
| Baselines de refusals (não temos refusals de produto) | Se surgirem mensagens de recusa (fail-closed), vira AD + baseline |
| Dashboards/telemetria | F8 docs; ratchets são arquivos + CI |
| Autocorreção de baselines em PR | Update é humano e explícito (padrão gentle-ai) |

## Gray area (resolver no Design)

**Métricas v1 concretas** (proposta — validar no design):

1. **Falhas conhecidas da suite** (F21): arquivo `baselines/known-failures.txt` — identidade estável `(testFile, testName, mensagem normalizada)`; CI falha se uma falha nova aparece; falha conhecida que some → aviso para remover do baseline.
2. **Cobertura de comandos** (F21 camada 1): `baselines/command-coverage.txt` — lista de comandos+flags exercitados; CI falha se um comando deixa de ser coberto (a lista só cresce).
3. **Goldens de assets**: `test/golden/*.golden` — templates (rules.ts do F19), prompts, seções `runecraft:workflow` renderizadas, configs MCP renderizadas (F15); unit test compara render atual vs golden; `--update` regenera.
4. **Pass rate E2E** (F22): `baselines/e2e-passrate.txt` — `(versão, cenário, pass|fail|limit, data)`; CI/release compara rodada nova vs baseline da versão anterior: pass rate não piora; `fail (infra)` não conta (F22 edge).

> Nota (resolvida no design 2026-08-05, M1): o `e2e-passrate.txt` final registra **por versão sem data na linha** — a data vive no filename dos results do F22; data no baseline só produziria diff ruidoso a cada `--update`.

## User Stories

### P1: Ratchet de falhas conhecidas ⭐ MVP

**User Story**: Como mantenedor, quero que falhas conhecidas fiquem congeladas e explícitas, para que o conjunto nunca cresça em silêncio.

**Why P1**: É o padrão central do gentle-ai ("may only shrink").

**Acceptance Criteria**:

1. WHEN a suite determinística (F21) falha num teste THEN o CI SHALL comparar a falha contra o baseline por identidade estável `(testFile, testName, mensagem normalizada)`
2. WHEN a falha é nova (não está no baseline) THEN o CI SHALL falhar (regressão real)
3. WHEN a falha está no baseline THEN o CI SHALL passar com a falha listada (congelada)
4. WHEN uma falha do baseline deixa de acontecer THEN o CI SHALL avisar (remover do baseline)
5. WHEN `bun run eval:ratchet --update` roda THEN o baseline SHALL ser atualizado com as falhas atuais (explícito, humano)

**Independent Test**: baseline com falha A → CI verde com A listada; introduzir falha B → CI vermelho; `--update` → baseline com A+B; corrigir A → aviso.

### P1: Goldens de assets ⭐ MVP

**User Story**: Como mantenedor, quero que mudanças em templates/prompts apareçam no diff de teste, para que drift de conteúdo seja revisado como código.

**Why P1**: Templates injetados nos agentes (F15/F19) mudam o comportamento do produto — mudança precisa de revisão.

**Acceptance Criteria**:

1. WHEN um template (regras do F19, seção `runecraft:workflow`, config MCP do F15) é renderizado THEN o unit test SHALL comparar com o golden correspondente
2. WHEN o render diverge do golden THEN o teste SHALL falhar mostrando o diff
3. WHEN `--update` roda THEN os goldens SHALL ser regenerados (diff revisável na PR)

**Independent Test**: mudar o template → teste falha com diff; `--update` → golden novo, teste verde.

### P2: Tendência E2E

**User Story**: Como mantenedor, quero que a rodada E2E (F22) não regrida em vereditos, para saber que mudanças não pioraram o fluxo real.

**Why P2**: O E2E é caro — o ratchet dá retorno do investimento.

**Acceptance Criteria**:

1. WHEN uma rodada E2E (F22) termina THEN o pass rate SHALL ser comparado com o baseline da versão anterior
2. WHEN o pass rate piora (excluindo `fail (infra)`) THEN o processo (release) SHALL sinalizar regressão
3. WHEN `--update` roda THEN o baseline de pass rate SHALL ser atualizado

**Independent Test**: rodada com cenário que falhou (não-infra) → sinalização; rodada limpa → baseline atualizado.

## Edge Cases

- WHEN a mensagem de falha varia entre runs (timestamps, paths) THEN a normalização SHALL remover variações conhecidas (padrão: identidade estável, nunca linha crua)
- WHEN o ambiente do CI muda (versão de bun/node) THEN as falhas de ambiente SHALL ser marcadas e excluídas do ratchet (tipo `fail (infra)` do F22)
- WHEN um golden muda de propósito (conteúdo deliberadamente novo) THEN `--update` + revisão na PR SHALL ser o fluxo (nunca editar golden à mão fora de PR)
- WHEN dois baselines apontam para o mesmo teste THEN a identidade SHALL deduplicar (uma entrada canônica)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| RCTH-01 | P1: Ratchet falhas (AC 1.1/1.2/1.3/1.4) | Design | Pending |
| RCTH-02 | P1: Ratchet falhas (AC 1.5 --update) | Design | Pending |
| RCTH-03 | P1: Goldens (AC 2.1/2.2/2.3) | Design | Pending |
| RCTH-04 | P2: Tendência E2E (AC 3.1/3.2/3.3) | Design | Pending |

**Coverage:** 4 total, 0 mapeados, 4 unmapped

## Success Criteria

- [ ] CI falha em falha nova, passa com falha congelada, avisa quando some (verificado com testes induzidos)
- [ ] Golden de templates detecta drift (diff revisável)
- [ ] Pass rate E2E não regride silenciosamente (sinalização em release)
