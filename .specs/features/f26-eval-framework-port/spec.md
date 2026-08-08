# F26 — Eval Framework Port (evals do guild → harness) Specification

**Scope:** Large (multi-component: port do framework runner/loader/reporter/schema/targets/executors + evaluators + suites/cases/scenarios como dados TS + v1 de constraint-adherence com sujeitos F24 + EVAL-MATRIX v4)
**Prereq:** F21 ✓ (fixture OpenAI-wire + ScriptedScenario, evalTest → evidência, EVAL-MATRIX v3), F23 ✓ (ratchets/baselines/goldens, script eval:ratchet), F24 ✓ (guards — sujeitos de constraint-adherence), F25 ✓ (VerifyDeps.judgeAdapter injetável, RUNECRAFT_VERIFY_LLM_JUDGE=1 — reuso no llm-judge)
**Grupo:** M7 — Garantias (pilar "evals do guild portados — offline/$0" do roadmap; F26 = o framework + as 5 categorias do eval-coverage do arcanum; decisão 4 do usuário: garantias antes de agentes)

## Problem Statement

O harness hoje garante a **execução** (F24: bloqueio real de `tool_call` via guards), a **saída** (F25: cascata de verificação com judge env-gated), com evidência determinística (F21: fixture OpenAI-wire, ScriptedScenario, `evalTest()` → last-run.json) e ratchets (F23). Mas **não existe um framework de evals** que expresse casos como dados (suites/cases/scenarios) com um vocabulário de evaluators reutilizável — cada fluxo é um teste scriptado ad hoc (EVAL-001..011). O arcanum (supersedido — AD-001) tem exatamente esse framework em `packages/guild/src/features/evals/` (runner/loader/reporter/storage/schema/types + targets + executors + 11 evaluator kinds + baseline) e dados em `packages/guild/evals/` (3 suites / 8 cases / 6 scenarios JSONC), além do plano `.guild/plans/eval-coverage/spec.md` com as **5 categorias descobertas**: tool-use correctness, constraint adherence, compaction recovery, model failover, routing completeness.

Mas o framework do arcanum é preso ao tema RPG (aliases `thread→rogue`/`shuttle→ranger` no normalizeAliases, agentes bard/rogue/…), usa JSONC (parser hand-rolled no loader), o executor de trajetória é **mock-text** ("intentionally mock-backed and text-based" — comentário no código-fonte; replay de respostas canônicas + regex de delegação, SEM prova de tool call real), os executors de modelo são **ao vivo** (`model-response` exige GITHUB_TOKEN/OPENROUTER_API_KEY — custo de tokens, viola offline/$0) e `baseline-diff` está **reservado** (`throw "reserved for a later phase and is not implemented yet"`).

F26 porta o framework **semanticamente** para o harness (TS, zero deps novas, RPG-free, offline/$0) e assume a propriedade das 5 categorias: **constraint-adherence é implementável AGORA** (sujeitos = guards F24); tool-use/routing → F32 (agentes); failover → F30 (model-resolution); compaction → F27 (resiliência).

## Goals

- [ ] Framework portado: runner/loader/reporter/schema/evaluators/targets/executors em `src/eval/` (TS, zero deps novas), semântica do arcanum, RPG-free
- [ ] Suites/cases/scenarios como módulos TS sob `test/eval/{suites,cases,scenarios}` com o MESMO schema do arcanum (compile-time safety; sem parser JSONC)
- [ ] Subset v1 de evaluators justificado: 8 determinísticos portados as-is (contains-all, contains-any, excludes-all, section-contains-all, ordered-contains, xml-sections-present, tool-policy, min-length) + trajectory-assertion adaptado (transcript REAL do fixture, não mock-text) + llm-judge (substring offline + judge real env-gated via adaptador F25) + baseline-diff IMPLEMENTADO (reservado no arcanum; vs ratchet F23)
- [ ] Constraint-adherence v1 AGORA: casos framework-driven sobre os guards F24 (write-existing-file-guard, ranger-md-only, adversarial guard-off), com delta documentado vs EVAL-006/007 (sem double-test)
- [ ] Categorias bloqueadas (tool-use/routing F32, compaction F27, failover F30) na tabela de dependência (outline); framework extensível por construção — caso novo = arquivo de dados, runner não muda
- [ ] EVAL-MATRIX v4 aditivo (EVAL-012..016, notas datadas) + teste de consistência estendido + docs com tabela de mapeamento arcanum→harness cobrindo TODOS os arquivos do framework (fonte real, sem fabricação)
- [ ] Offline/$0 em CI por construção; judge LLM nunca em CI (env-gated, padrão F22/F25)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Executors model-response (github-models/openrouter) | Custo de tokens por chamada; offline/$0 é HARD (F21); reavaliar com F22 (E2E) / F32 (agentes) |
| storage.ts do arcanum (`.guild/evals/runs/*.json`) | F21 é o dono da evidência: `evalTest()` → `evidence/partial/*.jsonl` → merge → `last-run.json`; F26 só consome (D6) |
| Parser JSONC / dep nova de parsing | Zero deps novas (HARD); dados viram TS modules (QA-1 recomendado) |
| Tema RPG do arcanum (normalizeAliases, agentes bard/rogue/…, mensagens com lore) | Decisão travada do usuário (1): port de evals/guards/agents SEM tema RPG |
| Replanejar F21/F23/F24/F25 | F21 dono do fixture/evidência; F23 dono dos ratchets; F24 dono dos guards; F25 dono da cascata — F26 integra aditivamente (D6) |
| Specs completas de tool-use/routing (F32), compaction (F27), failover (F30) | Bloqueadas pelos sujeitos (decisão 4); F26 entrega tabela de dependência + outline — NÃO inventar o design dessas features |
| Judge LLM em CI ou no merge gate | env-gated por construção (padrão F22/F25) |
| packages/guild, .guild/, .pi/ | Arcanum supersedido (AD-001); port semântico; fonte do checkout apenas para mapeamento (T10) |

## Gray area (resolver antes do Execute — 5 decisões do usuário)

O escopo de F26 está travado (decisões 1–4 + políticas F21/F22/F25). Cinco pontos permanecem abertos — apresentados com opções e recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Formato dos dados (suites/cases/scenarios)**: (a) **recomendado** — TS modules (compile-time safety, zero parser, convenção do harness — fixture scenarios.ts já é TS) · (b) JSONC com parser hand-rolled portado do arcanum (`readJsoncFile`, zero deps) · (c) JSONC com dep nova (fora da constraint — só registro)
- **QA-2 — Fonte do trace para trajectory-assertion**: (a) **recomendado** — transcript REAL de tool calls do ScriptedScenario F21 (fixture já replaya fluxos scriptados; EVAL-006/007 provam viabilidade) · (b) replay mock-text do arcanum (detectDelegation em respostas canônicas) — mais fraco, sem prova de tool call real
- **QA-3 — Escopo do llm-judge**: (a) **recomendado** — dois tiers: substring determinístico offline (semântica do arcanum, RPG-free) + judge REAL env-gated via VerifyDeps.judgeAdapter (F25) só com `RUNECRAFT_VERIFY_LLM_JUDGE=1` · (b) só substring offline · (c) só judge real (env-gated)
- **QA-4 — Escopo do v1 de constraint-adherence**: (a) **recomendado** — casos framework-driven NOVOS (write-guard block, ranger-md-only, adversarial guard-off) com delta documentado vs EVAL-006/007 · (b) sem casos novos (EVAL-006/007 já cobrem — F26 = framework puro) · (c) combo amplo (write-guard + ranger + todo-* num cenário)
- **QA-5 — baseline-diff v1**: (a) **recomendado** — implementado como evaluator que compara o run atual vs o ratchet F23 (test/eval/baselines/, normalize/sort reutilizados), regression → fail · (b) reservado como no arcanum (no-op mapeado ao script `eval:ratchet`) · (c) port integral do baseline.ts do arcanum sobre arquivo próprio novo

**Já decidido (não é gray area):** port sem tema RPG (decisão 1); judge LLM só quando cascata determinística decide — env-gated, nunca CI (decisão 2); offline/$0 em CI por construção (decisão 3); garantias antes de agentes — constraint-adherence agora (sujeitos F24), tool-use/routing F32, failover F30, compaction F27 (decisão 4); EVAL-MATRIX aditivo com notas datadas (F21 D9); escopo `packages/harness`; zero deps novas; requirement IDs EVAL-0xx; evidência via `evalTest()`; nada sai sem AD.

## User Stories

### P1: Framework port (runner/loader/schema/reporter) ⭐ MVP — EVAL-012

**User Story**: Como mantenedor, quero que suites/cases/scenarios carreguem de módulos TS validados e rodem num runner in-process determinístico, para expressar evals como dados com evidência no contrato F21 — sem parser JSONC e sem rede.

**Why P1**: É a fundação de todas as categorias; sem framework, cada categoria viraria teste ad hoc (como EVAL-001..011 hoje).

**Acceptance Criteria**:

1. WHEN uma suite TS é carregada THEN o loader valida schema (tipos + validação runtime leve) e resolve cases/scenarios por referência relativa
2. WHEN o runner roda uma suite THEN cada case resolve target → executa → avalia → `AssertionResult[]` → `EvalCaseResult` → summary; filtros `caseIds`/`agents`/`tags` funcionam
3. WHEN a mesma suite roda 2x THEN os vereditos são IDÊNTICOS (determinismo)
4. WHEN um case tem schema inválido / kind desconhecido THEN erro tipado com motivo + hint de kind (formato arcanum)
5. WHEN a suite roda em teste THEN a evidência é gravada via `evalTest()` (F21) → `partial/*.jsonl` → `last-run.json` (F23)

**Independent Test**: suite smoke com um case por kind determinístico → 2 runs idênticos; case com referência quebrada → erro tipado; evidência presente no last-run.json.

### P1: Evaluators determinísticos portados — EVAL-013

**User Story**: Como mantenedor, quero os 8 evaluators determinísticos do arcanum no harness (RPG-free), para assertions reutilizáveis de conteúdo/ordem/política de tools sem custo.

**Why P1**: São funções puras de string/policy (~200 linhas no arcanum) — o vocabulário central do framework.

**Acceptance Criteria**:

1. WHEN um evaluator roda THEN retorna `AssertionResult[]` com score/maxScore distribuídos pelo weight (semântica arcanum `distributeWeight`)
2. WHEN as mensagens são geradas THEN são normalizadas (sem path absoluto/timestamp — F21 D10) e SEM tema RPG
3. WHEN `tool-policy` roda THEN compara expectations vs o tool policy real da sessão (registry — enumeração a validar no Execute)
4. WHEN `trajectory-assertion` roda THEN usa o trace do transcript REAL do fixture (QA-2), não mock-text
5. WHEN prompt vazio / patterns vazios THEN comportamento determinístico documentado (score 0 / weight total)

**Independent Test**: unit por kind (patterns, weight, prompt vazio, mismatch de tool-policy, sequência fora de ordem) — todos offline/$0.

### P1: Constraint adherence v1 (sujeitos F24) — EVAL-014

**User Story**: Como mantenedor, quero que os guards do F24 sejam exercitados como CASES do framework (tool-policy + trajectory-assertion sobre a sequência real), para a categoria constraint-adherence do eval-coverage ter casa no harness agora.

**Why P1**: Única categoria implementável já (decisão 4 — sujeitos F24 existem); prova o framework com sujeito real.

**Acceptance Criteria**:

1. WHEN um case roda THEN sessão SDK in-process (sdkSession F21) materializa os guards e o ScriptedScenario replaya a sequência real (write → blocked → rewrite)
2. WHEN o write-guard bloqueia THEN o assertion sobre o transcript comprova o bloqueio com reason F24 — SEM re-assertar EVAL-006/007 (delta documentado no case, D6)
3. WHEN guard off no config (adversarial) THEN o case FALHA com diagnóstico (padrão F24 T7)
4. WHEN ranger-md-only roda THEN o case comprova a restrição `.md` via transcript
5. WHEN o case roda em CI THEN é offline/$0 (loopback, apiKey literal, zero fetch externo)

**Independent Test**: fixture → write em arquivo existente → bloqueado com reason (case verde); guard off → case vermelho com diagnóstico; evidência no last-run.json.

### P2: baseline-diff vs ratchet F23 — EVAL-015

**User Story**: Como mantenedor, quero que o evaluator `baseline-diff` (reservado no arcanum) compare o run atual contra o ratchet F23, para regressão ser detectada DENTRO do framework.

**Why P2**: F23 já cobre ratchet via script `eval:ratchet`; o evaluator torna a comparação um assertion reutilizável.

**Acceptance Criteria**:

1. WHEN o run atual regride vs o baseline F23 THEN assertion fail com reason (caseId + métrica)
2. WHEN o baseline está ausente/indisponível THEN degrade informacional (não falha infra)
3. WHEN normalize/sort roda THEN reusa a infra do F23 (sem duplicação)
4. WHEN determinismo THEN mesmo run → mesmo resultado de comparação

**Independent Test**: baseline rebaixado → regression detectada; baseline removido → degraded.

### P2: llm-judge port (offline + env-gated real) — EVAL-016

**User Story**: Como usuário, quero o `llm-judge` do arcanum no harness com dois tiers — substring determinístico offline (sem aliases RPG) e judge real via adaptador F25 somente com env — para custo zero em CI.

**Why P2**: No arcanum o "llm-judge" é substring determinístico (nunca chamou LLM de fato); o harness tem o adaptador real do F25.

**Acceptance Criteria**:

1. WHEN o tier substring roda THEN expectedContains/expectedAnyOf/forbiddenContains avaliam o output (RPG-free, SEM normalizeAliases)
2. WHEN o tier real está ativo (`RUNECRAFT_VERIFY_LLM_JUDGE=1`) THEN chama VerifyDeps.judgeAdapter (F25) com critérios; parse estrito; inválido → fail-closed
3. WHEN o env está ausente THEN o tier real NUNCA chama (spy); CI por construção não tem env
4. WHEN a saída é vazia THEN veredito determinístico (fail com reason)

**Independent Test**: unit com fake — env off → zero chamadas; env on → adaptador chamado; substring passa/falha; CI simulado → zero rede.

### P2: Governança (EVAL-MATRIX v4 + docs + dependências) — EVAL-012..016

**User Story**: Como mantenedor, quero a matriz aditiva v4, teste de consistência estendido e a tabela de mapeamento arcanum→harness, para nada sair sem AD e o port ser rastreável.

**Why P2**: Política F21 D9 (aditivo) + rastreabilidade do port (success criteria do F26).

**Acceptance Criteria**:

1. WHEN F26 entrega THEN EVAL-MATRIX v4 com EVAL-012..016 + notas datadas (política aditiva — nada sai sem AD)
2. WHEN o teste de consistência roda THEN varre também `test/eval/suites` (lane do framework)
3. WHEN os docs rodam THEN a tabela de mapeamento cobre TODOS os arquivos do framework arcanum (fonte real do checkout; sem fabricação)
4. WHEN as categorias bloqueadas são consultadas THEN a tabela de dependência responde (constraint NOW; tool-use/routing F32; compaction F27; failover F30)
5. WHEN `bun test` roda THEN os 487 testes do F25/F24 sem regressão + novos verdes offline/$0

**Independent Test**: consistência matriz↔suites; tabela conferida contra os nomes reais do arcanum (checklist T10); diff de testes sem regressão.

## Edge Cases

- WHEN um case referencia um scenario inexistente THEN loader falha com erro tipado (arquivo + motivo)
- WHEN um evaluator kind não é suportado THEN erro com hint de kind (formato arcanum `formatKindHint`)
- WHEN `tool-policy` encontra tool ausente no registry THEN mismatch documentado (undefined ≠ false) ou degrade — validar no Execute
- WHEN o trace está vazio (sem turns) THEN trajectory-assertion degrada com reason (não falha infra)
- WHEN `weight: 0` ou patterns vazios THEN distribuição determinística (precedente `distributeWeight` do arcanum)
- WHEN o baseline F23 está ausente THEN baseline-diff degrada (informational), sem falhar a suite
- WHEN o env do judge está off THEN o tier real do llm-judge nunca invoca (spy nos testes)
- WHEN o mesmo comportamento já é coberto por EVAL-006/007 THEN F26 não duplica — casos novos cobrem combinações/adversarial (delta documentado no case, D6)
- WHEN uma categoria está bloqueada (F27/F30/F32) THEN nenhuma entrada na matriz (política aditiva); a tabela de dependência documenta
- WHEN um case roda 2x THEN vereditos idênticos (determinismo; mensagens sem $TMP/$TS — F21 D10)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| EVAL-012 | P1: Framework port (loader/runner/schema/reporter + TS data + evidência) | Design | Pending |
| EVAL-013 | P1: Evaluators determinísticos (8 kinds + trajectory-assertion adaptado) | Design | Pending |
| EVAL-014 | P1: Constraint adherence v1 (sujeitos F24, adversarial, delta EVAL-006/007) | Design | Pending |
| EVAL-015 | P2: baseline-diff vs ratchet F23 | Design | Pending |
| EVAL-016 | P2: llm-judge (substring offline + real env-gated F25) | Design | Pending |

**Coverage:** 5 total, 0 mapeados, 5 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Runner in-process carrega suites/cases/scenarios TS e executa todos os kinds determinísticos — 2 runs idênticos (determinismo provado em teste)
- [ ] EVAL-012..016 verdes offline/$0 na lane F21 (`bun test test/eval`); evidência no last-run.json (F23)
- [ ] Constraint-adherence v1 com sujeitos F24 (write-guard, ranger, adversarial) — delta vs EVAL-006/007 documentado, sem double-test
- [ ] Mapeamento arcanum→harness documentado cobrindo TODOS os arquivos do framework (tabela), fonte real do checkout (sem fabricação)
- [ ] Subset v1 de evaluators justificado (dead weight: section/xml prompts até F32; model-response fora; baseline-diff implementado)
- [ ] Tabela de dependência das 5 categorias (constraint NOW; tool-use/routing F32; compaction F27; failover F30) — outline, sem inventar design
- [ ] EVAL-MATRIX v4 aditivo com notas datadas; teste de consistência varre suites; sem regressão nos 487 do F25/F24
