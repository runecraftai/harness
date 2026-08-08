# F33 — Coded Routing & Pilot Coordination — Specification

**Scope:** Large (multi-component: classificador determinístico puro + catálogo de rotas como dados + extensão de routing no `before_agent_start` + chains de pilot coordination (assets) + integração com delegação F32/F2 + fronteiras F19/F27/F30/F28 + evals EVAL-067..078 — M8, última feature do M8).
**Prereq (roadmap):** F19 ✓, F27 ✓, F30 (planned), F32 (planned). **Efetivos:** F2 (fork subagents — tool `subagent` nativa + mecanismo `.pi/chains/*.chain.md`), F13 (state targets + contentHash), F17/F19 (sync three-way + `sessionDriver` + two-driver rules), F21/F26 (fixture ScriptedScenario, evalTest, trajectory-assertion/tool-policy, EVAL-MATRIX, categorias tool-use/routing desbloqueadas pelo F32), F23 (goldens/ratchet + `MIN_EVIDENCE_FILES` AD-025), F24 (guards + freeze por sessão + kill switch pattern + `RUNECRAFT_AGENT_ID`), F27 (fallback engine + modelSwitch interface → F30), F28 (event store + lessons adendo via `before_agent_start`), F30 (planned — `models.agents.<id>.fallbackChain` + assets SDD/chains), F32 (planned — 7 papéis objetivos `catalog.ts` + `renderDelegationPrompt`/`buildKeyTriggersSection` + delegação QA-5).
**Grupo:** M8 — Pi First-Class & Multi-Agent Expansion (AD-022 decisão 2: papéis objetivos sem RPG; decisão 3c: determinismo — routing por CÓDIGO com thresholds explícitos, nunca LLM).

## Problem Statement

O guild (arcanum) roteava por **prompt probabilístico**: o bard (temperatura 0.1) DECIDIA pela LLM quando delegar e para quem (`src/agents/bard/prompt-composer.ts` — lido), com base em sinais textuais descritos no prompt (complexidade, nº de arquivos, necessidade de pesquisa/review/segurança). O harness determinístico (M7, decisão 3c) NÃO pode ter rota escolhida por LLM: **a rota precisa ser decisão de CÓDIGO com thresholds explícitos**. O roadmap F33 trava o escopo: "Port de keyword-detector (input → roteamento codificado), lógica de orquestração do bard, workflow engine do guild → chains/prompt templates; call_guild_agent → tool subagent nativa (F2). Two-driver rules (F7/F19) + fallback chains (F27) + roteamento de modelo por agente (F30)."

**Fatos verificados (sem fabricação — source do arcanum + harness lidos):**
1. **keyword-detector REAL é determinístico** (não probabilístico — `src/hooks/keyword-detector.ts` lido): mapa `keyword → injection` (`ultrawork`/`ulw` → "[ULTRAWORK MODE ACTIVATED]..."). O que era PROBABILÍSTICO no arcanum é a ORQUESTRAÇÃO do bard (LLM decide rota a partir do prompt). **Semântica a portar** = os SINAIS DE ROTEAMENTO que o bard usava (extraídos do prompt-composer, abaixo); o mecanismo `keyword → injection` vira `input features → route directive` em código; a injeção "ULTRAWORK MODE" NÃO é portada (tema RPG — AD-022 decisão 2; zero valor determinístico).
2. **Sinais de roteamento do bard (lidos em `prompt-composer.ts`)** — `buildBardRoleSection`: "Simple tasks (quick answers, single-file fixes, small edits) — do them yourself" vs "Substantial work (multi-file changes, research, planning, review) — delegate"; `buildDelegationSection`: rogue = recon de codebase (locate/trace) → delegar PRIMEIRO; warlock = pesquisa externa read-only; wizard = planejamento antes de implementação substancial (interactive/automatic); fighter = `/start-work` execução por todo-list; ranger = especialista por categoria (padrões de arquivo); cleric = review pós-mudança não-trivial; **paladin = OBRIGATÓRIO** quando mudanças tocam auth/crypto/tokens/signatures/input validation/secrets/passwords/sessions/CORS/CSP/.env/OAuth/OIDC/SAML ("MUST use call_guild_agent to delegate to Paladin... not optional"); `buildPlanWorkflowSection`: PLAN → REVIEW → EXECUTE → RESUME → HANDOFF (usar p/ features grandes/refactors multi-arquivo/5+ passos; pular p/ quick fixes/single-file/perguntas simples); `buildReviewWorkflowSection`: review ad-hoc pós 3+ arquivos ou qualidade importa; `buildCategoryRoutingSection`: categorias com `patterns` de arquivo → agente especialista; `buildCustomAgentDelegationSection`: tabela de delegação. `buildDelegationNarrationSection`: narrar antes/depois de delegar.
3. **workflow engine do guild** (`src/features/workflow/` lido — index.ts): steps `interactive|autonomous|gate`, completion methods (`user_confirm|plan_created|plan_complete|review_verdict|agent_signal`), artifact passing via `{{artifacts.NAME}}` (context.ts), gate steps com `on_reject: pause|fail`, lifecycle por `session.idle`. **Equivalente harness = chains** (formato `.chain.md` — front-matter + `worker "..." -> reviewer "..."`; precedente `.pi/chains/f3-taskflow.chain.md` lido; consumido pelo fork subagents — F30 AD-030 QA-1: "formato .chain.md do harness ... consumido pelo fork subagents"). Semântica sobrevivente: sequência de passos por papel + gate de review (veredito F32) + variáveis de artefato.
4. **call_guild_agent** (`src/tools/call-guild-agent.ts` lido): cria child session (`client.session.create({parentID})`) + `client.session.prompt({agent: name, parts:[text]})` + extrai texto do assistant (messages → parts). **Equivalente harness = tool `subagent` do fork (F2)** — mecanismo nativo, já observado como evento de delegação no F28; F32 entrega `renderDelegationPrompt` + `buildKeyTriggersSection` (alvos válidos).
5. **Hook disponível para o router — evidência do harness**: eventos usados em F21..F28 (STATE.md/AD-021/024/027/028): `session_start`, `tool_call`, `tool_execution_end`, `turn_end`, `agent_end`, `session_shutdown`, `context`, `session_before_compact`/`session_compact`; **NENHUM evento `input`/`message` de usuário foi descoberto no surface usado** → per STOP RULES, o router hooka **`before_agent_start`** (rewrite do systemPrompt — evidência: F27 continuation chaining `types.d.ts:792`; F28 adendo com marker `<!-- runecraft:lessons -->`; chaining suportado). Classificação = **features de texto determinísticas do prompt/tarefa** (ainda código); leitura da 1ª mensagem do usuário via client API (read-only) a validar no Execute (precedente: call-guild-agent prova `client.session.prompt` retorna messages; endpoint exato a confirmar).
6. **F32 (design aprovado — AD-032)**: `src/agents/catalog.ts` (7 papéis como dados — planner/builder/reviewer/auditor/scout/researcher/security; tools allowlist fail-closed; **só builder tem tool `subagent`** — QA-5), `src/agents/delegation.ts` (`renderDelegationPrompt` + `buildKeyTriggersSection`), papéis sincronizados para `<cwd>/.pi/agents/`. F33 CONSUME o catalog (read-only) para mapear rota → papel.
7. **F30 (design aprovado — AD-030)**: chains SDD `.chain.md` como assets (formato harness, consumido pelo fork), `models.agents.<id>.fallbackChain` (D5) + `src/models/` (D4 — zero IDs inventados). F33 consome: rota → papel → modelo via `models.agents.<id>` (contrato de ids, read-only).
8. **F27 (COMPLETE)**: fallback engine multi-trigger com `modelSwitch` = interface NO-OP implementada pelo F30; **F33 NÃO re-roteia em eventos de resiliência** (fronteira: fallback de execução ≠ roteamento). **F28 (COMPLETE)**: lessons com adendo via `before_agent_start`; **fronteira a decidir: lessons NÃO alteram rota** (rota = função pura do input; lessons informam prompts).
9. **F19 (COMPLETE)**: `sessionDriver` (ledger do glla — `isSupervising`: loop active OU goal active+autoContinue) + two-driver rules (ROUTING.md). **Fronteira: sessão supervisionada pelo goal-loop → routing INERTE** (o goal loop é o piloto; two-driver rule). **F24 (COMPLETE)**: freeze por sessão (D12), kill switch pattern (`RUNECRAFT_*_=0`), config aditiva no state (F13). **F26**: categorias tool-use correctness + routing completeness DESBLOQUEADAS pelo F32 — F33 preenche routing completeness com rota codificada (input → sequência de delegação).
10. **EVAL-MATRIX v10 atual (F32 planned)**: v11 (F33) aditiva APÓS F32 fechar v10 (one writer thread — F21 D9); `MIN_EVIDENCE_FILES` bump (AD-025); floor de testes sobe.

## Goals

- [ ] **Classificador determinístico puro** (`src/routing/classifier.ts`): input features → decisão de rota; thresholds explícitos em constantes; ZERO LLM; determinismo 2 runs; fail-closed (sem sinal → `direct`) — RTE-01
- [ ] **Catálogo de rotas como DADOS** (`src/routing/routes.ts`): 7 rotas mapeadas aos papéis F32 (explore→scout, research→researcher, implement→builder, review→reviewer, security→security, planning→planner, direct→sem delegação); keywords high/medium signal por rota (semântica do bard); segurança = OBRIGATÓRIA (bypassa threshold — espelho do paladin "not optional"); prioridade determinística em empate; features de arquivo (presença SDD `.specs/**/spec.md` → planning) — RTE-02
- [ ] **Extensão de routing no `before_agent_start`** (`src/extensions/routing.ts`): calcula a rota (classificação determinística de texto do prompt/tarefa — per STOP RULES), reescreve o systemPrompt com o ROUTING DIRECTIVE (rota + chain selecionada + alvos válidos F32); freeze por sessão (padrão F24 D12); kill switch `RUNECRAFT_ROUTING=0`; fail-closed — RTE-03
- [ ] **Pilot coordination = chains** (assets `packages/harness/chains/*.chain.md` + sync para `<cwd>/.pi/chains/`): chains de piloto (implement/plan/research/explore/security) codificando o loop do bard (PLAN → EXECUTE → VERIFY → REVIEW) com gate de review (veredito F32); selecionada pelo classificador; chain ausente → `direct` + warn (fail-closed, zero rotas inventadas) — RTE-04
- [ ] **Delegação integrada** (`call_guild_agent` → tool `subagent` F2): o directive usa `renderDelegationPrompt` + `buildKeyTriggersSection` (F32); sequência de delegação = passos da chain (runtime do fork spawna por passo); política F32 QA-5 preservada (só builder spawna in-role) — RTE-05
- [ ] **Fronteiras composicionais**: two-driver (sessão supervisionada → routing inerte — `sessionDriver` F19); F27 fallback NÃO re-roteia (rota congelada; fallback = execução); F30 modelos por papel consumidos (contrato de ids); F28 lessons informam prompts, NUNCA rotas — RTE-06/07
- [ ] **Evals EVAL-067..078** (suite `test/eval/suites/routing.ts`): determinismo, fail-closed, boundaries de threshold, segurança obrigatória, prioridade, trajectories scriptadas (input → sequência de delegação real no transcript) + EVAL-MATRIX **v11 aditiva** + `MIN_EVIDENCE_FILES` bump — RTE-08
- [ ] **Docs** (ROUTING.md §nova "Coded Routing & Pilot Coordination" — mecanismo, tabela de categorias, thresholds, chains, fronteiras; README; STATE.md AD-033) — RTE-09

## Out of Scope

| Feature | Reason |
| --- | --- |
| Port do mecanismo probabilístico do keyword-detector/bard (LLM decide rota) | Decisão 3c travada: rota é CÓDIGO puro com thresholds explícitos; a semântica de CATEGORIA é portada (sinais → rotas), o mecanismo (LLM decide) é substituído |
| Injeções "ULTRAWORK MODE"/"ulw" | Tema RPG (AD-022 decisão 2); sem valor determinístico; o PADRÃO keyword→injection vira keyword→route→directive |
| Bard como agente/subagente | F32 out-of-scope: "bard = lógica de orquestração → F33 (não vira subagente)" — a orquestração vira CÓDIGO (classificador) + DADOS (chains), nunca um 9º papel |
| Reimplementar o workflow engine do guild em runtime novo | A semântica (steps/gates/artifacts) vira CHAINS `.chain.md` consumidas pelo fork subagents (mecanismo nativo F30 AD-030) — sem engine novo |
| Reimplementar `call_guild_agent` | A tool `subagent` do fork (F2) É o equivalente nativo; F28 já observa delegação por ela |
| Rotas inventadas/fallback de rota | Fail-closed: sem sinal → `direct`; chain ausente → `direct` + warn; NUNCA inventar rota (espírito F30 D4) |
| Re-roteamento em eventos de resiliência (F27) | F27 fallback = execução (stall/quota/retry/modelSwitch F30); a ROTA é congelada por sessão (freeze F24 D12); fronteira explícita |
| Lessons (F28) alterando thresholds/rotas | Fronteira decidida (RTE-07): lessons informam PROMPTS (adendo F28 intacto), nunca rotas |
| Mudanças no fork subagents / F19 renderRules / F24 guards / F27 engine / F30 models / F32 catalog | Reuso read-only: chains (mecanismo nativo), sessionDriver, freeze/kill switch (padrão), modelSwitch (contrato), papéis (dados) |
| F8/F9/F10 (docs/publish/sync — barreiras M6) | STOP RULES: não desenhar barreiras/M6 |
| TUI / modal de modelo | AD-005 / decisão de escopo F30 |
| Replanejar F21..F32 | Política da casa |

## Gray area (resolver antes do Execute — 5 decisões)

Opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Hook do router** (D1): (a) **recomendado — `before_agent_start` (STOP RULES): classificação determinística do texto do prompt/tarefa; leitura da 1ª mensagem do usuário via client API read-only a validar no Execute** (evidência: F27 chaining types.d.ts:792; F28 adendo; call-guild-agent prova client.session.prompt retorna messages) · (b) extensão observando `turn_start`/`input` (NENHUM evento de input descoberto no surface F21..F28 — risco de invenção) · (c) tool que o agente principal chama (quebra 3c: a LLM decidiria chamar/ignorar o router)
- **QA-2 — Extensão da delegação** (D5): (a) **recomendado — mantém F32 QA-5 (só builder spawna in-role); pilot coordination = chains executadas pelo fork (o runtime nativo spawna os passos — o "piloto" é a chain, não um papel)** · (b) novos papéis ganham tool `subagent` · (c) sem chains no v1 (router só injeta directive; delegação fica por conta do agente)
- **QA-3 — Chain assets** (D4): (a) **recomendado — pilot chains versionadas em `packages/harness/chains/` + sync para `<cwd>/.pi/chains/` (alvo novo no sync; se F30 já criar o alvo chains p/ assets SDD, F33 REUSA o alvo — validar no Execute)** · (b) só chains do usuário (nenhuma builtin) · (c) chains em código (template strings — perde o mecanismo nativo do fork)
- **QA-4 — F28 lessons × routing** (D7): (a) **recomendado — lessons informam PROMPTS, nunca rotas (adendo F28 intacto; rota = função pura do input)** · (b) lessons ajustam thresholds (config derivada de lessons — quebra pureza/determinismo cross-session) · (c) lessons mudam a rota (veta 3c)
- **QA-5 — Evals de rota** (D8): (a) **recomendado — ScriptedScenario scripta input → trajectory-assertion da delegação REAL (tool `subagent` no transcript; F26 QA-2)** · (b) assert apenas sobre o directive injetado no prompt (mais fraco — não prova a delegação) · (c) ambos

**Já decidido (não é gray area):** determinismo (decisão 3c — rota por CÓDIGO, thresholds em código, nunca LLM; sem port do mecanismo probabilístico — só semântica de categoria) · zero deps novas · offline/$0 · escopo packages/harness · requirement IDs RTE-01..09 · EVAL-MATRIX **v11 aditivo** com notas datadas (F21 D9 — v11 após F32 fechar v10, one writer thread) · evidência via evalTest (F21) · rotas mapeadas aos papéis F32 (catalog.ts read-only) · chains no formato harness `.chain.md` (F30 AD-030) · delegação = tool `subagent` (F2) · pilot coordination = chain orchestration (não agente) · freeze por sessão + kill switch `RUNECRAFT_ROUTING=0` (padrões F24) · two-driver: sessão supervisionada (goal-loop) → routing inerte (F19 sessionDriver) · fail-closed em tudo (sem sinal → direct; chain ausente → direct + warn) · fronteira lessons×rotas: prompts sim, rotas não (RTE-07) · TUI fora (AD-005).

## User Stories

### P1: Classificador + catálogo + hook — RTE-01..03 ⭐ MVP

**User Story**: Como usuário, quero que o harness decida a rota de cada tarefa por CÓDIGO (features de entrada → rota, com thresholds explícitos e default fail-closed `direct`) e injete a decisão no início da sessão — para que a orquestração do bard exista no Pi sem LLM decidindo rota (decisão 3c).

**Why P1**: Roadmap F33; AD-022 decisão 3c (determinismo); F26 categoria routing completeness desbloqueada pelo F32 espera exatamente isto; sem roteamento codificado o harness depende do agente (LLM) decidir.

**Acceptance Criteria**:

1. WHEN `classifyRoute(input)` roda com um input sem sinais de rota THEN retorna `{ route: "direct" }` — fail-closed, nenhuma rota inventada
2. WHEN o input tem sinais de rota THEN a rota é decidida por score ponderado com thresholds EXPLÍCITOS em constantes (high-signal ×2, medium ×1, `ROUTE_THRESHOLD = 2`); rota de segurança com keyword high-signal → OBRIGATÓRIA (bypassa threshold — espelho do paladin "MUST... not optional")
3. WHEN duas rotas empatam THEN a prioridade determinística resolve (security > planning > implement > review > research > explore) — 2 runs byte-idênticos
4. WHEN a sessão inicia THEN a extensão `routing` hooka `before_agent_start` e reescreve o systemPrompt com o ROUTING DIRECTIVE (rota resolvida + chain selecionada + alvos válidos via `buildKeyTriggersSection` F32) — classificação determinística de texto (per STOP RULES); decisão congelada por sessão (padrão F24 D12)
5. WHEN `RUNECRAFT_ROUTING=0` THEN a extensão é inerte (nenhum rewrite, nenhuma decisão) — kill switch (padrão F20/F24)

**Independent Test**: unit puro do classificador (EVAL-067..071): determinismo 2 runs; fail-closed; boundaries de threshold (score 1 → direct, score 2 → rota); segurança obrigatória; prioridade em empate. Fixture F21 + fork materializado: sessão scriptada com input de rota → transcript contém a delegação esperada (EVAL-072..075); kill switch (EVAL-076).

### P1: Pilot coordination (chains) + delegação — RTE-04/05

**User Story**: Como usuário, quero que a rota selecione uma chain de piloto (`.chain.md` no formato harness — o workflow engine do guild como dados) que orquestra os papéis F32 (plan → execute → verify → review com gate de veredito) — para que a coordenação seja determinística e declarativa, não um 9º agente "bard".

**Why P1**: Roadmap F33 ("workflow engine do guild → chains/prompt templates"); F30 AD-030 (chains SDD formato harness); F32 QA-5 (só builder spawna); o piloto precisa orquestrar papéis SEM novo runtime.

**Acceptance Criteria**:

1. WHEN uma rota com chain resolvida inicia THEN o directive referencia a chain (`implement.chain.md`, `plan.chain.md`, `research.chain.md`, `explore.chain.md`, `security.chain.md`) e o fork a executa (passos por papel; gate = veredito `[APPROVE]/[REJECT]` do reviewer F32)
2. WHEN a chain referenciada NÃO existe em `<cwd>/.pi/chains/` THEN o router falha-closed: `direct` + warn (nunca inventa chain/rota)
3. WHEN a rota é `implement` THEN a chain executa builder → (gate) reviewer; a sequência de delegação real no transcript usa a tool `subagent` com `agent: "builder"`/`agent: "reviewer"` (F2; evento delegation F28)
4. WHEN a rota é `planning` E existe `.specs/**/spec.md` (SDD) THEN a chain plan roda planner → (gate) reviewer → builder; `call_guild_agent` do arcanum NÃO é portado — delegação é via tool `subagent` (F2)
5. WHEN um papel F32 (não-builder) roda THEN mantém a política F32 QA-5 (sem tool `subagent` no allowlist) — a orquestração é da CHAIN (runtime do fork), não do papel

**Independent Test**: chains versionadas == assets (golden F23); fixture: `.pi/chains/` com as 5 chains → sessão scriptada rota implement → trajectory-assertion `delegationSequence` com subagent(builder) + subagent(reviewer) + veredito (EVAL-075); chain ausente → direct + warn (EVAL-078); delegação real observada no evento F28.

### P2: Fronteiras + evals + docs — RTE-06..09

**User Story**: Como mantenedor, quero que o routing componha com F19 two-driver, F27 fallback, F30 modelos e F28 lessons por CONTRATO (sem retrofit) e que EVAL-067..078 provem o comportamento offline/$0 — matriz v11 — para o M8 fechar com a última feature garantida.

**Why P2**: Política da casa (F21 D9; fronteiras cross-feature AD-027/028); routing completeness é a categoria final do F26; F33 é a última feature do M8.

**Acceptance Criteria**:

1. WHEN a sessão é supervisionada pelo goal-loop (`sessionDriver` F19: loop active OU goal active+autoContinue) THEN o routing é INERTE (two-driver rule — o goal loop é o piloto; nenhum directive injetado)
2. WHEN um evento de resiliência dispara (F27: stall/quota/retry/modelSwitch) THEN a rota NÃO muda (congelada por sessão — F24 D12); modelSwitch (F30) troca MODELO, nunca rota
3. WHEN a chain referencia um papel THEN o modelo do passo resolve via F30 (`models.agents.<id>.fallbackChain`) — contrato de ids, zero mudança em `src/models/`
4. WHEN o F28 injeta adendo de lessons THEN o adendo NUNCA altera a rota (fronteira RTE-07: lessons informam prompts, não rotas; o router computa antes/independente do adendo)
5. WHEN a suite `routing` roda THEN EVAL-067..078 executam na lane F21 offline/$0 (fixture; zero LLM; zero rede); EVAL-MATRIX v11 aditivo (após F32 fechar v10); `MIN_EVIDENCE_FILES` bump (AD-025); 2 runs idênticos

**Independent Test**: fixture com ledger glla ativo → routing skip (EVAL-077); kill switch (EVAL-076); chain ausente (EVAL-078); determinismo (EVAL-067); trajectories reais (EVAL-072..075); consistência matriz↔suites v11.

## Edge Cases

- WHEN o input tem sinais de duas rotas com scores iguais THEN prioridade determinística (security > planning > implement > review > research > explore) — nunca aleatório
- WHEN o input tem keyword de segurança + outra rota THEN segurança VENCE (obrigatória — espelho do paladin; sem exceção)
- WHEN o score fica ABAIXO do threshold (ex.: 1 keyword medium) THEN `direct` (fail-closed; classificação conservadora — bard só delegava trabalho substancial)
- WHEN a rota resolvida não tem chain correspondente (catálogo mudou) THEN `direct` + warn (nunca inventa rota/chain)
- WHEN `.pi/chains/` não existe THEN o sync cria o dir (mkdir recursivo — precedente F32/agent-management) e instala as chains
- WHEN o usuário tem `.pi/chains/implement.chain.md` editado THEN o sync preserva (three-way F19 D7 "preservada (editada)" — nunca auto-cura; contentHash F13)
- WHEN o fork subagents não está instalado THEN as chains são dados inertes (nenhum efeito); status/doctor informam (matriz F17 — precedente F32)
- WHEN `state.routing` não existe THEN defaults do código valem (enabled: true, ROUTE_THRESHOLD=2, rotas do catálogo) — fail-visible
- WHEN a sessão é supervisionada (goal-loop) THEN routing inerte MAS kill switch/documentação valem (two-driver — o loop é o piloto)
- WHEN `before_agent_start` dispara para um SUBAGENTE (chain step) THEN o directive já congelado da sessão vale (sem re-classificação por passo — freeze por sessão; evita rotas diferentes por spawn)
- WHEN o modelo do passo não resolve (fim-de-chain F30) THEN null + warn (F30 D4 fail-visible — quem consome decide; a chain segue com o modelo default do fork)
- WHEN um caso roda 2x THEN resultados idênticos (sem $TMP/$TS — F21 D10)
- WHEN o usuário desabilita rotas no state THEN as rotas desabilitadas NÃO são selecionáveis (config aditiva; catálogo filtrado; fail-closed)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| RTE-01 | P1: Classificador determinístico puro (features → rota; thresholds em constantes; zero LLM; fail-closed direct) | Design | Pending |
| RTE-02 | P1: Catálogo de rotas como dados (7 rotas × papéis F32; keywords high/medium; segurança obrigatória; prioridade; features de arquivo/SDD) | Design | Pending |
| RTE-03 | P1: Extensão routing no `before_agent_start` (directive; freeze por sessão; kill switch `RUNECRAFT_ROUTING=0`; fail-closed) | Design | Pending |
| RTE-04 | P1: Chains de piloto (assets + sync `.pi/chains/`; gate de veredito; chain ausente → direct + warn) | Design | Pending |
| RTE-05 | P1: Delegação integrada (tool `subagent` F2; `renderDelegationPrompt`/`buildKeyTriggersSection` F32; política QA-5 preservada) | Design | Pending |
| RTE-06 | P2: Fronteiras F19/F27/F30 (two-driver inerte; fallback não re-roteia; modelos por papel via contrato) | Design | Pending |
| RTE-07 | P2: Fronteira F28 (lessons informam prompts, nunca rotas) | Design | Pending |
| RTE-08 | P2: Evals EVAL-067..078 + EVAL-MATRIX v11 + `MIN_EVIDENCE_FILES` bump + categorias routing completas | Design | Pending |
| RTE-09 | P2: Docs (ROUTING §nova, README, STATE.md AD-033) | Design | Pending |

**Coverage:** 9 total, 0 mapeados, 9 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Classificador puro com evidência: `src/routing/classifier.ts` — features de texto determinísticas, thresholds EXPLÍCITOS em constantes, zero LLM, 2 runs idênticos, fail-closed `direct` (sem sinal / abaixo do threshold / chain ausente)
- [ ] Catálogo de rotas como DADOS (`src/routing/routes.ts`): 7 rotas ↔ papéis F32 (explore→scout, research→researcher, implement→builder, review→reviewer, security→security, planning→planner, direct); keywords extraídas da semântica REAL do bard (prompt-composer.ts lido); segurança OBRIGATÓRIA (bypassa threshold); prioridade determinística; presença SDD → planning
- [ ] Mecanismo com evidência: hook = `before_agent_start` (F27 chaining types.d.ts:792; F28 adendo; STOP RULES — sem evento `input` no surface F21..F28; classificação de texto do prompt/tarefa, leitura da 1ª mensagem via client API a validar no Execute); freeze por sessão (F24 D12); kill switch `RUNECRAFT_ROUTING=0`
- [ ] Pilot coordination = chains (workflow engine do guild → `.chain.md` formato harness — f3-taskflow precedente, F30 AD-030): implement/plan/research/explore/security com gate de veredito F32; seleção pelo classificador; chain ausente → direct + warn (zero rotas/chain inventadas)
- [ ] Delegação integrada: `call_guild_agent` → tool `subagent` (F2); directive com `renderDelegationPrompt` + `buildKeyTriggersSection` (F32); política QA-5 preservada (só builder spawna in-role; orquestração = chain, não papel)
- [ ] Fronteiras explícitas: F19 two-driver (sessão supervisionada → inerte); F27 fallback NÃO re-roteia (rota congelada; modelSwitch F30 troca modelo); F30 modelos por papel (contrato de ids); F28 lessons → prompts, nunca rotas; fork consumido read-only
- [ ] EVAL-067..078 verdes offline/$0; EVAL-MATRIX v11 aditivo (após F32 fechar v10); routing completeness completa (F26 — última categoria); `MIN_EVIDENCE_FILES` bump; sem regressão
- [ ] Fronteiras de escopo: F8/F9/F10 (barreiras M6) NÃO desenhadas; keyword-detector probabilístico NÃO portado (só semântica); bard NÃO vira agente; zero deps novas
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
