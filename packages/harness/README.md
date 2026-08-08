# @runecraft/harness

Runecraft Harness — umbrella meta-package (F6). Instala os 4 forks do Pi num único comando:

| Capacidade | Package | Entry (manifest `pi`) |
| --- | --- | --- |
| Dispatch de subagentes | `@runecraft/subagents` 0.37.2 | `node_modules/@runecraft/subagents/index.ts` + `skills/` + `prompts/` |
| DAG de tarefas (`/tf`) | `@runecraft/taskflow` 0.2.6 | `node_modules/@runecraft/taskflow/dist/index.js` + `skills/` |
| Engine + DSL do taskflow (libs) | `@runecraft/taskflow-core` 0.2.6 · `@runecraft/taskflow-dsl` 0.2.6 | sem recursos `pi` (libs apenas) |
| Goal loop com auditor isolado (`/goal`) | `@runecraft/goal-loop-audit` 0.28.34 | `node_modules/@runecraft/goal-loop-audit/extensions/loops/goal.ts` |
| Code review de PRs | `@runecraft/pr-review` 1.11.4 | `node_modules/@runecraft/pr-review/extensions/index.ts` + `prompts/` |

Os forks são empacotados via `bundledDependencies`; o manifest `pi` referencia os recursos deles por paths `node_modules/@runecraft/*` (padrão de meta-package documentado em docs/packages.md do Pi). Versões pinadas em `vendor.manifest.json` (fonte única — F10).

**Agentes não-Pi gerenciados (matriz F17/F31):** o CLI do harness
(`install/status/doctor/sync/uninstall --agent <id>`) também gerencia
agentes não-Pi no padrão F15 (detect/inject/remove + coluna na matriz):
Claude Code (`claude-code`), OpenCode (`opencode`), Codex (`codex`) e
**Copilot (VS Code)** (`copilot`; aliases `vscode`/`vscode-copilot`/
`github-copilot` — F31). O Copilot recebe rules repo-scoped em
`.github/copilot-instructions.md` + MCP em `.vscode/mcp.json`
(`servers.taskflow`, host reusado `@runecraft/taskflow-claude`). Detalhes e
two-driver com o gentle-ai em `docs/ROUTING.md` §8.12.

**Papéis objetivos (F32):** o harness entrega 7 papéis profissionais como
agentes-dados materializados em `<cwd>/.pi/agents/` via `harness install`/`sync`
(escopo projeto; three-way por conteúdo — edições do usuário preservadas):

| Papel | Identidade | Tools (allowlist) | Delegação |
| --- | --- | --- | --- |
| planner | planos apenas (nunca implementa) | read, grep, find, ls, intercom | nunca |
| builder | executa o plano, verifica antes de reportar | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | ÚNICO: scout + reviewer |
| reviewer | veredito `[APPROVE]/[REJECT]` + ≤3 blocking issues (read-only) | read, grep, find, ls, bash, intercom | nunca |
| auditor | auditoria de conformidade (write só `.md` — guard F24) | read, grep, find, ls, bash, write, intercom | nunca |
| scout | recon read-only, reporta no retorno | read, grep, find, ls, intercom | nunca |
| researcher | pesquisa externa com fontes (read-only) | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | nunca |
| security | revisão de segurança read-only (triage + fast-exit) | read, grep, find, ls, bash, intercom | nunca |

Os papéis shadowam os builtins homônimos do fork (planner/reviewer/scout/
researcher — compatível+endurecido) e são consumíveis por
`state.models.agents.<id>.fallbackChain` (F30). Detalhes em
`docs/ROUTING.md` §8.13.

**Nota sobre deps compartilhadas:** npm não instala deps transitivas de pacotes bundled. Por isso as deps de runtime não-peer dos forks (jiti/yaml do subagents, typescript do taskflow-dsl) são declaradas como `dependencies` regulares deste package — o npm as baixa do registry no `pi install`. O `prepack` materializa cópias reais dos 6 forks em `node_modules/@runecraft/*` antes do pack (os symlinks do bun geram paths `..` no tarball).

## Instalação

```bash
pi install npm:@runecraft/harness     # global
pi install npm:@runecraft/harness -l  # projeto local (.pi/settings.json)
```

Uma sessão Pi nova carrega as extensões dos 4 forks: `/tf`, `/goal`, `subagent({action:"list"})` e o comando de pr-review respondem na mesma sessão.

## Settings

Cada fork traz seus próprios defaults e docs (`subagents.defaultModel`, modelo do auditor do goal-loop-audit, budgets do taskflow…). O bloco `settings.json` recomendado cobrindo os 4 packages (merge de defaults) é entregue pelo CLI do harness (F14 — `.specs/features/f14-settings-merge`).

## Verificação (doctor)

A sequência de doctor documentada é entregue pelo CLI do harness (F12 — `.specs/features/f12-lifecycle`). Checagem manual equivalente:

```bash
pi list                                   # mostra @runecraft/harness
pi -p "/tf --help"                        # taskflow responde
pi -p "/goal status"                      # goal-loop-audit responde
pi -p "subagent({action:'list'})"         # subagents responde
pi -p "/pr-review --help"                 # pr-review responde
```

## Aviso de colisão

Não instale junto com os upstreams originais (`pi-subagents`, `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) — comandos/tools duplicam. Remova os upstreams antes de instalar o harness.

## Roadmap

- F11 — CLI do harness (`bin/harness.ts`: install/doctor/status/sync/uninstall)
- F12 — lifecycle (doctor/status)
- F14 — settings merge (defaults por componente)
