# Runecraft Harness

**Vision:** Um harness multi-agente completo para o Pi coding agent — dispatch de subagentes, workflows DAG verificáveis, loops de goal com auditor isolado e code review paralelo, distribuídos como pacotes `@runecraft/*` instaláveis juntos.
**For:** Desenvolvedores que praticam o SDLC no dia a dia com agentes de código (spec → implement → verify → review).
**Solves:** Hoje essas capacidades existem espalhadas em pacotes de terceiros com autores, ritmos e convenções diferentes. O harness consolida os melhores em um monorepo único, com namespace próprio, qualidade uniforme e evolução controlada por nós.

## Goals

- Fork funcional dos 4 pacotes base publicável sob `@runecraft/*` — cada um builda, testa e carrega no Pi igual ao upstream
- Umbrella `@runecraft/harness` que instala e configura os 4 de uma vez (`pi install npm:@runecraft/harness`)
- Zero conflito entre os pacotes rodando juntos na mesma sessão Pi (validado, não presumido)
- Processo de sync com upstream documentado e executável (assumimos o custo de manter)

## Tech Stack

**Core:**

- Runtime alvo: Pi coding agent (`@earendil-works/pi-coding-agent`) — extensões carregadas como TS/JS
- Language: TypeScript (ESM), Node.js ≥ 22.19
- Monorepo: workspaces + Turborepo, Biome (mesmas convenções do arcanum)

**Key dependencies:** `@earendil-works/pi-coding-agent` (+ pi-tui, pi-agent-core) como peers; cada fork mantém as deps do upstream.

## Packages

| Package | Upstream (versão no fork) | Função |
| --- | --- | --- |
| `@runecraft/subagents` | pi-subagents 0.37.2 (nicobailon) | Dispatch: builtins, chains, parallel, acceptance gates, intercom, worktrees, watchdog |
| `@runecraft/taskflow-core` | taskflow-core 0.2.6 (heggria/taskflow) | Engine host-neutral: DAG, FlowIR, runtime, resume/replay/recompute |
| `@runecraft/taskflow` | pi-taskflow 0.2.6 (heggria/taskflow) | Adapter Pi: `/tf`, tool, TUI de DAG, approvals |
| `@runecraft/taskflow-dsl` | taskflow-dsl 0.2.6 (heggria/taskflow) | Authoring TS compile-time (`.tf.ts` → Taskflow JSON) |
| `@runecraft/goal-loop-audit` | pi-goal-list-loop-audit 0.28.34 (DraconDev) | Goal/List/Loop com auditor isolado + regression_shield |
| `@runecraft/pr-review` | pi-pr-review 1.11.4 (10ego) | Code review paralelo de PRs com subagentes em tiers |
| `@runecraft/harness` | — (novo) | Umbrella: instala os 4, settings default, wiring |

## Scope

**v1 includes:**

- Monorepo scaffold (workspaces, turbo, biome, tsconfig)
- Fork dos 4 pacotes com namespace `@runecraft/*`, build/test verdes
- Umbrella package com instalação única
- Validação de coexistência (sem conflito two-driver, auditor funciona com nosso subagents)
- Docs mínimas por pacote + processo de sync upstream

**Explicitly out of scope:**

- TUI própria para despachar ações (futuro — Pi como server)
- Installer CLI standalone (o umbrella cobre)
- Lore RPG / agentes temáticos
- pi-landstrip (dispatch conflita com subagents), pi-swarm, nervous-system, pi-extensible-workflows (sobreposição)
- Hosts MCP do taskflow para Codex/Claude Code/OpenCode/Grok (só o adapter Pi)

## Constraints

- **Upstream sync:** pacotes upstream evoluem rápido (subagents lança semanalmente); sync manual assumido como custo
- **Licenças:** upstream é MIT/Apache-2.0 — MIT exige preservar copyright notice em cópias; remoção total de atribuição é risco legal (registrado em AD-002; decisão final do owner)
- **Compatibilidade:** extensões devem carregar no Pi como o upstream carrega (mesmo manifest `pi` shape); Node ≥ 22.19
