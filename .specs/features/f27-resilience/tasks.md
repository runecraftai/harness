# F27 — Tasks (Resilience & Continuity)

**Base:** design.md D1–D9 (aguarda QA-1..QA-5 → AD-027) · infra reutilizada: F21 (fixture OpenAI-wire, ScriptedScenario, evalTest → evidência, EVAL-MATRIX, consistency), F24 (guards, enforcer complete_goal, ledger `.pi-glla/active.jsonl`, tools glla propose_task_list/update_task_status), F25 (RETRY/SKIP/HALT, cost.ts, suggestions.ts), F26 (framework eval — suites/cases/scenarios TS), fork glla (heartbeat/wedge/repetition/backoff/quota — padrões provados, atribuição AD-002)
**Dependências de decisão:** T1/T2/T3 (QA-1/QA-2) · T5 (QA-4) · T7 (QA-3) · T8 (QA-5) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/resilience/types.ts + config.ts (D1/D2/D9, RES-01/09)

- [ ] `types.ts`: CompactionPhase, ContinuationState (goal, progress, workSummary, lastSessionId, taskListSnapshot), StallSignal (repetition|identical-output|wedge|heartbeat + payload), FailureClass (agent|infra|unknown), FallbackPolicy (stop-all|skip-and-continue), FallbackAction (retry|re-inject-continuation|pause|halt|modelSwitch — modelSwitch é INTERFACE, NO-OP documentado — fronteira F30); sem imports externos novos
- [ ] `config.ts`: thresholds de stall/backoff/escalação (defaults = valores do fork glla — ler HEARTBEAT_STALL_MS/PENDING_LATCH_STUCK_MS/WEDGE_ALERT_DEFAULT_MINUTES/REPETITION.* no source do fork durante o Execute e citar no código); schema v1 ADITIVO no state F13 sob `resilience` (padrão guards/verification F24/F25); freeze por sessão; kill switch `RUNECRAFT_RESILIENCE=0`
- [ ] **Verificar:** unit — schema válido/inválido; kill switch desliga a camada (handlers inertes); freeze por sessão; zero deps novas (audit de imports); tipos compilam

## T2 — src/resilience/continuation.ts (D2, RES-02) — depende QA-1

- [ ] PURO: `readGoalState(ledger)` (campos do ledger consumidos pelo F24 — confirmar shape no Execute) → ContinuationState; `.runecraft/continuation.json` (schema v1, gravação atômica — padrão F20) para metadados do harness (workSummary, contadores, snapshot p/ preserver) — alternativa QA-1b: estender state.json F13
- [ ] PURO: `buildContinuationPrompt(state) → string | null` — marker `<!-- runecraft:continuation -->`, goal, progresso `completed/total`, diretório, instruções determinísticas (restaurar todos via propose_task_list; continuar da primeira tarefa não checada; nunca re-executar completas; complete_goal só com tudo checado); scoping de sessão (última session_id do ledger); goal completo/pausado/sem goal → null; **invariante D7: pendentes derivados SÓ do ledger atual (nunca snapshot de goal anterior — regressão AD-024)**
- [ ] **Verificar:** unit — goal 3/5 → prompt com marker/progresso/próxima; completo → null; pausado → null; sessão não-scoped → null; 2 runs idênticos (sem $TMP/$TS — F21 D10); re-injeção de tarefa completa → NÃO ocorre (assert adversarial)

## T3 — src/extensions/resilience.ts (D1/D2/D3, RES-01/02/03) — depende QA-1/QA-2

- [ ] Wiring Pi: `on("session_before_compact")` → snapshot taskList + ContinuationState (D1 primário); `on("session_compact")` → marca compactedAt + grace (padrão glla COMPACTION_GRACE_MS=3min); `on("session_start")` → reason resume|reload (fallback D1) e startup com goal ativo (resume de restart — semântica glla); `on("before_agent_start")` → buildContinuationPrompt → `BeforeAgentStartEventResult.systemPrompt` (encadeado — NÃO sobrescrever outras extensões); comando `/start-work` (resume do ledger → context injection; API de comando Pi a validar no Execute — glla registra /goal//list//loop; fallback: detecção no before_agent_start)
- [ ] **Verificar:** integração fixture — handler exportado invocado com eventos scriptados (session_compact sintético, session_start resume) → continuação injetada; sem goal → sem rewrite; chaining preservado (outra extensão de system prompt continua funcionando — ordem a validar); kill switch inerte

## T4 — src/resilience/todo-preserver.ts (D3, RES-03)

- [ ] Snapshot do `goal.taskList` no session_before_compact (lido do ledger — fonte única); restauração via `propose_task_list`/`update_task_status` (tools REAIS do glla — F24 provou que NÃO há todowrite/todoresolve); taskList sobreviveu → no-op (semântica arcanum "todos survived, skipping restore"); idempotente; nunca compete com enforcer F24 (formato v1 — RES-07)
- [ ] **Verificar:** unit/integração — snapshot capturado; wipe simulado → restore com tools reais (sessão scriptada); sobreviveu → no-op; sem snapshot prévio → no-op (debug, não falha); restore não duplica entradas

## T5 — src/resilience/stall.ts (D4, RES-04) — depende QA-4

- [ ] PURO: `detectStall(trace, clock, thresholds) → StallSignal[]` — `repetition` (mesma tool + args normalizados ≥ N — default 3, padrão toolResultRepeat do glla; output hash igual), `identical-output` (fingerprint sha256 / Jaccard ≥ 0.8 — padrão goal-loop-repetition; copiar com atribuição AD-002 ou reimplementar clean-room e documentar), `wedge` (sessão OCUPADA + silêncio > limiar — padrão wedge alert), `heartbeat` (ociosa sem progresso > limiar → refire com escada de stall — padrão heartbeat/escalação); backoff ladder (padrão goal-loop-backoff: stuck/error/context, hard cap 5min); relógio/timestamps INJETÁVEIS; suppression herdada: audit-in-flight, pós-compactação grace, extensionApiStale (padrões do fork — reusar, não reimplementar)
- [ ] Entrada observa eventos reais do SDK: tool_call, turn_start/turn_end (timestamps), agent_end, ctx.isIdle()/hasPendingMessages()
- [ ] **Verificar:** unit com traces scriptados e relógio fake — 3x chamada idêntica → repetition; output igual → identical-output; silêncio ocupada → wedge; silêncio ociosa → heartbeat; backoff respeita caps; 2 runs idênticos; suppression ativa → zero sinais

## T6 — src/resilience/classify.ts (D5, RES-05)

- [ ] PURO: `classifyFailure(input) → { class: agent|infra|unknown, reason, suggestion }` — exit code ≠ 0, timeout (padrão AD-024 SIGTERM/SIGKILL), rate-limit/quota (reuso `isQuotaError`/`parseQuotaError` do glla — padrão do fork), stall signals (T5), repetição; sugestão no formato `suggestions.ts` do F25; unknown → fail-closed (HALT com reason)
- [ ] **Verificar:** unit — 429/Retry-After → infra + sugestão retry/backoff; timeout → infra; stall/repetição → agent + sugestão re-inject/pause; caso ambíguo → unknown + HALT; zero LLM (F27 determinístico — sem judge, sem env-gated)

## T7 — src/resilience/fallback.ts (D6, RES-06) — depende QA-3

- [ ] Engine de política multi-trigger: rate-limit | timeout | stall | falha repetida → ação da cadeia; política `stop-all` (HALT com reason — padrão F25) vs `skip-and-continue` (SKIP + veredito no log — padrão F25); orçamento de escalação reusando padrões do CostLedger F25 (cost caps → HALT); ações reais F27: retry, re-inject-continuation (T2), pause, halt; `modelSwitch` = interface + NO-OP documentado (F30 implementa — fronteira explícita; alternativa QA-3b: env/modelRoles — duplica F30)
- [ ] **Verificar:** unit com policy fakes — cada trigger → ação/política certa; stop-all esgota → HALT com reason; skip-and-continue → veredito registrado; orçamento esgotado → HALT sem mais tentativas; modelSwitch NO-OP (nunca toca settings/modelRoles); kill switch inerte

## T8 — integração invariante F24 + evals (D7/D8, RES-07/08) — depende QA-5

- [ ] Teste adversarial: continuação re-injeta tarefa JÁ completada → falha com diagnóstico (invariante D7; regressão AD-024 coberta); goal 3/5 → compactação scriptada → continuação re-injeta tarefa 4 (não 3) → agente completa 4 e 5 → `complete_goal` verde (sem phantom-block)
- [ ] Suite `test/eval/suites/compaction-recovery.ts` + cases EVAL-017..021 (formato F26): EVAL-017 continuation builder (puro), EVAL-018 todo-preserver, EVAL-019 stall (ScriptedScenario replaya chamadas idênticas → detector ≤ N turnos), EVAL-020 classify+fallback, EVAL-021 fluxo completo (goal ativo → compactação scriptada — QA-5: evento sintético via handler exportado; viabilidade de evento real no fixture a validar no Execute → fallback documentado); delta vs EVAL-006/007/014 documentado em comentário em cada case (sem double-test)
- [ ] **Verificar:** EVAL-017..021 verdes offline/$0 na lane F21 (loopback, apiKey literal, zero fetch externo); evidência no last-run.json; 2 runs idênticos; invariante F24 verde no fluxo; sem regressão nos EVAL-001..016

## T9 — EVAL-MATRIX v5 + consistência + docs (D9, RES-09)

- [ ] EVAL-MATRIX v5 aditivo (política F21 D9, bump MATRIX_VERSION): EVAL-017..021 + notas datadas + nota "categoria compaction-recovery desbloqueada (bloqueada no F26 — após F27)"; tool-use/routing (F32) e failover (F30) seguem SEM entradas; teste de consistência estendido para varrer test/eval/suites (já cobre — confirmar inclusão da nova suite)
- [ ] Docs: tabela de mecanismos (SDK 0.81.0/fork → F27 — tabela do design D1..D6) em docs/ + seção "Resilience" no ROUTING.md (F19 D9) + atualizar tabela de dependência das 5 categorias do eval-coverage (F26: compaction agora implementável); fonte real (types.d.ts do SDK + fork glla + arcanum hooks — sem fabricação)
- [ ] **Verificar:** consistência matriz↔suites verdes; tabela conferida contra os tipos reais (checklist: session_before_compact/session_compact/context/before_agent_start no types.d.ts; heartbeat/wedge/repetition/backoff/quota no fork; 4 hooks do arcanum mapeados); goldens do ROUTING verdes; `bun test` sem regressão pós-F26 + novos verdes offline/$0

## Success Criteria (spec)

- [ ] Tabela de mecanismos (SDK 0.81.0/fork → F27) documentada com evidência nos tipos/fonte (sem fabricação)
- [ ] Trigger de compactação definido com evidência (eventos nativos + fallback honesto) e limitação documentada (validação no Execute)
- [ ] Continuação determinística offline: goal ativo 3/5 → prompt re-injeta pendentes → agente completa → evidência (fixture F21); 2 runs idênticos
- [ ] Stall detector dispara em trace scriptado (chamadas idênticas repetidas, output igual, silêncio com relógio fake) — determinístico, limiares configuráveis
- [ ] Classificador agente-vs-infra unit com sugestão acionável; fallback engine multi-trigger com política stop-all/skip-and-continue + orçamento (padrões F25)
- [ ] Invariante F24 provada por teste (re-injeção de task completada → falha com diagnóstico; regressão AD-024 coberta)
- [ ] EVAL-017..021 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v5 aditivo com notas datadas; sem regressão pós-F26
- [ ] Fronteira F30 explícita: `modelSwitch` é interface; F27 não resolve modelo
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)

## Traceability RES → tasks

| Requirement | Tasks |
| --- | --- |
| RES-01 (observação de compactação) | T1, T3 |
| RES-02 (continuação pós-compaction) | T1, T2, T3 |
| RES-03 (todo preserver) | T3, T4 |
| RES-04 (stall detection) | T1, T5 |
| RES-05 (classificação agente-vs-infra) | T6 |
| RES-06 (fallback chain) | T1, T7 |
| RES-07 (invariante F24) | T2, T4, T8 |
| RES-08 (evals compaction-recovery) | T8, T9 |
| RES-09 (config + docs) | T1, T9 |

**Cobertura:** 9/9 · toda user story da spec tem requirement ID (RES-01..09) · todo requisito tem task.
