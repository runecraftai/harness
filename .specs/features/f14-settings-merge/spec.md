# F14 — Settings Merge real Specification

**Scope:** Medium (merge por overlay de settings do Pi; conflito reportado, nunca clobber)
**Prereq:** F11 ✓ (CLI existe); usa state do F13 (chaves registradas)
**Grupo:** SERV (F11–F14) — serving layer estilo gentle-ai em TS (AD-008)

## Problem Statement

F6 entrega "bloco de settings recomendado" que o usuário cola à mão. A pegada gentle-ai aplica defaults programaticamente: merge por overlay que preserva qualquer coisa do usuário, registra o que o harness adicionou (para remoção limpa no uninstall) e reporta conflitos em vez de sobrescrevê-los.

## Goals

- [ ] Defaults do harness (models por role, watchdog, budgets dos 4 forks) aplicados por merge overlay
- [ ] Chaves do usuário sempre vencem; conflito reportado no output com diff
- [ ] Chaves adicionadas pelo harness registradas no state (F13) e removíveis no uninstall (F12)
- [ ] Settings com JSON inválido → abort com erro apontando o arquivo (nunca reparar silenciosamente)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Editor interativo de settings | TUI é Future |
| Schema/validação profunda por package | Valida-se o que os forks leem; schema por package é F8/F21 |
| Migração de versões de settings | Quando necessário, vira tarefa própria |

## Gray area (resolver no Design)

**Profundidade do merge**: settings do Pi são nested (ex.: `subagents.defaultModel`, `watchdog.*`, arrays como `packages`/`enabledModels`). Definir no design:

- **G1 — Merge profundo (nested por chave)**: defaults em camadas; qualquer chave existente do usuário vence; arrays → concat com dedupe (packages) ou substituição (enabledModels?).
- **G2 — Merge raso por prefixo de package**: cada fork declara seu bloco (`subagents.*`, `taskflow.*`, `glla.*`, `prreview.*`); o harness só toca esses blocos.
- **G3 — Híbrido**: blocos por package (G2) + top-level limitado (model defaults) — recomendado: reduz superfície de conflito e é o que os forks realmente leem.

**Formato de registro**: `settingsChanges` no state (F13) com paths das chaves adicionadas (ex.: `subagents.defaultModel`) para o uninstall remover exatamente o que o harness pôs.

## User Stories

### P1: Aplicação de defaults via merge ⭐ MVP

**User Story**: Como dev usuário, quero que `--preset full` configure o harness com defaults sensatos, sem eu colar JSON à mão nem perder minhas settings.

**Why P1**: É a diferença entre "documentado" e "servido" — o coração da pegada gentle-ai.

**Acceptance Criteria**:

1. WHEN `harness install --preset full` roda THEN os defaults SHALL ser aplicados por merge: chaves inexistentes criadas, chaves do usuário preservadas
2. WHEN uma chave default do harness conflita com uma chave do usuário THEN a do usuário SHALL vencer e o conflito SHALL ser reportado no output (path + valor de cada lado)
3. WHEN o merge adiciona chaves THEN elas SHALL ser registradas em `settingsChanges` no state (F13)
4. WHEN o settings.json alvo está com JSON inválido THEN o merge SHALL abortar com erro apontando o arquivo, sem modificar nada

**Independent Test**: settings com `subagents.defaultModel` custom → install --preset full → chave preservada, conflito reportado, demais defaults aplicados.

### P2: Remoção limpa no uninstall

**User Story**: Como dev usuário, quero que desinstalar devolva meus settings ao estado pré-harness, para não deixar resíduo.

**Why P2**: Sem isso o uninstall do F12 deixa config órfã.

**Acceptance Criteria**:

1. WHEN `harness uninstall --all` roda THEN as chaves listadas em `settingsChanges` SHALL ser removidas
2. WHEN uma chave registrada foi editada pelo usuário após o install THEN ela SHALL ser preservada e reportada (não remover mudança do usuário)
3. WHEN um backup (F13) existe do estado pré-install THEN o output SHALL indicar o comando de restore como alternativa

**Independent Test**: install full → editar chave registrada → uninstall --all → chave editada permanece e é reportada; chaves não editadas removidas.

### P2: Relatório de conflito legível

**User Story**: Como dev usuário, quero entender o que o harness mudou ou deixou de mudar, para confiar na automação.

**Why P2**: Transparência é o que distingue automação de magia.

**Acceptance Criteria**:

1. WHEN qualquer merge roda THEN o output SHALL listar: chaves criadas, chaves preservadas (conflito), chaves removidas (uninstall)
2. WHEN `--json` é passado THEN o relatório SHALL sair como JSON estruturado (consumível por scripts/CI)

**Independent Test**: install full --json → JSON com created/kept/conflicts.

## Edge Cases

- WHEN o settings.json tem chaves desconhecidas (de outros packages) THEN o merge SHALL ignorá-las intactas
- WHEN o mesmo default é aplicado duas vezes THEN o resultado SHALL ser idempotente (sem drift)
- WHEN um fork não está instalado THEN seus defaults SHALL não ser aplicados (bloco órfão não é criado)
- WHEN o usuário usa projeto (`-l`) e global THEN o merge SHALL respeitar a precedência do Pi (projeto vence global — docs/packages.md)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SETM-01 | P1: merge (AC 1.1 preserva usuário) | Design | Pending |
| SETM-02 | P1: merge (AC 1.2 conflito reportado) | Design | Pending |
| SETM-03 | P1: merge (AC 1.3 settingsChanges) | Design | Pending |
| SETM-04 | P1: merge (AC 1.4 JSON inválido) | Design | Pending |
| SETM-05 | P2: uninstall limpo (AC 2.1/2.2/2.3) | Design | Pending |
| SETM-06 | P2: relatório (AC 3.1/3.2) | Design | Pending |

**Coverage:** 6 total, 0 mapeados, 6 unmapped

## Success Criteria

- [ ] `--preset full` aplica defaults sem perder chave do usuário (teste independente)
- [ ] Conflitos sempre reportados, nunca sobrescritos
- [ ] Uninstall remove exatamente o que o harness adicionou (settingsChanges)
