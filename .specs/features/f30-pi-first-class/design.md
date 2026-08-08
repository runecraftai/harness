# F30 Design — Pi First-Class & SDD Assets

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-030)
**Decisões aprovadas (usuário/briefing, travadas):** decisão 2 (personas objetivas — SEM RPG) · decisão 3 (determinismo: roteamento codificado, limiares em código) · decisão 4 (garantias antes — M7 fechado; F30 = primeira feature M8) · decisão 8 (agentes = pi, opencode, claude, codex; F31 copilot) · zero deps novas · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v8 com notas datadas (F21 D9) · evidência via evalTest (F21) · kill switch `RUNECRAFT_MODELS=0` (convenção) · SDD assets versionados no pacote (templates + chains como arquivos) · modelSwitch implementa a interface do F27 sem alterá-la · TUI fora (AD-005)

## Contexto

F19 entregou `renderRules(agentId)` com **PI_RULES** (46 linhas, golden routing-golden) mas **nada injeta no Pi** — recon: grep em src/pi.ts/src/adapters/agentOps.ts → zero escrita de prompt/AGENTS.md do lado Pi. F24/F25/F27/F28/F29 entregaram garantias com o padrão da casa (kill switch, freeze, markers, chaining before_agent_start VERIFICADO em src/extensions/resilience.ts:216 + observability.ts:359). F27 deixou `FallbackActionKind.modelSwitch` como INTERFACE NO-OP (src/resilience/types.ts:115; fallback.ts:129–131 — "modelSwitch (interface; implementação NO-OP no F27 — F30 resolve)"). F26 deixou a categoria **model-failover bloqueada** ("→ F30"). O Pi é o único agente sem presença do harness na sessão.

**Fontes do port (lidas na íntegra):**
- `guild/src/hooks/rules-injector.ts` — funções puras; consumidor `rules-tool-policy.ts` (nível tool call — achado honesto, D2/QA-3)
- `guild/src/hooks/first-message-variant.ts` — Sets em memória created/applied; wiring em create-hooks.ts
- `guild/src/agents/model-resolution.ts` — AGENT_MODEL_REQUIREMENTS + resolveAgentModel + getNextFallbackModel + getKnownModels
- `guild/src/tools/archive-plan.ts` — createArchivePlanTool (slug regex + move + warnings; PLANS_DIR `.guild/plans`)
- `familiar/extensions/flow-orchestrator.ts` — padrão escopo→chain; /flow + agent-chain.yaml + gates TUI (mecanismo NÃO portável — D8)

**Evidência no harness/SDK (verificada):**
1. Chaining before_agent_start: F27 (continuation) + F28 (lessons) — ambos `pi.on("before_agent_start")` retornando `{systemPrompt}` com markers (append; types.d.ts:792).
2. `renderRules("pi")` → `PI_RULES` (src/adapters/rulesContent.ts:26, "Runecraft workflow rules (v1)") — reuso read-only (F19 dono).
3. Fixture F21: `renderModelsJson(port)` (provider `fixture`, openai-completions, baseUrl loopback) + `ModelRuntime.create({modelsPath})` + `getModel` — mecanismo determinístico de modelos (AD-021).
4. Chains do harness: `.pi/chains/f3-taskflow.chain.md` (formato real: front-matter description + `worker "..." -> reviewer "..."` com passos) consumido pelo fork subagents (`discoverAgentsAll(cwd).chains` — slash-commands.ts:180).
5. state.ts: seções aditivas (schemaVersion 1 — AD-013); SEM `models`/`persona` hoje. status.ts: SEM seção Models. `src/plan.ts` = presets de install do F11 (NÃO é dir de planos — dir de planos é NOVO, `.runecraft/plans/`).
6. Kill switch convenção `RUNECRAFT_*_0` (F24/F25/F27/F28/F29); precedente env-gated `RUNECRAFT_VERIFY_LLM_JUDGE` (F25) → `RUNECRAFT_MODEL_OVERRIDE`.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Persona do Pi = extensão `persona` com before_agent_start** (PFC-01): texto objetivo de engenheiro sênior (autorral do harness, sem RPG — decisão 2) versionado `PERSONA_VERSION=1` em template literal `src/persona/persona.ts` (padrão renderRules F19 — golden-testável); injeção via `pi.on("before_agent_start")` append com marker `<!-- runecraft:persona -->` (chaining F27/F28 — ordem de registro = ordem de append; assert EVAL-040); config `persona` (D5); kill switch `RUNECRAFT_PERSONA=0`; determinístico (mesma sessão 2 runs → mesmo texto). Guia AGENTS.md-equivalent = `docs/PI.md` (D8) | Mecanismo REAL do Pi (types.d.ts:792 — chaining verificado); template literal = golden F23 + zero IO em runtime; marker = convenção F27/F28 (nunca sobrescreve — append); decisão 2 (objetivo, sem lore) |
| D2 | **Rules injection Pi = port de rules-injector em before_agent_start** (PFC-02): conteúdo = `renderRules("pi")` (PI_RULES — REUSO, zero duplicação; F19 dono) embrulhado com marker `<!-- runecraft:rules -->`; compose com persona (persona → rules → [continuation F27] → [lessons F28] — append order). **Achado honesto:** o source do guild injeta em TOOL-CALL-LEVEL (rules-tool-policy: read/write/edit com `<rules source="dir">`); o roadmap pede before_agent_start — port do INTENTO no mecanismo do harness (chaining verificado; determinístico; zero overhead por tool call); tool-call-level = flag `persona.rulesInjector.toolCallLevel: false` (P2 — QA-3) | Wording do roadmap (contrato M8); chaining verificado (resilience.ts:216); reuso do F19 evita template duplicado; tool-call-level interagiria com guards F24 (mais invasivo — P2) |
| D3 | **First-message variant = port fiel** (PFC-03): Sets em memória `created/applied` (port AS-IS de first-message-variant.ts) com DI do sessionId (do event); `pi.on("session_start")` → markSessionCreated(sessionId, reason); `before_agent_start` → shouldApplyVariant? → anexa a variante + markApplied; **seleção determinística por reason**: inicial/undefined → variante (intro persona+rules); resume\|reload → SEM variante (F27 dono da continuação — fronteira); aplicado UMA vez por sessão; estado em memória por processo (nova instância de extensão = novo estado — semântica fiel do source, documentado) | Port fiel (evals comparam contra o source); determinismo por reason (F27 estabeleceu initial/resume/reload — fallback honesto); sem estado em disco (variante é apresentação, não dado) |
| D4 | **Model resolution = port puro `src/models/`** (PFC-04): `resolveAgentModel(agent, {availableModels, overrideModel, systemDefaultModel, customFallbackChain})` — precedência do source SEM os paths TUI (uiSelectedModel/agentMode/categoryModel DROPPED — AD-005/decisão 3); `getNextFallbackModel(agent, failedModel, availableModels, chain)` — semântica fiel (primeiro disponível após o falho; null no fim); `getKnownModels()`. **Adaptações honestas:** (a) agentes = HOSTS (pi/opencode/claude/codex) — não RPG (decisão 2); builtin `AGENT_MODEL_REQUIREMENTS` do harness = `{}` (o harness não tem registry próprio; modelos vêm do models.json do SDK — **não inventar IDs**; chains = config via state); (b) hardcoded default do source (`anthropic/claude-opus-4.6`) NÃO portado → final = `null` + warn (fail-visible; quem consome decide halt); (c) customFallbackChain = `state.models.agents.<id>.fallbackChain` (precedência sobre builtin — semântica source) | Fidelidade de precedência (evals vs fixtures do source); honestidade: registry de modelos é do SDK (F21/AD-021), não do harness; TUI paths violariam decisão 3; `null` evita fabricar ID de modelo |
| D5 | **Config surface = seções `models` + `persona` ADITIVAS no state** (PFC-05): `models: {enabled: true, default: string\|null, override: string\|null, agents: Record<string, {fallbackChain: FallbackEntry[]}>, autoGenerateModelsJson: false}` e `persona: {enabled: true, rulesInjector: {enabled: true, toolCallLevel: false}, firstMessageVariant: {enabled: true}}` (schemaVersion 1 — padrão guards/verification/resilience; defaults fail-visible; validação runtime fail-closed → defaults + reporte ao doctor; freeze por sessão = snapshot no init — D12 F24); envs: `RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0` (kill), `RUNECRAFT_MODEL_OVERRIDE` (override — precedente env-gated F25 judge) | Padrão da casa (F24/F25/F27/F28/F29); additive sem bump de schema (AD-013); kill switches testáveis (EVAL-048); env override dá o knob de teste determinístico |
| D6 | **modelSwitch F27 implementado** (PFC-06): `src/models/switch.ts` — `resolveModelSwitch(agent, failedModel, availableModels, config)` → próximo modelo via getNextFallbackModel (chain leve→forte); chain esgotada (null) → `{kind: "halt", reason: "model-chain exhausted", escalation: "human"}` (QA-2a recomendado — ação halt do F27 + handoff humano = o "humano" do leve→forte→humano); wiring com o F27: a interface NO-OP vira a resolução real no ponto de consumo (slot de DI/deps **a validar no Execute** — garantia: NENHUM arquivo do F27 alterado; touch mínimo aditivo = flag explícito); budget/orçamento continuam donos do F27 | Fronteira travada no AD-027 QA-3 ("policy agora, model-switch depois"); a resolução é pura (testável isolada); o mecanismo de APLICAÇÃO da troca depende do SDK (D7 — validar no Execute) |
| D7 | **models.json generation = CLI** (PFC-07): `harness models generate|list|doctor` — generate: merge do `state.models` → models.json (providers por agente; shape estendido do renderModelsJson F21; determinístico — sem timestamps/paths; 2 runs → byte-idêntico); path de escrita/resolução do SDK (`.pi/agent/settings.json` vs `~/.pi/models.json`) **a validar no Execute** (STOP rule: se models.json for o único mecanismo de troca, o plan = geração + flag "validar no Execute"; **nenhuma API de model-switch em runtime descoberta no SDK 0.81.0**); list: tabela de resolução por agente (chain atual + modelo resolvido); doctor: check novo (paridade estado↔arquivo + availableModels); status: seção Models aditiva; kill switch → recusa sem escrever | O mecanismo real do SDK é models.json (F21 prova: ModelRuntime.create({modelsPath}) + getModel); geração = superfície determinística e auditável (arquivo versionável); TUI de atribuição fora (AD-005) |
| D8 | **SDD assets = autorais, objetivos, formato do harness** (PFC-08): templates `assets/sdd/templates/{spec.md,design.md,tasks.md}` (shape da casa — padrão F29: Problem Statement/Goals/Out of Scope/Gray area/User Stories/Edge Cases/Traceability/Success Criteria \| Contexto/Decisões/Arquitetura/Fluxos/Tabelas/Riscos \| Base/Tasks/Verificar) + prompt templates `assets/sdd/prompts/{spec,design,tasks,review}.md` + chains `.pi/chains/sdd-{spec,design,tasks,review}.chain.md` (formato REAL do harness — f3-taskflow: front-matter description + `worker "..." -> reviewer "..."`; consumido pelo fork subagents via discoverAgentsAll — zero parser novo; papéis = worker/reviewer existentes, sem RPG); `src/sdd/scope.ts` = classificação determinística quick/medium/large (limiares em código — nº de arquivos/frases, decisão 3; espelho da auto-sizing do tlc-spec-driven); `harness sdd new <feature> --scope <...>` (scaffold `.specs/features/<feature>/` dos templates) + `harness sdd chains` (lista + escopo recomendado). **Reuso do PADRÃO do flow-orchestrator do familiar** (escopo→chain) SEM portar YAML//flow/gates TUI (zero deps; AD-005) | Guild não tem prompts/ (vazio); familiar tem prompts específicos (não reutilizáveis) — templates autorais; formato .chain.md = o que o fork já executa (precedente real f3-taskflow); limiares codificados = decisão 3 (determinismo); assets como arquivos = constraint do briefing |
| D9 | **Archive de planos = CLI** (PFC-09): `harness plans archive <slug>` — port de `createArchivePlanTool` (slug regex `^[a-z0-9-]+$`; move `<plansDir>/<slug>` → `<plansDir>/archive/<slug>`; mkdir archive; retorno `{ok, warnings}` JSON; DI rename p/ teste — semântica source); plans dir = `.runecraft/plans/` (convenção de sinks do harness; **dir NOVO** — src/plan.ts é presets F11, não relacionado — documentado; validar no Execute se há convenção melhor). QA-5 decide CLI vs tool vs ambos (recomendado CLI) | Port fiel (semântica + warnings); CLI = determinístico/testável sem sessão (padrão F29 memory CLI); `.runecraft/plans/` = mesmo local dos demais sinks (events/lessons/continuation/verify-verdicts) |
| D10 | **Evals = EVAL-039..048, EVAL-MATRIX v8 aditivo** (PFC-10): suite `test/eval/suites/pi.ts` — persona (injeção + markers), rules (chaining com continuation/lessons — sem clobber), first-message (1×; resume sem re-aplicação; determinismo 2 runs), resolution (precedência; chain custom; fim-de-chain → null), modelSwitch (trigger sintético — handlers exportados, padrão AD-027 QA-5; next model; exhausted → halt), generate (byte-idêntico 2 runs; merge; kill switch), archive (move/idempotente/slug inválido), sdd (scope limiares; chains formato harness; templates goldens; **deny-list de termos RPG** ausente do conteúdo renderizado), config/kill switches; **categoria failover DESBLOQUEADA** na tabela de dependência do F26 (nota datada); lane F21 offline/$0; live check env-gated (padrão judge F25) fora de CI; consistência v8; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest) | Política aditiva (F21 D9); failover = categoria do F26 bloqueada "→ F30" — desbloqueio com evidência; determinismo via fixture models.json (F21); deny-list = decisão 2 verificável |
| D11 | **Fronteiras**: F27 dono da interface modelSwitch (F30 implementa a resolução no ponto de consumo; ZERO mudanças em src/resilience/ — fallback.ts/types.ts intactos); F19 dono de renderRules/PI_RULES (F30 reusa read-only — rulesContent.ts intocado); F28/F27 donos de continuation/lessons (persona NÃO duplica; só anexa); F21 dono da fixture (F30 usa renderModelsJson/modelos fixture); F31 independente (adapter copilot — `models.agents.copilot` quando existir; o módulo aceita qualquer nome de agente, semântica source); F32 consome per-agent models (chains por papel objetivo via state); EVAL-MATRIX one writer thread (bump v8 após F29 fechar v7) | Contratos cross-feature explícitos (padrão AD-027 QA-3 / AD-028 OBS-09); sem retrofit em features fechadas |

## Arquitetura — módulos

```
packages/harness/
├── src/persona/
│   ├── index.ts              # exports públicos
│   ├── config.ts             # seção `persona` no state (D5) + kill switch + freeze
│   ├── persona.ts            # PERSONA_VERSION=1 template literal (golden — padrão F19) — objetivo, sem RPG
│   ├── rules.ts              # buildRulesInjection(content): marker <!-- runecraft:rules --> + PI_RULES (renderRules("pi") — reuso F19)
│   ├── first-message.ts      # port first-message-variant (Sets created/applied; DI sessionId; reason) (D3)
│   └── inject.ts             # composeInjection(persona, rules, variant) — ordem: persona → rules → [continuation F27] → [lessons F28] (append)
├── src/extensions/persona.ts # installPersona(pi): session_start (mark created) + before_agent_start (shouldApplyVariant → inject + markApplied); kill switch → no-op
├── extensions/persona.ts     # export default (padrão guards/resilience) + manifest pi.extensions
├── src/models/
│   ├── index.ts
│   ├── types.ts              # FallbackEntry, AgentModelRequirement (port)
│   ├── defaults.ts           # AGENT_MODEL_REQUIREMENTS harness = {} (hosts pi/opencode/claude/codex; SEM IDs inventados) (D4)
│   ├── resolution.ts         # resolveAgentModel/getNextFallbackModel/getKnownModels (port; TUI paths dropped; final null+warn) (D4)
│   ├── config.ts             # seção `models` no state (D5) + env override + kill switch + freeze
│   ├── registry.ts           # availableModels: leitura do models.json (SDK — path a validar) / injetável p/ teste (fixture F21)
│   ├── generate.ts           # renderModelsJsonFromConfig(state.models) — providers por agente; determinístico (D7)
│   ├── switch.ts             # resolveModelSwitch (D6) — implementação da interface modelSwitch do F27
│   └── cli.ts                # harness models generate|list|doctor (D7)
├── src/sdd/
│   ├── index.ts
│   ├── scope.ts              # classificação determinística quick/medium/large (limiares em código — decisão 3) (D8)
│   ├── templates.ts          # load/render dos templates (assets/sdd/templates/) (D8)
│   ├── chains.ts             # metadata das chains SDD (.pi/chains/sdd-*.chain.md) + seleção por escopo (D8)
│   ├── archive.ts            # port createArchivePlanTool (slug regex; move p/ archive/; warnings; DI rename) (D9)
│   └── cli.ts                # harness sdd new|chains + harness plans archive (D8/D9)
├── assets/sdd/
│   ├── templates/{spec.md, design.md, tasks.md}
│   └── prompts/{spec.md, design.md, tasks.md, review.md}
├── .pi/chains/sdd-{spec,design,tasks,review}.chain.md   # formato do harness (f3-taskflow) — consumido pelo fork subagents
├── docs/PI.md                # persona + rules + models (guia AGENTS.md-equivalent; ROUTING §novo)
├── src/commands/status.ts    # seção Models (aditiva) (D7)
├── src/commands/doctor.ts    # check novo (models path/paridade) (D7)
└── test/
    ├── persona/ models/ sdd/ # unit puro (fs temp; DI onde aplicável) + integração fixture
    └── eval/suites/pi.ts     # cases EVAL-039..048 (D10)
```

## Fluxos

### F1 — Sessão Pi → persona + rules + variante (PFC-01/02/03)

```
1. init da extensão persona: RUNECRAFT_PERSONA=0? → no-op
2. freeze do config `persona` (D5)
3. pi.on("session_start") → markSessionCreated(sessionId, reason)
4. pi.on("before_agent_start") → composeInjection(persona(PERSONA_VERSION=1) + rules(renderRules("pi")) + [continuation F27] + [lessons F28]) — append com markers;
   shouldApplyVariant(sessionId)? → variante de primeira mensagem + markApplied
5. reason resume|reload → variante NÃO aplicada (F27 dono da continuação)
6. sessionId desconhecido (nova instância/processo) → estado em memória zerado (semântica fiel do source — documentado)
```

### F2 — Resolução de modelo por agente (PFC-04/05)

```
resolveAgentModel(agent, {availableModels,
  overrideModel: RUNECRAFT_MODEL_OVERRIDE ?? models.override,
  systemDefaultModel: models.default,
  customFallbackChain: models.agents[agent]?.fallbackChain})
  → override → chain (custom > builtin {}) → systemDefault → null + warn (nada inventado — D4)
getNextFallbackModel(agent, failedModel, availableModels, chain) → primeiro disponível APÓS o falho; null no fim
availableModels ← registry (models.json do SDK — path a validar; fixture injeta Set — F21)
```

### F3 — modelSwitch (PFC-06)

```
F27 fallback engine detecta rate-limit persistente → modelSwitch (interface NO-OP)
F30 resolveModelSwitch(agent, failedModel, availableModels, config):
  next = getNextFallbackModel(...) → aplica a troca (mecanismo: models.json/API — a validar no Execute; D7)
  next = null → halt + escalação humana (leve→forte→humano)
zero mudanças no F27 (slot de consumo a validar no Execute — garantia de fronteira D11)
```

### F4 — models generate (PFC-07)

```
harness models generate → merge state.models → models.json (determinístico; 2 runs byte-idênticos)
harness models list → tabela de resolução por agente (chain atual + modelo resolvido)
harness models doctor → check: path do models.json + paridade estado↔arquivo + availableModels
kill switch → recusa "models disabled (RUNECRAFT_MODELS=0)" (nada escrito)
```

### F5 — SDD (PFC-08/09)

```
harness sdd new <feature> --scope quick|medium|large → src/sdd/scope.ts classifica (limiares em código) → scaffold .specs/features/<feature>/ dos templates
harness sdd chains → lista sdd-{spec,design,tasks,review}.chain.md + escopo recomendado
agente invoca chain via fork subagents (discoverAgentsAll — mecanismo existente, precedente f3-taskflow)
harness plans archive <slug> → valida slug → move .runecraft/plans/<slug> → .runecraft/plans/archive/<slug> → {ok, warnings}
```

### F6 — CI (PFC-10)

```
bun test test/eval (preloads F21..F29) → EVAL-039..048 offline/$0 (models.json fixture);
consistência matriz↔suites v8; categoria failover desbloqueada (F26); MIN_EVIDENCE_FILES bump;
kill switches não afetam a suite; sem regressão pós-F29; live check env-gated fora de CI
```

## Tabela de mapeamento source → harness

| source (arcanum) | Decisão | Adaptação no port | Evidência |
| --- | --- | --- | --- |
| `rules-injector.ts` (guild) | ADAPT — before_agent_start | tool-call-level (rules-tool-policy) → before_agent_start (roadmap; chaining F27/F28); conteúdo = renderRules("pi") (F19, reuso); tool-call-level = flag P2 (QA-3) | rulesContent.ts:26 (PI_RULES); resilience.ts:216 |
| `first-message-variant.ts` (guild) | PORT (fiel) | Sets created/applied em memória; DI sessionId; seleção por reason da sessão (initial vs resume/reload); aplicado 1× | create-hooks.ts wiring |
| `model-resolution.ts` (guild) | PORT (semântica) | agentes RPG → hosts (pi/opencode/claude/codex); TUI paths dropped (AD-005/decisão 3); builtin chains = {} (sem IDs inventados); hardcoded default → null+warn | model-resolution.ts (lido na íntegra) |
| `archive-plan.ts` (guild) | ADAPT — CLI | `tool()` OpenCode → `harness plans archive`; PLANS_DIR `.guild/plans` → `.runecraft/plans/`; DI rename p/ teste | archive-plan.ts |
| `flow-orchestrator.ts` (familiar) | PADRÃO REUSADO | escopo→chain (scope.ts + chains .chain.md); NÃO porta YAML//flow/gates TUI | f3-taskflow.chain.md; discoverAgentsAll |
| TUI model modal / uiSelected | DROP | superfície = state `models` + models.json (D5/D7) | AD-005; decisão 3 |

## Tabela de mecanismos (o que existe → o que F30 constrói)

| Mecanismo | Existe (SDK 0.81.0 / harness) — evidência | F30 constrói |
| --- | --- | --- |
| before_agent_start chaining | resilience.ts:216 + observability.ts:359 (append + markers) ✓ | extensions/persona.ts (F1) |
| Regras do Pi | renderRules("pi") = PI_RULES (rulesContent.ts:26, golden F19) ✓ | rules.ts (reuso read-only) |
| Variante por sessão | SDK session_start reason (F27: resume/reload) ✓ | first-message.ts (port) |
| Model resolution | NENHUM no harness (só no guild) | src/models/resolution.ts (D4) |
| Model switch | F27 FallbackActionKind.modelSwitch NO-OP (types.ts:115) ✓ | src/models/switch.ts (D6) |
| Registry de modelos | ModelRuntime.create({modelsPath}) + getModel (F21/AD-021) ✓ | registry.ts (path real a validar) |
| models.json fixture | renderModelsJson(port) (test/eval/layer2/fixture) ✓ | evals EVAL-042/043 (D10) |
| Estado aditivo + kill switch | state.ts schemaVersion 1 (AD-013); RUNECRAFT_*_0 ✓ | seções `models`+`persona` (D5) |
| Chains | .pi/chains/f3-taskflow.chain.md + discoverAgentsAll ✓ | .pi/chains/sdd-*.chain.md (D8) |
| CLI subcomando | dispatch F11 (install/verify/lessons/memory...) ✓ | `harness models|sdd|plans` (D7/D8/D9) |
| Eval framework | F26 runner/evaluators + EVAL-MATRIX ✓ | suite pi.ts EVAL-039..048 (D10) |

## EVAL-MATRIX — entradas aditivas v8 (política F21 D9)

| ID | Fluxo | Script esperado | Notas |
| --- | --- | --- | --- |
| EVAL-039 | persona Pi | sessão fixture materializada com extensions (persona+resilience+observability) → systemPrompt contém `<!-- runecraft:persona -->` + PERSONA_VERSION=1 + texto objetivo (golden); 2 runs idênticos | D1; chaining sem clobber |
| EVAL-040 | rules + chaining | systemPrompt contém `<!-- runecraft:rules -->` + PI_RULES + markers continuation/lessons (todos presentes; ordem de append) | D2; reuso F19 |
| EVAL-041 | first-message variant | sessão initial → variante 1× (markApplied); 2ª sessão reason=resume → sem variante; determinismo 2 runs | D3 |
| EVAL-042 | model resolution | models.json fixture (renderModelsJson, N modelos) → availableModels real; precedência (override → custom chain → default → null); chain custom > builtin; fim-de-chain → null + warn | D4; categoria failover |
| EVAL-043 | modelSwitch F27 | trigger sintético (handlers exportados — AD-027 QA-5) → resolveModelSwitch retorna próximo modelo; chain esgotada → halt + escalação humana; assert de diff: arquivos do F27 intactos | D6 |
| EVAL-044 | models generate | generate 2 runs → byte-idêntico (merge state.models); kill switch recusa sem escrever; list/doctor shapes | D7 |
| EVAL-045 | archive de planos | plans fixture → archive move + {ok,warnings}; 2º run → ok:false plano ausente; slug inválido → recusa antes de IO | D9 |
| EVAL-046 | sdd scope + chains | scope.ts limiares (quick/medium/large — casos tabelados); chains sdd-*.chain.md existem e parseiam no formato do harness (front-matter + worker/reviewer) | D8 |
| EVAL-047 | templates SDD | sdd new → scaffold .specs/features/x/ no shape da casa (confere vs F29); templates goldens (F23); deny-list de termos RPG ausente do conteúdo renderizado | D8; decisão 2 |
| EVAL-048 | config/kill switches | state `models`+`persona` defaults/freeze; `RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0` → camadas inertes + CLI recusa; determinismo 2 runs | D5 |

Nota datada v8: Pi first-class (persona/rules/variant), roteamento de modelo por agente e modelSwitch reais (categoria **failover desbloqueada** no F26); SDD assets versionados. tool-use/routing (F32) segue SEM entradas (política aditiva — nada sai sem AD). Bump de MATRIX_VERSION 7→8 depende do F29 fechar a v7 (one writer thread).

## Integração CI

- **Roda com**: mesma lane F21..F29 — `bun test test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM (F30 é determinístico por construção — exceto live check env-gated, fora de CI)
- **Evidência**: evalTest() nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (identidade estável — F21 D10; asserts excluem payload volátil)
- **Consistência**: matrix-consistency v8 varre `test/eval/suites` incluindo pi.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- **Kill switches**: RUNECRAFT_MODELS=0/RUNECRAFT_PERSONA=0 testados (camadas inertes; suite verde)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Path real do models.json / API de troca de modelo em runtime não descoberta no SDK 0.81.0** | STOP rule: plan = geração (D7) + flag "validar no Execute"; se models.json for o único mecanismo, troca em runtime = resolver + aplicar via geração/restart ou API a validar — NUNCA inventar API |
| **Slot de consumo do modelSwitch no F27 (sem tocar arquivos)** | Fronteira D11: F30 entrega a resolução pura + wiring no ponto de consumo se houver slot/DI; qualquer touch mínimo aditivo = flag explícito + aprovação |
| **Ordem de append do before_agent_start (registro de extensões)** | Verificado F27/F28 (append); EVAL-040 asserta presença de TODOS os markers; ordem documentada (persona → rules → continuation → lessons) |
| **Conteúdo da persona "vazar" lore/tema** | Decisão 2; deny-list de termos RPG no EVAL-047; golden F23 |
| **renderRules("pi") muda no futuro (F19 dono)** | Reuso read-only; golden do F19 já cobre; F30 consome a função, não duplica o texto |
| **F29 ainda em execução (v7 da matriz / memory suite)** | Bump v8 após F29 fechar v7 (one writer thread); delta vs EVAL-030..038 documentado no case |
| **Sem dir de planos no harness (`.runecraft/plans/` novo)** | Convenção de sinks (events/lessons/continuation/verify-verdicts); validar no Execute contra convenção existente; src/plan.ts NÃO é dir de planos (documentado) |
| **Chains SDD invocadas por subagent — formato do fork muda** | Chains no formato do harness (precedente f3-taskflow); parse mínimo no EVAL-046; fork é nosso (F2) — sync F10 cobre |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| PFC-01 | P1: Persona | D1 + src/persona/persona.ts + extensions/persona.ts + EVAL-039 |
| PFC-02 | P1: Rules injection | D2 + src/persona/rules.ts + EVAL-040 |
| PFC-03 | P1: First-message variant | D3 + src/persona/first-message.ts + EVAL-041 |
| PFC-04 | P1: Model resolution | D4 + src/models/resolution.ts + EVAL-042 |
| PFC-05 | P1: Config surface | D5 + src/persona/config.ts + src/models/config.ts + EVAL-048 |
| PFC-06 | P1: modelSwitch F27 | D6 + src/models/switch.ts + EVAL-043 |
| PFC-07 | P1: models.json generation | D7 + src/models/{generate,cli,registry}.ts + status/doctor + EVAL-044 |
| PFC-08 | P2: SDD assets | D8 + src/sdd/* + assets/sdd/ + .pi/chains/sdd-* + EVAL-046/047 |
| PFC-09 | P2: Archive de planos | D9 + src/sdd/archive.ts + EVAL-045 |
| PFC-10 | P2: Evals + governança | D10 + test/eval/suites/pi.ts + EVAL-MATRIX v8 |

**Cobertura:** 10/10 mapeados. Edges da spec: sem config → defaults (D5) · chain vazia → null+warn (D4) · kill switches → inertes (D5) · resume/reload → sem variante (D3) · extensões múltiplas → markers todos (D1/D2) · models.json ilegível → availableModels=[] + doctor (D7) · archive 2x → ok:false (D9) · duplicação EVAL → delta no case (D10) · 2 runs → idênticos (D10).

**Pontos a validar no Execute** (consolidado): path real do models.json que o SDK lê (settings.json vs `~/.pi/models.json`) e existência de API de troca de modelo em runtime; slot de consumo do modelSwitch no F27 sem alterar arquivos (ou touch mínimo aditivo flag); ordem real de append com 3+ extensões (registro); dir de planos (`.runecraft/plans/` vs convenção existente); deny-list de termos RPG disponível no src/eval (F26) ou lista própria; shape do EVAL-MATRIX em disco (bump 7→8 após F29).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Chains SDD** (D8): (a) **recomendado — autorais no formato `.chain.md` do harness** (f3-taskflow; consumido pelo fork subagents; zero parser novo) · (b) port do agent-chain.yaml do familiar (YAML + /flow — fora do padrão)
2. **QA-2 — Escalação do modelSwitch** (D6): (a) **recomendado — automática leve→forte** via getNextFallbackModel; esgotada → halt + escalação humana · (b) só halt (resolução sem aplicar)
3. **QA-3 — Nível da injeção de regras** (D2): (a) **recomendado — before_agent_start** (roadmap; chaining verificado) · (b) tool-call-level (semântica fiel do guild — `<rules source>` em read/write/edit; mais invasivo)
4. **QA-4 — models.json generation** (D7): (a) **recomendado — CLI `harness models generate`** (merge determinístico do state; testável via fixture) · (b) só estado + resolução em memória
5. **QA-5 — Superfície do archive** (D9): (a) **recomendado — CLI `harness plans archive <slug>`** · (b) tool Pi `archive_plan` · (c) ambos
