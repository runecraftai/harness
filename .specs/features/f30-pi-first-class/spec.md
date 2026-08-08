# F30 — Pi First-Class & SDD Assets — Specification

**Scope:** Large (multi-component: persona do Pi via before_agent_start + port de rules-injector/first-message-variant + port de model-resolution com roteamento por agente + implementação da interface modelSwitch do F27 + geração de models.json + assets SDD (templates/prompt templates/chains) + port de archive_plan + evals — M8)
**Prereq (roadmap):** F15 ✓, F17 ✓, F24 ✓. **Efetivos:** F21 ✓ (fixture, ScriptedScenario, evalTest, EVAL-MATRIX), F26 ✓ (framework eval — categoria **model-failover BLOQUEADA até aqui**), F27 ✓ (interface `modelSwitch` NO-OP + chaining before_agent_start verificado), F28 (adendo encadeado — padrão), F29 (memória — matriz v7, one writer thread). **Não depende de** F31/F32/F33.
**Grupo:** M8 — Pi First-Class & Multi-Agent Expansion (primeira feature; decisão 4: garantias primeiro — M7 fechado em F29)

## Problem Statement

O harness entrega garantias (M7: execução F24, saída F25, resiliência F27, observabilidade F28, memória F29) e serve agentes não-Pi com rules/matriz (F15/F17/F19), mas **o Pi em si não é cidadão de primeira classe**: (1) o Pi NÃO recebe persona/regras hoje — `renderRules("pi")` (PI_RULES, 46 linhas — F19) existe e é golden-testado, mas **nenhum mecanismo o injeta na sessão Pi** (grep em src/pi.ts/src/adapters/agentOps.ts: zero escrita de prompt/AGENTS.md do lado Pi — verificado); (2) não há roteamento de modelo por agente — `state.ts`/`status.ts` não têm seção de modelos; o F27 deixou `modelSwitch` como interface NO-OP (`FallbackActionKind.modelSwitch` — "F30 implementa a resolução real"); (3) não há assets SDD versionados (templates/chains) nem arquivamento de planos — F1..F29 planejam com convenções ad-hoc (`.specs/`) sem templates reproduzíveis; (4) a categoria **failover** do eval-coverage do F26 está bloqueada até o model-resolution existir.

O arcanum resolve isso em `packages/guild` (rules-injector, first-message-variant, model-resolution, archive-plan) e `packages/familiar` (flow-orchestrator: detecção de escopo → seleção de chain). O port ao Pi exige trocar os mecanismos OpenCode/TUI por mecanismos reais do harness: `before_agent_start` encadeado (F27/F28 verificados), `renderRules("pi")` (F19, reuso), fixture models.json (F21), estado aditivo F13, chains `.pi/chains/*.chain.md` (formato do próprio harness — precedente f3-taskflow, consumido pelo fork subagents via `discoverAgentsAll`).

**Fatos verificados (sem fabricação — source lido na íntegra):**
1. **rules-injector** (`guild/src/hooks/rules-injector.ts`): funções puras — `findRulesFile` (AGENTS.md/.rules/CLAUDE.md), `loadRulesForDirectory`, `shouldInjectRules` (read/write/edit), `buildRulesInjection` (`<rules source="dir">`), `getRulesForFile`; consumidor = `application/policy/rules-tool-policy.ts` — **injeção no NÍVEL DE TOOL CALL, não before_agent_start**. Achado honesto: o wording do roadmap ("before_agent_start") difere do mecanismo do source → decisão explícita (QA-3).
2. **first-message-variant** (`guild/src/hooks/first-message-variant.ts`): estado em memória — Sets `created/applied`; `shouldApplyVariant(sessionId)` = created && !applied; `markSessionCreated/markApplied/clearSession/clearAll`; wiring em `create-hooks.ts`. Port direto com DI do sessionId; seleção determinística por `reason` da sessão (F27: initial vs resume|reload).
3. **model-resolution** (`guild/src/agents/model-resolution.ts`): `AGENT_MODEL_REQUIREMENTS` (chains por agente RPG com `{providers[], model, variant?}`), `resolveAgentModel` (precedência: override → uiSelected (primary/all) → categoryModel → fallbackChain custom > builtin → systemDefault → offline best-guess → hardcoded default), `getNextFallbackModel` (primeiro disponível APÓS o falho; `null` no fim da chain), `getKnownModels`. **TUI paths (uiSelected/agentMode/categoryModel) = fora de escopo (AD-005; decisão 3: roteamento codificado)**; **hardcoded default NÃO portado** (o harness não tem registry próprio de modelos — não inventar IDs; final = `null` + warn fail-visible); builtin chains por host = vazias (config via state).
4. **archive-plan** (`guild/src/tools/archive-plan.ts`): `createArchivePlanTool({directory, rename})` — slug regex `^[a-z0-9-]+$`, move `<plansDir>/<slug>` → `<plansDir>/archive/<slug>` (mkdir), retorno JSON `{ok, warnings}`; `PLANS_DIR` de `features/work-state/constants` (`.guild/plans`). Port → `.runecraft/plans/` (convenção de sinks do harness; **não existe dir de planos no harness hoje** — `src/plan.ts` é presets de install do F11, NÃO relacionado — documentado).
5. **flow-orchestrator (familiar)** — `extensions/flow-orchestrator.ts`: comando `/flow`, detecção de escopo (quick/medium/large), seleção de chain de `agent-chain.yaml` (`parseChainYaml`), gates G1/G6 (diálogos TUI). **Padrão a REUSAR** (escopo→chain), **mecanismo NÃO portável** (YAML + comando + TUI ≠ harness; zero deps). Chains do harness = `.pi/chains/*.chain.md` (f3-taskflow: front-matter `description` + `worker "..." -> reviewer "..."` com passos; consumido pelo fork subagents — `discoverAgentsAll(cwd).chains`). **Guild NÃO tem `prompts/`** (dir vazio); familiar tem `prompts/{commander,toolkit,toolkit-meta}` (específicos do familiar) → templates SDD = **autorais do harness, objetivos, sem RPG** (decisão 2).
6. **Mecanismo de modelos do SDK** — F21: `renderModelsJson(port)` (provider `fixture`, api `openai-completions`, baseUrl `http://127.0.0.1:<port>/v1`, apiKey literal) + `ModelRuntime.create({authPath, modelsPath, allowModelNetwork:false})` + `setRuntimeApiKey` + `getModel` (AD-021). **É o mecanismo determinístico para testar resolução por agente.** Path real de resolução do Pi (settings.json vs `~/.pi/models.json`) — **validar no Execute**; se models.json for o único mecanismo de troca, o plan = geração (D7) + flag (STOP rule: não inventar API de model-switch).
7. **Chaining before_agent_start VERIFICADO** — `src/extensions/resilience.ts:216` + `src/extensions/observability.ts:359` (append com markers `<!-- runecraft:continuation -->` / `<!-- runecraft:lessons -->`; types.d.ts:792). Nova extensão encadeia por append com marker próprio.
8. **`renderRules("pi")` = PI_RULES** — `src/adapters/rulesContent.ts:26` (46 linhas, "Runecraft workflow rules (v1)", golden routing-golden F19). **REUSO direto** como conteúdo das regras do Pi (zero duplicação de template; F19 continua dono).
9. **state.ts**: seções aditivas guards/verification/resilience/observability (+memory F29) — schemaVersion 1 (AD-013); **sem seção `models`/`persona`** — aditivo. `status.ts`: **sem seção Models** — aditivo. Kill switch convenção `RUNECRAFT_*_0` (F24/F25/F27/F28/F29); precedente env-gated `RUNECRAFT_VERIFY_LLM_JUDGE` (F25) para override de modelo.

## Goals

- [ ] **Persona objetiva do Pi**: extensão `persona` injeta via before_agent_start (marker `<!-- runecraft:persona -->`) texto objetivo de engenheiro sênior (SEM RPG — decisão 2), versionado (PERSONA_VERSION=1), golden-testado (padrão F19) — PFC-01
- [ ] **Rules injection do Pi**: port de rules-injector → before_agent_start (marker `<!-- runecraft:rules -->`), reusa `renderRules("pi")` (F19 — zero duplicação), encadeado com continuation (F27)/lessons (F28) — PFC-02
- [ ] **First-message variant**: port fiel (Sets created/applied em memória); seleção determinística por reason da sessão (initial → variante; resume|reload → sem re-aplicação — F27 dono da continuação); aplicado UMA vez por sessão — PFC-03
- [ ] **Model resolution**: port puro `src/models/` (resolveAgentModel/getNextFallbackModel/getKnownModels); agentes = pi/opencode/claude/codex (F31 copilot); TUI paths fora; sem IDs inventados (final = null + warn); chains custom via state — PFC-04
- [ ] **Config surface**: seções `models` + `persona` ADITIVAS no state (schemaVersion 1) + freeze por sessão + kill switches `RUNECRAFT_MODELS=0` / `RUNECRAFT_PERSONA=0` — PFC-05
- [ ] **modelSwitch implementado (F27)**: interface NO-OP ganha a resolução real (fallback leve→forte via getNextFallbackModel; chain esgotada → halt + escalação humana); ZERO mudanças nos arquivos do F27 — PFC-06
- [ ] **models.json generation**: CLI `harness models generate|list|doctor` (+ seção Models no status + check doctor); merge do config `models` → models.json (determinístico, testável via fixture F21); path do SDK a validar no Execute — PFC-07
- [ ] **SDD assets**: templates spec/design/tasks + prompt templates + chains `.pi/chains/sdd-*.chain.md` (formato do harness — precedente f3-taskflow) + `src/sdd/scope.ts` (classificação determinística quick/medium/large — limiares em código, decisão 3); autorais, objetivos — PFC-08
- [ ] **Archive de planos**: port de createArchivePlanTool → CLI `harness plans archive <slug>` (slug regex, move para `.runecraft/plans/archive/`, warnings) — PFC-09
- [ ] **Evals**: EVAL-039..048 (matriz **v8** aditiva); categoria **failover desbloqueada** (F26); determinismo via fixture models.json; live check env-gated NUNCA em CI; MIN_EVIDENCE_FILES bump (AD-025) — PFC-10

## Out of Scope

| Feature | Reason |
| --- | --- |
| TUI / modal de atribuição de modelo por agente | AD-005 (TUI fora); decisão 3 (roteamento codificado); superfície = state `models` + models.json (D5/D7) |
| Port do `/flow` / agent-chain.yaml do familiar | Mecanismo YAML + comando + gates TUI ≠ harness (zero deps); REUSO = padrão escopo→chain (D8) com chains no formato do próprio harness |
| Port das chains RPG do guild (bard/fighter/...) para o model-resolution | Decisão 2 (personas objetivas); F32 porta os papéis; F30 roteia por HOST (pi/opencode/claude/codex) |
| Injeção de rules em nível de tool call (semântica fiel do guild: `<rules source>` em read/write/edit) | QA-3; v1 = before_agent_start (roadmap); tool-call-level = flag P2 (default false) |
| Mudanças no F27 (fallback engine/escalation/budget) | Fronteira travada (D11): interface modelSwitch implementada, não alterada |
| Replanejar F21..F29 | Reuso de padrões (fixture F21, state F13, kill switch, markers F27/F28, EVAL-MATRIX) |
| Adapter copilot/vscode | F31 (independente; consome o config `models` via D5 — o módulo aceita qualquer nome de agente) |
| Papéis objetivos (planner/builder/...) e consumo do roteamento por subagentes | F32 (prereq F24, F30) |

## Gray area (resolver antes do Execute — 5 decisões)

Opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Chains SDD (formato/fonte)**: (a) **recomendado — autorais do harness no formato `.chain.md`** (precedente f3-taskflow; consumido pelo fork subagents via discoverAgentsAll; zero parser novo) · (b) port do agent-chain.yaml do familiar (YAML + parser novo + comando /flow — fora do padrão do harness)
- **QA-2 — Escalação do modelSwitch**: (a) **recomendado — automática leve→forte** dentro da chain do agente (getNextFallbackModel); chain esgotada → halt + escalação humana (ação halt do F27 = o "humano" do leve→forte→humano) · (b) só halt sem troca automática (modelSwitch resolve mas não aplica)
- **QA-3 — Nível da injeção de regras**: (a) **recomendado — before_agent_start** (wording do roadmap; chaining F27/F28 verificado; determinístico; zero overhead por tool call) · (b) tool-call-level (semântica fiel do guild — `<rules source>` em read/write/edit; mais invasivo; interage com guards F24)
- **QA-4 — models.json generation**: (a) **recomendado — CLI `harness models generate`** escreve models.json a partir do state `models` (merge aditivo; determinístico; testável via fixture) · (b) só estado + resolução em memória (sem arquivo — o SDK não veria as chains fora do override do fixture)
- **QA-5 — Superfície do archive de planos**: (a) **recomendado — CLI `harness plans archive <slug>`** (determinístico, testável, sem sessão) · (b) tool Pi `archive_plan` via registerTool (padrão F29 rune_*) · (c) ambos

**Já decidido (não é gray area):** zero deps novas; offline/$0; escopo packages/harness; requirement IDs PFC-01..10; EVAL-MATRIX v8 aditivo com notas datadas (F21 D9); evidência via evalTest() (F21); persona/rules/models objetivos SEM RPG (decisão 2); determinismo: roteamento codificado com limiares em código (decisão 3); agentes = pi, opencode, claude, codex (F31 copilot — AD-022 decisão 8); config via state aditivo + models.json generation; kill switch `RUNECRAFT_MODELS=0` (convenção); SDD assets versionados no pacote (templates + chains como arquivos); modelSwitch implementa a interface do F27 sem alterá-la (fronteira AD-027 QA-3); TUI fora (AD-005).

## User Stories

### P1: Pi first-class — persona + rules + first-message ⭐ MVP — PFC-01/02/03

**User Story**: Como usuário, quero que o Pi rode com uma persona objetiva de engenheiro sênior, as regras de workflow do harness (PI_RULES) e uma variante de primeira mensagem determinística — injetadas na sessão por mecanismos reais do Pi — para que o agente se comporte de forma consistente e profissional sem depender de lore.

**Why P1**: É o núcleo do "Pi first-class" (M8); hoje o Pi é o ÚNICO agente sem presença do harness na sessão (zero injeção Pi-side — verificado no recon).

**Acceptance Criteria**:

1. WHEN uma sessão Pi gerenciada inicia THEN a extensão persona encadeia no before_agent_start (append — padrão F27/F28) e o systemPrompt contém `<!-- runecraft:persona -->` + texto da persona E `<!-- runecraft:rules -->` + PI_RULES renderizada (renderRules("pi") — reuso F19, sem duplicação de template)
2. WHEN a sessão é inicial (session_start reason inicial/undefined) THEN a variante de primeira mensagem é aplicada UMA vez (Sets created/applied — port fiel); reason resume|reload → variante NÃO re-aplicada (continuação é dona do F27)
3. WHEN as extensões F27/F28 também encadeiam THEN todos os markers presentes na mesma sessão (persona + rules + continuation + lessons) — append order preservada, nenhum clobber
4. WHEN o texto é renderizado THEN é objetivo (engenheiro sênior; SEM termos RPG — assert de deny-list no eval) e versionado (PERSONA_VERSION=1; golden test — padrão renderRules F19)
5. WHEN `RUNECRAFT_PERSONA=0` THEN a extensão é inerte (sem injeção; zero arquivos; a sessão segue)
6. WHEN a mesma sessão roda 2x com o mesmo script THEN o systemPrompt injetado é IDÊNTICO (determinismo; markers/texto estáveis)

**Independent Test**: fixture F21 — sessão materializada com extensions (persona + resilience + observability) → assert systemPrompt contém markers persona/rules/continuation/lessons e PI_RULES; 2ª sessão reason=resume → variante ausente; 2 runs → injetado idêntico; kill switch → sem markers.

### P1: Model routing por agente + modelSwitch — PFC-04/05/06/07

**User Story**: Como mantenedor, quero rotear o modelo por agente (pi/opencode/claude/codex) com chains de fallback configuráveis no state e ver o F27 finalmente trocar de modelo (leve→forte→humano) — de forma determinística e testável — para que a resiliência (pilar 6) funcione de verdade.

**Why P1**: O F27 deixou modelSwitch NO-OP explicitamente ("F30 implementa a resolução real"); a categoria failover do F26 está bloqueada até aqui; per-agent models é o pilar do roteamento do M8.

**Acceptance Criteria**:

1. WHEN `resolveAgentModel(agent, opts)` roda THEN a precedência do source é fiel: override (env `RUNECRAFT_MODEL_OVERRIDE` ?? state `models.override`) → chain custom (state `models.agents.<id>.fallbackChain` > builtin) → systemDefault (state `models.default`) → **null + warn** (sem hardcoded — nada inventado; desvio documentado do guild)
2. WHEN `getNextFallbackModel(agent, failedModel, availableModels, chain)` roda THEN retorna o primeiro modelo disponível APÓS o falho na chain; fim da chain → null (semântica source)
3. WHEN o F27 dispara modelSwitch (rate-limit persistente — leve→forte) THEN a implementação do F30 resolve o próximo modelo via getNextFallbackModel; chain esgotada → halt + escalação humana (QA-2); ZERO mudanças nos arquivos do F27 (fronteira D11)
4. WHEN `harness models generate` roda THEN escreve/merge models.json a partir do state `models` (providers por agente); 2 runs → arquivo IDÊNTICO (sem timestamps); kill switch `RUNECRAFT_MODELS=0` → recusa sem escrever
5. WHEN o estado tem a seção `models` THEN a extensão/CLI consome (enabled/default/override/agents/autoGenerateModelsJson); ausente → defaults; inválida → defaults + reporte (fail-closed — padrão F24 D10); freeze por sessão
6. WHEN `status`/`doctor` rodam THEN há seção Models (resolução por agente com a chain atual) e check de doctor (path do models.json + paridade estado↔arquivo — a validar no Execute)

**Independent Test**: unit puro (precedência, chain custom, fim-de-chain); fixture F21 — models.json com N modelos fixture (renderModelsJson) → availableModels real via ModelRuntime → resolução determinística (primary indisponível → fallback selecionado); modelSwitch com trigger sintético do F27 (handlers exportados — padrão AD-027 QA-5); generate 2 runs idênticos; live check env-gated (padrão judge F25) NUNCA em CI.

### P2: SDD assets + archive de planos — PFC-08/09

**User Story**: Como usuário, quero que o harness venha com templates SDD objetivos (spec/design/tasks), prompt templates, chains de execução e arquivamento de planos — para que o fluxo spec-driven da casa seja reproduzível em qualquer repo, sem reinventar estrutura.

**Why P2**: F1..F29 planejam com convenções ad-hoc; assets versionados no pacote = o fluxo vira produto (chains no formato que o fork subagents já executa — precedente f3-taskflow).

**Acceptance Criteria**:

1. WHEN o pacote é instalado THEN `assets/sdd/templates/{spec.md,design.md,tasks.md}` + `assets/sdd/prompts/{spec,design,tasks,review}.md` + `.pi/chains/sdd-{spec,design,tasks,review}.chain.md` existem (versionados; conteúdo objetivo — sem RPG)
2. WHEN `harness sdd new <feature> --scope <quick|medium|large>` roda THEN scaffold de `.specs/features/<feature>/` a partir dos templates (placeholders substituídos; estrutura da casa — padrão F29)
3. WHEN `harness sdd chains` roda THEN lista as chains SDD com escopo recomendado (classificação determinística — src/sdd/scope.ts, limiares em código — decisão 3)
4. WHEN `harness plans archive <slug>` roda THEN valida o slug (regex `^[a-z0-9-]+$`), move `.runecraft/plans/<slug>` → `.runecraft/plans/archive/<slug>` e retorna `{ok, warnings}` (port createArchivePlanTool — D9); slug inválido/plano ausente → ok:false + warning (nunca crash)
5. WHEN um chain SDD é invocado (subagent do fork — discoverAgentsAll) THEN o formato é o do harness (front-matter + `worker "..." -> reviewer "..."` — precedente f3-taskflow) e referencia papéis objetivos existentes (worker/reviewer do fork — sem RPG)
6. WHEN o conteúdo SDD é auditado THEN nenhum termo RPG/persona de classe aparece (deny-list — EVAL-047)

**Independent Test**: unit — scope classification (limiares tabelados), templates render (placeholders), chains existem no formato do harness (parse front-matter + seções worker/reviewer), archive move/idempotente/slug inválido; integração — `sdd new` gera `.specs/features/x/spec.md` no shape da casa (confere contra o template do F29); goldens dos templates (ratchet F23).

### P2: Evals + governança — PFC-10

**User Story**: Como mantenedor, quero EVAL-039..048 provando persona/rules/variant/model-resolution/modelSwitch/generate/archive/sdd — matriz v8 aditiva, offline/$0 — para o Pi first-class não regredir e a categoria failover (F26) ficar desbloqueada com evidência.

**Why P2**: Mesma política dos demais pilares (F21 D9); o failover é a única categoria do F26 ainda bloqueada.

**Acceptance Criteria**:

1. WHEN a suite `pi` roda THEN EVAL-039..048 executam no runner do F26 offline/$0 (fixture F21 + models.json fixture)
2. WHEN o case de resolução roda THEN 2 runs produzem resultados IDÊNTICOS (mesmos availableModels/config — F21 D10)
3. WHEN a matriz roda THEN EVAL-MATRIX v8 aditiva (EVAL-039..048 + nota datada; bump 7→8 após F29 fechar v7 — one writer thread) e a consistência varre a suite nova; categoria failover DESBLOQUEADA na tabela de dependência do F26 (com nota)
4. WHEN `bun test` roda THEN sem regressão (pós-F29) + novos verdes offline/$0; zero chamadas LLM; live check (provedor real) só env-gated, fora de CI
5. WHEN um novo arquivo com evalTest entra THEN MIN_EVIDENCE_FILES bump (AD-025 — revisão como golden)

**Independent Test**: cada case valida schema F26; determinismo 2 runs; consistência matriz↔suites; evidência no last-run.json; goldens persona/rules/templates (F23).

## Edge Cases

- WHEN não há config `models` no state THEN defaults (enabled: true, default: null, override: null, agents: {}) — resolução cai para chain custom ausente → systemDefault null → null + warn (fail-visible; nada inventado)
- WHEN a chain do agente é vazia e não há default THEN resolveAgentModel retorna null (o caller — F27/CLI — trata com warn + halt humano; documentado)
- WHEN `RUNECRAFT_PERSONA=0` / `RUNECRAFT_MODELS=0` THEN extensão/CLI inertes (sem injeção/sem arquivo; CLI recusa com mensagem — fail-visible, padrão F29)
- WHEN a sessão é resume|reload THEN variante de primeira mensagem NÃO re-aplica (F27 dono da continuação; Sets em memória — nova instância de extensão = novo estado, documentado — semântica fiel do source)
- WHEN as extensões F27/F28 registram antes/depois da persona THEN append preserva todos os markers (ordem de registro = ordem de append — assert EVAL-040)
- WHEN o models.json do SDK não é encontrado/ilegível THEN availableModels = [] → resolução cai para override/chain/default; warn + doctor (fail-closed sem crash)
- WHEN `plans archive` roda 2x THEN o 2º run reporta plano ausente (ok:false + warning) — nunca move/exclui nada alheio; slug inválido → recusa antes de qualquer IO
- WHEN o mesmo comportamento já é coberto por EVAL-017..021/022..029/030..038 THEN sem duplicação — delta documentado no case (ex.: chaining já provado no F27/F28; F30 prova a ADIÇÃO da persona ao chain, não o chain em si)
- WHEN um caso roda 2x THEN resultados idênticos (sem $TMP/$TS — F21 D10; asserts excluem payload volátil)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PFC-01 | P1: Persona objetiva do Pi (before_agent_start, marker, versionado, golden) | Design | Pending |
| PFC-02 | P1: Rules injection Pi (port rules-injector → before_agent_start; reusa PI_RULES) | Design | Pending |
| PFC-03 | P1: First-message variant (port; determinística por reason; aplicada 1×) | Design | Pending |
| PFC-04 | P1: Model resolution (port resolveAgentModel/getNextFallbackModel/getKnownModels) | Design | Pending |
| PFC-05 | P1: Config surface `models`/`persona` (aditiva + freeze + kill switches) | Design | Pending |
| PFC-06 | P1: modelSwitch F27 implementado (leve→forte→humano; zero mudanças F27) | Design | Pending |
| PFC-07 | P1: models.json generation (CLI models generate/list/doctor + status/doctor) | Design | Pending |
| PFC-08 | P2: SDD assets (templates + prompts + chains + scope module) | Design | Pending |
| PFC-09 | P2: Archive de planos (CLI plans archive; port createArchivePlanTool) | Design | Pending |
| PFC-10 | P2: Evals EVAL-039..048 + EVAL-MATRIX v8 + failover desbloqueado | Design | Pending |

**Coverage:** 10 total, 0 mapeados, 10 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Pi recebe persona + rules na sessão via before_agent_start encadeado (markers persona/rules + PI_RULES — reuso F19, sem duplicação); texto objetivo sem RPG, versionado, golden-testado
- [ ] Variante de primeira mensagem aplicada 1× por sessão inicial; resume/reload sem re-aplicação (determinística por reason)
- [ ] Model resolution puro portado (precedência fiel; getNextFallbackModel; getKnownModels); sem IDs inventados (final = null + warn); agentes pi/opencode/claude/codex; chains custom via state
- [ ] modelSwitch do F27 implementado (leve→forte via chain; esgotada → halt humano); zero mudanças nos arquivos do F27
- [ ] Config `models` + `persona` aditivas no state (schemaVersion 1) + freeze + kill switches `RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0`
- [ ] CLI `harness models generate|list|doctor` determinístico (2 runs → arquivo idêntico) + seção Models no status + check doctor; path do SDK validado no Execute
- [ ] SDD assets versionados no pacote (templates spec/design/tasks + prompts + `.pi/chains/sdd-*.chain.md` no formato do harness); `harness sdd new|chains` com classificação codificada
- [ ] `harness plans archive <slug>` funcional (port createArchivePlanTool; `.runecraft/plans/`; warnings; idempotente)
- [ ] EVAL-039..048 verdes offline/$0; EVAL-MATRIX v8 aditivo com notas datadas; categoria failover (F26) desbloqueada; sem regressão pós-F29
- [ ] Fronteiras explícitas: F27 dono da interface modelSwitch (F30 implementa); F19 dono de PI_RULES (F30 reusa read-only); F31 independente; F32 consome o config `models`
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
