# F1 — Monorepo Scaffold Specification

**Scope:** Medium (spec breve, design inline, tasks implícitas no Execute)
**Feature ROADMAP:** F1 — prereq de F2–F5

## Problem Statement

O harness precisa de um monorepo funcional antes de qualquer fork: workspaces que resolvam os 7 packages (incluindo os 3 aninhados do taskflow), toolchain uniforme (turbo, biome, tsconfig) e um mecanismo de vendoring reproduzível que traga o source completo dos upstreams (com testes) pinado por versão — a fundação do sync workflow (F10).

## Goals

- [ ] `bun install` + `bun run lint` + `bun run build` verdes no monorepo vazio (estrutura pronta, zero packages vendorados)
- [ ] `bun run vendor <name>` traz o source de um upstream pinado para `packages/<dir>` com metadata de proveniência gravada

## Out of Scope

| Feature | Reason |
| --- | --- |
| Renomear packages para `@runecraft/*` | Trabalho de cada fork (F2–F5) |
| CI / GitHub Actions | F9 (publishing pipeline) |
| Instalar os packages no Pi | F2–F5 validam carga no Pi |
| Sync incremental (diff upstream → aplicar) | F10; F1 só grava a proveniência que o F10 consome |

## Decisões da spec (assumptions)

- **Fonte do vendoring: GitHub source tarball** (`codeload.github.com/<owner>/<repo>/tar.gz/<ref>`), não tarball do npm. Razão: o tarball npm publica só os `files` declarados (sem testes); os ACs de F2–F5 exigem os testes do upstream. GitHub tarball já vem sem `.git/` (atende AD-002).
- **Runner dos scripts: Bun** (AD-006, convenções arcanum). Runtime alvo dos packages continua Node ≥ 22.19.
- **Metadata de proveniência**: um `vendor.json` na raiz de cada package vendorado com `{ upstreamRepo, ref, resolvedSha, npmName, npmVersion, subpath, vendoredAt }`.
- **Manifesto central**: `vendor.manifest.json` na raiz do monorepo pré-configura os 6 upstreams (pins de F2–F5), para `bun run vendor <name>` não precisar de argumentos extras.

---

## User Stories

### P1: Toolchain do monorepo ⭐ MVP

**User Story**: Como dev do harness, quero um monorepo com workspaces, turbo e biome configurados para que os forks (F2–F5) entrem em estrutura pronta com lint/build padronizados.

**Acceptance Criteria**:

1. WHEN `bun install` roda na raiz THEN workspaces SHALL resolver `packages/*` e `packages/taskflow/*` sem erro
2. WHEN `bun run lint` roda THEN Biome SHALL executar com exit 0 (config na raiz; forks futuros podem ser excluídos do format agressivo por override, per AD-006)
3. WHEN `bun run build` roda THEN Turborepo SHALL executar a task `build` (vazia ou passthrough) com exit 0
4. WHEN um arquivo TS é criado num package THEN o tsconfig base SHALL fornecer strict ESM + Node ≥ 22 por extends

**Independent Test**: clone limpo → `bun install && bun run lint && bun run build` → exit 0.

---

### P1: Script de vendoring ⭐ MVP

**User Story**: Como dev do harness, quero `bun run vendor <name>` que baixe o source do upstream pinado e o coloque no diretório certo, para que cada fork comece de uma cópia exata, reproduzível e rastreável.

**Acceptance Criteria**:

1. WHEN `bun run vendor subagents` roda THEN o script SHALL baixar o tarball GitHub do ref pinado no `vendor.manifest.json`, extrair para `packages/subagents/` e gravar `packages/subagents/vendor.json` com a proveniência
2. WHEN o upstream é subpath de monorepo (taskflow) THEN o script SHALL extrair apenas o subpath declarado (ex.: `packages/taskflow-core` do repo → `packages/taskflow/core/`)
3. WHEN o diretório destino já existe e não-vazio THEN o script SHALL abortar com erro claro, a menos que `--force` seja passado
4. WHEN o download falha ou o ref não existe THEN o script SHALL falhar sem deixar escrita parcial (extração em temp dir + move atômico)
5. WHEN o vendoring completa THEN o diretório SHALL conter o source completo do upstream incluindo testes, sem `.git/`

**Independent Test**: `bun run vendor subagents` → `packages/subagents/` contém source + testes de pi-subagents 0.37.2 + `vendor.json` correto; rodar de novo sem `--force` → erro.

---

### P2: Manifesto completo dos 6 upstreams

**User Story**: Como dev, quero os 6 pins já declarados no `vendor.manifest.json` para que F2–F5 sejam só `bun run vendor <name>` + rename.

**Acceptance Criteria**:

1. WHEN o manifesto é lido THEN ele SHALL conter entradas para: subagents (pi-subagents 0.37.2), taskflow-core, taskflow-pi, taskflow-dsl (heggria/taskflow 0.2.6, subpaths), goal-loop-audit (pi-goal-list-loop-audit 0.28.34), pr-review (pi-pr-review 1.11.4)
2. WHEN um ref pinado não corresponde a tag existente no repo THEN o dev SHALL poder pinar por SHA de commit no manifesto (campo `ref` aceita tag ou SHA)

**Independent Test**: `bun run vendor --list` imprime as 6 entradas com repo/ref/destino.

---

## Edge Cases

- WHEN o repo upstream não tem tag igual à versão npm THEN o manifesto SHALL ser pinado por SHA (resolvido manualmente uma vez) — o script não adivinha
- WHEN o tarball extraído não contém o subpath declarado THEN o script SHALL falhar listando os paths de topo encontrados
- WHEN `packages/taskflow/` (pai dos 3) não existe THEN o script SHALL criá-lo

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SCAF-01 | P1: Toolchain | Verified | COMPLETE |
| SCAF-02 | P1: Toolchain (workspaces aninhados) | Verified | COMPLETE |
| SCAF-03 | P1: Vendoring (download+extract+metadata) | Verified | COMPLETE |
| SCAF-04 | P1: Vendoring (subpath monorepo) | Verified | COMPLETE |
| SCAF-05 | P1: Vendoring (força/atomicidade) | Verified | COMPLETE |
| SCAF-06 | P2: Manifesto 6 upstreams | Verified | COMPLETE |

## Success Criteria

- [x] Clone limpo instala, linta e builda com exit 0 (`bun install` 266 pkgs, biome clean, turbo 0 tasks)
- [x] `bun run vendor subagents` produz cópia exata e rastreável do pi-subagents 0.37.2 com testes (src/ + test/{unit,integration,e2e}, sem .git, vendor.json com SHA 8063333)
- [x] Proveniência suficiente para o F10 reconstruir o diff upstream (repo + SHA + subpath em vendor.json)

## Notas de execução

- SCAF-04 verificado com `vendor taskflow-core` (subpath extraído, SHA 3c2dfdb); diretório removido após verificação — F3 re-vendoriza os 3 do taskflow juntos
- `packages/subagents/` mantido vendorado (upstream puro, sem rename) como seed do F2
- Lição: `Bun.write(file, Response)` travou com codeload.github.com — fix: `arrayBuffer()` explícito antes do write
