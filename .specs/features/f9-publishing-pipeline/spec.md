# F9 — Publishing Pipeline Specification

**Scope:** Medium (tooling de release; sem mudança nos packages)
**Prereq:** F8 ✓ (docs prontas, AD-002 fechada)

## Problem Statement

Sete packages precisam chegar ao npm sob a org `@runecraft` com versões coordenadas (o umbrella pina os 4 forks), builds validados antes do publish e um processo repetível — sem publicação manual package a package.

## Goals

- [ ] Publish coordenado dos 7 packages com um fluxo (dry-run validado de ponta a ponta)
- [ ] Versões do umbrella sempre consistentes com os forks publicados

## Out of Scope

| Feature | Reason |
| --- | --- |
| Release automático por conventional commits | v2; v1 é changesets/manual deliberado |
| CI rodando cenários E2E com modelos | Custo/flakiness; CI roda lint+build+testes mock |
| npm provenance/SLSA | Desejável, avaliado no Execute; não bloqueia v1 |

## Decisões da spec (assumptions)

- **Changesets** para versionamento independente + publish coordenado (padrão da org no arcanum).
- **Versão inicial dos forks**: herdar a major/minor do upstream base com patch próprio ou resetar para 0.1.0 — decisão registrada no Execute (lean: 0.1.0 com `vendor.json` apontando a base upstream).
- **CI mínima**: GitHub Actions com install+lint+build+testes (unit/mock) em push; publish por workflow manual (dispatch) com dry-run obrigatório antes.

---

## User Stories

### P1: Fluxo de publish coordenado ⭐ MVP

**User Story**: Como mantenedor, quero publicar os 7 packages com um fluxo único e reprodutível.

**Acceptance Criteria**:

1. WHEN o fluxo de release roda em modo dry-run THEN os 7 packages SHALL empacotar com nomes `@runecraft/*`, conteúdo correto (files field) e sem segredos/artefatos indevidos
2. WHEN o umbrella é versionado THEN suas dependencies SHALL pinar as versões exatas dos forks do mesmo release (não `workspace:*` no tarball publicado)
3. WHEN um package falha validação (build/teste) THEN o publish inteiro SHALL abortar (all-or-nothing)

**Independent Test**: `publish --dry-run` de ponta a ponta com inspeção dos tarballs gerados.

### P1: CI de verificação ⭐ MVP

**User Story**: Como mantenedor, quero CI que impeça regressão nos gates básicos.

**Acceptance Criteria**:

1. WHEN um push/PR chega ao repo THEN a CI SHALL rodar install, lint, build e as suites de teste mock dos packages
2. WHEN a CI falha THEN o fluxo de release SHALL ficar bloqueado

**Independent Test**: pipeline verde no repo; quebra proposital de um teste bloqueia release.

### P2: Publicação real inaugural

**User Story**: Como owner, quero o primeiro release público no npm.

**Acceptance Criteria**:

1. WHEN o publish real roda THEN os 7 packages SHALL aparecer no npm sob `@runecraft` com README e licenciamento conforme F8
2. WHEN `pi install npm:@runecraft/harness` roda numa máquina limpa THEN a instalação SHALL funcionar (validação pós-publish)

**Independent Test**: install do npm público num projeto de teste limpo.

---

## Edge Cases

- WHEN o `files` field vendorado inclui paths que não existem mais (ex.: install.mjs removido no F2) THEN o empacotamento SHALL ser corrigido antes do publish
- WHEN a org npm `@runecraft` não tem os direitos configurados (2FA, tokens, acesso público) THEN o setup SHALL ser resolvido antes do dry-run final
- WHEN um fork precisa de hotfix pós-release THEN o fluxo SHALL suportar publish de um package isolado sem quebrar o pin do umbrella (patch coordenado)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PUBL-01 | P1: Dry-run coordenado dos 7 (tarballs corretos) | Execute | Pending |
| PUBL-02 | P1: Umbrella pina versões exatas no publish | Execute | Pending |
| PUBL-03 | P1: CI install+lint+build+testes bloqueando release | Execute | Pending |
| PUBL-04 | P2: Release inaugural + install validado | Execute | Pending |

## Success Criteria

- [ ] Dry-run completo com tarballs inspecionados e corretos
- [ ] CI verde obrigatória antes de release
- [ ] Umbrella instalável do npm numa máquina limpa (quando o release real rodar)
