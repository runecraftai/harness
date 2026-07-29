# F6 — Umbrella @runecraft/harness Specification

**Scope:** Large (package novo; mecanismo de agregação de extensões Pi exige design)
**Prereq:** F2–F5 ✓

## Problem Statement

Instalar 4 packages separadamente nega a proposta do harness. Precisamos de um package `@runecraft/harness` que, instalado sozinho (`pi install npm:@runecraft/harness` ou path local), carregue os 4 forks numa sessão Pi com configuração default sensata — sem exigir que o usuário edite settings pacote por pacote.

## Goals

- [ ] Uma instalação única carrega subagents + taskflow + goal-loop-audit + pr-review
- [ ] Defaults documentados e aplicáveis (models por role, watchdog, etc.)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Installer que instala o próprio Pi | Future Considerations |
| TUI própria | Future Considerations |
| Configuração interativa (wizard) | v2; v1 é settings documentado |

## Gray area (resolver no Design — design.md obrigatório)

**Mecanismo de agregação**: o manifest `pi` de um package aponta arquivos do próprio package. Hipóteses a validar no design:

- **H1 — Shims re-export**: `@runecraft/harness` ships `extensions/*.ts` que re-exportam o default de cada fork (deps normais do package); manifest do harness lista os 4 shims. Skills/prompts/agents dos forks precisam de agregação equivalente (paths de node_modules no manifest? copiar?).
- **H2 — Manifest apontando node_modules**: manifest do harness referencia `./node_modules/@runecraft/subagents/index.ts` etc. — validar se o loader do Pi aceita.
- **H3 — Instalação múltipla orquestrada**: harness como meta-package que adiciona os 4 aos `packages` do settings na instalação — validar mecanismo suportado pelo Pi.

O design SHALL testar as hipóteses contra o comportamento real do Pi (docs de packages + experimento local) e escolher a mais simples que preserve skills/prompts/agents dos forks.

---

## User Stories

### P1: Instalação única ⭐ MVP

**User Story**: Como dev usuário, quero instalar o harness com um comando e ter as 4 capacidades na sessão.

**Acceptance Criteria**:

1. WHEN `@runecraft/harness` é instalado num projeto de teste THEN uma sessão Pi SHALL carregar as extensões dos 4 forks sem erro
2. WHEN `subagent({ action: "list" })`, `/tf`, `/goal status` e o comando do pr-review rodam THEN todos SHALL responder na mesma sessão
3. WHEN os skills/prompts dos forks são consultados THEN eles SHALL estar disponíveis como se os packages tivessem sido instalados individualmente

**Independent Test**: projeto de teste vazio + install do harness → os 4 surfaces respondem.

### P1: Defaults do harness ⭐ MVP

**User Story**: Como dev usuário, quero defaults prontos (modelos por role, watchdog, budgets) sem caçar documentação de 4 packages.

**Acceptance Criteria**:

1. WHEN a doc do harness é lida THEN ela SHALL trazer um bloco `settings.json` recomendado cobrindo os 4 packages (ex.: `subagents.defaultModel`, modelo do auditor, budgets do taskflow)
2. WHEN o bloco recomendado é aplicado THEN nenhum package SHALL falhar por config inválida

**Independent Test**: aplicar o settings recomendado num projeto de teste → sessão carrega sem warnings de config.

### P2: Verificação de instalação

**User Story**: Como dev usuário, quero checar rapidamente se o harness está saudável.

**Acceptance Criteria**:

1. WHEN um comando/fluxo de doctor roda (ex.: `/subagents-doctor` + checks dos demais) THEN o harness SHALL documentar a sequência de verificação dos 4

**Independent Test**: sequência de doctor documentada roda limpa num setup correto.

---

## Edge Cases

- WHEN um dos 4 falha ao carregar THEN os outros 3 SHALL continuar funcionais (falha isolada, não cascata)
- WHEN o usuário já tem um dos upstreams originais instalado (ex.: pi-subagents) THEN a doc SHALL avisar a incompatibilidade (colisão de tool/comandos)
- WHEN versões dos 4 divergirem THEN o harness SHALL pinar versões compatíveis (não `*`)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| UMBR-01 | P1: Mecanismo de agregação (design + implementação) | Design | Pending |
| UMBR-02 | P1: 4 surfaces respondem numa sessão | Execute | Pending |
| UMBR-03 | P1: Settings default documentado e válido | Execute | Pending |
| UMBR-04 | P2: Sequência de doctor documentada | Execute | Pending |

## Success Criteria

- [ ] Instalação única → 4 capacidades na mesma sessão Pi
- [ ] Settings recomendado aplicável sem erros
- [ ] Falha de um package não derruba os demais
