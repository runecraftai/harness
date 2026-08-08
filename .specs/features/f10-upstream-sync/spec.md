# F10 — Upstream Sync Workflow Specification

**Scope:** Large (engine three-way + CLI + auto-rename + group sync MCP + runbook; >10 tasks)
**Prereq:** F7 ✓ (baseline validado — sync sem baseline não tem gate) · F16 ✓ (camada MCP vendorada — agora in-scope) · F23 ✓ (ratchet + goldens como gate)
**Status:** Spec ATUALIZADA 2026-08-08 (pós F28/F29). Spec original: 2026-07-29. Ver "Alterações vs spec original".

## Problem Statement

Assumimos o custo de manter os forks em sincronia com upstreams que evoluem rápido (subagents lança semanalmente). Sem tooling, cada sync vira arqueologia manual: o que mudou upstream, o que mudamos localmente, como aplicar um sobre o outro. O `vendor.json` por dest (F1/F16, 12 entries com `resolvedSha`) registra a base exata — F10 transforma isso num fluxo repetível de three-way merge, com auto-rename `@runecraft/*` e gate de regressão completo.

## Alterações vs spec original (documentadas)

| # | Item | Spec original (2026-07-29) | Agora | Motivo |
| --- | --- | --- | --- | --- |
| A1 | Camada MCP do taskflow | Out of scope ("Não vendorada, AD-007") | **In-scope** (SYNC-06: grupo taskflow = 9 entries, incl. 6 da camada MCP) | F16 re-vendorou a camada MCP (v0.2.6, SHA `3c2dfdb`) — AD-007 revogado pelo AD-009 |
| A2 | Comando | `bun run sync <name> --to <ref>` | `bun run sync:upstream <name> --to <ref>` (`scripts/sync-upstream.ts`) | Colisão com o CLI `harness sync` (F12/F17/F19 — re-inject de configs gerenciadas). Roadmap: "script sync-upstream" |
| A3 | Gate pós-sync | "suites do package + lint/build" | per-package `bun test` + harness 939 testes + ratchet (F23) sem `--update` + goldens + `turbo build` | Realidade pós-F23 (ratchet/goldens existem como gate) |
| A4 | Base do three-way | "resolvedSha gravado no vendor.json" | Mantido — agora **verificado**: os 12 dests têm `vendor.json` com `resolvedSha` (incl. os 9 do taskflow, SHA `3c2dfdb`) | F1/F16 escreveram proveniência em todos os dests |
| A5 | Engine de merge | `git apply --3way` (a validar) | `git merge-file` em base materializada (zero deps; git já é requisito do harness) | Decisão D1 no design.md |
| A6 | Proveniência | Só `vendor.json` | `vendor.json` (por dest) **+** `vendor.manifest.json` (ref do pin) | O manifest é a fonte de pins; sync precisa atualizar os dois de forma consistente |
| A7 | Renames | "parte do ours" — conflitos manuais | Auto-rename pass via config por fork (SYNC-07); manual só para conflitos semânticos | Roadmap F10: "rename @runecraft/* (auto-references)" |
| A8 | BUG-1/BUG-2 (taskflow) | Não existiam (registrados no F7) | Surface como open question Q1; recomendação: fixar no 1º ciclo de sync do taskflow | Ordem de execução aprovada: "avaliar com o usuário na entrada do F10" |

## Goals

- [ ] `bun run sync:upstream <name> --to <ref>` computa e aplica o delta do upstream sobre o fork com three-way merge, conflitos marcados no arquivo (nunca silenciosos) e proveniência consistente
- [ ] `--group taskflow` sincroniza os 9 packages (core/pi/dsl + camada MCP F16) com **1** tarball e codifica o re-vendor manual do F16
- [ ] Processo documentado (`docs/SYNC.md`): detectar → dry-run → aplicar → resolver → re-testar → registrar
- [ ] BUG-1/BUG-2 do taskflow resolvidos ou explicitamente decididos (open question Q1)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Sync automático agendado (bot/CI) | v2; v1 é manual deliberado — CI do harness permanece offline (hard constraint) |
| Resolução automática de conflitos | Merge conflitado é trabalho humano por definição |
| EVAL-MATRIX / evals de sync | F10 não é feature de eval; drift de golden já é detectado pelo F23 |
| Patch queue como engine de merge | Design D1 — three-way é o engine; `patches/` vira registry documental (D2) |

## User Stories

### P1: Comando de sync ⭐ MVP (SYNC-01/02/03)

**User Story**: Como mantenedor, quero um comando que compute e aplique o delta do upstream sobre o fork, marcando conflitos.

**Acceptance Criteria**:

1. WHEN `bun run sync:upstream <name> --to <ref>` roda THEN o script SHALL materializar a base (tarball do `resolvedSha` do `vendor.json` do dest) e o alvo (tarball do `ref` novo), e aplicar three-way por arquivo sobre `packages/<dir>` com marcadores de conflito (formato diff3) — nunca aplicar conflito silenciosamente
2. WHEN há conflitos THEN o script SHALL listar os arquivos conflitados, imprimir hint de restore (`git restore packages/<dir>`) e sair com código ≠ 0
3. WHEN a aplicação completa sem conflitos THEN `vendor.json` (dest) e `vendor.manifest.json` (ref) SHALL ser atualizados (ref, resolvedSha, npmVersion, syncedAt)
4. WHEN `--dry-run` é passado THEN o script SHALL só reportar o delta (added/modified/removed/renamed upstream; arquivos locais alterados) sem tocar o working tree
5. WHEN o subpath é de monorepo (taskflow) THEN o diff SHALL ser computado apenas dentro do subpath

**Independent Test**: sync do subagents para um ref mais novo real em branch descartável — delta aplicado, conflitos (se houver) marcados, proveniência correta, `git status` limpo após commit.

### P1: Auto-rename + adaptação do fork ⭐ MVP (SYNC-07)

**User Story**: Como mantenedor, quero que o sync reaplique automaticamente o rename `@runecraft/*` e as adaptações de build/teste por fork.

**Acceptance Criteria**:

1. WHEN o rename pass roda THEN o script SHALL aplicar os mapas por fork: `name`/`workspace:*` no package.json, import specifiers estáticos, `import()` dinâmicos (cobre BUG-1) e `import.meta.resolve`
2. WHEN a adaptação por fork é consultada THEN config por fork SHALL documentar: exclusões de arquivo, comandos de teste (ex.: modo `node --experimental-strip-types --test` da camada MCP — decisão MCPL-06 do F16) e paths locais dos `plugin/` (nunca `npx` pins do upstream)
3. WHEN o ciclo termina THEN zero referências aos specifiers upstream SHALL restar nos 12 dests (grep verificável)

**Independent Test**: pós-sync do taskflow, `grep -r "taskflow-core\|pi-taskflow\|codex-taskflow" packages/taskflow` retorna vazio; `bun test` por package verde.

### P1: Processo documentado ⭐ MVP (SYNC-04)

**User Story**: Como mantenedor futuro, quero o ciclo de sync documentado para executá-lo sem redescobrir o processo.

**Acceptance Criteria**:

1. WHEN a doc (`docs/SYNC.md`) é lida THEN ela SHALL cobrir: como checar novos releases upstream (tags/API; goal-loop-audit por SHA), rodar dry-run, aplicar, resolver conflitos típicos (package.json, imports renomeados, rename em massa), rodar os gates (SYNC-09) e commitar com mensagem padrão (`chore(<pkg>): sync upstream <vOld>..<vNew>`)
2. WHEN um sync introduz feature upstream que conflita com melhoria nossa THEN o processo SHALL orientar o registro da divergência (AD no STATE + entrada no registry SYNC-08)
3. WHEN o sync é commitado THEN commits de sync SHALL ser separados de commits de feature (um sync = um commit atômico por grupo)

**Independent Test**: um sync real executado seguindo apenas a doc.

### P2: Relatório de drift (SYNC-05)

**User Story**: Como mantenedor, quero ver rapidamente o quão atrás estamos de cada upstream.

**Acceptance Criteria**:

1. WHEN `bun run sync:upstream --status` roda THEN ele SHALL listar, por entry do manifest, ref/SHA vendorado vs última versão upstream (tag/npm) e o estado local (dirty vs base) — parte local offline
2. WHEN `--check` roda THEN ele SHALL validar offline: consistência manifest↔vendor.json (todo dest com vendor.json, non-empty) e `git status --porcelain` nos dests — sem rede, adequado a CI offline

**Independent Test**: saída do `--status` confere com os repos upstream; `--check` em repo limpo = verde, com dirty local = vermelho.

### P2: Registro de divergências (SYNC-08)

**User Story**: Como mantenedor, quero saber quais mudanças locais existem por fork e por quê, para guiar conflitos e revisões.

**Acceptance Criteria**:

1. WHEN o registry é consultado THEN `patches/<fork>/registry.json` SHALL listar as divergências conhecidas com ids, descrição, commits do monorepo e arquivos afetados: F2 (install.mjs removido), F5 (hardcodes pr-review), renames `@runecraft/*`, BUG-1/BUG-2 (status pendente)
2. WHEN um diff report é gerado THEN ele SHALL referenciar divergências do registry que intersectam arquivos alterados upstream (guia de conflito)

**Independent Test**: registry com entradas cujos SHAs conferem com `git log`; diff report cruza com registry num cenário sintético.

### P2: Gate pós-sync (SYNC-09)

**User Story**: Como mantenedor, quero que nenhum sync seja commitado sem a regressão completa verde.

**Acceptance Criteria**:

1. WHEN o gate roda THEN per-package `bun test` + harness (939 testes) + ratchet (F23) SEM `--update` + goldens byte-idênticos + `turbo build` SHALL passar
2. WHEN baselines/goldens mudam legitimamente por causa do sync THEN a atualização SHALL ser explícita (`--update`, recusado com `CI=true`) com relatório added/removed/unchanged revisado — nunca silenciosa — e documentada no corpo do commit de sync

**Independent Test**: ciclo de sync real termina com os gates verdes; `--update` em ambiente CI recusado.

## Edge Cases

- WHEN o upstream não usa tags (goal-loop-audit) THEN `--to` SHALL aceitar SHA e `--status` SHALL comparar via package.json do HEAD do branch default
- WHEN o upstream renomeia/move arquivos em massa THEN o dry-run SHALL evidenciar antes da aplicação (rename detection no report)
- WHEN o vendor.json está ausente/corrompido THEN o script SHALL abortar orientando re-vendoring com `bun run vendor <name> --force`
- WHEN um arquivo foi deletado por nós (F2: install.mjs) e upstream não o alterou THEN a deleção SHALL ser preservada (semântica delete preservada pelo three-way)
- WHEN upstream deleta arquivo que modificamos THEN SHALL ser reportado como divergência (registry sugerido), nunca dropado silenciosamente
- WHEN o manifest ganha entrada nova (fork novo) THEN o caminho é vendor (F1) primeiro, sync depois

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| SYNC-01 | P1: sync --to three-way (conflitos marcados, exit ≠ 0) | Execute | Pending |
| SYNC-02 | P1: Proveniência condicional (vendor.json dest + manifest) | Execute | Pending |
| SYNC-03 | P1: --dry-run delta report | Execute | Pending |
| SYNC-04 | P1: Processo documentado (docs/SYNC.md) | Execute | Pending |
| SYNC-05 | P2: --status + --check offline | Execute | Pending |
| SYNC-06 | P1: Group sync taskflow (9 entries, 1 tarball; camada MCP F16) | Execute | Pending |
| SYNC-07 | P1: Auto-rename pass @runecraft/* (incl. import dinâmicos — BUG-1) | Execute | Pending |
| SYNC-08 | P2: Registry de divergências (patches/<fork>/registry.json) | Execute | Pending |
| SYNC-09 | P2: Gate pós-sync (testes + ratchet fail-closed + goldens) | Execute | Pending |

## Success Criteria

- [ ] Um sync real executado de ponta a ponta seguindo a doc — incluindo 1 ciclo do grupo taskflow (camada MCP)
- [ ] Conflitos nunca aplicados silenciosamente
- [ ] Proveniência sempre consistente (vendor.json por dest + manifest) com o estado do diretório
- [ ] BUG-1/BUG-2 resolvidos ou disposição decidida pelo usuário (Q1)
