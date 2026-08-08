# F26 — Tasks (Eval Framework Port)

**Base:** design.md D1–D9 (aguarda respostas QA-1..QA-5) · infra reutilizada: F21 (fixture OpenAI-wire, ScriptedScenario, evalTest → evidência, EVAL-MATRIX v3, consistency), F23 (ratchets/baselines/goldens, eval:ratchet), F24 (guards — sujeitos), F25 (VerifyDeps.judgeAdapter, RUNECRAFT_VERIFY_LLM_JUDGE)
**Dependências de decisão:** T1/T2 (QA-1) · T4 (QA-2) · T5 (QA-3) · T8/T9 (QA-4) · T6 (QA-5) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/eval/types.ts + schema.ts (D1/D2, EVAL-012)

- [ ] `src/eval/types.ts`: port RPG-free de types.ts do arcanum — EvalPhase (prompt|routing|trajectory), EvalTarget (prompt-render | single-turn-agent), ExecutorSpec (prompt-render | trajectory-run), EvaluatorSpec (11 kinds), EvalCase/EvalSuiteManifest/EvalArtifacts/AssertionResult/EvalCaseResult/EvalRunSummary/EvalRunResult/ResolvedTarget/ExecutionContext/RunnerFilters; `toolPolicy`/`agentMetadata` preservados (sem agentes guild pré-F32)
- [ ] `src/eval/schema.ts`: validação runtime LEVE hand-rolled (zero deps novas — reuso de zod SÓ se já existir no dep tree, validar no Execute); formatSchemaIssues + kind hints (formato arcanum); tipos TS como guard primário (`satisfies`)
- [ ] **Verificar:** unit — case inválido rejeitado com motivo claro; kind desconhecido → hint; sem imports externos novos (audit de deps); tipos compilam

## T2 — src/eval/loader.ts (D2, EVAL-012) — depende QA-1

- [ ] `src/eval/loader.ts`: loadSuite/loadCases/loadScenario a partir de módulos TS (dynamic import — validar no Execute vs funções registradoras); EvalConfigError com arquivo + motivo; refs de cases/scenarios resolvidas por caminho relativo ao suite
- [ ] **Verificar:** unit — suite/case/scenario carregam e validam; referência quebrada → erro tipado; schema inválido → motivo + hint

## T3 — src/eval/evaluators/deterministic.ts (D4, EVAL-013)

- [ ] Port dos 8 kinds (contains-all, contains-any, excludes-all, section-contains-all, ordered-contains, xml-sections-present, tool-policy, min-length) com weight distribution (`distributeWeight` — semântica arcanum); mensagens normalizadas RPG-free (sem path absoluto/timestamp — F21 D10)
- [ ] **Verificar:** unit por kind — patterns passam/falham; weight distribuído; prompt vazio determinístico; tool-policy mismatch com reason; mensagens estáveis (2 runs idênticos)

## T4 — src/eval/executors/trajectory-run.ts + targets/single-turn-agent.ts + evaluators/trajectory-assertion.ts (D3/D4, EVAL-013) — depende QA-2

- [ ] `executors/trajectory-run.ts`: HarnessTrace construído do transcript REAL do ScriptedScenario F21 (sequência de tool calls + agents + turns; shape a validar no Execute — EVAL-006/007 já consomem transcript real)
- [ ] `targets/single-turn-agent.ts`: sessão SDK in-process (helpers/sdkSession.ts + bindExtensions + fixture) → trace + tool registry
- [ ] `evaluators/trajectory-assertion.ts`: port adaptado — expectedSequence/required/forbidden/min-maxTurns sobre HarnessTrace (não o TrajectoryTrace mock do arcanum); assertions RPG-free
- [ ] **Verificar:** unit — sequência correta passa; fora de ordem falha; required/forbidden; min/maxTurns; trace vazio → degrade com reason

## T5 — src/eval/evaluators/llm-judge.ts (D4/D9, EVAL-016) — depende QA-3

- [ ] Tier substring offline: expectedContains/expectedAnyOf/forbiddenContains (semântica arcanum, SEM normalizeAliases — RPG-free); tier real: VerifyDeps.judgeAdapter (F25) SÓ com RUNECRAFT_VERIFY_LLM_JUDGE=1; parse estrito; inválido/timeout → fail-closed; output vazio → fail determinístico
- [ ] **Verificar:** unit com fake — substring passa/falha; env off → zero chamadas reais (spy); env on → adaptador chamado com critérios; CI simulado (env off) → zero rede

## T6 — src/eval/evaluators/baseline-diff.ts (D4/D6, EVAL-015) — depende QA-5

- [ ] Compara run atual vs ratchet F23 (test/eval/baselines/ — formato a validar no Execute); normalize/sort reutilizados da infra F23 (sem duplicação); assertions por caso (regression → fail; informational/no-regression → pass); baseline ausente → degraded informacional
- [ ] **Verificar:** unit — baseline rebaixado → regression (fail com reason); baseline removido → degraded; determinismo; zero imports novos

## T7 — src/eval/runner.ts + reporter.ts + targets/prompt-render.ts (D1/D3/D7, EVAL-012) — depende QA-1

- [ ] `runner.ts`: runEvalSuite in-process — resolve target → executor → evaluators → AssertionResult[] → EvalCaseResult → summary (normalizedScore/status); filtros caseIds/agents/tags; evidência via evalTest() (helpers F21) → partial/*.jsonl (NÃO storage próprio — D6); `reporter.ts`: formatEvalSummary/formatJobSummaryMarkdown
- [ ] `targets/prompt-render.ts`: renderRules()/config renders (F19) — v1 sem cases (consumidores pós-F30/F32); goldens F23 já cobrem o render (sem duplicação)
- [ ] **Verificar:** unit com fakes — ordem de execução; filtros; veredito agregado; evidência nos partial/*.jsonl; 2 runs idênticos

## T8 — dados v1: suites/cases/scenarios TS (D2/D5, EVAL-014) — depende QA-4

- [ ] `test/eval/suites/constraint-adherence.ts` + `test/eval/cases/{write-guard-block,ranger-md-only,adversarial-guard-off}.ts` + `test/eval/scenarios/*.ts` (sequências scriptadas reais via fixture; guard combos); delta vs EVAL-006/007 documentado em comentário em cada case (D6 — sem double-test); cases smoke por kind determinístico p/ EVAL-013
- [ ] **Verificar:** cada case valida schema; refs resolvem; delta EVAL-006/007 explícito; casos bloqueados (tool-use/routing/compaction/failover) NÃO criados (outline — D5, não inventar F27/F30/F32)

## T9 — integração constraint-adherence na fixture F21 (D7, EVAL-014) — depende QA-4

- [ ] Sessão SDK in-process (sdkSession + bindExtensions com guards F24 materializados) + ScriptedScenario: write em arquivo existente → tool_call bloqueado (reason F24) → rewrite passa; ranger .md-only; adversarial (guard off no config → fixture FALHA com diagnóstico — padrão F24 T7); tool-policy sobre o tool registry da sessão (enumeração a validar no Execute; fallback: whitelist scripted + config guards)
- [ ] **Verificar:** EVAL-014 verde offline/$0 (loopback, apiKey literal, zero fetch externo); evidência no last-run.json; sem regressão EVAL-006/007/008..011 (487 testes)

## T10 — EVAL-MATRIX v4 + consistência + docs (D7/D8, EVAL-012..016)

- [ ] EVAL-MATRIX v4 aditivo (política F21 D9, bump MATRIX_VERSION): EVAL-012..016 + notas datadas + nota das categorias bloqueadas (F27/F30/F32 — sem entradas); teste de consistência estendido para varrer test/eval/suites (lane do framework)
- [ ] Docs: tabela de mapeamento arcanum→harness (TODOS os arquivos — tabela do design D3/D6/D9) em docs/ + seção "Evals" no ROUTING.md (F19 D9); fonte recuperada do checkout ~/Projects/arcanum (sem fabricação); tabela de dependência das 5 categorias (design D5)
- [ ] **Verificar:** consistência matriz↔suites verdes; tabela conferida contra os nomes reais do arcanum (checklist — todos os 13 arquivos + dados + testes); goldens do ROUTING verdes; `bun test` sem regressão nos 487 + novos verdes offline/$0

## Success Criteria (spec)

- [ ] Runner in-process carrega suites/cases/scenarios TS e executa todos os kinds determinísticos — 2 runs idênticos
- [ ] EVAL-012..016 verdes offline/$0 na lane F21; evidência no last-run.json
- [ ] Constraint-adherence v1 com sujeitos F24 (write-guard, ranger, adversarial) — delta EVAL-006/007 documentado
- [ ] Mapeamento arcanum→harness cobrindo TODOS os arquivos do framework (fonte real, sem fabricação)
- [ ] Subset v1 justificado (dead weight: section/xml até F32; model-response fora; baseline-diff implementado)
- [ ] Tabela de dependência das 5 categorias (constraint NOW; tool-use/routing F32; compaction F27; failover F30)
- [ ] EVAL-MATRIX v4 aditivo com notas datadas; consistência varre suites; sem regressão nos 487

## Traceability EVAL → tasks

| Requirement | Tasks |
| --- | --- |
| EVAL-012 (framework port) | T1, T2, T7 |
| EVAL-013 (evaluators determinísticos) | T3, T4 |
| EVAL-014 (constraint adherence v1) | T8, T9 |
| EVAL-015 (baseline-diff) | T6 |
| EVAL-016 (llm-judge) | T5 |
| Governança (matrix/docs/consistência) | T10 |

**Cobertura:** 5/5 · toda user story da spec tem requirement ID (EVAL-012..016) · todo requisito tem task.
