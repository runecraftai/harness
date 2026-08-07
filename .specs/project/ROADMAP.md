# Roadmap

**Current Milestone:** M3 — Multi-Agent Layer
**Status:** In Progress (M1 ✅ · M2 ✅)

Dependency chain: **F1 → {F2–F5} → F6 → F7** · **F11 → {F12, F13, F14}** · **{F15, F16} → F17 → F18** · **F19 → F20** · **{F21, F22} → F23** · **F8 → F9** · F10 ∥ F7

---

## M1 — Foundation (forks buildando) — ✅ COMPLETE (2026-08-06)

**Goal:** Monorepo existe e os 4 forks buildam, testam e carregam no Pi individualmente.
**Target:** Cada pacote instala via path local (`pi install <dir>`) e se comporta igual ao upstream.

### Features

**F1 — Monorepo Scaffold** — COMPLETE

- Workspaces + Turborepo + Biome + tsconfig base (convenções arcanum) — install/lint/build verdes
- Estrutura `packages/{subagents,taskflow/{core,pi,dsl},goal-loop-audit,pr-review,harness}`
- Vendoring por GitHub source tarball (não npm — npm não traz testes), 6 pins verificados, proveniência em vendor.json
- Verificado: SCAF-01..06; pi-subagents 0.37.2 vendorado como seed do F2
- **Prereq:** none

**F2 — Fork @runecraft/subagents** — COMPLETE

- Copiar pi-subagents 0.37.2; rename para `@runecraft/subagents`
- Ajustar auto-referências internas (imports `pi-subagents/*`, nomes de eventos/env se acoplados ao nome)
- Testes do upstream passando; extensão carrega no Pi; `subagent({action:"list"})` funcional
- **Prereq:** F1

**F3 — Fork @runecraft/taskflow (core + pi + dsl)** — COMPLETE

- Copiar taskflow-core + pi-taskflow + taskflow-dsl do monorepo heggria/taskflow 0.2.6
- Estrutura espelhada: `packages/taskflow/{core,pi,dsl}` → `@runecraft/taskflow-core`, `@runecraft/taskflow`, `@runecraft/taskflow-dsl`
- Camada MCP excluída no fork — **reavaliada em F16 (AD-009)**
- Testes relevantes passando; `/tf` funcional no Pi; DSL compila `.tf.ts` → JSON aceito pelo core
- **Prereq:** F1

**F4 — Fork @runecraft/goal-loop-audit** — COMPLETE

- Copiar pi-goal-list-loop-audit 0.28.34; rename para `@runecraft/goal-loop-audit`
- 545 testes do upstream passando; `/goal`, `/list`, `/loop` funcionais; auditor isolado spawna
- Validado 2026-08-05: 604/607 pass (2 falhas: pré-existente upstream + ambiente git-untracked)
- **Prereq:** F1

**F5 — Fork @runecraft/pr-review** — COMPLETE

- Copiar pi-pr-review 1.11.4; rename para `@runecraft/pr-review`
- Testes passando; review paralelo dispara contra um PR de teste
- Validado 2026-08-06: bun test 243/245 (2 falhas pré-existentes upstream em pi-tui/matchesKey); fix REAL do fork aplicado (verify-package-contents + package-contents — hardcodes pi-pr-review/10ego eliminados, test:tooling 20/20)
- **Prereq:** F1

---

## M2 — Harness Service — ✅ COMPLETE (2026-08-07)

**Goal:** Umbrella instalável por um comando + serving layer estilo gentle-ai em TS (sem binário Go): CLI `npx`, doctor, sync, uninstall, estado e backup — os 4 forks como "components" selecionáveis.

### Features

**F6 — Umbrella @runecraft/harness** — COMPLETE — Prereq: F2–F5

- Package que agrega os 4 como dependencies e expõe manifest `pi` unificado
- `pi install npm:@runecraft/harness` (ou path local) traz tudo
- Validado 2026-08-06: meta-package H1 (bundledDeps + manifest via node_modules/), prepack hermético, install local + tarball real + sessão Pi headless com os 4 forks; cleric APPROVE + 3 fixes (AD-016)

**F7 — Coexistence Validation** — COMPLETE — Prereq: F6

- Matriz de conflito validada ao vivo: goal-loop-audit + subagents na mesma sessão (two-driver rule)
- taskflow rodando DAG enquanto goal ativo; pr-review usando nosso subagents
- Smoke test E2E: sessão Pi com os 4 carregados, um fluxo SDLC completo
- Validado 2026-08-06: COEX-01..06 PASSA; hello world SDLC documentado; `scenarios.md` versionado; 2 bugs reais do taskflow registrados (BUG-1 import dinâmico, BUG-2 dist/agents/)

**F11 — CLI @runecraft/harness** — COMPLETE — Prereq: F6

- CLI TS via `npx` (sem Go) + comando Pi `/harness`: `install` com detecção de agentes e fail-closed (recusa e nomeia o comando exato), `--component`, presets (`minimal`/`full`), `--dry-run`
- Validado 2026-08-06: dispatch(argv,ctx) testável com RUNECRAFT_PI_BIN; 43 testes; cleric APPROVE (AD-016)
- Referência de design: gentle-ai (`usage.md`, `pi.md`); trechos MIT com atribuição (AD-002)

**F12 — Lifecycle: doctor / status / sync / uninstall** — COMPLETE — Prereq: F11

- `doctor` read-only: agentes detectados, packages carregam, settings válidos, colisões com upstreams
- `sync` idempotente (reconcilia assets pós-upgrade); `uninstall` remove só o gerenciado
- Validado 2026-08-06: 6 checks read-only (loadStateReadonly), tabela cruzada + /harness real, sync reinstala conforme state; cleric APPROVE (AD-016)

**F13 — Estado + backups** — COMPLETE — Prereq: F11

- `state.json` global (`~/.runecraft/`) com `--scope=workspace` opcional
- Snapshot tar.gz (dedupe/prune) antes de modificar qualquer config
- Validado 2026-08-07: schema v1 aditivo (agents do F17 preservados), dedupe por hash, prune 5+pins, statvfs fail-safe, restore fail-closed; cleric APPROVE (AD-016)

**F14 — Settings merge real** — COMPLETE — Prereq: F11

- Aplicação programática dos defaults via merge por overlay; conflito reportado, nunca clobber
- Validado 2026-08-07: experimento de defaults contra source dos forks (subagents/taskflow v1; pr-review/glla sem defaults — AD-012/AD-016); two-pass SETM-04; 168 testes no harness

---

## M3 — Multi-Agent Layer

**Goal:** Pegada gentle-ai: servir agentes não-Pi com matriz de componentes honesta — fail-closed, detect-only para o que não suportamos, sem duplicar mecanismos nativos.

### Features

**F15 — Adapters v1 (Claude Code, OpenCode, Codex)** — COMPLETE (2026-08-07; cleric APPROVE; 203 testes) — Prereq: F11

- Detecção, dirs de config, injecção e remoção por agente; fail-closed quando ausente
- Pi é nativo (F2–F5); agentes sem adapter = detect-only com guia (padrão gentle-ai/Hermes)

**F16 — Camada MCP do taskflow (re-vendor)** — COMPLETE (2026-08-07; cleric APPROVE; 184 testes) — Prereq: F1

- Re-vendorar taskflow-mcp-core + taskflow-hosts + adapters codex/claude/opencode/grok (deferral do AD-007 reativado — AD-009)
- Componente cross-agent que dá DAG/FlowIR aos não-Pi

**F17 — Matriz de componentes por agente** — PLANNED — Prereq: F15, F16

- Pi: 4 forks (full) · Claude Code/OpenCode/Codex: taskflow-MCP + regras de workflow (routing/review) + pr-review via gh
- subagents e goal-loop-audit permanecem Pi-only (extensões Pi)

**F18 — Coexistência multi-agente** — PLANNED — Prereq: F17

- Detectar upstreams (pi-subagents, gentle-pi…) e reportar colisão sem sobrescrever
- Overlay own vs. config do usuário (herança da filosofia gentle-ai)

---

## M4 — Workflow & Receipt

**Goal:** O harness vira mental model: roteamento explícito entre as capacidades e entrega validada por receipt leve (conceito RDD simplificado).

### Features

**F19 — Routing & mental model** — PLANNED — Prereq: F7

- Trigger rules do harness: goal loop vs taskflow vs subagent direto vs review; two-driver como limite conhecido
- Hello world SDLC (F7) como intended-usage do produto

**F20 — Receipt leve (delivery gates)** — PLANNED — Prereq: F19

- pr-review como engine de review; gates pre-commit/pre-push validam o mesmo resultado
- Sem authority store/threat model (versão completa fica em Future)

---

## M5 — Evals & Guarantees

**Goal:** Nossos evals garantem o harness: suite determinística sem modelos reais + cenários E2E versionados + ratchet de não-regressão (pegada `bench/` + baselines do gentle-ai).

### Features

**F21 — Suite determinística (fixture de modelo)** — PLANNED — Prereq: F7, F11

- Valida install/sync/assets e respostas de agentes com fixture (estilo `testing-agents-deterministically.md` do gentle-ai)
- Roda em CI sem tokens

**F22 — Cenários E2E versionados** — PLANNED — Prereq: F7, F19

- Evolução do `scenarios.md` do F7 em benchmark versionado com modelos reais e resultados datados

**F23 — Ratchet baselines** — PLANNED — Prereq: F21, F22

- Baselines de não-regressão (estilo `.refusal-ratchet-baseline` / `.guard-population-baseline`)

---

## M6 — Public Release

**Goal:** Publicável no npm com docs estilo gentle-ai e pipeline.

### Features

**F8 — Docs** — PLANNED — Prereq: F7, F19

- README por pacote (adaptado, sem lore) + README raiz do harness
- Estrutura estilo gentle-ai: quickstart, intended-usage, matriz de agents, troubleshooting

**F9 — Publishing Pipeline** — PLANNED — Prereq: F8

- Changesets/versioning, npm publish sob org @runecraft; lane CI dos evals (F21)

**F10 — Upstream Sync Workflow** — PLANNED — Prereq: F7

- Processo documentado: diff upstream → aplicar → re-testar (script `sync-upstream`), incluindo camada MCP (F16)

---

## Future Considerations

- TUI própria despachando ações via Pi como server (estilo OpenCode)
- Installer standalone que instala o próprio Pi (`npx @runecraft/harness init`)
- Sandbox OS-level (reavaliar pi-landstrip ou fork parcial do sandbox)
- Adaptadores adicionais: Gemini CLI, Cursor, Windsurf, Kiro
- Roadmap comunitário vivo (issues com labels up-for-grabs / status:approved) ao abrir o repo
- RDD completo (authority store + threat model) se o receipt leve (F20) provar insuficiente
- Melhorias próprias sobre os forks (é o motivo do fork — controle de evolução)
