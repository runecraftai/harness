# EVAL-MATRIX — fluxos determinísticos da camada 2 (F21)

MATRIX_VERSION: 11

Registro de governo dos fluxos de eval determinísticos do harness (F21, AD-010).
A camada 2 replaya fluxos SDLC críticos contra um fixture OpenAI-wire local
(loopback, porta efêmera, apiKey literal `"fixture"`): o agente REAL executa
cada passo (bash/git reais em repo descartável); **só a escolha do tool call é
fakeada** (contador+switch — padrão gentle-ai).

**Política aditiva (D9):** entradas só são ACRESCENTADAS (novo `EVAL-<n>` +
bump de `MATRIX_VERSION`); **nada sai sem AD**. Correção in-place do script
(ex.: fork mudou nome de tool) é permitida com nota de revisão datada na
linha. Mudança SEMÂNTICA de fluxo (novo passo no meio) = entrada nova, nunca
edição da antiga.

Cobertura de requisitos: DETR-01..06 — 6/6 (ver `.specs/features/f21-eval-deterministic/spec.md`) + F24 GUARD-01..08 (ver `.specs/features/f24-execution-guards/spec.md` — EVAL-006 → GUARD-01/02/07/08; EVAL-007 → GUARD-04/05/07/08) + F25 VER-01..13 (ver `.specs/features/f25-verification-cascade/spec.md` — EVAL-008 → VER-01/02; EVAL-009 → VER-03/04; EVAL-010 → VER-07/08/09/10; EVAL-011 → VER-06) + F26 EVAL-012..016 (ver `.specs/features/f26-eval-framework-port/spec.md` — framework de evals portado do arcanum, AD-026) + F31 COP-01..09 (ver `.specs/features/f31-copilot-adapter/spec.md` — EVAL-049..056).

**v9 (F31, AD-031):** entradas aditivas EVAL-049..056 (Copilot/VSCode Adapter —
adapter F15 repo-scoped: detecção bin `code`/`code-insiders` OU extensão
`github.copilot*`, injeção rules `.github/copilot-instructions.md` + MCP
`.vscode/mcp.json` servers.taskflow (schema VS Code; host reusado
`@runecraft/taskflow-claude`), remoção content-based, fail-closed,
coluna matriz F17, two-driver gentle-ai user-level × repo-level, sync/state)
— política aditiva D9; o teste de consistência agora também varre
`test/eval/suites/copilot` + `test/eval/framework/copilot` (lane do
Copilot). Nota datada 2026-08-10: os cases puros (EVAL-049..056) são
unit/fixture do framework (mesmo padrão EVAL-017..020 do F27 — o adapter é
mecanismo, sem fluxo SDLC novo); tool-use/routing (F32) segue SEM entradas.

**v10 (F32, AD-032):** entradas aditivas EVAL-057..066 (Objective Role
Agents — 7 papéis objetivos como agentes-dados `.pi/agents/*.md` (planner/
builder/reviewer/auditor/scout/researcher/security), allowlists fail-closed
por papel (D3), descoberta/shadowing reais do fork (project > builtin),
delegação via template (só o builder spawna scout/reviewer — QA-5a),
auditor registrado no default `guards.rangerMdOnly.mdOnlyAgents` (D7 — guard
F24 intocado), interface de modelos F30 por contrato de ids (D8)) — política
aditiva D9; as categorias **tool-use correctness** (EVAL-059/060/061) e
**routing completeness** (EVAL-062/063/064) do eval-coverage do F26 foram
DESBLOQUEADAS (ver docs/EVAL-FRAMEWORK.md); o teste de consistência agora
também varre `test/eval/framework/roles` + `test/eval/suites/roles` +
`test/eval/cases/roles-*` + `test/eval/scenarios/roles-*` (lane dos papéis).
Nota datada 2026-08-12: os cases puros (EVAL-057/058/062..066) são
unit/fixture do framework (mesmo padrão EVAL-017..020 do F27); os cases
trajectory são EVAL-059/060 (allowlists reais dos papéis via target.tools +
tool-policy sobre o registry REAL) e EVAL-061 (auditor md-only em sessão
real com RUNECRAFT_AGENT_ID=auditor — identidade do harness, F24
currentAgentId). Limitação honesta (Execute F32): o fork NÃO seta
`RUNECRAFT_AGENT_ID` por dispatch (seta `PI_SUBAGENT_CHILD_AGENT` —
pi-args.ts) — a bridge documentada no design (adendo before_agent_start do
F28, src/agents/identity.ts) traduz a identidade do child no env que o guard
lê; a delegação real de `subagent` em sessão scriptada com completion do
child não é viável de forma determinística (script único do fixture) — o
routing é provado pelo delegation event tipado do F28 (EVAL-062/063/064,
fallback documentado no design D9).

**v11 (F33, AD-033):** entradas aditivas EVAL-067..078 (Coded Routing &
Pilot Coordination — classificador determinístico puro `src/routing/` com
thresholds em constantes (ROUTE_THRESHOLD=2, high ×2/medium ×1) e security
OBRIGATÓRIA (bypassa threshold — espelho do paladin "MUST ... not optional"),
catálogo de 7 rotas como DADOS mapeadas aos papéis F32 (explore→scout,
research→researcher, implement→builder, review→reviewer, security→security,
planning→planner, direct fail-closed), feature SDD `.specs/**/spec.md` → +2
planning, pilot coordination via 5 chains `.chain.md` (implement/plan/
research/explore/security — formato do fork 0.37.2 `## <papel>` + gate de
veredito [APPROVE]/[REJECT] ≤3 blocking issues; assets versionados em
`chains/` + materialização three-way para `.pi/chains/` — alvo reusado do
F30), hook `before_agent_start` (event.prompt = primeira mensagem —
validado no Execute: types.d.ts:518 "The raw user prompt text (after
expansion)"; freeze por sessão F24 D12; kill switch RUNECRAFT_ROUTING=0;
two-driver F19: goal-loop supervisionando → routing inerte) e fronteiras
F27 (fallback NÃO re-roteia), F30 (modelos por papel via
`models.agents.<id>` — contrato de ids), F28 (lessons → prompts, nunca
rotas — teste de contrato). Política aditiva D9; a categoria **routing
completeness** do eval-coverage do F26 (desbloqueada na v10 pelos papéis)
agora está COMPLETA — última categoria do framework (ver
docs/EVAL-FRAMEWORK.md); o teste de consistência agora também varre
`test/eval/framework/routing` + `test/eval/suites/routing` +
`test/eval/cases/routing-*` + `test/eval/scenarios/routing-*` (lane do
roteamento). Nota datada 2026-08-13: os cases puros (EVAL-067..071) e os de
wiring (EVAL-076..078) são unit/fixture do framework (mesmo padrão
EVAL-017..020 do F27); os cases trajectory são EVAL-072..075 (sessões reais
com a extensão routing materializada + chains em .pi/chains/ → delegação
real via tool subagent + directive no systemPrompt).


**v2 (F24, AD-022):** entradas aditivas EVAL-006 (write guard) e EVAL-007 (todo enforcer) — política aditiva D9; o teste de consistência agora também varre `test/guards/` (lane dos guards).

**v3 (F25, AD-023):** entradas aditivas EVAL-008..011 (verification cascade) — política aditiva D9; o teste de consistência agora também varre `test/verify/` (lane da cascata).

**v4 (F26, AD-026):** entradas aditivas EVAL-012..016 (eval framework portado do arcanum) — política aditiva D9; o teste de consistência agora também varre `test/eval/suites` (dados TS do framework) e `test/eval/framework` (lane do framework). Categorias bloqueadas do eval-coverage (tool-use/routing → F32, compaction → F27, failover → F30) NÃO têm entrada — política aditiva (nada sai sem AD); a tabela de dependência está no docs/EVAL-FRAMEWORK.md (D5, outline — sem inventar design de F27/F30/F32).

**v5 (F27, AD-027):** entradas aditivas EVAL-017..021 (Resilience & Continuity — port do compaction-recovery/work-continuation/start-work do arcanum para MECANISMOS REAIS do Pi) — política aditiva D9. A categoria compaction-recovery do eval-coverage (bloqueada no F26 — "após F27") agora tem entradas; tool-use/routing (F32) e failover (F30) seguem SEM entradas. Nota datada 2026-08-07: os cases puros (EVAL-017/018/019/020) são unit do framework (o executor trajectory-run exige sessão — o F26 não tem executor "unit"); o case trajectory da suite é o recovery-flow (EVAL-021). Limitação honesta (QA-5/Execute): a EMISSÃO real de `session_compact` no fixture não é viável (limiar de contexto + sumarização LLM do SDK) — o trigger é exercitado via handler exportado com eventos scriptados (wiring) e a observação real é o trigger primário em produção (D1).

**v8 (F30, AD-030):** entradas aditivas EVAL-039..048 (Pi First-Class —
persona + rules injection via before_agent_start, first-message variant,
model resolution por agente, modelSwitch F27 implementado, models generate
determinístico, archive de planos, SDD scope+chains+templates, config/kill
switches) — política aditiva D9; a categoria **failover** do eval-coverage do
F26 foi DESBLOQUEADA (EVAL-042/043 — ver docs/EVAL-FRAMEWORK.md); o teste de
consistência agora também varre `test/eval/suites/pi` +
`test/eval/framework/pi` (lane do Pi). Nota datada 2026-08-10: os cases
puros (EVAL-039..048) são unit/fixture do framework (mesmo padrão
EVAL-017..020 do F27); tool-use/routing (F32) segue SEM entradas. Limitações
honestas (Execute F30): o SDK 0.81.0 NÃO tem API de troca de modelo em
runtime — modelSwitch resolve + o mecanismo de APLICAÇÃO é a geração do
models.json (D7); a emissão real de `before_agent_start` com múltiplas
extensões é exercitada via sessão fixture real (EVAL-039/040/041).

**v7 (F29, AD-029):** entradas aditivas EVAL-030..038 (Memory — port do pacote
runes do arcanum: round-trip db/repository, 10 tools rune_* no fixture Pi,
cross-session, semântica search/context, compaction, bridge F28,
config/kill switch, determinismo, privacidade) — política aditiva D9; o teste
de consistência agora também varre `test/eval/suites/memory` +
`test/eval/framework/memory` (lane da memória). Nota datada 2026-08-09: os
cases puros (EVAL-030/032..037) são unit do framework (mesmo padrão
EVAL-017..020 do F27); os cases de fixture são EVAL-031 (tools rune_* reais
no loop do Pi com round-trip no runes.db) e EVAL-038 (privacidade — sentinel
ausente do event store, argsHash F28). Limitação honesta (Execute F29): o
conteúdo de memória retornado ao agente (transcript) é inerente à função de
memória (D10); tool-use/routing (F32) e failover (F30) seguem SEM entradas.

**v6 (F28, AD-028):** entradas aditivas EVAL-022..029 (Observability & Lessons — event store tipado, harness bundles, cognition lessons com reincidência/promoção/adendo, context monitor + token state, export jsonl determinístico) — política aditiva D9; o teste de consistência agora também varre `test/eval/suites/observability` + `test/eval/framework/observability` (lane da observabilidade). Nota datada 2026-08-08: os cases puros (EVAL-022..025/027/028/029) são unit/fixture do framework (mesmo padrão EVAL-017..020 do F27); o case trajectory da suite é o observability-block (EVAL-026/029 — bloqueio F24 observado numa sessão REAL com a extensão do F28 → guard:blocked no store tipado). Limitação honesta (Execute F28): o resultado do `tool_call` NÃO expõe o block (runner.js short-circuit no primeiro `{block:true}` — extensões posteriores não rodam) e a chamada bloqueada NÃO emite `tool_result` (agent-loop.js pula o afterToolCall para resultados imediatos) — a observação real é o `tool_execution_end` (isError + reason `<guardId>: msg` no result.content — agent-loop.js createErrorToolResult); `tool:call` de chamadas bloqueadas não é gravado (args indisponíveis no tool_execution_end — documentado em docs/EVENTS.md). *(revisado 2026-08-09 na v7: "memory (F29) seguem SEM entradas" → memory agora com EVAL-030..038; tool-use/routing (F32) e failover (F30) seguem sem.)*

| ID | Fluxo (evidência F7) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-001 | goal trivial (P1 camada 2) | goal-loop-audit | 1. `/goal start` com "Done when" (comando, sem turno de modelo); 2. `write` real (greeting.txt); 3. `complete_goal` com `<evidence>`; 4. auditor (sessão fresca, tools ⊆ builtins): `read`; 5. auditor aprova (`<evidence>` + `<approved/>`) → goal_archived | auditor sem extensões (F7 COEX-06); nomes das tools do glla validados no Execute (complete_goal/pause_goal/complete_task/update_task_status/propose_goal_draft/propose_loop_draft/propose_loop_refine/list_add/list_activate/list_status/propose_task_list) |
| EVAL-002 | goal ativo + subagent chain worker (F7 COEX-02) | glla + subagents | 1. `/goal start`; 2. `subagent` (agent `worker`, task real); 3. child pi executa `bash` real (worker.txt); 4. child responde texto; 5. `complete_goal` com `<evidence>`; 6. auditor `read`; 7. auditor aprova → complete | sem continuation dupla; subagent = worker sob o driver goal-loop; child spawnado pelo fork via bun + CLI do SDK (Execute: getPiSpawnCommand auto-resolve o SDK — sem pi real) |
| EVAL-004 | review de diff (F7 COEX-04) | pr-review | 1. diff real (commit no repo de teste); 2. child do pr-review lê o diff (builtins only); 3. verdict JSON estruturado (`verdict`/`findings`) | Execute: as loop tools do pr-review (review_subagent/review_subagents/pr_review_verify) ficam ocultas fora de um `/pr-review` ativo (ReviewLoopCoordinator) — o fluxo exercita o child exatamente como o fork o spawna (buildReviewBaseArgs + wrapper `pi` no PATH); child com `--no-extensions` → tools builtins apenas |
| EVAL-005 | hello world SDLC completo (F7 COEX-05 replay determinístico) | todos | EVAL-001 + EVAL-002 + EVAL-004 encadeados numa sequência: goal → `subagent` worker (bash real) → auditor isolado → review (child pr-review sobre o commit) → `complete_goal` sobrevive ao auditor | fluxo canônico do ROUTING.md seção 5 (F19 D4); review entra após o goal completar (tool gating do pr-review — ver EVAL-004) |
| EVAL-005b | isolamento do auditor (F7 COEX-06 edge) | goal-loop-audit | meta-auditoria sobre os requests vistos do EVAL-001: todo request com perfil de auditor (tools ⊆ builtins) é EXATAMENTE `read/grep/find/ls/bash`; sessão principal nunca perde as tools de extensão | isolamento verificado pelo próprio fixture (qualquer extensão vazando = diagnóstico adversarial) |
| EVAL-006 | write sobre arquivo existente em sessão gerenciada (F24 write-existing-file-guard) | guards (extensão Pi do harness) | 1. sessão abre com guards on (default fail-closed); 2. modelo tenta `write` em README.md (existe) → tool BLOQUEADO com reason `write-existing-file-guard: ...` (path relativo — D3); 3. passo seguinte exige o reason na conversa (evidência na ordem — D7c); 4. `write` em path novo → passa e executa | valida o bloqueio REAL no loop do Pi (arquivo intacto = prova); allow/force e kill switch (RUNECRAFT_GUARDS=0) verificados em variações do mesmo fluxo; reason estável (sem $TMP/$TS — normalização F21 D10); desvio induzido (guard off no config) → fixture falha com diagnóstico (adversarial) |
| EVAL-007 | conclusão com todos pendentes (F24 todo guards) | guards (todo-description-override + todo-continuation-enforcer) | 1. `/goal start`; 2. `propose_task_list` com descrição livre → input REESCRITO para o formato canônico "Done when" (ledger guarda os títulos canônicos); 3. `write` real (notes.txt); 4. `complete_goal` com pendências → BLOQUEADO (reason lista os itens); 5. marca tudo done (`update_task_status`/`complete_task`); 6. `complete_goal` → passa → auditor isolado aprova | nomes de tools do glla validados no Execute: NÃO há todowrite/todoresolve no fork; a task list é `propose_task_list` e a conclusão é `complete_goal` (ledger `.pi-glla/active.jsonl`, eventos `type:"state"`); o enforcer usa tool_call (turn_end/agent_end NÃO bloqueiam no Pi 0.81.0 — runner.js) |

> **EVAL-003 (taskflow DAG — F7 COEX-03) está FORA da camada 2** (revisão
> 2026-08-05, I1): a decisão aprovada era só hello world; o cenário standalone
> fica no F22 S3 (E2E com modelos reais). Não referencia `EVAL-003` em teste
> novo sem AD.

| ID | Fluxo (evidência F7) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-008 | cascata sessão: lint quebrado no complete_goal (F25 verification-cascade) | verify (structural) | 1. sessão com cascade on; 2. modelo escreve notes.txt (lint do fixture falha); 3. complete_goal → veredito ESTRUTURAL com sugestão (política default skip — SOFT, sem block — QA-1); goal conclui (goal_archived); 4. veredito no log da sessão (`.runecraft/verify-verdicts.jsonl`); 5. correção (LINT_OK) → CLI `harness verify` na MESMA engine → structural passa | short-circuit: camadas 2+ não rodam quando a 1 falha (stages do veredito = [structural]) |
| EVAL-009 | integridade + suficiência (F25) | verify (integrity/sufficiency) | 1. modelo DELETA arquivo protegido (bash rm README.md — rastreado no HEAD) → complete_goal BLOQUEADO com reason do F24 (`write-existing-file-guard: integrity — …` — halt, QA-1); restaura + entrega → conclui; 2. diff vazio → BLOQUEADO (mudança ausente — halt); 3. diff gigante → BLOQUEADO (mudança desproporcional — halt) | reason estável (normalização F21); substituição integral (numstat ≥ linhas do HEAD) também falha; allow/force do F24 são as exceções (herança — sem definição nova de "protegido") |
| EVAL-010 | zona cinza + degrade + kill switch (F25) | verify (embedding + judge) | 1. RUNECRAFT_VERIFY=0 → cascata INERTE (goal conclui, log ausente); 2. output na zona cinza sem env → grayZoneNoJudge (default fail) registrado no log (sem block — QA-1 embedding é SOFT); 3. env=1 + gray → judge chamado (fake LLM via extensão com spy) com a SPEC no prompt + critérios de faithfulness → pass; 4. adversarial: sem env o judge NUNCA é chamado (spy ausente) | judge nunca em CI (env off por construção); decisão de escalar = código (boundaries min/max — D5); cap → HALT sem judge (ver engine.test.ts) |
| EVAL-011 | CLI verify exit codes (F25) | commands/verify | 1. repo limpo sem goal → 0 (camadas degradam); 2. lint quebrado (política default skip) → 0 com warning (D10 — "0 pass incl. skip com warning"); 3. zona cinza sem judge → 1 (grayZoneNoJudge fail); 4. halt (goal ativo + diff vazio) → 2; 5. config inválida (min ≥ max) → 3; 6. --json shape {ok, checks[], warnings[], verdict} estável | paridade com a engine (mesma runVerificationCascade no mesmo repo/spec); fora de repo git → 3 (infra); kill switch → inativo, exit 0 |

| ID | Fluxo (evidência F26) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-012 | framework smoke: suite TS carrega + runner in-process + determinismo (F26 EVAL framework) | eval (framework) | 1. `loadSuite`/`loadCasesForSuite`/`loadScenario` (dynamic import TS, schema hand-rolled); 2. runner executa cases de todas as famílias de kinds (dispatch); 3. filtros caseIds/tags; 4. 2 runs idênticos (vereditos); 5. evidência no last-run.json via `evalTest()` | zero deps novas (zod NÃO está no dep tree — validado no Execute); RPG-free; erros tipados com hint de kind; data = TS modules (QA-1) |
| EVAL-013 | evaluators determinísticos: 8 kinds + trajectory-assertion sobre trace real (F26) | eval (framework) | 1. unit por kind (patterns/weight/prompt vazio); 2. tool-policy mismatch (tool ausente do registry ≠ esperado — undefined documentado); 3. trajectory-assertion ordem/required/forbidden/min-maxTurns sobre o HarnessTrace (transcript REAL do ScriptedScenario — QA-2, não o mock-text do arcanum); 4. determinismo + mensagens estáveis (F21 D10) | section-contains-all/xml-sections-present portados com ZERO cases v1 (dead weight documentado — prompts XML dos agentes guild não existem pré-F32, D4); tool-policy usa o registry real da sessão (união dos tools dos requests do fixture — enumeração validada no Execute) |
| EVAL-014 | constraint adherence v1: guards F24 via framework (F26) | eval (suites/constraint-adherence) | 1. sessão SDK in-process (single-turn-agent) + guards materializados (default fail-closed) → write README.md (existe) BLOQUEADO (reason F24) → write novo passa; 2. ranger-md-only com mdOnlyAgents=[main] → write de non-.md BLOQUEADO → .md passa; 3. adversarial: guard off no config → case FALHA com diagnóstico (desvio induzido — F24 T7); 4. transcript real → trajectory-assertion (sequência + bloqueio) + tool-policy (registry); evidência no last-run.json | delta vs EVAL-006/007 documentado no case (D6 — sem double-test: o reason NÃO é re-assertado; o marcador do fixture cobre); offline/$0 (loopback, apiKey literal, zero fetch externo) |
| EVAL-015 | baseline-diff vs ratchet F23 (F26 — implementado; reservado no arcanum) | eval (framework) | 1. run normal → no-regression (pass); 2. falha nova vs baseline → regression (fail com reason caseId + mensagem normalizada); 3. falha congelada → pass (informacional); 4. baseline ausente → degraded informacional (não falha infra) | reusa normalizeMessage/parseBaselineLines do F23 via src/eval/ (sem duplicação); identidade 2-partes `caseId<TAB>mensagemNormalizada` (namespace F26) |
| EVAL-016 | llm-judge: substring offline + real env-gated (F26) | eval (framework) | 1. substring passa/falha (RPG-free — SEM normalizeAliases); 2. env off → zero chamadas reais (spy — CI simulado offline); 3. env on (RUNECRAFT_VERIFY_LLM_JUDGE=1) → VerifyDeps.judgeAdapter chamado com critérios do spec; 4. JSON inválido/timeout → fail-closed; 5. output vazio → fail determinístico SEM invocar o adaptador | judge nunca em CI (env off por construção — preloads); parse estrito reusa o parseJudgeResponse do F25 (mesma engine) |
| EVAL-017 | continuation builder puro (F27 RES-02/D2) | eval (framework/compaction-recovery) | 1. goal 3/5 no ledger → prompt com marker `runecraft:continuation`, progresso 3/5 e pendências 4,5 (nunca completas — D7); 2. goal completo → null; 3. sessão não-scoped → null; 4. 2 runs idênticos (sem $TMP/$TS) | determinismo (F21 D10); invariante D7 (AD-024 — nunca re-injeta completa); scoping de sessão (D2) |
| EVAL-018 | todo preserver (F27 RES-03/D3) | eval (framework/compaction-recovery) | 1. snapshot do taskList no session_before_compact (fonte: ledger); 2. sobreviveu → no-op (semântica arcanum); 3. wipe → no-op com D7 (snapshot nunca re-injetado); 4. payload de restore só do ledger ATUAL (formato v1 do propose_task_list) | sem API OpenCode (tools reais do glla); idempotente; invariante D7 |
| EVAL-019 | stall detection (F27 RES-04/D4) | eval (framework/compaction-recovery) | 1. trace scriptado: mesma tool+args 3x → stall:repetition; 2. output idêntico (fingerprint/Jaccard ≥ 0.8) → stall:identical-output; 3. silêncio ocupada → wedge; ociosa → heartbeat (relógio fake); 4. determinismo 2 runs; 5. backoff ladder (cap 5min) | limiares configuráveis (defaults do fork glla — atribuição); suppression herdada (audit/grace/stale) |
| EVAL-020 | classify + fallback policy (F27 RES-05/06/D5/D6) | eval (framework/compaction-recovery) | 1. 429/Retry-After → infra + retry; timeout → infra; stall/repetição → agent + re-inject/pause; unknown → HALT fail-closed; 2. stop-all esgota → HALT com reason; 3. skip-and-continue esgota → veredito skip (padrão F25 SKIP); 4. orçamento (padrão CostLedger F25) esgotado → HALT; 5. modelSwitch = interface NO-OP (fronteira F30 — nunca toca settings/modelRoles) | multi-trigger; zero LLM (sem judge); reuso isQuotaError do fork e formato suggestions.ts do F25 |
| EVAL-021 | fluxo completo de recuperação (F27 RES-07/08/D7/D8) | eval (framework/compaction-recovery) + fixture | 1. wiring QA-5: session_compact sintético (handler exportado) → before_agent_start devolve systemPrompt ENCADEADO com marker; 2. invariante F24 em sessão glla REAL (suite recovery-flow): goal → 5 tasks → 3 completas → complete_goal BLOQUEADO (enforcer) → completa 4,5 → complete_goal VERDE (sem phantom-block AD-024); 3. composição: pendências do builder == pendências do enforcer (mesma derivação do ledger) | delta vs EVAL-006/007/014 documentado no case (sem double-test); emissão real de session_compact no fixture não viável (QA-5 — handler exportado com eventos scriptados; trigger primário real em produção D1) |

| ID | Fluxo (evidência F28) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-022 | event store determinismo (F28 OBS-01/02 — D1/D2) | eval (framework/observability) | 1. sessão scriptada (header + tool:call + guard:blocked + lesson:captured) → seq 0..n com kinds certos; 2. 2 runs → MESMA sequência (seq, kind, bundle, argsHash, triggerSignature); 3. payload volátil (at/durationMs/cost) excluído do assert — documentado | F21 D10: timestamps nunca em identidade; prevHash chain (sha256 da linha anterior) |
| EVAL-023 | bundle hash estável (F28 OBS-02 — D3) | eval (framework/observability) | 1. mesma config+prompts → MESMO hash (2 runs); 2. mudança em config/settings/rules/routingVersion → hash DIFERENTE; 3. gitHead FORA do hash; 4. canonical JSON com chaves ordenadas (sort F23) | prefixo curto 12 hex; full 64 hex no header |
| EVAL-024 | session recorder (F28 OBS-03 — D4) | eval (framework/observability) | 1. trace scriptado (3 tools + 1 delegação) → session:ended com toolUsage/delegations/tokenTotals corretos; 2. delegação via tool `subagent` (F2) registrada; 3. relógio fake → durationMs determinístico | port do analytics do guild (session-summaries.jsonl) |
| EVAL-025 | context monitor + token state (F28 OBS-04/05 — D4) | eval (framework/observability) | 1. usagePct 0.85 → warn; 0.97 → recover; 0.5 → none; 2. parse do token-budget fixture (shape REAL verificado — phases OBJECT keyed, usage.contextTokens) → context:usage; 3. updateUsage só inputTokens > 0 (latest não cumulativo) | thresholds 0.8/0.95 (port do arcanum); fonte SDK = ctx.getContextUsage() (ContextUsage tipado) |
| EVAL-026 | lesson capture em gate failure (F28 OBS-06 — D5) | eval (framework/observability) + fixture | 1. bloqueio F24 induzido (tool_execution_end com reason `<guardId>: msg`) → lesson com 4 campos + gate=guardId; 2. veredito F25 halt (verify-verdicts.jsonl) → lesson gate=layer (sweep de fim de sessão); 3. dedupe por triggerSignature (mesmo trigger+gate = mesmo record, count++) | delta vs EVAL-006/007/014/019 (sem double-test); observação via tool_execution_end (validação Execute — o tool_call não expõe o block) |
| EVAL-027 | reincidência + promoção (F28 OBS-07 — D5) | eval (framework/observability) | 1. 3 captures → count=3 → promoted.jsonl + evento lesson:promoted; 2. priority=high + 2 → promove antes (threshold reduzido); 3. `promote <id>` força (CLI) | thresholds configuráveis (promotion 3 / high 2) |
| EVAL-028 | adendo (F28 OBS-08 — D6) | eval (framework/observability) | 1. gate X → adendo SÓ com lessons do gate X, ≤3, ordenado (priority, count); 2. marker `<!-- runecraft:lessons -->`; 3. 2 runs idênticos (sem $TMP/$TS); 4. sem lessons → null (sem ruído); 5. planning track = só promovidas | duas trilhas (planning/execution); injeção via before_agent_start (chaining — NÃO sobrescreve) |
| EVAL-029 | export round-trip (F28 OBS-09/10 — D7/D8) | eval (framework/observability) + fixture | 1. store seedado + verify-verdicts/ledger/continuation seedados → export com source:"bridge"; 2. 2 runs byte-idênticos; 3. prevHash verificado (violação → aviso, exit 0); 4. linha malformada pulada (fail-soft); 5. suite observability verde (guard:blocked REAL no store tipado em sessão glla fixture) | zero deps; ordenação (sessionId, seq); OTel/Langfuse mapeado em docs/EVENTS.md (implementação adiada — nota datada) |

| ID | Fluxo (evidência F29) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-030 | port round-trip db+repository (F29 MEM-01/02 — D1/D4/D12) | eval (framework/memory) | 1. openDatabase → WAL + migrate; 2. save → get → search (FTS) → stats → soft-delete → get NOT_FOUND; 3. schema_meta version=1; 4. migrate 2× idempotente | schema.sql REAL executa em bun:sqlite (D12 — espelho do probe); zero deps novas |
| EVAL-031 | 10 tools no fixture Pi (F29 MEM-03 — D3) | eval (framework/memory) + fixture | 1. sessão F21 com a extensão memory materializada lista as 10 `rune_*` no request (nomes + inputSchema via TypeBox); 2. `rune_save` → `rune_search` round-trip REAL no loop (runes.db persistido); 3. suite memory verde (trajectory-assertion + tool-policy) | defineTool/registerTool (SDK 0.81.0 — glla goal.ts:2621+); delta vs EVAL-006/007/014 (sem double-test) |
| EVAL-032 | cross-session (F29 MEM-04 — D2) | eval (framework/memory) | 1. instância A salva + fecha; 2. instância B (novo Repository, mesmo arquivo) busca → acha; 3. 2 runs idênticos | DB é a memória (D2); worktrees do mesmo git root compartilham |
| EVAL-033 | semântica search/context (F29 MEM-02 — D3/D6) | eval (framework/memory) | 1. FTS5 match com/sem diacríticos ("cafe"→"café"); 2. filtro de categoria; 3. soft-deleted excluído; 4. ordem rank; 5. rune_context recent+relevant; 6. session_start idempotente | port fiel (mesmos shapes do source) |
| EVAL-034 | compaction (F29 MEM-02 — D2/D6) | eval (framework/memory) | 1. > hardCap poda os mais antigos de menor importância (importance ASC, created_at ASC — tie-break rowid); 2. sinal candidatos ≤5; 3. transação (BEGIN/COMMIT); 4. categoryCap do config na tool rune_save | semântica source (D6 — tie-break aditivo documentado) |
| EVAL-035 | bridge F28 (F29 MEM-06 — D7) | eval (framework/memory) | 1. promoted.jsonl fixture (2 lessons) → import → 2 memórias learnings com `where_ref=lesson:<id>`; 2. 2º import → 0 novas (skipped=2); 3. fonte byte-idêntica (hash sha256); 4. dry-run → zero writes | F28 é dono da fonte (read-only); colisão where_ref → skip (nunca sobrescreve memória do usuário) |
| EVAL-036 | config/kill switch (F29 MEM-05 — D5) | eval (framework/memory) | 1. defaults fail-closed; 2. freeze por sessão (D12); 3. `RUNECRAFT_MEMORY=0` → zero tools + zero arquivos; 4. CLI recusa (fail-visible, exit 0) | padrão F24/F25/F27/F28 (F20) |
| EVAL-037 | determinismo (F29 MEM-02 — D6) | eval (framework/memory) | 1. ops scriptadas com clock/idGen injetados → 2 runs resultado JSON IDÊNTICO (inclui created_at injetado; tie-breaks) | F21 D10 (D6); FTS5 rank determinístico no mesmo runtime |
| EVAL-038 | privacidade (F29 MEM-09 — D10) | eval (framework/memory) + fixture | 1. `rune_save` com sentinel numa sessão REAL (extensões memory + observability) → `events/*.jsonl` sem o sentinel (só argsHash — F28 D2); 2. conteúdo presente SÓ no DB; 3. nenhum outro sink do repo contém o sentinel cru | argsHash = sha256 prefixo 16 hex (F28); memória é dado privado (nunca logada crua) |

| ID | Fluxo (evidência F31) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-049 | render/goldens (F31 D5 — reuso F19) | adapters (copilot) | 1. `renderMcpConfig("copilot")` == `mcp-copilot.golden` byte-a-byte (F23; arquivo mcp.json COMPLETO — desvio D5 do F23 D4: nesting 2 níveis `servers.taskflow`); 2. `renderRules("copilot")` === NON_PI_RULES (mesmo texto dos demais não-Pi — zero texto novo); 3. ausência `goal|loop|subagent|pr-review|auditor` | unit do framework (mesmo padrão EVAL-017..020); delta vs EVAL-012/015 (goldens — F31 prova a ADIÇÃO do golden copilot, não o mecanismo) |
| EVAL-050 | detect (F31 D6) | adapters (copilot) | 1. fake `code` bin no PATH mínimo → installed (binPath, reasons []); 2. fake dir de extensão `~/.vscode/extensions/github.copilot-*` SEM bin → installed (via extensão); 3. ausente → not installed + reasons + hint display-only (nunca executado) | AD-017 PATH mínimo; HOME fake (lição F15 — nunca os.homedir()) |
| EVAL-051 | inject round-trip (F31 D2/D3) | adapters (copilot) + CLI install | 1. install --agent copilot → seção `runecraft:workflow` em `.github/copilot-instructions.md` + `servers.taskflow` em `.vscode/mcp.json` (schema VS Code: type stdio); 2. rerun byte-idêntico (idempotência F15); 3. conteúdo do usuário fora do marcador preservado (nunca clobber); 4. BOM preservado + CRLF detectado (F18); 5. entry MCP estrangeira → conflict, nunca sobrescrita (D5) | delta vs EVAL-012/014 (mechanism já provado — F31 prova a ADIÇÃO dos alvos repo-scoped) |
| EVAL-052 | remove round-trip (F31 D9/D7) | adapters (copilot) + CLI uninstall | 1. fingerprint == registrado → remove (arquivo vazio → deletado — D6); 2. entry MCP editada → preserved + edited (D7/SETM-05); 3. conteúdo do usuário fora da seção preservado; marcador de OUTRO id runecraft: → preservado (F18 MXST-02) | delta vs EVAL-017..048 (D6 — sem double-test) |
| EVAL-053 | fail-closed (F31 D6/D8/D9) | CLI install | 1. install sem detecção → recusa + hint display-only, zero writes nos alvos (rules/mcp); 2. copilot + `--component` Pi-only → firstUnsupported recusa com o motivo da célula; 3. dry-run → plano sem efeitos colaterais (sem lock/state de agentes) | contrato F15: exit ≠ 0 + alvos intocados (bookkeeping do state.json é do fluxo F15 pré-existente) |
| EVAL-054 | matrix/status (F31 D8) | matrix + CLI status/doctor | 1. `AGENTS.copilot` + coluna (taskflow mcp + rules + 4 unsupported com motivo "é extensão Pi; use --agent pi"); 2. status --json: 3 fontes (configs × state × matriz); cells taskflow/rules ok; `agents[].components[]` com reason; 3. doctor check 21 (detectado/ausente informativo — sem crash); 4. consistência matriz↔suites v9 | aditiva — colunas existentes intocadas (F17 D1) |
| EVAL-055 | two-driver (F31 D10) | owners + CLI install/sync | 1. gentle-ai state (`~/.gentle-ai/state.json` em HOME fake) → owners warn + gate MXST-04: sem TTY sem --yes aborta apontando --yes; --yes prossegue com warnings no relatório; 2. sync three-way: seção editada → "preservada (editada)" (F19 D7 — nunca auto-cura); ausente → re-inject preservando o usuário | sobreposição SEMÂNTICA user-level × repo-level documentada (check/status/ROUTING) |
| EVAL-056 | sync/state (F31 D9) | CLI install/sync/uninstall/status | 1. targets registrados com contentHash (fingerprint do MCP lido do ARQUIVO — lição F15); 2. sync idempotente (already in sync, zero writes); 3. uninstall preserva edição do usuário; 4. determinismo 2 runs (F21 D10) | delta vs EVAL-017..048 (sync three-way já provado no F19 — F31 prova a ADIÇÃO dos alvos copilot) |

| ID | Fluxo (evidência F30) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-039 | persona Pi (F30 PFC-01 — D1) | eval (framework/pi) | 1. sessão fixture (extensões persona + resilience + observability) → systemPrompt do before_agent_start contém `<!-- runecraft:persona -->` + PERSONA_VERSION=1 + texto objetivo; 2. 2 runs → texto idêntico (determinismo); 3. golden do texto (F23) | chaining sem clobber; persona objetiva (deny-list RPG ausente — assert no case) |
| EVAL-040 | rules + chaining (F30 PFC-02 — D2) | eval (framework/pi) | 1. systemPrompt contém `<!-- runecraft:rules -->` + PI_RULES (renderRules("pi") — reuso F19) + markers continuation/lessons TODOS presentes (persona + resilience + observability); 2. ordem de append preservada (persona → rules → continuation → lessons); 3. 2 runs idênticos | delta vs EVAL-021/028 (chaining já provado — F30 prova a ADIÇÃO da persona ao chain, não o chain em si) |
| EVAL-041 | first-message variant (F30 PFC-03 — D3) | eval (framework/pi) | 1. sessão initial → variante aplicada 1× (markApplied); 2. 2ª sessão reason=resume → variante NÃO aplicada; 3. 2 runs idênticos | port fiel (Sets created/applied em memória); determinismo por reason |
| EVAL-042 | model resolution (F30 PFC-04 — D4) | eval (framework/pi) | 1. models.json fixture (renderModelsJson com N modelos — F21) → availableModels real via ModelRuntime; 2. precedência: override → custom chain > builtin → systemDefault → null + warn; 3. fim-de-chain → null (nada inventado); 4. 2 runs idênticos | categoria **failover desbloqueada** (F26); chain custom > builtin |
| EVAL-043 | modelSwitch F27 (F30 PFC-06 — D6) | eval (framework/pi) | 1. trigger sintético (handlers exportados — AD-027 QA-5) → resolveModelSwitch retorna o próximo modelo (leve→forte); 2. chain esgotada → halt + escalação humana (reason "model-chain exhausted"); 3. assert de diff: arquivos do F27 (fallback.ts/types.ts) byte-idênticos | implementação da interface NO-OP do F27; ZERO mudanças nos arquivos do F27 |
| EVAL-044 | models generate (F30 PFC-07 — D7) | eval (framework/pi) | 1. renderModelsJsonFromConfig 2 runs → byte-idêntico (merge do state models; canonicalJson F23); 2. kill switch RUNECRAFT_MODELS=0 → CLI recusa sem escrever; 3. list/doctor shapes estáveis | determinismo (sem timestamps/paths); merge aditivo preserva providers existentes |
| EVAL-045 | archive de planos (F30 PFC-09 — D9) | eval (framework/pi) | 1. plans fixture (.runecraft/plans/<slug>) → archive move + {ok,warnings}; 2. 2º run do mesmo slug → ok:false (plano ausente — nunca move nada alheio); 3. slug inválido → recusa antes de IO | port createArchivePlanTool; DI rename p/ teste |
| EVAL-046 | sdd scope + chains (F30 PFC-08 — D8) | eval (framework/pi) | 1. scope.ts limiares (quick/medium/large — casos tabelados); 2. chains sdd-*.chain.md existem e parseiam no formato do fork (parseChain real — chain-serializer.ts:101: front-matter name+description + seções `## <agente>` worker/reviewer); 3. 2 runs idênticos | formato validado contra o parser REAL do fork (não o f3-taskflow histórico) |
| EVAL-047 | templates SDD (F30 PFC-08 — D8) | eval (framework/pi) | 1. sdd new → scaffold .specs/features/x/ no shape da casa (confere vs templates); 2. goldens dos templates (F23); 3. deny-list de termos RPG ausente do conteúdo renderizado (persona/templates/chains) | decisão 2 verificável (objetivo, sem lore) |
| EVAL-048 | config/kill switches (F30 PFC-05 — D5) | eval (framework/pi) | 1. state `models`+`persona` defaults/freeze (fail-closed); 2. `RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0` → camadas inertes + CLI recusa (exit 0, nada criado); 3. 2 runs idênticos | padrão F24/F25/F27/F28/F29 (F20) |

| ID | Fluxo (evidência F32) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-057 | render/goldens dos 7 papéis (F32 D3 — ROLE-02/04) | eval (framework/roles) | 1. assets `agents/*.md` existem e validam (frontmatter flat espelho do fork; name == filename; keys ⊆ KNOWN_FIELDS; tools ⊆ vocabulário verificado); 2. deny-list RPG ausente (substring — precedente F30 EVAL-047); 3. determinismo 2 runs | unit do framework (mesmo padrão EVAL-017..020); delta vs EVAL-012/015 (goldens — F32 prova a ADIÇÃO dos assets de papéis, não o mecanismo) |
| EVAL-058 | discovery real do fork (F32 D1/D2 — ROLE-01/03) | eval (framework/roles) + fixture | 1. `.pi/agents/` com os 7 → `subagent({action:"list"})` em sessão REAL → os 7 aparecem como `(project`; 2. shadowing: planner project > builtin (mergeAgentsForScope do fork — validado no Execute); 3. sem diagnóstico adversarial | delta vs EVAL-002/005 (discovery de builtins já provada — F32 prova a ADIÇÃO dos papéis project) |
| EVAL-059 | tool-use: scout read-only (F32 D3 — ROLE-02) | eval (suites/roles) | 1. sessão com allowlist do scout (read,grep,find,ls,intercom) → read→grep→find→ls→done; 2. tool-policy sobre registry REAL: write/edit/bash/subagent ausentes | categoria **tool-use correctness DESBLOQUEADA** (F26); delta vs EVAL-014 (mecanismo já provado — F32 prova a ADIÇÃO da allowlist do papel) |
| EVAL-060 | tool-use: builder writer (F32 D3 — ROLE-02) | eval (suites/roles) | 1. sessão com allowlist do builder → read→write→bash→done; 2. tool-policy: write/edit/bash/subagent presentes e legítimos; contact_supervisor bridge-gated (validado no Execute) | tool-use; QA-5a (único papel com subagent); delta vs EVAL-014/059 |
| EVAL-061 | tool-use: auditor md-only (F32 D7 — ROLE-07) | eval (framework/roles) + fixture | 1. sessão REAL com RUNECRAFT_AGENT_ID=auditor + allowlist do auditor: write `src/feature.ts` → BLOQUEADO (ranger-md-only — default `mdOnlyAgents=[auditor]`); 2. write `docs/audit.md` → passa e escreve; 3. env restaurado | identidade via env do harness (F24 currentAgentId — validado no Execute); o guard NÃO muda (config-gated D7) |
| EVAL-062 | routing: planner→builder (F32 D5 — ROLE-05) | eval (framework/roles) + fixture | 1. sessão REAL: `subagent({agent:"builder", async:true})` → evento `delegation` no event store do F28 com agent="builder"; 2. delegação observada pela tool subagent (F2/F28) | categoria **routing completeness DESBLOQUEADA** (F26); fallback honesto do design D9: o trace só expõe nomes de tools — o alvo vive no delegation event tipado (EVAL-024 provou o evento; F32 prova o ALVO papel) |
| EVAL-063 | routing: builder→reviewer (F32 D5/D6 — ROLE-05/06) | eval (framework/roles) + fixture | 1. `subagent({agent:"reviewer"})` → delegation event agent="reviewer"; 2. reviewer.md define o veredito estruturado ([APPROVE]/[REJECT] + ≤3 blocking issues — cleric D3/D6) | routing; pr-review (F5) + receipts (F20) donos do fluxo PR (fronteira D6) |
| EVAL-064 | routing: builder→scout (F32 D5 — ROLE-05) | eval (framework/roles) + fixture | 1. `subagent({agent:"scout"})` → delegation event agent="scout" (recon pré-build); 2. scout.md read-only (sem write) | routing; delta vs EVAL-024 (evento de delegação já provado — F32 prova o ALVO papel) |
| EVAL-065 | delegation-template (F32 D4/D5 — ROLE-04/05) | eval (framework/roles) | 1. `renderDelegationPrompt` 2 runs byte-idênticos (F21 D10); 2. lista os 7 papéis (buildKeyTriggersSection); 3. papel sem `subagent` no allowlist → null (fail-closed QA-5a) | unit do framework; spawn-wizard do arcanum portado como template (sem runtime novo) |
| EVAL-066 | models interface (F32 D8 — ROLE-08) | eval (framework/roles) | 1. `resolveAgentModel` com ids de papel via custom chain do state (precedência override → custom > builtin → default → null + warn); 2. fim-de-chain → null + warn (nada inventado — F30 D4); 3. `validateModelsConfig` aceita os 7 ids | contrato F30 D5/D11 (F32 consome, não implementa); delta vs EVAL-042 (resolução já provada — F32 prova a ADIÇÃO dos ids de papel) |

| ID | Fluxo (evidência F33) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-067 | classifier determinismo (F33 RTE-01 — D1/D3) | eval (framework/routing) | 1. `classifyRoute(input)` 2 runs → decisão byte-idêntica (todas as chaves, F21 D10); 2. constantes explícitas (ROUTE_THRESHOLD=2, high ×2, medium ×1) | unit do framework (mesmo padrão EVAL-017..020); zero LLM — decisão 3c |
| EVAL-068 | classifier fail-closed (F33 RTE-01 — D3) | eval (framework/routing) | 1. input sem sinais → `direct` (nenhuma rota inventada, reason fail-closed); 2. vazio/ilegível → direct (reason empty) | falha-closed em tudo (sem sinal → direct) |
| EVAL-069 | classifier boundaries (F33 RTE-02 — D3) | eval (framework/routing) | 1. score 1 (1 medium) → direct; 2. score 2 (2 mediums) → rota; 3. score 2 (1 high) → rota | ROUTE_THRESHOLD=2 em constante; calibração empírica (sem invenção) |
| EVAL-070 | classifier security obrigatória (F33 RTE-02 — D3) | eval (framework/routing) | 1. keyword high de segurança + sinal de outra rota → security (reason mandatory, bypassa threshold); 2. 1 medium de segurança (score 1) → direct (obrigatoriedade só com high) | espelho do paladin "MUST ... not optional"; deny-list RPG ausente (EVAL-067) |
| EVAL-071 | classifier prioridade (F33 RTE-02 — D3) | eval (framework/routing) | 1. empate implement/review → implement (ordem determinística); 2. ordem completa security>planning>implement>review>research>explore verificada por construção | nunca aleatório — decisão 3c |
| EVAL-072 | routing explore→scout (F33 RTE-04/05 — D4/D5) | eval (suites/routing) + fixture | 1. sessão REAL com extensão routing + chain explore.chain.md em .pi/chains/ → input de recon → directive no systemPrompt (marker `<!-- runecraft:routing -->` + Route: explore); 2. delegação REAL via tool `subagent` → delegation event agent="scout" (F28); 3. trajectory-assertion (subagent) + tool-policy | categoria **routing completeness COMPLETA** (F26 — última categoria); delta vs EVAL-064 (delegação via evento já provada — F33 prova a ADIÇÃO do roteador codificado) |
| EVAL-073 | routing research→researcher (F33 RTE-04/05 — D4/D5) | eval (suites/routing) + fixture | 1. sessão REAL + chain research.chain.md → input de pesquisa → directive Route: research; 2. delegação real → delegation event agent="researcher" | routing; delta vs EVAL-062..064 |
| EVAL-074 | routing planning→planner (F33 RTE-02/04 — D3/D4) | eval (suites/routing) + fixture | 1. sessão REAL + chain plan.chain.md + `.specs/features/f1/spec.md` (SDD — +2 planning) → directive Route: planning; 2. delegação real → delegation event agent="planner" | feature SDD (D3): `.specs/**/spec.md` presente → planning |
| EVAL-075 | routing implement→builder→reviewer (F33 RTE-04/05 — D4/D5) | eval (suites/routing) + fixture | 1. sessão REAL + chain implement.chain.md → directive Route: implement; 2. delegações reais → delegation events agent="builder" + agent="reviewer"; 3. veredito estruturado [APPROVE]/[REJECT] + ≤3 blocking issues no asset da chain | gate da chain (D4 — veredito F32); trajectory-assertion (subagent → subagent) |
| EVAL-076 | extensão routing (F33 RTE-03 — D1/D6) | eval (framework/routing) | 1. before_agent_start injeta o directive (marker); 2. freeze por sessão (2ª chamada = mesma decisão — sem re-classificação por spawn); 3. `RUNECRAFT_ROUTING=0` → inerte (kill switch F20) | hook = before_agent_start (STOP RULES — event.prompt é a 1ª mensagem, types.d.ts:518); freeze F24 D12 |
| EVAL-077 | two-driver (F33 RTE-06 — D6) | eval (framework/routing) | 1. ledger glla supervisionando (F19 isSupervising: goal active + autoContinue) → routing SKIP (nenhum directive — o loop é o piloto); 2. sem ledger → directive normal | two-driver rule (ROUTING.md §2); kill switch/documentação valem mesmo inertes |
| EVAL-078 | chain selection + contrato F30 (F33 RTE-04/06 — D4/D7) | eval (framework/routing) | 1. chain ausente em .pi/chains/ → direct + warn (fail-closed — nunca inventa); 2. render do directive 2 runs byte-idênticos; 3. passo da chain (papel F32) → `models.agents.<id>` resolve (resolveAgentModel); 4. fim-de-chain → null + warn (F30 D4) | contrato F30 D5/D11 (F33 consome, não implementa); delta vs EVAL-066 |


**Limitações declaradas** (espelho do gentle-ai): a sequência scriptada prova
que o harness ORQUESTRA as ferramentas na ordem certa e que cada passo é
executado de verdade; NÃO prova que um modelo vivo produziria os mesmos tool
calls (fora do merge gate — F22 cobre E2E real).

## Evidência (D10)

- Por test file: `test/eval/evidence/partial/<file>.jsonl` (append, linha por
  teste) — `{testFile, testName, status, message, durationMs, evalId}`.
- Merge: `bun scripts/eval-merge-evidence.ts` → `test/eval/evidence/last-run.json`
  (gitignored) para o F23 (ratchets).
- `fail-infra` (ambiente quebrado — git ausente, rede fora de loopback, versão
  de bun) é classificado no `test/eval/setup.ts`; mensagem gravada CRUA
  (a normalização é responsabilidade ÚNICA do F23).

## Camada 1 (sem modelo)

Comandos do CLI exercitados contra fixtures (dispatch in-process + fake pi)
vivem nos testes existentes do package — F21 reconciliação:

| Área (design) | Coberto por |
| --- | --- |
| install/doctor/status/sync/uninstall + lifecycle F15 + adapters + backup/restore | `test/{install,doctor,status,sync,uninstall,merge,adapters,backup,restore}.test.ts` |
| gates (enable/disable/run/uninstall) + receipt capture `--from` | `test/{gates,receipt}.test.ts` |
| routing golden (renderRules == ROUTING.md, ausência não-Pi, limites de linhas) | `test/f19-routing.test.ts` |
| state schema F13 (escrita atômica, migração, corrompido) | `test/state.test.ts` |
| bin real via subprocess (exit code + JSON) | `test/eval/layer1/smoke-subprocess.test.ts` (NOVO) |
| verify (F25): engine pura + stages + config + CLI `harness verify` (exit codes, paridade, adversarial) | `test/verify/{engine,stages,config,cli,cascade-eval}.test.ts` (NOVO) |

**Limites de linhas dos templates (calibrados no Execute):** pi = 46 linhas,
não-pi = 13 (o design estimou ≤45/≤25; o teste existente calibrou 46/25 —
qualquer mudança de texto deve manter o golden do ROUTING.md em sincronia).
