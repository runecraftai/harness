# EVAL-MATRIX — fluxos determinísticos da camada 2 (F21)

MATRIX_VERSION: 4

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

Cobertura de requisitos: DETR-01..06 — 6/6 (ver `.specs/features/f21-eval-deterministic/spec.md`) + F24 GUARD-01..08 (ver `.specs/features/f24-execution-guards/spec.md` — EVAL-006 → GUARD-01/02/07/08; EVAL-007 → GUARD-04/05/07/08) + F25 VER-01..13 (ver `.specs/features/f25-verification-cascade/spec.md` — EVAL-008 → VER-01/02; EVAL-009 → VER-03/04; EVAL-010 → VER-07/08/09/10; EVAL-011 → VER-06) + F26 EVAL-012..016 (ver `.specs/features/f26-eval-framework-port/spec.md` — framework de evals portado do arcanum, AD-026).

**v2 (F24, AD-022):** entradas aditivas EVAL-006 (write guard) e EVAL-007 (todo enforcer) — política aditiva D9; o teste de consistência agora também varre `test/guards/` (lane dos guards).

**v3 (F25, AD-023):** entradas aditivas EVAL-008..011 (verification cascade) — política aditiva D9; o teste de consistência agora também varre `test/verify/` (lane da cascata).

**v4 (F26, AD-026):** entradas aditivas EVAL-012..016 (eval framework portado do arcanum) — política aditiva D9; o teste de consistência agora também varre `test/eval/suites` (dados TS do framework) e `test/eval/framework` (lane do framework). Categorias bloqueadas do eval-coverage (tool-use/routing → F32, compaction → F27, failover → F30) NÃO têm entrada — política aditiva (nada sai sem AD); a tabela de dependência está no docs/EVAL-FRAMEWORK.md (D5, outline — sem inventar design de F27/F30/F32).

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
