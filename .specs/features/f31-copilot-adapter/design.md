# F31 Design — Copilot/VSCode Adapter

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-031)
**Decisões aprovadas (usuário/briefing, travadas):** fail-closed + detect-only honesto (sem enforcement dentro de sessões Copilot — os guards são Pi-only, F24/F17) · zero deps novas · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v9 com notas datadas (F21 D9; v9 após F30 fechar v8 — one writer thread) · evidência via evalTest (F21) · requirement IDs COP-01..10 · agentes = pi, opencode, claude, codex, copilot/vscode (AD-022 decisão 8) · marcadores família html (F18) · TUI fora (AD-005)

## Contexto

O harness serve agentes não-Pi com `AgentAdapter` (F15) + matriz (F17) + coexistência (F18) + rules por coluna (F19). Copilot (VS Code) é o 5º agente do M8 (AD-022) e não tem presença — recon: grep em `src/adapters/` + `src/matrix.ts` → zero refs a copilot/vscode. O roadmap F31 trava o escopo (adapter F15 + injeção AGENTS.md/`.github/copilot-instructions.md` + MCP taskflow + fail-closed + detect-only + coluna F17).

**Evidência externa (docs/source lidos — citados):**
1. **Rules**: VS Code detecta `.github/copilot-instructions.md` na raiz do workspace (aplica a todos os requests); `AGENTS.md` na raiz também (always-on; `chat.useAgentsMdFile`); prioridade personal > repository (`.github/copilot-instructions.md` OU `AGENTS.md`) > organization, todos fornecidos ao modelo — [vscode-docs custom-instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) · [docs.github add-repository-instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions). Copilot coding agent suporta AGENTS.md desde 2025-08-28 ("alongside" copilot-instructions.md e .github/instructions/*.instructions.md) — [github.blog changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/).
2. **MCP**: config em `mcp.json` — workspace `.vscode/mcp.json` (versionável: "Include this file in source control") ou perfil do usuário; schema `{"servers": {<nome>: {type:"stdio", command, args?, env?, cwd?, envFile?}}, "inputs"?:[], "sandbox"?:{}}` — [vscode-docs mcp-configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) · [vscode-docs mcp-servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) · [docs.github extend-copilot-chat-with-mcp](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) ("create a `.vscode/mcp.json` file in the root of your repository"; "use only one location per server"). **Agent Host**: NÃO lê `.vscode/mcp.json` diretamente — o VS Code repassa os servers (exceto `${input:...}`); nativo do Agent Host = `.mcp.json` na raiz ou `~/.copilot/mcp-config.json` (mesmas duas fontes).
3. **gentle-ai (fonte lida)**: `docs/agents.md` — id `vscode-copilot`, config path `~/.copilot` + VS Code User profile, delegação "Full (runSubagent) — Parallel execution", SDD orchestrator sim; `docs/copilot.md` NÃO existe (404 verificado — honesto). Source `internal/components/persona/inject.go`: persona VSCode via `StrategyInstructionsFile` → `SystemPromptFile(homeDir)`; path LEGACY `~/.github/copilot-instructions.md` (HOME do usuário — instruções globais do VS Code) auto-removido por versões novas. `internal/reviewtransaction/risk.go`: `copilot-instructions.md` = convention file de projeto (junto de agents.md/CLAUDE.md/GEMINI.md). **Two-driver = sobreposição SEMÂNTICA user-level (gentle-ai) × repo-level (F31), não colisão de path.**
4. **Harness (lido na íntegra)**: `AgentAdapter` (types.ts), `matrix.ts` (AGENTS/MATRIX/columnComponents/firstUnsupported), `mcpConfig.ts` (renderMcpEntry switch + renderMcpConfig + resolveMcpBin env>dev>npx + guard anti-upstream + mcpEntryContentHash), `rules.ts` (RULES_SECTION html family), `rulesContent.ts` (renderRules: non-pi → NON_PI_RULES 13 linhas), `owners.ts` (gentle-ai state `~/.gentle-ai/state.json` + marcadores `<!-- gentle-ai:`), goldens `test/golden/mcp-{claude,opencode,codex}.golden` + `section-workflow-nonpi.golden` (F23 via test/eval/goldens.ts). `packages/taskflow/`: adapters claude|codex|opencode|grok — **sem mcp-copilot** (verificado).

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Id = `copilot`; aliases `vscode`, `vscode-copilot`, `github-copilot`** (COP-02): `AgentId` union ADITIVA += "copilot"; `ADAPTERS["copilot"]`, `SUPPORTED_AGENT_IDS` += copilot, `AGENT_ALIASES` += vscode/vscode-copilot/github-copilot → copilot (registry.ts); bin = `code` (VS Code CLI); display "Copilot (VS Code)". gentle-ai usa `vscode-copilot` — o alias cobre a nomenclatura deles sem adotar o id | AD-022 decisão 8 ("copilot/vscode"); convenção F15 (ids curtos; aliases em AGENT_ALIASES); compatibilidade com a doc do gentle-ai (id alternativo aceito) |
| D2 | **Rules repo-scoped em `.github/copilot-instructions.md`** (COP-03; QA-1a recomendado): `paths.rulesFile = <workspace>/.github/copilot-instructions.md`; seção `runecraft:workflow` família html (F18) via `upsertSection` (API F15 intacta); conteúdo = `renderRules("copilot")` — **já retorna NON_PI_RULES** (F19: um único texto non-Pi; zero mudança no rulesContent.ts; zero golden novo de conteúdo — section-workflow-nonpi.golden cobre); `preserveRules` (F19 D7) respeitado. Alternativa `AGENTS.md` = QA-1b/c (config flag — fora do v1 default) | Docs verificados: VS Code lê `.github/copilot-instructions.md` na raiz do workspace (repo-wide, todos os requests); específico do Copilot — não toca AGENTS.md que outras ferramentas leem (menos superfície de conflito); caminho repo-level = determinístico em workspace temp (padrão de teste da casa) |
| D3 | **MCP workspace em `.vscode/mcp.json`** (COP-04; QA-5a recomendado): `paths.mcpFile = <workspace>/.vscode/mcp.json`; `mcpKey = "taskflow"`; upsert via `upsertJsonKey(file, ["servers", "taskflow"], entry)` (jsonc.ts — mesmo mecanismo dos demais); entry = `renderMcpEntry("copilot", ctx)` → `{type: "stdio", command, args?, env?}` (shape família claude-code + `env` opcional — schema VS Code verificado); **sem `${input:...}`** (Agent Host repassa `.vscode/mcp.json` exceto inputs interativos — docs); "use only one location per server" → não configurar o mesmo server em workspace E user | Docs verificados (schema mcp.json + Agent Host forwarding); versionável/compartilhável (docs recomendam incluir no source control); alvo repo-level consistente com D2 |
| D4 | **Host MCP = reuso `@runecraft/taskflow-claude`** (COP-04; QA-2a recomendado): `resolveMcpBin("claude", rt)` → env `RUNECRAFT_TASKFLOW_CLAUDE_BIN` > dev fork (`node <abs>/dist/mcp/bin.js`) > npx `@runecraft/taskflow-claude@<pin>`; o bin é um servidor MCP **stdio** (packages/taskflow/claude/dist/mcp/bin.js — verificado) — o cliente MCP do VS Code é um cliente stdio genérico; guard anti-upstream passa (fork names preservados — F16 D4). **Validar no Execute**: confirmar que o server do host claude é client-agnostic sob o cliente VS Code (sem naming/convenção específica de Claude Code que quebre tools); alternativa documentada = host grok. NUNCA `@runecraft/taskflow-copilot` (não existe — fabricação) | Zero package/deps novos (constraint do briefing); F16 re-vendorou a camada MCP exatamente para servir hosts múltiplos; mcp-core/hosts são a camada genérica (evidência: packages/taskflow/hosts + mcp-core) |
| D5 | **Render MCP + golden** (COP-04/09): `renderMcpEntry("copilot", input)` = `{type:"stdio", command: <cmd>, args?, env?}`; `renderMcpConfig("copilot", input)` = **arquivo completo** `{"servers": {"taskflow": <entry>}}\n` (2-space indent); golden novo `test/golden/mcp-copilot.golden` = bytes do arquivo completo. **Desvio documentado do F23 D4**: claude/opencode goldenizam o entry (aninhado 1 nível — serialização standalone idêntica); o entry copilot fica aninhado 2 níveis (`servers.taskflow`) → a serialização standalone NÃO é byte-idêntica à do arquivo → golden do arquivo completo cobre o artefato inteiro injetado. **Validar no Execute**: bytes exatos do upsert em arquivo novo vs existente (indent jsonc) | F23 D4 (fonte única renderMcpConfig = golden); honestidade do drift (wrapper `servers` também detectado); schema VS Code (top-level `servers`) verificado |
| D6 | **Detecção honesta** (COP-05; QA-3a recomendado): `detect(rt)` = (1) `resolveBinaryOnPath("code"|"code-insiders")` (F15 shell.ts) OU (2) glob de dirs de extensão `~/.vscode*/extensions/github.copilot*` / `github.copilot-chat*` (homeDir via `env.HOME` — lição F15: nunca `os.homedir()`; cobre `~/.vscode`, `~/.vscode-insiders`, `~/.vscode-server`); `installed: true` com `binPath` quando bin, `reasons: []`; ausente → `installed: false` + reasons com hint display-only (instalar VS Code + extensão Copilot) — **nunca executado** (F15 ADPT-02/03); configHome = `<workspace>/.vscode` (informativo, nunca bloqueante) | CLI `code` nem sempre no PATH (shell command opcional no VS Code) → extensão é o sinal real do Copilot; padrão gentle-ai (detecção por binário/extensão); fail-closed no install quando ausente |
| D7 | **Workspace root = cwd** (QA-4a recomendado): alvos repo-level resolvidos a partir de `process.cwd()` (`<cwd>/.github/copilot-instructions.md`, `<cwd>/.vscode/mcp.json`); harness roda na raiz do repo (precedente: F29 memória usa gitRoot para `.runecraft/memory/`; F20 usa git rev-parse — a validar no Execute se `gitRoot` deve substituir cwd quando o comando roda de subdir; recomendação v1: cwd, determinístico e simples) | Alvos repo-scoped exigem uma raiz; cwd = contrato simples dos comandos (install/status/sync rodam no repo); testes usam workspace temp como cwd (padrão F17 AD-017) |
| D8 | **Matriz aditiva** (COP-06): `AGENTS.copilot = {binary: "code", display: "Copilot (VS Code)", note: "repo-scoped (workspace); sem enforcement — guards são Pi-only (F24)"}`; `MATRIX.copilot` = `taskflow: {kind:"mcp", entry:"taskflow"}` + `rules: {kind:"rules", file: ".github/copilot-instructions.md", section: RULES_SECTION}` + 4 células `unsupported` (subagents/goal-loop-audit/pr-review/guards — mesmo motivo "é extensão Pi; use --agent pi"; guards com nota F24 sem enforcement); `MatrixAgentId = "pi" | AgentId` cobre automaticamente; `columnComponents`/`firstUnsupported` intactos (consumidores genéricos) | F17 D1 (matriz declarativa = fonte única); ADITIVA (nenhuma célula existente muda); honestidade fail-closed (F24: sem enforcement em agentes não-Pi — detect-only) |
| D9 | **Wiring completo** (COP-07): `install --agent copilot` (registry resolve; par agente×componente via matriz — misto com `--component` Pi-only recusa via firstUnsupported; backup F13 + lock F18; dry-run sem lock; gate MXST-04 com owners warn); `uninstall --agent copilot` (content-based D7: entry/section removida só com fingerprint registrado; preserva edição; arquivo vazio removido; marcador não registrado preservado — F18); `doctor` check novo (detecção informativa + configs parseáveis + estado gerenciado — numeração a validar no Execute, pós-F25 check 19); `status` coluna copilot (3 fontes: configs reais × state × matriz; células ok/ausente/não gerenciado/colisão/órfã/—/não suportado; `--json.agents[].components[]` com reason); `sync` three-way por conteúdo (F19 D7: re-injetada/atualizada vN→vM/preservada (editada)/already in sync; órfãos reportados) | Padrão F15/F17/F19 (wiring existente é genérico por adapter/matriz — adicionar o adapter + coluna faz o resto fluir); sem retrofit |
| D10 | **Conflitos/two-driver** (COP-08): `owners.ts` scan estendido para incluir os alvos copilot (`.github/copilot-instructions.md`, `.vscode/mcp.json` — aditivo à lista de managed rules files); gentle-ai detectado por (a) state `~/.gentle-ai/state.json` (já existe) e (b) marcadores `<!-- gentle-ai:` estritos (F18); sobreposição SEMÂNTICA user-level (gentle-ai `~/.copilot/...`) × repo-level (F31) documentada no check/status; conteúdo do usuário em `.github/copilot-instructions.md` fora do marcador → preservado (upsert); entry MCP não registrada → conflict (D5 F15); seção editada → sync preserva (F19); **nunca auto-cura** | F18 (donos stateless) + SETM-05/06 (conteúdo preservado + reportado); honestidade: não removemos/reescrevemos nada alheio |
| D11 | **Evals EVAL-049..056 + matriz v9** (COP-09): suite `test/eval/suites/copilot.ts` — EVAL-049 render/goldens (mcp-copilot.golden byte-a-byte; `renderRules("copilot")` === NON_PI_RULES; ausência `goal|loop|subagent|pr-review|auditor`), EVAL-050 detect (fixture: fake `code` bin + fake extensions dir no PATH mínimo; ausente → not installed + reasons), EVAL-051 inject round-trip (workspace temp; 2 runs byte-idênticos; BOM/CRLF; conteúdo do usuário preservado), EVAL-052 remove round-trip (fingerprint; edited/preserved; arquivo vazio deletado; marcadores não registrados preservados), EVAL-053 fail-closed (install sem detecção → recusa + hint, zero writes; misto --component Pi-only → firstUnsupported), EVAL-054 matrix/status (células copilot; status 3 fontes; JSON components; consistência matriz↔suites), EVAL-055 two-driver (gentle-ai state/markers → owners warn + gate MXST-04; sync three-way: re-inject/update/preserve), EVAL-056 sync/state (targets contentHash; sync idempotente; uninstall preservado; 2 runs idênticos); delta vs EVAL-017..048 documentado em cada case; EVAL-MATRIX **v9 aditiva** (bump 8→9 após F30 fechar v8 — one writer thread); `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest) | Política aditiva (F21 D9); determinismo offline/$0 (fixture, PATH mínimo, workspace temp — AD-017/AD-021); goldens = ratchet F23 |
| D12 | **Fronteiras**: F15 dono do contrato `AgentAdapter` (F31 implementa o contrato — zero mudança em types.ts além da union ADITIVA do AgentId; claude/opencode/codex intocados); F17 dono da matriz (coluna aditiva; nada existente muda); F18 dono de sections/owners (reuso read-only — engine intacto; owners ganha alvos na lista de scan, aditivo); F19 dono de renderRules (reuso read-only — rulesContent.ts intocado; copilot recebe NON_PI_RULES); F23 dono dos goldens (novo baseline mcp-copilot.golden + ratchet); F21 dono da fixture/evals; F32 independente (papéis não dependem do copilot); zero deps novas / sem package novo (D4) | Contratos cross-feature explícitos (padrão AD-027/AD-028); sem retrofit em features fechadas |

## Arquitetura — módulos

```
packages/harness/
├── src/adapters/
│   ├── types.ts              # AgentId union ADITIVA += "copilot" (D1) — contrato intacto
│   ├── registry.ts           # ADAPTERS/SUPPORTED_AGENT_IDS/AGENT_ALIASES += copilot (D1)
│   ├── mcpConfig.ts          # renderMcpEntry("copilot") case + renderMcpConfig("copilot") (D5)
│   ├── copilot.ts            # NOVO — copilotAdapter (D1/D2/D3/D4/D6/D7):
│   │                         #   detect: bin code|code-insiders OU extensions dir github.copilot* (D6)
│   │                         #   paths: rulesFile <cwd>/.github/copilot-instructions.md · mcpFile <cwd>/.vscode/mcp.json · mcpKey "taskflow" (D2/D3/D7)
│   │                         #   inject: upsertSection(rules) + upsertJsonKey(["servers","taskflow"]) — preserveRules/conflicts (D2/D3/D10)
│   │                         #   remove: content-based D7 (fingerprint = mcpEntryContentHash) + preserve/edited/deleted (D9)
│   │                         #   readMcpFingerprint/readMcpEntry: leitura de servers.taskflow (mesma função no registro e remoção — lição F15)
│   ├── owners.ts             # scan de alvos copilot aditivo (D10) — engine intacto
│   └── rulesContent.ts       # INTOCADO — renderRules("copilot") já retorna NON_PI_RULES (D2)
├── src/matrix.ts             # AGENTS.copilot + MATRIX.copilot (D8) — células mcp/rules + 4 unsupported
├── src/commands/doctor.ts    # check novo (detecção copilot + parse + estado) — numeração a validar (D9)
├── src/commands/status.ts    # coluna copilot (3 fontes) + --json agents[].components (D9)
├── src/commands/sync.ts      # three-way por conteúdo cobre os alvos copilot (D9)
├── src/commands/install.ts / uninstall.ts  # --agent copilot via registry/matriz (D9)
├── docs/ROUTING.md           # §nova: Copilot (VS Code) — alvos repo-scoped, two-driver gentle-ai (D10/COP-10)
└── test/
    ├── golden/mcp-copilot.golden          # NOVO — arquivo mcp.json completo (D5)
    ├── copilot.test.ts                    # unit detect/inject/remove/fail-closed (workspace temp; PATH mínimo)
    └── eval/suites/copilot.ts             # cases EVAL-049..056 (D11)
```

## Fluxos

### F1 — Install --agent copilot (COP-01/02/06/07)

```
1. registry.resolveAgentId("copilot"|"vscode"|...) → copilot (D1)
2. matrix: par agente×componente (--component Pi-only com copilot → firstUnsupported recusa — D8)
3. detect(rt): bin code|code-insiders OU extensions dir github.copilot* → ausente? recusa fail-closed display-only com hint (D6); presente → segue
4. backup F13 + lock F18 (dry-run sem lock)
5. owners warn (gentle-ai user-level/markers) → TTY lista antes do prompt; sem TTY sem --yes → aborta (MXST-04 — D10)
6. inject: rules (upsertSection runecraft:workflow em <cwd>/.github/copilot-instructions.md — renderRules("copilot")) + MCP (upsertJsonKey servers.taskflow em <cwd>/.vscode/mcp.json — renderMcpEntry("copilot")) (D2/D3)
7. targets registrados no state agents.copilot.targets com contentHash (F17) — fingerprint do MCP lido do ARQUIVO (lição F15)
8. reporte written/conflicts; 2ª execução → byte-idêntico (idempotência)
```

### F2 — Sync three-way (COP-07/08)

```
por target (rules/mcp): conteúdo atual vs render vs registrado (F19 D7):
  ausente → re-inject idempotente · igual ao render ≠ registrado → registra · difere do render E do registrado → "preservada (editada)" (nunca auto-cura)
  entry MCP não registrada → conflict (D5 F15) · órfãos reportados, nunca removidos (F18)
```

### F3 — Uninstall --agent copilot (COP-07)

```
remove: section (removeSection html) e entry servers.taskflow SOMENTE quando fingerprint atual == registrado (D7)
  editado → preserved + edited reportado (SETM-05/06) · arquivo vazio após remoção → deletado (D6)
  marcadores runecraft: sem registro no state → preservados + reportados (F18)
```

### F4 — Status/doctor (COP-06/07)

```
status: coluna copilot — células das 3 fontes (configs reais × state × matriz); guards = "não suportado (sem enforcement — F24)"; --json agents[].components[] com reason
doctor: check novo — detecção (bin/extensão) informativa + configs parseáveis (UTF-8; jsonc) + estado gerenciado (numeração pós-F25 a validar)
```

### F5 — Evals (COP-09)

```
bun test test/eval (preloads F21..F30) → EVAL-049..056 offline/$0 (fixture; PATH mínimo com fake code; workspace temp);
goldens: mcp-copilot.golden (F23) · consistência matriz↔suites v9 · MIN_EVIDENCE_FILES bump (AD-025) · 2 runs idênticos
```

## Tabela de mecanismos (o que existe → o que F31 constrói)

| Mecanismo | Existe (harness) — evidência | F31 constrói |
| --- | --- | --- |
| AgentAdapter contract | types.ts (claude/opencode/codex) ✓ | copilotAdapter (D1) — union aditiva |
| Registry/aliases | registry.ts ADAPTERS/AGENT_ALIASES ✓ | copilot + aliases (D1) |
| Seções html | sections.ts + rules.ts (RULES_SECTION) ✓ | reuso (D2) |
| renderRules non-Pi | rulesContent.ts NON_PI_RULES (13 linhas, golden) ✓ | reuso read-only — renderRules("copilot") (D2) |
| renderMcpEntry/Config | mcpConfig.ts (claude/opencode/codex) + goldens ✓ | case "copilot" + mcp-copilot.golden (D5) |
| resolveMcpBin + guard | mcpConfig.ts (env > dev > npx; anti-upstream) ✓ | reuso com host "claude" (D4) |
| Matriz | matrix.ts AGENTS/MATRIX/firstUnsupported ✓ | coluna copilot aditiva (D8) |
| Owners/two-driver | owners.ts (gentle-ai state + markers) ✓ | scan de alvos copilot (D10) |
| Wiring install/uninstall/doctor/status/sync | commands/ (F11/F12/F17/F19) ✓ | --agent copilot + check + coluna + three-way (D9) |
| Evals + goldens | F21/F23/F26 + EVAL-MATRIX ✓ | EVAL-049..056 + v9 (D11) |

## EVAL-MATRIX — entradas aditivas v9 (política F21 D9)

| ID | Fluxo | Script esperado | Notas |
| --- | --- | --- | --- |
| EVAL-049 | render/goldens | `renderMcpConfig("copilot")` == `mcp-copilot.golden` (byte-a-byte, F23); `renderRules("copilot")` === NON_PI_RULES; ausência `goal|loop|subagent|pr-review|auditor` | D5; reuso F19 |
| EVAL-050 | detect | fixture: fake `code` bin no PATH mínimo + fake extensions dir `~/.vscode/extensions/github.copilot-*` → detected; ausente → not installed + reasons + hint | D6; AD-017 PATH mínimo |
| EVAL-051 | inject round-trip | workspace temp: seção em `.github/copilot-instructions.md` + `servers.taskflow` em `.vscode/mcp.json`; 2 runs byte-idênticos; conteúdo do usuário fora do marcador preservado; BOM/CRLF | D2/D3 |
| EVAL-052 | remove round-trip | fingerprint == registrado → remove; editado → preserved+edited; arquivo vazio → deletado; marcador não registrado → preservado | D9; D7 F15 |
| EVAL-053 | fail-closed | install sem detecção → recusa + hint, zero writes; copilot + `--component` Pi-only → firstUnsupported recusa; dry-run sem lock | D8/D9 |
| EVAL-054 | matrix/status | coluna copilot (células mcp/rules + 4 unsupported); status 3 fontes; `--json.agents[].components[]` com reason; consistência matriz↔suites v9 | D8 |
| EVAL-055 | two-driver | gentle-ai state/markers → owners warn + gate MXST-04 (sem TTY sem --yes aborta); sync three-way: re-inject/update/preserve | D10 |
| EVAL-056 | sync/state | targets registrados com contentHash; sync idempotente; uninstall preservado; 2 runs idênticos | D9; F21 D10 |

Nota datada v9: adapter copilot/vscode (5º agente M8) — detecção, injeção repo-scoped (rules + MCP), fail-closed, detect-only honesto, coluna matriz F17, two-driver gentle-ai. Bump de MATRIX_VERSION 8→9 depende do F30 fechar a v8 (one writer thread). tool-use/routing (F32) segue SEM entradas (política aditiva — nada sai sem AD).

## Integração CI

- **Roda com**: mesma lane F21..F30 — `bun test test/eval` (offline/$0: loopback, apiKey literal, workspace temp, PATH mínimo com fake `code`, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM
- **Evidência**: evalTest() nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (golden mcp-copilot + identidade estável — asserts excluem payload volátil)
- **Consistência**: matrix-consistency v9 varre `test/eval/suites` incluindo copilot.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Server do host taskflow-claude com comportamento específico de Claude Code sob o cliente MCP do VS Code** | QA-2 (reuso recomendado); "validar no Execute" — handshake stdio real do bin contra cliente genérico; alternativa host grok; NUNCA inventar package |
| **Agent Host não ler `.vscode/mcp.json` diretamente** (docs: VS Code repassa, exceto `${input:...}`) | Entry SEM input vars (D3); "validar no Execute" com VS Code real (env-gated, fora de CI); alternativa documentada `~/.copilot/mcp-config.json` (QA-5b) |
| **CLI `code` ausente do PATH (shell command não instalado)** | Detecção por extensions dir (D6); fail-closed com hint display-only; detect-only informativo |
| **Conflito semântico com persona user-level do gentle-ai (VS Code fornece os dois conjuntos — prioridade personal > repo)** | owners warn + gate MXST-04 (D10); nunca remover/reescrever arquivos alheios; docs ROUTING (two-driver) |
| **Golden do mcp.json divergir dos bytes reais do upsert (indent/nesting 2 níveis)** | renderMcpConfig("copilot") = fonte única do arquivo completo (D5); "validar no Execute" os bytes em arquivo novo vs existente; ratchet F23 |
| **`.github/copilot-instructions.md` do usuário (conteúdo próprio fora do marcador)** | Upsert por marcador nunca clobber; sync three-way preserva edição (F19 D7); uninstall content-based (D7) |
| **Matriz v8 ainda aberta (F30 em execução)** | Bump v9 após F30 fechar v8 (one writer thread — nota datada); delta vs EVAL-039..048 documentado |
| **Detecção falsa positiva (VS Code sem Copilot)** | extensions dir `github.copilot*` é o sinal do Copilot (não só `code`); note/status informa; detect-only honesto |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| COP-01 | P1: Adapter copilot | D1/D2/D3/D4/D6/D7 + src/adapters/copilot.ts + EVAL-050/051/052 |
| COP-02 | P1: Registry/aliases | D1 + registry.ts + EVAL-053 |
| COP-03 | P1: Rules repo-scoped | D2 + copilot.ts (rules) + EVAL-051/055 |
| COP-04 | P1: MCP `.vscode/mcp.json` | D3/D4/D5 + copilot.ts (mcp) + mcpConfig.ts + EVAL-049/051 |
| COP-05 | P1: Detecção | D6 + copilot.ts (detect) + EVAL-050/053 |
| COP-06 | P1: Coluna matriz | D8 + matrix.ts + EVAL-054 |
| COP-07 | P1: Wiring | D9 + commands/{install,uninstall,doctor,status,sync} + EVAL-053/056 |
| COP-08 | P1: Conflitos/two-driver | D10 + owners.ts + EVAL-055 |
| COP-09 | P2: Evals | D11 + test/eval/suites/copilot.ts + mcp-copilot.golden + EVAL-MATRIX v9 |
| COP-10 | P2: Docs | D12 + docs/ROUTING.md §nova + STATE.md |

**Cobertura:** 10/10 mapeados. Edges da spec: sem detecção → fail-closed (D6/D9) · arquivo do usuário → preservado (D2/D10) · entry não registrada → conflict (D3/D10) · seção editada → sync preserva (D9) · fingerprint ≠ registrado → remove preserva (D9) · não-UTF8 → fail-closed reportado (F18) · gentle-ai → warn + gate (D10) · duplicação EVAL → delta no case (D11) · 2 runs → idênticos (D11).

**Pontos a validar no Execute** (consolidado): handshake stdio real do bin taskflow-claude sob o cliente MCP do VS Code (client-agnostic? — QA-2); comportamento do Agent Host com `.vscode/mcp.json` (forwarding sem input vars — QA-5); bytes exatos do mcp.json em arquivo novo vs existente (indent jsonc — D5); numeração do check novo do doctor (pós-F25 check 19); workspace root cwd vs gitRoot quando comando roda de subdir (D7); path atual exato da persona copilot do gentle-ai (`SystemPromptFile(homeDir)` — `~/.copilot/...` ou profile; legado `~/.github/copilot-instructions.md` na HOME) para o texto do owners/status; qualquer parsing peculiar do Copilot com comentários HTML em markdown (improvável — D2).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Alvo das regras** (D2): (a) **recomendado — `.github/copilot-instructions.md`** (repo-wide do Copilot, específico, docs verificado) · (b) `AGENTS.md` na raiz (padrão agentsmd — mais superfície de conflito) · (c) ambos com flag
2. **QA-2 — Host MCP** (D4): (a) **recomendado — reuso `@runecraft/taskflow-claude`** (stdio; zero package novo) · (b) reuso `@runecraft/taskflow-grok` · (c) package novo `taskflow-copilot` (FORA do escopo)
3. **QA-3 — Detecção** (D6): (a) **recomendado — bin `code`/`code-insiders` OU extensions dir `github.copilot*`** · (b) só bin `code` · (c) presença de config (`.vscode/` no repo)
4. **QA-4 — Raiz do workspace** (D7): (a) **recomendado — cwd** · (b) `git rev-parse --show-toplevel`
5. **QA-5 — Escopo do MCP** (D3): (a) **recomendado — `.vscode/mcp.json` (workspace)** · (b) `~/.copilot/mcp-config.json` (user) · (c) ambos (contraindicado pelos docs)
