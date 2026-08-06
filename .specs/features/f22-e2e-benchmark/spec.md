# F22 — Cenários E2E Versionados Specification

**Scope:** Medium (benchmark executável com modelos reais + resultados datados)
**Prereq:** F7 ✓ (scenarios.md), F19 ✓ (hello world), F21 ✓ (fixture/evidência)
**Grupo:** EVAL (F21–F23) — AD-010

## Problem Statement

O F7 provou coexistência 1x (cenários versionados em `scenarios.md`); o F21 prova orquestração com modelo fakeado. Falta a terceira camada: cenários com **modelos reais** (haiku-class barato) rodando de forma reproduzível e versionada — resultados datados por versão do harness, para que mudanças de prompts/templates tenham evidência de impacto (e o F23 meça não-regressão). Padrão gentle-ai: E2E com agente real gated por env (`GENTLE_AI_REAL_AGENT_E2E=1`), custo alto, fora do merge gate.

## Goals

- [ ] `scenarios.md` (F7) vira benchmark executável com modelos reais (env-gated: `RUNECRAFT_E2E=1`)
- [ ] Resultados datados e versionados: `.specs/features/f22-e2e-benchmark/results/<versão>/<data>.json` (comandos, tempos, tokens aproximados, vereditos)
- [ ] Hello world (F19) como cenário obrigatório de sanity
- [ ] Fora do merge gate (não bloqueia PR; F23 usa os resultados para tendência)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Rodar em toda PR | Custo de tokens; CI lane é do F21 (determinístico) |
| Benchmarks de performance | F21 out-of-scope idem; E2E mede vereditos, não tempo |
| Modelos premium | haiku-class (decisão F7); qualidade de output não é o alvo |
| Automação de comparação entre versões | F23 (ratchet) consome os resultados |

## Gray area (resolver no Design)

**Frequência e gatilho**: (a) manual sob demanda (`RUNECRAFT_E2E=1 bun run eval:e2e`), (b) agendada (cron semanal), (c) em release (pré-tag). **Recomendado: (a)+(c)** — manual para investigação, obrigatório antes de tag de release (F9); cron fica Future.

**Formato do resultado**: JSON com `{harnessVersion, piVersion, model, date, scenarios: [{id, status: pass|fail|limit, durationMs, tokensApprox, notes}]}`. Comparável pelo F23.

## User Stories

### P1: Benchmark E2E executável ⭐ MVP

**User Story**: Como mantenedor, quero rodar os cenários do F7 com modelos reais num comando, para ter evidência de que o harness funciona de ponta a ponta no mundo real.

**Why P1**: É a prova viva (F7 foi 1x; isto é para sempre).

**Acceptance Criteria**:

1. WHEN `RUNECRAFT_E2E=1 bun run eval:e2e` roda num ambiente com Pi + modelos THEN os cenários do F7 (baseline load, goal+subagent chain, taskflow DAG+goal, pr-review com nosso subagents, isolamento do auditor) SHALL executar em repo de teste descartável
2. WHEN um cenário termina THEN o resultado SHALL ser gravado em `results/<versão-do-harness>/<data>.json` com status, duração, tokens aproximados e vereditos
3. WHEN o hello world do F19 roda THEN ele SHALL ser o cenário 0 (sanity — falha dele invalida a rodada)
4. WHEN `RUNECRAFT_E2E` não está setado THEN os cenários SHALL ser skipped (padrão gentle-ai; CI normal fica verde sem tokens)

**Independent Test**: rodada manual completa → JSON por cenário; rodada sem env → skip.

### P1: Resultados versionados ⭐ MVP

**User Story**: Como mantenedor, quero comparar resultados entre versões do harness, para saber se uma mudança melhorou ou piorou o fluxo.

**Why P1**: Sem versionamento, os resultados são anedota.

**Acceptance Criteria**:

1. WHEN uma rodada termina THEN os resultados SHALL ficar em `results/<versão>/` (versão do package harness), sem sobrescrever rodadas anteriores
2. WHEN a versão do harness não mudou THEN uma nova rodada SHALL criar um arquivo novo (timestamp no nome)
3. WHEN o F23 roda THEN ele SHALL ler as rodadas por versão para a tendência de pass rate

**Independent Test**: 2 rodadas mesma versão → 2 arquivos; rodada após bump de versão → dir novo.

### P2: Documentação do procedimento

**User Story**: Como dev usuário, quero saber como rodar e interpretar o benchmark, para contribuir com evidência.

**Why P2**: Repro é parte do valor (F8 docs).

**Acceptance Criteria**:

1. WHEN a doc do harness é lida THEN ela SHALL documentar: pré-requisitos (Pi + modelos + gh), comando, o que cada cenário cobre, como ler os resultados

**Independent Test**: alguém segue a doc e roda uma rodada completa.

## Edge Cases

- WHEN o modelo está indisponível (rate limit) THEN o cenário SHALL reportar `fail (infra)` distinguindo de `fail (harness)` — infra não conta como regressão no F23
- WHEN um cenário exige PR real (pr-review) THEN SHALL criar PR de teste descartável (padrão F5)
- WHEN a rodada é interrompida THEN os cenários completos SHALL permanecer gravados (parcial ok, marcado)
- WHEN o ambiente tem gentle-ai instalado THEN a rodada SHALL registrar o fato (confundidor para vereditos)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| E2EV-01 | P1: Benchmark (AC 1.1 cenários F7) | Design | Pending |
| E2EV-02 | P1: Benchmark (AC 1.2 resultado gravado) | Design | Pending |
| E2EV-03 | P1: Benchmark (AC 1.3 hello world sanity) | Design | Pending |
| E2EV-04 | P1: Benchmark (AC 1.4 env-gated skip) | Design | Pending |
| E2EV-05 | P1: Versionado (AC 2.1/2.2/2.3) | Design | Pending |
| E2EV-06 | P2: Doc (AC 3.1) | Design | Pending |

**Coverage:** 6 total, 0 mapeados, 6 unmapped

## Success Criteria

- [ ] `RUNECRAFT_E2E=1 bun run eval:e2e` roda os cenários do F7 com resultados JSON datados
- [ ] Hello world é sanity obrigatório (rodada sem ele é inválida)
- [ ] CI normal sem env → skip (zero tokens)
