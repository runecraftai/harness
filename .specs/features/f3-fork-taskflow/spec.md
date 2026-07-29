# F3 — Fork @runecraft/taskflow (core + pi + dsl) Specification

**Scope:** Large (3 packages acoplados por workspace dep + build dist/ + CLI)
**Prereq:** F1 ✓ (pins verificados: heggria/taskflow v0.2.6, subpaths confirmados)

## Problem Statement

O taskflow upstream é um monorepo pnpm; nossos 3 packages (core, pi, dsl) precisam viver no monorepo bun do harness com identidade `@runecraft/*`, builds `dist/` funcionais (o manifest Pi aponta `./dist/index.js`) e a dependência interna `taskflow-core: workspace:*` re-apontada — mantendo as suites de teste do upstream verdes.

## Goals

- [ ] 3 packages vendorados, renomeados e buildando via turbo
- [ ] `/tf` funcional no Pi; DSL compila `.tf.ts` → JSON aceito pelo core

## Out of Scope

| Feature | Reason |
| --- | --- |
| Camada MCP (taskflow-mcp-core, taskflow-hosts, 4 adapters) | AD-007 — deferred até cross-agent virar milestone |
| Compatibilidade pnpm | Monorepo é bun; scripts adaptados onde necessário |
| Docs site do taskflow | F8 cobre READMEs |

## Decisões da spec (assumptions)

- **Renames**: `taskflow-core` → `@runecraft/taskflow-core`; `pi-taskflow` → `@runecraft/taskflow`; `taskflow-dsl` → `@runecraft/taskflow-dsl`. Imports TS `from "taskflow-core"` → `from "@runecraft/taskflow-core"`; dep interna vira `"@runecraft/taskflow-core": "workspace:*"` (bun suporta).
- **Build shape preservado** (AD-006): cada package mantém seu tsc build → `dist/`; turbo orquestra. `.tf.ts` continua compile-time only.
- **bin do DSL**: renomear o comando para evitar colisão com upstream global (`taskflow-dsl` → manter nome do bin é aceitável se documentado; decisão final no Execute — registrar).

---

## User Stories

### P1: Vendor + rename dos 3 packages ⭐ MVP

**User Story**: Como mantenedor, quero os 3 packages do taskflow no harness com identidade `@runecraft/*` para evoluí-los como parte do produto.

**Acceptance Criteria**:

1. WHEN `bun run vendor taskflow-core|taskflow-pi|taskflow-dsl` rodam THEN os 3 SHALL extrair para `packages/taskflow/{core,pi,dsl}` com `vendor.json` cada
2. WHEN os `package.json` são lidos THEN os names SHALL ser `@runecraft/taskflow-core`, `@runecraft/taskflow`, `@runecraft/taskflow-dsl`
3. WHEN o source é grepado THEN nenhum import THEN SHALL referenciar `taskflow-core`/`pi-taskflow`/`taskflow-dsl` como specifier npm antigo
4. WHEN `bun install` roda THEN a dep interna `@runecraft/taskflow-core: workspace:*` SHALL resolver para o workspace local

**Independent Test**: `bun install` exit 0 com os 3 workspaces resolvidos; grep de specifiers antigos vazio.

### P1: Build + testes verdes ⭐ MVP

**User Story**: Como mantenedor, quero builds e testes do upstream verdes para garantir paridade comportamental.

**Acceptance Criteria**:

1. WHEN `bun run build` roda na raiz THEN turbo SHALL buildar os 3 packages gerando `dist/` (core antes de pi/dsl por dependência)
2. WHEN as suites de teste dos 3 packages rodam THEN elas SHALL passar
3. WHEN o build do pi adapter completa THEN `packages/taskflow/pi/dist/index.js` SHALL existir (target do manifest Pi)

**Independent Test**: `bun run build && (testes dos 3)` exit 0.

### P1: `/tf` funcional no Pi ⭐ MVP

**User Story**: Como dev usuário, quero rodar um taskflow no Pi usando nosso fork.

**Acceptance Criteria**:

1. WHEN o package `@runecraft/taskflow` é carregado num projeto de teste THEN o Pi SHALL registrar a extensão sem erro
2. WHEN um flow JSON trivial (1 fase agent ou script) é salvo em `.pi/taskflows/` THEN `/tf:<name>` SHALL executá-lo até o fim
3. WHEN o flow tem erro estrutural (dependência dangling) THEN a verificação estática SHALL rejeitar antes de qualquer chamada de modelo

**Independent Test**: flow de 1 fase `script` (zero tokens) roda e retorna resultado.

### P2: DSL compila e valida

**User Story**: Como dev usuário, quero autorar flows em TypeScript e compilar para JSON.

**Acceptance Criteria**:

1. WHEN `check` roda num `.tf.ts` de exemplo THEN o DSL SHALL validar sem erro
2. WHEN `build --emit both` roda THEN SHALL emitir `.taskflow.json` (+ FlowIR) aceito pelo core/verify

**Independent Test**: exemplo do upstream compilado → JSON roda no `/tf`.

---

## Edge Cases

- WHEN scripts upstream assumem pnpm (`pnpm -r`, workspace protocol em devDeps) THEN os scripts SHALL ser adaptados para bun/turbo sem mudar o output
- WHEN tsconfig dos packages referenciam paths do monorepo upstream (extends/references) THEN eles SHALL ser reapontados para o layout `packages/taskflow/*`
- WHEN o pi adapter espelha nomes upstream em configs (`taskflow.piChild` em settings) THEN os nomes de config SHALL ser preservados (runtime ID, mesma regra do F2)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| TFLW-01 | P1: Vendor 3 subpaths + vendor.json | Execute | Pending |
| TFLW-02 | P1: Rename + workspace dep + imports | Execute | Pending |
| TFLW-03 | P1: Build dist/ via turbo (ordem core→pi/dsl) | Execute | Pending |
| TFLW-04 | P1: Testes dos 3 verdes | Execute | Pending |
| TFLW-05 | P1: `/tf` no Pi + verificação estática | Execute | Pending |
| TFLW-06 | P2: DSL check/build → JSON aceito | Execute | Pending |

## Success Criteria

- [ ] 3 packages buildando e testando verdes no monorepo bun
- [ ] Flow trivial executa via `/tf` no Pi com nosso fork
- [ ] `.tf.ts` de exemplo compila e roda
