# EVAL-MATRIX — fluxos determinísticos da camada 2 (F21)

MATRIX_VERSION: 2

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

Cobertura de requisitos: DETR-01..06 — 6/6 (ver `.specs/features/f21-eval-deterministic/spec.md`) + F24 GUARD-01..08 (ver `.specs/features/f24-execution-guards/spec.md` — EVAL-006 → GUARD-01/02/07/08; EVAL-007 → GUARD-04/05/07/08).

**v2 (F24, AD-022):** entradas aditivas EVAL-006 (write guard) e EVAL-007 (todo enforcer) — política aditiva D9; o teste de consistência agora também varre `test/guards/` (lane dos guards).

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

**Limites de linhas dos templates (calibrados no Execute):** pi = 46 linhas,
não-pi = 13 (o design estimou ≤45/≤25; o teste existente calibrou 46/25 —
qualquer mudança de texto deve manter o golden do ROUTING.md em sincronia).
