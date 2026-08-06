# F15 — Adapters v1 (Claude Code, OpenCode, Codex) Specification

**Scope:** Large (3 adapters; injecção/remoção por agente)
**Prereq:** F11 ✓ (CLI existe); F16 ✓ (taskflow-MCP disponível para injetar)
**Grupo:** MULA (F15–F18) — multi-agente estilo gentle-ai (AD-009)

## Problem Statement

O Pi é nativo (F2–F5), mas a pegada gentle-ai exige servir outros agentes. Claude Code, OpenCode e Codex precisam de adapters com detecção, fail-closed (comando display-only — nunca instalar runtime), injecção de regras + taskflow-MCP e remoção limpa. Fatos verificados do gentle-ai (pesquisa 2026-08-05): detecção por binário no PATH (dir de config é informativo), paths `~/.claude`, `~/.config/opencode` (ou `$XDG_CONFIG_HOME/opencode`), `~/.codex`.

## Goals

- [ ] `install --agent claude-code|opencode|codex` detecta (binário no PATH), recusa com fail-closed display-only, injeta components da matriz (F17)
- [ ] Regras de workflow injetadas com **marcadores próprios `runecraft:`** (nunca replace de arquivo com conteúdo do usuário)
- [ ] Remoção limpa: uninstall remove só o que o harness injetou
- [ ] `--agent` multi-valor (ex.: `--agent pi,claude-code`)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Instalar runtimes de agentes | Fail-closed é princípio (padrão gentle-ai); comando é display-only |
| Adapters extras (grok, Gemini, Cursor, Windsurf) | Detect-only com guia (F17); Future Considerations |
| pr-review em agentes não-Pi | Extensão Pi (AD-009); matriz honesta (F17) |
| TUI de seleção de agentes | Future |
| Codex multi-agent (agents.*) | Upstream é solo no gentle-ai (limitação verificada) |

## Gray area (resolver no Design)

**Estratégia de escrita de regras** (CLAUDE.md/AGENTS.md):

- **G1 — Marcadores em todos os agentes**: seções `<!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->`, append se o arquivo não existe/termina, nunca replace. Coexiste com gentle-ai (marcadores `gentle-ai:`) e com conteúdo do usuário.
- **G2 — Padrão gentle-ai**: Claude = marcadores; OpenCode/Codex = file replace (AGENTS.md inteiro é "deles"). **Quebra conteúdo pré-existente** — conflita com nosso princípio não-clobber (F14).

**Recomendado: G1** — consistente com a filosofia do produto; o gentle-ai usa replace porque o AGENTS.md é o artefato canônico dele, mas nós priorizamos preservação.

**Config MCP por host** (da pesquisa F16): Claude → `~/.claude/.mcp.json` (plugin scope) · OpenCode → merge em `~/.config/opencode/opencode.json` (`mcp.taskflow`) · Codex → `[mcp_servers.X]` em `~/.codex/config.toml` (TOML upsert). Validar contra o plugin/ do upstream no Execute.

## User Stories

### P1: Detecção + fail-closed ⭐ MVP

**User Story**: Como dev usuário, quero que o harness detecte meus agentes e recuse com instrução exata quando faltam, para não quebrar nada sozinho.

**Why P1**: Fail-closed é a assinatura da pegada gentle-ai (nunca instala runtime).

**Acceptance Criteria**:

1. WHEN `install --agent claude-code` roda e `claude` não está no PATH THEN o CLI SHALL recusar com exit ≠ 0 e imprimir o comando de instalação (display-only, nunca executado)
2. WHEN o binário existe no PATH THEN o agente SHALL ser considerado instalado (dir de config é informativo, não bloqueante — padrão gentle-ai)
3. WHEN `--agent` mistura suportado e não suportado (ex.: `pi,cursor`) THEN os suportados SHALL prosseguir e o não suportado SHALL ser reportado como detect-only com guia
4. WHEN `--dry-run` THEN o plano por agente SHALL ser impresso (arquivos alvo) sem escrever nada

**Independent Test**: ambiente sem `claude` → recusa com comando; com `claude` fake no PATH → instalação prossegue até a escrita.

### P1: Injecção por agente ⭐ MVP

**User Story**: Como dev usuário, quero que cada agente receba regras de workflow + taskflow-MCP, para ter o harness dentro do meu agente preferido.

**Why P1**: É o que "servir multi-agente" significa (F17 define o que cada um recebe).

**Acceptance Criteria**:

1. WHEN `install --agent claude-code` roda THEN regras SHALL ser injetadas em `~/.claude/CLAUDE.md` via seção com marcadores `runecraft:` (append, sem tocar conteúdo existente) E o MCP do taskflow SHALL ser configurado para o claude
2. WHEN `install --agent opencode` roda THEN `~/.config/opencode/AGENTS.md` (ou `$XDG_CONFIG_HOME/opencode`) SHALL receber a seção `runecraft:` E `opencode.json` SHALL ganhar `mcp.taskflow`
3. WHEN `install --agent codex` roda THEN `~/.codex/AGENTS.md` SHALL receber a seção `runecraft:` E `config.toml` SHALL ganhar o entry `mcp_servers`
4. WHEN o arquivo alvo não existe THEN ele SHALL ser criado com a seção do harness
5. WHEN o arquivo alvo existe com conteúdo do usuário THEN o conteúdo SHALL ser preservado intacto (append da seção)

**Independent Test**: fixture de config dirs (fake `~/.claude` etc. via env de override) → injecção verificada por diff; conteúdo do usuário preservado.

### P2: Remoção limpa

**User Story**: Como dev usuário, quero desfazer a configuração de um agente sem deixar resíduo nem tocar no que não é meu.

**Why P2**: Fecha o ciclo de vida (F12 estende para não-Pi).

**Acceptance Criteria**:

1. WHEN `uninstall --agent claude-code` roda THEN as seções `runecraft:` em `CLAUDE.md` SHALL ser removidas e as entries MCP do taskflow SHALL ser removidas
2. WHEN o arquivo ficou vazio após a remoção (só tinha a seção do harness) THEN ele SHALL ser removido
3. WHEN o arquivo tem conteúdo do usuário THEN ele SHALL permanecer com o conteúdo intacto
4. WHEN outro owner (ex.: gentle-ai) tem seções no mesmo arquivo THEN elas SHALL permanecer intactas

**Independent Test**: fixture com seções runecraft: + gentle-ai: + conteúdo do usuário → uninstall remove só as runecraft:.

## Edge Cases

- WHEN `XDG_CONFIG_HOME` está setado e absoluto THEN opencode SHALL resolver para `$XDG_CONFIG_HOME/opencode` (padrão gentle-ai paths.go)
- WHEN o binário existe mas o dir de config não THEN a injecção SHALL criar os dirs necessários
- WHEN o arquivo de config é symlink THEN SHALL ser preservado como symlink (alinhado F13)
- WHEN um agente tem config quebrada (JSON/TOML inválido) THEN o CLI SHALL abortar para esse agente apontando o arquivo, sem tocar os demais
- WHEN `~/.claude.json` (user-scope) está ilegível THEN SHALL abortar sem resetar (padrão gentle-ai: nunca reseta arquivo que carrega sessão OAuth)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ADPT-01 | P1: Detecção (AC 1.1 fail-closed) | Design | Pending |
| ADPT-02 | P1: Detecção (AC 1.2 binário = instalado) | Design | Pending |
| ADPT-03 | P1: Detecção (AC 1.3 misto) | Design | Pending |
| ADPT-04 | P1: Detecção (AC 1.4 dry-run) | Design | Pending |
| ADPT-05 | P1: Injecção (AC 2.1/2.2/2.3 por agente) | Design | Pending |
| ADPT-06 | P1: Injecção (AC 2.4/2.5 cria/preserva) | Design | Pending |
| ADPT-07 | P2: Remoção (AC 3.1/3.2/3.3/3.4) | Design | Pending |

**Coverage:** 7 total, 0 mapeados, 7 unmapped

## Success Criteria

- [ ] Fail-closed verificado (recusa + comando display-only) para os 3 agentes
- [ ] Injecção por agente verificada em fixture (diff) com conteúdo do usuário preservado
- [ ] Uninstall remove exatamente o que o harness injetou (seções `runecraft:` + MCP entries)
