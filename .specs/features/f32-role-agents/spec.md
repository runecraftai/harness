# F32 — Objective Role Agents — Specification

**Scope:** Large (multi-component: 7 papéis objetivos como agentes-de-dados `.pi/agents/*.md` + infra de prompts portada (módulos puros) + delegação via template (spawn-wizard) + composição de review + ativação do auditor (F24) + interface de modelos (F30) + evals EVAL-057..066 — M8). Menor que F30 (sem mecanismos de modelo novos — reuso F30/F24; agentes são DADOS, não runtime).
**Prereq (roadmap):** F24 ✓, F30 (planned). **Efetivos:** F2 (fork subagents — descoberta de `.pi/agents/*.md` + tool `subagent`), F13 (state targets + contentHash), F17/F19 (matriz + sync three-way por conteúdo), F21/F26 (fixture, evalTest, trajectory-assertion/tool-policy, EVAL-MATRIX), F23 (goldens/ratchet), F24 (guard `rangerMdOnly` config-gated — ativação aqui), F28 (event store: delegação = tool subagent; lessons), F30 (per-agent models — interface consumida). **Não depende de** F33 (orquestração codificada é outline aqui).
**Grupo:** M8 — Pi First-Class & Multi-Agent Expansion (AD-022 decisão 2: papéis objetivos sem RPG; roadmap F32).

## Problem Statement

O harness garante execução determinística (M7) e serve agentes não-Pi (M3), mas **não tem papéis objetivos**: os 8 agentes RPG do guild (arcanum) não foram portados e o fork `@runecraft/subagents` (F2) traz 9 builtins genéricos (`planner/reviewer/scout/researcher/worker/oracle/advisor/context-builder/delegate` — verificado em `packages/subagents/agents/*.md`). O roadmap F32 trava o escopo: "Port dos 8 agentes RPG → papéis objetivos: planner (wizard), builder (fighter), reviewer (cleric), auditor (ranger), scout (rogue), researcher (warlock), security (paladin); bard = lógica de orquestração → F33 (não vira subagente). Infra de agentes: prompt-loader/prompt-utils/dynamic-prompt-builder/agent-builder/custom-agent-factory/builtin-agents; review-orchestrator/review-resolver/review-model-variants (reviewer); guild_spawn_wizard → delegação via prompt template."

**Fatos verificados (sem fabricação — source do arcanum + fork lidos):**
1. **O fork descobre agentes custom de `.pi/agents/*.md` (mecanismo nativo Pi, verificado)** — `packages/subagents/src/agents/agents.ts`: `BUILTIN_AGENTS_DIR` (linha 1519 — dir `agents/` do pacote), `resolveNearestProjectAgentDirs(cwd)` + `loadAgentsFromDir(dir, source)` (linhas 1601–1653 — escopos **user** `<agentDir>/agents` + `~/.agents`, **project** dirs `.pi`/`.agents` acima do cwd, **builtin**); `agent-management.ts:1003/1028` ("no project config root (.pi or .agents) was found above the cwd"); shadowing suportado nativamente (`agent-management.ts:817` "shadows the builtin"; RPC eject/disable/enable/reset — `skills/pi-subagents/references/management-authoring-rpc.md`). Frontmatter: `name/description/tools/thinking/acceptanceRole/systemPromptMode/output/defaultReads/defaultContext` (lido nos 9 builtins). **O mecanismo `.pi/agents/*.md` é o "agent-builder + custom-agent-factory + builtin-agents" do harness — o fork JÁ os implementa; duplicar em código = reimplementar o fork.**
2. **Builtins do fork vs papéis objetivos (mapeamento honesto, lido)** — builtin `planner` (tools `read,grep,find,ls,intercom`; `acceptanceRole: read-only`; `output: plan.md` — **sem tool write** → artefato de output é gravado pelo runtime do fork, não pelo agente), `reviewer` (tools `read,grep,find,ls,bash,edit,write,intercom` — **NÃO é read-only no builtin**), `scout` (tools `...bash,write,intercom`; `output: context.md`), `researcher` (tools `read,write,web_search,fetch_content,get_search_content,intercom`; `output: research.md`), `worker` (execução: `...bash,edit,write,contact_supervisor`), `oracle/advisor/context-builder/delegate` (sem contraparte objetiva). Os fluxos do fork referenciam builtins por nome com restrições POR INSTRUÇÃO ("Reviewers must not edit files" — `prompts/review-loop.md`; `{ agent: "reviewer", task: "Do not modify files" }` — `skills/pi-subagents/references/prompting-and-roles.md:76-77,161-168`); `subagent` é tool nomeável no allowlist (review-loop.md: "whose builtin `tools` includes `subagent`").
3. **Agentes arcanum (semânticas lidas nos `default.ts`)** — `src/agents/{wizard,fighter,cleric,ranger,rogue,warlock,paladin,bard}`: **wizard** = planejador interativo, produz planos SOMENTE, nunca implementa, 2 modos (interactive/automatic), clarificação por escopo, `guild_spawn_wizard: false`; **fighter** = lead de execução, `call_guild_agent: true` (pode delegar), `task: false`; **cleric** = revisor read-only (write/edit/task/call_guild_agent false), 2 modos (plan review/work review), veredito `[APPROVE]/[REJECT]` + ≤3 blocking issues, approval bias; **ranger** = trabalhador de domínio com task intake estruturado (no harness = papel **auditor** por AD-022 decisão 3: "ranger → auditor"; guard md-only assina o papel); **rogue** = recon de codebase read-only, registra achados (no harness = **scout**); **warlock** = pesquisa externa read-only, cita fontes, nunca spawna (no harness = **researcher**); **paladin** = auditor de segurança/conformidade read-only com triage + fast-exit + classes de vulnerabilidade (no harness = **security**); **bard** = orquestração → F33. **Não existe agente scout no arcanum — rogue É o scout** (semântica de recon confirma o mapeamento do roadmap).
4. **Infra arcanum (paths reais lidos)** — `src/agents/prompt-loader.ts` (`loadPromptFile(path, basePath)` — sandbox, rejeita path absoluto/traversal, `.md/.txt`, null se ausente), `prompt-utils.ts` (`isAgentEnabled`), `dynamic-prompt-builder.ts` (`categorizeTools` + `buildKeyTriggersSection(agents, skills)` — render da lista de agentes/tools/skills p/ prompt de delegação dinâmica), `agent-builder.ts` (AGENT_NAME_VARIANTS + `buildAgent`), `custom-agent-factory.ts` (`buildCustomAgent` — pattern `/^[a-z][a-z0-9_-]*$/`, `KNOWN_TOOL_NAMES`, prompt inline/file/skills, `resolveAgentModel`), `builtin-agents.ts` (`AGENT_FACTORIES` — 8 agentes), `model-resolution.ts` (`AGENT_MODEL_REQUIREMENTS` com fallbackChain por agente: bard/wizard = classe pesada, fighter/ranger/rogue/warlock = classe leve + `resolveAgentModel`/`getNextFallbackModel`), `review-orchestrator.ts` (`runAdditionalReviewers` fan-out paralelo + `collateReviews` + `buildFailureWarning`), `review-resolver.ts` (`resolveReviewers` → plano `fan-out | primary-only | disabled`; base = cleric|paladin), `review-model-variants.ts` (`buildReviewModelVariants` de `agents.<base>.review_models`; variantes `cleric-review-<key>`), spawn-wizard (`src/tools/spawn-wizard.ts` + `src/runtime/opencode/spawn-wizard-builder.ts` + `src/application/policy/wizard-tool-policy.ts` — **path real; o briefing diz "tools/guild-spawn-wizard.ts" — o nome real é spawn-wizard**; semântica: spawna sessão com o prompt do wizard; wizard não pode spawnar — policy).
5. **F24 guard pronto e config-gated** — `guards.rangerMdOnly.mdOnlyAgents: string[]`, **default = lista vazia** (guard ativo, inerte); F24 D5: "F32 registra o papel auditor na lista" (design f24, linha 20). Achado F24: identidade de agente NÃO exposta no ExtensionContext → `RUNECRAFT_AGENT_ID` — propagação para subagentes a validar no Execute.
6. **F30 (planned, design aprovado — AD-030)** — D4: port puro `src/models/` (`resolveAgentModel`, `getNextFallbackModel`; `AGENT_MODEL_REQUIREMENTS = {}` — zero IDs inventados; chains vêm do state); D5: config `models.agents.<id>.fallbackChain`; D11: "**F32 consome per-agent models (chains por papel objetivo via state)**".
7. **EVAL-MATRIX v6 atual** (F28 fechou v6); v7 (F29) → v8 (F30) → v9 (F31) → **v10 (F32)**; categorias **tool-use correctness + routing completeness bloqueadas "→ F32"** na tabela de dependência do F26 (docs/EVAL-FRAMEWORK.md; v4 nota datada) — desbloqueio com evidência aqui.
8. **F28 já observa delegação** — evento de delegação = tool `subagent` (port do session-recorder; "delegação só subagent"); F21 AD-021: tools do loop do pr-review são gated fora de `/pr-review` ativo → **reviewer NÃO pode ser wrapper do /pr-review**.

## Goals

- [ ] **7 papéis objetivos como agentes-de-dados** (`packages/harness/agents/*.md` — planner/builder/reviewer/auditor/scout/researcher/security), sincronizados para `<cwd>/.pi/agents/` via mecânica F17/F19 (three-way por conteúdo + contentHash F13); extensíveis por construção (qualquer `.md` novo é descoberto pelo fork) — ROLE-01/02
- [ ] **Mapeamento honesto builtin ↔ papel objetivo** (shadow compatível de planner/reviewer/scout/researcher — o fork suporta shadowing e os fluxos do fork já restringem por instrução; novos builder/auditor/security; worker/oracle/advisor/context-builder/delegate preservados) — ROLE-03
- [ ] **Infra de prompts portada como módulos puros** (`prompt-loader`/`prompt-utils`/`dynamic-prompt-builder` em `src/agents/` — o que o harness PRECISA para render/evals; agent-builder/custom-agent-factory/builtin-agents = satisfeitos pelo fork + dados) — ROLE-04
- [ ] **Delegação via prompt template** (spawn-wizard → `renderDelegationPrompt`; `buildKeyTriggersSection` lista papéis disponíveis; política por papel = allowlist de tools no frontmatter, incl. tool `subagent` só no builder) — ROLE-05
- [ ] **Composição de review decidida** (reviewer = agente read-only in-loop com veredito estruturado do cleric; pr-review/F20 donos do fluxo PR; review-resolver/model-variants → interface de dados F30) — ROLE-06
- [ ] **Auditor ativado** (default `guards.rangerMdOnly.mdOnlyAgents` += `"auditor"`; guard F24 INTOCADO) — ROLE-07
- [ ] **Interface de modelos F30** (7 ids de papel consumíveis por `models.agents.<id>.fallbackChain`; zero IDs inventados; exemplo arcanum documentado) — ROLE-08
- [ ] **Evals EVAL-057..066** (tool-use correctness: scout read-only, auditor md-only, builder write/edit/bash; routing completeness: planner→builder, builder→reviewer, builder→scout) + EVAL-MATRIX **v10 aditiva** + `MIN_EVIDENCE_FILES` bump (AD-025) — ROLE-09
- [ ] **Docs** (ROUTING.md §nova com tabela de papéis/mapping/delegação/modelos; tabela no README; STATE.md) — ROLE-10

## Out of Scope

| Feature | Reason |
| --- | --- |
| Orquestração codificada do bard (keyword-detector, routing em código) | F33 (prereq F19/F27/F30/F32); F32 entrega agentes + templates de delegação; outline apenas |
| Port em código de `agent-builder`/`custom-agent-factory`/`builtin-agents` | O fork `@runecraft/subagents` JÁ implementa (agents.ts `loadAgentsFromDir` + frontmatter + `agents/` dir + RPC de gestão — evidência acima); duplicar = reimplementar o fork; F32 entrega o equivalente harness de "builtin-agents" = os 7 `.md` versionados |
| Wrapper do reviewer sobre `/pr-review` | Loop tools do pr-review são gated fora de `/pr-review` ativo (F21 AD-021 — achado verificado); pr-review (F5) é o engine de review de PR; F20 os receipts; reviewer = revisor in-loop read-only |
| Runtime de fan-out/collation de review novo no harness | review-orchestrator fica no fork pr-review (fluxo PR); semântica de variantes = dados via F30 (`review_models`) |
| Mudanças no fork subagents / F24 guard / F19 renderRules / F30 models | Reuso read-only: descoberta, guard (só default de config), renderRules (docs apenas), interface de modelos (contrato de ids) |
| Chains default de modelos para papéis | F30 D4: zero IDs inventados; chains vêm do state (exemplo documentado no ROUTING) |
| Roteamento por keyword (input → papel) | F33 |
| Replanejar F21..F31 | Política da casa |

## Gray area (resolver antes do Execute — 5 decisões)

Opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Shadowing de builtins**: (a) **recomendado — shadow dos 4 homônimos (planner/reviewer/scout/researcher) com definição objetiva compatível+endurecida** (o fork suporta shadowing por arquivo de escopo; os fluxos do fork já restringem esses builtins por instrução — "must not edit files" — e o allowlist objetivo ENFORÇA o que o prompt pedia; artefatos de output são gravados pelo runtime — builtin planner sem tool write com `output: plan.md`) · (b) nomes distintos para evitar shadow (viola o naming travado do roadmap) · (c) shadow de todos + também worker (NÃO recomendado — worker é o executor genérico de fluxos do fork; builder é nome novo)
- **QA-2 — Escopo de instalação dos papéis**: (a) **recomendado — projeto** (`<cwd>/.pi/agents/` via `harness install/sync` — repo-scoped, padrão F17/F19/F31; three-way preserva edição do usuário; shadowing vale por projeto) · (b) usuário (`~/.agents`) · (c) ambos
- **QA-3 — Composição de review**: (a) **recomendado — reviewer = agente read-only novo (in-loop) + variantes como dados F30** (pr-review/F20 donos do fluxo PR) · (b) wrapper do reviewer sobre `/pr-review` (inviável — tools gated, F21 AD-021) · (c) reviewer como fan-out de modelos no harness (runtime novo — fora de escopo)
- **QA-4 — Defaults de modelo para papéis**: (a) **recomendado — NENHUM chain default no código** (F30 D4: zero IDs inventados; modelos vêm do models.json do SDK; exemplo de config arcanum documentado no ROUTING) · (b) chains default derivadas do arcanum (`AGENT_MODEL_REQUIREMENTS` — classes pesado/leve) como defaults do state
- **QA-5 — Delegação no v1**: (a) **recomendado — builder spawna scout+reviewer; demais papéis NÃO spawnam** (política = allowlist de tools: só builder tem tool `subagent`; espelho do wizard-tool-policy: wizard/planner nunca spawna; F33 codifica a orquestração) · (b) todos os papéis podem spawnar · (c) nenhuma delegação até o F33 (só templates)

**Já decidido (não é gray area):** zero deps novas; offline/$0; escopo packages/harness; requirement IDs ROLE-01..10; EVAL-MATRIX v10 aditivo com notas datadas (F21 D9 — v10 após F31 fechar v9, one writer thread); evidência via evalTest() (F21); agentes como DADOS (arquivos `.md` + templates) — extensíveis por construção; sem tema RPG em qualquer artefato (deny-list nos evals — precedente F30); auditor = ativação do guard F24 existente (lista `mdOnlyAgents` — guard intocado); bard NÃO vira subagente (F33); `subagent` é a tool de delegação (F2, observada no F28); papéis consumidos pelo F33 via dados (outline); TUI fora (AD-005).

## User Stories

### P1: Papéis objetivos como agentes-de-dados — ROLE-01..05 ⭐ MVP

**User Story**: Como usuário, quero que o harness entregue 7 papéis profissionais objetivos (planner/builder/reviewer/auditor/scout/researcher/security) como agentes `.md` descobertos pelo fork `@runecraft/subagents` (`.pi/agents/`), com identidade objetiva, tools allowlist fail-closed e delegação via prompt template — para que os papéis do guild existam no Pi sem tema RPG e sem código de runtime novo.

**Why P1**: Roadmap F32 (prereq F24/F30); AD-022 decisão 2; hoje os únicos agentes são os builtins genéricos do fork — sem papéis objetivos, F33 (orquestração codificada) não tem o que rotear.

**Acceptance Criteria**:

1. WHEN `harness install`/`sync` roda num repo com o fork instalado THEN os 7 arquivos (`planner.md`, `builder.md`, `reviewer.md`, `auditor.md`, `scout.md`, `researcher.md`, `security.md`) existem em `<cwd>/.pi/agents/` com frontmatter válido (name/description/tools/thinking/acceptanceRole/output) e conteúdo SEM termos RPG (deny-list) — byte-idênticos aos assets versionados em `packages/harness/agents/` na primeira instalação
2. WHEN o usuário edita um papel THEN o sync classifica "preservada (editada)" (three-way F19) e NUNCA reescreve (contentHash F13)
3. WHEN uma sessão Pi com o fork spawna `subagent({agent: "planner"})` THEN o agente resolvido é o planner objetivo (read-only: tools `read,grep,find,ls,intercom`; `acceptanceRole: read-only`) — mesmo comportamento para os 7 papéis
4. WHEN o delegador (builder) precisa de recon/verificação THEN usa `subagent` com `agent: "scout"`/`agent: "reviewer"` — e papéis não-delegadores (planner/reviewer/auditor/scout/researcher/security) NÃO têm a tool `subagent` no allowlist (fail-closed: não spawnam)
5. WHEN a infra de prompts roda THEN `renderDelegationPrompt` + `buildKeyTriggersSection` listam os 7 papéis (nome/descrição/tools) de forma determinística (2 runs idênticos)

**Independent Test**: fixture F21 + fork materializado (AD-021): `.pi/agents/` com os 7 arquivos → `loadAgentsFromDir` resolve os nomes; session scriptada spawna planner (read-only) e builder (com subagent); template render == golden; three-way com edição do usuário → preservada.

### P1: Auditor ativado + review + modelos — ROLE-06..08

**User Story**: Como usuário, quero que o papel auditor ative o guard md-only do F24, que o reviewer seja um revisor read-only in-loop com veredito estruturado, e que os 7 papéis sejam atribuíveis a modelos via F30 — para que as garantias de execução (M7) valham para os papéis objetivos.

**Why P1**: F24 deixou o guard inerte esperando exatamente o registro do auditor (AD-022 decisão 3); F30 D11 aponta o consumo dos per-agent models para o F32; o cleric (reviewer) é o papel mais usado nos fluxos do guild.

**Acceptance Criteria**:

1. WHEN `guards.rangerMdOnly.mdOnlyAgents` default é lido THEN contém `"auditor"` (F24 D5: registro do papel auditor); guard `ranger-md-only` INTOCADO (zero mudança em `src/guards/`)
2. WHEN o agente auditor tenta `write` de arquivo não-`.md` THEN o guard bloqueia com reason estável (`ranger-md-only: <msg>` sem path/timestamp — D3 F24); `write` de `.md`/`.MD`/`.Markdown` é permitido (case-insensitive)
3. WHEN o builder spawna `subagent({agent: "reviewer"})` para work review THEN o reviewer avalia com veredito `[APPROVE]`/`[REJECT]` + resumo + ≤3 blocking issues (formato cleric) usando apenas tools read-only (read/grep/find/ls/bash/intercom)
4. WHEN `state.models.agents.<papel>.fallbackChain` está configurado THEN a resolução F30 (`resolveAgentModel`) consome o chain por papel (precedência state > default; fim-de-chain → null + warn — F30 D4)
5. WHEN o fluxo de review de PR roda THEN continua via pr-review (F5) + receipts (F20) — o papel reviewer não interfere (fronteira explícita)

**Independent Test**: fixture: sessão scriptada com identidade de agente auditor → guard bloqueia `.ts` e permite `.md` (EVAL-061); trajectory de builder→reviewer com veredito estruturado (EVAL-063); `resolveAgentModel("auditor", {customFallbackChain})` com chain do state (EVAL-066); regressão do fluxo PR (suites existentes F5/F20 intactas).

### P2: Evals + governança — ROLE-09/10

**User Story**: Como mantenedor, quero EVAL-057..066 offline/$0 provando tool-use correctness (scout read-only, auditor md-only, builder write/edit/bash) e routing completeness (planner→builder, builder→reviewer, builder→scout) — matriz v10 aditiva — para os papéis não regredirem e as 2 categorias bloqueadas do F26 desbloquearem.

**Why P2**: Política da casa (F21 D9); F26 deixou tool-use correctness e routing completeness bloqueadas "→ F32" — desbloqueio exige evidência.

**Acceptance Criteria**:

1. WHEN a suite `roles` roda THEN EVAL-057..066 executam na lane F21 offline/$0 (fixture; zero LLM; zero rede)
2. WHEN um case de trajectory roda THEN usa transcript REAL do ScriptedScenario (F26 QA-2): tool-policy sobre as tools dos requests reais (EVAL-059/060), trajectory-assertion sobre delegationSequence com a tool `subagent` (EVAL-062/063/064)
3. WHEN a matriz roda THEN EVAL-MATRIX v10 aditiva (EVAL-057..066 + nota datada; bump 9→10 após F31 fechar v9 — one writer thread); categorias tool-use correctness + routing completeness marcadas DESBLOQUEADAS na tabela do F26 (docs/EVAL-FRAMEWORK.md); consistência varre a suite nova; `MIN_EVIDENCE_FILES` bump (AD-025)
4. WHEN um caso roda 2x THEN resultados idênticos (sem $TMP/$TS — F21 D10)

**Independent Test**: cada case valida schema F26; determinismo 2 runs; delta vs EVAL-001..056 documentado; consistência matriz↔suites v10.

## Edge Cases

- WHEN o usuário já tem `.pi/agents/planner.md` próprio THEN o sync preserva (three-way "preservada (editada)") — nunca auto-cura (F19 D7); arquivo novo entra como novo
- WHEN um fluxo do fork referencia o builtin `reviewer` com expectativa de escrita THEN o papel objetivo bloqueia por allowlist (fail-closed) — os fluxos do fork já instruem "must not edit files" (prompting-and-roles.md) — compatibilidade a validar no Execute com os fluxos reais
- WHEN a identidade do agente auditor não propaga ao guard (`RUNECRAFT_AGENT_ID`) THEN o guard fica inerte para o papel → EVAL-061 falha e o Execute para (mitigação documentada no design)
- WHEN um papel tem frontmatter inválido (tool inexistente no vocabulário do fork / name ≠ filename) THEN o catalog falha a validação no teste/doctor (fail-closed; o fork ignora ou erra ao carregar)
- WHEN `.pi/agents/` não existe THEN o sync cria o dir (mkdir recursivo — precedente agent-management.ts:812) e instala os 7 arquivos
- WHEN o fork `@runecraft/subagents` não está instalado THEN os papéis são dados inertes (nenhum efeito); status/doctor informam (dependência do componente subagents na matriz F17)
- WHEN um papel é editado entre syncs THEN contentHash ≠ render → "preservada (editada)" (F19); reporte no status
- WHEN `state.models.agents.<papel>.fallbackChain` não existe THEN `resolveAgentModel` retorna null + warn (F30 D4 — fail-visible, quem consome decide)
- WHEN o usuário roda `subagent` RPC de gestão (eject/disable/reset) sobre um papel THEN o sync re-instala/relata por conteúdo (mesma mecânica de órfãos F18/F19 — nunca remove o que o usuário gerenciou)
- WHEN um caso roda 2x THEN resultados idênticos (workspace temp fixo por case; asserts excluem payload volátil)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ROLE-01 | P1: Mecanismo `.pi/agents/*.md` (7 papéis como dados; sync/install three-way + contentHash) | Design | Pending |
| ROLE-02 | P1: Definições dos 7 papéis (identidade objetiva, tools allowlist fail-closed, constraints, delegação) | Design | Pending |
| ROLE-03 | P1: Mapeamento builtin ↔ papel objetivo (shadow compatível; worker/oracle/etc. preservados) | Design | Pending |
| ROLE-04 | P1: Infra de prompts portada (prompt-loader/prompt-utils/dynamic-prompt-builder — módulos puros) | Design | Pending |
| ROLE-05 | P1: Delegação via prompt template (spawn-wizard → renderDelegationPrompt; política por allowlist) | Design | Pending |
| ROLE-06 | P1: Composição de review (reviewer read-only in-loop; pr-review/F20 donos do PR; variantes = dados F30) | Design | Pending |
| ROLE-07 | P1: Ativação do auditor (default `guards.rangerMdOnly.mdOnlyAgents` += "auditor"; guard intacto) | Design | Pending |
| ROLE-08 | P1: Interface de modelos F30 (ids de papel consumíveis por `models.agents.<id>`; zero IDs inventados) | Design | Pending |
| ROLE-09 | P2: Evals EVAL-057..066 + EVAL-MATRIX v10 + categorias tool-use/routing desbloqueadas | Design | Pending |
| ROLE-10 | P2: Docs (ROUTING §nova, tabela de agentes, STATE.md) | Design | Pending |

**Coverage:** 10 total, 0 mapeados, 10 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] 7 papéis objetivos como `.md` versionados em `packages/harness/agents/` (planner/builder/reviewer/auditor/scout/researcher/security) — agentes como dados, extensíveis por construção; sincronizados para `<cwd>/.pi/agents/` via mecânica F17/F19 (three-way + contentHash)
- [ ] Mecanismo com evidência: fork descobre `.pi/agents/*.md` (agents.ts `loadAgentsFromDir` + `resolveNearestProjectAgentDirs`; agent-management.ts shadowing/RPC) — citado no design
- [ ] Tabela de definições dos 7 papéis (identidade objetiva, tools allowlist fail-closed, constraints, delegação) — zero tema RPG
- [ ] Mapeamento honesto builtin ↔ papel objetivo (shadow planner/reviewer/scout/researcher; novos builder/auditor/security; worker/oracle/advisor/context-builder/delegate preservados; `output:` artefatos = runtime do fork)
- [ ] Infra portada como módulos puros (`prompt-loader`/`prompt-utils`/`dynamic-prompt-builder`) + delegação via template (spawn-wizard); agent-builder/custom-agent-factory/builtin-agents satisfeitos pelo fork + dados (sem duplicação)
- [ ] Composição de review decidida e documentada: reviewer = revisor read-only in-loop (cleric); pr-review/F20 donos do fluxo PR; review-resolver/model-variants = interface de dados F30
- [ ] Auditor ativado: default `guards.rangerMdOnly.mdOnlyAgents` += "auditor" — guard F24 intocado; identidade a validar no Execute
- [ ] Interface de modelos F30 alinhada: 7 ids de papel consumíveis por `models.agents.<id>.fallbackChain`; zero IDs de modelo inventados
- [ ] EVAL-057..066 verdes offline/$0; EVAL-MATRIX v10 aditivo (após F31 fechar v9); categorias tool-use correctness + routing completeness desbloqueadas (F26); `MIN_EVIDENCE_FILES` bump (AD-025); sem regressão
- [ ] Fronteiras explícitas: F24 dono do guard (só default de config); F30 dono de models (contrato de ids); F33 dono da orquestração codificada (outline); F19 dono do renderRules (intocado — docs apenas); F5/F20 donos do review PR/receipts; fork subagents consumido read-only; zero deps novas
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
