# F2 — Fork @runecraft/subagents Specification

**Scope:** Medium (source vendorado; rename + gates + carga no Pi)
**Prereq:** F1 ✓ (source em `packages/subagents/`, pi-subagents 0.37.2, SHA 8063333)

## Problem Statement

O source do pi-subagents está vendorado mas ainda é o package upstream: nome, bin, exports e installer apontam para a identidade original. Para publicar e evoluir como `@runecraft/subagents`, a identidade do package precisa mudar sem quebrar comportamento — provado pelos testes do próprio upstream e pela carga real no Pi.

## Goals

- [ ] `packages/subagents` é `@runecraft/subagents` com testes do upstream verdes
- [ ] Extensão carrega no Pi e o tool `subagent` funciona igual ao upstream

## Out of Scope

| Feature | Reason |
| --- | --- |
| Rename de identificadores de runtime (`.pi-subagents/` artifact dirs, `PI_SUBAGENT_*` env vars, canais `subagents:rpc:v1`) | Comportamento interno; rename aumenta diff de sync (AD-006). Fork é substituto do upstream, não companion |
| Melhorias funcionais sobre o upstream | Pós-v1 (raison d'être do fork, mas depois do baseline verde) |
| Publicação npm | F9 |

## Decisões da spec (assumptions)

- **Identidade vs runtime**: renomeia-se a identidade npm (name, exports self-references, bin); preservam-se identificadores de runtime. Consequência documentada: **incompatível com pi-subagents upstream instalado junto** (tool `subagent`, dirs e canais colidem).
- **`install.mjs` removido** (e o `bin`): o installer clona `nicobailon/pi-subagents.git` hardcoded — errado para o fork. Instalação: `pi install npm:@runecraft/subagents` ou umbrella (F6).
- **`package-lock.json` removido**: o monorepo usa `bun.lock`.
- **e2e é best-effort**: `test:e2e` spawna sessões Pi reais; gate obrigatório = unit + integration. e2e roda se o ambiente local tiver Pi; resultado documentado.

---

## User Stories

### P1: Identidade @runecraft/subagents ⭐ MVP

**User Story**: Como mantenedor do harness, quero o package com identidade `@runecraft/subagents` para publicar e evoluir de forma independente do upstream.

**Acceptance Criteria**:

1. WHEN `package.json` é lido THEN `name` SHALL ser `@runecraft/subagents`, sem `bin`, mantendo `exports` subpaths (`./delegation`, `./preflight`, `./background-work`, `./capability-ceiling`) funcionais
2. WHEN o source é grepado por `pi-subagents` THEN as ocorrências restantes SHALL ser apenas identificadores de runtime preservados (artifact dirs, profiles dir, user-agents) ou docs — nenhuma referência de import/require npm ao nome antigo
3. WHEN `install.mjs` e `package-lock.json` são procurados THEN eles SHALL não existir
4. WHEN `vendor.json` é lido THEN ele SHALL permanecer intacto (proveniência preservada)

**Independent Test**: `grep -r "from \"pi-subagents" packages/subagents/src packages/subagents/test` retorna vazio; `bun install` resolve o workspace com o novo nome.

### P1: Comportamento provado pelos testes do upstream ⭐ MVP

**User Story**: Como mantenedor, quero a suite do upstream verde no fork para garantir que o rename não quebrou nada.

**Acceptance Criteria**:

1. WHEN `test:unit` roda THEN todos os testes SHALL passar
2. WHEN `test:integration` roda THEN todos os testes SHALL passar
3. WHEN `test:e2e` roda em ambiente com Pi THEN o resultado SHALL ser documentado (verde ou falhas explicadas); e2e não bloqueia o gate
4. WHEN `bun run lint`/`bun run build` rodam na raiz THEN SHALL permanecer verdes (packages/** segue fora do escopo do biome)

**Independent Test**: `cd packages/subagents && npm run test:unit && npm run test:integration` exit 0.

### P1: Carga real no Pi ⭐ MVP

**User Story**: Como dev usuário, quero instalar o fork no Pi e usar o tool `subagent` normalmente.

**Acceptance Criteria**:

1. WHEN o package é adicionado ao settings de um projeto de teste (path local) THEN o Pi SHALL carregar a extensão sem erro
2. WHEN `subagent({ action: "list" })` roda THEN os builtins (scout, planner, worker, reviewer, oracle, researcher, context-builder, delegate) SHALL listar
3. WHEN `subagent({ action: "doctor" })` roda THEN o diagnóstico SHALL reportar setup saudável
4. WHEN um `scout` trivial é despachado THEN ele SHALL executar em processo filho e retornar output

**Independent Test**: projeto de teste com `.pi/settings.json` apontando para o fork → `pi -p "use subagent list action"` retorna builtins.

---

## Edge Cases

- WHEN os testes do upstream referenciam o nome `pi-subagents` em fixtures/snapshots THEN os fixtures SHALL ser atualizados junto (parte do rename, não skip de teste)
- WHEN `jiti`/`typebox`/`yaml` (deps reais) resolvem via workspace THEN as versões pinadas do upstream SHALL ser mantidas
- WHEN o usuário tem pi-subagents upstream instalado globalmente THEN a documentação SHALL avisar a incompatibilidade (não instalar junto)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SUBA-01 | P1: Identidade (rename + exports) | Execute | Pending |
| SUBA-02 | P1: Identidade (remoção bin/installer/lock) | Execute | Pending |
| SUBA-03 | P1: Testes unit+integration verdes | Execute | Pending |
| SUBA-04 | P1: Carga no Pi (list/doctor/scout) | Execute | Pending |
| SUBA-05 | P1: Runtime IDs preservados + incompat documentada | Execute | Pending |

## Success Criteria

- [ ] Suite unit + integration do upstream 100% verde no fork renomeado
- [ ] `subagent({ action: "list" })` funcional via carga local no Pi
- [ ] Zero imports pelo nome antigo; proveniência (vendor.json) intacta
