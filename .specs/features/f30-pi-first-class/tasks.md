# F30 — Tasks (Pi First-Class & SDD Assets)

**Base:** design.md D1–D11 (aguarda QA-1..QA-5 → AD-030) · infra reutilizada: F13 (state schema v1 aditivo), F19 (`renderRules("pi")`/PI_RULES — reuso read-only), F21 (fixture, ScriptedScenario, evalTest → evidência, EVAL-MATRIX, renderModelsJson), F24 (RUNECRAFT_AGENT_ID, freeze D12, kill switch), F26 (framework eval; categoria failover bloqueada → desbloqueia), F27 (interface modelSwitch NO-OP — src/resilience/types.ts:115; chaining before_agent_start — resilience.ts:216; continuation), F28 (lessons adendo encadeado — observability.ts:359), F29 (memória; matriz v7 — one writer thread), fonte: guild {rules-injector, first-message-variant, model-resolution, archive-plan} + familiar flow-orchestrator (padrão escopo→chain — D8)
**Dependências de decisão:** T1/T2 (QA-3 rules level — afeta flag toolCallLevel) · T5 (QA-2 escalation) · T6/T7 (QA-1 chains) · T4 (QA-4 generation) · T6 (QA-5 archive surface) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/persona/{persona.ts, rules.ts, first-message.ts, inject.ts, config.ts} (D1/D2/D3/D5, PFC-01/02/03/05) — depende QA-3

- [ ] `persona.ts`: `PERSONA_VERSION = 1`; template literal com a persona objetiva de engenheiro sênior (autorral do harness; SEM termos RPG — decisão 2; deny-list de termos no teste); formato de golden (padrão renderRules F19 — routing-golden)
- [ ] `rules.ts`: `buildRulesInjection(piRules)` → `<!-- runecraft:rules -->\n<piRules>` — conteúdo = `renderRules("pi")` (PI_RULES — reuso F19, import da função existente, ZERO duplicação do texto); marker na convenção F27/F28
- [ ] `first-message.ts`: port AS-IS de `first-message-variant.ts` (Sets `created/applied` em memória; `markSessionCreated/markApplied/shouldApplyVariant/clearSession/clearAll`) + DI do sessionId e do reason (do event); `variantForReason(reason)` — inicial/undefined → variante; resume|reload → null (F27 dono da continuação); determinístico
- [ ] `inject.ts`: `composeInjection({persona, rules, variant})` — append order: persona → rules → [continuation F27] → [lessons F28] (cada item com seu marker; NUNCA sobrescreve — append); retorna `{systemPrompt}` no shape do BeforeAgentStartEventResult
- [ ] `config.ts`: seção `persona` ADITIVA no state (schemaVersion 1 — padrão guards/verification/resilience): `{enabled: true, rulesInjector: {enabled: true, toolCallLevel: false}, firstMessageVariant: {enabled: true}}`; `defaultPersonaConfig()` + `loadPersonaConfig(state)` com validação runtime fail-closed (inválida → defaults + reporte ao doctor); freeze por sessão (snapshot no init — D12 F24); kill switch `RUNECRAFT_PERSONA=0|false|off` (convenção F20)
- [ ] **Verificar:** unit — persona golden (byte-a-byte vs baseline F23); buildRulesInjection com marker; first-message port (criação→aplica→2ª aplicação negada; clear; reason resume → null); composeInjection ordem dos markers; config defaults/freeze/kill parse; deny-list RPG ausente do texto da persona; TSC limpo; zero deps novas (audit de imports)

## T2 — src/extensions/persona.ts + extensions/persona.ts + manifest (D1/D2/D3, PFC-01/02/03) — depende T1; QA-3 afeta só a flag

- [ ] `src/extensions/persona.ts`: `installPersona(pi, deps?)` — kill switch `RUNECRAFT_PERSONA=0` → no-op; freeze do config; `pi.on("session_start", ...)` → markSessionCreated(sessionId, reason); `pi.on("before_agent_start", ...)` → shouldApplyVariant? → inject + markApplied; composeInjection com persona+rules (+ continuation/lessons são donos F27/F28 — F30 só anexa); falha de render → sessão segue sem injeção + aviso (fail-soft — injeção de prompt não é gate)
- [ ] `extensions/persona.ts`: `export default function registerPersona(pi)` → `installPersona(pi)` (padrão guards/resilience); manifest `pi.extensions` += `./extensions/persona.ts`
- [ ] **Verificar:** fixture F21 — sessão com extensions (persona + resilience + observability) → systemPrompt contém markers persona/rules/continuation/lessons e PI_RULES (EVAL-039/040); 2ª sessão reason=resume → sem variante (EVAL-041); kill switch → sem markers; chaining com guards/resilience intacto (registro aditivo; sem colisão de markers — validar lista real de markers no fixture); determinismo 2 runs

## T3 — src/models/{types.ts, defaults.ts, resolution.ts, registry.ts} (D4, PFC-04) — pode rodar em paralelo com T1/T2

- [ ] `types.ts`: port de `FallbackEntry {providers, model, variant?}` e `AgentModelRequirement {fallbackChain}` (types puros — sem zod)
- [ ] `defaults.ts`: `AGENT_MODEL_REQUIREMENTS` do harness = `{}` (hosts pi/opencode/claude/codex — SEM IDs inventados; chains vêm do state — D4; comentário honesto no código: o harness não tem registry próprio; modelos são do models.json do SDK)
- [ ] `resolution.ts`: port de `resolveAgentModel` — precedência: overrideModel (env `RUNECRAFT_MODEL_OVERRIDE` ?? config) → customFallbackChain (config) > builtin → systemDefaultModel → **null + warn** (hardcoded default do source NÃO portado — D4); **TUI paths dropped** (uiSelectedModel/agentMode/categoryModel); `getNextFallbackModel(agent, failedModel, availableModels, chain)` — semântica source (primeiro disponível após o falho; null no fim); `getKnownModels()`; aceita QUALQUER nome de agente (F31 copilot/F32 papéis — semântica source)
- [ ] `registry.ts`: `resolveAvailableModels()` — leitura do models.json do SDK (path **a validar no Execute**: settings.json vs `~/.pi/models.json`; precedente F21 `ModelRuntime.create({modelsPath})`); injetável para teste (fixture F21 fornece o Set); ilegível/ausente → `[]` + warn (fail-closed sem crash)
- [ ] **Verificar:** unit espelhando a semântica do source (tabela de precedência: override > custom > default > null; fim-de-chain null; chain custom > builtin); availableModels vazio → null + warn (nada inventado); 2 runs idênticos; TSC limpo; zero deps novas

## T4 — src/models/{config.ts, generate.ts, cli.ts} + status/doctor (D5/D7, PFC-05/07) — depende T3; QA-4

- [ ] `config.ts`: seção `models` ADITIVA no state (schemaVersion 1): `{enabled: true, default: string|null, override: string|null, agents: Record<string, {fallbackChain: FallbackEntry[]}>, autoGenerateModelsJson: false}`; `defaultModelsConfig()` + `loadModelsConfig(state)` fail-closed; freeze por sessão; kill switch `RUNECRAFT_MODELS=0|false|off`; env `RUNECRAFT_MODEL_OVERRIDE` (override — precedente env-gated F25 judge)
- [ ] `generate.ts`: `renderModelsJsonFromConfig(config)` — merge do state `models` → shape models.json (extensão do renderModelsJson F21: provider por agente; baseUrl/loopback via env p/ teste); **determinístico** (sem timestamps/paths absolutos; 2 runs → byte-idêntico)
- [ ] `cli.ts`: `harness models generate|list|doctor` (subcomandos novos no dispatch F11): generate → escreve models.json (merge aditivo; path a validar no Execute); list → tabela de resolução por agente (chain atual + modelo resolvido via T3); doctor → check de paridade estado↔arquivo + availableModels; kill switch → recusa "models disabled (RUNECRAFT_MODELS=0)" exit 0 (nada criado)
- [ ] `status.ts` seção Models (aditiva — resolução por agente) + `doctor.ts` check novo (models path/paridade — numeração pós-F29 a validar no Execute)
- [ ] **Verificar:** unit — generate 2 runs byte-idênticos (merge state); kill switch recusa sem criar arquivo; list/doctor shapes; config defaults/freeze/parse; comando no dispatch (contrato F11); status/doctor sem crash com state sem `models`

## T5 — src/models/switch.ts (D6, PFC-06) — depende T3; QA-2

- [ ] `resolveModelSwitch(agent, failedModel, availableModels, config)` — próximo modelo via `getNextFallbackModel` (chain leve→forte do agente); chain esgotada (null) → `{kind: "halt", reason: "model-chain exhausted", escalation: "human"}` (QA-2a recomendado); retorna `{kind: "switch", model, from}` quando há próximo — implementação da interface `FallbackActionKind.modelSwitch` do F27 (src/resilience/types.ts:115 — NENHUM arquivo do F27 alterado; wiring no ponto de consumo: slot/DI **a validar no Execute**; touch mínimo aditivo = flag explícito)
- [ ] **Verificar:** unit — trigger sintético (handlers exportados — padrão AD-027 QA-5): próximo modelo correto; fim-de-chain → halt+human; determinismo 2 runs; **assert de diff**: arquivos do F27 (fallback.ts/types.ts) byte-idênticos após a integração (EVAL-043)

## T6 — src/sdd/{scope.ts, templates.ts, chains.ts, archive.ts, cli.ts} (D8/D9, PFC-08/09) — QA-1/QA-5

- [ ] `scope.ts`: `classifyScope({fileCount, sentenceCount, ...})` → quick|medium|large — limiares em CÓDIGO (decisão 3; espelho da auto-sizing: ≤3 arquivos/1 frase → quick; <10 tasks → medium; multi-componente → large); tabela de casos no teste (determinístico)
- [ ] `templates.ts`: `renderTemplate(name, vars)` — load de `assets/sdd/templates/{spec,design,tasks}.md` + substituição de placeholders (`{{feature}}`, `{{scope}}`, `{{prereq}}`...) — scaffold `.specs/features/<feature>/` no shape da casa (padrão F29)
- [ ] `chains.ts`: metadata das chains `.pi/chains/sdd-{spec,design,tasks,review}.chain.md` (nome, descrição do front-matter, escopo recomendado) + `selectChain(scope)` — leitura mínima (front-matter) sem parser YAML (zero deps)
- [ ] `archive.ts`: port de `createArchivePlanTool` — slug regex `^[a-z0-9-]+$`; move `<plansDir>/<slug>` → `<plansDir>/archive/<slug>` (mkdir recursive); DI `rename` p/ teste (semântica source); retorno `{ok, warnings}` JSON; plano ausente → ok:false + warning (nunca crash)
- [ ] `cli.ts`: `harness sdd new <feature> [--scope <quick|medium|large>]` (scaffold via templates; sem --scope → classifica via scope.ts) + `harness sdd chains` (lista + escopo recomendado) + `harness plans archive <slug>` (QA-5a recomendado); subcomandos no dispatch F11
- [ ] **Verificar:** unit — scope limiares (casos tabelados); templates render (placeholders; shape conferido contra o template F29 real); chains metadata (front-matter parseável; seções worker/reviewer presentes — formato f3-taskflow); archive move+idempotente (2º run ok:false)+slug inválido (recusa antes de IO); CLI no dispatch; determinismo 2 runs

## T7 — assets/sdd/ + .pi/chains/sdd-* + docs/PI.md + ROUTING (D8, PFC-08) — paralelo

- [ ] `assets/sdd/templates/{spec.md, design.md, tasks.md}`: templates autorais no shape da casa (Problem Statement/Goals/Out of Scope/Gray area/User Stories/Edge Cases/Traceability/Success Criteria | Contexto/Decisões/Arquitetura/Fluxos/Tabelas/Riscos | Base/Tasks/Verificar) com placeholders; conteúdo OBJETIVO (sem RPG — decisão 2; deny-list no EVAL-047)
- [ ] `assets/sdd/prompts/{spec.md, design.md, tasks.md, review.md}`: prompt templates das fases (objetivos, sem lore; PT-BR — preferência da casa)
- [ ] `.pi/chains/sdd-{spec,design,tasks,review}.chain.md`: formato REAL do harness (precedente f3-taskflow — front-matter `description` + `worker "..." -> reviewer "..."` com passos); papéis worker/reviewer (existentes no fork — sem RPG); QA-1a recomendado
- [ ] `docs/PI.md`: persona (PERSONA_VERSION), rules (PI_RULES + marker), models (config/resolução/CLI), first-message variant, fronteiras (F19 dono de PI_RULES; F27 dono da interface); seção nova no `docs/ROUTING.md` (padrão F19)
- [ ] **Verificar:** arquivos versionados no pacote (constam no files/package); chains parseiam (EVAL-046); templates goldens (F23 — novos baselines); docs conferidas contra src (checklist: markers, PERSONA_VERSION, kill switches, comandos CLI); ROUTING atualizado sem quebrar goldens do F19 (renderRules NÃO muda)

## T8 — evals EVAL-039..048 + matriz v8 + consistência + MIN_EVIDENCE_FILES (D10, PFC-10) — depende T1..T7

- [ ] Suite `test/eval/suites/pi.ts` + cases EVAL-039..048 (formato F26): EVAL-039 persona (systemPrompt com marker + PERSONA_VERSION + golden; 2 runs), EVAL-040 rules+chaining (markers persona/rules/continuation/lessons todos presentes; ordem), EVAL-041 first-message (initial → 1×; resume → sem variante; determinismo), EVAL-042 model resolution (models.json fixture com N modelos → availableModels real via ModelRuntime; precedência override/custom/default/null), EVAL-043 modelSwitch (trigger sintético → next model; exhausted → halt+human; diff F27 intacto), EVAL-044 models generate (2 runs byte-idênticos; kill switch), EVAL-045 archive (move/2º run ok:false/slug inválido), EVAL-046 sdd scope+chains (limiares; formato harness), EVAL-047 templates (sdd new shape da casa; goldens; deny-list RPG), EVAL-048 config/kill switches (defaults/freeze/`RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0`); delta vs EVAL-017..021/022..029/030..038 documentado em comentário em cada case (ex.: chaining já provado no F27/F28 — F30 prova a ADIÇÃO da persona)
- [ ] EVAL-MATRIX v8 aditivo (bump MATRIX_VERSION 7→8 após F29 fechar v7 — one writer thread; EVAL-039..048 + nota datada); **categoria failover desbloqueada** na tabela de dependência do F26 (nota datada — "implementável após F30"); teste de consistência estendido para varrer a suite pi; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- [ ] Live check (provedor real) env-gated fora de CI (padrão judge F25 — `RUNECRAFT_MODELS_LIVE=1` explícito)
- [ ] **Verificar:** EVAL-039..048 verdes offline/$0 na lane F21 (loopback, apiKey literal, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..038; consistência matriz↔suites v8 verde

## Success Criteria (spec)

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

## Traceability PFC → tasks

| Requirement | Tasks |
| --- | --- |
| PFC-01 (persona) | T1, T2, T7, T8 |
| PFC-02 (rules injection) | T1, T2, T7, T8 |
| PFC-03 (first-message variant) | T1, T2, T8 |
| PFC-04 (model resolution) | T3, T8 |
| PFC-05 (config surface) | T1, T4, T8 |
| PFC-06 (modelSwitch F27) | T5, T8 |
| PFC-07 (models.json generation) | T4, T8 |
| PFC-08 (SDD assets) | T6, T7, T8 |
| PFC-09 (archive de planos) | T6, T8 |
| PFC-10 (evals + governança) | T8 |

**Cobertura:** 10/10 · toda user story da spec tem requirement ID (PFC-01..10) · todo requisito tem task.
