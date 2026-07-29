# F10 — Upstream Sync Workflow Specification

**Scope:** Medium (script + processo documentado)
**Prereq:** F7 ✓ (baseline validado; sync sem baseline não tem gate de regressão)

## Problem Statement

Assumimos o custo de manter os forks em sincronia com upstreams que evoluem rápido (subagents lança semanalmente). Sem tooling, cada sync vira arqueologia manual: o que mudou upstream, o que mudamos localmente, como aplicar um sobre o outro. O `vendor.json` (F1) registra a base exata — F10 transforma isso num fluxo repetível de three-way merge.

## Goals

- [ ] `bun run sync <name> --to <ref>` produz um diff upstream aplicável e atualiza a proveniência
- [ ] Processo documentado do ciclo completo: detectar → aplicar → re-testar → registrar

## Out of Scope

| Feature | Reason |
| --- | --- |
| Sync automático agendado (bot/CI) | v2; v1 é manual deliberado |
| Resolução automática de conflitos | Merge conflitado é trabalho humano por definição |
| Sync da camada MCP do taskflow | Não vendorada (AD-007) |

## Decisões da spec (assumptions)

- **Modelo three-way**: base = tarball do `resolvedSha` gravado no `vendor.json`; theirs = tarball do ref novo; ours = `packages/<dir>` atual. O script gera o patch base→theirs e tenta aplicar sobre ours (`git apply --3way` no repo do monorepo funciona com blobs staged; alternativa `diff3`/`patch --merge` — decisão técnica no Execute com o requisito: conflitos marcados no arquivo, nunca silenciosos).
- **Renames são parte do "ours"**: o diff upstream chega com nomes antigos; a aplicação sobre ours preserva nossos renames — conflitos em package.json/imports são esperados e resolvidos manualmente.
- **Gate pós-sync**: as suites do package sincronizado + `bun run lint`/`build` verdes antes de commitar o sync.

---

## User Stories

### P1: Comando de sync ⭐ MVP

**User Story**: Como mantenedor, quero um comando que compute e aplique o delta do upstream sobre o fork, marcando conflitos.

**Acceptance Criteria**:

1. WHEN `bun run sync <name> --to <ref>` roda THEN o script SHALL baixar base (resolvedSha do vendor.json) e alvo (ref novo), computar o diff e aplicá-lo sobre `packages/<dir>` com marcação de conflitos
2. WHEN a aplicação completa THEN `vendor.json` SHALL ser atualizado (ref, resolvedSha, npmVersion nova, syncedAt) somente se não houver conflitos pendentes — com conflitos, o script SHALL listar os arquivos e sair com código ≠ 0
3. WHEN `--dry-run` é passado THEN o script SHALL só reportar o delta (arquivos alterados/adicionados/removidos upstream) sem tocar o working tree
4. WHEN o subpath é de monorepo (taskflow) THEN o diff SHALL ser computado apenas dentro do subpath

**Independent Test**: sync do subagents para um ref mais novo real em branch descartável — delta aplicado, conflitos (se houver) marcados, vendor.json correto.

### P1: Processo documentado ⭐ MVP

**User Story**: Como mantenedor futuro, quero o ciclo de sync documentado para executá-lo sem redescobrir o processo.

**Acceptance Criteria**:

1. WHEN a doc do processo é lida THEN ela SHALL cobrir: como checar novos releases upstream, rodar dry-run, aplicar, resolver conflitos típicos (package.json, imports renomeados), rodar gates e commitar com mensagem padrão (`chore(<pkg>): sync upstream <vOld>..<vNew>`)
2. WHEN um sync introduz feature upstream que conflita com melhoria nossa THEN o processo SHALL orientar o registro da divergência (decisão AD no STATE)

**Independent Test**: um sync real executado seguindo apenas a doc.

### P2: Relatório de drift

**User Story**: Como mantenedor, quero ver rapidamente o quão atrás estamos de cada upstream.

**Acceptance Criteria**:

1. WHEN `bun run sync --status` roda THEN ele SHALL listar, por package, versão base vendorada vs última versão upstream (tag/npm) e a contagem de commits de distância quando disponível

**Independent Test**: saída do `--status` confere com os repos upstream.

---

## Edge Cases

- WHEN o upstream não usa tags (goal-loop-audit) THEN `--to` SHALL aceitar SHA e `--status` SHALL comparar por package.json do HEAD do branch default
- WHEN o upstream renomeia/move arquivos em massa THEN o dry-run SHALL evidenciar isso antes da aplicação (rename detection do diff)
- WHEN o vendor.json está ausente/corrompido THEN o script SHALL abortar orientando re-vendoring com `--force`

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SYNC-01 | P1: sync --to (three-way, conflitos marcados) | Execute | Pending |
| SYNC-02 | P1: Atualização condicional do vendor.json | Execute | Pending |
| SYNC-03 | P1: --dry-run com delta report | Execute | Pending |
| SYNC-04 | P1: Processo documentado (ciclo completo) | Execute | Pending |
| SYNC-05 | P2: --status (drift report) | Execute | Pending |

## Success Criteria

- [ ] Um sync real executado de ponta a ponta seguindo a doc
- [ ] Conflitos nunca aplicados silenciosamente
- [ ] Proveniência sempre consistente com o estado do diretório
