# F16 — Tasks (Camada MCP do taskflow)

**Base:** design.md D1–D6 (aprovado, AD-013) · upstream heggria/taskflow v0.2.6 (clone `/tmp/taskflow-upstream`)

## T1 — Vendoring dos 6 packages (MCPL-01)

- [x] Adicionar 6 entries ao `vendor.manifest.json` (taskflow-mcp-core, taskflow-hosts, taskflow-codex, taskflow-claude, taskflow-opencode, taskflow-grok — subpaths do monorepo upstream → `packages/taskflow/{mcp-core,hosts,codex,claude,opencode,grok}`)
- [x] Rodar `bun scripts/vendor.ts <name>` para cada (sem `--force`; dirs novos)
- [x] **Verificar:** `ls packages/taskflow/<pkg>/vendor.json` para os 6; `src/`, `test/`, `tsconfig*.json`, `package.json` presentes; E2E `*.mts` presentes (inertes)

## T2 — Rename para @runecraft/* (MCPL-02)

- [x] `name` nos 6 package.json → `@runecraft/taskflow-mcp-core`, `@runecraft/taskflow-hosts`, `@runecraft/taskflow-{codex,claude,opencode,grok}`
- [x] `dependencies` `workspace:*` → `@runecraft/*` (mapeamento D2: taskflow-core/mcp-core/hosts)
- [x] `tsconfig.build.json`: `extends` sobe um nível (`../../../tsconfig.base.json`)
- [x] Remover `&& node ../../scripts/copy-readme.mjs <pkg>` dos scripts build (mcp-core + 4 adapters)
- [x] `devDependencies`: `typescript@6.0.3` + `@types/node@22` onde ausentes; hosts `^7.0.2` → `6.0.3` (validar compilação)
- [x] Adicionar `"test": "bun test"` nos 6 package.json
- [x] **Verificar:** `grep -r "workspace:" packages/taskflow/{mcp-core,hosts,codex,claude,opencode,grok}` → zero; `grep -r "copy-readme"` → zero; import map D2 sem sobras (grep `from "taskflow-` e `from "pi-taskflow`)

## T3 — tsconfig base: customConditions (edge spec)

- [x] `tsconfig.base.json`: adicionar `"customConditions": ["development"]` + `"allowImportingTsExtensions": true`
- [x] **Verificar:** `bun run build` do monorepo inteiro continua verde (forks existentes não regridem)

## T4 — Build + bins (MCPL-03/MCPL-04)

- [x] `bun run build` (turbo) → ordem core → {mcp-core, hosts} → {dsl, pi} → adapters
- [x] **Verificar:** `ls packages/taskflow/{codex,claude,opencode,grok}/dist/mcp/bin.js`; `bin` fields preservados (`<host>-taskflow-mcp`)

## T5 — Testes unit do upstream (MCPL-05/MCPL-06)

- [x] Excluir `taskflow-hosts/test/publish-verification.test.ts` (infra de publish upstream; importa raiz não vendorada)
- [x] `bun test` nos 6 packages → 15 arquivos unit verdes (jsonrpc/background-runs/trace-limit; args+runner por host; mcp-server por adapter)
- [x] E2E `*.mts` permanecem inertes (bun não descobre) — sem scripts test:e2e
- [x] **Verificar:** contagem pass/fail por package; falhas por ambiente classificadas (sem bloquear)

## T6 — Bin MCP funcional (MCPL-07)

- [x] Script node (~30 linhas) que spawna `packages/taskflow/claude/dist/mcp/bin.js` e faz handshake initialize + tools/list + tools/call básico
- [x] **Verificar:** tools `taskflow_run/list/verify/compile` presentes na resposta; `PI_TASKFLOW_CLAUDE_BIN` honrado (teste com bin fake ou env)

## T7 — Shapes de config validados p/ F15 (MCPL-08)

- [x] Conferir `plugin/` dos 4 adapters no fork vs. design D6 (claude `.mcp.json`, codex `config.toml` com `tool_timeout_sec: 1800`, opencode `opencode.json` com skills.paths)
- [x] Anotar no design do F15 qualquer divergência de shape encontrada
- [x] **Verificar:** shapes documentados no F16 D6 batem com o vendored (diff mental; sem código novo)

## Findings do Execute (2026-08-07)

- **bun test não roda os testes de adapter**: `serveStdio` + `input.end()` no bun dispara `teardown()` (aborta controllers) antes do handler async completar → resposta nunca escrita. Com node funciona (timing do event loop). Classificado MCPL-06 (ambiente).
- **Modo `--conditions=development` (src) diverge do dist**: `discoverAgents` carrega 18 built-ins do `src/agents/` → `agentDefinitionsIdentity` muda o hash do cache → teste de resume falha (fase done do parent re-executa). No dist (sem `dist/agents/`, BUG-2 do F7) retorna `[]` → 31/31. Classificado MCPL-06 (src vs dist).
- **Decisão**: script `test` dos 6 packages = `node --experimental-strip-types --test 'test/**/*.test.ts'` (modo dist, E2E `*.mts` inertes, publish-verification já excluído). Resultado: mcp-core 30/30, hosts 115/115, codex 31/31, claude/opencode/grok 4/4.
- **import.meta.resolve** no src (background.ts + 4 server.ts) não foi pego pelo sed de rename — corrigido à mão (MCPL-02).
- **`types: ["node"]`** ausente nos tsconfigs dos 6 (upstream herdava do base do monorepo dele) — adicionado (padrão F3).
- **Build com `(tsc ... || [ -d dist ])`** necessário nos 6 (type errors TS6-vs-TS5 conhecidos do core propagam via customConditions) — padrão F3.
- **Lint raiz** ignora `packages/**` (AD-006); os 12 erros do `bun run lint` são artefatos de runtime (`.pi/taskflows/runs/`, `.guild/runtime/sessions/`) — pré-existentes, fora do escopo.
- **Shapes de config** (T7) batem 100% com D6: claude `mcpServers.taskflow` (command/args), codex + `tool_timeout_sec: 1800`, opencode `mcp.taskflow` + `skills.paths`, grok sem template.
- **Pins npx nos `plugin/`** permanecem como referência upstream (D6) — o F15 nunca injeta esses arquivos; renderiza templates com bin do fork.
