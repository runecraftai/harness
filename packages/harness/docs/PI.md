# Pi First-Class — Persona, Rules, Model Routing & SDD Assets (F30)

> Guia do Pi como cidadão de primeira classe do harness (F30, M8): persona +
> rules injetadas na sessão via `before_agent_start`, roteamento de modelo por
> agente (pi/opencode/claude/codex), modelSwitch do F27 implementado,
> geração de models.json e os assets SDD (templates/prompts/chains) + archive
> de planos. Fronteiras explícitas no final.

## 1. Persona do Pi (PERSONA_VERSION=1)

A extensão `persona` (`extensions/persona.ts` → `src/extensions/persona.ts` →
`src/persona/`) injeta a persona objetiva de engenheiro sênior no
`before_agent_start` ENCADEADO (append — nunca sobrescreve; o runner re-passou
o systemPrompt por extensão — SDK types.d.ts ~790).

- Texto: `src/persona/persona.ts` — `PERSONA_VERSION = 1`, template literal
  constant (golden F23 — byte a byte; deny-list de termos RPG no EVAL-047).
- Marker: `<!-- runecraft:persona -->` (convenção F27/F28).
- Kill switch: `RUNECRAFT_PERSONA=0|false|off` → camada inerte (zero injeção).
- Config `persona` (state.json aditivo — schemaVersion 1):
  `{enabled: true, rulesInjector: {enabled: true, toolCallLevel: false},
  firstMessageVariant: {enabled: true}}`. Inválida → defaults seguros +
  reporte (fail-closed F24 D10); freeze por sessão (F24 D12).

## 2. Rules injection (reuso PI_RULES do F19)

`src/persona/rules.ts` injeta `renderRules("pi")` (PI_RULES — F19 é o DONO do
texto; F30 reusa read-only, zero duplicação) com o marker
`<!-- runecraft:rules -->`. **Achado honesto (QA-3):** o source do guild
(`guild/src/hooks/rules-injector.ts`) injeta em TOOL-CALL-LEVEL
(rules-tool-policy — `<rules source="dir">` em read/write/edit); o F30 porta o
INTENTO para `before_agent_start` (wording do roadmap; chaining verificado;
determinístico; zero overhead por tool call). Tool-call-level = flag P2
(`persona.rulesInjector.toolCallLevel: false` — default; não portado em v1).

## 3. First-message variant (port fiel)

`src/persona/first-message.ts` — port AS-IS do
`guild/src/hooks/first-message-variant.ts`: Sets em memória `created/applied`
por processo (nova instância de extensão = novo estado — semântica fiel do
source, documentado). Seleção determinística por reason da sessão (F27):
`initial/undefined` → variante aplicada UMA vez; `resume|reload` → NUNCA
re-aplicada (a continuação é dona do F27 — fronteira D11).

## 4. Model routing por agente (src/models/)

Resolução pura (`src/models/resolution.ts` — port da semântica do
`guild/src/agents/model-resolution.ts`, lido na íntegra):

```
resolveAgentModel(agent, {availableModels, overrideModel, systemDefaultModel, customFallbackChain})
  → override (env RUNECRAFT_MODEL_OVERRIDE ?? state models.override)
  → custom chain (state models.agents.<id>.fallbackChain) > builtin ({} — harness sem registry próprio)
  → systemDefault (state models.default)
  → null + warn (NENHUM ID inventado; o hardcoded default do source NÃO é portado — D4)
getNextFallbackModel(agent, failedModel, availableModels, chain) → primeiro disponível APÓS o falho; fim → null
getKnownModels(chains) → ids conhecidos das chains configuradas
```

- Agentes = HOSTS: pi/opencode/claude/codex (decisão 8; F31 adiciona copilot —
  o módulo aceita qualquer nome de agente).
- TUI paths do source (uiSelectedModel/agentMode/categoryModel) DROPPED
  (AD-005/decisão 3 — roteamento codificado).
- `availableModels` vem do models.json do SDK (`src/models/registry.ts`).
  **Path REAL validado no Execute:** o SDK 0.81.0 carrega de
  `<agentDir>/models.json` — agentDir = `PI_CODING_AGENT_DIR` ?? `~/.pi/agent`
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:59`
  — `modelsPath = options.modelsPath ?? join(getAgentDir(), "models.json")`;
  config.js:412-425). NÃO é settings.json nem `~/.pi/models.json`. O harness
  resolve o mesmo arquivo via `piAgentDir(env)` (RUNECRAFT_PI_HOME ??
  `~/.pi/agent` — config.ts).

## 5. Config `models` (state.json aditivo)

`{enabled: true, default: string|null, override: string|null,
agents: Record<id, {fallbackChain: FallbackEntry[]}>, autoGenerateModelsJson:
false}`. Fail-closed (inválida → defaults + reporte), freeze por sessão, kill
switch `RUNECRAFT_MODELS=0|false|off`, override env
`RUNECRAFT_MODEL_OVERRIDE` (precedente env-gated do judge F25).

## 6. modelSwitch F27 implementado (src/models/switch.ts)

O F27 deixou `FallbackActionKind.modelSwitch` como INTERFACE NO-OP
(`src/resilience/types.ts:115`; `fallback.ts:129-131`; `ModelSwitchInterface`
em `fallback.ts:175`). O F30 implementa a resolução REAL:

```
resolveModelSwitch(agent, {failedModel, availableModels, chain})
  → {kind: "switch", model, from}   (próximo via getNextFallbackModel — leve→forte)
  → {kind: "halt", reason: "model-chain exhausted", escalation: "human"}
```

**Fronteira D11:** ZERO mudanças nos arquivos do F27 (EVAL-043 asserta o diff
byte a byte). **Mecanismo de APLICAÇÃO (validado no Execute):** o SDK 0.81.0
NÃO tem API de troca de modelo em runtime (model-runtime.js/model-registry.js
sem switchModel/setModel/reloadModels) — models.json é o único mecanismo
(provado pela fixture F21). Aplicar a troca = regenerar o models.json com a
chain (D7) + restart/reload da sessão (documentado — sem API inventada).

## 7. CLI `harness models generate|list|doctor`

- `harness models generate` → merge determinístico do state `models` →
  models.json (`<piAgentDir>/models.json`); 2 runs → byte-idêntico
  (canonicalJson F23 — sem timestamps/paths). Provider config (baseUrl/api/
  apiKey) NUNCA é inventada: herdada do models.json existente ou de env
  (`RUNECRAFT_MODELS_PROVIDER_<ID>_{BASEURL,API,APIKEY}`); ausente → omitida
  (o schema do SDK aceita providers sem baseUrl — model-config.js
  ProviderConfigSchema). Kill switch → recusa sem escrever (exit 0).
- `harness models list` → tabela de resolução por agente (chain atual +
  modelo resolvido).
- `harness models doctor` → path + paridade estado↔arquivo + availableModels.
- `harness status` → seção **Models (F30)**; `harness doctor` → check 20.

## 8. SDD assets (F30 — versionados no pacote)

| Asset | Local | Uso |
| --- | --- | --- |
| Templates spec/design/tasks | `assets/sdd/templates/` | scaffold via `harness sdd new` |
| Prompt templates | `assets/sdd/prompts/` | fases spec/design/tasks/review (objetivos, PT-BR) |
| Chains SDD | `assets/sdd/chains/sdd-*.chain.md` | formato do fork subagents (`pi.subagents.chains` na manifest + materializadas em `.pi/chains/`) |
| Escopo | `src/sdd/scope.ts` | classificação determinística quick/medium/large (limiares em código — decisão 3) |

Comandos: `harness sdd new <feature> [--scope quick|medium|large]` (scaffold +
materialização das chains em `.pi/chains/`), `harness sdd chains` (lista +
escopo recomendado).

**Formato das chains (achado honesto do Execute):** o parser ATUAL do fork
subagents (0.37.2) é `parseChain` (`chain-serializer.ts:101`) — front-matter
`name` + `description` obrigatórios + seções `## <agente>` (worker/reviewer —
builtin do fork, sem RPG). O `f3-taskflow.chain.md` (formato histórico
`worker "..." -> reviewer "..."`) NÃO parseia no fork atual — os assets F30
seguem o formato que o fork parseia HOJE (EVAL-046 valida com o parser real).

## 9. Archive de planos (F30)

`harness plans archive <slug>` — port do `createArchivePlanTool` do guild
(`guild/src/tools/archive-plan.ts`, lido na íntegra): slug regex
`^[a-z0-9-]+$`; move `<cwd>/.runecraft/plans/<slug>` →
`<cwd>/.runecraft/plans/archive/<slug>` (mkdir recursive); retorno
`{ok, warnings}`; DI rename p/ teste. `src/plan.ts` é presets de install do
F11 — NÃO é dir de planos (documentado; `.runecraft/plans/` é o sink novo —
mesma convenção de events/lessons/continuation/verify-verdicts).

## 10. Fronteiras

- **F19** dono de `renderRules`/PI_RULES — F30 reusa read-only
  (`rulesContent.ts` intocado).
- **F27** dono da interface modelSwitch + fallback engine — F30 implementa a
  resolução em `src/models/switch.ts`; ZERO mudanças em `src/resilience/`.
- **F28/F27** donos de continuation/lessons — a persona só ANEXA (append).
- **F21** dono da fixture — F30 usa `renderModelsJson`/ModelRuntime.
- **F31** independente (adapter copilot — `models.agents.copilot` quando
  existir; o módulo aceita qualquer nome de agente).
- **F32** consome o config `models` (chains por papel objetivo via state).

## 11. Last verified

2026-08-10 — F30 implementado: persona+rules+variant via before_agent_start
(chain), model resolution pura, modelSwitch implementado (zero mudanças F27),
models generate/list/doctor, SDD assets + archive, EVAL-039..048 (matriz v8).
