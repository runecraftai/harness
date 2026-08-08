# F32 Design — Objective Role Agents

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-032)
**Decisões aprovadas (usuário/briefing, travadas):** agentes como DADOS (arquivos `.md` + templates — extensíveis por construção) · papéis objetivos SEM tema RPG (AD-022 decisão 2; deny-list nos evals) · bard = orquestração → F33 (não vira subagente) · zero deps novas · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v10 com notas datadas (F21 D9; v10 após F31 fechar v9 — one writer thread) · evidência via evalTest (F21) · requirement IDs ROLE-01..10 · auditor = ativação do guard F24 existente (default de config; guard intocado) · delegação via tool `subagent` (F2; observada no F28) · F33 consome os papéis (outline) · TUI fora (AD-005)

## Contexto

O harness tem garantias (M7) e agentes não-Pi (M3), mas não tem papéis objetivos: o fork `@runecraft/subagents` (F2) entrega 9 builtins genéricos (`planner/reviewer/scout/researcher/worker/oracle/advisor/context-builder/delegate`) e o guild (arcanum) tem 8 agentes RPG não portados. O roadmap F32 trava o escopo (papéis objetivos + infra de agentes + delegação via template).

**Evidência (source lido — citado):**
1. **Fork — descoberta de agentes custom**: `packages/subagents/src/agents/agents.ts` — `BUILTIN_AGENTS_DIR` (L1519), `resolveNearestProjectAgentDirs(cwd)` + `loadAgentsFromDir(dir, source)` (L1601–1653): escopos **builtin** (`<pkg>/agents`), **user** (`<agentDir>/agents` + `~/.agents`), **project** (dirs `.pi`/`.agents` acima do cwd), **package**, + chains (`.chain.md/.chain.json`). `agent-management.ts` — shadowing (L817 "shadows the builtin"), eject/override (L1003/1017/1028 — "no project config root (.pi or .agents) was found above the cwd"; projeto = `.pi/agents` ou `.agents`). RPC de gestão documentado em `skills/pi-subagents/references/management-authoring-rpc.md` (eject/disable/enable/reset). **→ o "agent-builder/custom-agent-factory/builtin-agents" do roadmap JÁ EXISTE no fork; o harness entrega DADOS (`.md`) + o que falta para render/evals.**
2. **Fork — vocabulário de tools e artefatos**: frontmatter dos 9 builtins (lido): tools = `read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, web_search, fetch_content, get_search_content`; `subagent` é tool nomeável no allowlist ("whose builtin `tools` includes `subagent`" — `prompts/review-loop.md`); artefatos `output:` (`plan.md`/`context.md`/`research.md`) existem em builtins SEM tool write (planner) → **output é gravado pelo runtime do fork, não pelo agente**; fluxos do fork restringem builtins por INSTRUÇÃO ("Reviewers must not edit files", "Do not modify files" — `prompts/review-loop.md`, `skills/pi-subagents/references/prompting-and-roles.md:76-77,161-168`).
3. **Arcanum — agentes**: `src/agents/{wizard,fighter,cleric,ranger,rogue,warlock,paladin,bard}/default.ts` (lidos) — semânticas no spec (Fatos verificados 3). **Não há scout no arcanum — rogue É o recon** (mapeamento do roadmap confirmado pela semântica). ranger = trabalhador de domínio com task intake; no harness o nome aprovado é **auditor** (AD-022 decisão 3; guard md-only assina o papel).
4. **Arcanum — infra (paths reais lidos)**: `prompt-loader.ts` (loadPromptFile — sandbox, `.md/.txt`), `prompt-utils.ts` (isAgentEnabled), `dynamic-prompt-builder.ts` (categorizeTools + buildKeyTriggersSection), `agent-builder.ts` (AGENT_NAME_VARIANTS + buildAgent), `custom-agent-factory.ts` (buildCustomAgent — name pattern, KNOWN_TOOL_NAMES, prompt inline/file/skills, resolveAgentModel), `builtin-agents.ts` (AGENT_FACTORIES 8), `model-resolution.ts` (AGENT_MODEL_REQUIREMENTS + resolveAgentModel + getNextFallbackModel — classes: bard/wizard pesado; fighter/ranger/rogue/warlock leve), `review-orchestrator.ts` (runAdditionalReviewers fan-out + collateReviews + buildFailureWarning), `review-resolver.ts` (resolveReviewers → fan-out|primary-only|disabled; base = cleric|paladin), `review-model-variants.ts` (buildReviewModelVariants de `agents.<base>.review_models` → variantes `cleric-review-<key>`), spawn-wizard (`src/tools/spawn-wizard.ts` + `src/runtime/opencode/spawn-wizard-builder.ts` + `src/application/policy/wizard-tool-policy.ts` — **path real do "guild_spawn_wizard" do briefing**; wizard não pode spawnar — `guild_spawn_wizard: false` no default.ts).
5. **F24**: `guards.rangerMdOnly.mdOnlyAgents: string[]` — default lista vazia (D5: "F32 registra o papel auditor na lista"); achado: identidade de agente não exposta no ExtensionContext → `RUNECRAFT_AGENT_ID` (propagação a validar no Execute).
6. **F30 (design aprovado — AD-030)**: D4 (`src/models/` puro; `AGENT_MODEL_REQUIREMENTS = {}`; zero IDs inventados; chains do state), D5 (`models.agents.<id>.fallbackChain`), D7 (CLI `harness models generate|list|doctor`), D11 ("F32 consome per-agent models — chains por papel objetivo via state").
7. **EVAL-MATRIX v6 atual** (F28); v7 (F29) → v8 (F30) → v9 (F31) → **v10 (F32)**; F26: categorias tool-use correctness + routing completeness bloqueadas "→ F32".
8. **F28/F21**: delegação observada = tool `subagent` (evento delegation); pr-review loop tools gated fora de `/pr-review` ativo (AD-021) → reviewer NÃO wrapper do /pr-review.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Mecanismo = `.pi/agents/*.md` (escopo projeto) — agentes como dados** (ROLE-01; QA-2a recomendado): os 7 papéis são arquivos `.md` com frontmatter do fork (`name/description/tools/thinking/acceptanceRole/systemPromptMode/output/defaultReads/defaultContext`), versionados em `packages/harness/agents/` (espelho de `packages/subagents/agents/`) e instalados/sincronizados para `<cwd>/.pi/agents/`. Mecânica de escrita: alvo novo no sync/install — copy-if-different com three-way por conteúdo (F19 D7: re-injetado/atualizado vN→vM/preservada (editada)/already in sync) + contentHash no state (F13, targets `agents.pi.targets` — mesmo padrão rules/mcp; órfãos reportados nunca removidos — F18). Descoberta = 100% do fork (zero código de runtime no harness); extensível por construção (qualquer `.md` novo no dir é descoberto — loadAgentsFromDir) | Evidência: agents.ts L1519/1601–1653 + agent-management.ts L1003/1028 (projeto `.pi`/`.agents`); o fork É o agent-builder/custom-agent-factory/builtin-agents (duplicar = reimplementar o fork — decisão do briefing "agentes como dados onde possível"); precedente F30 (assets SDD versionados no pacote); repo-scoped = padrão F17/F19/F31; shadowing por projeto = isolamento entre repos |
| D2 | **Relação com builtins: shadow compatível + 3 novos** (ROLE-03; QA-1a recomendado): **shadow** dos 4 homônimos `planner`/`reviewer`/`scout`/`researcher` (o arquivo de escopo projeto vence o bundled — mecanismo nativo L817) com definição objetiva **compatível + endurecida** (planner = compatível: builtin já é read-only com `output: plan.md` sem write; reviewer/scout/researcher = endurecimento: allowlist read-only ENFORÇA o que os fluxos do fork já pedem por instrução — "must not edit files" — e os artefatos `output:` continuam gravados pelo runtime do fork, sem tool write); **novos** `builder`/`auditor`/`security` (sem builtin homônimo); **preservados** `worker`/`oracle`/`advisor`/`context-builder`/`delegate` (sem contraparte objetiva — fluxos genéricos do fork continuam). Tabela honesta no ROUTING. **Validar no Execute**: precedência user/project > package > builtin no merge (agents.ts L1622–1632 — ordem do spread) e regressão dos fluxos do fork (review-loop/parallel-*) com os papéis shadowados | Nomes travados pelo roadmap; shadowing = mecanismo nativo (arquivo de escopo vence bundled — agent-management.ts:817/1017); artefatos de output são runtime (planner builtin prova); endurecer por allowlist = fail-closed por design (papel objetivo); não shadowar worker preserva os fluxos de escrita do fork |
| D3 | **Definições de papel = dados em `src/agents/catalog.ts` + 7 `.md`** (ROLE-02): identidade objetiva (zero RPG), tools allowlist no frontmatter (fail-closed: o que não está na lista não existe), constraints (read-only / md-only / sem delegação), delegação (allowlist inclui `subagent` só no builder — D5). `catalog.ts` é a fonte única de verdade p/ render (D4/D5) e evals (D9) e VALIDA os `.md` (frontmatter compat com o parser do fork — keys conhecidas; tools ⊆ vocabulário verificado; name == filename; deny-list RPG ausente). Papéis (semântica arcanum → harness): **planner** (wizard: planos apenas, 2 modos, clarificação; tools `read,grep,find,ls,intercom`; `acceptanceRole: read-only`; `output: plan.md`; `defaultReads: context.md`; thinking high), **builder** (fighter: executa o plano, verifica antes de reportar; tools `read,grep,find,ls,bash,edit,write,intercom,contact_supervisor,subagent`; thinking high; `defaultReads: plan.md`), **reviewer** (cleric: veredito `[APPROVE]/[REJECT]` + ≤3 blocking issues, approval bias; tools `read,grep,find,ls,bash,intercom` — read-only; thinking high), **auditor** (ranger: auditoria md-only — guard F24; tools `read,grep,find,ls,bash,write,intercom` com write restrito a `.md` pelo guard; veredito de conformidade), **scout** (rogue: recon read-only, reporta no retorno; tools `read,grep,find,ls,intercom`; `output: context.md`; thinking low), **researcher** (warlock: pesquisa externa, cita fontes, read-only; tools `read,grep,find,ls,web_search,fetch_content,get_search_content,intercom`; `output: research.md`), **security** (paladin: auditoria de segurança/conformidade, triage + fast-exit, classes de vulnerabilidade; tools `read,grep,find,ls,bash,intercom`; veredito estruturado). **Validar no Execute**: nomes exatos das tools no serializer do fork (vocabulário acima = observado nos builtins; `subagent`/`contact_supervisor` confirmados em review-loop.md/delegate.md) | Semânticas extraídas dos default.ts (lidos — sem invenção); fail-closed por allowlist = restrição em DADOS (extensível); vocabulário de tools ancorado no frontmatter real dos builtins do fork |
| D4 | **Infra de prompts portada = módulos puros `src/agents/`** (ROLE-04): `prompt-loader.ts` (port fiel do loadPromptFile — sandbox basePath, rejeita absoluto/traversal, `.md/.txt`, null se ausente), `prompt-utils.ts` (isAgentEnabled), `dynamic-prompt-builder.ts` (categorizeTools + buildKeyTriggersSection(agents) — render data-driven da lista de papéis p/ prompt de delegação). **agent-builder/custom-agent-factory/builtin-agents NÃO são portados como código** — o fork já os implementa (loadAgentsFromDir + frontmatter + dir agents/ + RPC; evidência no Contexto 1); o equivalente harness de "builtin-agents" = os 7 `.md` versionados (D1). AGENT_NAME_VARIANTS (thread/spindle/weft/warp...) NÃO portado (nomenclatura RPG do arcanum — decisão 2: zero RPG) | Fidelidade onde o harness PRECISA (render de templates/evals/validação); sem duplicação do fork (evidência no source); sem variantes RPG (AD-022 decisão 2); zero deps |
| D5 | **Delegação via prompt template** (ROLE-05): o "guild_spawn_wizard" do arcanum (src/tools/spawn-wizard.ts + spawn-wizard-builder.ts — spawna sessão com o prompt do wizard; wizard-tool-policy.ts — wizard não spawna) vira **template renderizado** em `src/agents/delegation.ts`: `renderDelegationPrompt(role, catalog)` instrui o agente delegador a usar a tool `subagent` (F2; evento delegation do F28) com `agent: "<papel>"`, e `buildKeyTriggersSection` (D4) lista os papéis disponíveis (nome/descrição/tools) para o delegador escolher alvos válidos. Política de delegação v1 (QA-5a): **só builder tem `subagent` no allowlist** (espelho do fighter com `call_guild_agent: true`; demais papéis espelham `call_guild_agent: false`/`guild_spawn_wizard: false`); planner é SEMPRE spawnado (nunca spawna — espelho do wizard). F33 codifica a orquestração (keyword-detector/bard) consumindo estes papéis — outline aqui | F28 já observa delegação (tool subagent); orquestração codificada = F33 (fronteira); política por allowlist = dado, não código; template = o mecanismo do spawn-wizard portado para o Pi |
| D6 | **Composição de review** (ROLE-06; QA-3a recomendado): **reviewer = agente read-only novo** (semântica cleric: plan review + work review, veredito `[APPROVE]/[REJECT]` + resumo + ≤3 blocking issues, approval bias; allowlist sem edit/write — D3). **NÃO é wrapper do `/pr-review`** (loop tools gated fora do /pr-review ativo — F21 AD-021; pr-review F5 é o engine de review de PR e o F20 os receipts — fluxo PR INTACTO). **review-resolver/review-model-variants**: a SEMÂNTICA (base = reviewer(+security); variantes de modelo `reviewer-review-<key>` de `review_models`) vira INTERFACE DE DADOS no F30 (`models.agents.reviewer.review_models` / `models.agents.security.review_models` — variantes como config; fan-out/collation do review-orchestrator permanece no fork pr-review p/ fluxo PR). In-loop: builder spawna reviewer p/ work review (trajectory EVAL-063); F25 cascata INTACTA (não consome o papel — fronteira) | Honestidade com o gating do pr-review (achado F21 verificado); composição por dado/template, não runtime novo; variantes = config de modelos (F30), não código; receipt (F20) cobre o fluxo PR, não o in-loop |
| D7 | **Ativação do auditor** (ROLE-07): default do state `guards.rangerMdOnly.mdOnlyAgents` += `"auditor"` (F24 D5: "F32 registra o papel auditor na lista"; mudança de DEFAULT de config — `src/guards/ranger-md-only.ts` e o guard INTOCADOS). Auditor escreve somente `.md` (reports de auditoria); guard bloqueia extensões ∉ {md,MD,Markdown} com reason estável (D3 F24). **Validar no Execute**: propagação da identidade do subagente ao guard (`RUNECRAFT_AGENT_ID=auditor` — F24 achado: identidade não exposta no ExtensionContext; o fork pode setar env por agente ou o guard precisa de bridge — EVAL-061 é o gate) | F24 config-gated aguardando exatamente este registro (AD-022 decisão 3); ativação = default de config (aditivo, sem bump de schema — AD-013); sem tocar no guard (fail-closed existente) |
| D8 | **Interface de modelos (F30)** (ROLE-08; QA-4a recomendado): os 7 ids de papel são ids válidos de agente para `state.models.agents.<id>.fallbackChain` (F30 D5/D11); F32 NÃO shipa chains default (F30 D4: `AGENT_MODEL_REQUIREMENTS = {}`; zero IDs de modelo inventados — modelos vêm do models.json do SDK via `harness models generate`). Documenta no ROUTING a semântica de cadeia do arcanum (extraída de `model-resolution.ts` AGENT_MODEL_REQUIREMENTS: pesado = planner/researcher/security; leve = builder/scout; médio = reviewer/auditor) como EXEMPLO de config do usuário, nunca default | F30 D11: "F32 consome per-agent models (chains por papel objetivo via state)"; alinhamento por contrato de ids (dado), sem código acoplado; fail-visible (null + warn) preservado |
| D9 | **Evals EVAL-057..066 + matriz v10** (ROLE-09): suite `test/eval/suites/roles.ts` — categorias **tool-use correctness** + **routing completeness** DESBLOQUEADAS (F26: "→ F32"): EVAL-057 render/goldens (7 `.md` — frontmatter válido p/ o parser do fork; deny-list RPG ausente; tools ⊆ vocabulário), EVAL-058 discovery (fixture `.pi/agents/` → loadAgentsFromDir resolve os 7; shadowing project > builtin), EVAL-059 tool-use scout (trajectory: apenas tools read-only — tool-policy), EVAL-060 tool-use builder (write/edit/bash legítimos no fluxo), EVAL-061 auditor md-only (write `.ts` → block do guard com reason; write `.md` ok — lista `mdOnlyAgents` populada), EVAL-062 routing planner→builder (trajectory-assertion delegationSequence: subagent agent=builder), EVAL-063 routing builder→reviewer (spawn + veredito estruturado), EVAL-064 routing builder→scout (recon pré-build), EVAL-065 delegation-template (render determinístico 2 runs; lista os 7 papéis), EVAL-066 models interface (precedência F30 resolve chain de papel via state; fim-de-chain → null). EVAL-MATRIX **v10 aditiva** (bump 9→10 após F31 fechar v9 — one writer thread); nota datada desbloqueando as 2 categorias no docs/EVAL-FRAMEWORK.md; `MIN_EVIDENCE_FILES` bump (AD-025). **Validar no Execute**: delegação real de `subagent` em sessão scriptada do fixture (F21 layer2 — precedente: F28 EVAL-026 observou delegação; EVAL-021 rodou sessão real) | Política aditiva (F21 D9); trajectory = transcript REAL (F26 QA-2); tool-policy = union dos tools reais (F26); desbloqueio com evidência (padrão F27/F30) |
| D10 | **Fronteiras**: F24 dono do guard (F32 muda só o DEFAULT de config — `guards.rangerMdOnly.mdOnlyAgents`); F30 dono de models (F32 consome por contrato de ids — zero mudança em `src/models/`); F33 dono da orquestração codificada (F32 entrega agentes + templates — outline apenas); F19 dono do renderRules (F32 NÃO toca `rulesContent.ts` — ROUTING apenas); F5/F20 donos do review de PR/receipts (reviewer = in-loop); fork subagents consumido READ-ONLY (zero mudança no fork — descoberta/tool/RPC); zero deps novas; escopo packages/harness | Contratos cross-feature explícitos (padrão AD-027/AD-028); sem retrofit em features fechadas |

## Arquitetura — módulos

```
packages/harness/
├── agents/                            # NOVO — assets versionados (7 papéis) — DADOS, zero código (D1)
│   ├── planner.md · builder.md · reviewer.md · auditor.md
│   ├── scout.md · researcher.md · security.md
├── src/agents/
│   ├── catalog.ts                     # ROLE_CATALOG: 7 papéis (id/nome/descrição/tools/constraints/spawn policy) — fonte única p/ render+evals; valida os .md (D3)
│   ├── prompt-loader.ts               # NOVO — port puro (loadPromptFile — sandbox basePath) (D4)
│   ├── prompt-utils.ts                # NOVO — port puro (isAgentEnabled) (D4)
│   ├── dynamic-prompt-builder.ts      # NOVO — port puro (categorizeTools + buildKeyTriggersSection) (D4)
│   └── delegation.ts                  # NOVO — renderDelegationPrompt(role, catalog) — o spawn-wizard como template (D5)
├── src/config.ts / src/state.ts       # default guards.rangerMdOnly.mdOnlyAgents += "auditor" (D7)
├── src/commands/install.ts / sync.ts  # alvo agents: copy-if-different → <cwd>/.pi/agents/ (three-way F19; contentHash F13; órfãos F18) (D1)
├── docs/ROUTING.md                    # §nova: Objective Role Agents — tabela de papéis, mapping builtin↔papel, delegação, modelos (D10)
└── test/
    ├── agents/…                       # unit: catalog↔.md validação, templates determinísticos, guard default (D3/D4/D5/D7)
    └── eval/suites/roles.ts           # cases EVAL-057..066 (D9)
```

## Fluxos

### F1 — Install/sync dos papéis (ROLE-01)

```
1. assets = packages/harness/agents/*.md (7 arquivos; versão no pacote — precedente F30)
2. alvo = <cwd>/.pi/agents/ (escopo projeto — resolveNearestProjectAgentDirs; mkdir recursivo — precedente agent-management.ts:812)
3. three-way por conteúdo (F19 D7): ausente → copia (re-injetado) · difere do asset ≠ registrado → copia (atualizado vN→vM) · difere do asset E do registrado → "preservada (editada)" (nunca auto-cura) · igual → already in sync
4. contentHash registrado no state (F13, targets agents.pi.targets); órfãos reportados, nunca removidos (F18)
5. fork ausente (componente subagents não instalado) → papéis inertes (dados); status/doctor informam (matriz F17)
```

### F2 — Delegação (ROLE-05)

```
1. delegador (builder) tem tool `subagent` no allowlist (D3/D5); demais papéis NÃO (fail-closed)
2. renderDelegationPrompt(delegador, catalog) → instrução: "use subagent com agent: <papel>; alvos válidos: [buildKeyTriggersSection]" (D4/D5)
3. subagent({agent: "planner"|"scout"|"reviewer", prompt, ...}) — runtime do fork resolve o papel (projeto > builtin) e spawna sessão (F2)
4. F28 registra delegation (tool subagent — argsHash); F33 codifica a orquestração consumindo os papéis (outline)
```

### F3 — Auditor ativado (ROLE-07)

```
1. default state: guards.rangerMdOnly.mdOnlyAgents = ["auditor"] (D7 — guard intacto)
2. sessão auditor: write de extensão ∉ {md,MD,Markdown} → guard bloqueia ({block:true, reason "ranger-md-only: ..."} — D3 F24)
3. identidade: RUNECRAFT_AGENT_ID=auditor no subagente (mecanismo a validar no Execute — EVAL-061 é o gate)
4. write de .md (report de auditoria) permitido
```

### F4 — Composição de review (ROLE-06)

```
in-loop: builder → subagent({agent:"reviewer"}) → veredito [APPROVE]/[REJECT] + ≤3 blocking issues (D3/D6)
fluxo PR: pr-review (F5) + receipts (F20) INTACTOS — reviewer papel não interfere
variantes: models.agents.reviewer.review_models / models.agents.security.review_models (F30 — dados; fan-out/collation = fork pr-review)
```

### F5 — Evals (ROLE-09)

```
bun test test/eval (preloads F21..F31) → EVAL-057..066 offline/$0 (fixture; workspace temp; .pi/agents/ fake; zero LLM);
trajectory REAL (F26 QA-2): tool-policy (EVAL-059/060) + trajectory-assertion delegationSequence subagent (EVAL-062/063/064) + guard block (EVAL-061);
goldens: 7 .md byte-a-byte (F23) · consistência matriz↔suites v10 · MIN_EVIDENCE_FILES bump (AD-025) · 2 runs idênticos
```

## Tabela de mecanismos (o que existe → o que F32 constrói)

| Mecanismo | Existe — evidência | F32 constrói |
| --- | --- | --- |
| Descoberta de agentes custom `.pi/agents/*.md` | fork agents.ts loadAgentsFromDir/resolveNearestProjectAgentDirs ✓ | reuso read-only (D1) |
| Shadowing de builtins + RPC gestão | fork agent-management.ts:817/1003/1028 ✓ | reuso read-only (D2) |
| Agent-builder/custom-agent-factory/builtin-agents | fork (frontmatter + dir agents/ + RPC) ✓ | dados (7 `.md`) + catalog (D3/D4) |
| Tool subagent (delegação) | fork (F2; review-loop.md) ✓ | allowlist por papel + template (D5) |
| Artefatos output (plan.md/context.md/research.md) | runtime do fork (planner sem write) ✓ | frontmatter output nos `.md` (D3) |
| prompt-loader/prompt-utils/dynamic-prompt-builder | arcanum src/agents (lido) | port puro em src/agents/ (D4) |
| spawn-wizard (guild_spawn_wizard) | arcanum src/tools/spawn-wizard.ts + builder + policy | renderDelegationPrompt (D5) |
| Guard ranger-md-only config-gated | F24 src/guards/ranger-md-only.ts (lista vazia) | default += "auditor" (D7) |
| Per-agent models | F30 (planned) src/models/ + state models.agents.<id> | contrato de ids + docs (D8) |
| review-orchestrator/resolver/variants | arcanum (lido) + pr-review F5 | semântica → interface F30 (D6) |
| Evals + goldens + ratchet | F21/F23/F26 + EVAL-MATRIX | EVAL-057..066 + v10 (D9) |

## EVAL-MATRIX — entradas aditivas v10 (política F21 D9)

| ID | Fluxo | Script esperado | Notas |
| --- | --- | --- | --- |
| EVAL-057 | render/goldens | 7 `.md` == assets (byte-a-byte); frontmatter válido (parser do fork); deny-list RPG ausente; tools ⊆ vocabulário | D3; F23 |
| EVAL-058 | discovery | fixture `.pi/agents/` com os 7 → loadAgentsFromDir resolve; shadowing project > builtin (planner) | D1/D2 |
| EVAL-059 | tool-use: scout | trajectory session scout → tool-policy: tools ⊆ {read,grep,find,ls,intercom} | D3; categoria tool-use DESBLOQUEADA |
| EVAL-060 | tool-use: builder | trajectory session builder → write/edit/bash presentes e legítimos | D3; tool-use |
| EVAL-061 | tool-use: auditor md-only | session auditor: write `.ts` → block ranger-md-only (reason estável); write `.md` ok | D7; F24; tool-use |
| EVAL-062 | routing: planner→builder | trajectory-assertion delegationSequence contém subagent(agent="builder") | D5; categoria routing DESBLOQUEADA |
| EVAL-063 | routing: builder→reviewer | trajectory: subagent(agent="reviewer") + veredito [APPROVE]/[REJECT] no retorno | D5/D6; routing |
| EVAL-064 | routing: builder→scout | trajectory: subagent(agent="scout") antes da escrita (recon) | D5; routing |
| EVAL-065 | delegation-template | renderDelegationPrompt determinístico 2 runs; lista os 7 papéis (buildKeyTriggers) | D4/D5; F21 D10 |
| EVAL-066 | models interface | resolveAgentModel("auditor", {customFallbackChain}) com chain do state; fim-de-chain → null + warn | D8; F30 D4 |

Nota datada v10: papéis objetivos (F32) — 7 agentes-dados `.pi/agents/*.md` + delegação via template + auditor ativando o guard F24 + interface F30; categorias tool-use correctness e routing completeness DESBLOQUEADAS (F26 tabela de dependência). Bump de MATRIX_VERSION 9→10 depende do F31 fechar a v9 (one writer thread).

## Integração CI

- **Roda com**: mesma lane F21..F31 — `bun test test/eval` (offline/$0: loopback, apiKey literal, workspace temp, PATH mínimo, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM
- **Evidência**: evalTest() nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (goldens dos 7 `.md` + identidade estável — asserts excluem payload volátil)
- **Consistência**: matrix-consistency v10 varre `test/eval/suites` incluindo roles.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Shadowing quebra fluxos do fork que esperam builtin reviewer/scout/researcher com escrita** | Allowlist objetivo ENFORÇA o que os fluxos já pedem por instrução ("must not edit files"); artefatos `output:` são runtime (sem tool write); "validar no Execute" com review-loop/parallel-* reais; QA-1 |
| **Identidade do auditor não propaga ao guard** (`RUNECRAFT_AGENT_ID` no subagente) | EVAL-061 é o gate do Execute; mecanismo de env por agente no fork a validar; se inviável, bridge documentada (adendo before_agent_start do F28) SEM tocar o guard |
| **Vocabulário de tools divergir do serializer do fork** (ex.: nome exato de `subagent`/`web_search` no frontmatter) | Catalog valida tools ⊆ vocabulário observado (builtins); "validar no Execute" o parser real; fail-closed no teste/doctor |
| **Precedência de shadowing (user/project > package > builtin)** divergir do merge do fork | agents.ts L1622–1632 (ordem do spread) a confirmar no Execute; EVAL-058 cobre |
| **F30 ainda em execução quando F32 planeja** (interface models pode mudar) | Alinhamento por CONTRATO de ids (`models.agents.<id>` — D5/D11 do F30 já aprovado); F32 consome, não implementa; se F30 mudar o shape, ajuste local no Execute |
| **Delegação real de `subagent` em sessão scriptada do fixture inviável** | Precedente F28 (EVAL-026 observou delegação) + F21 layer2; fallback honesto: trajectory-assertion sobre o delegation event do F28 (delegation:delegate) — nota no case |
| **`.pi/agents/` do usuário com papéis editados** | Three-way "preservada (editada)" (F19 D7); nunca auto-cura; RPC do fork (eject/reset) respeitado por conteúdo (órfãos F18) |
| **Termos RPG vazando no conteúdo dos papéis** | Deny-list nos evals (EVAL-057 — precedente F30); revisão humana dos `.md` (goldens F23) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| ROLE-01 | P1: Mecanismo `.pi/agents/*.md` | D1 + agents assets + install/sync + EVAL-058 |
| ROLE-02 | P1: Definições dos 7 papéis | D3 + catalog.ts + 7 `.md` + EVAL-057/059/060 |
| ROLE-03 | P1: Mapeamento builtin ↔ papel | D2 + ROUTING + EVAL-058 |
| ROLE-04 | P1: Infra de prompts | D4 + src/agents/{prompt-loader,prompt-utils,dynamic-prompt-builder}.ts + EVAL-065 |
| ROLE-05 | P1: Delegação via template | D5 + delegation.ts + EVAL-062/063/064/065 |
| ROLE-06 | P1: Composição de review | D6 + reviewer.md + docs + EVAL-063 |
| ROLE-07 | P1: Auditor ativado | D7 + config default + EVAL-061 |
| ROLE-08 | P1: Interface de modelos | D8 + ROUTING + EVAL-066 |
| ROLE-09 | P2: Evals | D9 + test/eval/suites/roles.ts + EVAL-MATRIX v10 |
| ROLE-10 | P2: Docs | D10 + ROUTING §nova + README + STATE.md |

**Cobertura:** 10/10 mapeados. Edges da spec: `.pi/agents` do usuário → preservado (D1) · fluxo do fork com escrita → allowlist endurecido (D2/D3) · identidade auditor → validar (D7) · frontmatter inválido → catalog fail-closed (D3) · dir ausente → mkdir (D1) · fork ausente → dados inertes (D1) · edição entre syncs → preservada (D1) · sem chain → null + warn (D8) · RPC do usuário → órfãos preservados (D1) · 2 runs → idênticos (D9).

**Pontos a validar no Execute** (consolidado): precedência do shadowing e ordem do merge no fork (agents.ts L1622–1632); regressão dos fluxos do fork (review-loop/parallel-*) com os papéis shadowados; nomes exatos das tools no serializer do fork (`subagent`/`contact_supervisor`/`web_search`/`fetch_content`/`get_search_content` no frontmatter); propagação do `RUNECRAFT_AGENT_ID=auditor` ao guard (mecanismo de env por agente do fork; EVAL-061 é o gate); delegação real de `subagent` em sessão scriptada do fixture (fallback: delegation event F28); caminho exato de resolução do projeto (`.pi/agents` vs `.agents` — `resolveNearestProjectAgentDirs`); integração do alvo agents com o sync/state existente (shape de targets; `agents.pi.targets`); vocabulário/keys do frontmatter aceito pelo parser do fork (frontmatter.ts); `MIN_EVIDENCE_FILES` pós-bumps de F29/F30/F31.

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Shadowing de builtins** (D2): (a) **recomendado — shadow dos 4 homônimos (planner/reviewer/scout/researcher) com definição objetiva compatível+endurecida** (mecanismo nativo; fluxos do fork já restringem por instrução; output = runtime) · (b) nomes distintos (viola o naming travado do roadmap) · (c) shadow também de worker (não recomendado)
2. **QA-2 — Escopo de instalação** (D1): (a) **recomendado — projeto `<cwd>/.pi/agents/` via install/sync (repo-scoped, three-way)** · (b) usuário `~/.agents` · (c) ambos
3. **QA-3 — Composição de review** (D6): (a) **recomendado — reviewer = agente read-only in-loop; pr-review/F20 donos do fluxo PR; variantes = dados F30** · (b) wrapper sobre /pr-review (inviável — gating F21 AD-021) · (c) runtime de fan-out novo (fora de escopo)
4. **QA-4 — Defaults de modelo** (D8): (a) **recomendado — nenhum chain default no código (F30 D4: zero IDs inventados); exemplo arcanum documentado** · (b) chains default derivadas do arcanum no state
5. **QA-5 — Delegação no v1** (D5): (a) **recomendado — só builder spawna (scout+reviewer); demais papéis sem tool `subagent`** · (b) todos podem spawnar · (c) nenhuma delegação até o F33 (só templates)
