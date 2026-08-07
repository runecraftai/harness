# F11 — CLI @runecraft/harness Specification

**Scope:** Large (CLI novo; orquestra `pi install` e escreve config)
**Prereq:** F6 ✓ (agregação resolvida no design do F6)
**Grupo:** SERV (F11–F14) — serving layer estilo gentle-ai em TS, sem binário Go (AD-008)

## Problem Statement

F6 entrega um meta-package passivo: instalar e configurar os 4 forks ainda exige edição manual de settings. A pegada gentle-ai exige um CLI que instala components selecionáveis em um comando, com detecção de Pi e fail-closed (recusa e nomeia o comando exato), presets e dry-run — sem binário Go (AD-008).

## Goals

- [ ] `npx @runecraft/harness install` instala components selecionáveis num comando, orquestrando `pi install` (não reimplementando resolução de packages)
- [ ] Detecção de Pi com fail-closed: Pi ausente → recusa com exit ≠ 0 e instrução exata
- [ ] Presets (`minimal`, `full`) + `--dry-run` + saída legível para TTY e CI (`--json`)
- [ ] Idempotente: rerun não duplica entries nem clobber config existente

## Out of Scope

| Feature | Reason |
| --- | --- |
| TUI interativa (wizard) | Future Considerations (estilo OpenCode) |
| Instalar o próprio Pi | Future Considerations |
| Agentes não-Pi (Claude Code, OpenCode, Codex) | M3 — F15 |
| Binário standalone (Go) | AD-008: stack única TS/Node |
| Detecção de colisão com upstreams | F18 (coexistência multi-agente); v1 avisa apenas |

## Gray area (resolver no Design — design.md obrigatório)

**Estratégia de escrita**: o CLI deve (a) delegar ao binário `pi` (`pi install npm:@runecraft/...`), ou (b) manipular `settings.json` diretamente, ou (c) híbrido. Fatores: resolução/dedup/update já existem no `pi` (docs/packages.md); o gentle-ai delega ("runs exactly these Pi setup steps"). Hipóteses:

- **G1 — Delegação total**: CLI executa `pi install`/`pi remove` e lê `pi list` para estado; nunca escreve `packages` diretamente.
- **G2 — Escrita direta**: CLI edita `~/.pi/agent/settings.json` (packages) — risco de divergir da lógica nativa de dedup/scope.
- **G3 — Híbrido**: `pi install` para packages; escrita direta apenas para settings de configuração (models, watchdog — F14).

**Detecção de Pi**: binário `pi` no PATH (`which pi` + `pi --version`)? Ou presença de `~/.pi/agent/settings.json`? O gentle-ai detecta o binário. Validar comportamento de `pi --version` em instalações reais.

## User Stories

### P1: Instalação com seleção de components ⭐ MVP

**User Story**: Como dev usuário, quero instalar o harness com um comando escolhendo quais components, para ter só o que preciso sem caçar comandos de 4 packages.

**Why P1**: É a proposta central do harness (instalação única) com a seleção da pegada gentle-ai.

**Acceptance Criteria**:

1. WHEN `npx @runecraft/harness install` roda com Pi detectado THEN os 4 forks SHALL ser instalados via `pi install` e o output SHALL listar o que foi instalado
2. WHEN `--component subagents,taskflow` é passado THEN somente esses SHALL ser instalados (goal-loop-audit e pr-review não)
3. WHEN `--dry-run` é passado THEN o plano SHALL ser impresso sem aplicar nenhuma mudança (verificado: `pi list` inalterado)
4. WHEN Pi não é detectado no PATH THEN o CLI SHALL recusar com exit ≠ 0 e imprimir o comando exato para instalar/configurar o Pi

**Independent Test**: máquina com Pi → `npx @runecraft/harness install --dry-run` (nada muda) → `install --component taskflow` → `pi list` mostra só taskflow → `install` → `pi list` mostra os 4.

### P1: Presets ⭐ MVP

**User Story**: Como dev usuário, quero escolher entre combinações prontas, para não precisar conhecer os 4 packages para começar.

**Why P1**: Presets são o "antes/depois" da pegada gentle-ai (full-gentleman/minimal).

**Acceptance Criteria**:

1. WHEN `--preset minimal` é passado THEN os 4 forks SHALL ser instalados sem alterar settings de configuração
2. WHEN `--preset full` é passado THEN os 4 forks SHALL ser instalados E os settings defaults do F14 SHALL ser aplicados via merge
3. WHEN `--help` é consultado THEN os presets SHALL estar documentados com o que cada um inclui

**Independent Test**: `install --preset minimal` → `pi list` com os 4; `install --preset full` → settings ganham defaults sem perder chaves do usuário.

### P2: Comando Pi `/harness`

**User Story**: Como usuário do Pi, quero consultar o estado do harness dentro da sessão, sem sair para o terminal.

**Why P2**: Conveniência dentro do runtime nativo; o produto já vive no Pi.

**Acceptance Criteria**:

1. WHEN `/harness status` roda numa sessão Pi com o harness instalado THEN ele SHALL mostrar componentes instalados e versões (reusa F12 status)
2. WHEN o harness não está instalado na sessão THEN o comando SHALL instruir a rodar `npx @runecraft/harness install`

**Independent Test**: sessão Pi com harness → `/harness status` responde com a tabela do F12.

### P2: Idempotência e não-clobber

**User Story**: Como dev usuário, quero rodar install de novo sem medo, para atualizar sem quebrar minha config.

**Why P2**: Sem isso, sync (F12) e upgrades são inseguros.

**Acceptance Criteria**:

1. WHEN `install` roda duas vezes THEN a segunda execução SHALL não duplicar entries em `packages` nem alterar settings existentes
2. WHEN o usuário tem um upstream original instalado (ex.: `pi-subagents`) THEN o CLI SHALL avisar a colisão e sugerir remoção, sem remover nada sozinho
3. WHEN o npm está offline THEN o CLI SHALL falhar com erro claro, sem deixar state inconsistente (rollback do que não completou)

**Independent Test**: install 2x → diff dos settings = vazio (exceto timestamp do state).

## Edge Cases

- WHEN `pi` existe mas o Node é < 22.19 (piso dos forks) THEN o CLI SHALL emitir warn com o requisito (não bloquear — Pi pode rodar em outro runtime)
- WHEN um dos 4 forks falha ao instalar THEN os demais SHALL continuar e o CLI SHALL reportar exit ≠ 0 com o componente falho
- WHEN o diretório de config do Pi não existe (~/.pi/agent) THEN o CLI SHALL tratar como Pi não configurado e seguir o fail-closed da AC 1.4
- WHEN o CLI roda sem `--yes` em modo não-TTY THEN SHALL não pausar pedindo confirmação (auto-aceita com `--yes`/env, estilo gentle-ai)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CLI-01 | P1: Instalação com seleção (AC 1.1) | Execute | Implemented |
| CLI-02 | P1: Instalação com seleção (AC 1.2) | Execute | Implemented |
| CLI-03 | P1: Instalação com seleção (AC 1.3 dry-run) | Execute | Implemented |
| CLI-04 | P1: Instalação com seleção (AC 1.4 fail-closed) | Execute | Implemented |
| CLI-05 | P1: Presets (AC 2.1/2.2) | Execute | Implemented (AC2 deferred → F14 (SETM-01..06)) |
| CLI-06 | P1: Presets (AC 2.3 help) | Execute | Implemented |
| CLI-07 | P2: `/harness status` | Execute | Implemented |
| CLI-08 | P2: Idempotência (AC 4.1) | Execute | Implemented |
| CLI-09 | P2: Idempotência (AC 4.2 colisão) | Execute | Implemented |
| CLI-10 | P2: Idempotência (AC 4.3 rollback) | Execute | Implemented |

**Coverage:** 10 total, 0 mapeados, 10 unmapped

## Success Criteria

- [ ] `npx @runecraft/harness install` → 4 components na sessão Pi em um comando
- [ ] Dry-run e fail-closed verificados por teste independente
- [ ] Rerun idempotente (settings sem duplicatas)
