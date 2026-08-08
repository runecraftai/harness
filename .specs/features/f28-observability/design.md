# F28 Design — Observability & Lessons

**Status:** Ready for Execute (QA-1..QA-5 resolvidas — AD-028)
**Decisões aprovadas (usuário/briefing, travadas):** pilar 7 do doc do usuário (eventos tipados auditáveis; bundle por execução; lesson = gatilho/anti-padrão/padrão preferido/prioridade/reincidência; duas trilhas planning/execution; adendo curto filtrado pelo gate; promoção a memória de time) · zero deps novas · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v6 com notas datadas (F21 D9) · evidência via evalTest (F21) · timestamps nunca em identidades (F21 D10) · kill switch `RUNECRAFT_OBSERVABILITY=0` (convenção) · escrita best-effort (precedente recordSessionVerdict) · nada sai sem AD · llm-judge/env-gated NÃO usado

## Contexto

F21 entregou a infra determinística (fixture, ScriptedScenario, evalTest, EVAL-MATRIX). F24 entregou os guards com bloqueio real (`{block:true, reason}` formato `<guardId>: msg` — D3 F24) e o ledger `.pi-glla/active.jsonl`. F25 entregou a cascata com vereditos em `.runecraft/verify-verdicts.jsonl` (`recordSessionVerdict` — try/catch best-effort "nunca derruba o handler do complete_goal", src/verify/engine.ts:373) e `guardLog` (stderr, prefixo `[runecraft:guards]`, src/guards/guardKit.ts:295 — "Nada sai para stdout da sessão"). F26 entregou o framework eval. F27 (em execução) **deferiu explicitamente a observabilidade**: "F27 grava no ledger glla (appendLedger) como o fork já faz; sem store próprio" — logo, **nenhum evento de F27 foi definido ainda; o schema do F28 é o CONTRATO** que F24/F25/F27 conformam sem retrofit (D7). F27 também verificou o mecanismo de injeção `before_agent_start` → `systemPrompt` encadeável (D2 F27) — base do adendo (D6).

**Fonte do port — arcanum (`packages/guild/src/hooks/` + `src/features/analytics/`, lidos na íntegra):**
- `context-window-monitor.ts`: função PURO `checkContextWindow({usedTokens, maxTokens, sessionId}, {warningPct: 0.8, criticalPct: 0.95}) → {action: none|warn|recover, usagePct, message?}` — monitor de janela com recovery sugerindo checkpoint/compactação. Usava hooks OpenCode (`chat.params`/`message.updated`/`guild_compact_context`) — não portáveis; o Pi tem `context` event (shape a validar) + `shouldCompact` (puro, SDK) + token-budget do taskflow (shape verificado).
- `session-token-state.ts`: mapa em memória por sessão `{maxTokens, usedTokens}`; `setContextLimit` (chat.params) e `updateUsage` (message.updated; guarda `inputTokens > 0`; guarda o LATEST, não cumulativo; não sobrescreve maxTokens). Port direto: o estado por sessão é o mesmo; a FONTE dos tokens no Pi é o ponto a validar no Execute (QA-5).
- Recorder de analytics (`.guild/analytics/`): `session-summaries.jsonl` (SessionSummary: sessionId, startedAt/endedAt, durationMs, toolUsage[], delegations[], totalToolCalls, totalDelegations, agentName, model, totalCost, tokenUsage{input/output/reasoning/cacheRead/cacheWrite/totalMessages}), `fingerprint.json` (ProjectFingerprint: stack/monorepo/packageManager/os/arch/guildVersion — precursor do bundle), `metrics-reports.jsonl` (agregação por plano — fora do v1 F28). `SessionTracker`: startSession/trackToolStart/End (delegação p/ tools `task`/`call_guild_agent` → no harness: tool `subagent` do F2), trackModel/trackCost/trackTokenUsage (acumula), endSession → append JSONL **fire-and-forget com warn não-fatal** — o precedente exato do "best-effort" do F28.

**Evidência no harness (verificada):**
1. `recordSessionVerdict` (src/verify/engine.ts:373–390): `mkdirSync recursive` + `appendFileSync` + try/catch silencioso — **escrita de log nunca quebra a sessão** (precedente do store, D1).
2. `guardLog` (src/guards/guardKit.ts:295): stderr-only, env `RUNECRAFT_GUARDS_DEBUG` — padrão de logging da casa para o store (D1).
3. Taskflow token-budget REAL: `.pi/taskflows/runs/token-budget/token-budget-<id>.json` com `{runId, flowName, def.budget.maxTokens, status, phases[].usage{input, output, cacheRead, cacheWrite, cost, contextTokens...}}` + `index.json` (verificado 2026-08-07) — **fonte read-only de contexto/tokens** (D4, QA-5).
4. Sinks existentes (tabela de fronteiras D7): verify-verdicts.jsonl (F25), ledger `.pi-glla/active.jsonl` (F24/F27 — sinais pending_latch_stuck/wedge_alert/heartbeat_refire), `.runecraft/continuation.json` (F27).
5. SDK 0.81.0 (evidência F27): `before_agent_start` → `BeforeAgentStartEventResult.systemPrompt` encadeável; `context` event no union (shape a validar); `turn_start{turnIndex,timestamp}`/`turn_end`/`agent_end`/`tool_call` — sinais do recorder.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Event store = `.runecraft/events/<sessionId>.jsonl` por sessão** (OBS-01, QA-1a recomendado): append-only, uma linha = um evento; primeiro evento = header `session:started` (bundleHash full, agentId, model, gitHead, versões); `seq` inteiro ≥ 0 monotônico por sessão = identidade+ordem (determinístico); `at` ISO wall-clock SÓ no payload (informacional — F21 D10); escrita via helper único (mkdir recursive + appendFileSync + try/catch + guardLog warn — precedente recordSessionVerdict, nunca throw); `prevHash` por linha (sha256 da linha anterior — tamper-evident, auditável, determinístico; verificação no export); kill switch `RUNECRAFT_OBSERVABILITY=0`; leitura fail-soft (linhas malformadas puladas — padrão ledger v0.28.6) | (1) Precedente evidence/partial do F21 (por-sessão/por-arquivo) e recordSessionVerdict (append best-effort); (2) isolamento multi-sessão no mesmo cwd (AD-019) — um arquivo global interleavia sessões e tornava o bundle-join um scan; (3) header por sessão = bundle é propriedade da sessão; (4) hash chain = "auditável" do pilar 7 com custo zero de dep; (5) export = merge determinístico por (sessionId, seq) |
| D2 | **Schema = discriminated union `EventRecord`** (OBS-01/09): campos base `{seq, kind, sessionId, bundle, payload, runId?, source?}`; `source: "sdk" | "internal" | "bridge"` (bridge = materializado de sink externo no export); kinds v1: `session:started/ended`, `bundle:changed`, `context:usage`, `tokens:usage`, `tool:call/result` (argsHash sha256 normalizado — nunca args crus), `delegation`, `guard:blocked`, `verification:verdict`, `resilience:signal`, `lesson:captured/reincidence/promoted`, `adendo:injected`; kinds CONTRATO (reservados, v1 não emite): `verification:started`, `verification:stage` (F25 pode emitir no futuro sem retrofit — documentado em EVENTS.md) | Discriminated union = tipagem estrita (zero parser — JSON.parse + shape check por kind); kinds de contrato = o schema do F28 é o contrato cross-feature (D7) sem depender do estado de execução do F27 (regra do briefing: não bloquear em F27) |
| D3 | **Bundle = sha256 de serialização canônica** (OBS-02, QA-2a recomendado): input = `{harnessVersion, sdkVersion, forks: {id→version}, config: {guards, verification, resilience, observability} (sections do state F13), settings: prefixos relevantes F14, rules: renderRules(agentId) (F19 puro — texto do template = prompts+roteamento), routingVersion (WORKFLOW_RULES_VERSION F19)}`; canonicalJson = JSON.stringify com chaves ordenadas recursivamente (padrão sort F23); `gitHead` FORA do hash (campo do header — identidade de execução, não de variante); full hash (64 hex) no `session:started`, prefixo curto (12 hex) nos eventos seguintes; mudança no meio da sessão → `bundle:changed` (eventos antigos imutáveis) | "Hash da config, dos prompts, do roteamento" (pilar 7); renderRules é PURO (F19) → determinismo por construção; chaves ordenadas = estabilidade cross-runtime (F23); gitHead fora do hash preserva a identidade de variante ("bundle a7f3" = mesma config/prompts) e permite comparar execuções do MESMO bundle com HEADs diferentes; 12 hex = 48 bits — colisão negligível para agrupamento |
| D4 | **Port semântico dos 3 mecanismos do guild** (OBS-03/04/05): (a) `session-recorder` = port do SessionTracker/analytics → eventos `session:started/ended`, `tool:call/result` (com blocked/ok/durationMs), `delegation` (tool `subagent` do F2 — equivalente de task/call_guild_agent), `tokens:usage` acumulado (input/output/reasoning/cacheRead/cacheWrite/totalMessages); identidade de agente via `RUNECRAFT_AGENT_ID` (F24); (b) `context-monitor` = port puro de checkContextWindow (thresholds 0.8/0.95 do config D9) → `context:usage`; (c) `token-state` = port de session-token-state (maxTokens/usedTokens por sessão; updateUsage só com inputTokens>0). **Fontes de sinal**: SDK `context` event (shape a validar no Execute — QA-5) + leitura READ-ONLY dos token-budget do taskflow (shape VERIFICADO — evidência 3; `source:"bridge"` no evento) + `shouldCompact` (puro) como checagem sob demanda; **nunca escrever em `.pi/`** | O arcanum lia hooks OpenCode inexistentes no Pi; o port preserva a SEMÂNTICA (estado e decisões) e troca a fonte por mecanismos reais do Pi/taskflow. Determinismo: monitor é puro com input injetável |
| D5 | **Lessons = `.runecraft/lessons.jsonl` (estado) + `promoted.jsonl` (memória de time)** (OBS-06/07, QA-4a recomendado): captura com 4 campos + `gate` (guardId | layer do veredito | sinal) + `track` (planning|execution); dedupe por `triggerSignature = sha256(canonicalJson({trigger, gate}))`; record `{lessonId, triggerSignature, trigger, antiPattern, preferred, priority, gate, track, count, status: active|promoted|archived, firstSeenSeq, lastSeenSeq}` — **reincidência REESCREVE o record** (contador é estado, não evento; precedente continuation.json F27; eventos `lesson:reincidence` no store são o trilho auditável); promoção quando `count >= promotionThreshold` (default 3) OU `priority=high && count >= highPriorityThreshold` (default 2) → grava em `.runecraft/lessons/promoted.jsonl` (VERSIONADO — commit-worthy, memória de time) + evento `lesson:promoted`; CLI `harness lessons promote <id>` (força) e `harness lessons list` (status); arquivamento manual (status=archived) para lessons obsoletas | lessons.jsonl é dado derivado do runtime (gitignored — igual events/); promoted.jsonl é o artefato de time (versionado — revisão humana via diff/PR). "Memória de time" num harness local = arquivo versionado consumível por F29 (runes) e pelo adendo (D6) |
| D6 | **Adendo = `buildLessonAdendo(lessons, {gate, track, max=3}) → string|null` PURO + injeção via `before_agent_start`** (OBS-08, QA-3a recomendado): filtro por `gate == gateId` (execution) ou `status=promoted` (planning), ordena por (priority, count) desc, corta em maxAdendoLessons (default 3); texto compacto determinístico por linha — `Gatilho: X · Anti-padrão: Y · Padrão preferido: Z (P<n>)` — sem $TMP/$TS (F21 D10); marker `<!-- runecraft:lessons -->`; injeção = handler próprio do F28 em `before_agent_start` anexando ao `systemPrompt` (chaining encadeável do SDK — NÃO sobrescreve outras extensões, verificado F27 D2); evento `adendo:injected` (lessonIds + textHash) | O doc manda a execução "MONTAR UM ADENDO CURTO com lições filtradas pelo gate" e injetá-lo no agente (senão é invisível — QA-3b rejeitado); builder puro = determinismo e testabilidade; soft dep do F27: MESMA mecânica (before_agent_start + marcadores `<!-- runecraft:* -->`) mas handler próprio — F28 não depende do código do F27 (prereq F13/F21 mantidos; nota no tasks) |
| D7 | **Contrato cross-feature: schema F28 = contrato; observação + bridge, ZERO replanejamento** (OBS-09): (a) F24 guard blocks → observados via `tool_call` (resultado bloqueado; reason `<guardId>: msg` — formato D3 F24) → `guard:blocked` live, sem tocar no F24; (b) F25 vereditos → bridge READ-ONLY no export lê `.runecraft/verify-verdicts.jsonl` → `verification:verdict` (`source:"bridge"`); (c) F27 stall/continuation → bridge lê ledger glla (pending_latch_stuck/wedge_alert/heartbeat_refire — eventos que o fork/F27 gravam) + `.runecraft/continuation.json` → `resilience:signal`; (d) se F24/F25/F27 emitirem DIRETO no futuro, conformam os kinds do F28 (contrato em docs/EVENTS.md; `verification:started/stage` reservados). **Tabela de fronteiras** (sem duplicação): verify-verdicts.jsonl (dono F25), ledger (dono F24/F27), continuation.json (dono F27), evidence/ (dono F21 — eval-specific, intocado), events/ (dono F28) | "O event store deve ser o single sink" sem replanejar F21/F24/F25/F26/F27: a leitura de sinks existentes materializa a visão unificada sem duplicar escrita; o contrato de kinds garante que emissões futuras conformem SEM retrofit. F27 ainda em execução → contrato definido AGORA (regra do briefing: não bloquear em F27) |
| D8 | **Export v1 = `harness events export --format jsonl [--session <id>] [--include-external]`** (OBS-10): merge determinístico — eventos do store ordenados por (sessionId lexicográfico, seq asc) + bridges externos (D7b/c) anexados por sessão com `source:"bridge"` e seq virtual `N+1...` (documentado); verificação do prevHash (hash chain — D1) com relatório de violações no stderr; zero deps. **OTel/Langfuse**: tabela de mapeamento kind → OTel span/log/trace (trace_id = runId|sessionId, span = kind, attributes = payload) e Langfuse (observation por kind, trace por session) em docs/EVENTS.md — **implementação da export OTel adiada com nota datada** (v1 = jsonl; sem SDK OTel — zero deps) | Briefing: "exportável pra Langfuse/OTel" — o MÍNIMO viável é jsonl determinístico + contrato de mapeamento documentado; SDK OTel real adicionaria dep + rede (viola zero-deps/offline); nota datada registra a decisão (política aditiva F21 D9) |
| D9 | **Config + kill switch** (OBS-11): state schema v1 ADITIVO (F13) sob `observability` — `{contextWindow: {warningPct: 0.8, criticalPct: 0.95}, lessons: {promotionThreshold: 3, highPriorityThreshold: 2, maxAdendoLessons: 3}, enabled: true}` (padrão guards/verification/resilience F24/F25/F27 — freeze por sessão); kill switch `RUNECRAFT_OBSERVABILITY=0` (convenção); defaults = valores do guild/fork (0.8/0.95 do context-window-monitor; thresholds de lessons = propostos, calibrar no Execute) | Padrão da casa (config aditiva + freeze + kill switch); zero deps novas; determinismo por construção |
| D10 | **Evals = EVAL-022..029 framework-driven** (OBS-11): suite `test/eval/suites/observability.ts` — EVAL-022 determinismo do store (sessão scriptada 2x → mesma sequência (seq, kind, bundle, argsHash, triggerSignature); payload volátil excluído — documentado), EVAL-023 bundle hash estável (mesma config → mesmo hash; mudança → diferente; gitHead fora), EVAL-024 session recorder (agregados tool/delegation/token de eventos scriptados), EVAL-025 context monitor + token state (thresholds 0.8/0.95 → warn/recover; parse token-budget fixture), EVAL-026 lesson capture em gate failure induzido (complete_goal halt F25 + bloqueio F24 → 4 campos + triggerSignature), EVAL-027 reincidência + promoção (3x → promoted.jsonl + evento), EVAL-028 adendo (filtro por gate, ≤3, marker, 2 runs idênticos; planning track), EVAL-029 export round-trip (jsonl determinístico + bridge verify-verdicts/ledger → source bridge). Matriz v6 aditiva (EVAL-022..029 + notas datadas) | F26 framework + fixture F21 provam o padrão (EVAL-006/007/014/019); delta documentado no case (sem double-test) |

## Arquitetura — módulos

```
packages/harness/
├── src/observability/
│   ├── index.ts              # exports públicos
│   ├── types.ts              # EventRecord (discriminated union D2), EventKind, Lesson, LessonRecord, BundleFingerprintInput, ConfigSchema (D9)
│   ├── config.ts             # schema v1 aditivo no state (observability) + kill switch RUNECRAFT_OBSERVABILITY=0 + freeze por sessão (D9)
│   ├── store.ts              # append-only por sessão: appendEvent(sessionId, kind, payload) → seq auto (lê último seq do arquivo), prevHash chain, try/catch best-effort + guardLog warn (D1)
│   ├── bundle.ts             # PURO: canonicalJson (chaves ordenadas — padrão F23) + computeBundleHash(input) → full sha256 + shortPrefix (D3)
│   ├── session-recorder.ts   # port SessionTracker/analytics: startSession/trackToolStart/End/delegation/model/tokens → session:started/ended, tool:call/result, delegation, tokens:usage (D4)
│   ├── context-monitor.ts    # PURO: checkContextWindow (port) → context:usage; + token-state.ts (port session-token-state) (D4)
│   ├── lessons.ts            # PURO: capture (4 campos + gate + triggerSignature), reincidência (rewrite), promoção (thresholds), buildLessonAdendo (filtro gate/track/max) (D5/D6)
│   └── export.ts             # export jsonl determinístico + bridges (verify-verdicts/ledger/continuation → source:"bridge") + verificação prevHash (D7/D8)
├── src/extensions/observability.ts   # wiring Pi: on(session_start|session_end|tool_call|before_agent_start|context|message) → eventos + adendo (D4/D6); kill switch
├── test/observability/       # unit puro (store/bundle/recorder/monitor/lessons/export — relógio fake, traces scriptados) + integração fixture
└── test/eval/suites/observability.ts + cases EVAL-022..029 (D10)
```

## Fluxos

### F1 — Sessão → eventos (OBS-01/03)

```
1. session_start → store.appendEvent("session:started", {bundleHash full, agentId (RUNECRAFT_AGENT_ID), model, gitHead, versões, at})
2. tool_call/tool_result → tool:call (argsHash) / tool:result (ok, blocked?, guardId?, reason?, durationMs) — observação; bloqueio F24 detectado pelo reason `<guardId>: msg` → guard:blocked (D7a)
3. delegação (tool subagent — F2) → delegation {agent, toolCallId, durationMs}
4. mensagens/token-budget → tokens:usage (acumulado) + context:usage (thresholds)
5. session_end → session:ended {durationMs, toolUsage[], delegations[], totalToolCalls, tokenTotals, at}
6. kill switch → todos os handlers no-op
```

### F2 — Bundle (OBS-02)

```
session_start → computeBundleHash(input canônico: config sections + settings + renderRules(agentId) + routingVersion + versões) → header (full) + prefixo 12 hex nos eventos
config muda no meio da sessão → bundle:changed (novo full; eventos antigos imutáveis)
export → agrupamento por prefixo → "bundle a7f3 rodou em 12s" (session:started/ended wall times — informacional)
```

### F3 — Lessons (OBS-06/07)

```
gate falha (guard:blocked | verification:verdict fail/halt | resilience:signal) → capture {trigger, antiPattern, preferred, priority, gate, track}
triggerSignature = sha256(canonicalJson({trigger, gate})) → existe? count++ (rewrite lessons.jsonl) + lesson:reincidence : append novo + lesson:captured
count >= threshold (ou high+2) → status=promoted → promoted.jsonl (versionado) + lesson:promoted
CLI: harness lessons list | promote <id> (força) | archive <id>
```

### F4 — Adendo (OBS-08)

```
trilha execution: gate X falhou → buildLessonAdendo(lessons[gate==X], max=3) → before_agent_start (turno seguinte) anexa ao systemPrompt (marker <!-- runecraft:lessons -->) → adendo:injected
trilha planning: session_start → buildLessonAdendo(lessons[status=promoted], max=3) → mesmo mecanismo
sem lessons → null (sem rewrite) — determinismo: builder puro, sem timestamp/path absoluto
```

### F5 — Export (OBS-10)

```
harness events export --format jsonl [--session id] [--include-external]
→ store ordenado (sessionId, seq) + bridges (verify-verdicts.jsonl → verification:verdict; ledger/continuation.json → resilience:signal) com source:"bridge" e seq virtual
→ verificação prevHash (violações → stderr, exit 0 com aviso)
→ 2 runs byte-idênticos
```

### F6 — CI

```
bun test test/eval (preloads F21/F24/F25/F26/F27) → EVAL-022..029 offline/$0; consistência matriz↔suites (v6);
evidência last-run.json; sem regressão pós-F27; RUNECRAFT_OBSERVABILITY=0 não afeta a suite (kill switch testado)
```

## Mapeamento arcanum → harness (hooks do port)

| Arcanum (packages/guild) | Harness (packages/harness) | Mecanismo real no Pi |
| --- | --- | --- |
| `context-window-monitor.ts` (checkContextWindow 0.8/0.95 → warn/recover) | `src/observability/context-monitor.ts` (puro, mesmo thresholds) → `context:usage` | SDK `context` event (shape a validar) / `shouldCompact` (puro) / taskflow token-budget (read-only) |
| `session-token-state.ts` (maxTokens/usedTokens por sessão) | `src/observability/token-state.ts` (port; updateUsage só inputTokens>0) → `tokens:usage` | tokens de mensagens do SDK (fonte a validar) + token-budget taskflow |
| `features/analytics/session-tracker.ts` + `storage.ts` (SessionSummary em `.guild/analytics/session-summaries.jsonl`) | `src/observability/session-recorder.ts` → eventos `session:started/ended`, `tool:*`, `delegation` em `.runecraft/events/<sessionId>.jsonl` | `session_start`/`session_end`/`tool_call`/`before_agent_start`/`RUNECRAFT_AGENT_ID` (F24) |
| `features/analytics/fingerprint.ts` (ProjectFingerprint em `.guild/analytics/fingerprint.json`) | `src/observability/bundle.ts` (bundle sha256 canônico config+prompts+routing) | renderRules (F19 puro) + state/settings (F13/F14) — fingerprint de EXECUÇÃO, não de projeto |
| `features/analytics/quality-score.ts`/`adherence.ts`/`metrics-reports.jsonl` (agregação por plano) | NÃO portado no v1 (F8/F9 podem consumir o store) | — |

## Tabela de mecanismos (o que existe → o que F28 constrói)

| Mecanismo | Existe (SDK 0.81.0 / harness / arcanum) — evidência | F28 constrói |
| --- | --- | --- |
| Escrita append-only best-effort | F25 `recordSessionVerdict` (try/catch, "nunca derruba o handler") ✓; ledger glla appendLedger ✓ | `store.ts` appendEvent (D1) — mesmo padrão + prevHash chain |
| Logging sem stdout | F24 `guardLog` (stderr, `[runecraft:guards]`) ✓ | Reuso do guardLog (mesmo prefixo observability ou `[runecraft:obs]`) |
| Estado por sessão | F27 `.runecraft/continuation.json` (schema v1, append/atomic) ✓ | lessons.jsonl (estado) + events/ (append-only) |
| Contexto/tokens | taskflow `.pi/taskflows/runs/token-budget/*.json` (shape verificado) ✓; SDK `context` event (shape a validar); `shouldCompact` puro ✓ | context-monitor + token-state (D4) + leitura read-only |
| Reescrita de system prompt | SDK `before_agent_start` → systemPrompt encadeável (F27 D2 ✓) | Injeção do adendo (D6) |
| Fingerprint canônico | F23 sort/normalize (chaves ordenadas) ✓; F19 renderRules puro ✓ | bundle.ts (D3) |
| Captura de lessons | Nenhum (novo domínio) | lessons.ts (D5/D6) |
| Export | Nenhum (sinks fragmentados) | export.ts + docs/EVENTS.md (D7/D8) |
| Memória de time | F29 (runes) — futuro | promoted.jsonl versionado (D5) — F29 consome |
| OTel/Langfuse SDK | Nenhum (zero deps travado) | Tabela de mapeamento documentada; implementação adiada (D8, nota datada) |

## EVAL-MATRIX — entradas aditivas v6 (política F21 D9)

| ID | Fluxo | Ferramentas | Script esperado | Notas |
| --- | --- | --- | --- | --- |
| EVAL-022 | event store determinismo | eval (suites/observability) | 1. sessão scriptada (3 tool calls + delegação + veredito) → seq 0..n com kinds certos; 2. 2 runs → mesma sequência (seq, kind, bundle, argsHash, triggerSignature); 3. payload volátil (at/durationMs/cost) excluído do assert — documentado | F21 D10: timestamps nunca em identidade |
| EVAL-023 | bundle hash estável | eval (suites/observability) | 1. mesma config+prompts → mesmo hash; 2. mudança em config → hash diferente; 3. gitHead fora do hash (mesmo hash, HEADs diferentes); 4. canonical JSON com chaves ordenadas | padrão sort F23 |
| EVAL-024 | session recorder | eval (suites/observability) + fixture | 1. eventos scriptados → session:ended com toolUsage/delegations/tokenTotals corretos; 2. delegação via tool subagent registrada | port do analytics do guild |
| EVAL-025 | context monitor + token state | eval (suites/observability) | 1. usagePct 0.85 → warn; 0.97 → recover; 0.5 → none; 2. parse do token-budget fixture (shape real verificado) → context:usage com source bridge; 3. updateUsage só inputTokens>0 | thresholds 0.8/0.95 |
| EVAL-026 | lesson capture em gate failure | eval (suites/observability) + fixture | 1. complete_goal halt (F25) → lesson com 4 campos + gate=layer; 2. bloqueio F24 induzido → lesson gate=guardId; 3. dedupe por triggerSignature (mesmo trigger+gate = mesmo record) | — |
| EVAL-027 | reincidência + promoção | eval (suites/observability) | 1. 3 captures → count=3 → promoted.jsonl + lesson:promoted; 2. priority=high + 2 → promove antes; 3. `promote <id>` força | thresholds configuráveis |
| EVAL-028 | adendo | eval (suites/observability) + fixture | 1. gate X → adendo só com lessons do gate X, ≤3, ordenado (priority, count); 2. marker <!-- runecraft:lessons --> presente no systemPrompt (integração); 3. 2 runs idênticos; 4. sem lessons → null | duas trilhas (planning/execution) |
| EVAL-029 | export round-trip | eval (suites/observability) | 1. store seedado + verify-verdicts.jsonl/ledger seedados → export com source:"bridge"; 2. 2 runs byte-idênticos; 3. prevHash verificado; 4. linha malformada pulada (fail-soft) | zero deps; ordenação (sessionId, seq) |

Nota datada v6: observabilidade agora com entradas (pilar 7); memory (F29), tool-use/routing (F32) e failover (F30) seguem SEM entradas (política aditiva — nada sai sem AD).

## Integração CI

- **Roda com**: mesma lane F21/F24/F25/F26/F27 — `bun test test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM (F28 é determinístico por construção)
- **Evidência**: `evalTest()` grava nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (identidade estável — F21 D10; asserts excluem payload volátil — documentado no case)
- **Consistência**: `matrix-consistency.test.ts` v6 varre `test/eval/suites` incluindo observability
- **Kill switch**: `RUNECRAFT_OBSERVABILITY=0` testado (camada inerte; suite continua verde)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Shape do `context` event do SDK** (tokens/janela) não verificado | Validar no Execute (mesmo flag do F27 D1); fonte primária alternativa = token-budget do taskflow (shape VERIFICADO) + shouldCompact; honesto, sem inventar evento |
| **Fonte de tokens de mensagem no SDK** (onde input/output/reasoning aparecem) não verificada | Validar no Execute; se ausente, tokens:usage deriva do token-budget (bridge) e session:ended fica sem tokenTotals completos (documentado) |
| **Detecção de bloqueio F24 via tool_call** (resultado bloqueado observável?) | Formato do reason `<guardId>: msg` é do F24 (D3) — detecção por prefixo; se o resultado do tool_call não expuser o block, fallback: bridge por leitura do ledger/guardLog (a validar no Execute) |
| **Chaining do before_agent_start com o F27** (ordem de extensões) | SDK encadeia systemPrompt (F27 D2 ✓); F28 anexa com marker próprio; teste de integração com 2 extensões; ordem a validar no Execute |
| **Volume do store** (tool:call/result por chamada) | argsHash (nunca args crus); por sessão por arquivo (cleanup por sessão); export filtra por kind; sem index em v1 (scan é O(n) — aceitável) |
| **Reincidência reescrevendo lessons.jsonl** (corrupção concorrente) | Escrita atômica (tmp+rename — padrão F20); single-writer por sessão; fail-soft na leitura |
| **Fronteira com F29 (memória)** borrada | Promoção grava promoted.jsonl versionado — F29 consome; F28 não cria SQLite nem tools de memória |
| **Duplicação com sinks existentes** | D7: cada sink continua dono; F28 lê/observa, nunca reescreve; tabela de fronteiras documentada |
| **Determinismo de evals vs payload volátil** | Identidade = (seq, kind, bundle, argsHash, triggerSignature); `at`/durationMs/cost = informacional, excluído do assert (documentado no case) — extensão literal do F21 D10 |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| OBS-01 | P1: Typed event store | D1/D2 + store.ts + extension wiring + EVAL-022/029 |
| OBS-02 | P1: Harness bundles | D3 + bundle.ts + session:started header + EVAL-023 |
| OBS-03 | P1: Recorder de sessão | D4 + session-recorder.ts + EVAL-024 |
| OBS-04 | P2: Context-window monitor | D4 + context-monitor.ts + EVAL-025 |
| OBS-05 | P2: Session token state | D4 + token-state.ts + EVAL-025 |
| OBS-06 | P1: Lessons capture | D5 + lessons.ts + EVAL-026 |
| OBS-07 | P2: Reincidência + promoção | D5 + lessons.ts + promoted.jsonl + EVAL-027 |
| OBS-08 | P1: Adendo | D6 + buildLessonAdendo + extension before_agent_start + EVAL-028 |
| OBS-09 | P2: Contrato cross-feature | D7 + export bridges + docs/EVENTS.md |
| OBS-10 | P2: Export | D8 + export.ts + EVAL-029 |
| OBS-11 | P2: Evals + governança | D10 + suite/cases EVAL-022..029 + EVAL-MATRIX v6 + config.ts + docs |

**Cobertura:** 11/11 mapeados. Edges da spec: sem sessão → fallback de identidade (D4) · escrita falha → best-effort (D1) · arquivo corrompido → fail-soft (D1) · config muda → bundle:changed (D3) · prioridade alta → threshold reduzido (D5) · sem lessons → null (D6) · multi-sessão → por arquivo (D1) · duplicação EVAL-006/007/014/019 → delta no case (D10).

**Pontos a validar no Execute** (consolidado): shape do `context` event do SDK; fonte de tokens de mensagem no SDK (message events); observabilidade do resultado bloqueado no tool_call (detecção do reason F24 D3); ordem do chaining before_agent_start com F27; shape do ledger glla para o bridge de stall signals (campos pending_latch_stuck/wedge_alert/heartbeat_refire — ler do fork na implementação); calibrar thresholds de lessons (promotionThreshold/highPriorityThreshold) e maxAdendoLessons; caminho real do `index.json`/token-budget por run (chave runId → sessão).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Shape do event store** (D1): (a) **recomendado — `.runecraft/events/<sessionId>.jsonl` por sessão** (header com bundle full; precedente evidence/partial F21; isolamento multi-sessão); (b) `.runecraft/events.jsonl` único
2. **QA-2 — Conteúdo do bundle** (D3): (a) **recomendado — hash de config+settings+renderRules+routingVersion+versões; `gitHead` FORA do hash**; (b) gitHead dentro do hash (cada commit = bundle novo)
3. **QA-3 — Injeção do adendo** (D6): (a) **recomendado — before_agent_start rewrite** (mecanismo real, chaining, marker); (b) só append no session log (invisível ao agente)
4. **QA-4 — Memória de time** (D5): (a) **recomendado — `.runecraft/lessons/promoted.jsonl` versionado** (commit-worthy; F29 consome); (b) só local gitignored; (c) injetar em AGENTS.md/CLAUDE.md (polui arquivo do usuário)
5. **QA-5 — Fontes de contexto/tokens** (D4): (a) **recomendado — SDK context event (a validar) + token-budget taskflow read-only (verificado) + shouldCompact**; (b) só SDK; (c) só taskflow
