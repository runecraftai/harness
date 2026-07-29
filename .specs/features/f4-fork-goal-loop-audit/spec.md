# F4 — Fork @runecraft/goal-loop-audit Specification

**Scope:** Medium (1 package, zero deps, suite mock-ctx sem Pi live)
**Prereq:** F1 ✓ (pin por SHA `21b6bb0` = 0.28.34; repo sem tags)

## Problem Statement

O pi-goal-list-loop-audit traz o padrão mais valioso do harness — auditor isolado em sessão fresh que o implementador não consegue enganar — mas precisa virar `@runecraft/goal-loop-audit` mantendo os 545 testes verdes e os comandos `/goal`, `/list`, `/loop`, `/glla` funcionais no Pi.

## Goals

- [ ] Package renomeado com a suite completa do upstream verde
- [ ] Comandos registram no Pi e o loop dirige continuation via `agent_end`

## Out of Scope

| Feature | Reason |
| --- | --- |
| Rodar `scripts/smoke.sh` como gate | Exige tmux + modelos reais (custo/flakiness); fica como validação manual documentada |
| Validação de coexistência com subagents/taskflow | F7 |
| Rename de state dirs/env internos | Runtime IDs preservados (mesma regra AD do F2) |

## Decisões da spec (assumptions)

- **Gate = suite mock-ctx**: os 545 testes rodam sem Pi live (harness de mock do upstream) — é o gate obrigatório. Auditoria real com modelo fica para F7/smoke manual.
- **Two-driver rule preservada**: o upstream declara conflitos duros com outros drivers de `agent_end` (pi-goal*, ralphi etc.). O fork herda e documenta a mesma lista.

---

## User Stories

### P1: Identidade + suite verde ⭐ MVP

**User Story**: Como mantenedor, quero `@runecraft/goal-loop-audit` com os 545 testes do upstream verdes para garantir que o rename não alterou o state machine.

**Acceptance Criteria**:

1. WHEN `bun run vendor goal-loop-audit` roda THEN o source SHALL extrair para `packages/goal-loop-audit/` com `vendor.json` (resolvedSha = 21b6bb0…)
2. WHEN `package.json` é lido THEN `name` SHALL ser `@runecraft/goal-loop-audit` e o manifest `pi` SHALL continuar apontando `extensions/loops/goal.ts`
3. WHEN a suite de testes roda THEN os 545 testes (58 arquivos) SHALL passar
4. WHEN o source é grepado THEN nenhum import npm SHALL referenciar o nome antigo

**Independent Test**: suite completa exit 0 no diretório do package.

### P1: Comandos funcionais no Pi ⭐ MVP

**User Story**: Como dev usuário, quero `/goal`, `/list`, `/loop` e `/glla` funcionando com o fork.

**Acceptance Criteria**:

1. WHEN o package carrega num projeto de teste THEN o Pi SHALL registrar os comandos sem erro
2. WHEN `/goal status` roda sem goal ativo THEN o comando SHALL responder estado vazio (sem crash)
3. WHEN `/glla` roda THEN a UI/tabela de settings SHALL renderizar
4. WHEN um goal trivial com contrato (`Done when:`) é criado e cancelado THEN o ciclo draft→active→cancel SHALL persistir estado em disco corretamente

**Independent Test**: sessão Pi de teste: criar goal com contrato explícito → `/goal status` mostra ativo → `/goal cancel` limpa.

### P2: Auditor isolado spawna (validação leve)

**User Story**: Como dev usuário, quero confirmar que o auditor isolado dispara em sessão fresh.

**Acceptance Criteria**:

1. WHEN `/goal audit` roda com goal ativo THEN um processo Pi isolado (sem extensões/skills) SHALL ser spawnado e retornar veredito
2. WHEN o auditor aprova sem evidência por item do contrato THEN o `regression_shield` SHALL rejeitar a aprovação

**Independent Test**: goal trivial + `/goal audit` → veredito com evidência citada (1 rodada, modelo barato).

---

## Edge Cases

- WHEN o repo upstream não tem tag THEN o sync futuro (F10) SHALL pinar por SHA — vendor.json já registra
- WHEN outro driver de `agent_end` estiver instalado (goal plugins, ralph) THEN a doc SHALL listar os conflitos duros herdados do upstream
- WHEN o modelo do auditor não está autenticado THEN o comportamento upstream (aviso + `/glla model=` fix) SHALL ser preservado

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| GLLA-01 | P1: Vendor + rename + manifest | Execute | Pending |
| GLLA-02 | P1: 545 testes verdes | Execute | Pending |
| GLLA-03 | P1: Comandos registram e ciclo goal persiste | Execute | Pending |
| GLLA-04 | P2: Auditor isolado + regression_shield | Execute | Pending |

## Success Criteria

- [ ] Suite completa do upstream verde no fork
- [ ] Ciclo goal draft→active→cancel funcional no Pi
- [ ] Auditor isolado spawna e exige evidência (validação leve executada 1x)
