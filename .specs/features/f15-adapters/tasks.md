# F15 — Tasks (Adapters v1: Claude Code, OpenCode, Codex)

**Base:** design.md D1–D9 (aprovado, AD-013) · schema agents = F17 D2 (aditivo, implementado aqui, formalizado no F17)

## T1 — Extensão do state (schema agents, F17 D2)

- [x] `src/state.ts`: tipos `AgentTarget` (kind `rules` {file, section, contentHash} | `mcp` {file, entry, bin, contentHash}), `AgentRecord` {installedAt, harnessVersion, targets[]}; campo `agents: Record<string, AgentRecord>` aditivo no `HarnessState` (schemaVersion permanece 1)
- [x] Parser tolerante: `loadState`/`loadStateReadonly` ignoram campos desconhecidos (CLIs antigas lendo state novo e vice-versa)
- [x] Helpers: `upsertAgent(state, id, record)`, `removeAgent(state, id)`
- [x] **Verificar:** testes de state com agents round-trip; parse de state sem `agents` → vazio; state com campos extras → preservado

## T2 — Core de adapters (types + registry)

- [x] `src/adapters/types.ts`: `AgentAdapter` (id, bin, installHint, detect(), paths(), inject(), remove()), `DetectResult` {installed, binPath?, configHome, reasons[]}, `HostPaths` {rulesFile, mcpFile, mcpKey, configHome}, `InjectContext`/`InjectResult`, `RemoveContext`/`RemoveResult`, `McpEntry`
- [x] `src/adapters/registry.ts`: registro por id (`claude-code`/`opencode`/`codex`) + aliases; ids conhecidos sem adapter → detect-only (lista curada: `cursor`, `grok`…); dispatch por `--agent`
- [x] **Verificar:** registry resolve ids e aliases; id desconhecido → detect-only com guia (sem fail)

## T3 — rules.ts (seção com marcadores)

- [x] `renderRules(section, content)`: template `<!-- runecraft:<section> -->\n<content>\n<!-- /runecraft:<section> -->`
- [x] Upsert por marcador: append no fim se ausente (cria dirs se preciso); conteúdo interno substituído se presente (rerun idempotente — D3); conteúdo do usuário e seções de outros owners **intactos byte a byte**
- [x] Encoding: BOM preservado na posição 0; CRLF detectado e usado na seção; arquivo não-utf8 → abort do agente apontando o arquivo (nunca corromper)
- [x] **Verificar:** fixture com usuário + gentle-ai + runecraft → upsert/append/remoção corretos; BOM/CRLF; rerun = zero mudanças

## T4 — mcpConfig.ts + toml.ts

- [x] `resolveMcpBin(host, ctx)`: env override (`RUNECRAFT_TASKFLOW_<HOST>_BIN`) > require.resolve(`@runecraft/taskflow-<host>/package.json`) → `dist/mcp/bin.js` (dev) > `npx -y -p @runecraft/taskflow-<host>@<pin> <host>-taskflow-mcp` (publish; pin de versions.ts)
- [x] Guard anti-upstream (D4/F16 AC 4.2): resultado contendo nomes upstream (`codex-taskflow`, `claude-taskflow`, `opencode-taskflow`, `grok-taskflow`, `taskflow-mcp` sem prefixo `@runecraft/`) → erro de template, nunca injeta
- [x] `renderMcpConfig(host, ctx)`: shapes D6 — claude `{"mcpServers": {"taskflow": {command, args}}}` · opencode `mcp.taskflow = {type:"local", command[], enabled:true}` + skills.paths · codex `[mcp_servers.taskflow]` (command/args + `tool_timeout_sec: 1800`)
- [x] `src/toml.ts`: upsert mínimo do bloco `[mcp_servers.taskflow]` sem lib; resto do arquivo byte a byte; strings básicas (command/args/environment); smoke test valida com lib TOML devDep (ou parse manual)
- [x] **Verificar:** resolveMcpBin com env override (bin fake), com fork presente (dev path), sem fork (npx pin com nosso scope); guard rejeita upstream; upsert TOML preserva comentários/seções; opencode merge profundo só em `mcp.taskflow` (indent detectada do arquivo)

## T5 — Adapters por host

- [x] `src/adapters/claude.ts`: detect (`command -v claude`), paths (`~/.claude` / `RUNECRAFT_CLAUDE_HOME`), inject (CLAUDE.md seção + `.mcp.json` upsert mcpServers.taskflow), remove (seções + entry registrada só se valor == registrado — D7); `~/.claude.json` fora do conjunto gerenciado (D8)
- [x] `src/adapters/opencode.ts`: XDG-aware (`$XDG_CONFIG_HOME/opencode` se absoluto, senão `~/.config/opencode`; override `RUNECRAFT_OPENCODE_HOME`), AGENTS.md + opencode.json merge `mcp.taskflow` + skills.paths
- [x] `src/adapters/codex.ts`: `~/.codex` (override `RUNECRAFT_CODEX_HOME`), AGENTS.md + config.toml upsert `[mcp_servers.taskflow]`
- [x] `installHint` por agente: comando oficial de instalação (display-only) — **validar no Execute** (docs oficiais de cada agente)
- [x] Config inválida (JSON/TOML) → aborta só o agente apontando o arquivo (D2); symlink preservado; dirs criados quando ausentes
- [x] **Verificar:** fixture com dirs fake (env overrides) → inject/remove por agente com diff; conteúdo do usuário preservado; `~/.claude.json` intocado (teste explícito)

## T6 — install --agent (extensão do F11)

- [x] `--agent` multi-valor (default `pi`); dispatch via registry; detect-only para não suportado (prossegue, ADPT-03); fail-closed: bin ausente → stderr com installHint, exit ≠ 0, segue os demais
- [x] Plano por agente: coluna da matriz (rules + taskflow-mcp para não-Pi) — `--component` fora da coluna → recusa com motivo F17 ("é extensão Pi; use --agent pi") e exit ≠ 0
- [x] dry-run imprime o plano por agente (arquivos alvo) sem escrever (ADPT-04)
- [x] Backup único pré-write (F13) incluindo configs de agentes; inject por agente; state upsert `agents.<id>` + createdFiles/preInstall; falha isolada por agente (D2)
- [x] Colisão de entry MCP não registrada no state → conflito reportado, não sobrescreve (D5)
- [x] Relatório por agente (TTY/--json com `agents`, detectOnly, failed); exit agregado ≠ 0 se alguma falha
- [x] **Verificar:** fixture com PATH prefix (fakes claude/opencode/codex) → cenários: sem bin (fail-closed + comando), misto, dry-run zero writes, inject por agente, rerun idempotente, colisão entry, config quebrada isola agente

## T7 — uninstall --agent (extensão do F12)

- [x] Filtro `--agent`; backup dos alvos registrados; remoção content-based: seções `runecraft:` + entries MCP só se valor atual == registrado (D7); editado → preserva + reporta (SETM-06)
- [x] Arquivo vazio/whitespace-only após remoção → removido; `{}`/sem seções em JSON/TOML → idem; conteúdo do usuário → permanece (D6)
- [x] Nunca toca: `~/.claude.json`, seções de outros owners, entries não registradas, conteúdo fora dos marcadores (D8)
- [x] State cleanup `agents[agentId]`; relatório removidos/preservados/reportados
- [x] **Verificar:** fixture com runecraft: + gentle-ai: + usuário → remove só o nosso; editado → preserva+reporta; vazio → arquivo removido

## T8 — Integração doctor/status/sync (leitura mínima; checks formais no F18)

- [x] `doctor`: agentes detectados reportados (instalado/não gerenciado) — checks 7–15 formalizados no F18
- [x] `status`: seção agentes (detectado, gerenciado, colisão) + `--json.agents`
- [x] `sync`: re-aplica inject() idempotente para seção/entry ausente (reconciliação formal no F17)
- [x] **Verificar:** fixture → doctor/status refletem detect+state; sync re-injeta seção apagada à mão

## Success Criteria (spec)

- [x] Fail-closed verificado (recusa + comando display-only) para os 3 agentes
- [x] Injecção por agente verificada em fixture (diff) com conteúdo do usuário preservado
- [x] Uninstall remove exatamente o que o harness injetou (seções `runecraft:` + MCP entries)

## Findings do Execute (2026-08-07)

- **`os.homedir()` vs `env.HOME`**: os homes dos agentes (claude/opencode/codex) usavam `os.homedir()` do processo — um teste de fixture quase tocou o `~/.claude` real. Corrigido: `homeDir(env) = env.HOME ?? os.homedir()` (config.ts). **Lição registrada**: todo path user-facing resolve do runtime env, nunca do processo.
- **`command -v` via `execFile("command", ...)` falha** (builtin do shell) — usar `sh -c "command -v <bin>"`.
- **Guard anti-upstream refinado**: barrar spec `npx -p <spec>` não-`@runecraft/` e paths em node_modules de upstream; NUNCA o nome do bin (`claude-taskflow-mcp` é nosso por design D4 — o fork preserva os nomes dos bins).
- **`upsertTomlSection` não escrevia o arquivo** (só retornava o conteúdo) — corrigido (escreve + mkdir -p).
- **Regex TOML guloso** (`\s*` consumia o corpo do bloco) — reescrito com âncora por linha.
- **dev path do resolveMcpBin**: os 6 packages MCP entraram como devDependencies do harness (D6: não são bundled — cross-check do gen-versions ajustado para "reference pins").
- **`--component` com `--agent` não-Pi**: recusa com motivo F17 ("é extensão Pi; use --agent pi") — implementado no install.
- **uninstall `--agent`** agora é seleção válida (antes exigia `--all`/`--component`).
- **doctor/status**: check 7 (agentes) aditivo; status ganhou `agents` no TTY+JSON; sync re-injeta seções/entries ausentes de agentes gerenciados (reconciliação formal no F17).
