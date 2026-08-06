# F16 Design — Camada MCP do taskflow (re-vendor)

**Status:** Ready for Execute (após aprovação)
**Base:** upstream heggria/taskflow v0.2.6 (clone em /tmp/taskflow-upstream, verificado 2026-08-05) · padrão F1/F3 de vendoring · templates F15

## Contexto

O AD-007 deferiu a camada MCP do taskflow (6 packages) e o AD-009 a reativou como F16: ela é exatamente o componente cross-agent que dá DAG/FlowIR a Claude Code, OpenCode e Codex — o pré-requisito de entrega do F15. Pesquisa verificada na tag v0.2.6 (2026-08-05):

- **taskflow-mcp-core**: servidor MCP stdio com JSON-RPC hand-rolled (`src/mcp/{jsonrpc,server,svg,background}.ts`), **zero deps de runtime** além de taskflow-core. 14 tools `taskflow_*` (run/runs/resume/list/show/verify/compile/peek/trace/replay/why_stale/recompute/reconcile_workspace/save/search). `main`/`exports` apontam para `./dist/mcp/server.js`.
- **taskflow-hosts**: runners compartilhados (argv builders + parsers de event-stream + child-env) para codex/claude/opencode/grok; resolução do bin por `process.env.PI_TASKFLOW_<HOST>_BIN || "<host>"` (verificado em codex-runner.ts); child-env com allowlist (CHILD_ENV_ALLOWLIST_ENV) e keys host-only.
- **4 adapters** (`codex|claude|opencode|grok-taskflow`): `src/index.ts` (re-export do runner via `taskflow-hosts/<host>`), `src/mcp/server.ts`, `src/mcp/bin.ts` (entry stdio), `bin: {"<host>-taskflow-mcp": "./dist/mcp/bin.js"}`, `plugin/` com configs de host + skills/assets.
- **Configs por host** no `plugin/`: codex/claude/grok → `plugin/.mcp.json` com `npx -y -p <host>-taskflow@0.2.6 <host>-taskflow-mcp` (codex **e grok** com `tool_timeout_sec: 1800`; claude sem); opencode → `plugin/opencode.json` (`mcp.taskflow` type local + `skills.paths: ["./skills"]`). Nenhum adapter publica `plugin/` além do opencode (`files: ["dist"]` nos demais; opencode `["dist", "plugin"]`).
- **Correção factual vs. spec** (verificada 2026-08-05): os pins `npx -y -p <host>-taskflow@0.2.6` do registry **não estão nos E2E (\*.mts)** — nenhum `.mts` referencia npx; os E2E spawnam os CLIs reais dos hosts (via runner, PATH ou `PI_TASKFLOW_<HOST>_BIN`) e o E2E-MCP spawna o bin local com `node --experimental-strip-types`. Os pins npx vivem **nas configs `plugin/`** — que substituímos por templates (D6). O efeito prático é o mesmo: E2E exigem CLIs reais autenticados e não rodam no fork.
- **Extra verificado**: `taskflow-hosts/test/publish-verification.test.ts` importa `../../../scripts/verify-published-package.mjs` e lê `../../../.github/workflows/publish.yml` — arquivos da raiz do monorepo upstream que o vendoring por subpath não traz. Não é E2E de host: testa a pipeline de publish do upstream contra o registry.

## Decisões

### D1 — Vendoring: 6 entries no manifest, script sem mudanças (MCPL-01)

O `scripts/vendor.ts` já resolve subpaths de um mesmo repo (core/pi/dsl usam heggria/taskflow@v0.2.6 com subpaths diferentes) — **nenhuma mudança no script**. Adicionar ao `vendor.manifest.json`:

| name | repo | ref | npmName | npmVersion | subpath | dest |
| --- | --- | --- | --- | --- | --- | --- |
| taskflow-mcp-core | heggria/taskflow | v0.2.6 | taskflow-mcp-core | 0.2.6 | packages/taskflow-mcp-core | packages/taskflow/mcp-core |
| taskflow-hosts | heggria/taskflow | v0.2.6 | taskflow-hosts | 0.2.6 | packages/taskflow-hosts | packages/taskflow/hosts |
| taskflow-codex | heggria/taskflow | v0.2.6 | codex-taskflow | 0.2.6 | packages/codex-taskflow | packages/taskflow/codex |
| taskflow-claude | heggria/taskflow | v0.2.6 | claude-taskflow | 0.2.6 | packages/claude-taskflow | packages/taskflow/claude |
| taskflow-opencode | heggria/taskflow | v0.2.6 | opencode-taskflow | 0.2.6 | packages/opencode-taskflow | packages/taskflow/opencode |
| taskflow-grok | heggria/taskflow | v0.2.6 | grok-taskflow | 0.2.6 | packages/grok-taskflow | packages/taskflow/grok |

Proveniência por package (repo/ref/SHA/versão) gravada pelo próprio script em `vendor.json` (mecânica F1/F10 inalterada). O rename para `@runecraft/*` **nunca** acontece no script — é etapa do fork (comentário do manifest + precedente F3).

### D2 — Rename: workspace:\* → @runecraft/\* (MCPL-02)

**Mapa de imports** (varredura 2026-08-05 dos 6 packages: só 3 nomes aparecem — sem pi-taskflow/dsl):

| Import upstream | Import no fork |
| --- | --- |
| `taskflow-core` (33 usos) | `@runecraft/taskflow-core` (já existe) |
| `taskflow-mcp-core` + `/jsonrpc`, `/server` (14 usos) | `@runecraft/taskflow-mcp-core` (+ subpaths) |
| `taskflow-hosts` + `/codex`, `/claude`, `/opencode`, `/grok` (11 usos) | `@runecraft/taskflow-hosts` (+ subpaths) |

**Ajustes por package** (em `package.json`, `tsconfig*.json` e scripts):

1. `name` → `@runecraft/taskflow-mcp-core`, `@runecraft/taskflow-hosts`, `@runecraft/taskflow-{codex,claude,opencode,grok}` (espelha upstream; **nenhuma colisão** com `@runecraft/taskflow` nem com `@runecraft/claude-auth` — nomes distintos).
2. `dependencies`: `workspace:*` → `@runecraft/*: workspace:*` (tabela acima). **Sem peerDeps novos** — os 6 só declaram deps entre si e com core; o `typebox` peer do core já foi resolvido no F3 (validar no Execute se algo importa typebox transitivamente em runtime — esperado que não, mcp-core só usa APIs públicas do core).
3. `tsconfig.build.json`: `extends` sobe um nível (`"../../tsconfig.base.json"` → `"../../../tsconfig.base.json"` — os dests ficam em `packages/taskflow/<pkg>`). Manter `rewriteRelativeImportExtensions` (os src importam relativos com `.ts` — verificado em `server.ts`/`index.ts`).
4. **Build scripts**: remover `&& node ../../scripts/copy-readme.mjs <pkg>` (mcp-core + 4 adapters) — precedente F3 (copy-readme/stamp-build-info removidos; não existem no harness). Consequência verificada: só `taskflow-hosts/README.md` é commitado no upstream (todos os demais são gerados por esse script e git-ignored) → os 5 packages restantes ficam sem README.md, aceitável no fork (F9 pode adicionar na fase de publish se quiser README no tarball).
5. `devDependencies`: adicionar `typescript@6.0.3` + `@types/node@22` onde ausentes (mcp-core e 4 adapters não têm devDeps; hosts traz `typescript ^7.0.2` — **alinhar a 6.0.3, convenção F3**; validar no Execute se o código de hosts compila com TS 6.0.3, senão subir para 7 no monorepo).
6. `scripts.test`: adicionar `"test": "bun test"` por package — integra os 6 ao `turbo test` (tarefa já existe com `dependsOn: ["build"]`; turbo pula package sem script — verificado com `--filter`). Os forks F3 (core/pi/dsl) não têm test script; não tocar neles (fora do escopo F16).

**Renomear não é reformatar** (AD-006): só os pontos acima; o resto do source permanece byte-a-byte igual ao upstream para manter sync file-to-file (F10).

### D3 — tsconfig base: adicionar `customConditions` (edge case da spec)

O edge case da spec pede `customConditions: ["development"]` no tsconfig base. Verificação empírica (2026-08-05, bun 1.3.14): **bun não aplica `customConditions`** — com tsconfig contendo a opção, `require.resolve`/`import` de `@runecraft/taskflow-core` resolvem a condição `default` (`dist/index.js`), não `development` (`src/index.ts`). Ou seja:

- **Testes com bun** rodam contra `dist/` (condição default). É seguro porque `turbo test` depende de `build` (dist sempre presente) — mesmo padrão dos forks F3 (1540/1585 verdes).
- **Node** aplica via flag: `node --conditions=development --experimental-strip-types --test` (modo upstream) — mantido como script opcional `test:node` para paridade dev/src quando necessário.

Decisão: adicionar `customConditions: ["development"]` **e** `allowImportingTsExtensions: true` ao `tsconfig.base.json` do monorepo (espelha o base do upstream; o TS usa para typecheck/editors; inócuo para forks sem exports `development`; para os forks taskflow, o tsc passa a resolver types/src pelo mesmo caminho do runtime dev). Risco de regressão nos forks existentes: baixo (bun ignora; tsc usa `types` antes de `default`). Validar no Execute: `bun run build` completo no monorepo após a mudança.

### D4 — Build: ordem via turbo, bins preservados (MCPL-03/MCPL-04)

- `turbo.json` **sem mudanças**: `build.dependsOn: ["^build"]` já ordena topologicamente pelas `workspace:*` deps — core → {mcp-core, hosts} → {dsl, pi} → adapters (cada adapter espera core+hosts+mcp-core). Ordem alvo da spec satisfeita transitivamente. Validar no Execute: turbo resolve o DAG completo (build de dsl/pi não muda — deps só de core).
- **Bins**: nomes upstream preservados — `codex-taskflow-mcp`, `claude-taskflow-mcp`, `opencode-taskflow-mcp`, `grok-taskflow-mcp` → `./dist/mcp/bin.js`. São o contrato com as configs de host (D6) e com o registro `codex mcp add taskflow -- <bin>`. **Não renomear** para `@runecraft/*-mcp`.
- Independent Test AC 1.4: `ls packages/taskflow/<host>/dist/mcp/bin.js` para cada adapter após `bun run build`.

### D5 — Testes: unit rodam, E2E inertes, publish-verification excluído (MCPL-05/MCPL-06)

**Rodam no fork** (15 arquivos, `bun test` contra dist):

| Package | Arquivos | O que cobrem |
| --- | --- | --- |
| taskflow-mcp-core | test/{background-runs,jsonrpc-cancellation,trace-limit}.test.ts | runs em background (fixtures/), cancelamento JSON-RPC, limite de trace |
| taskflow-hosts | test/{codex,claude,opencode,grok}-{args,runner}.test.ts | argv builders + parsers de event-stream + child-env por host |
| 4 adapters | test/mcp-server.test.ts cada | handshake MCP (initialize/tools/list/tools/call) via JSON-RPC in-memory (PassThrough), sem processo real |

Nota verificada: os testes de adapter assertam `serverInfo.version === "0.2.6"` — o fork mantém `version: 0.2.6` → passam. **Registro para o F9**: bump de versão no publish quebra esses asserts (ajustar na fase de publish, não agora).

**Classificação das falhas** (MCPL-06):

| Teste | Classe | Tratamento no fork |
| --- | --- | --- |
| E2E `*.mts` (11 arquivos: codex 4, claude 2, opencode 2, grok 2, pi-terminal-reap 1) | E2E com CLIs reais autenticados | **Vendorar (sync file-to-file, AD-006) e deixar inertes**: `bun test` não descobre `e2e-*.mts` (verificado empiricamente — só `*.test.ts` casa) e o glob `*.test.ts` do upstream também os exclui; sem scripts `test:e2e-*` no fork → movem para o F22 (EVAL) |
| hosts/test/publish-verification.test.ts | Infra de publish do upstream (registry/SLSA/workflow) | **Excluir do fork** (deletar na etapa de rename): importa `scripts/verify-published-package.mjs` e `.github/workflows/publish.yml` (raiz do upstream, não vendorados) — não testa código do fork. Registrar no F10 (sync) como exclusão permanente |
| Falha por ambiente (CLI real ausente) | Ambiente | Classificar e mover para F22 sem bloquear o v1 (AC 2.4) |

### D6 — Configs de host: templates do F15 (MCPL-08)

O F15 renderiza as configs; o F16 define o **schema dos templates** (fonte: `plugin/` upstream, com o pin npx substituído):

**Dev** (path local resolvido em runtime pelo F15 — após `bun run build`):

- **claude** (`~/.claude/.mcp.json`): `{"mcpServers": {"taskflow": {"command": "node", "args": ["<abs>/packages/taskflow/claude/dist/mcp/bin.js"]}}}`
- **codex** (`~/.codex/config.toml`, upsert `[mcp_servers.taskflow]`): mesmo comando/args + **`tool_timeout_sec: 1800` preservado** (única customização do upstream)
- **opencode** (`opencode.json`): `mcp.taskflow = {type: "local", command: ["node", "<abs>/packages/taskflow/opencode/dist/mcp/bin.js"], enabled: true}` + `skills.paths` resolvido para `<abs>/packages/taskflow/opencode/plugin/skills` (o opencode é o único que publica `plugin/` — `files: ["dist", "plugin"]`)
- **grok**: vendored e testado, **sem template injetado no v1** (detect-only, F17; decisão aprovada — custo zero de sync)

**Publish** (F9, quando os packages estiverem no registry): `npx -y -p @runecraft/taskflow-<host>@<versão> <host>-taskflow-mcp` — mesma forma do upstream, mas com o **nosso** scope; `<versão>` vem do `src/versions.ts` do F11 (fonte única: vendor.manifest.json).

**Regra de rejeição (AC 4.2)** — o CLI F15 rejeita qualquer config cujo spec npm de command/args **não comece com `@runecraft/`** (o `codex-taskflow@0.2.6` do upstream cai nessa regra): nunca injetamos dependência externa não gerenciada.

## Fluxos

**Vendoring** (1x): `bun scripts/vendor.ts taskflow-mcp-core` … `grok` (6 chamadas; dirs novos, sem `--force`) → rename (D2) → `bun install` (lock das novas workspace deps) → `bun run build` → `bun test` (via turbo ou por package).

**Dev → produto**: `bun run build` (turbo ordena core → mcp-core/hosts → adapters; dist por adapter) → bin `dist/mcp/bin.js` responde a `initialize`/`tools/list` via stdio (P2 AC 3.1; teste independente: script node ~30 linhas que spawna o bin e faz o handshake) → F15 injeta o template com o path absoluto do dist → host spawna o bin → tools `taskflow_*` disponíveis. `PI_TASKFLOW_<HOST>_BIN` continua honrado pelos runners (AC 3.2 — código upstream intacto).

## Riscos

| Risco | Mitigação |
| --- | --- |
| **npm pack/bundledDependencies não se aplica** — os 6 são libs/bins individuais publicados no registry (não meta-package); o umbrella F6 não os bundla (não são extensões Pi) e a distribuição cross-agent é via configs F15 apontando para os packages publicados | Sem ação no F6; validar no Execute se o F6 precisa mencioná-los em docs/doctor |
| **dist ausente no dev**: os bins e os templates apontam `dist/mcp/bin.js`; sem build prévio a config quebra | `turbo test` já depende de build; o F15 deve checar existência do dist e falhar com mensagem clara ("rode bun run build") — validar no Execute |
| **Colisão de nomes** `@runecraft/taskflow-*` vs `@runecraft/taskflow` (adapter Pi) vs `@runecraft/claude-auth` | Nenhuma — nomes distintos (verificado; espelha upstream). Não há `@runecraft/taskflow-mcp` genérico |
| **TS 6.0.3 vs 7.0.2** (hosts pede ^7.0.2) | Alinhar a 6.0.3 (F3); se o código usar features TS7, subir o TS do monorepo — validar no Execute |
| **bun não aplica condição `development`** (verificado) | Testes rodam contra dist (turbo build garante); `node --conditions=development` disponível como `test:node` para paridade com upstream — validar no Execute se algum teste diverge src vs dist |
| **`customConditions` no base afeta forks existentes** | Esperado inócuo (bun ignora; tsc prefere `types`); rodar `bun run build` do monorepo inteiro no Execute |
| **Version asserts `"0.2.6"` nos testes de adapter** | Passam agora; quebram no primeiro bump do F9 — ajustar no publish (registrado em D5) |
| **background-runs.test.ts spawna processos node** (fixtures/background-runner.mjs) | Requer node ≥22.19 (piso do monorepo) e comportamento de processo sob bun — classificar falha por ambiente (MCPL-06) se divergir |
| **`PI_TASKFLOW_BUILTIN_AGENTS_DIR`** (env que o upstream zera nos scripts de teste) | Default do core funcionou nos forks F3 sem o env; se hosts/mcp-core dependerem do env vazio, setar nos scripts test — validar no Execute |
| **E2E e publish-verification excluídos criam diff de sync** (F10) | Exclusão documentada neste design; o F10 (three-way merge sobre vendor.json) deve tratar como exclusão intencional |

## Requisitos cobertos

| Requirement ID | Cobertura |
| --- | --- |
| MCPL-01 (vendor AC 1.1) | D1 — 6 entries no vendor.manifest.json; script inalterado; vendor.json por package |
| MCPL-02 (rename AC 1.2) | D2 — tabela de mapeamento; extends; build scripts; devDeps; test scripts |
| MCPL-03 (build order AC 1.3) | D4 — `^build` do turbo resolve a ordem core → mcp-core/hosts → dsl/pi → adapters |
| MCPL-04 (bins AC 1.4) | D4 — `bin: {"<host>-taskflow-mcp": "./dist/mcp/bin.js"}` preservado; Independent Test via ls |
| MCPL-05 (unit AC 2.1–2.3) | D5 — 15 arquivos unit rodam com `bun test` (dist); JSON-RPC in-memory sem processo real |
| MCPL-06 (classificação AC 2.4) | D5 — E2E inertes → F22; publish-verification excluído; falhas de ambiente classificadas sem bloquear v1 |
| MCPL-07 (bin AC 3.1/3.2) | D5/Fluxos — handshake initialize/tools/list via stdio; `PI_TASKFLOW_<HOST>_BIN` preservado (código upstream intacto) |
| MCPL-08 (config AC 4.1/4.2) | D6 — templates F15 com path local (dev) / `@runecraft/taskflow-<host>` (publish); rejeição de spec sem prefixo `@runecraft/` |
