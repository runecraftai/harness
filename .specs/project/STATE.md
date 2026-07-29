# State

**Last Updated:** 2026-07-29
**Current Work:** F1 COMPLETE. Specs de F2–F10 escritas (`.specs/features/f*/spec.md`) com fatos verificados dos upstreams. Próximo: Execute F2 — Fork @runecraft/subagents.
**Specs criadas:** F2 (SUBA, Medium), F3 (TFLW, Large — 3 pkgs + workspace dep), F4 (GLLA, Medium), F5 (PREV, Medium — dispatch a mapear), F6 (UMBR, Large — **design.md obrigatório**: mecanismo de agregação de extensões Pi, hipóteses H1/H2/H3), F7 (COEX, Medium — two-driver é o risco central), F8 (DOCS), F9 (PUBL), F10 (SYNC — three-way merge sobre vendor.json).

### Handoff

- **Done:** F1 — toolchain (bun workspaces com glob duplo, turbo, biome, tsconfig base) + `scripts/vendor.ts` + `vendor.manifest.json` com 6 pins verificados (tags reais; goal-loop-audit pinado por SHA `21b6bb0` = 0.28.34, repo sem tags). pi-subagents 0.37.2 vendorado (com test/{unit,integration,e2e}, sem .git).
- **Next PLANNED:** F2 — Fork @runecraft/subagents. Prereq F1 ✓. Passos: rename `pi-subagents` → `@runecraft/subagents` (package.json + auto-referências internas `pi-subagents/*` em imports/eventos/env), rodar suite de testes do upstream, validar carga no Pi.
- **Atenção F2:** upstream tem `install.mjs` (postinstall bloqueado pelo bun — revisar o que faz), package-lock.json do npm (remover? bun usa bun.lock), e o manifest `pi` aponta `./index.ts`.
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

---

## Active Blockers

None.

---

## Lessons Learned

- Catálogo pi.dev tem ~111 pacotes de subagents/workflow; a densidade de sobreposição é alta — análise de conflito antes de compor é obrigatória (two-driver rule do goal-loop-audit é o exemplo canônico).
- pi-taskflow vive num monorepo (heggria/taskflow) com 9 packages; o fork extrai taskflow-core + pi-taskflow + taskflow-dsl (AD-007).
- Tarball do npm não contém testes (só `files` declarados) — vendoring usa GitHub source tarball no ref pinado (já vem sem .git).
- `Bun.write(file, Response)` trava com codeload.github.com — usar `arrayBuffer()` explícito antes do write.
- DraconDev/pi-goal-list-loop-audit não usa tags git — pin por SHA resolvido manualmente (21b6bb0 = 0.28.34).

---

## Deferred Ideas

- [ ] Camada MCP do taskflow (cross-agent: Codex, Claude Code, OpenCode, Grok)
- [ ] TUI própria (Pi como server) — estilo OpenCode
- [ ] Installer standalone que instala o próprio Pi
- [ ] Sandbox OS-level (fork parcial do landstrip compatível com nosso subagents)
- [ ] Melhorias próprias nos forks (raison d'être do fork)

---

## Todos

- [x] Specify F1 (Monorepo Scaffold) — COMPLETE 2026-07-29
- [x] Specs F2–F10 — COMPLETE 2026-07-29
- [ ] F2: `install.mjs` clona repo upstream hardcoded — spec já manda remover (SUBA-02)
- [ ] F6: design.md antes do Execute (gray area de agregação)
- [ ] Fechar decisão de atribuição de licença (AD-002) — deadline: F8 (DOCS-03)

---

## Preferences

- Idioma: PT-BR nas conversas; artefatos em PT-BR
- Usuário prefere opções com "Recomendado" marcado
