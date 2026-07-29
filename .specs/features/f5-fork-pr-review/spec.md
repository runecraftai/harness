# F5 — Fork @runecraft/pr-review Specification

**Scope:** Medium (1 package, Node ≥20)
**Prereq:** F1 ✓ (pin verificado: 10ego/pi-pr-review v1.11.4)

## Problem Statement

O pi-pr-review fecha a camada de qualidade do harness (review paralelo de PRs com subagentes em tiers e publicação COMMENT-only), mas precisa virar `@runecraft/pr-review` com testes verdes e comando funcional no Pi — incluindo verificar como ele despacha subagentes (mecanismo próprio vs pi-subagents) para o F7 validar a integração com nosso fork.

## Goals

- [ ] Package renomeado com testes do upstream verdes
- [ ] Comando de review registra no Pi; mecanismo de dispatch mapeado e documentado

## Out of Scope

| Feature | Reason |
| --- | --- |
| Review live de PR real como gate | Exige repo GitHub + `gh` auth + tokens; validação manual documentada 1x |
| Integração validada com @runecraft/subagents | F7 (coexistence) |
| Publicação de comments em PRs de terceiros | Só em repo de teste próprio |

## Decisões da spec (assumptions)

- **Dispatch mapeado no Execute**: o README upstream diz "model-agnostic tiered subagents" sem cravar dependência. Primeiro passo do Execute é mapear: dispatch próprio, ou integração com pi-subagents (se importar/detectar `pi-subagents`, reapontar para `@runecraft/subagents` faz parte do rename).
- **Gate = suite do upstream**: review real (com `gh` + PR de teste) é validação manual documentada, não gate.

---

## User Stories

### P1: Identidade + testes verdes ⭐ MVP

**User Story**: Como mantenedor, quero `@runecraft/pr-review` com a suite do upstream verde.

**Acceptance Criteria**:

1. WHEN `bun run vendor pr-review` roda THEN o source SHALL extrair para `packages/pr-review/` com `vendor.json`
2. WHEN `package.json` é lido THEN `name` SHALL ser `@runecraft/pr-review`
3. WHEN a suite de testes do upstream roda THEN ela SHALL passar
4. WHEN o source é grepado THEN nenhum import npm SHALL referenciar `pi-pr-review`; se houver referências a `pi-subagents` THEN elas SHALL ser reapontadas para `@runecraft/subagents`

**Independent Test**: suite exit 0; grep de specifiers antigos vazio.

### P1: Carga no Pi ⭐ MVP

**User Story**: Como dev usuário, quero o comando de review disponível numa sessão Pi.

**Acceptance Criteria**:

1. WHEN o package carrega num projeto de teste THEN o Pi SHALL registrar a extensão e seus comandos sem erro
2. WHEN o comando de review roda fora de um repo com PR THEN ele SHALL falhar com mensagem clara (não crash)

**Independent Test**: sessão Pi de teste registra o comando; invocação sem PR retorna erro amigável.

### P2: Review live documentado (1x)

**User Story**: Como mantenedor, quero uma execução real registrada para saber que o fluxo E2E funciona no fork.

**Acceptance Criteria**:

1. WHEN um review roda contra um PR de teste em repo próprio THEN findings estruturados SHALL ser produzidos e publicação SHALL ser COMMENT-only
2. WHEN a execução completa THEN o resultado SHALL ser registrado na spec (Notas de execução)

**Independent Test**: 1 review real em repo de teste, resultado anotado.

---

## Edge Cases

- WHEN `gh` não está autenticado THEN o comando SHALL degradar com instrução clara (comportamento upstream preservado)
- WHEN o dispatch depender de runtime IDs do pi-subagents (tool `subagent`) THEN a compat com nosso fork SHALL ser verificada (nosso fork preserva runtime IDs — deve funcionar; confirmar no F7)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PREV-01 | P1: Vendor + rename (+ reapontar subagents se houver) | Execute | Pending |
| PREV-02 | P1: Testes upstream verdes | Execute | Pending |
| PREV-03 | P1: Carga no Pi + erro amigável sem PR | Execute | Pending |
| PREV-04 | P2: Review live 1x documentado | Execute | Pending |

## Success Criteria

- [ ] Suite do upstream verde no fork renomeado
- [ ] Comando registra no Pi; mecanismo de dispatch documentado
- [ ] 1 review real executado e anotado
