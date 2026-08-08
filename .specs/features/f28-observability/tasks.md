# F28 — Tasks (Observability & Lessons)

**Base:** design.md D1–D10 (aguarda QA-1..QA-5 → AD) · infra reutilizada: F13 (state schema v1 aditivo), F21 (fixture, ScriptedScenario, evalTest → evidência, EVAL-MATRIX, consistency), F24 (guards, bloqueio `<guardId>: msg`, guardLog, RUNECRAFT_AGENT_ID, ledger), F25 (recordSessionVerdict best-effort, verify-verdicts.jsonl, RETRY/SKIP/HALT), F26 (framework eval), F27 (before_agent_start chaining, continuation.json — mecanismos reutilizados; contrato OBS-09), fork glla (sinais de stall no ledger), arcanum (context-window-monitor/session-token-state/analytics — port semântico, AD-001)
**Dependências de decisão:** T1 (QA-1) · T2/T3 (QA-2) · T6 (QA-4) · T7 (QA-3) · T5 (QA-5) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/observability/types.ts + config.ts + store.ts (D1/D2/D9, OBS-01/11) — depende QA-1

- [ ] `types.ts`: `EventRecord` discriminated union — base `{seq (int ≥ 0, monotônico por sessão), kind, sessionId, bundle (prefixo 12 hex), payload, runId?, source?: "sdk"|"internal"|"bridge"}`; kinds v1: session:started/ended, bundle:changed, context:usage, tokens:usage, tool:call/result, delegation, guard:blocked, verification:verdict, resilience:signal, lesson:captured/reincidence/promoted, adendo:injected; kinds CONTRATO reservados: verification:started, verification:stage (v1 não emite — documentar); `at` (ISO) SÓ no payload informacional — nunca na identidade (F21 D10); `Lesson`, `LessonRecord`, `BundleFingerprintInput`
- [ ] `config.ts`: schema v1 ADITIVO no state F13 sob `observability` — `{contextWindow: {warningPct: 0.8, criticalPct: 0.95}, lessons: {promotionThreshold: 3, highPriorityThreshold: 2, maxAdendoLessons: 3}, enabled: true}` (padrão guards/verification F24/F25 — freeze por sessão); kill switch `RUNECRAFT_OBSERVABILITY=0`
- [ ] `store.ts`: append-only por sessão — `appendEvent(sessionId, kind, payload)` (QA-1a: `.runecraft/events/<sessionId>.jsonl`; mkdir recursive + appendFileSync + try/catch + guardLog warn — precedente recordSessionVerdict, NUNCA throw); seq auto (lê último seq do arquivo — recovery pós-crash); prevHash chain (sha256 da linha anterior); leitura fail-soft (malformadas puladas — padrão ledger v0.28.6); kill switch inerte (zero arquivos)
- [ ] **Verificar:** unit — seq monotônico e determinístico; escrita falha (path inválido) → NÃO throw e sessão continua (assert no caller); kill switch → zero arquivos; prevHash encadeado; leitura de arquivo truncado → pula e segue; zero deps novas (audit de imports); tipos compilam

## T2 — src/observability/bundle.ts (D3, OBS-02) — depende QA-2

- [ ] PURO: `canonicalJson` (chaves ordenadas recursivamente — padrão sort F23) + `computeBundleHash(input: BundleFingerprintInput) → {full: sha256hex, short: 12-hex-prefix}` — input = `{harnessVersion, sdkVersion, forks{id→version}, config{guards, verification, resilience, observability} (sections do state), settings (prefixos relevantes F14), rules: renderRules(agentId) (F19 puro), routingVersion (WORKFLOW_RULES_VERSION)}`; `gitHead` FORA do hash (campo do header — QA-2a); `bundle:changed` quando config muda no meio da sessão (eventos antigos imutáveis)
- [ ] **Verificar:** unit — mesma config+prompts → mesmo hash (2 runs); mudança em config → hash diferente; gitHead diferente → MESMO hash; chaves desordenadas no input → mesmo hash (canonical); prefixo estável (12 hex)

## T3 — src/observability/session-recorder.ts (D4, OBS-03)

- [ ] Port do SessionTracker/analytics do guild: `startSession` (idempotente), `trackToolStart/End` (tool:call com argsHash sha256 normalizado; tool:result com ok/blocked?/guardId?/reason?/durationMs), delegação via tool `subagent` (F2 — equivalente de task/call_guild_agent do guild), `trackModel` (primeiro), `trackTokenUsage` (acumula input/output/reasoning/cacheRead/cacheWrite/totalMessages — semântica TokenUsage do guild), `endSession` → `session:started` (header: bundleHash full, agentId via RUNECRAFT_AGENT_ID, model, gitHead, versões) + `session:ended` (durationMs, toolUsage[], delegations[], totalToolCalls, totalDelegations, tokenTotals); identidade determinística (F21 D10); delegação só para `subagent` (nunca toda tool)
- [ ] **Verificar:** unit — agregados corretos de trace scriptado (3 tools + 1 delegação); 2 runs → mesma sequência de identidade; durationMs/at = payload informacional (não entra no assert); session:ended sem toolUsage → campos vazios (não undefined)

## T4 — src/observability/context-monitor.ts + token-state.ts (D4, OBS-04/05)

- [ ] `context-monitor.ts`: PURO — port de `checkContextWindow` (thresholds 0.8/0.95 do config) → `{action: none|warn|recover, usagePct}` → `context:usage`; entrada injetável (relógio/uso fake — determinismo)
- [ ] `token-state.ts`: port de session-token-state — mapa por sessão `{maxTokens, usedTokens}`; `setContextLimit` (não sobrescreve usedTokens), `updateUsage` (só inputTokens > 0; latest não cumulativo), `clearSession`
- [ ] Fontes de sinal (QA-5a): SDK `context` event (shape a VALIDAR no Execute — mesmo flag F27 D1; honesto, sem inventar); leitura READ-ONLY dos token-budget do taskflow (`.pi/taskflows/runs/token-budget/*.json` — shape VERIFICADO: runId, def.budget.maxTokens, phases[].usage{input,output,cacheRead,cacheWrite,cost,contextTokens}; NUNCA escrever em `.pi/`) → eventos com `source:"bridge"`; `shouldCompact` (puro) como checagem sob demanda
- [ ] **Verificar:** unit — usagePct 0.85 → warn; 0.97 → recover; 0.5 → none; updateUsage ignora inputTokens ≤ 0; parse do token-budget fixture (JSON real verificado) → context:usage correto; 2 runs idênticos

## T5 — src/observability/lessons.ts (D5/D6, OBS-06/07/08) — depende QA-4

- [ ] PURO: `captureLesson({trigger, antiPattern, preferred, priority, gate, track})` — triggerSignature = sha256(canonicalJson({trigger, gate})); dedupe (mesma signature → count++ + rewrite record em `.runecraft/lessons.jsonl` — arquivo de ESTADO, escrita atômica tmp+rename padrão F20; precedente continuation.json F27); record `{lessonId, triggerSignature, trigger, antiPattern, preferred, priority, gate, track, count, status: active|promoted|archived, firstSeenSeq, lastSeenSeq}`; promoção: `count >= promotionThreshold` (3) OU `priority=high && count >= highPriorityThreshold` (2) → grava `.runecraft/lessons/promoted.jsonl` (VERSIONADO — memória de time; QA-4a) + `lesson:promoted`; CLI `harness lessons list | promote <id> | archive <id>` (promote força; archive status=archived)
- [ ] PURO: `buildLessonAdendo(lessons, {gate?, track, max=3}) → string|null` — filtro `gate == gateId` (execution) ou `status=promoted` (planning); ordena (priority, count) desc; corta em max; texto compacto determinístico — `Gatilho: X · Anti-padrão: Y · Padrão preferido: Z (P<n>)` — sem $TMP/$TS (F21 D10); marker `<!-- runecraft:lessons -->` (constante exportada)
- [ ] **Verificar:** unit — captura 4 campos; dedupe (mesmo trigger+gate = mesmo record, count++); 3 reincidências → promoted.jsonl + evento; high+2 → promove antes; adendo filtrado por gate (nunca vaza lesson de outro gate), ≤3, ordenado; 2 runs idênticos; sem lessons → null; promote/archive CLI

## T6 — src/extensions/observability.ts (D1/D4/D6/D7, OBS-03/04/05/08/09) — depende QA-3

- [ ] Wiring Pi: `on("session_start")` → session:started (header bundle) + adendo trilha planning (D6); `on("tool_call")` → tool:call + observação de bloqueio F24 (reason `<guardId>: msg` — formato D3 F24 → `guard:blocked`; a validar no Execute se o resultado expõe o block — fallback: bridge por ledger); `on("before_agent_start")` → adendo trilha execution anexado ao `systemPrompt` (chaining encadeável — NÃO sobrescrever outras extensões; QA-3a; marker); `on("session_end"/"agent_end")` → session:ended; `on("context")`/mensagens → context:usage/tokens:usage; kill switch `RUNECRAFT_OBSERVABILITY=0` → handlers no-op
- [ ] **Verificar:** integração fixture — sessão scriptada emite eventos com seq correto; bloqueio F24 induzido → guard:blocked; adendo presente no systemPrompt com marker (só quando há lessons do gate); chaining preservado (outra extensão de system prompt continua funcionando — ordem a validar); kill switch inerte; escrita falha → sessão continua

## T7 — src/observability/export.ts + CLI + docs (D7/D8, OBS-09/10)

- [ ] `harness events export --format jsonl [--session <id>] [--include-external]` (comando novo no dispatch do F11): merge determinístico — store ordenado por (sessionId lexicográfico, seq asc) + bridges externos com `source:"bridge"` e seq virtual (documentado): verify-verdicts.jsonl → `verification:verdict` (verifyId/status/layer/reason/suggestion/cost — shape verificado recordSessionVerdict); ledger glla + continuation.json (F27) → `resilience:signal` (sinais pending_latch_stuck/wedge_alert/heartbeat_refire — shape a ler do fork no Execute); verificação prevHash (violações → stderr + exit 0 com aviso); fail-soft em linhas malformadas
- [ ] `docs/EVENTS.md`: catálogo de kinds (v1 + contrato reservado), tabela de fronteiras (verify-verdicts/ledger/continuation/evidence donos; events = F28), **tabela de mapeamento OTel/Langfuse** (kind → OTel span/log/trace: trace_id = runId|sessionId, span = kind, attributes = payload; Langfuse: trace = session, observation = kind) — implementação OTel ADIADA com nota datada (v1 = jsonl; zero deps); seção "Observability" no ROUTING.md (padrão F19 D9)
- [ ] **Verificar:** unit — export 2 runs byte-idênticos; bridge mapeia linha→evento (fixture verify-verdicts seedado); prevHash violado → aviso; comando no dispatch (contrato F11); docs conferidas contra types.ts (checklist kinds)

## T8 — evals + matriz v6 + consistência (D10, OBS-11)

- [ ] Suite `test/eval/suites/observability.ts` + cases EVAL-022..029 (formato F26): EVAL-022 determinismo do store (2 runs → mesma sequência (seq, kind, bundle, argsHash, triggerSignature); payload volátil excluído — documentado), EVAL-023 bundle hash (estável/muda/gitHead fora), EVAL-024 session recorder (agregados), EVAL-025 context monitor + token state (+ parse token-budget fixture), EVAL-026 lesson capture em gate failure induzido (complete_goal halt F25 + bloqueio F24), EVAL-027 reincidência + promoção, EVAL-028 adendo (filtro gate, ≤3, marker na integração), EVAL-029 export round-trip (byte-idêntico + bridges + prevHash); delta vs EVAL-006/007/014/019 documentado em comentário em cada case (sem double-test)
- [ ] **Verificar:** EVAL-022..029 verdes offline/$0 na lane F21 (loopback, apiKey literal, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..021

## T9 — EVAL-MATRIX v6 + consistência + docs (D11, OBS-11)

- [ ] EVAL-MATRIX v6 aditivo (política F21 D9, bump MATRIX_VERSION): EVAL-022..029 + notas datadas; memory (F29), tool-use/routing (F32) e failover (F30) seguem SEM entradas; teste de consistência estendido para varrer test/eval/suites (confirmar inclusão da nova suite)
- [ ] Docs: tabela de mecanismos (SDK/harness/arcanum → F28 — tabela do design D1..D10) em docs/ + seção "Observability" no ROUTING.md + EVENTS.md (T7); fonte real (types.d.ts do SDK, token-budget real, verify-verdicts real, arcanum hooks — sem fabricação); .gitignore escopo fino (`.runecraft/events/`, `.runecraft/lessons.jsonl` gitignored; `promoted.jsonl` VERSIONADO — QA-4a)
- [ ] **Verificar:** consistência matriz↔suites verdes; tabela conferida contra os tipos reais (checklist: before_agent_start/context/tool_call no types.d.ts; token-budget no taskflow; recordSessionVerdict/guardLog no harness; 3 mecanismos do arcanum mapeados); `bun test` sem regressão pós-F27 + novos verdes offline/$0

## Success Criteria (spec)

- [ ] Event store tipado funcional: append-only por sessão, seq monotônico determinístico, escrita best-effort (falha induzida não derruba a sessão), kill switch inerte — provado por teste
- [ ] Bundle fingerprint definido e estável (canonical JSON sort F23; mesma config+prompts → mesmo hash; mudança → diferente; gitHead fora)
- [ ] Recorder de sessão portado (session:started/ended com toolUsage/delegations/tokenTotals) — determinístico
- [ ] Context-window monitor + token state portados (thresholds 0.8/0.95; fontes: SDK context a validar + token-budget read-only verificado)
- [ ] Lesson capturada em gate failure induzido (4 campos + triggerSignature); reincidência conta; promoção grava promoted.jsonl versionado; adendo filtrado por gate ≤3 injetado via before_agent_start com marker; 2 runs idênticos
- [ ] Export jsonl determinístico (2 runs byte-idênticos) + bridges (verification:verdict, resilience:signal) + tabela OTel/Langfuse em docs/EVENTS.md (implementação OTel adiada com nota datada)
- [ ] EVAL-022..029 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v6 aditivo com notas datadas; sem regressão pós-F27
- [ ] Fronteiras explícitas: verify-verdicts.jsonl/ledger/continuation.json continuam donos; F28 lê/observa, nunca reescreve; F29 consome promoted.jsonl
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)

## Traceability OBS → tasks

| Requirement | Tasks |
| --- | --- |
| OBS-01 (typed event store) | T1, T6, T8 |
| OBS-02 (harness bundles) | T2, T6 |
| OBS-03 (session recorder) | T3, T6, T8 |
| OBS-04 (context monitor) | T4, T6, T8 |
| OBS-05 (token state) | T4, T6, T8 |
| OBS-06 (lessons capture) | T5, T8 |
| OBS-07 (reincidência + promoção) | T5, T8 |
| OBS-08 (adendo) | T5, T6, T8 |
| OBS-09 (contrato cross-feature) | T6, T7 |
| OBS-10 (export) | T7, T8 |
| OBS-11 (evals + governança) | T1, T8, T9 |

**Cobertura:** 11/11 · toda user story da spec tem requirement ID (OBS-01..11) · todo requisito tem task.
