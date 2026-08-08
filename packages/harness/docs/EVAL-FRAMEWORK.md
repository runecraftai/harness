# Runecraft Harness — Eval Framework (F26)

> Framework de evals portado do arcanum (supersedido — AD-001) para o harness
> (F26, AD-026). Suites/cases/scenarios são **dados TS** (QA-1); o trace de
> trajetória é o **transcript REAL** do fixture F21 (QA-2); o judge LLM tem
> **dois tiers** (QA-3); constraint-adherence v1 usa os **guards F24** (QA-4);
> baseline-diff é **implementado** vs o ratchet F23 (QA-5). Zero deps novas,
> RPG-free, offline/$0 por construção.

## 1. Onde vive

| Artefato | Path |
| --- | --- |
| Framework (runner/loader/schema/reporter/evaluators/targets/executors) | `packages/harness/src/eval/` |
| Dados TS — suites | `packages/harness/test/eval/suites/` |
| Dados TS — cases | `packages/harness/test/eval/cases/` |
| Dados TS — cenários (ScriptedScenario do fixture F21) | `packages/harness/test/eval/scenarios/` |
| Testes do framework (port adaptado dos testes do arcanum) | `packages/harness/test/eval/framework/` |
| Evidência (F21 — dono): `evalTest()` → `evidence/partial/*.jsonl` → merge → `last-run.json` | `test/eval/evidence/` |
| Ratchets (F23 — dono): baselines + goldens | `test/eval/baselines/`, `test/golden/` |
| Registro de governo | `test/EVAL-MATRIX.md` (v4 — EVAL-012..016) |

## 2. Mapeamento arcanum → harness (fonte real do checkout `~/Projects/arcanum`)

| Arcanum (`packages/guild/src/features/evals/`) | Harness (`packages/harness`) | Onde |
| --- | --- | --- |
| `index.ts` | `src/eval/index.ts` | D1 |
| `types.ts` (404 ln) | `src/eval/types.ts` (RPG-free — sem aliases thread→rogue etc.; sem agentes guild pré-F32) | D1/D8 |
| `schema.ts` (zod) | `src/eval/schema.ts` (hand-rolled, zero deps — zod NÃO está no dep tree, validado no Execute) | D1/D2 |
| `loader.ts` (JSONC hand-rolled) | `src/eval/loader.ts` (TS modules via dynamic import — QA-1) | D2 |
| `runner.ts` | `src/eval/runner.ts` (evidência via `evalTest()` — sem storage próprio) | D1/D6/D7 |
| `reporter.ts` | `src/eval/reporter.ts` | D1 |
| `storage.ts` (`.guild/evals/runs`) | → helpers F21 `evalTest()` — NÃO portado (F21 é o dono da evidência) | D6 |
| `baseline.ts` | `src/eval/evaluators/baseline-diff.ts` (implementado — vs ratchet F23, reusa normalize/sort) | D4/D6 |
| `evaluators/deterministic.ts` (8 kinds) | `src/eval/evaluators/deterministic.ts` (8 kinds, mensagens RPG-free) | D4 |
| `evaluators/llm-judge.ts` (substring + normalizeAliases RPG) | `src/eval/evaluators/llm-judge.ts` (substring SEM aliases + tier real env-gated via VerifyDeps.judgeAdapter — F25) | D4/D9 |
| `evaluators/trajectory-assertion.ts` | `src/eval/evaluators/trajectory-assertion.ts` (sobre o HarnessTrace do transcript REAL) | D3/D4 |
| `targets/builtin-agent-target.ts` | `src/eval/targets/prompt-render.ts` (renderRules() do F19) + `src/eval/targets/single-turn-agent.ts` (sessão SDK in-process) | D3 |
| `executors/prompt-renderer.ts` | `src/eval/targets/prompt-render.ts` (thin — executor no target) | D3 |
| `executors/trajectory-run.ts` (mock-text) | `src/eval/executors/trajectory-run.ts` (transcript REAL do ScriptedScenario — QA-2) | D3 |
| `executors/model-response.ts` | NÃO portado (custo por chamada; reavaliar com F22/F32) | D9 |
| `executors/github-models-api.ts` / `openrouter-api.ts` | NÃO portados (custo) | D9 |
| `evals/suites/*.jsonc` (3) | `test/eval/suites/*.ts` (TS — v1: `constraint-adherence.ts`) | D2/D5 |
| `evals/cases/*.jsonc` (8) | `test/eval/cases/*.ts` (v1: write-guard-block, ranger-md-only, adversarial-guard-off) | D2/D5 |
| `evals/scenarios/*.jsonc` (6) | `test/eval/scenarios/*.ts` (ScriptedScenario do fixture F21) | D2/D3 |
| testes do framework (`loader.test.ts`, `runner.test.ts`, `schema.test.ts`, `reporter.test.ts`, `baseline.test.ts`, `evaluators/*.test.ts`, `targets/*.test.ts`, `executors/*.test.ts`) | `test/eval/framework/*.test.ts` (port adaptado) | T1..T7 |

## 3. Adaptações semânticas (documentadas no Execute)

- **TrajectoryTrace** (QA-2): `delegationSequence` = nomes das tool calls do
  transcript REAL (replyTool do fixture); `delegationTargets` = tool calls
  BLOQUEADOS pelos guards F24 (derivados do reason na conversa — padrões
  `GUARD_REASON_IDS` do F24); `turns.agent` = agente da sessão ("main").
- **tool-policy** (D4/Execute): o registry = união dos tools vistos nos
  requests REAIS do fixture; tool ausente = desabilitada (false). Mismatch
  documentado na mensagem (`expected X, received undefined`).
- **llm-judge** (QA-3): tier substring SEM normalizeAliases (o arcanum
  normalizava thread→rogue etc. — F26 não tem aliases); tier real SÓ com
  `RUNECRAFT_VERIFY_LLM_JUDGE=1`, parse estrito reusa o `parseJudgeResponse`
  do F25; inválido/timeout → fail-closed; output vazio → fail determinístico.
- **baseline-diff** (QA-5): falha de case com identidade NOVA vs o
  `known-failures.txt` do F23 → regression; congelada → pass; case passou →
  no-regression; baseline ausente → degraded. Identidade 2-partes
  `caseId<TAB>mensagemNormalizada` (namespace F26, distinto da identidade
  3-partes da evidência F21); reusa `normalizeMessage`/`parseBaselineLines` (fonte única src/eval/baselines.ts — fix cleric F26)
  `parseBaselineLines` do F23 (sem duplicação).

## 4. Subset v1 de evaluators (D4 — honesto)

| Kind | Status | Justificativa |
| --- | --- | --- |
| contains-all / contains-any / excludes-all / ordered-contains / min-length | portado as-is | vocabulário central de conteúdo/ordem |
| section-contains-all / xml-sections-present | portados as-is, ZERO cases v1 | prompts XML dos agentes guild não existem pré-F32 — dead weight documentado; desbloqueado pelo F32 |
| tool-policy | portado adaptado | registry real da sessão (enumeração validada no Execute) |
| trajectory-assertion | portado adaptado | trace REAL (QA-2), não o mock-text do arcanum |
| llm-judge | dois tiers | substring offline + real env-gated (F25) |
| baseline-diff | IMPLEMENTADO | reservado no arcanum; vs ratchet F23 |

## 5. Categorias do eval-coverage — tabela de dependência (D5)

| Categoria | Sujeito (feature) | Status | Casos v1 F26 | Quando |
| --- | --- | --- | --- | --- |
| Constraint adherence | Guards F24 (write-existing-file-guard, ranger-md-only, todo-*) | ✅ disponível | EVAL-014 (write-guard, ranger, adversarial) | AGORA |
| Tool-use correctness | Agentes F32 (single-turn-agent com tools reais dos papéis) | 🔒 bloqueada | — (outline) | após F32 |
| Routing completeness | Agentes F32 (orquestração → papéis) | 🔒 bloqueada | — (outline) | após F32 |
| Compaction recovery | F27 (port compaction-recovery + CONTINUATION_MARKER) | ✅ disponível (v5) | EVAL-017..021 (continuation builder, todo preserver, stall, classify+fallback, recovery-flow) | AGORA (F27) |
| Model failover | F30 (port model-resolution, fallback chain) | 🔒 bloqueada | — (outline) | após F30 |
| Memory | F29 (port runes — tools `rune_*` + runes.db) | ✅ disponível (v7) | EVAL-030..038 (round-trip, 10 tools no fixture, cross-session, semântica search/context, compaction, bridge F28, config/kill switch, determinismo, privacidade) | AGORA (F29) |

**v7 (F29, AD-029):** a categoria Memory foi ADICIONADA — EVAL-030..038 na
matriz (nota datada 2026-08-09). Tool-use/routing (F32) e Model failover (F30)
seguem sem entrada (política aditiva).

**v5 (F27, AD-027):** a categoria Compaction recovery foi DESBLOQUEADA —
EVAL-017..021 na matriz (nota datada 2026-08-07). Tool-use/routing (F32) e
Model failover (F30) seguem sem entrada (política aditiva).

**Extensibilidade (D5):** caso novo = 1 suite/case/scenario TS + 1 entrada
aditiva na matriz. Runner/loader/evaluators NÃO mudam. As categorias
bloqueadas NÃO têm entrada na matriz (política aditiva F21 D9 — nada sai sem
AD); F26 NÃO inventa o design de F27/F30/F32 (outline apenas).

## 6. Determinismo e evidência (D8/D6)

- Mensagens sem path absoluto/timestamp (F21 D10); aliases RPG removidos.
- Determinismo provado por teste: 2 runs da suite (sintética E real) →
  vereditos idênticos (status/score/mensagens).
- Evidência via `evalTest()` nos testes de fluxo (EVAL-014/EVAL-012) →
  `evidence/partial/*.jsonl` → merge → `last-run.json`; ratchet F23 cobre
  (piso de completude 14 — bump F26).
- Judge LLM nunca em CI: env off por construção (preloads F21/F24/F25);
  spy nos testes prova zero invocação sem env.
