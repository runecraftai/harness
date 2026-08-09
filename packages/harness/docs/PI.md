# Pi First-Class — Persona, Rules, Model Routing & SDD Assets

> Guide to Pi as a first-class citizen of the harness: persona + rules
> injected into the session via `before_agent_start`, per-agent model routing
> (pi/opencode/claude/codex), model switching, models.json generation and the
> SDD assets (templates/prompts/chains) + plan archive. Explicit boundaries
> at the end.

## 1. Pi persona (PERSONA_VERSION=1)

The `persona` extension (`extensions/persona.ts` → `src/extensions/persona.ts`
→ `src/persona/`) injects the objective senior-engineer persona in the
CHAINED `before_agent_start` (append — never overwrites; the runner re-passes
the systemPrompt per extension — SDK types.d.ts ~790).

- Text: `src/persona/persona.ts` — `PERSONA_VERSION = 1`, constant template
  literal (golden, byte for byte; a deny-list of fantasy terms in the evals).
- Marker: `<!-- runecraft:persona -->` (shared marker convention).
- Kill switch: `RUNECRAFT_PERSONA=0|false|off` → inert layer (zero injection).
- Config `persona` (additive in state.json — schemaVersion 1):
  `{enabled: true, rulesInjector: {enabled: true, toolCallLevel: false},
  firstMessageVariant: {enabled: true}}`. Invalid → safe defaults + report
  (fail-closed); frozen per session.

## 2. Rules injection (reuse of PI_RULES)

`src/persona/rules.ts` injects `renderRules("pi")` (PI_RULES — the rules
text is OWNED by the routing source of truth; this layer reuses it read-only,
zero duplication) with the marker `<!-- runecraft:rules -->`. Honest note:
the original source injected rules at tool-call level (rules-tool-policy —
`<rules source="dir">` on read/write/edit); this layer ports the INTENT to
`before_agent_start` (roadmap wording; chaining verified; deterministic; zero
overhead per tool call). Tool-call level = flag P2
(`persona.rulesInjector.toolCallLevel: false` — default; not ported in v1).

## 3. First-message variant (faithful port)

`src/persona/first-message.ts` — AS-IS port of the first-message-variant
hook: in-memory Sets `created`/`applied` per process (a new extension
instance = new state — faithful source semantics, documented). Deterministic
selection by session reason (resilience layer): `initial/undefined` →
variant applied ONCE; `resume|reload` → NEVER re-applied (continuation is
owned by the resilience layer — boundary).

## 4. Per-agent model routing (src/models/)

Pure resolution (`src/models/resolution.ts`):

```
resolveAgentModel(agent, {availableModels, overrideModel, systemDefaultModel, customFallbackChain})
  → override (env RUNECRAFT_MODEL_OVERRIDE ?? state models.override)
  → custom chain (state models.agents.<id>.fallbackChain) > builtin ({} — no own registry)
  → systemDefault (state models.default)
  → null + warn (NO invented id; the hardcoded default of the source is NOT ported)
getNextFallbackModel(agent, failedModel, availableModels, chain) → first available AFTER the failed one; end → null
getKnownModels(chains) → known ids of the configured chains
```

- Agents = HOSTS: pi/opencode/claude/codex (the Copilot adapter adds copilot —
  the module accepts any agent name).
- TUI paths of the source (uiSelectedModel/agentMode/categoryModel) are
  DROPPED (coded routing decision).
- `availableModels` comes from the SDK models.json (`src/models/registry.ts`).
  **Real path validated at execution:** the SDK 0.81.0 loads from
  `<agentDir>/models.json` — agentDir = `PI_CODING_AGENT_DIR` ??
  `~/.pi/agent` (`modelsPath = options.modelsPath ?? join(getAgentDir(),
  "models.json")`). It is NOT settings.json nor `~/.pi/models.json`. The
  harness resolves the same file via `piAgentDir(env)`
  (RUNECRAFT_PI_HOME ?? `~/.pi/agent` — config.ts).

## 5. Config `models` (additive in state.json)

`{enabled: true, default: string|null, override: string|null,
agents: Record<id, {fallbackChain: FallbackEntry[]}>, autoGenerateModelsJson:
false}`. Fail-closed (invalid → defaults + report), frozen per session, kill
switch `RUNECRAFT_MODELS=0|false|off`, override env
`RUNECRAFT_MODEL_OVERRIDE`.

## 6. modelSwitch implemented (src/models/switch.ts)

The resilience layer left `FallbackActionKind.modelSwitch` as a NO-OP
INTERFACE (`src/resilience/types.ts:115`; `fallback.ts:129-131`;
`ModelSwitchInterface` in `fallback.ts:175`). This layer implements the REAL
resolution:

```
resolveModelSwitch(agent, {failedModel, availableModels, chain})
  → {kind: "switch", model, from}   (next via getNextFallbackModel — light→strong)
  → {kind: "halt", reason: "model-chain exhausted", escalation: "human"}
```

**Boundary:** ZERO changes in the resilience layer files (an eval asserts the
byte-for-byte diff). **Application mechanism (validated at execution):** the
SDK 0.81.0 does not expose runtime model switching in the model-runtime/
model-registry APIs (no switchModel/setModel/reloadModels in those modules) —
models.json is the deterministic mechanism (proven by the eval fixture).
Applying the switch = regenerating models.json with the chain + restarting/
reloading the session. **Note:** `AgentSession.setModel()` and
`ExtensionAPI.setModel` DO exist (agent-session.js:1194 / loader.js:283 —
including `cycleModel`); the in-process wiring point via `setModel` is
documented as evolution — generation + reload remains the deterministic,
offline-testable path.

## 7. CLI `harness models generate|list|doctor`

- `harness models generate` → deterministic merge of state `models` →
  models.json (`<piAgentDir>/models.json`); 2 runs → byte-identical
  (canonical JSON — no timestamps/paths). Provider config (baseUrl/api/apiKey)
  is NEVER invented: inherited from the existing models.json or from env
  (`RUNECRAFT_MODELS_PROVIDER_<ID>_{BASEURL,API,APIKEY}`); absent → omitted
  (the SDK schema accepts providers without baseUrl). Kill switch → refusal
  without writing (exit 0).
- `harness models list` → resolution table per agent (current chain +
  resolved model).
- `harness models doctor` → path + state↔file parity + availableModels.
- `harness status` → **Models** section; `harness doctor` → check 20.

## 8. SDD assets (versioned in the package)

| Asset | Location | Usage |
| --- | --- | --- |
| spec/design/tasks templates | `assets/sdd/templates/` | scaffold via `harness sdd new` |
| Prompt templates | `assets/sdd/prompts/` | spec/design/tasks/review phases (objectives) |
| SDD chains | `assets/sdd/chains/sdd-*.chain.md` | subagents fork format (`pi.subagents.chains` in the manifest + materialized in `.pi/chains/`) |
| Scope | `src/sdd/scope.ts` | deterministic quick/medium/large classification (thresholds in code) |

Commands: `harness sdd new <feature> [--scope quick|medium|large]` (scaffold
+ materialization of the chains in `.pi/chains/`), `harness sdd chains`
(list + recommended scope).

**Chain format (honest finding at execution):** the CURRENT subagents fork
parser (0.37.2) is `parseChain` (`chain-serializer.ts:101`) — front-matter
`name` + `description` required + `## <agent>` sections (worker/reviewer —
fork builtins, no fantasy). The historical `worker "..." -> reviewer "..."`
format does NOT parse in the current fork — the assets follow the format the
fork parses TODAY (an eval validates with the real parser).

## 9. Plan archive

`harness plans archive <slug>` — port of the archive-plan tool: slug regex
`^[a-z0-9-]+$`; moves `<cwd>/.runecraft/plans/<slug>` →
`<cwd>/.runecraft/plans/archive/<slug>` (recursive mkdir); returns
`{ok, warnings}`; DI rename for tests. `src/plan.ts` is install PRESETS of
the CLI dispatch — NOT a plans dir (documented; `.runecraft/plans/` is the
new sink — same convention as events/lessons/continuation/verify-verdicts).

## 10. Boundaries

- The rules text (`renderRules`/PI_RULES) is owned by the routing source of
  truth — this layer reuses it read-only (`rulesContent.ts` untouched).
- The resilience layer owns the modelSwitch interface + fallback engine —
  this layer implements the resolution in `src/models/switch.ts`; ZERO
  changes in `src/resilience/`.
- The resilience/observability layers own continuation/lessons — the persona
  only APPENDS.
- The eval fixture is owned by the evals — this layer uses
  `renderModelsJson`/ModelRuntime.
- The Copilot adapter is independent (`models.agents.copilot` when it
  exists; the module accepts any agent name).
- The role agents consume the `models` config (role chains via state).

## 11. Last verified

2026-08-10 — implemented: persona+rules+variant via before_agent_start
(chained), pure model resolution, modelSwitch implemented (zero changes in
the resilience layer), models generate/list/doctor, SDD assets + archive.
