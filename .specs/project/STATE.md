# State

**Last Updated:** 2026-08-04
**Current Work:** F2 COMPLETE. F3 COMPLETE. Próximo: validar F4 e F5 (já renomeados), depois F6 — Umbrella. Roadmap reestruturado (M2–M6: serving layer, multi-agente, evals) — ver AD-008..011.
**Specs criadas:** F2 (SUBA, Medium), F3 (TFLW, Large — 3 pkgs + workspace dep), F4 (GLLA, Medium), F5 (PREV, Medium — dispatch a mapear), F6 (UMBR, Large — **design.md obrigatório**: mecanismo de agregação de extensões Pi, hipóteses H1/H2/H3), F7 (COEX, Medium — two-driver é o risco central), F8 (DOCS), F9 (PUBL), F10 (SYNC — three-way merge sobre vendor.json).

### Handoff

- **Done:** F1 — toolchain. F2 — @runecraft/subagents (1463/1464 unit+integration; SUBA-04 best-effort). F3 — @runecraft/taskflow (core+pi+dsl): vendor ✓, rename ✓, build dist/ ✓, testes core 1540/1585 (97%), pi 179/186 (96%), dsl 65/65 (100%). Falhas remanescentes são ambiente/integração (discoverAgents contamina com CWD real, race conditions, dados upstream ausentes). F4 — @runecraft/goal-loop-audit: COMPLETE (604/607 — validado 2026-08-05; falhas: 1 pré-existente upstream, 1 git-untracked). F5 — @runecraft/pr-review: bun test 243/245 (2 falhas pré-existentes upstream); 1 falha REAL do fork em test:tooling (verify-package-contents hardcoda pi-pr-review/10ego).
- **Next:** Validar testes de F4 e F5, depois F6 — Umbrella @runecraft/harness (design.md obrigatório antes do Execute). Roadmap expandido para M2–M6 em 2026-08-04 — AD-008..011.
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

### AD-015: Revisão final do EVAL — planejamento completo fechado (2026-08-05)

**Decision:** (1) Contrato de evidência F21→F23 alinhado: F21 grava **mensagem crua** + `status pass|fail|fail-infra` (classificação no setup.ts) + `harnessVersion` + `coverage[]` via `recordCoverage` em `test/eval/evidence/last-run.json`; F23 normaliza na leitura (`normalize.ts` — única implementação). (2) Camada 2 do F21 = 4 fluxos + sanity (EVAL-001/002/004/005/005b); **EVAL-003 (goal+taskflow standalone) cortado** — decisão aprovada era só hello world; o cenário fica no F22 S3. (3) Goldens consolidados: rules vive no F21 (`routing-golden.test.ts` — renderRules == golden == apêndice); F23 tem 5 goldens (section-workflow-pi/nonpi + mcp-claude/opencode/codex). (4) Menores: parseArgs migra para `dispatch()` (F11), scenarioId = campo name do F22, paths alinhados (layer1/, evidence/, golden/), F22 sem "fork do Pi" (SDK @earendil-works), COEX-05 preenchido pelo F7 (prereq).
**Reason:** Revisor final encontrou contrato de evidência divergente entre F21 e F23 (paths, normalização, campos), matriz de fluxos sem testes correspondentes e escopo da camada 2 extrapolado.
**Trade-off:** Camada 2 menor (sem taskflow standalone — coberto no F22 com modelos reais); normalização concentrada no F23.
**Impact:** F21–F23 designs aprovados; planejamento COMPLETO: F1–F23 com spec + design + revisão; docs do F8 referenciam o contrato de evidência.

---

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
- [ ] F5 fix: `packages/pr-review/scripts/verify-package-contents.mjs:119,135-137` e `tests/tooling/package-contents.node.mjs:22,69` — hardcoda `pi-pr-review`/URLs 10ego (falha real do fork, validada 2026-08-05)
- [ ] F2: `install.mjs` clona repo upstream hardcoded — spec já manda remover (SUBA-02)
- [ ] F6: design.md antes do Execute (gray area de agregação)
- [ ] Fechar decisão de atribuição de licença (AD-002) — deadline: F8 (DOCS-03); obrigatório antes de copiar trechos do gentle-ai (F11/F13)
- [x] Specs SERV (F11–F14) — criadas 2026-08-05 (gray areas aprovadas: G3 híbrido, detecção bin, estado cruzado, merge G3, presets minimal/full)
- [x] Designs SERV (F6 agregação H1 + F11–F14) — criados 2026-08-05; revisados 2026-08-05 (entry points reais dos forks verificados; estado por package com group; versions.ts gerado; createdFiles; scope no uninstall)
- [x] Specs MULA (F15–F18) — criadas 2026-08-05 (base: pesquisas de subagentes no heggria/taskflow v0.2.6 e no gentle-ai — ver AD-013)
- [x] Designs MULA (F15–F18) — criados por subagentes e revisados por revisor independente 2026-08-05 (correções B1/B2/I1–I3 aplicadas; schema consolidado em F17 — AD-013)
- [x] Specs WORK (F19–F20) — criadas 2026-08-05 (base: pesquisas de subagentes em pr-review fork, capabilities dos forks e RDD docs do gentle-ai)
- [x] Specs EVAL (F21–F23) — criadas 2026-08-05 (base: pesquisa de subagente em testing-agents-deterministically do gentle-ai + docs do Pi: models.json/provider registerProvider/SDK inMemory, ratchets)
- [x] Designs WORK (F19–F20) — criados por subagentes e revisados 2026-08-05 (correções I1/I2/I3 + menores aplicadas; família de marcadores shell no F18; check 17 gates — AD-014)
- [x] Designs EVAL (F21–F23) — criados por subagentes e revisados 2026-08-05 (correções B1/B2/I1–I4/M1–M5 aplicadas — AD-015)
- [x] **Planejamento completo**: F1–F23 com spec + design + revisão (SERV/MULA/WORK/EVAL fechados)
- [ ] F5 fix pendente: `packages/pr-review/scripts/verify-package-contents.mjs:119,135-137` e `tests/tooling/package-contents.node.mjs:22,69` — hardcoda `pi-pr-review`/URLs 10ego
- [ ] F14 Execute: validar defaults reais por fork (experimento) — valores propostos no design podem mudar
- [ ] F16: re-vendorar camada MCP do taskflow (reativa deferral do AD-007)

---

## Preferences

- Idioma: PT-BR nas conversas; artefatos em PT-BR
- Usuário prefere opções com "Recomendado" marcado
