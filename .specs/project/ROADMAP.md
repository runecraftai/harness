# Roadmap

**Current Milestone:** M5 — Evals & Guarantees (F22/F23) · **M7 — Garantias** em andamento
**Status:** F24 COMPLETE (2026-08-07; 398 testes; cleric APPROVE + 1 fix) — **Próximo: F25 Verification Cascade** (P1 desbloqueada por AD-022; judge LLM env-gated) · F22 E2E **aguardando aprovação explícita do usuário (custo de tokens)** · F23 P1 desbloqueada (AD-022)

Dependency chain: **F1 → {F2–F5} → F6 → F7** · **F11 → {F12, F13, F14}** · **{F15, F16} → F17 → F18** · **F19 → F20** · **{F21, F22} → F23** · **F8 → F9** · F10 ∥ F7 · **{F15, F20, F21} → F24 → F25** · **{F21, F24} → {F26, F27}** · **{F13, F21} → {F28, F29}** · **{F15, F17, F24} → F30** · **{F15, F16, F17} → F31** · **{F24, F30} → F32** · **{F19, F27, F30, F32} → F33**

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
- 545 testes do upstream passando; `/goal`, `/list`, `/loop` funcional; auditor isolado spawna
- Validado 2026-08-05: 604/607 pass (2 falhas: pré-existente upstream + ambiente git-untracked)
- **Prereq:** F1

**F5 — Fork @runecraft/pr-review** — COMPLETE

- Copiar pi-pr-review 1.11.4; rename para `@runecraft/pr-review`
- Testes passando; review paralelo dispara contra um PR de teste
- Validado 2026-08-05: bun test 243/245 (2 falhas pré-existentes upstream em pi-tui/matchesKey); fix REAL do fork aplicado (verify-package-contents + package-contents — hardcodes pi-pr-review/10ego eliminados, test:tooling 20/20)
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

## M3 — Multi-Agent Layer — ✅ COMPLETE (2026-08-07)

**Goal:** Pegada gentle-ai: servir agentes não-Pi com matriz de componentes honesta — fail-closed, detect-only para o que não suportamos, sem duplicar mecanismos nativos.

### Features

**F15 — Adapters v1 (Claude Code, OpenCode, Codex)** — COMPLETE (2026-08-07; cleric APPROVE; 203 testes) — Prereq: F11

- Detecção, dirs de config, injecção e remoção por agente; fail-closed quando ausente
- Pi é nativo (F2–F5); agentes sem adapter = detect-only com guia (padrão gentle-ai/Hermes)

**F16 — Camada MCP do taskflow (re-vendor)** — COMPLETE (2026-08-07; cleric APPROVE; 184 testes) — Prereq: F1

- Re-vendorar taskflow-mcp-core + taskflow-hosts + adapters codex/claude/opencode/grok (deferral do AD-007 reativado — AD-009)
- Componente cross-agent que dá DAG/FlowIR aos não-Pi

**F17 — Matriz de componentes por agente** — COMPLETE (2026-08-07; cleric APPROVE após 2 rodadas; 226 testes) — Prereq: F15, F16

- Pi: 4 forks (full) · Claude Code/OpenCode/Codex: taskflow-MCP + regras de workflow (routing/review) + pr-review via gh
- subagents e goal-loop-audit permanecem Pi-only (extensões Pi)

**F18 — Coexistência multi-agente** — COMPLETE (2026-08-07; cleric APPROVE + 1 fix; 246 testes) — Prereq: F17

- Detectar upstreams (pi-subagents, gentle-pi…) e reportar colisão sem sobrescrever
- Overlay own vs. config do usuário (herança da filosofia gentle-ai)

---

## M4 — Workflow & Receipt — ✅ COMPLETE (2026-08-07)

**Goal:** O harness vira mental model: roteamento explícito entre as capacidades e entrega validada por receipt leve (conceito RDD simplificado).

### Features

**F19 — Routing & mental model** — COMPLETE (2026-08-07; cleric APPROVE + 2 fixes; 272 testes) — Prereq: F7

- Trigger rules do harness: goal loop vs taskflow vs subagent direto vs review; two-driver como limite conhecido
- Hello world SDLC (F7) como intended-usage do produto
- Validado: ROUTING.md canônico (10 seções, inglês) + template injetável renderRules por coluna da matriz (golden test render == apêndice; ausência no não-Pi) + driver ativo no status/doctor (ledger do glla) + sync three-way

**F20 — Receipt leve (delivery gates)** — COMPLETE (2026-08-07; cleric APPROVE + 3 fixes; 330 testes) — Prereq: F19

- pr-review como engine de review; gates pre-commit/pre-push validam o mesmo resultado
- Sem authority store/threat model (versão completa fica em Future)
- Validado: receipt estrito append-only (capture RPC/--from com diff_hash canônico) + hooks shell fail-closed (sem receipt/drift nega; off exit 0) + kill switch global + check 17 + uninstall preservando pré-existentes

---

## M5 — Evals & Guarantees

**Goal:** Nossos evals garantem o harness: suite determinística sem modelos reais + cenários E2E versionados + ratchet de não-regressão (pegada `bench/` + baselines do gentle-ai).

### Features

**F21 — Suite determinística (fixture de modelo)** — COMPLETE (2026-08-07; cleric APPROVE + 1 fix; 348 testes) — Prereq: F7, F11

- Valida install/sync/assets e respostas de agentes com fixture (estilo `testing-agents-deterministically.md` do gentle-ai)
- Roda em CI sem tokens
- Validado: `test/eval/` 2 camadas (layer1 smoke subprocess + layer2 fluxos SDLC com fixture OpenAI-wire SSE adversarial) + EVAL-MATRIX aditivo (EVAL-001/002/004/005/005b) + evidência JSON p/ F23; 18 testes novos, zero regressão (330→348); offline/$0 por construção; devDep do SDK 0.81.0 (AD-021)

**F22 — Cenários E2E versionados** — PLANNED — **aguardando aprovação explícita do usuário (custo de tokens)** — Prereq: F7, F19, F21 (spec)

- Evolução do `scenarios.md` do F7 em benchmark versionado com modelos reais e resultados datados

**F23 — Ratchet baselines** — PLANNED — Prereq: F21, F22

- Baselines de não-regressão (estilo `.refusal-ratchet-baseline` / `.guard-population-baseline`)

---

## M7 — Garantias (Guarantee Pillars)

**Goal:** Determinismo de execução e saída como camadas do harness (pilares 3–7 das referências): guards do guild portados como extensões Pi com **bloqueio real de tool_call** (`{ block: true }`), cascata de verificação com limiares em código, evals do guild portados (offline/$0), resiliência, observabilidade e memória persistente. Prioridade do usuário (decisão 4): M5 fecha (F23) → pilares de garantia → expansão multi-agente (M8). Offline/$0 por construção; custo de tokens só onde env-gated explícito (padrão F22).

### Features

**F24 — Execution Guards (tool_call blocking)** — **COMPLETE (2026-08-07; 398 testes; cleric APPROVE + 1 fix a161e10)** — Prereq: F15 ✓, F20 ✓, F21 ✓

- Port dos guards determinísticos do guild como extensões Pi: `write-existing-file-guard`, `ranger-md-only`, `todo-description-override`, `todo-continuation-enforcer` (+ helper `todo-writer`) — o que no OpenCode era sugestão de prompt vira **bloqueio real** (`tool_call` → `{ block: true, reason }`)
- Denial gates + kill switch (padrão F20), config via state/settings (F13/F14), fail-closed por padrão; guards Pi-only (matriz honesta F17)
- Testes determinísticos offline/$0 na infra do F21 (fixture + materialização de extensões) + EVAL-006/007 na matriz; evidência JSON alimenta o ratchet do F23
- **Verificado:** sobrescrever arquivo existente em sessão Pi com fixture → tool bloqueado com reason (EVAL-006, alvo intacto); desvio induzido → falha do teste com diagnóstico; EVAL-007 override real no ledger + block em complete_goal; 397→398 testes (fix cleric stale taskList); zero regressão nos EVAL-001/002/004/005

**F25 — Verification Cascade (determinismo de saída)** — PLANNED — Prereq: F24, F21 ✓ (judge LLM env-gated — padrão F22)

- Cascata cheap→expensive: estrutural → integridade de arquivo → suficiência de mudança → fidelidade de embedding → judge LLM **só** na zona cinza entre limiares; **decisão de escalar é sempre código com limiares explícitos** (decisão 3c), nunca a LLM
- Port de `verification-reminder` → gate de verificação; RETRY/SKIP/HALT + cost caps; judge LLM env-gated (fora do merge gate)

**F26 — Eval Framework Port (evals do guild)** — PLANNED — Prereq: F21 ✓, F24

- Port do runner/loader/reporter/storage/schema/targets/executors + os 11 evaluators (`contains-all`, `contains-any`, `excludes-all`, `section-contains-all`, `ordered-contains`, `xml-sections-present`, `tool-policy`, `min-length`, `llm-judge`, `baseline-diff`, `trajectory-assertion`) + estrutura suites/cases/scenarios
- Dona das 5 categorias do eval-coverage do arcanum: constraint adherence (sujeitos = guards F24), compaction recovery (F27), model failover (F30); tool-use correctness e routing completeness ganham casos após o F32 (agentes)

**F27 — Resilience & Continuity** — PLANNED — Prereq: F21 ✓, F24

- Port: `compaction-recovery`, `compaction-todo-preserver`, `work-continuation`, `start-work-hook` (continuação pós-compaction, re-injeção de tarefa pendente)
- Stall detection (não só timeout/rate-limit), fallback chains multi-trigger, classificação de falha agente-vs-infra, política de escalação (pilar 6)

**F28 — Observability & Lessons** — PLANNED — Prereq: F13 ✓, F21 ✓

- Typed event store + harness bundles (fingerprint hash de config/prompts) + cognition lessons (trigger/anti-pattern/pattern preferido/prioridade, promoção a memória de time)
- Port: `context-window-monitor`, `session-token-state`, recorder de analytics do guild (`.guild/analytics` → event store)

**F29 — Memory (runes → Pi)** — PLANNED — Prereq: F13 ✓, F21 ✓

- Port de `packages/runes` (SQLite via `bun:sqlite`; db/lib/plugin/tools/config/bin) com os 10 agent tools como tools Pi; memória cross-session via mecanismos do Pi (appendEntry) + state do F13
- Engram é fallback **somente** se runes for inviável (decisão 6)

---

## M8 — Pi First-Class & Multi-Agent Expansion

**Goal:** Pi vira cidadão de primeira classe (persona objetiva, roteamento de modelo por agente, assets SDD), adapters crescem (copilot/vscode), os 8 agentes RPG do guild viram papéis profissionais objetivos e o roteamento vira código (decisões 1 e 2). Expansão só depois das garantias (decisão 4).

### Features

**F30 — Pi First-Class & SDD Assets** — PLANNED — Prereq: F15 ✓, F17 ✓, F24

- Persona objetiva do Pi (system prompt/AGENTS.md); port de `rules-injector` (before_agent_start) e `first-message-variant`; roteamento de modelo por agente (port de `model-resolution`, per-agent models)
- Assets SDD: templates de spec, prompt templates, chains (reuso do flow-orchestrator do familiar); `guild_archive_plan` → arquivamento de planos

**F31 — Copilot/VSCode Adapter** — PLANNED — Prereq: F15 ✓, F16 ✓, F17 ✓

- Adapter novo no padrão F15 (`AgentAdapter`): detecção, injecção (AGENTS.md / `.github/copilot-instructions.md`) + MCP taskflow, fail-closed, detect-only; coluna nova na matriz (F17)

**F32 — Objective Role Agents** — PLANNED — Prereq: F24, F30

- Port dos 8 agentes RPG → papéis objetivos: planner (wizard), builder (fighter), reviewer (cleric), auditor (ranger), scout (rogue), researcher (warlock), security (paladin); bard = lógica de orquestração → F33 (não vira subagente)
- Infra de agentes: prompt-loader/prompt-utils/dynamic-prompt-builder/agent-builder/custom-agent-factory/builtin-agents; review-orchestrator/review-resolver/review-model-variants (reviewer); `guild_spawn_wizard` → delegação via prompt template

**F33 — Coded Routing & Pilot Coordination** — PLANNED — Prereq: F19 ✓, F27, F30, F32

- Port de `keyword-detector` (input → roteamento codificado), lógica de orquestração do bard, workflow engine do guild → chains/prompt templates; `call_guild_agent` → tool `subagent` nativa (F2)
- Two-driver rules (F7/F19) + fallback chains (F27) + roteamento de modelo por agente (F30)

---

## M6 — Public Release

**Goal:** Publicável no npm com docs estilo gentle-ai e pipeline. **Paralelo ao M7/M8** — não depende das garantias.

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
