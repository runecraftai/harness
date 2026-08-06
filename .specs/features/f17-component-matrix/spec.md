# F17 — Matriz de componentes por agente Specification

**Scope:** Medium (matriz documentada + aplicada pelo CLI; pouco código novo)
**Prereq:** F15 ✓ (adapters), F16 ✓ (taskflow-MCP)
**Grupo:** MULA (F15–F18) — honestidade da matriz (AD-009)

## Problem Statement

Multi-agente não significa "tudo em todo agente": subagents e goal-loop-audit são extensões Pi (não portáveis), taskflow tem adapter Pi e camada MCP (cross-agent), pr-review é extensão Pi. A matriz define exatamente o que cada agente recebe — e o CLI aplica a coluna certa, recusando com motivo o que não é suportado (fail-closed por célula) e oferecendo detect-only com guia para o resto.

## Goals

- [ ] Matriz de componentes por agente documentada e aplicada pelo CLI (install/doctor/status)
- [ ] Fail-closed por célula: pedir componente não suportado num agente → recusa com motivo
- [ ] Detect-only com guia para agentes sem adapter
- [ ] Backups/state (F13) cobrem os novos alvos (configs de agentes não-Pi)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Portar subagents/goal-loop/pr-review para não-Pi | Extensões Pi por natureza (AD-009) |
| Novos adapters | F15 define o v1 (3 agentes); resto é detect-only |
| TUI de seleção | Future |

## Matriz alvo (v1)

| Agente | Detecção (F15) | subagents | taskflow | goal-loop | pr-review | regras workflow |
| --- | --- | --- | --- | --- | --- | --- |
| Pi | `pi` no PATH | ✅ nativo | ✅ adapter Pi | ✅ nativo | ✅ nativo | ✅ |
| Claude Code | `claude` no PATH | ❌ | ✅ MCP (`taskflow-claude`) | ❌ | ❌ | ✅ CLAUDE.md |
| OpenCode | `opencode` no PATH | ❌ | ✅ MCP (`taskflow-opencode`) | ❌ | ❌ | ✅ AGENTS.md |
| Codex | `codex` no PATH | ❌ | ✅ MCP (`taskflow-codex`) | ❌ | ❌ | ✅ AGENTS.md (solo) |
| Outros | — | — | — | — | — | detect-only com guia |

## User Stories

### P1: Matriz aplicada pelo CLI ⭐ MVP

**User Story**: Como dev usuário, quero que `install --agent X` aplique exatamente o que o meu agente suporta, para não receber componentes mortos.

**Why P1**: A matriz é a promessa de honestidade do produto (o gentle-ai faz o mesmo por agente).

**Acceptance Criteria**:

1. WHEN `install --agent claude-code` roda THEN o CLI SHALL aplicar exatamente a coluna do Claude (taskflow-MCP + regras) e nada mais
2. WHEN `install --agent pi` roda THEN o CLI SHALL aplicar a coluna completa do Pi (4 forks + settings)
3. WHEN `doctor` roda THEN cada agente detectado SHALL ser reportado com os components aplicáveis e o estado deles
4. WHEN `status --json` roda THEN a matriz aplicada SHALL ser refletida por agente (component/state)

**Independent Test**: fixture de configs → install por agente → diff confere com a coluna da matriz.

### P1: Fail-closed por célula ⭐ MVP

**User Story**: Como dev usuário, quero que pedir o impossível falhe com motivo claro, para eu saber os limites sem adivinhar.

**Why P1**: Recusar com explicação é melhor que instalar algo que não funciona.

**Acceptance Criteria**:

1. WHEN `install --agent claude-code --component goal-loop-audit` roda THEN o CLI SHALL recusar com exit ≠ 0 e a mensagem "goal-loop-audit é extensão Pi; use --agent pi"
2. WHEN `install --agent opencode --component subagents` roda THEN SHALL recusar com mensagem equivalente
3. WHEN o usuário pede um agente sem adapter (ex.: `--agent cursor`) THEN o CLI SHALL reportar detect-only: guia de instalação manual, sem fail

**Independent Test**: os 3 casos acima reproduzidos em fixture.

### P2: Estado e backups multi-agente

**User Story**: Como dev usuário, quero que uninstall/sync/backup funcionem igual para todos os agentes gerenciados, para um ciclo de vida consistente.

**Why P2**: Consistência do produto (F12/F13 estendidos).

**Acceptance Criteria**:

1. WHEN um agente não-Pi é instalado THEN o state (F13) SHALL registrar os arquivos/alvos por agente
2. WHEN `uninstall --agent claude-code` roda THEN backup (F13) SHALL ser criado antes e o state SHALL refletir a remoção
3. WHEN `sync` roda THEN configs de agentes não-Pi SHALL ser reconciliadas (seção runecraft: presente, MCP entry presente)

**Independent Test**: install → uninstall ciclo completo em fixture → state consistente em cada passo.

## Edge Cases

- WHEN o mesmo componente (taskflow-MCP) é instalado em 2+ agentes THEN o state SHALL registrar por agente (não deduplicar entre agentes — cada config é independente)
- WHEN um agente é detectado mas nunca instalado pelo harness THEN doctor SHALL mostrar "não gerenciado" (não "quebrado")
- WHEN a matriz muda entre versões do CLI THEN o sync SHALL aplicar a nova coluna sem remover configs de versões anteriores não mapeadas (reportar como órfãs)
- WHEN o usuário tem o upstream `codex-taskflow` instalado à mão THEN o CLI SHALL reportar colisão (F18) e não sobrescrever

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MATR-01 | P1: Matriz aplicada (AC 1.1/1.2) | Design | Pending |
| MATR-02 | P1: Matriz aplicada (AC 1.3/1.4 doctor/status) | Design | Pending |
| MATR-03 | P1: Fail-closed (AC 2.1/2.2) | Design | Pending |
| MATR-04 | P1: Fail-closed (AC 2.3 detect-only) | Design | Pending |
| MATR-05 | P2: Estado/backup (AC 3.1/3.2/3.3) | Design | Pending |

**Coverage:** 5 total, 0 mapeados, 5 unmapped

## Success Criteria

- [ ] Install por agente aplica exatamente a coluna da matriz (verificado por diff)
- [ ] Fail-closed por célula com mensagem de motivo (testes independentes)
- [ ] Ciclo install/uninstall/sync consistente para agentes não-Pi (state + backups)
