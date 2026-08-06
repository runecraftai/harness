# F16 — Camada MCP do taskflow (re-vendor) Specification

**Scope:** Large (6 packages; vendoring + build order + rename)
**Prereq:** F1 ✓ (vendor infra)
**Grupo:** MULA (F15–F18) — componente cross-agent que dá DAG/FlowIR aos não-Pi (AD-009; reativa deferral do AD-007)

## Problem Statement

F15 precisa de DAG/FlowIR para Claude Code, OpenCode e Codex. A camada MCP do upstream heggria/taskflow (excluída no AD-007) é exatamente esse componente cross-agent. Pesquisa verificada na tag v0.2.6 (2026-08-05): 6 packages — `taskflow-mcp-core` (servidor MCP stdio com JSON-RPC hand-rolled, **zero deps de runtime**, só taskflow-core), `taskflow-hosts` (runners que spawnam CLIs dos hosts com env override `PI_TASKFLOW_<HOST>_BIN`), e 4 adapters por host (`codex|claude|opencode|grok-taskflow`) com bins `*-taskflow-mcp` e configs `plugin/`.

## Goals

- [ ] Vendorar os 6 packages espelhando a estrutura upstream: `packages/taskflow/{mcp-core,hosts,codex,claude,opencode,grok}` (AD-006 sync file-to-file)
- [ ] `workspace:*` → `@runecraft/*`; build order core → mcp-core → hosts → dsl → pi → adapters
- [ ] Unit tests do upstream passando (node:test nativo, sem CLIs reais); E2E com CLIs reais ficam para o F22 (EVAL)
- [ ] Configs de host apontando para o nosso fork (path local no dev; `@runecraft/*` publicado no F9), nunca o `npx` pin do upstream
- [ ] Bins `*-taskflow-mcp` funcionais com cliente MCP stdio

## Out of Scope

| Feature | Reason |
| --- | --- |
| E2E com CLIs reais autenticados | F22 (EVAL); exigem codex/claude/opencode/grok instalados e autenticados |
| Expor grok na matriz de agentes | Vendorar sim (menos diff de sync); expor fica F17/detect-only |
| `@modelcontextprotocol/sdk` | Upstream usa JSON-RPC próprio (verificado) — não introduzir |
| Manutenção do website/monorepo upstream | Só os 6 packages + scripts de build |

## Gray area (resolver no Design)

**Configs de host no dev**: `plugin/.mcp.json`/`opencode.json` do upstream pinam `npx -y -p <pkg>@0.2.6` do registry público — no fork, apontar para `node <path>/dist/mcp/bin.js` local (comentários dos bins já documentam isso). Decidir no design: (a) configs locais versionados no repo com path relativo, ou (b) templates que o CLI (F15) renderiza com o path resolvido em runtime. **Recomendado: (b)** — o F15 injeta config por host com o path real (local no dev, registry no publish).

**Nomes dos packages**: `@runecraft/taskflow-mcp-core`, `@runecraft/taskflow-hosts`, `@runecraft/taskflow-{codex,claude,opencode,grok}` (espelha upstream). Validar colisão com `@runecraft/taskflow` (adapter Pi) — nenhuma, nomes distintos.

**Build do upstream**: `build` chama `scripts/copy-readme.mjs` (path relativo ao monorepo) — adaptar como no F3 (scripts simplificados).

## User Stories

### P1: Vendoring + rename + build ⭐ MVP

**User Story**: Como mantenedor, quero os 6 packages vendorados e buildando no monorepo, para a camada MCP ser parte do harness como os demais forks.

**Why P1**: Sem isso, F15 não tem o que injetar.

**Acceptance Criteria**:

1. WHEN o vendor script roda (padrão F1/F10) THEN os 6 packages SHALL existir em `packages/taskflow/{mcp-core,hosts,codex,claude,opencode,grok}` com proveniência no vendor.manifest.json
2. WHEN o rename roda THEN imports `taskflow-core`, `taskflow-hosts`, `taskflow-mcp-core` (workspace:*) SHALL apontar para `@runecraft/*` local
3. WHEN `bun run build` roda THEN a ordem core → mcp-core → hosts → dsl → pi → adapters SHALL compilar sem erro
4. WHEN os bins são inspecionados THEN cada adapter SHALL expor `bin: {"<host>-taskflow-mcp": "./dist/mcp/bin.js"}`

**Independent Test**: `bun run build` verde no monorepo; `ls dist/mcp/bin.js` por adapter.

### P1: Unit tests do upstream ⭐ MVP

**User Story**: Como mantenedor, quero os testes unitários do upstream passando no fork, para saber que o rename não quebrou nada.

**Why P1**: É o mesmo critério dos forks F2–F5 (testes verdes = fork são).

**Acceptance Criteria**:

1. WHEN os testes rodam (node:test nativo) THEN `taskflow-mcp-core/test/*` (jsonrpc, background-runs, trace-limit) SHALL passar
2. WHEN os testes rodam THEN `taskflow-hosts/test/*` (args+runner por host) SHALL passar
3. WHEN os testes rodam THEN cada adapter `test/mcp-server.test.ts` (JSON-RPC in-memory via PassThrough) SHALL passar sem processo real
4. WHEN um teste falha por ambiente (CLI real ausente) THEN SHALL ser classificado e movido para o F22, não bloqueando o v1

**Independent Test**: `bun test` nos 6 packages → contagem pass/fail por package.

### P2: Bin MCP funcional

**User Story**: Como dev usuário, quero um servidor MCP do taskflow rodando, para o meu agente usar as tools `taskflow_*`.

**Why P2**: Prova de que o caminho dev → produto fecha (F15 injeta a config apontando para ele).

**Acceptance Criteria**:

1. WHEN um cliente MCP stdio conversa com `dist/mcp/bin.js` THEN tools `taskflow_run`, `taskflow_list`, `taskflow_verify`, `taskflow_compile` SHALL responder (handshake initialize + tools/list + tools/call básico)
2. WHEN `PI_TASKFLOW_<HOST>_BIN` é setado THEN o runner SHALL usar o binário indicado (comportamento upstream preservado)

**Independent Test**: script node de 30 linhas que spawna o bin e faz initialize/tools.list.

### P2: Config de host injetável pelo CLI

**User Story**: Como mantenedor, quero que o F15 injete a config certa por host, para o agente achar o MCP sem edição manual.

**Why P2**: É a ponte F16 → F15 (e o ponto onde o fork difere do upstream: path nosso, não npx pin).

**Acceptance Criteria**:

1. WHEN o F15 monta a config para claude THEN o `.mcp.json` SHALL apontar para o bin do fork (path local no dev / `@runecraft/taskflow-claude` no publish)
2. WHEN a config referencia o registry público upstream THEN ela SHALL ser rejeitada pelo nosso CLI (nunca injetar dependency externa não gerenciada)

**Independent Test**: fixture de config gerada pelo F15 → verificação dos comandos/paths.

## Edge Cases

- WHEN um host CLI não está instalado THEN o bin do MCP ainda inicia (o runner falha só na execução) — iniciar é independente de executar
- WHEN o tsconfig do monorepo não tem `customConditions: ["development"]` THEN os imports `development` condition (src/*.ts) falham — adicionar ao tsconfig base (como F3 fez)
- WHEN `node_modules/@runecraft/taskflow` (adapter Pi) e `@runecraft/taskflow-claude` coexistem THEN não há colisão (nomes distintos)
- WHEN o E2E do upstream referencia o registry (`npx -y -p <host>-taskflow@0.2.6`) THEN o teste SHALL ser excluído/skippado no fork (quebraria contra o registry público)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MCPL-01 | P1: Vendoring (AC 1.1) | Design | Pending |
| MCPL-02 | P1: Vendoring (AC 1.2 rename) | Design | Pending |
| MCPL-03 | P1: Vendoring (AC 1.3 build order) | Design | Pending |
| MCPL-04 | P1: Vendoring (AC 1.4 bins) | Design | Pending |
| MCPL-05 | P1: Unit tests (AC 2.1/2.2/2.3) | Design | Pending |
| MCPL-06 | P1: Unit tests (AC 2.4 classificação) | Design | Pending |
| MCPL-07 | P2: Bin MCP (AC 3.1/3.2) | Design | Pending |
| MCPL-08 | P2: Config injetável (AC 4.1/4.2) | Design | Pending |

**Coverage:** 8 total, 0 mapeados, 8 unmapped

## Success Criteria

- [ ] 6 packages vendorados com rename e build verde (ordem core → adapters)
- [ ] Unit tests do upstream passando (E2E real adiado para F22)
- [ ] Bin `*-taskflow-mcp` responde a initialize/tools.list via stdio
