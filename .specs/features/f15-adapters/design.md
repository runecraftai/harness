# F15 Design — Adapters v1 (Claude Code, OpenCode, Codex)

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** G1 marcadores `runecraft:` em todos os agentes (append, nunca file-replace) · config MCP renderizada pelo CLI em runtime (path real do bin do fork; nunca `npx -y -p <upstream>@...`) · detecção por binário no PATH (dir de config é informativo) com fail-closed display-only

## Contexto

F11 entrega o CLI (`install`/`doctor`/`status`/`sync`/`uninstall`) servindo o Pi nativamente (F2–F5). A pegada gentle-ai (AD-008/AD-009) exige servir também Claude Code, OpenCode e Codex — agentes cujas configs moram fora do `~/.pi`. F15 implementa os **adapters** que o CLI usa para detectar, injetar e remover nesses agentes; o que cada agente recebe (coluna da matriz) é formalizado no F17; os bins MCP do taskflow vêm do F16 (re-vendor da camada MCP, que fornece `dist/mcp/bin.js` por host e as configs `plugin/` de referência).

Princípios herdados: não-clobber (F14) — conflito reportado, nunca sobrescrever; estado + backups (F13) — tudo o que tocamos é registrado e snapshotado antes; remoção só do gerenciado (F12).

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Interface `AgentAdapter`** em `src/adapters/` com `detect()`, `inject()`, `remove()`, `paths()`; registro por id (`claude-code`/`opencode`/`codex`/`pi`) + dispatch por `--agent` | Um shape só para os 3 adapters; o Pi não vira adapter (fluxo F11 intacto) |
| D2 | **Falha isolada por agente**: agente com config quebrada (JSON/TOML inválido) aborta só ele apontando o arquivo; os demais prosseguem; exit ≠ 0 no final | Spec edge; evita all-or-nothing (mesma filosofia do F11 para componentes) |
| D3 | **Injecção de regras = append/upsert de seção com marcadores** `<!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->` (G1); rerun atualiza a seção, nunca duplica | Idempotência (CLI-08) sem clobber |
| D4 | **MCP renderizado em runtime** por `resolveMcpBin()`: env override > path local do fork (dev, via `require.resolve` no workspace) > `npx -y -p @runecraft/taskflow-<host>@<pin> <host>-taskflow-mcp` (publish; pin de `versions.ts` do F11); guard rejeita qualquer referência a upstream | F16 gray area (b); decisão 2; AC 4.2 do F16 |
| D5 | **MCP entry upsert só se (a) ausente ou (b) registrada no state**; presente e não registrada → conflito reportado, não sobrescreve (tratamento real no F18) | F17 edge (upstream `codex-taskflow` à mão); colisão não é nosso papel resolver no v1 |
| D6 | **Remoção content-based**: remove seções `runecraft:` + entries MCP registradas; arquivo que ficou vazio/whitespace-only após a remoção → removido; senão preservado intacto | ADPT-07 AC 3.2/3.3; mais conservador que "remover createdFiles inteiro" do F12 para arquivos de regras que são shared com o usuário |
| D7 | **Entry MCP removida só se valor atual == valor registrado** (fingerprint no state); usuário editou → preserva + reporta (regra SETM-05 do F14) | Uninstall nunca desfaz edição do usuário |
| D8 | **`~/.claude.json` fora do conjunto gerenciado**: nunca lido para escrita, nunca resetado, nunca removido; ilegível no momento da operação do claude → abort display-only | Edge da spec (sessão OAuth, padrão gentle-ai) |
| D9 | **Overrides de config dir por env** (`RUNECRAFT_CLAUDE_HOME` etc.) + PATH prefix para fakes | Testabilidade determinística (F21) sem agentes reais |

## Arquitetura — módulos

```
packages/harness/src/
├── adapters/
│   ├── types.ts          # interface AgentAdapter + DetectResult, HostPaths, InjectPlan, McpEntry
│   ├── registry.ts       # id → adapter; ids conhecidos sem adapter (detect-only, F17); aliases
│   ├── rules.ts          # renderRules(): seção runecraft:workflow (newline/BOM/CRLF-aware, upsert por marcador)
│   ├── mcpConfig.ts      # renderMcpConfig(host, ctx) + resolveMcpBin() (D4) + guard anti-upstream
│   ├── claude.ts         # adapter claude-code (CLAUDE.md + ~/.claude/.mcp.json)
│   ├── opencode.ts       # adapter opencode (AGENTS.md + merge mcp.taskflow em opencode.json; XDG-aware)
│   └── codex.ts          # adapter codex (AGENTS.md + [mcp_servers.taskflow] em config.toml)
├── toml.ts               # upsert mínimo de [mcp_servers.X] sem lib (ver Riscos)
└── commands/
    ├── install.ts        # fluxo estendido com --agent (abaixo)
    └── uninstall.ts      # fluxo estendido com --agent (abaixo)
```

```ts
interface AgentAdapter {
  id: "claude-code" | "opencode" | "codex";
  bin: string;                                  // "claude" | "opencode" | "codex"
  installHint: string;                          // comando display-only de instalação (validar no Execute)
  detect(env): Promise<DetectResult>;           // { installed, binPath?, configHome, reasons[] }
  paths(env): HostPaths;                        // { rulesFile, mcpFile, mcpKey, configHome }
  inject(ctx: InjectContext): Promise<InjectResult>;  // regras + MCP + registro no state
  remove(ctx: RemoveContext): Promise<RemoveResult>;  // só o gerenciado
}
```

`state.ts` ganha extensão **aditiva** do schema F13 (v1, sem bump — schema único definido no F17 D2; revisão cruzada 2026-08-05): mapa `agents` por id com `installedAt`, `harnessVersion` e `targets[]` (kinds `rules` com file/section/contentHash e `mcp` com file/entry/bin/contentHash). `createdFiles`/`settingsChanges`/`preInstall` permanecem campos top-level do F13 — sem duplicação interna por agente.

## Fluxo do install (extensão do F11)

```
install [--agent pi,claude-code,...] [--component a,b] [--preset minimal|full] [--dry-run] [--json] [--scope global|workspace] [--yes]
```

`--agent` default = `pi` (compat total com F11; o fluxo do Pi não muda). Agentes não-Pi seguem:

1. **Dispatch**: split por vírgula; cada id → `registry`. Id sem adapter (ex.: `cursor`) → **detect-only com guia** no relatório, segue (ADPT-03; F17 AC 2.3 — sem fail).
2. **detect()** por agente (ordem do `--agent`): `command -v <bin>` (PATH herdado). Ausente → **fail-closed**: stderr com o comando exato de instalação (`installHint`, display-only, nunca executado), marca fail do agente, segue os demais. Presente → resolve `configHome` (D9: env override > XDG_CONFIG_HOME para opencode, se absoluto > `os.homedir()`).
3. **Plano**: coluna do agente (F17) = `rules` + `taskflow-mcp` (F16). `--component` para não-Pi aceita esses items; item fora da coluna (ex.: `goal-loop-audit` para claude) → recusa com a mensagem do F17 ("é extensão Pi; use --agent pi") e exit ≠ 0. O plano lista as file ops: `{file, op: create|append|upsertSection|upsertJsonKey|upsertTomlKey}`.
4. **dry-run** → imprime o plano por agente (arquivos alvo com paths resolvidos) e sai sem escrever (ADPT-04).
5. **Backup** (F13): snapshot dos arquivos alvo do passo 3 (fail-safe: espaço + snapshot antes de qualquer write) — os alvos passam a incluir `CLAUDE.md`/`AGENTS.md`/`.mcp.json`/`opencode.json`/`config.toml`.
6. **Inject** por agente (detalhe por host abaixo). Erro de config (JSON/TOML inválido) → aborta só o agente apontando o arquivo (D2). `~/.claude.json` ilegível → abort do claude sem resetar (D8).
7. **State**: upsert `agents[agentId]` — arquivos criados do zero em `createdFiles`, entries MCP em `mcpEntries` (com valor injetado), `preInstall` com hashes.
8. **Relatório** (`report.ts`): TTY → seção por agente (`installed`/`created`/`updated`/`conflicts`/`failed` + detect-only); `--json` → `{agents: {<id>: {...}}, detectOnly: [...], failed: [...]}`. Exit ≠ 0 se algum agente falhou.

## Detecção

| Agente | Bin (PATH) | Config home (informativo) | Install hint (display-only) |
| --- | --- | --- | --- |
| claude-code | `command -v claude` | `~/.claude` (override `RUNECRAFT_CLAUDE_HOME`) | comando oficial de instalação do Claude Code — **validar no Execute** |
| opencode | `command -v opencode` | `$XDG_CONFIG_HOME/opencode` se XDG setado e absoluto, senão `~/.config/opencode` (override `RUNECRAFT_OPENCODE_HOME`) | idem — **validar no Execute** |
| codex | `command -v codex` | `~/.codex` (override `RUNECRAFT_CODEX_HOME`) | idem — **validar no Execute** |

- Binário presente = **instalado**; config home é informativo (não bloqueante) — padrão gentle-ai (ADPT-02). Bin ausente + config dir existente → considerado ausente (fail-closed).
- Bin presente + config home ausente → instalação prossegue; o inject cria os dirs (edge da spec).
- `installHint` vive como constante por adapter, exibida só no fail-closed; os comandos oficiais exatos são confirmados no Execute (docs oficiais de cada agente; gentle-ai `usage.md` como referência).

## Injecção por agente

### Regras (os 3 agentes) — `rules.ts`

Alvo: claude → `~/.claude/CLAUDE.md` · opencode → `<cfg>/AGENTS.md` · codex → `~/.codex/AGENTS.md`.

- Seção renderizada: `<!-- runecraft:workflow -->\n<conteúdo>\n<!-- /runecraft:workflow -->`; conteúdo = regras de workflow da coluna do F17 (template determinístico em `rules.ts`; o texto final das regras é definido no F17).
- Arquivo inexistente → cria com a seção (mkdir -p do dir). Existente → append no fim com quebra de linha garantida; conteúdo pré-existente **intacto byte a byte** (ADPT-06).
- Seção `runecraft:workflow` já presente → **upsert do conteúdo interno** (rerun não duplica; D3).
- Coexistência: conteúdo do usuário e seções `gentle-ai:`/outras permanecem intactas (G1).
- Encoding/terminação: detecta BOM (preserva na posição 0), CRLF vs LF (usa a terminação do arquivo na seção) — ver Riscos.

### MCP por host — `mcpConfig.ts` (shapes validar no Execute contra `plugin/` do F16)

| Host | Arquivo | Chave/forma | Ops |
| --- | --- | --- | --- |
| claude | `~/.claude/.mcp.json` (plugin scope) | `{"mcpServers": {"taskflow": {"type": "stdio", "command": "<bin>", "args": [...]}}}` | upsert da chave `mcpServers.taskflow`; JSON inválido → abort do agente |
| opencode | `<cfg>/opencode.json` | `{"mcp": {"taskflow": {"type": "local", "command": ["<bin>", ...], "enabled": true}}}` | deep merge **só** em `mcp.taskflow`; demais chaves de `mcp` e do arquivo intactas |
| codex | `~/.codex/config.toml` | `[mcp_servers.taskflow]` com `command`/`args` | upsert do bloco `[mcp_servers.taskflow]` (toml.ts); demais seções byte a byte |

**Resolução do bin do fork** (`resolveMcpBin(host, ctx)` — D4):

1. `RUNECRAFT_TASKFLOW_<HOST>_BIN` (override — fixtures e power users);
2. dev (monorepo): `require.resolve("@runecraft/taskflow-<host>/package.json")` → `dist/mcp/bin.js` (caminho absoluto local);
3. publish: `npx -y -p @runecraft/taskflow-<host>@<pin> <host>-taskflow-mcp` (pin de `versions.ts`, mecanismo do F11; forma exata do comando publicado validar no Execute do F16/F9).

**Guard anti-upstream** (F16 AC 4.2): o renderer monta o comando exclusivamente a partir do resultado de `resolveMcpBin()`; se o resultado contém nomes upstream conhecidos (`codex-taskflow`, `claude-taskflow`, `opencode-taskflow`, `grok-taskflow`, `taskflow-mcp` sem prefixo `@runecraft/`) → erro de template, nunca injeta.

**Colisão (D5)**: entry MCP existente no arquivo e **não** registrada no state → conflito reportado (path + dono presumido), sem sobrescrever; tratamento real no F18.

## Remoção — `uninstall --agent a,b` (extensão do F12)

Fluxo por agente (filtro `--agent`; default sem filtro segue o F12):

1. **Backup** (F13) dos alvos registrados no state para o agente.
2. **Regras**: remove a seção `<!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->` do rulesFile (delimitada pelos marcadores; whitespace residual colapsado no ponto de remoção — nada além disso).
3. **MCP entries** (`agents.<id>.targets` kind `mcp` — schema F17 D2): remove a chave/entry registrada **só se o valor atual == valor registrado** (D7); editado pelo usuário → preserva + reporta (`preserved (edited)`, formato SETM-06). Entry não registrada → não toca.
4. **Arquivo vazio** (D6): após 2–3, rulesFile/mcpFile vazio ou whitespace-only → remove o arquivo (ADPT-07 AC 3.2; vale também para arquivo que pré-existia vazio). `opencode.json`/`config.toml` que ficaram `{}`/sem seções → idem. Com conteúdo do usuário → permanece intacto (AC 3.3).
5. **Nunca toca** (D8): `~/.claude.json`, seções `gentle-ai:`/de outros owners (AC 3.4), entries MCP não registradas, qualquer conteúdo fora dos marcadores/chaves gerenciadas, config sem registro no state.
6. **State cleanup**: remove `agents[agentId]` (upsert; modo conservador do F12 se state corrompido — remove só o que os marcadores `runecraft:` permitem atribuir com segurança).
7. **Relatório**: removidos / preservados (editado) / preservados (outro owner) / reportados (conflito).

`doctor`/`status`/`sync` (F12) ganham leitura dos adapters via `detect()` + state: agentes detectados reportados com a coluna da matriz e estado (F17 AC 3.2/3.3); `sync` re-aplica `inject()` idempotente para seção/entry ausente (a reconciliar no F17).

## Testabilidade (F21)

| Mecanismo | Uso |
| --- | --- |
| `RUNECRAFT_CLAUDE_HOME` / `RUNECRAFT_OPENCODE_HOME` / `RUNECRAFT_CODEX_HOME` | fixture de config dirs sem tocar o `~` real (D9) |
| `XDG_CONFIG_HOME` (temporário, absoluto) | caso XDG do opencode (edge da spec) |
| PATH prefix com fakes (`claude`, `opencode`, `codex` — scripts `#!/bin/sh echo fake`) | detecção real via `command -v` sem agentes; ambiente "sem bin" = PATH limpo |
| `RUNECRAFT_TASKFLOW_<HOST>_BIN` | aponta o MCP renderizado para um bin fake sem precisar do F16 instalado |
| Golden fixtures | before/after por operação (install/uninstall/rerun) com conteúdo do usuário + seções `gentle-ai:` + BOM/CRLF + symlink |

Casos cobertos sem agentes reais: fail-closed (exit ≠ 0 + comando display-only), dry-run (zero writes — diff de mtime/hash), injecção por agente (diff), preservação de conteúdo, idempotência (rerun = zero mudanças), uninstall remove só o gerenciado, colisão de entry não registrada, config inválida aborta só o agente, `~/.claude.json` intocado.

## Riscos

| Risco | Mitigação |
| --- | --- |
| **TOML sem lib** (zero deps de runtime, F11): upsert manual pode corromper sintaxe (strings com aspas/backslash, arrays multiline, comentários) | `toml.ts` opera só no bloco `[mcp_servers.taskflow]` (basic strings, valores simples: command/args/environment); resto do arquivo preservado byte a byte; smoke test valida o resultado com lib TOML como devDep; campos exatos do schema `mcp_servers` do Codex **validar no Execute** |
| **Merge em opencode.json sem clobber**: re-stringify muda formatação do usuário | Merge profundo só em `mcp.taskflow`; reescrita com indent detectada do arquivo original (2/4/tabs); conteúdo preservado (formatação pode mudar — aceito e documentado); `opencode.jsonc` (comentários) → comportamento **validar no Execute** (spec/pesquisa dizem `opencode.json`) |
| **BOM/encoding/CRLF em CLAUDE.md/AGENTS.md**: inserção em encoding não-utf8 corrompe | Leitura como buffer; BOM preservado na posição 0; CRLF detectado e usado na seção; arquivo não-utf8 → abort do agente apontando o arquivo (nunca corromper); comportamento dos agentes com BOM **validar no Execute** |
| **Symlinks** (config dir ou arquivo alvo) | Escrever através do path preserva o link (F13 edge); backup resolve o alvo real; nada de `realpath` na escrita |
| **Referência a upstream na config MCP** | Guard anti-upstream no renderer (D4); teste dedicado (F16 AC 4.2) |
| **Entry MCP órfã do usuário com o mesmo nome** (`taskflow`) | D5/D7: nunca sobrescreve/remove sem registro no state; reporta (F18 trata) |
| **Config quebrada num agente derruba os demais** | Falha isolada por agente (D2), exit agregado ≠ 0 |
| **`~/.claude.json` resetado/removido por engano** | D8: fora do conjunto gerenciado; teste explícito de não-tocar |
| **Conteúdo das regras depende do F17** | F15 entrega o mecanismo (marcadores/upsert/remoção) + template determinístico; texto final no F17; shape do `.mcp.json`/`opencode.json`/`config.toml` validado contra `plugin/` do F16 no Execute |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| ADPT-01 | P1: Detecção (fail-closed com comando display-only, exit ≠ 0) | Fluxo install passo 2; Detecção; Riscos |
| ADPT-02 | P1: Detecção (bin no PATH = instalado; config dir informativo) | Detecção |
| ADPT-03 | P1: Detecção (misto suportado/não suportado → prossegue + detect-only com guia) | Fluxo install passo 1 |
| ADPT-04 | P1: Detecção (dry-run imprime plano por agente sem escrever) | Fluxo install passo 4 |
| ADPT-05 | P1: Injecção por agente (CLAUDE.md + .mcp.json / AGENTS.md + opencode.json / AGENTS.md + config.toml) | Injecção por agente (tabela MCP + Regras) |
| ADPT-06 | P1: Injecção (arquivo ausente criado; conteúdo existente preservado) | Regras (append/upsert); Edge: bin presente + dir ausente → cria dirs |
| ADPT-07 | P2: Remoção (seções + entries; vazio removido; usuário/outros owners preservados) | Remoção (passos 2–5) |

**Cobertura:** 7/7 mapeados. F16 AC 4.1/4.2 atendidos via D4 (path do fork + guard anti-upstream); F17 AC 2.3/3.x habilitados via `detect()` reutilizável e plano por coluna (validação formal no F17).
