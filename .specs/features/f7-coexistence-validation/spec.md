# F7 — Coexistence Validation Specification

**Scope:** Medium (validação estruturada; pouco código novo, cenários E2E)
**Prereq:** F6 ✓

## Problem Statement

A análise de sobreposição previu que os 4 packages coexistem (matriz de conflitos), mas previsão não é prova. O risco central é a **two-driver rule**: goal-loop-audit dirige continuation via `agent_end` enquanto subagents/taskflow disparam trabalho na mesma sessão. F7 valida ao vivo os pontos de atrito e registra os limites reais de uso combinado.

## Goals

- [ ] Cenários de coexistência executados e documentados (passa/falha/limite)
- [ ] Um fluxo SDLC E2E completo provado com os 4 juntos

## Out of Scope

| Feature | Reason |
| --- | --- |
| Corrigir bugs profundos de interação | Vira issue/feature própria; F7 documenta e reporta |
| Benchmarks de performance | Não é objetivo do v1 |
| Automatizar E2E em CI | Exige modelos reais; CI é F9 e não roda cenários com tokens |

## Decisões da spec (assumptions)

- **Modelo barato nos cenários** (haiku-class) — o que se valida é interação, não qualidade de output.
- **Cenários viram doc versionada** (`.specs/features/f7-coexistence-validation/scenarios.md`) com resultado, data e limites encontrados — insumo direto para a doc do F8.

---

## User Stories

### P1: Matriz de atrito validada ⭐ MVP

**User Story**: Como mantenedor, quero cada ponto de atrito previsto testado ao vivo para publicar o harness com limites conhecidos em vez de surpresas.

**Acceptance Criteria**:

1. WHEN uma sessão Pi carrega os 4 via umbrella THEN o load SHALL completar sem erro e todos os comandos/tools SHALL registrar (baseline)
2. WHEN um goal está ativo e um `subagent` chain roda na mesma sessão THEN o loop do goal SHALL continuar são (sem continuation dupla, sem clobber de session handle — subagent activity conta como atividade, não hang)
3. WHEN um taskflow DAG roda enquanto um goal está ativo THEN ambos SHALL completar sem interferência de estado
4. WHEN o pr-review dispara seus reviewers com nosso subagents instalado THEN o review SHALL completar (dispatch compatível)
5. WHEN qualquer cenário falha THEN o resultado SHALL ser registrado com repro mínimo e classificado: bug de fork / limite documentável / conflito arquitetural

**Independent Test**: `scenarios.md` com os 4+ cenários, cada um com resultado datado.

### P1: Fluxo SDLC E2E ⭐ MVP

**User Story**: Como dev usuário, quero ver o harness inteiro cobrindo um ciclo real: goal com contrato → implementação via subagents/taskflow → auditor isolado → review.

**Acceptance Criteria**:

1. WHEN um goal trivial com `Done when:` é criado num repo de teste THEN a implementação SHALL rodar via dispatch (subagents ou taskflow), o auditor isolado SHALL verificar com evidência e o ciclo SHALL fechar
2. WHEN o ciclo fecha THEN o cenário completo (comandos, tempos, tokens aproximados) SHALL ser documentado como o "hello world" do harness

**Independent Test**: repo de teste descartável, ciclo completo executado 1x, transcript/resultado anotado.

---

## Edge Cases

- WHEN goal-loop-audit e subagents disputam notificação de completion THEN o comportamento observado SHALL ser documentado (batching vs push do goal)
- WHEN o auditor isolado roda com o umbrella instalado THEN ele SHALL permanecer sem extensões (isolamento não pode ser quebrado pelo harness — teste explícito)
- WHEN dois cenários rodam em paralelo no mesmo repo THEN limites de concorrência SHALL ser documentados (não suportado é resposta aceitável)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| COEX-01 | P1: Baseline load dos 4 | Execute | Pending |
| COEX-02 | P1: Goal ativo + subagent chain | Execute | Pending |
| COEX-03 | P1: Taskflow DAG + goal ativo | Execute | Pending |
| COEX-04 | P1: pr-review com nosso subagents | Execute | Pending |
| COEX-05 | P1: SDLC E2E documentado | Execute | Pending |
| COEX-06 | P1: Isolamento do auditor sob umbrella | Execute | Pending |

## Success Criteria

- [ ] Todos os cenários executados com resultado registrado
- [ ] Zero conflitos arquiteturais não documentados
- [ ] "Hello world" SDLC reproduzível a partir da doc
