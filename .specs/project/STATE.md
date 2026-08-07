# State

**Last Updated:** 2026-08-07
**Current Work:** **M5 EM ANDAMENTO — F21 COMPLETE** (suite determinística de evals: 2 camadas — CLI contra fixtures + fluxos SDLC com fixture OpenAI-wire fakeando só a escolha de tool call; EVAL-MATRIX aditivo; evidência JSON para o F23; **348 testes no harness**). Próximo: F22 (cenários E2E com modelos reais — **barreira: exige aprovação explícita do usuário**, custo de tokens). M1/M2/M3/M4 completos. Roadmap reestruturado (M2–M6) — ver AD-008..011; decisões de execução do M2 em AD-016; F17 em AD-017; F18 em AD-018; F19 em AD-019; F20 em AD-020; F21 em AD-021.
**Specs criadas:** F2 (SUBA, Medium), F3 (TFLW, Large — 3 pkgs + workspace dep), F4 (GLLA, Medium), F5 (PREV, Medium — dispatch a mapear), F6 (UMBR, Large — **design.md obrigatório**: mecanismo de agregação de extensões Pi, hipóteses H1/H2/H3), F7 (COEX, Medium — two-driver é o risco central), F8 (DOCS), F9 (PUBL), F10 (SYNC — three-way merge sobre vendor.json).

### Handoff

- **Done (M1):** F1 — toolchain. F2 — @runecraft/subagents (1463/1464; SUBA-02: install.mjs removido; rename completo). F3 — @runecraft/taskflow (core+pi+dsl). F4 — @runecraft/goal-loop-audit (604/607). F5 — @runecraft/pr-review: **fix REAL do fork aplicado 2026-08-06** (verify-package-contents.mjs + package-contents.node.mjs — hardcodes pi-pr-review/10ego eliminados; test:tooling 20/20; suite 243/245 = baseline, 2 falhas pré-existentes do upstream em pi-tui/matchesKey).
- **Done (M2):** F6 — Umbrella: meta-package H1 (bundledDeps + manifest pi via node_modules/), prepack hermético, validado por install local + tarball real + sessão Pi headless; cleric APPROVE + 3 fixes. F7 — Coexistência: **COEX-01..06 PASSA** (2026-08-06, scenarios.md versionado; bugs reais do taskflow registrados: BUG-1 import dinâmico não renomeado, BUG-2 dist/agents/ não empacotado). F11 — CLI: install/presets/--component/--dry-run/--json/--scope, dispatch(argv,ctx) com RUNECRAFT_PI_BIN (contrato F21 D1); cleric APPROVE + 2 fixes. F12 — Lifecycle: doctor (6 checks read-only — fix bloqueante loadStateReadonly), status (tabela cruzada + /harness real), sync (idempotente), uninstall (só gerenciado); cleric APPROVE. F13 — Estado+backups: schema v1 aditivo (agents do F17 preservados), dedupe, prune 5+pins, statvfs fail-safe, restore fail-closed; cleric APPROVE. F14 — Settings merge: two-pass SETM-04, blockingSegment (nunca clobber), prefixo por componente; experimento de defaults validado contra source (subagents/taskflow com defaults v1; pr-review/glla sem defaults); cleric REQUEST_CHANGES → 3 fixes → **168 testes verdes**.
- **Done (M3):** F16 — Re-vendor camada MCP: 6 packages (`packages/taskflow/{mcp-core,hosts,codex,claude,opencode,grok}`) @ v0.2.6 (SHA 3c2dfdb); rename completo (imports estáticos + import.meta.resolve + import() dinâmicos); tsconfig base com customConditions; build turbo 9/9; **184 testes unit** (mcp-core 30, hosts 115, codex 31, claude/opencode/grok 4) + harness 168 sem regressão; handshake MCP stdio OK nos 4 bins; cleric APPROVE (commit 6823ec5). **Findings MCPL-06**: bun test não roda adapters (serveStdio + input.end → teardown aborta antes do handler async); modo `--conditions=development` (src) diverge do dist (built-in agents mudam cache hash → teste de resume falha); decisão: `node --experimental-strip-types --test 'test/**/*.test.ts'` (modo dist, E2E .mts inertes). Pins npx nos plugin/ = referência upstream (D6); F15 nunca os injeta.
- **Done (M3):** F15 — Adapters v1 (Claude Code/OpenCode/Codex): AgentAdapter (detect/inject/remove/readMcpFingerprint) + registry com detect-only (grok/cursor); rules.ts (seção `runecraft:workflow` BOM/CRLF-aware, upsert idempotente, remoção junction-scoped); mcpConfig.ts (resolveMcpBin env > dev fork > npx @runecraft pin; guard anti-upstream rejeita spec não-@runecraft); toml.ts (upsert/remoção de `[mcp_servers.X]` sem lib, bloco termina em linha não-key=value); **install --agent** (fail-closed display-only com comandos oficiais validados, dry-run por agente, backup único com alvos, coluna F17 — `--component` fora → recusa com motivo, state `agents.<id>.targets` com fingerprint real); **uninstall --agent** (content-based D6/D7: entry estrangeira nunca registrada/removida, edição do usuário preservada+reportada, arquivo vazio removido, `--agent pi` = F12); doctor check 7 / status agents / sync re-inject (formal no F17); **203 testes no harness** (35 novos); cleric APPROVE após **3 rodadas de review** (commits 94291cf, ca7aede, c7aab20, f6e46fb). **Lições**: homes dos agentes resolvem `env.HOME` nunca `os.homedir()` (fixture quase tocou ~/.claude real); `command -v` precisa `sh -c`; guard anti-upstream não pode barrar nomes de bin preservados (D4); fingerprint do state deve ser lido do arquivo (mesma função no registro e remoção); entry registrada = nossa → inject reescreve (D5-b), fingerprint é gate do REMOVE.
- **Done (M3):** F17 — Matriz de componentes por agente: **`src/matrix.ts` declarativa** (D1: AGENTS + MATRIX agente×componente; células pi-packages/mcp/rules/native/unsupported com motivo; Pi = coluna completa; não-Pi = taskflow-MCP + regras + 3 células fail-closed "é extensão Pi; use --agent pi"); **install fail-closed por par via matriz** (MATR-03 — substitui a lista hardcoded do F15; misto pi+claude-code com --component Pi-only recusa); **doctor checks 7–13** (D3: detecção informativa, gerenciado warn, configs injetadas fail+remedy sync, colisão MCP upstream warn, config parseável fail, detect-only informativo, órfãs de matriz warn; numeração provisória — consolidação 7–15 no F18); **status 3 fontes** (configs reais × state × coluna da matriz; células ok/ausente/não gerenciado/colisão/órfã/—/não suportado; `--json.agents[].components[]` com reason; Pi entra no JSON com os 4 grupos + rules native); **sync por CONTEÚDO** (D6: seção/entry ausente → re-inject idempotente mesmo com arquivo existente; coluna nova aplicada; órfãos reportados nunca removidos; targets pós-inject registrados no state); **helpers novos** (hasSection read-only; isUpstreamCommand/isUpstreamMcpEntry JSON+TOML; readMcpEntry no contrato dos 3 adapters); **226 testes no harness** (23 novos no f17-matrix, 16 doctor determinísticos com PATH mínimo); TSC limpo; doctor/status reais sem crash (ambiente com claude/opencode/codex instalados). **Review cleric: 2 rodadas → APPROVE** (round 1: sync crashava com config ilegível + órfã dropada do state no re-inject; round 2: reporte enganoso quando a rules é restaurada antes da falha MCP — "rules re-injetada; etapa MCP falhou").
- **Done (M3):** F18 — Coexistência multi-agente: **`src/sections.ts`** (motor de seções com 2 famílias: html `<!-- runecraft:<id> -->` e shell `# BEGIN/END` para o F20; insert/update in-place/remove/remove-other-id/listSectionIds; BOM/CRLF/UTF-8 herdados; rules.ts virou wrapper html — API F15 intacta); **`src/owners.ts`** (detecção de donos stateless: gentle-ai state file + marcadores `gentle-ai:` estritos, upstreams Pi via scanConflicts, taskflow-MCP upstream com QUALQUER nome de entry — scanMcpUpstreams lê mcpServers/mcp/[mcp_servers.*], conteúdo do usuário = info); **doctor consolidado 7–15** (check 4 do F12 absorvido pelo check 15 Upstreams Pi; +14 gentle-ai independente do Pi; check 10 estendido para entries de qualquer nome); **status** (estado `upstream` novo; `colisão` = two-driver quando upstream do domínio + nosso instalado; seção Owners no TTY; `--json.owners/warnings`); **install gate MXST-04** (owners warn → TTY lista antes do prompt; sem TTY sem --yes → aborta apontando --yes; --yes registra `warnings` no relatório — quebra de contrato do F11 "não-TTY auto-aceita" apenas com colisões); **uninstall preserved (sem registro)** (marcador runecraft: sem registro no state → preservado + reportado); **lock de escrita** (`src/lock.ts` mkdir atômico + stale 5min + pid; wrappers install/sync/uninstall, dry-run sem lock); **244 testes no harness** (17 novos no f18-coexistence); TSC limpo; doctor/status reais com 14 checks (upstream @tintinweb/pi-subagents + conteúdo do usuário no AGENTS.md real detectados).
- **Done (M4):** F19 — Routing & mental model: **`docs/ROUTING.md`** canônico (10 seções, inglês; tabela por ferramenta com fatos da pesquisa — contra-indicações derivadas marcadas "validar no Execute"; two-driver rule; hello world COEX-05 com dados REAIS — 1 prompt, 23.4s, auditor 10.6s deepseek-v4-flash, repo coex05; apêndice golden D9); **`renderRules(agentId)`** pura (D5/D6: templates literais, WORKFLOW_RULES_VERSION=1, Pi 46 linhas/4 ferramentas+two-driver, não-Pi 13 linhas/só taskflow+review — teste de ausência goal|loop|subagent|pr-review|auditor → zero matches; API F15/F17 intacta); **`src/sessionDriver.ts`** — driver via ledger do glla (`<cwd>/.pi-glla/active.jsonl`, fallback read-only `.pi-gla`) com o predicado isSupervising do fork (loop active OU goal active+autoContinue; malformadas puladas); status linha driver + `--json session.driver`; doctor check 16 (informativo, skip sem Pi) + check 9 sub-estado "desatualizado (template novo)"; sync **three-way** por target rules (D7: re-injetada/atualizada vN→vM/preservada (editada)/already in sync; update in-place por ID estável + rulesVersion no state); **272 testes** (26 novos); cleric APPROVE + 2 fixes (commits 42097af, e4aa219).
- **Done (M4):** F20 — Receipt leve & delivery gates: **receipt schema estrito** (`runecraft.receipt/v1`, campos extras rejeitados em todos os níveis — RCPT-04), store append-only atômico (`receipts/<ts>.json` UTC, sufixo -1/-2, scan newest-first); **`receipt capture <pr>` via RPC** (pi `--print --mode json /pr-review <pr> --no-comment` — stdout JSONL, último assistant = review, exit code autoritativo; RUNECRAFT_PI_BIN/RUNECRAFT_GH_BIN testáveis) + **`--from <file>`** (zero re-review) + **cross-check review.pr.head_sha vs headRefOid** (PR mudou durante review → nega); diff_hash = sha256 do comando canônico D5 sobre commits imutáveis; **gates = git hooks** pre-commit/pre-push (shim POSIX ~10 linhas com seção shell `runecraft:gates` do F18, sem BOM, chmod +x, resolução RUNECRAFT_BIN > harness > npx --no-install; hook pré-existente preservado); **álgebra v1** (exact pre-commit via `git write-tree` — correção do Execute: `--cached` emite c//i/ quebrando paridade; exact + compatible_base_advance no pre-push; changed/unrelated/ambiguous/unknown → nega; sem receipt → nega "rode /pr-review"; corrompido → nega apontando arquivo; off → exit 0 disabled/unmanaged); config repo `.runecraft/config.json` + kill switch global `~/.runecraft/config.json` (disable default global com prompt TTY); `.gitignore` escopo fino (receipts/ + config.json); uninstall remove hooks/config/.gitignore se inalterados (SETM-05; isGatesOnlyConfig com try/catch) e **receipts nunca invalidados**; doctor **check 17** + seção Gates no status; **330 testes** (57 novos — repos git reais em tmp, fake pi/gh); cleric APPROVE + 3 fixes (commits 800646d, d83639a).
- **Done (M5):** F21 — Suite determinística: **`test/eval/` em 2 camadas** (layer1 smoke subprocess — bin real via bun; layer2 fluxos SDLC — reconciliação: routing-golden/gates/state já cobertos por f19-routing/gates/receipt/state.test.ts, sem duplicação); **fixture OpenAI-wire** (chatServer.ts SSE adversarial — provider openai-completions hardcoda `stream:true`, resposta não-streaming rejeitada; 404 fora da rota única; diagnóstico nunca embute porta/path); **EVAL-MATRIX.md aditivo** (MATRIX_VERSION 1; EVAL-001/002/004/005/005b; EVAL-003 fora — AD-015) + teste de consistência matriz↔testes; **evidência JSON para o F23** (evalTest grava JSONL parcial por test file, rethrow sempre; scripts/eval-merge-evidence.ts → last-run.json gitignored com schema/suiteVersion/runner/runId/harnessVersion/coverage/results — contrato exato AD-015; mensagem crua, normalização é do F23; fail-infra no setup.ts); **348 testes** (+18: 2 smoke + 16 layer2 incl. adversarial induzido (a–e) e hermetic-env); **Execute findings (AD-021)**: SDK 0.81.0 sem InMemoryCredentialStore → authPath+setRuntimeApiKey; createAgentSession não emite session_start → `bindExtensions({})` obrigatório (glla registra tools nele); glla 0.28.34 NÃO spawna auditor (in-process, makeAuditorResourceLoader, tools ⊆ read/grep/find/ls/bash — isolamento verificado pelo fixture por perfil de tools); pr-review loop tools gated fora de /pr-review ativo → EVAL-004/005 via child direto do fork; nenhum pi real necessário (SDK provê CLI; wrapper `pi` no PATH p/ children); devDep do SDK declarada (0.81.0); cleric APPROVE + 1 fix (commits 4dcdfad, a5182b6).
- **Decisões F3:** TypeScript 6.0.3 + @types/node@22 adicionados como devDeps (upstream usava TypeScript do root pnpm). `noEmitOnError: false` nos tsconfig.build.json para emitir dist mesmo com erros de tipo TS6 vs TS5 (37 type errors conhecidos em taskflow-core, pós-v1). Build scripts simplificados (removidos copy-readme.mjs, stamp-build-info.mjs — não existem no harness). turbo.json: `dependsOn: ["^build"]` adicionado para ordem correta core→pi/dsl.
- **Origem:** pivotado do warband (arcanum) — ver AD-001.

---

## Recent Decisions

### AD-001: Pivot — de "portar Guild" para "harness de forks" (2026-07-29)

**Decision:** Abandonar o porte do Guild (warband no arcanum). Criar monorepo novo `~/Projects/harness` (org runecraft) que forka os melhores pacotes de subagent/workflow do ecossistema Pi como packages `@runecraft/*`, formando um harness instalável de uma vez.
**Reason:** Avaliação do catálogo pi.dev mostrou que o ecossistema já resolve dispatch (pi-subagents), DAG (pi-taskflow), goal+auditor isolado (pi-goal-list-loop-audit) e review (pi-pr-review) com qualidade superior ao que o porte do Guild entregaria. Usuário quer controle de evolução (fork, não dependência).
**Trade-off:** Custo permanente de sync com upstream (aceito explicitamente pelo usuário).
**Impact:** arcanum/warband fica supersedido. Novo repo com 5 packages (4 forks + umbrella).

### AD-002: Fork = cópia sem git history; licença é risco aberto (2026-07-29)

**Decision:** Copiar o source dos upstreams (tarball npm pinado), sem git history. Usuário pediu remoção de licença e git.
**Reason:** Simplicidade e propriedade total do código no monorepo.
**Trade-off:** ⚠️ MIT exige preservar copyright notice em cópias/porções substanciais. Remover atribuição de código MIT republicado no npm é violação de licença com risco real (DMCA takedown, dano reputacional à org). Recomendação registrada: manter um `LICENSE-THIRD-PARTY.md` na raiz com as atribuições originais — custo zero, elimina o risco. Decisão final pendente do owner antes do F9 (publish).
**Impact:** Vendoring script (F1) baixa tarballs; decisão de atribuição precisa fechar antes de publicar.

### AD-003: Stack de 4 forks; excluídos por sobreposição (2026-07-29)

**Decision:** Forkar exatamente: pi-subagents 0.37.2, pi-taskflow 0.2.6 (só core + adapter Pi), pi-goal-list-loop-audit 0.28.34, pi-pr-review 1.11.4. Excluir: pi-landstrip (sistema de subagents próprio conflita com pi-subagents), nervous-system (suite completa concorrente), pi-extensible-workflows (workflow engine redundante com taskflow), pi-swarm (parallel redundante com subagents).
**Reason:** Matriz de sobreposição — os 4 escolhidos são complementares (dispatch / DAG / goal+audit / review); os excluídos duplicam ou conflitam.
**Trade-off:** Sem sandbox OS-level no v1 (landstrip fora). Reavaliar no futuro.
**Impact:** 4 packages de fork + 1 umbrella no monorepo.

### AD-004: Sem lore RPG; produto público para devs SDLC (2026-07-29)

**Decision:** Nomes profissionais e diretos (`subagents`, `taskflow`, `goal-loop-audit`, `pr-review`, `harness`). Público: devs praticando SDLC com agentes. Publicação npm sob `@runecraft`.
**Reason:** Usuário descartou tema RPG para este produto.
**Impact:** READMEs e naming neutros; sem mapeamento de "classes".

### AD-005: Pi é o runtime; TUI fora de escopo (2026-07-29)

**Decision:** O harness roda dentro do Pi (extensões). Visão futura de Pi como server + TUI própria (estilo OpenCode) fica em Future Considerations.
**Reason:** Foco no valor imediato; TUI é projeto próprio.
**Impact:** v1 não tem código de server/TUI.

### AD-007: Fork do taskflow = core + pi + dsl, espelhando estrutura upstream (2026-07-29)

**Decision:** F3 forka 3 dos 9 packages do monorepo heggria/taskflow: taskflow-core (engine), pi-taskflow (adapter Pi) e taskflow-dsl (authoring TS compile-time), em `packages/taskflow/{core,pi,dsl}` publicados como `@runecraft/taskflow-core`, `@runecraft/taskflow` e `@runecraft/taskflow-dsl`. Camada MCP (taskflow-mcp-core, taskflow-hosts, codex/claude/opencode/grok adapters) fora do v1.
**Reason:** core é host-neutral (corte limpo, não importa SDK de host); DSL dá authoring type-safe para devs SDLC (JSON puro é doloroso em flows grandes) com custo zero de runtime; camada MCP serve hosts que não usamos e exigiria testes contra Codex/Claude/OpenCode/Grok. Estrutura espelhada mantém sync file-to-file (AD-006).
**Trade-off:** Sem distribuição cross-agent no v1 — vetor de crescimento adiado para Future Considerations.
**Impact:** Monorepo passa a ter 7 packages publicháveis: subagents, taskflow-core, taskflow, taskflow-dsl, goal-loop-audit, pr-review, harness.

### AD-006: Convenções de monorepo herdadas do arcanum (2026-07-29)

**Decision:** Workspaces + Turborepo + Biome + TS strict ESM, Node ≥ 22.19 (piso dos upstreams). Cada fork preserva o build shape do upstream (subagents ships TS source; taskflow ships dist/).
**Reason:** Consistência com a org; minimizar fricção de sync (menos diff estrutural vs upstream).
**Impact:** Scaffold F1 replica configs do arcanum; forks não são reformatados agressivamente no v1 (reduz diff de sync).

### AD-008: Serving layer estilo gentle-ai em TS — sem binário Go (2026-08-04)

**Decision:** O harness v1 ganha uma serving layer inspirada no gentle-ai, implementada em TS no monorepo: CLI `npx @runecraft/harness` (install/doctor/status/sync/uninstall), `state.json` e backups — os 4 forks como "components" selecionáveis. Rejeitado: fork do gentle-ai (Go).
**Reason:** Stack única TS/Node; custo de sync de um upstream de 1.8k commits com release semanal incompatível com o controle de evolução (AD-001); evals vivem naturalmente no monorepo TS; o gentle-ai já serve Pi via gentle-pi (forkar = competir com nosso próprio upstream). Trechos MIT (snapshot/dedupe, checks de doctor, merge overlay) podem ser copiados com atribuição (AD-002).
**Trade-off:** Reinvenção parcial de roda em TS (backup/sync/doctor já resolvidos lá); sem TUI Bubbletea.
**Impact:** F11–F14 no roadmap; gentle-ai vira referência de design (usage.md, pi.md); LICENSE-THIRD-PARTY.md antes de copiar trechos.

### AD-009: Multi-agente v1 = Claude Code, OpenCode, Codex (2026-08-04)

**Decision:** M3 serve agentes não-Pi começando por Claude Code, OpenCode e Codex. F16 re-vendora a camada MCP do taskflow (taskflow-mcp-core + taskflow-hosts + adapters codex/claude/opencode/grok) que o AD-007 deferiu. Agentes sem adapter = detect-only com guia (padrão gentle-ai/Hermes).
**Reason:** São exatamente os hosts que o taskflow-MCP já suporta — reaproveitamento, não adapters novos. subagents e goal-loop-audit são extensões Pi e permanecem Pi-only; a matriz de componentes por agente é honesta (fail-closed onde não suportamos).
**Trade-off:** Matriz parcial por agente (nem tudo em todo agente); mais um fork para manter (camada MCP).
**Impact:** F15–F18; PROJECT.md scope atualizado (multi-agente sai de out-of-scope).

### AD-010: Evals como milestone próprio — M5 (2026-08-04)

**Decision:** Evals viram milestone de primeira classe em 3 camadas: F21 suite determinística com fixture de modelo (estilo testing-agents-deterministically do gentle-ai, roda em CI sem tokens), F22 cenários E2E versionados com modelos reais (evolução do scenarios.md do F7), F23 ratchet baselines de não-regressão (estilo .refusal-ratchet-baseline / .guard-population-baseline).
**Reason:** Garantir o harness continuamente sem depender de modelos reais em CI; F7 prova coexistência 1x, evals provam para sempre.
**Trade-off:** Manutenção contínua de fixtures; custo de execução dos E2E.
**Impact:** F21–F23; lane CI dedicada no F9.

### AD-011: Receipt leve — RDD sem authority store (2026-08-04)

**Decision:** F20 implementa o conceito RDD simplificado: pr-review como engine de review, gates pre-commit/pre-push validam o mesmo resultado. Sem authority store nem threat model (aparato Go do gentle-ai).
**Reason:** Valor de entrega com custo baixo; o aparato completo só se o leve provar insuficiente.
**Trade-off:** Sem garantia criptográfica de autoridade.
**Impact:** F20; RDD completo fica em Future Considerations.

### AD-012: Config surface dos forks é heterogênea (2026-08-05)

**Decision:** O merge de settings (F14) opera sobre "targets" por componente, não só no settings.json do Pi: subagents e taskflow leem o settings do Pi com prefixos (`subagents.*`, `taskflow.*`); pr-review usa arquivo próprio `pr-review.json` (user ~/.pi/agent, projeto <repo>/.pi); goal-loop-audit não tem surface de settings identificada no src (config via args/env — sem defaults no v1, a validar no Execute). Defaults do harness = valores default do próprio upstream, nunca inventados.
**Reason:** Pesquisa nos 4 forks (2026-08-05) mostrou shapes diferentes; assumir um único arquivo quebraria pr-review e criaria blocos órfãos.
**Trade-off:** Merge engine precisa de alvos múltiplos; goal-loop fica sem defaults no v1.
**Impact:** F14 design define Target = {file, scope, prefix}; F18 (detecção de upstreams) deve olhar também pr-review.json; docs do F8 devem documentar a surface por fork.

### AD-013: Pesquisas e revisão cruzada do MULA (2026-08-05)

**Decision:** (1) Pesquisas via subagentes: camada MCP do heggria/taskflow v0.2.6 verificada (6 packages, JSON-RPC hand-rolled zero deps, pins npx vivem nas configs plugin/ e não nos E2E, bun não descobre e2e-*.mts, publish-verification.test.ts excluído) e integrações gentle-ai verificadas (detecção por binário, marcadores por ID, paths de config dos 3 agentes, limitações Codex solo). (2) Revisão cruzada dos designs F15–F18: schema do state consolidado — F17 é dono (v1 aditivo, sem bump), `agents.<id>.targets[]` com contentHash por target (rules: conteúdo da seção; mcp: entry canônico), campo `sections` do F18 descartado; tabela de doctor consolidada 7–15 no F18; MATR-01 AC 1.2 mapeia para `--preset full`.
**Reason:** Três subagentes independentes propuseram três formas concorrentes do state; revisor independente arbitrou a mais simples (aditiva, sem migração).
**Trade-off:** contentHash por target exige normalização (a validar no Execute); sem installedAt por seção (aceitável — arquivos distintos por agente).
**Impact:** F15–F18 designs aprovados com correções (B1, B2, I1–I3); F13 schema final = F13 original + agents (F17); docs do F8 referenciam o schema único.

### AD-014: Revisão cruzada do WORK — F19/F20 aprovados com correções (2026-08-05)

**Decision:** (1) Marcadores com família por tipo de arquivo: HTML `<!-- runecraft:<id> -->` em textos (CLAUDE.md/AGENTS.md) e shell `# BEGIN/END runecraft:<id>` em executáveis (git hooks do F20) — o motor do F18 ganha a família, operações idênticas. (2) Doctor: check 16 = driver ativo (F19), check 17 = gates (F20). (3) `gates run` com config.json ausente → deny fail-closed (hook presente implica enable rodou); exit 0 só com config presente e enabled:false. (4) Menores: .gitignore escopado para `.runecraft/receipts/` + `config.json` (não engole state/backups de workspace); hook sem BOM; uninstall global remove `~/.runecraft/config.json`; gates disable com backup; config.json do F20 é config (não estado) — nota no F13.
**Reason:** Revisor independente encontrou contradição no formato da seção do hook (HTML vs shell — quebraria o shell), colisão de numeração de checks e violação do edge fail-closed da spec.
**Trade-off:** Família de marcadores adiciona um caso no motor de seções (custo pequeno, teste dedicado).
**Impact:** F19/F20 designs aprovados; F18 atualizado (família shell); F13 nota config.json; docs do F8 documentam os dois sentidos de "gate".

### AD-016: Decisões de execução do M2 (2026-08-06/07)

**Decision:** (1) F12 gray areas arbitradas em revisão: exit code do doctor = fail→1, warn/pass→0 (convenção fail-closed do F11); sync REINSTALA conforme state (spec LIFE-06 AC 3.1 vence a instrução do parent — órfãos nunca tocados/adotados); default de scope workspace estendido a status/sync (coerência entre comandos que leem state); `status --json` = objeto superset `{scope, packages[], collisions}` (congelar forma no design antes do F21). (2) F13 decisões ratificadas: backup pré-restore obrigatório (ciclo reversível); `--keep` vive em `backups`; `preInstall` mantém shape por operação da API F11 (F17/SETM-05 podem revisitar); state.json fora de filesTouchedByInstall; sync sem preInstall. (3) F14 experimento de defaults: subagents e taskflow recebem defaults v1 (chaves realmente lidas pelos forks, ex.: `subagents.modelScope.enforce`, `taskflow.piChild.resourceProfile`=**isolated** — correção do cleric, não allowlist; TASKFLOW_MODEL_ROLES idêntico ao INIT_ROLES do core); pr-review e goal-loop-audit SEM defaults (fork não hardcoda modelos; DEFAULT_SETTINGS do glla valem com arquivo ausente). (4) Fixes pós-revisão que viraram invariantes: merge é two-pass (SETM-04: alvo inválido → zero writes); segmento intermediário scalar → conflito, nunca clobber; uninstall `--component` atribui settingsChanges por prefixo gerenciado (modelRoles.* → taskflow).
**Reason:** Revisões cleric independentes após cada feature (padrão da sessão); experimento empírico no source dos 4 forks para defaults honestos (AD-012).
**Trade-off:** `preInstall` por operação fica para revisão no F17; check 6 (disco) só testado no caminho pass (sem knob de falha).
**Impact:** M2 fecha com 168 testes; contrato de evidência F21 pode ancorar dispatch/RUNECRAFT_PI_BIN e o shape de `status --json`; BUG-1/BUG-2 do taskflow (F7) entram nos Todos como issues próprias.

### AD-015: Revisão final do EVAL — planejamento completo fechado (2026-08-05)

**Decision:** (1) Contrato de evidência F21→F23 alinhado: F21 grava **mensagem crua** + `status pass|fail|fail-infra` (classificação no setup.ts) + `harnessVersion` + `coverage[]` via `recordCoverage` em `test/eval/evidence/last-run.json`; F23 normaliza na leitura (`normalize.ts` — única implementação). (2) Camada 2 do F21 = 4 fluxos + sanity (EVAL-001/002/004/005/005b); **EVAL-003 (goal+taskflow standalone) cortado** — decisão aprovada era só hello world; o cenário fica no F22 S3. (3) Goldens consolidados: rules vive no F21 (`routing-golden.test.ts` — renderRules == golden == apêndice); F23 tem 5 goldens (section-workflow-pi/nonpi + mcp-claude/opencode/codex). (4) Menores: parseArgs migra para `dispatch()` (F11), scenarioId = campo name do F22, paths alinhados (layer1/, evidence/, golden/), F22 sem "fork do Pi" (SDK @earendil-works), COEX-05 preenchido pelo F7 (prereq).
**Reason:** Revisor final encontrou contrato de evidência divergente entre F21 e F23 (paths, normalização, campos), matriz de fluxos sem testes correspondentes e escopo da camada 2 extrapolado.
**Trade-off:** Camada 2 menor (sem taskflow standalone — coberto no F22 com modelos reais); normalização concentrada no F23.
**Impact:** F21–F23 designs aprovados; planejamento COMPLETO: F1–F23 com spec + design + revisão; docs do F8 referenciam o contrato de evidência.

### AD-017: Decisões de execução do F17 (2026-08-07)

**Decision:** (1) `--component` com agentes não-Pi valida com fail-closed (par agente×componente via matriz, motivo da célula) mas aplica sempre a **coluna completa** do agente (v1 = 2 células fixas rules+mcp — D5; filtrar de verdade exigiria opcionalidade no contrato do inject, sem valor no v1). (2) Status: Pi entra no `--json.agents` (4 grupos pi-packages + rules native; estado vem da tabela de packages) mas fica fora da seção TTY (tabela de packages cobre); `AgentCellState` ganha "órfã" e "—"; colisão upstream vence "não gerenciado" (é fato da config real, mesmo à mão). (3) Check 11 (config parseável): codex NÃO é julgado como TOML (sem parser no runtime — zero deps): só UTF-8 ilegível é fail real; validade TOML é domínio do codex/F18 (donos). (4) Sync: pendência computada por CONTEÚDO (hasSection/fingerprint) ANTES do early-return de in-sync — só-agente pendente agora sincroniza (antes retornava in-sync sem agir, bug latente do F15 T8); targets pós-inject registrados no state (segundo saveState quando mudou); órfãos reportados no caminho in-sync também (renderer ganhou notes). (5) `columnComponents` inclui células unsupported (são da coluna); os consumidores filtram por kind acionável. (6) Testes de doctor migrados para PATH mínimo (symlinks sh+node) — os bins reais do ambiente (claude/opencode/codex instalados na máquina) tornavam os checks 8–13 não determinísticos.
**Reason:** Revisão do design D1–D6 contra o código real do F15 (que já tinha 90% da mecânica); o delta era formalizar a matriz como fonte única + fechar os buracos (sync por conteúdo, registro pós-inject, determinismo de testes).
**Trade-off:** Sem filtro real de `--component` para não-Pi (aceito — v1 tem 2 células fixas); TOML do codex sem validação (honesto — sem parser, não afirmamos nem validade nem invalidez).
**Impact:** F17 fecha com 223 testes; F18 herda: checks 7–13 para consolidar em 7–15, `agents.*.targets` como fonte de verdade de seções/entries, sync por conteúdo pronto para detecção de donos. **Achado de ambiente**: `~/.codex/config.toml` do usuário tem `[mcp_servers.taskflow]` DUPLICADA (linhas 3–4, a primeira vazia) — resíduo provável de upsert antigo; o check 11 não falha por isso (não julgamos TOML alheio); verificar no F18 se o toml.ts precisa lidar com seções duplicadas.

### AD-018: Decisões de execução do F18 (2026-08-07)

**Decision:** (1) **Lock**: bun/Node não expõem flock portátil — validado no Execute; `src/lock.ts` usa mkdir atômico + pid + stale 5min (padrão npm/apt), wrappers em install/sync/uninstall; dry-run sem lock (não escreve). Optimistic re-check (hash re-lido antes da escrita) NÃO implementado — backup F13 + conflito-reportado já mitigam; reavaliar no F20 (hooks). (2) **Status two-driver**: `colisão` = upstream do domínio + nosso instalado (state ou pi list); `upstream` (novo) = só o upstream; sem upstream do domínio, `colisão` mantém o significado F12 (versão divergente) — semântica aditiva, compat com testes. gentle-pi não mapeia domínio (fica só em Owners/collisions). (3) **Gate MXST-04**: quebra contratual do F11 "não-TTY auto-aceita" — agora aborta sem --yes QUANDO há owners warn (upstreams, gentle-ai, MCP upstream); sem colisões o comportamento F11 permanece. `warnings` no relatório e no JSON. (4) **Check 11 codex**: continua sem parser TOML (F17) — a seção `[mcp_servers.taskflow]` DUPLICADA no config.toml real do usuário (achado F17) não é julgada; F18 não mexeu no toml.ts (seção duplicada é resíduo, verificação futura). (5) **Check 10 estendido**: scanMcpUpstreams lê TODAS as entries (mcpServers/mcp/[mcp_servers.*]) — colisão detectada mesmo com nome de entry diferente de `taskflow`. (6) **removeSectionFamily retorna o conteúdo** (quem grava é o caller — contrato do rules.ts original preservado no motor).
**Reason:** F18 fecha o MULA (F15–F18) com a tabela consolidada 7–15 (B2), detecção de donos stateless (edge "upstream depois" sem watcher) e o gate não-silencioso do install.
**Trade-off:** Lock sem flock real (mkdir é suficiente para serializar processos do harness — gentle-ai não respeita nosso lock; documentado); TOML do codex sem validação mantido.
**Impact:** M3 FECHADO (F15–F18). F19 herda: check 16 (driver ativo), seção Owners do status, warnings do report; F20 herda a família shell do motor. 244 testes no harness.

---

### AD-019: Decisões de execução do F19 (2026-08-07)

**Decision:** (1) **Driver ativo** (D8): mecanismo único validado no source do glla — ledger `<cwd>/.pi-glla/active.jsonl` (fallback read-only `.pi-gla`, dir pré-rename; leitura não renomeia), JSONL de eventos com folding só de `type:"state"` (malformadas/truncadas puladas — v0.28.6 persistence hardening); predicado = o próprio `isSupervising` do fork (loop active OU goal active+autoContinue; auditing/paused/complete/aborted não dirigem). Ledger ausente → `direct` (não `unknown` — cobre glla não instalado sem ruído e satisfaz melhor o AC 3.2; documentado no código); ilegível → `unknown` sem crash. (2) **Template Pi com 46 linhas** (design "~45"): texto literal da fonte de verdade (D5); assert calibrado ≤46 no teste com justificativa. (3) **Sync three-way**: update in-place por ID estável + contentHash/rulesVersion novos no state; `preserveRules` aditivo nos 3 adapters (inject não sobrescreve edição); estado `arquivo == render ≠ registrado` (optimistic re-check do AD-018 não implementado) classifica como "preservada (editada)" — benigno, nunca auto-cura (registrado como nota, D7 não define). (4) **Hello world**: COEX-05 registra implementação DIRETA do modelo (3× bash no loop), não dispatch — ROUTING.md fiel ao registro (correção do cleric; o D4 foi escrito antes do F7 executar). (5) **Remedy do check 9** sem `--agent` (sync não filtra por agente — linha tocada pelo F19 corrigida). (6) Check 16 alocado sem colisão; multi-sessão no mesmo cwd = limite do fork (ledger por cwd), documentado.
**Reason:** Padrão da sessão (cleric independente após cada feature); D8 pedia validação do mecanismo no Execute e o source do glla resolveu os candidatos (b)/(c) — um único mecanismo real.
**Trade-off:** Leitura de estado é por cwd (sessão paralela no mesmo repo compartilha ledger — documentado como limite do fork); template v1 é 1 linha acima do orçamento de design (calibração autorizada).
**Impact:** M4 abre com 272 testes; F21 pode ancorar o golden test (render == apêndice do ROUTING.md) e os limites de tamanho como asserts reais.

### AD-020: Decisões de execução do F20 (2026-08-07)

**Decision:** (1) **Invocation do Pi não-interativo** (D2): `RUNECRAFT_PI_BIN --print --mode json /pr-review <pr> --no-comment [--include-closed]` — stdout JSONL de eventos, último assistant text = review JSON; exit code autoritativo (evidência: resolveAppMode/toPrintOutputMode no dist do pi; `begin` do pr-review aceita só interactive/rpc; allowNonOpen aceita --include-closed). **`--no-comment`** adicionado: capture nunca posta no GitHub (zero side effects; `--from` cobre reviews postados pelo TUI). (2) **Paridade do diff no pre-commit**: `git diff --cached <base>` emite prefixos `c/`/`i/` para arquivos novos ≠ `a/`/`b/` da forma dois-commits — corrigido materializando o index com `git write-tree` (byte-idêntico à captura; validado empiricamente). (3) **Shim**: marcador engine-exact (`# BEGIN runecraft:gates` — o sufixo "gerenciado pelo harness" do fluxo 3 quebraria o `listSectionIds` estrito do F18; nota vira 1ª linha do corpo); `RUNECRAFT_BIN` como 1ª opção de resolução (o texto do fluxo 3 exigia mas o bloco ilustrativo não mostrava). (4) **Cross-check de integridade no capture RPC** (fix cleric): `review.pr.head_sha ≠ metadata.headRefOid` → sem receipt (PR mudou entre a chamada gh do harness e a do fork — o exato modo de falha force-push que o F20 existe para impedir; `--from` é autoconsistente). (5) **Uninstall global**: remove `~/.runecraft/config.json` só se `isGatesOnlyConfig` (config estendida pelo usuário preservada — SETM-05 conservador; re-parse com try/catch contra TOCTOU pós-backup). (6) **Nome do receipt em UTC** (`getUTC*`): issuedAt é ISO-Z; getters locais deslocariam o nome e inverteriam a ordenação newest-first em fusos negativos. (7) Root via `git rev-parse --git-common-dir` + hooks via `--git-path hooks` — verificado com worktree real (hook comum executa em linked worktrees). (8) Hash por streaming com warn stderr > 50 MB (`DIFF_WARN_BYTES`). (9) Prompt do disable global: TTY `[y/N]` default N; `--yes` pula; não-TTY segue (padrão uninstall F12).
**Reason:** A lista "Validar no Execute" do design exigia decisões com evidência; a paridade de bytes capture↔gate é o coração da álgebra (D5) e exigiu a correção do write-tree; o cleric encontrou a brecha do head móvel no fluxo RPC.
**Trade-off:** Auto-capture por hook de sessão (`pr-review-completed`) NÃO implementado (alternativa c — RPC validado como caminho de primeira classe; evolução futura); fluxo RPC com pi/gh reais (LLM) não executado em E2E (testes com fakes — contrato F21 D1; `--from` é o caminho garantido sem custo de modelo); `--no-verify` burlável (limite documentado, AD-011).
**Impact:** M4 FECHA com 330 testes (57 novos: repos git reais em tmp, fakes pi/gh); check 17; F21 herda o contrato de invocação do pi (--print --mode json) e os fakes como fixtures de modelo.

### AD-021: Decisões de execução do F21 (2026-08-07)

**Decision:** (1) **Wiring do SDK 0.81.0**: `InMemoryCredentialStore` não existe → `ModelRuntime.create({authPath, modelsPath, allowModelNetwork:false})` + `setRuntimeApiKey("fixture","fixture")` (override in-memory, zero disco/rede); `getModel` enxerga models.json custom (D8A validado). (2) **`bindExtensions({})` obrigatório** após createAgentSession: o SDK não emite session_start sozinho — o glla registra as goal tools nele (D-Execute-1; corrige suposição do design). (3) **Auditor do glla é in-process** (0.28.34 não spawna subprocesso): makeAuditorResourceLoader com tools ⊆ builtins; distinção no fixture por perfil de tools (D8B validado; fallback por model id não necessário). (4) **SSE obrigatório**: provider openai-completions hardcoda `stream:true` — fixture implementa SSE com deltas de tool_calls (D5 validado). (5) **Materialização das extensões**: settings.json com `extensions` de paths absolutos materializa os 5 forks no agentDir temp (H1 do F6 validado); children (subagents/pr-review) herdam agentDir e usam o CLI do SDK — **nenhum pi real necessário no CI**. (6) **EVAL-004/005 review via child do pr-review direto** (buildReviewBaseArgs do fork): loop tools (review_subagent etc.) são gated pelo ReviewLoopCoordinator fora de /pr-review ativo — inviável em sessão SDK scriptada (D-Execute-3). (7) **DevDep do SDK declarada** `"0.81.0"` (pi-coding-agent + pi-ai) — fix cleric: import estático sem devDep quebrava opaco em bump de lockfile; diff do bun.lock mínimo (+4 linhas, resolução inalterada). (8) **Reconciliação layer1**: arquivos do design cobertos por testes existentes (routing-golden → f19-routing.test.ts, limites ≤46/≤25 calibrados; gates-receipt → gates/receipt.test.ts; state-schema → state.test.ts) — sem duplicação dos 330 testes. (9) **Continuação pós-aprovação do glla** tolerada nos scripts (passo final benigno; asserts ≥ N — D-Execute-5).
**Reason:** Os 7 pontos "validar no Execute" do design exigiam evidência empírica; o cleric encontrou a fragilidade da dep transitiva e a omissão do evalId fora da matriz (corrigida: sempre emitido).
**Trade-off:** Scripts da matriz são sensíveis a mudanças de tools/prompts dos forks (política aditiva cobre; diagnóstico adversarial aponta call esperada vs recebida); evidência do F23 depende da identidade (testFile, testName, message normalizada).
**Impact:** M5 abre com 348 testes; F22 herda fixture/ e cenários (scripts/eval-e2e/); F23 consome last-run.json com contrato exato; lane CI de PR fica para o F9 (DETR-06 materializado em turbo test + scripts test:eval/merge:evidence).

## Active Blockers

None.

---

## Lessons Learned

- Rename de fork precisa varrer scripts de tooling além do src — `verify-package-contents.mjs` hardcoda `pi-pr-review` e URLs do 10ego; os testes de package policy (test:tooling) pegam o que o rename não vê.
- Mock de `@earendil-works/pi-tui` sem export completo (`matchesKey`) quebra imports estáticos de arquivos posteriores quando bun roda os testes num processo só — falha ordem-dependente, pré-existente no upstream.

- Catálogo pi.dev tem ~111 pacotes de subagents/workflow; a densidade de sobreposição é alta — análise de conflito antes de compor é obrigatória (two-driver rule do goal-loop-audit é o exemplo canônico).
- pi-taskflow vive num monorepo (heggria/taskflow) com 9 packages; o fork extrai taskflow-core + pi-taskflow + taskflow-dsl (AD-007).
- Tarball do npm não contém testes (só `files` declarados) — vendoring usa GitHub source tarball no ref pinado (já vem sem .git).
- `Bun.write(file, Response)` trava com codeload.github.com — usar `arrayBuffer()` explícito antes do write.
- DraconDev/pi-goal-list-loop-audit não usa tags git — pin por SHA resolvido manualmente (21b6bb0 = 0.28.34).

---

## Deferred Ideas

- [x] Camada MCP do taskflow → reativada como F16 (AD-009)
- [ ] TUI própria (Pi como server) — estilo OpenCode
- [ ] Installer standalone que instala o próprio Pi (`npx @runecraft/harness init`)
- [ ] Sandbox OS-level (fork parcial do landstrip compatível com nosso subagents)
- [ ] Adaptadores adicionais: Gemini CLI, Cursor, Windsurf, Kiro
- [ ] Roadmap comunitário vivo (labels up-for-grabs / status:approved) ao abrir o repo
- [ ] RDD completo (authority store + threat model) se o receipt leve (F20) provar insuficiente
- [ ] Melhorias próprias nos forks (raison d'être do fork)

---

## Todos

- [x] Specify F1 (Monorepo Scaffold) — COMPLETE 2026-07-29
- [x] Specs F2–F10 — COMPLETE 2026-07-29
- [x] F5 fix: `packages/pr-review/scripts/verify-package-contents.mjs:119,135-137` e `tests/tooling/package-contents.node.mjs:22,69` — hardcoda `pi-pr-review`/URLs 10ego (falha real do fork) — **APLICADO 2026-08-06** (ranger; test:tooling 20/20)
- [x] F2: `install.mjs` clona repo upstream hardcoded — removido (SUBA-02, commit efdd9da)
- [x] F6: design.md antes do Execute — feito; Execute COMPLETE + cleric APPROVE (commit 4c66c39/359a37f)
- [ ] Fechar decisão de atribuição de licença (AD-002) — deadline: F8 (DOCS-03); obrigatório antes de copiar trechos do gentle-ai (F11/F13) e de publicar (F9)
- [x] Specs SERV (F11–F14) — criadas 2026-08-05
- [x] Designs SERV (F6 + F11–F14) — criados e revisados 2026-08-05
- [x] Specs MULA (F15–F18) — criadas 2026-08-05
- [x] Designs MULA (F15–F18) — criados e revisados 2026-08-05 (AD-013)
- [x] Specs WORK (F19–F20) — criadas 2026-08-05
- [x] Designs WORK (F19–F20) — criados e revisados 2026-08-05 (AD-014)
- [x] Specs EVAL (F21–F23) — criadas 2026-08-05
- [x] Designs EVAL (F21–F23) — criados e revisados 2026-08-05 (AD-015)
- [x] **Planejamento completo**: F1–F23 com spec + design + revisão
- [x] **M1 COMPLETE** (F1–F5) — commits 2026-08-06 (efdd9da..b1ba279)
- [x] **M2 COMPLETE** (F6, F7, F11–F14) — Execute 2026-08-06/07; 168 testes no harness
- [ ] F14 Execute: validar defaults reais por fork (experimento) — **FEITO** (merge.ts header, AD-016; correção: resourceProfile=isolated)
- [x] **F16 COMPLETE** (re-vendor camada MCP) — Execute 2026-08-07; 184 testes unit; cleric APPROVE (commit 6823ec5)
- [x] **F15 COMPLETE** (adapters v1) — Execute 2026-08-07; 203 testes no harness; cleric APPROVE após 3 rodadas (commits 94291cf..f6e46fb)
- [x] F16: re-vendorar camada MCP do taskflow (reativa deferral do AD-007) — **FEITO**
- [ ] BUG-1: `@runecraft/taskflow` import dinâmico não renomeado quebra verify/compile/compile-ir (F7 scenarios.md §Achados)
- [ ] BUG-2: `@runecraft/taskflow-core` dist/agents/ não empacotado → run falha `Unknown agent: default` (F7 scenarios.md §Achados)
- [ ] Limpeza: repo GitHub de teste do COEX-04 pendente de exclusão (token sem escopo delete_repo)
- [ ] Referências pi-pr-review/10ego remanescentes em docs/CI do pr-review (README/RELEASING/CHANGELOG/release-please/workflows — varredura no F8)
- [x] M3 Execute: F16 → F15 (ordem corrigida: spec F15 declara prereq F16) — COMPLETE
- [x] **F17 COMPLETE** (matriz + checks 7–13 + status 3 fontes + sync por conteúdo) — Execute 2026-08-07; 226 testes; cleric APPROVE após 2 rodadas (commits 91c682f, a91399e, 8b7b4dc)
- [x] **F18 COMPLETE** (coexistência multi-agente: sections 2 famílias + owners + checks 7–15 + two-driver + gate MXST-04 + lock) — Execute 2026-08-07; 246 testes; cleric APPROVE + 1 fix (TOML duplicada/heartbeat; commits b7b06bd, 5368f21)
- [x] M4 Execute: F19 (routing) → F20 (receipt gates)
- [x] M4 Execute: F19 → F20
- [x] M5 Execute: F21 (suite determinística) — COMPLETE 2026-08-07; 348 testes; cleric APPROVE + 1 fix (commits 4dcdfad, a5182b6)
- [ ] M5 Execute: F22 (E2E com modelos reais) → F23 (ratchets) — **F22 exige aprovação explícita do usuário (custo de tokens)**
- [ ] M6 Execute: F8 (docs) → F9 (publish) → F10 (sync workflow)

---

## Preferences

- Idioma: PT-BR nas conversas; artefatos em PT-BR
- Usuário prefere opções com "Recomendado" marcado
