# F28 — Observability & Lessons Specification

**Scope:** Large (multi-component: event store tipado, harness bundles fingerprint, cognition lessons com reincidência/promoção, port de context-window-monitor/session-token-state/recorder de analytics, export jsonl — pilar 7)
**Prereq:** F13 ✓ (state schema v1 aditivo — config surface), F21 ✓ (fixture ScriptedScenario, evalTest → evidência, EVAL-MATRIX). F27 em execução (injeção `before_agent_start` + `.runecraft/continuation.json` — mecanismo reutilizado pelo adendo; **soft dep** — contrato cross-feature OBS-09, não bloqueia)
**Grupo:** M7 — Garantias (pilar 7 do doc do usuário: "Eventos tipados em event store auditável (Verificação iniciou. Judge respondeu. Gate falhou — exportável pra Langfuse/OTel). Harness Bundles — cada execução é fingerprintada: hash da config, dos prompts, do roteamento. Cognition Lesson = regra compacta quando algo dá errado: Gatilho, Anti-padrão, Padrão preferido, Prioridade e reincidência. Duas trilhas: Planning (antes do executor) e Execution (quando gate falha). Gate falha → execução MONTA UM ADENDO CURTO com lições filtradas pelo gate. Erro que reincide tem contador. Lições recorrentes podem ser PROMOVIDAS pra memória de time.")

## Problem Statement

O harness entrega garantias de **execução** (F24: bloqueio real de tool_call), **saída** (F25: cascata RETRY/SKIP/HALT + vereditos em `.runecraft/verify-verdicts.jsonl`) e **continuidade** (F27: stall/fallback, sinais gravados no ledger do glla). Mas **observabilidade não existe como camada**: cada feature grava no próprio sink (verify-verdicts.jsonl, ledger `.pi-glla/active.jsonl`, `.runecraft/continuation.json`) com schemas próprios, sem bundle fingerprint, sem export, e **nenhum aprendizado é extraído** — quando um gate falha, ninguém captura a lição (gatilho/anti-padrão/padrão preferido) nem a reutiliza nas próximas execuções. O arcanum (supersedido — AD-001) resolvia parte com 3 hooks OpenCode (`context-window-monitor`, `session-token-state`, recorder de analytics em `.guild/analytics/`) — hooks de prompt-injection/API OpenCode, não portáveis; o port ao Pi exige **event store próprio tipado** (o harness não usa `.guild/`).

**Fatos verificados (sem fabricação):** F27 (design D-contexto e tabela de mecanismos) **deferiu explicitamente** "Observabilidade (event store, analytics) → F28 — F27 grava no ledger glla (appendLedger) como o fork já faz; sem store próprio" — **nenhum evento de F27 definido ainda; o schema do F28 é o CONTRATO** (OBS-09). Sinks reais no harness: `recordSessionVerdict` (src/verify/engine.ts:373) grava `{verifyId, status, layer, reason, suggestion, cost}` em `.runecraft/verify-verdicts.jsonl` com try/catch best-effort ("nunca derruba o handler do complete_goal") — precedente de escrita que o F28 replica; `guardLog` (src/guards/guardKit.ts:295) escreve em stderr com prefixo `[runecraft:guards]` ("Nada sai para stdout da sessão"); bloqueios F24 usam reason no formato `<guardId>: <msg>` (D3 F24). Taskflow grava traces REAIS de orçamento de contexto: `.pi/taskflows/runs/token-budget/token-budget-<id>.json` com `{runId, def.budget.maxTokens, status, phases[].usage{input, output, cacheRead, cacheWrite, cost, contextTokens}}` + `index.json` (verificado 2026-08-07 no repo) — **fonte read-only de contexto/tokens, shape verificado**. SDK 0.81.0: `before_agent_start` → `BeforeAgentStartEventResult.systemPrompt` encadeável (verificado no F27 D2) — mecanismo de injeção do adendo; `context` event existe no union (shape a validar no Execute — mesmo flag do F27 D1).

## Goals

- [ ] **Typed event store**: append-only JSONL por sessão sob `.runecraft/events/<sessionId>.jsonl`, discriminated union `EventRecord` (kind, seq monotônico por sessão, sessionId, bundle prefix, payload tipado, `at` wall-clock SÓ no payload — nunca na identidade, F21 D10), escrita best-effort que nunca quebra a sessão (precedente recordSessionVerdict), kill switch `RUNECRAFT_OBSERVABILITY=0` (convenção F24/F25/F27)
- [ ] **Harness bundles**: fingerprint sha256 sobre serialização canônica (chaves ordenadas — padrão sort do F23) de config (sections guards/verification/resilience/observability do state F13) + settings (prefixos F14) + prompts (texto de `renderRules(agentId)` — F19 pura) + roteamento (routingVersion) + versões (harness/sdk/forks); full hash no header `session:started`, prefixo curto (12 hex) nos eventos seguintes; `gitHead` FORA do hash (identidade de variante, não do bundle)
- [ ] **Cognition lessons**: captura (gatilho/anti-padrão/padrão preferido/prioridade) em gate failure (guard F24 / veredito F25 / sinal F27), dedupe por triggerSignature, contador de reincidência, promoção a memória de time (threshold configurável) e **adendo curto** filtrado pelo gate injetado via `before_agent_start` (duas trilhas: planning = lições promovidas no início; execution = lições do gate que falhou no turno seguinte)
- [ ] **Port de analytics do guild**: recorder de sessão (tool counts, delegações, tokens acumulados, modelo, agente, duração — semântica do `.guild/analytics/session-summaries.jsonl`) → eventos `session:started/ended` + `tool:*`/`delegation`; context-window-monitor (thresholds 0.8/0.95 → action none|warn|recover) e session-token-state (maxTokens/usedTokens por sessão) → eventos `context:usage`/`tokens:usage`, com fonte taskflow token-budget (read-only)
- [ ] **Export**: `harness events export --format jsonl` (determinístico, zero deps) + tabela de mapeamento OTel/Langfuse documentada (implementação da export OTel **adiada com nota datada** — v1 = jsonl)
- [ ] **Contrato cross-feature**: schema do F28 = contrato que F24/F25/F27 conformam SEM replanejamento — F28 observa (tool_call bloqueado → `guard:blocked`; reason `<guardId>: msg` — formato F24 D3) e faz bridge read-only no export (verify-verdicts.jsonl → `verification:verdict`; ledger glla + continuation.json → `resilience:signal`) — sem duplicação (tabela de fronteiras)
- [ ] **Evals**: EVAL-022..029 no EVAL-MATRIX v6 (determinismo do store, estabilidade do bundle hash, captura de lesson em gate failure induzido, promoção, adendo, port de contexto, export round-trip) — offline/$0, lane F21
- [ ] Governança: EVAL-MATRIX v6 aditivo com notas datadas; docs/EVENTS.md (kinds, contrato, mapeamento OTel); seção no ROUTING.md; sem regressão

## Out of Scope

| Feature | Reason |
| --- | --- |
| Integração real Langfuse/OTel (SDK/export otel) | v1 = jsonl export + tabela de mapeamento documentada (D8; nota datada — decisão de escopo travada) |
| Memória persistente do time (runes/Engram) | Domínio do F29; a promoção do F28 grava `.runecraft/lessons/promoted.jsonl` versionado — F29 consome se/quando |
| Replanejar F21/F24/F25/F26/F27 | Reuso de padrões + contrato de eventos (OBS-09) — F28 não altera sinks existentes (verify-verdicts, ledger, continuation.json continuam donos) |
| Instrumentar/escrever em `.pi/taskflows/runs/` | Taskflow é dono dos traces; F28 só LÊ token-budget (referência read-only, shape verificado) |
| `.guild/analytics/` (OpenCode) | Arcanum supersedido (AD-001); o recorder é port SEMÂNTICO → event store próprio do harness |
| Dashboards/UI/agregação visual | Fora de escopo; export jsonl + docs é o v1 (F8/F9 podem consumir) |
| Eventos de tool com args completos | Privacidade/tamanho: `tool:call/result` registram `argsHash` (sha256 normalizado), nunca args crus |

## Gray area (resolver antes do Execute — 5 decisões do usuário)

Escopo travado (políticas F21/F24/F25/F26/F27). Cinco pontos abertos — opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Shape do event store**: (a) **recomendado** — `.runecraft/events/<sessionId>.jsonl` por sessão (header = primeiro evento `session:started` com bundleHash full; precedente evidence/partial do F21; isolamento multi-sessão; append atômico por sessão) · (b) `.runecraft/events.jsonl` único (export trivial, interleaving cross-sessão, bundle join por scan)
- **QA-2 — Conteúdo do bundle hash**: (a) **recomendado** — config (sections do state) + settings (prefixos F14) + `renderRules` text + routingVersion + versões; `gitHead` FORA do hash (bundle = identidade de variante de config/prompts; execução = contexto) · (b) gitHead DENTRO do hash (cada commit = bundle novo)
- **QA-3 — Injeção do adendo de lessons**: (a) **recomendado** — reescrita de system prompt via `before_agent_start` (mecanismo REAL verificado no F27 D2; marker `<!-- runecraft:lessons -->`; chaining preservado) · (b) só append no session log (invisível ao agente — não ensina)
- **QA-4 — Memória de time (promoção)**: (a) **recomendado** — `.runecraft/lessons/promoted.jsonl` VERSIONADO (commit-worthy, memória de time auditável) · (b) só local gitignored (nunca compartilhado) · (c) injetar em AGENTS.md/CLAUDE.md do usuário (polui arquivo alheio — não recomendado)
- **QA-5 — Fontes de contexto/tokens**: (a) **recomendado** — SDK `context` event (shape a validar) + leitura read-only dos token-budget do taskflow (shape verificado) + `shouldCompact` (puro, SDK) · (b) só SDK · (c) só taskflow

**Já decidido (não é gray area):** zero deps novas; offline/$0; escopo packages/harness; requirement IDs OBS-0x; EVAL-MATRIX aditivo (v6) com notas datadas (F21 D9); nada sai sem AD; evidência via `evalTest()` (F21); timestamps nunca em identidades (F21 D10 — `at` wall-clock é payload informacional, excluído de asserts de determinismo); kill switch `RUNECRAFT_OBSERVABILITY=0` (convenção); escrita do store best-effort (precedente recordSessionVerdict — nunca quebra a sessão); llm-judge/env-gated NÃO usado (tudo determinístico offline).

## User Stories

### P1: Typed event store + harness bundles + recorder de sessão ⭐ MVP — OBS-01/02/03

**User Story**: Como mantenedor, quero um event store tipado, auditável e determinístico por sessão, com cada execução fingerprintada (bundle hash de config/prompts/roteamento), para comparar execuções ("bundle a7f3 rodou em 12s, b9c1 em 38s") e exportar para Langfuse/OTel.

**Why P1**: É o pilar 7 na forma mais básica (eventos tipados + bundle); sem o store, lessons (OBS-06/07/08) e export (OBS-10) não têm casa.

**Acceptance Criteria**:

1. WHEN uma sessão roda THEN o store grava `session:started` (header: bundleHash full sha256, agentId, model, gitHead, versões) + eventos tipados subsequentes em `.runecraft/events/<sessionId>.jsonl` (append-only, uma linha = um evento) e `session:ended` (duração, toolUsage[], delegations[], totalToolCalls, tokenTotals)
2. WHEN dois eventos da mesma sessão são comparados THEN `seq` (inteiro ≥ 0, monotônico por sessão) + `kind` + `sessionId` + `bundle` (prefixo 12 hex) formam a identidade — **NUNCA timestamps** (F21 D10); `at` (ISO wall-clock) existe SÓ no payload informacional
3. WHEN a escrita falha (disco, permissão) THEN o erro é logado via guardLog (stderr, padrão F24) e a sessão CONTINUA — zero throw (precedente recordSessionVerdict)
4. WHEN `RUNECRAFT_OBSERVABILITY=0` THEN toda a camada fica inerte (nenhum arquivo criado; handlers no-op; kill switch — padrão F24/F25/F27)
5. WHEN o bundle é calculado 2x com a mesma config+prompts+roteamento THEN o hash é IDÊNTICO (canonical JSON, chaves ordenadas — padrão sort F23); mudança em qualquer entrada → hash diferente
6. WHEN uma sessão scriptada roda 2x THEN a sequência `(seq, kind, bundle, argsHash, triggerSignature)` é IDÊNTICA (determinismo; payload volátil — durationMs/cost/at — marcado informacional e excluído do assert)

**Independent Test**: fixture F21 — sessão scriptada com 3 tool calls + 1 delegação → eventos emitidos com seq 0..n; 2 runs → sequência idêntica; falha induzida de escrita (path inválido) → sessão continua (assert no handler); kill switch → zero arquivos; bundle: mesma config → mesmo hash, config alterada → hash diferente.

### P1: Cognition lessons + adendo por gate failure — OBS-06/07/08

**User Story**: Como usuário, quero que cada gate que falha (guard F24, veredito F25, stall F27) capture uma lição compacta (gatilho/anti-padrão/padrão preferido/prioridade), que erros recorrentes contem reincidência e sejam promovidos a memória de time, e que a execução monte um adendo curto com as lições filtradas pelo gate — para o harness aprender e o agente não repetir o erro.

**Why P1**: É a parte "Lessons" do pilar 7 — sem captura/adendo, o event store é só telemetria passiva.

**Acceptance Criteria**:

1. WHEN um gate falha (guard bloqueia tool_call com reason `<guardId>: msg`, veredito F25 fail/halt, sinal de stall F27) THEN uma lesson é capturada com os 4 campos (trigger, antiPattern, preferred, priority: low|med|high) + `gate` (guardId | layer do veredito | sinal) e gravada em `.runecraft/lessons.jsonl` (dedupe por triggerSignature = sha256 canônico de {trigger, gate})
2. WHEN o MESMO trigger+gate reincide THEN o contador da lesson incrementa (record reescrito — arquivo de estado, precedente `.runecraft/continuation.json` do F27) e um evento `lesson:reincidence` é emitido
3. WHEN `count >= promotionThreshold` (default 3) OU (priority=high E count >= highPriorityThreshold, default 2) THEN a lesson é PROMOVIDA: gravada em `.runecraft/lessons/promoted.jsonl` (versionado — memória de time) + evento `lesson:promoted`; CLI `harness lessons promote <id>` força promoção
4. WHEN o gate X falha THEN o harness MONTA um adendo curto (≤ maxAdendoLessons, default 3) com as lições filtradas por `gate == X` (mais prioridade/count) e o injeta via `before_agent_start` no turno seguinte (marker `<!-- runecraft:lessons -->`, chaining preservado — NÃO sobrescreve outras extensões); adendo 2x com mesmo estado → texto IDÊNTICO (sem $TMP/$TS — F21 D10)
5. WHEN uma sessão começa (trilha planning) THEN lições PROMOVIDAS são injetadas como adendo de boas práticas (mesmo mecanismo, filtro `status=promoted`)
6. WHEN não há lições para o gate THEN nenhum adendo é injetado (null — sem ruído)

**Independent Test**: fixture — complete_goal com veredito halt (política F25) → lesson capturada com 4 campos; 2ª e 3ª reincidências → count=3 → promoted.jsonl + evento; gate fail → adendo contém só lições do gate (≤3) com marker; 2 runs idênticos; sem lições → sem rewrite.

### P2: Port de context-window-monitor + session-token-state — OBS-04/05

**User Story**: Como mantenedor, quero que a janela de contexto e o estado de tokens por sessão sejam observados e registrados como eventos tipados (port semântico dos hooks do guild), para detectar sessões próximas do limite (warn/critical) e correlacionar com o bundle.

**Why P2**: O guild monitorava via hooks OpenCode (`chat.params`/`message.updated` — inexistentes no Pi); o port ao Pi precisa de fontes reais (SDK `context` event a validar + token-budget do taskflow — shape verificado).

**Acceptance Criteria**:

1. WHEN um sinal de contexto é observado THEN `checkContextWindow({usedTokens, maxTokens, sessionId}, {warningPct: 0.8, criticalPct: 0.95} — defaults do guild) → `context:usage` com usagePct e action none|warn|recover (port puro do arcanum)
2. WHEN tokens de uma mensagem chegam THEN o estado por sessão `{maxTokens, usedTokens}` é atualizado (semântica session-token-state: updateUsage só com inputTokens > 0; latest, não cumulativo) e `tokens:usage` acumula totais (input/output/reasoning/cacheRead/cacheWrite/totalMessages — semântica do analytics)
3. WHEN arquivos token-budget do taskflow existem (`.pi/taskflows/runs/token-budget/*.json`) THEN são LIDOS (read-only; `phases[].usage.contextTokens`, `def.budget.maxTokens`) e mapeados para `context:usage`/`tokens:usage` com `source:"bridge"` — **nunca escritos** (taskflow é dono)
4. WHEN o monitor roda 2x com o mesmo input THEN os eventos são idênticos (determinismo; relógio/uso injetáveis)

**Independent Test**: unit puro — usagePct 0.85 → action warn; 0.97 → recover; 0.5 → none; parse do token-budget real (fixture JSON verificado); 2 runs idênticos.

### P2: Contrato cross-feature + export — OBS-09/10

**User Story**: Como mantenedor, quero que o event store seja a visão unificada e auditável do runtime do harness (F24/F25/F27) SEM replanejar essas features, e que um comando de export jsonl determinístico materialize tudo — com o mapeamento OTel/Langfuse documentado para o futuro.

**Why P2**: Os sinks existentes (verify-verdicts.jsonl, ledger, continuation.json) são fragmentados; o contrato de schema impede retrofit doloroso quando F24/F25/F27 emitirem eventos no futuro.

**Acceptance Criteria**:

1. WHEN um guard F24 bloqueia uma tool THEN o F28 observa via `tool_call` (resultado bloqueado, reason `<guardId>: msg` — formato F24 D3) e emite `guard:blocked` — **zero mudança no código do F24**
2. WHEN `harness events export --format jsonl [--session <id>] [--include-external]` roda THEN a saída é um merge determinístico: eventos do store (seq asc por sessão; sessões ordenadas por sessionId) + bridges externos com `source:"bridge"` (verify-verdicts.jsonl → `verification:verdict`; ledger glla + continuation.json → `resilience:signal`) — sem duplicação (cada sink continua dono; o store F28 nunca reescreve eventos externos)
3. WHEN o export roda 2x THEN o byte-output é IDÊNTICO (ordenação determinística; sem wall-clock na ordenação)
4. WHEN um evento F27/F25/F24 for emitido NO FUTURO direto no store THEN ele CONFORMA o schema do F28 (kinds da união — contrato documentado em docs/EVENTS.md; `verification:started`/`verification:stage` reservados como contrato, v1 não emite)
5. WHEN o usuário quiser Langfuse/OTel THEN docs/EVENTS.md traz a tabela de mapeamento kind → OTel span/log/trace e Langfuse observation — implementação da export OTel adiada com nota datada (v1 = jsonl)

**Independent Test**: fixture — bloqueio F24 induzido → evento `guard:blocked`; export com verify-verdicts.jsonl seedado → `verification:verdict` com source bridge; 2 exports byte-idênticos.

### P2: Evals + governança — OBS-11

**User Story**: Como mantenedor, quero EVAL-022..029 como dados do framework F26 (matriz v6) provando determinismo do store, estabilidade do bundle, captura/promoção de lessons e port de contexto — para a observabilidade não regredir.

**Why P2**: Mesma política dos demais pilares (F21 D9 — matriz aditiva, evidência determinística offline).

**Acceptance Criteria**:

1. WHEN a suite `observability` roda THEN os cases EVAL-022..029 executam no runner do F26 offline/$0 (fixture ScriptedScenario + handlers exportados com eventos scriptados)
2. WHEN o case de determinismo roda THEN 2 runs produzem a MESMA sequência `(seq, kind, bundle, argsHash, triggerSignature)` (payload volátil excluído do assert — documentado)
3. WHEN a matriz roda THEN EVAL-MATRIX v6 aditiva (EVAL-022..029 + notas datadas) e o teste de consistência varre a nova suite
4. WHEN `bun test` roda THEN sem regressão (pós-F27) + novos verdes offline/$0; zero chamadas LLM

**Independent Test**: cada case valida schema F26; determinismo 2 runs; consistência matriz↔suites; evidência no last-run.json.

## Edge Cases

- WHEN não há sessão ativa identificável THEN eventos com sessionId do contexto da extensão (fallback: `RUNECRAFT_AGENT_ID` + seq da sessão SDK); nunca inventar sessionId
- WHEN a escrita falha no meio de uma sessão THEN best-effort (try/catch + guardLog warn) e a sessão segue; seq continua do último gravado (recovery por leitura do arquivo)
- WHEN o arquivo de eventos está corrompido/truncado (crash) THEN leitura/export pula linhas malformadas (padrão ledger do glla v0.28.6 — folding/pulo) e reporta no stderr — fail-soft
- WHEN config muda no meio da sessão THEN evento `bundle:changed` (novo hash full) — eventos anteriores permanecem com o prefixo antigo (imutabilidade)
- WHEN a mesma lesson reincide com prioridade alta THEN threshold reduzido (2) — promoção não espera 3
- WHEN o gate não tem lessons THEN adendo null (sem ruído no prompt — padrão identity-only do arcanum)
- WHEN `session:started` não pôde gravar o header (falha) THEN a sessão continua sem bundle (bundleHash null no evento? não — sessão segue sem header; documentado no log) — kill switch é a única forma de desligar
- WHEN o mesmo comportamento já é coberto por EVAL-006/007/014/019 THEN sem duplicação — casos novos cobrem observabilidade (delta documentado no case)
- WHEN um caso roda 2x THEN vereditos idênticos (mensagens sem $TMP/$TS — F21 D10; asserts excluem payload volátil)
- WHEN multi-sessão no mesmo cwd THEN arquivos por sessionId (isolamento do QA-1a); ledger por cwd permanece limite do fork (AD-019) — documentado

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OBS-01 | P1: Typed event store (append-only por sessão, discriminated union, seq monotônico, best-effort, kill switch) | Design | Pending |
| OBS-02 | P1: Harness bundles (fingerprint canônico config+prompts+routing; header + prefixo curto) | Design | Pending |
| OBS-03 | P1: Recorder de sessão (port analytics do guild → session:started/ended, tool:*, delegation, tokens) | Design | Pending |
| OBS-04 | P2: Context-window monitor port (thresholds → context:usage) | Design | Pending |
| OBS-05 | P2: Session token state port (maxTokens/usedTokens; taskflow token-budget read-only) | Design | Pending |
| OBS-06 | P1: Cognition lessons capture (trigger/anti-pattern/preferred/priority + dedupe) | Design | Pending |
| OBS-07 | P2: Reincidência + promoção a memória de time | Design | Pending |
| OBS-08 | P1: Adendo curto por gate failure (filtro por gate, duas trilhas, injeção before_agent_start) | Design | Pending |
| OBS-09 | P2: Contrato cross-feature (schema = contrato F24/F25/F27; observação + bridges read-only) | Design | Pending |
| OBS-10 | P2: Export jsonl v1 + mapeamento OTel/Langfuse documentado | Design | Pending |
| OBS-11 | P2: Evals EVAL-022..029 + EVAL-MATRIX v6 + config surface + docs | Design | Pending |

**Coverage:** 11 total, 0 mapeados, 11 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Event store tipado funcional: append-only por sessão, seq monotônico determinístico, escrita best-effort (falha induzida não derruba a sessão), kill switch inerte — provado por teste
- [ ] Bundle fingerprint definido e estável (canonical JSON sort F23; mesma config+prompts → mesmo hash; mudança → hash diferente); gitHead fora do hash
- [ ] Recorder de sessão portado: session:started/ended com toolUsage/delegations/tokenTotals (semântica `.guild/analytics`) — determinístico
- [ ] Context-window monitor + token state portados (thresholds 0.8/0.95; fontes: SDK context a validar + taskflow token-budget read-only shape verificado)
- [ ] Lesson capturada em gate failure induzido (4 campos + triggerSignature); reincidência conta; promoção grava promoted.jsonl versionado; adendo filtrado por gate ≤3 injetado via before_agent_start com marker; 2 runs idênticos
- [ ] Export jsonl determinístico (2 runs byte-idênticos) + bridges (verification:verdict, resilience:signal) + tabela OTel/Langfuse em docs/EVENTS.md (implementação OTel adiada com nota datada)
- [ ] EVAL-022..029 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v6 aditivo com notas datadas; sem regressão pós-F27
- [ ] Fronteiras explícitas: verify-verdicts.jsonl/ledger/continuation.json continuam donos; F28 lê/observa, nunca reescreve; F29 consome promoted.jsonl
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
