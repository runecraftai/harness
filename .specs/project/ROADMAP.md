# Roadmap

**Current Milestone:** M1 — Foundation
**Status:** In Progress

Dependency chain: **F1 → {F2, F3, F4, F5} → F6 → F7 → M3**

---

## M1 — Foundation (forks buildando)

**Goal:** Monorepo existe e os 4 forks buildam, testam e carregam no Pi individualmente.
**Target:** Cada pacote instala via path local (`pi install <dir>`) e se comporta igual ao upstream.

### Features

**F1 — Monorepo Scaffold** — COMPLETE

- Workspaces + Turborepo + Biome + tsconfig base (convenções arcanum) — install/lint/build verdes
- Estrutura `packages/{subagents,taskflow/{core,pi,dsl},goal-loop-audit,pr-review,harness}`
- Vendoring por GitHub source tarball (não npm — npm não traz testes), 6 pins verificados, proveniência em vendor.json
- Verificado: SCAF-01..06; pi-subagents 0.37.2 vendorado como seed do F2
- **Prereq:** none

**F2 — Fork @runecraft/subagents** — PLANNED

- Copiar pi-subagents 0.37.2; rename para `@runecraft/subagents`
- Ajustar auto-referências internas (imports `pi-subagents/*`, nomes de eventos/env se acoplados ao nome)
- Testes do upstream passando; extensão carrega no Pi; `subagent({action:"list"})` funcional
- **Prereq:** F1

**F3 — Fork @runecraft/taskflow (core + pi + dsl)** — PLANNED

- Copiar taskflow-core + pi-taskflow + taskflow-dsl do monorepo heggria/taskflow 0.2.6
- Estrutura espelhada: `packages/taskflow/{core,pi,dsl}` → `@runecraft/taskflow-core`, `@runecraft/taskflow`, `@runecraft/taskflow-dsl`
- Excluir camada MCP (taskflow-mcp-core, taskflow-hosts, codex/claude/opencode/grok adapters)
- Testes relevantes passando; `/tf` funcional no Pi; DSL compila `.tf.ts` → JSON aceito pelo core
- **Prereq:** F1

**F4 — Fork @runecraft/goal-loop-audit** — PLANNED

- Copiar pi-goal-list-loop-audit 0.28.34; rename para `@runecraft/goal-loop-audit`
- 545 testes do upstream passando; `/goal`, `/list`, `/loop` funcionais; auditor isolado spawna
- **Prereq:** F1

**F5 — Fork @runecraft/pr-review** — PLANNED

- Copiar pi-pr-review 1.11.4; rename para `@runecraft/pr-review`
- Testes passando; review paralelo dispara contra um PR de teste
- **Prereq:** F1

---

## M2 — Harness Integration

**Goal:** Os 4 pacotes instalados juntos por um comando, coexistindo sem conflito.

### Features

**F6 — Umbrella @runecraft/harness** — PLANNED — Prereq: F2–F5

- Package que agrega os 4 como dependencies e expõe manifest `pi` unificado
- `pi install npm:@runecraft/harness` (ou path local) traz tudo
- Settings default documentados (models por role, watchdog, etc.)

**F7 — Coexistence Validation** — PLANNED — Prereq: F6

- Matriz de conflito validada ao vivo: goal-loop-audit + subagents na mesma sessão (two-driver rule)
- taskflow rodando DAG enquanto goal ativo; pr-review usando nosso subagents
- Smoke test E2E: sessão Pi com os 4 carregados, um fluxo SDLC completo

---

## M3 — Public Release

**Goal:** Publicável no npm com docs e pipeline.

### Features

**F8 — Docs** — PLANNED — Prereq: F7

- README por pacote (adaptado, sem lore) + README raiz do harness

**F9 — Publishing Pipeline** — PLANNED — Prereq: F8

- Changesets/versioning, npm publish sob org @runecraft

**F10 — Upstream Sync Workflow** — PLANNED — Prereq: F7

- Processo documentado: diff upstream → aplicar → re-testar (script `sync-upstream`)

---

## Future Considerations

- Camada MCP do taskflow (cross-agent: Codex, Claude Code, OpenCode, Grok) — vendorar quando cross-agent virar milestone
- TUI própria despachando ações via Pi como server (estilo OpenCode)
- Installer CLI standalone (`npx @runecraft/harness init` instalando o próprio Pi)
- Sandbox OS-level (reavaliar pi-landstrip ou fork parcial do sandbox)
- Melhorias próprias sobre os forks (é o motivo do fork — controle de evolução)
