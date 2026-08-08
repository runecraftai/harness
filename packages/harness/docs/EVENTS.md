# EVENTS — Event store do harness (F28) — schema = CONTRATO

O event store tipado do harness (`F28 — Observability & Lessons`, AD-028) é a
visão unificada e auditável do runtime: eventos tipados por sessão em
`.runecraft/events/<sessionId>.jsonl` (append-only, uma linha = um evento),
fingerprint de execução (harness bundles), lessons de gate failure e export
jsonl determinístico. **Este documento é o CONTRATO do schema**: F24/F25/F27
conformam os kinds SEM replanejamento (OBS-09/D7) — cada sink existente
continua DONO; o F28 observa + faz bridge read-only no export.

## 1. Formato da linha (um evento)

```
{"seq":0,"kind":"session:started","sessionId":"s1","bundle":"a7f3…(12 hex)",
 "prevHash":"<sha256 da linha anterior; primeira linha = sha256(\"\")>",
 "source":"internal|sdk|bridge","payload":{…,"at":"<ISO wall-clock>"}}
```

- **Identidade** = `(seq, kind, sessionId, bundle, argsHash, triggerSignature)`
  — determinística (F21 D10); **timestamps nunca em identidades**. `at`
  (ISO wall-clock) existe SÓ no payload informacional (excluído de asserts de
  determinismo — documentado nos cases).
- **seq**: inteiro ≥ 0, monotônico por sessão (recovery pós-crash: continua do
  último seq VÁLIDO do arquivo).
- **prevHash**: sha256 da linha anterior (tamper-evident; violações reportadas
  no export — exit 0 com aviso).
- **bundle**: prefixo curto (12 hex) do bundle da sessão (D3). O full hash
  (64 hex) vive no payload do header `session:started`.
- **source**: `internal` (gerado pelo harness) · `sdk` (observado do SDK) ·
  `bridge` (materializado de sink externo no export — F28 lê, nunca reescreve).
- **runId**: opcional (v1 da extensão não emite — o trace_id do OTel usa
  runId|sessionId; ver §5).

Escrita best-effort (padrão `recordSessionVerdict` do F25 — **nunca quebra a
sessão**); kill switch `RUNECRAFT_OBSERVABILITY=0|false|off` → camada inerte
(zero arquivos); leitura fail-soft (linhas malformadas puladas — padrão ledger
glla v0.28.6).

## 2. Catálogo de kinds (v1)

| Kind | Payload (campos) | Quem emite |
| --- | --- | --- |
| `session:started` | bundleHash (64 hex, header), agentId, model, gitHead, versions{harness,sdk,forks}, at | F28 (extension, session_start) |
| `session:ended` | durationMs, toolUsage[], delegations[], totalToolCalls, totalDelegations, agentId, model, tokenTotals, at | F28 (agent_end / session_shutdown) |
| `bundle:changed` | bundleHash (novo full), at | F28 (config muda no meio da sessão — eventos antigos imutáveis) |
| `context:usage` | usedTokens, maxTokens, usagePct, action (none\|warn\|recover), source (sdk\|bridge), at | F28 (ctx.getContextUsage / token-budget do taskflow) |
| `tokens:usage` | input, output, reasoning?, cacheRead, cacheWrite, totalMessages, at | F28 (tool_result.usage / token-budget) |
| `tool:call` | tool, argsHash (sha256 normalizado — NUNCA args crus), at | F28 (tool_call) |
| `tool:result` | tool, ok, blocked?, guardId?, reason?, durationMs, at | F28 (tool_execution_end) |
| `delegation` | agent, toolCallId, durationMs, at | F28 (tool `subagent` — F2) |
| `guard:blocked` | guardId, tool, reason, at | F28 (tool_execution_end + reason `<guardId>: msg` — formato F24 D3) |
| `verification:verdict` | verifyId, status, layer, reason, suggestion, cost, at | **bridge** (verify-verdicts.jsonl, dono F25) |
| `resilience:signal` | signal, detail, at | **bridge** (ledger glla + continuation.json + resilience-events.jsonl, donos F24/F27) |
| `lesson:captured` | lessonId, triggerSignature, trigger, antiPattern, preferred, priority, gate, track, count, at | F28 (gate failure — OBS-06) |
| `lesson:reincidence` | lessonId, triggerSignature, count, at | F28 (mesmo trigger+gate — D5) |
| `lesson:promoted` | lessonId, triggerSignature, priority, count, at | F28 (threshold → promoted.jsonl) |
| `adendo:injected` | track, gate?, lessonIds[], textHash, at | F28 (before_agent_start) |

### Kinds CONTRATO (reservados — v1 NÃO emite)

| Kind | Contrato |
| --- | --- |
| `verification:started` | F25 pode emitir quando iniciar a cascata diretamente no store — sem retrofit |
| `verification:stage` | F25 pode emitir por stage executado — sem retrofit |

## 3. Fronteiras (D7 — cada sink continua dono; sem duplicação)

| Sink | Dono | F28 |
| --- | --- | --- |
| `.runecraft/verify-verdicts.jsonl` | F25 | Bridge read-only no export → `verification:verdict`; sweep de fim de sessão → lessons (fail/halt) |
| `.pi-glla/active.jsonl` (ledger) | F24/F27 | Bridge read-only no export → `resilience:signal` (pending_latch_stuck/wedge_alert/heartbeat_refire) |
| `.runecraft/continuation.json` | F27 | Bridge read-only → `resilience:signal` (continuation) |
| `.runecraft/resilience-events.jsonl` | F27 | Bridge read-only → `resilience:signal` (stall:* / fallback / continuation_*) |
| `evidence/` (F21) | F21 | Intocado (eval-specific) |
| `.runecraft/events/` + `lessons.jsonl` + `lessons/promoted.jsonl` | F28 | Escrita exclusiva |

`.gitignore` escopo fino: `.runecraft/events/` e `.runecraft/lessons.jsonl`
gitignored (dados derivados do runtime); `promoted.jsonl` VERSIONADO
(memória de time — QA-4a; F29 consome).

## 4. Export (`harness events export --format jsonl [--session <id>] [--include-external]`)

- Ordenação: (sessionId lexicográfico, seq asc) — 2 runs → **byte-idênticos**.
- **Bridges** (--include-external): verify-verdicts.jsonl →
  `verification:verdict`; ledger glla + continuation.json +
  resilience-events.jsonl → `resilience:signal` — todos com `source:"bridge"`
  e **seq virtual** (monotônico na sessão-alvo).
- **Atribuição de sessão dos bridges** (D8): com `--session <id>` → anexam à
  sessão pedida (seq = último do store + 1 + i) SOMENTE se a sessão tem
  eventos no store; sem `--session` → sessão sintética `__bridge__` (os sinks
  externos são do cwd, sem atribuição de sessão nos arquivos — honesto).
- **prevHash chain** verificado → violações no stderr (exit 0 com aviso).
- **Fail-soft**: linhas malformadas (store E bridges) puladas e contadas.

## 5. Mapeamento OTel / Langfuse (D8 — implementação OTel ADIADA)

> **Nota datada 2026-08-08:** a export OTel/SDK está ADIADA na v1 (zero deps
> novas travado — AD-028). O contrato abaixo documenta o mapeamento para o
> futuro; o v1 materializa jsonl determinístico apenas.

| Kind (F28) | OTel | Langfuse |
| --- | --- | --- |
| `session:started` | span `session` (trace_id = runId\|sessionId; attributes = payload) | trace start (id = sessionId) |
| `session:ended` | span `session` (fim; durationMs) | trace end (usage = tokenTotals) |
| `bundle:changed` | span attribute update | observation `bundle` |
| `context:usage` | span `context` (attributes usedTokens/maxTokens/action) | observation `context` |
| `tokens:usage` | span `tokens` (attributes input/output/cache) | observation `tokens` |
| `tool:call` | span `tool.<name>` (attributes argsHash) | observation `tool.<name>` (input) |
| `tool:result` | span `tool.<name>` (fim; ok/blocked/durationMs) | observation `tool.<name>` (output) |
| `delegation` | span `delegation` (attributes agent) | observation `delegation` |
| `guard:blocked` | span `guard` (attributes guardId/reason) | observation `guard:blocked` |
| `verification:verdict` | span `verification` (attributes status/layer) | observation `verification` |
| `resilience:signal` | span `resilience` (attributes signal/detail) | observation `resilience` |
| `lesson:captured/reincidence/promoted` | span `lesson` (attributes lessonId/gate) | observation `lesson` |
| `adendo:injected` | span `adendo` (attributes track/lessonIds) | observation `adendo` |

Regra geral: `trace_id = runId|sessionId`; `span = kind`; `attributes = payload`
(menos `at` — timestamp do span). Langfuse: `trace = session`, `observation =
kind`.

## 6. Limitações honestas (validado no Execute F28)

- **O resultado do `tool_call` NÃO expõe o block do F24**: o runner do SDK
  (runner.js `emitToolCall`) interrompe no primeiro `{block:true}` — extensões
  registradas depois do guards (ordem da manifest) NÃO recebem o evento.
  Chamadas bloqueadas NÃO emitem `tool_result` (agent-loop.js pula o
  afterToolCall para resultados imediatos). **A observação REAL do bloqueio é
  o `tool_execution_end`** (isError + reason `<guardId>: msg` no
  result.content — `createErrorToolResult`): → `guard:blocked`.
- **`tool:call` de chamadas bloqueadas NÃO é gravado** (args indisponíveis no
  `tool_execution_end`) — o bloqueio aparece como `tool:result` (blocked) +
  `guard:blocked`.
- **SDK `context` event = só messages** (sem tokens): a fonte de contexto é a
  API tipada `ctx.getContextUsage()` (`ContextUsage {tokens, contextWindow,
  percent}`) + token-budget do taskflow (bridge read-only; NUNCA escreve em
  `.pi/`). `shouldCompact` (puro, SDK) fica como checagem sob demanda.
- **before_agent_start** é por prompt do usuário (não por turno interno): o
  adendo execution (lições do gate que falhou) é injetado no próximo
  before_agent_start — chaining preservado (NÃO sobrescreve outras extensões).
- **Lessons**: captura em gate failure HARD (bloqueio F24, halt F25 via
  tool_execution_end; fail/halt do verify-verdicts.jsonl + sinais F27 no sweep
  de fim de sessão — dedupe por triggerSignature; vereditos soft (skip) não
  capturam lessons na v1.
