# F18 — Coexistência multi-agente Specification

**Scope:** Medium (detecção de upstreams + ownership de seções; regras de não-clobber)
**Prereq:** F17 ✓ (matriz)
**Grupo:** MULA (F15–F18) — herança da filosofia gentle-ai (nunca clobber)

## Problem Statement

Os arquivos que o harness gerencia (CLAUDE.md, AGENTS.md, configs MCP, settings do Pi) podem ser gerenciados por outros donos: gentle-ai (marcadores `gentle-ai:`), pacotes upstream do ecossistema Pi (pi-subagents etc.) e o próprio usuário. O harness precisa (a) marcar o que é seu (ownership), (b) detectar outros donos e reportar, (c) nunca remover/sobrescrever o que não é seu — em nenhum agente, incluindo o Pi.

## Goals

- [ ] Marcadores próprios `runecraft:` em todos os arquivos de texto gerenciados (CLAUDE.md, AGENTS.md, settings do Pi quando aplicável)
- [ ] Detecção de upstreams/outros installers em doctor/status: gentle-ai (`~/.gentle-ai/state.json`, marcadores `gentle-ai:`), packages Pi upstream (pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi), taskflow-MCP upstream (`*-taskflow` no registry)
- [ ] Regra de ouro: operação nunca altera conteúdo de outro owner; conflito é reportado, não resolvido à força
- [ ] Uninstall remove só seções `runecraft:` e entries registradas no state

## Out of Scope

| Feature | Reason |
| --- | --- |
| Migração/remoção de config do gentle-ai | Coexistimos, não competimos (AD-008 rationale) |
| Resolução automática de conflitos | Reportar é o contrato (F14 herança) |
| Suporte a outros installers além do gentle-ai | Detecção genérica por marcadores/state; tratamento específico se surgir |

## Gray area (resolver no Design)

**Detecção de "outro dono" em arquivos de texto**: (a) scan por marcadores conhecidos (`gentle-ai:`, `runecraft:`), (b) state files conhecidos (`~/.gentle-ai/state.json`), (c) heurística de conteúdo não-marcado = "do usuário". Recomendado: (a)+(b) — heurística (c) só como aviso informativo, nunca bloqueio.

**Settings do Pi**: `settings.json` é JSON — ownership por prefixo de chave (blocos `subagents.*`/`taskflow.*` são "nossos" no F14) + `packages` entries. Um package instalado à mão no settings não pode ser removido pelo uninstall (regra já do F12 — reafirmar para o contexto multi-agente).

## User Stories

### P1: Ownership com marcadores ⭐ MVP

**User Story**: Como dev usuário, quero saber o que é do harness nos meus arquivos de config, para confiar no uninstall.

**Why P1**: Ownership é o que torna a remoção limpa possível (padrão gentle-ai: seções por ID de marcador).

**Acceptance Criteria**:

1. WHEN o harness injeta regras em CLAUDE.md/AGENTS.md THEN toda seção SHALL ser delimitada por `<!-- runecraft:<section> -->` e `<!-- /runecraft:<section> -->`
2. WHEN outro owner (ex.: gentle-ai) tem seções no mesmo arquivo THEN o harness SHALL nunca alterá-las (append só)
3. WHEN `uninstall` roda THEN apenas as seções `runecraft:` SHALL ser removidas
4. WHEN um arquivo é editado pelo usuário dentro de uma seção `runecraft:` THEN o uninstall SHALL preservar e reportar (mesma regra do F14 SETM-05)

**Independent Test**: arquivo fixture com seções runecraft: + gentle-ai: + texto do usuário → uninstall remove só as runecraft:.

### P1: Detecção de upstreams ⭐ MVP

**User Story**: Como dev usuário, quero saber quando meu ambiente tem pacotes que colidem com o harness, para decidir antes de quebrar algo.

**Why P1**: Colisão não detectada é o cenário de suporte mais caro (F7 two-driver é o exemplo no Pi).

**Acceptance Criteria**:

1. WHEN `doctor` roda THEN SHALL reportar (warn/fail): gentle-ai presente (`~/.gentle-ai/state.json` ou marcadores `gentle-ai:` em arquivos gerenciados)
2. WHEN `doctor` roda THEN SHALL reportar packages Pi upstream instalados (pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi em `pi list`/settings)
3. WHEN `doctor` roda THEN SHALL reportar taskflow-MCP upstream (`codex-taskflow`, `claude-taskflow`, `opencode-taskflow` em configs MCP dos agentes)
4. WHEN o instalador roda com colisão detectada THEN o CLI SHALL prosseguir somente após aviso explícito (não silencioso), e `--yes` SHALL registrar o aviso no relatório

**Independent Test**: fixture com `~/.gentle-ai/state.json` + upstreams no settings → doctor reporta todos; install com `--yes` registra avisos.

### P2: Convivência com gentle-ai no mesmo arquivo

**User Story**: Como dev usuário, quero ter gentle-ai e harness nos mesmos agentes sem conflito, para usar os dois sem medo.

**Why P2**: É o cenário real (nosso público usa o ecossistema existente).

**Acceptance Criteria**:

1. WHEN gentle-ai gerencia CLAUDE.md (marcadores `gentle-ai:`) e o harness injeta sua seção THEN ambos SHALL coexistir (append ordenado, sem sobreposição)
2. WHEN gentle-ai roda `sync`/`uninstall` depois do harness THEN as seções `runecraft:` SHALL permanecer (o gentle-ai só remove as dele — comportamento verificado do gentle-ai)
3. WHEN ambos configuram MCP para o mesmo host THEN entries com nomes diferentes SHALL coexistir; mesmo nome (ex.: `taskflow`) SHALL ser reportado como conflito, nunca sobrescrito

**Independent Test**: executar gentle-ai sync (se disponível) ou simular os marcadores em fixture → seções runecraft: intactas.

## Edge Cases

- WHEN um arquivo de texto tem conteúdo sem marcadores (só do usuário) THEN o harness SHALL fazer append, nunca assumir posse
- WHEN o mesmo agente é instalado 2x com versões diferentes do CLI THEN as seções antigas `runecraft:` SHALL ser atualizadas no lugar (mesmo ID de seção)
- WHEN um upstream é instalado DEPOIS do harness THEN doctor SHALL detectar na próxima execução (sem watcher)
- WHEN o usuário apaga uma seção `runecraft:` à mão THEN o sync SHALL re-injetá-la (como o gentle-ai faz com `InjectForSync`)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MXST-01 | P1: Ownership (AC 1.1/1.2 marcadores) | Design | Pending |
| MXST-02 | P1: Ownership (AC 1.3/1.4 remoção) | Design | Pending |
| MXST-03 | P1: Detecção (AC 2.1/2.2/2.3) | Design | Pending |
| MXST-04 | P1: Detecção (AC 2.4 aviso no install) | Design | Pending |
| MXST-05 | P2: Convivência (AC 3.1/3.2/3.3) | Design | Pending |

**Coverage:** 5 total, 0 mapeados, 5 unmapped

## Success Criteria

- [ ] Ownership por marcadores verificado (uninstall remove só o nosso)
- [ ] Doctor detecta gentle-ai + upstreams Pi + taskflow-MCP upstream (fixture)
- [ ] Coexistência com gentle-ai no mesmo arquivo provada (seções intactas após sync/uninstall dele)
