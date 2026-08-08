# F26 Design — Eval Framework Port (evals do guild → harness)

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-026)
**Decisões aprovadas (usuário/briefing, travadas):** port de evals/guards/agents SEM tema RPG (decisão 1) · determinismo: judge LLM só quando cascata determinística decide — env-gated, nunca CI (decisão 2) · offline/$0 em CI por construção (F21) · garantias antes de agentes (decisão 4): constraint-adherence implementável AGORA (sujeitos F24); tool-use/routing precisam F32; failover F30; compaction F27 · EVAL-MATRIX aditivo com notas datadas (F21 D9) · escopo `packages/harness` · zero deps novas · evidência via `evalTest()` (F21) · requirement IDs EVAL-0xx · nada sai sem AD · **QA-1: dados = TS modules (D2)** · **QA-2: trace = transcript REAL do ScriptedScenario (D3)** · **QA-3: llm-judge dois tiers (D4)** · **QA-4: constraint-adherence = casos novos framework-driven (D6)** · **QA-5: baseline-diff = evaluator vs ratchet F23 (D4)**

## Contexto

F21 entregou a infra determinística: fixture OpenAI-wire (`chatServer.ts` SSE adversarial), ScriptedScenario (contador+switch — a escolha do tool call é fakeada, a execução é real), sessões SDK in-process (`createAgentSession` + `bindExtensions` + materialização de extensões), evidência `evalTest()` → `evidence/partial/*.jsonl` → merge → `last-run.json`, EVAL-MATRIX v3 (EVAL-001..011) + teste de consistência (`test/eval/layer2/matrix-consistency.test.ts`). F24 entregou os guards (`src/guards/`: write-existing-file-guard, ranger-md-only, todo-description-override, todo-continuation-enforcer, todo-writer, guardKit) — os SUJEITOS de constraint-adherence — com bloqueio real de `tool_call` (`{ block: true }`). F25 entregou a cascata de verificação (`src/verify/`) com adaptador de judge injetável (`VerifyDeps.judgeAdapter`, `RUNECRAFT_VERIFY_LLM_JUDGE=1`) — reuso no llm-judge. F23 entregou os ratchets (`test/eval/baselines/{command-coverage,known-failures}.txt` + goldens `test/golden/` + script `eval:ratchet` no package.json).

O arcanum (supersedido — AD-001) contém a fonte do port em `packages/guild/src/features/evals/`: `index.ts`, `types.ts` (404 ln), `schema.ts` (zod), `loader.ts` (JSONC hand-rolled), `runner.ts`, `reporter.ts`, `storage.ts` (`.guild/evals/runs`), `baseline.ts`, `targets/builtin-agent-target.ts`, `executors/{prompt-renderer,model-response,trajectory-run,github-models-api,openrouter-api}.ts`, `evaluators/{deterministic,llm-judge,trajectory-assertion}.ts`; dados em `packages/guild/evals/` (3 suites / 8 cases / 6 scenarios JSONC); plano `.guild/plans/eval-coverage/` com as 5 categorias. **Fatos verificados no código (sem fabricação):** `trajectory-run.ts` declara "Trajectory evals are intentionally mock-backed and text-based" (replay de `mockResponse` + regex `detectDelegation` — SEM prova de tool call real); `deterministic.ts` lança "Evaluator baseline-diff is reserved for a later phase and is not implemented yet"; `model-response.ts` exige `GITHUB_TOKEN`/`OPENROUTER_API_KEY` (custo por chamada); `llm-judge.ts` é substring determinístico com `normalizeAliases` (thread→rogue, shuttle→ranger, spindle→warlock, weft→cleric, warp→paladin — lore RPG).

Cadeia: F21 (fixture/evidência) → F23 (ratchet) + F24 (guards) → F25 (cascata/judge) → **F26 (framework + categorias)** → categorias pós-F27/F30/F32 (extensibilidade por construção).

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Port semântico → `src/eval/`** (EVAL-012): types.ts, schema.ts (validação leve), loader.ts, runner.ts, reporter.ts, evaluators/, targets/, executors/, index.ts — TS, zero deps novas, RPG-free (sem aliases; sem agentes guild pré-F32) | Port com a MESMA semântica (ciclo resolve→execute→evaluate→assertions→summary do arcanum); tema RPG é decisão travada (1); deps novas proibidas (HARD) |
| D2 | **Dados = TS modules** sob `test/eval/{suites,cases,scenarios}` (QA-1a recomendado): loader usa dynamic import; validação primária = tipos TS (`satisfies`) + validação runtime LEVE hand-rolled em schema.ts (zero deps; precedente `readJsoncFile` do arcanum adaptado — aqui sem parser, pois não há JSONC) | (1) zero deps: JSONC exigiria parser hand-rolled OU dep nova — TS elimina o parser; (2) convenção do harness (fixture scenarios.ts já é TS; EVAL-MATRIX governa por arquivos de teste); (3) compile-time safety. Custo: dados são código (aceitável — política aditiva da matriz permanece) |
| D3 | **Targets mapeados 1:1** (QA-2 recomendado): `builtin-agent-prompt` → `targets/prompt-render.ts` (renderRules()/config renders do F19; goldens F23 JÁ cobrem → zero cases v1; consumidores pós-F30/F32) · `single-turn-agent` → `targets/single-turn-agent.ts` (sessão SDK in-process via `helpers/sdkSession.ts` + fixture ScriptedScenario → trace + tool registry) · `trajectory-agent` → `executors/trajectory-run.ts` lendo o TRANSCRIPT REAL do ScriptedScenario (sequência de tool calls) — substitui o replay mock-text do arcanum (comentário no código-fonte prova a limitação) | O harness JÁ replaya fluxos scriptados com tool calls reais (EVAL-006/007 provam viabilidade — guard block observado no loop real do Pi); mock-text seria regressão de fidelidade; tabela completa no Mapeamento |
| D4 | **Subset v1 de evaluators justificado** (QA-3/QA-5): portar AS-IS os 8 determinísticos (contains-all, contains-any, excludes-all, section-contains-all, ordered-contains, xml-sections-present, tool-policy, min-length — funções puras de string/policy); ADAPTAR `tool-policy` (fonte do policy = registry de tools da sessão / config guards — enumeração a validar no Execute) e `trajectory-assertion` (input = HarnessTrace do transcript, não o TrajectoryTrace mock do arcanum); `llm-judge` = substring offline (SEM normalizeAliases) + tier real env-gated via `VerifyDeps.judgeAdapter`; IMPLEMENTAR `baseline-diff` (reservado no arcanum — vs ratchet F23, reusa normalize/sort); section-contains-all/xml-sections-present portados com ZERO cases v1 (prompts XML dos agentes guild não existem pré-F32 — dead weight documentado, desbloqueado por F32) | Honesto: implementações baratas (~200 linhas) mantêm paridade de port; casos seguem os sujeitos (nada de case órfão); baseline-diff vira assertion reutilizável em vez de no-op |
| D5 | **Sequenciamento por categoria** (decisão 4): constraint-adherence v1 AGORA (sujeitos F24 ✅); tool-use/routing → F32; compaction → F27; failover → F30. Framework extensível POR CONSTRUÇÃO: novo caso = arquivo de dados (suite/case/scenario TS) — runner/loader/evaluators NÃO mudam | A tabela de dependência é o contrato (tabela abaixo); roadmap F26: "tool-use correctness e routing completeness ganham casos após o F32" — sem redesign futuro |
| D6 | **Fronteiras F21/F23** (sem duplicação): F21 dono do fixture + evidência + matriz; F23 dono dos ratchets/goldens; F26 dono da SEMÂNTICA dos evaluators + suites/cases/scenarios. trajectory lê transcripts do fixture SEM re-assertar EVAL-006/007 (casos novos = combinações/adversarial, delta documentado no case); `storage.ts` do arcanum NÃO portado — evidência via `evalTest()`; `baseline.ts` → baseline-diff (reusa F23) | "nada sai sem AD" + zero double-test (HARD do contexto); evidência tem contrato único (F21 D10) |
| D7 | **CI = lane F21** (EVAL-012..016): `bun test test/eval` offline/$0 (loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); EVAL-MATRIX v4 (EVAL-012..016 + notas datadas) + teste de consistência estendido para varrer `test/eval/suites`; judge NUNCA presente (env off por construção); evidência via `evalTest()` → last-run.json | Mesma lane F21/F24/F25 (487 testes, sem regressão); política aditiva F21 D9 |
| D8 | **Higiene de determinismo** (EVAL-013/016): mensagens normalizadas (sem path absoluto/timestamp — F21 D10); identidade estável de evidência; aliases RPG removidos; determinismo provado por teste (2 runs idênticos); scores arredondados onde aplicável | Evidência alimenta o ratchet F23 por identidade estável (precedente F25/AD-024) |
| D9 | **Executors de modelo NÃO portados** (model-response/github-models-api/openrouter-api): custo por chamada, viola offline/$0; reavaliar com F22 (E2E) / F32 (agentes); executor trajectory-run portado ADAPTADO (trace do fixture); prompt-renderer portado thin (dentro do target prompt-render) | HARD constraint offline/$0; o llm-judge env-gated do F25 é o único caminho caro opcional |

## Arquitetura — módulos

```
packages/harness/
├── src/eval/
│   ├── index.ts          # exports públicos (padrão arcanum index.ts)
│   ├── types.ts          # EvalPhase (prompt|routing|trajectory) / EvalTarget / ExecutorSpec / EvaluatorSpec (11 kinds) /
│   │                     #   EvalCase / EvalSuiteManifest / EvalArtifacts / AssertionResult / EvalCaseResult /
│   │                     #   EvalRunSummary / EvalRunResult / ResolvedTarget / ExecutionContext / RunnerFilters — port RPG-free (D1)
│   ├── schema.ts         # validação runtime leve hand-rolled (zero deps) + formatSchemaIssues + kind hints (D2)
│   ├── loader.ts         # loadSuite / loadCases / loadScenario (dynamic import TS), EvalConfigError (D2)
│   ├── runner.ts         # runEvalSuite(options) → {result, evidencePaths, consoleSummary}; filtros; in-process (D1/D7)
│   ├── reporter.ts       # formatEvalSummary / formatJobSummaryMarkdown (D1)
│   ├── evaluators/
│   │   ├── deterministic.ts        # 8 kinds portados as-is, mensagens RPG-free (D4)
│   │   ├── trajectory-assertion.ts # expectedSequence/required/forbidden/min-maxTurns sobre HarnessTrace (D3/D4)
│   │   ├── llm-judge.ts            # substring offline + tier real env-gated via VerifyDeps.judgeAdapter (D4/D9)
│   │   └── baseline-diff.ts        # vs ratchet F23 (normalize/sort), regression → fail (D4/D6)
│   ├── targets/
│   │   ├── prompt-render.ts        # renderRules()/config renders (F19) — v1 sem cases (D3)
│   │   └── single-turn-agent.ts    # sessão SDK + fixture → trace + tool registry (usa helpers/sdkSession.ts) (D3)
│   └── executors/
│       └── trajectory-run.ts       # HarnessTrace do transcript real do ScriptedScenario (D3)
├── test/eval/
│   ├── suites/constraint-adherence.ts    # v1 (EVAL-014)
│   ├── cases/{write-guard-block,ranger-md-only,adversarial-guard-off}.ts  # (EVAL-014)
│   ├── scenarios/*.ts                    # sequências scriptadas reais via fixture (EVAL-014)
│   ├── framework/                        # unit: loader/runner/evaluators (port adaptado dos testes do arcanum) (EVAL-012/013/015/016)
│   ├── EVAL-MATRIX.md                    # test/EVAL-MATRIX.md — v4: + EVAL-012..016 (D7)
│   └── layer2/matrix-consistency.test.ts # + varre test/eval/suites (D7)
└── package.json                          # lane test já cobre test/eval (preloads F21/F24/F25)
```

## Fluxos

### F1 — Load & run (EVAL-012)

```
1. runEvalSuite({ suite, filters }) → loader.loadSuite('constraint-adherence') (dynamic import TS + schema)
2. loadCases → resolve refs de scenarios; erro tipado com motivo + hint de kind
3. por case: resolveTarget (prompt-render | single-turn-agent) → executor (trajectory-run sobre transcript do fixture)
   → evaluators → AssertionResult[] → EvalCaseResult
4. buildSummary (normalizedScore/status) → EvalRunResult
5. evidência via evalTest() → evidence/partial/*.jsonl → merge → last-run.json (F21/F23) — NÃO há storage próprio (D6)
```

### F2 — Constraint-adherence (EVAL-014)

```
1. case → single-turn-agent target: sessão SDK in-process (sdkSession + bindExtensions) com guards F24 materializados
2. ScriptedScenario replaya: write em arquivo existente → tool_call BLOQUEADO (reason F24) → rewrite → passa
3. transcript → HarnessTrace (sequência real de tool calls) → trajectory-assertion (write → blocked → rewrite)
4. tool-policy: expectations vs tool registry da sessão (enumeração a validar no Execute)
5. adversarial: guard off no config → fixture FALHA com diagnóstico (padrão F24 T7)
```

### F3 — baseline-diff (EVAL-015)

```
run atual → normalize/sort (infra F23) → compare vs test/eval/baselines/ → assertions por caso
(regression → fail; informational/no-regression → pass; baseline ausente → degraded)
```

### F4 — llm-judge (EVAL-016)

```
substring tier (sempre, offline): expectedContains/expectedAnyOf/forbiddenContains sobre o output — RPG-free
real tier (SÓ com RUNECRAFT_VERIFY_LLM_JUDGE=1): VerifyDeps.judgeAdapter (F25) com critérios; parse estrito;
inválido/timeout → fail-closed; CI nunca (env off por construção; spy nos testes)
```

### F5 — CI

```
bun test test/eval (preloads F21/F24/F25) → EVAL-012..016 offline/$0; judge nunca; consistência matriz↔suites;
evidência last-run.json; sem regressão nos 487 do F25/F24
```

## Mapeamento arcanum → harness (todos os arquivos do framework)

| Arcanum (packages/guild) | Harness (packages/harness) | Onde |
| --- | --- | --- |
| `src/features/evals/index.ts` | `src/eval/index.ts` | D1 |
| `src/features/evals/types.ts` | `src/eval/types.ts` (RPG-free) | D1/D8 |
| `src/features/evals/schema.ts` | `src/eval/schema.ts` (hand-rolled, zero deps — reuso de zod só se JÁ existir no dep tree) | D1/D2 |
| `src/features/evals/loader.ts` | `src/eval/loader.ts` (TS modules via dynamic import) | D2 |
| `src/features/evals/runner.ts` | `src/eval/runner.ts` (evidência via evalTest) | D1/D6/D7 |
| `src/features/evals/reporter.ts` | `src/eval/reporter.ts` | D1 |
| `src/features/evals/storage.ts` | → helpers F21 `evalTest()` (NÃO portado — F21 dono da evidência) | D6 |
| `src/features/evals/baseline.ts` | `src/eval/evaluators/baseline-diff.ts` (adaptado — reusa ratchet F23) | D4/D6 |
| `src/features/evals/evaluators/deterministic.ts` | `src/eval/evaluators/deterministic.ts` (8 kinds) | D4 |
| `src/features/evals/evaluators/llm-judge.ts` | `src/eval/evaluators/llm-judge.ts` (substring + tier real F25) | D4/D9 |
| `src/features/evals/evaluators/trajectory-assertion.ts` | `src/eval/evaluators/trajectory-assertion.ts` (trace do fixture) | D3/D4 |
| `src/features/evals/targets/builtin-agent-target.ts` | `src/eval/targets/prompt-render.ts` + `single-turn-agent.ts` (agentes guild pós-F32) | D3 |
| `src/features/evals/executors/prompt-renderer.ts` | `src/eval/targets/prompt-render.ts` (thin) | D3 |
| `src/features/evals/executors/trajectory-run.ts` | `src/eval/executors/trajectory-run.ts` (transcript ScriptedScenario) | D3 |
| `src/features/evals/executors/model-response.ts` | NÃO portado (custo; F22/F32) | D9 |
| `src/features/evals/executors/github-models-api.ts` / `openrouter-api.ts` | NÃO portados (custo) | D9 |
| `evals/suites/*.jsonc` (3) | `test/eval/suites/*.ts` (TS) | D2 |
| `evals/cases/*.jsonc` (8) | `test/eval/cases/*.ts` (v1: constraint-adherence; demais pós-F32) | D2/D5 |
| `evals/scenarios/*.jsonc` (6) | `test/eval/scenarios/*.ts` (v1: fluxos guards) | D2/D3 |
| testes do framework (`loader.test.ts`, `runner.test.ts`, `schema.test.ts`, `reporter.test.ts`, `baseline.test.ts`, `evaluators/*.test.ts`, `targets/*.test.ts`, `executors/*.test.ts`) | `test/eval/framework/*.test.ts` (port adaptado) | T1..T7 |

Fonte recuperada do checkout `~/Projects/arcanum` (T10 cita no docs; sem fabricação). Fatos verificados: trajectory-run mock-backed (comentário no código); baseline-diff reservado (throw); model-response exige tokens; normalizeAliases com lore RPG.

## Categorias do eval-coverage — tabela de dependência

| Categoria | Sujeito (feature) | Status | Casos v1 F26 | Quando |
| --- | --- | --- | --- | --- |
| Constraint adherence | Guards F24 (write-existing-file-guard, ranger-md-only, todo-*) | ✅ disponível | EVAL-014 (write-guard, ranger, adversarial) | AGORA |
| Tool-use correctness | Agentes F32 (single-turn-agent com tools reais dos papéis) | 🔒 bloqueada | — (outline) | após F32 |
| Routing completeness | Agentes F32 (orquestração → papéis) | 🔒 bloqueada | — (outline) | após F32 |
| Compaction recovery | F27 (port compaction-recovery + CONTINUATION_MARKER) | 🔒 bloqueada | — (outline) | após F27 |
| Model failover | F30 (port model-resolution, fallback chain) | 🔒 bloqueada | — (outline) | após F30 |

**Extensibilidade:** caso novo = 1 suite/case/scenario TS + 1 entrada aditiva na matriz. Runner/loader/evaluators NÃO mudam (D5). Outline por categoria = kinds/cases esperados listados no roadmap/design das features donas — F26 NÃO inventa design de F27/F30/F32.

## EVAL-MATRIX — entradas aditivas v4 (política F21 D9)

| ID | Fluxo | Ferramentas | Script esperado | Notas |
| --- | --- | --- | --- | --- |
| EVAL-012 | framework smoke: suite TS carrega + runner in-process | eval (framework) | 1. loadSuite TS valida schema; 2. runner executa cases de todos os kinds; 3. 2 runs idênticos; 4. evidência no last-run.json | zero deps; RPG-free; erros tipados com hint |
| EVAL-013 | evaluators determinísticos: 8 kinds | eval (framework) | 1. unit por kind (patterns/weight/prompt vazio); 2. tool-policy mismatch; 3. trajectory-assertion ordem/required/forbidden; 4. determinismo | mensagens normalizadas (F21 D10) |
| EVAL-014 | constraint adherence: guards F24 via framework | eval (suites/constraint-adherence) | 1. sessão + guards → write bloqueado (reason F24) → rewrite passa; 2. ranger .md-only; 3. adversarial guard-off → falha com diagnóstico | delta vs EVAL-006/007 documentado; trajectory-assertion + tool-policy |
| EVAL-015 | baseline-diff vs ratchet F23 | eval (framework) | 1. run normal → no-regression; 2. baseline rebaixado → regression (fail); 3. baseline ausente → degraded | reusa normalize/sort F23 |
| EVAL-016 | llm-judge: substring + real env-gated | eval (framework) | 1. substring passa/falha (RPG-free); 2. env off → zero chamadas reais (spy); 3. env on → adaptador F25 com critérios; 4. CI simulado → zero rede | judge nunca em CI |

Nota datada v4: categorias tool-use/routing (F32), compaction (F27), failover (F30) SEM entradas até os sujeitos existirem (política aditiva — nada sai sem AD); tabela de dependência no design D5.

## Integração CI

- **Roda com**: mesma lane F21/F24/F25 — `bun test test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); judge NUNCA presente (env off por construção)
- **Evidência**: `evalTest()` grava nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre
- **Consistência**: `matrix-consistency.test.ts` v4 varre `test/eval/suites` (lane do framework) + dirs existentes
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Enumeração de tools da sessão SDK 0.81.0** (tool-policy precisa do registry real) | Validar no Execute (bindExtensions/glla registram tools); fallback: whitelist scripted do fixture + config guards (F24) |
| **Shape do transcript de tool calls no fixture** (HarnessTrace) | EVAL-006/007 já consomem transcript real (prova de viabilidade); shape exato a validar no Execute |
| **Formato exato do ratchet F23** (command-coverage.txt/known-failures.txt) p/ baseline-diff | Validar no Execute; fallback: derive baseline in-run (sem nova superfície) |
| **Duplicação com EVAL-006/007** | D6: casos novos = combinações/adversarial/framework-driven; delta documentado no case; nada de re-assertar o mesmo comportamento |
| **JSONC vs TS (QA-1)** | TS recomendado (zero parser); se o usuário escolher JSONC, portar `readJsoncFile` hand-rolled do arcanum (zero deps, precedente comprovado) |
| **zod disponível no dep tree?** | Validar no Execute; design assume validação hand-rolled (zero deps) — reuso de zod só se JÁ existir (nunca dep nova) |
| **Dynamic import em bun test (cache/top-level await)** | Validar no Execute; alternativa: funções registradoras (registerSuite({...})) — sem dynamic import |
| **Dados TS = código (não JSONC)** | Aceito (convenção harness; matriz é o registro de governo; compile-time safety compensa) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| EVAL-012 | P1: Framework port | D1/D2/D7 + loader/runner/reporter/schema + EVAL-012 + framework tests |
| EVAL-013 | P1: Evaluators determinísticos | D4/D8 + evaluators/deterministic + trajectory-assertion + EVAL-013 |
| EVAL-014 | P1: Constraint adherence v1 | D3/D5/D6 + single-turn-agent + trajectory-run + suites/cases/scenarios + EVAL-014 |
| EVAL-015 | P2: baseline-diff | D4/D6 + evaluators/baseline-diff + EVAL-015 |
| EVAL-016 | P2: llm-judge | D4/D9 + evaluators/llm-judge + EVAL-016 |

**Cobertura:** 5/5 mapeados. Edges da spec: kind desconhecido → schema (kind hints) · scenario ausente → loader · tool-policy tool ausente → validar Execute · trace vazio → degrade · weight 0/patterns vazios → distributeWeight · baseline ausente → degraded · env off → zero chamadas · duplicação EVAL-006/007 → D6 · categoria bloqueada → sem entrada na matriz · determinismo → D8.

**Pontos a validar no Execute** (consolidado): enumeração de tools no SDK 0.81.0 (tool-policy); shape do transcript (HarnessTrace); formato do ratchet F23 (baseline-diff); presença de zod no dep tree; dynamic import vs registradoras em bun test; renderRules() como fonte do target prompt-render; shape da evidência nos partial/*.jsonl para os novos checks.

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Formato dos dados** (D2): (a) **recomendado — TS modules** (compile-time safety, zero parser, convenção harness); (b) JSONC + parser hand-rolled portado do arcanum; (c) JSONC + dep nova (fora da constraint — registro)
2. **QA-2 — Fonte do trace** (D3): (a) **recomendado — transcript REAL do ScriptedScenario F21** (sequência de tool calls); (b) replay mock-text do arcanum (detectDelegation)
3. **QA-3 — llm-judge** (D4): (a) **recomendado — dois tiers** (substring offline + real env-gated via F25); (b) só substring; (c) só real
4. **QA-4 — Constraint-adherence v1** (D6): (a) **recomendado — casos novos framework-driven** (write-guard, ranger, adversarial) com delta documentado; (b) framework puro (sem casos novos); (c) combo amplo com todo-*
5. **QA-5 — baseline-diff v1** (D4): (a) **recomendado — evaluator vs ratchet F23**; (b) reservado (no-op → script eval:ratchet); (c) port integral sobre arquivo novo
