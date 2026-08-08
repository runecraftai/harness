# F25 — Tasks (Verification Cascade — determinismo de saída)

**Base:** design.md D1–D13 (aguarda respostas QA-1..QA-3) · infra reutilizada: F21 (fixture OpenAI-wire, EVAL-MATRIX v2, evidência JSON, materialização de extensões), F24 (guardKit, enforcer de complete_goal, kill switch, freeze por sessão, 398 testes), F13/F14 (state/merge), F19 (ledger do glla), F20 (padrão fail-closed)
**Dependências de decisão:** T5 (QA-2) · T7/T8 (QA-3) · T9 (QA-1) — implementar o recomendado; ajuste é barato se o usuário escolher outra opção

## T1 — verify/config.ts + schema aditivo (D9, VER-12)

- [ ] `src/verify/config.ts`: `VerificationConfig` (`enabled`, `thresholds.{embedding.{min,max}, sufficiency.{minRatio,maxRatio}}`, `policy.onFail: Record<layer, "retry"|"skip"|"halt">` + `retry.maxRuns`, `costCaps.{maxCascadeRuns, maxJudgeCalls, maxJudgeTokens}`, `degrade.{embeddingUnavailable, grayZoneNoJudge}`, `structural.commands`), defaults = recomendados (QA-1/Q-3), validação determinística (min < max, ≥ 0, tipos, política conhecida) → motivo claro
- [ ] `src/state.ts` aditivo: campo `verification?: VerificationConfig` ao lado de `guards` (schemaVersion permanece 1 — precedente F24 D2); parser tolerante a campos desconhecidos
- [ ] Kill switch `RUNECRAFT_VERIFY=0` (padrão F20 guardKit `killSwitchState`); freeze por sessão (padrão F24 D12 — config lida no session_start)
- [ ] doctor check "verification" (config válida + estado do env do judge, informativo) e seção `verification` no `status --json` (F24 padrão check 18/status guards)
- [ ] **Verificar:** unit — min ≥ max rejeitado com motivo; tipo errado rejeitado; kill switch desliga (sessão e CLI); config mid-session ignorada (freeze); state schema preserva `guards` do F24 (sem regressão nos 398)

## T2 — verify/verdict.ts + engine skeleton (D1/D2/D5, VER-01/09)

- [ ] `src/verify/verdict.ts`: `StageResult { layer, status: pass|fail|degraded, reasonId, suggestion }`, `Verdict`, `PolicyResolution` (retry|skip|halt)
- [ ] `src/verify/engine.ts`: `runVerificationCascade(input)` — pipeline ordenado 1→2→3→4→5 com short-circuit (falha de camada barata impede as mais caras); boundaries inclusivos (`score ≥ max → pass`, `score ≤ min → fail`, senão `gray`); escalada ao judge SÓ com `gray` + env (VER-09) — função pura, sem rede
- [ ] **Verificar:** unit — ordem respeitada (spy por camada); falha na camada 1 → camadas 2–5 não rodam; boundaries exatos (== min, == max); determinismo (mesmo input → mesmo Verdict)

## T3 — Camada 1 structural (D12, VER-02)

- [ ] `src/verify/stages/structural.ts`: executa scripts do repo com timeout (padrão verify-gate do arcanum: exec + timeout + `{exitCode, stdout, stderr, timedOut}`); defaults = scripts detectados no package.json (lint/typecheck/test — nomes a validar no Execute); override `structural.commands`; falha → StageResult com sugestão acionável (comando + arquivo/trecho do stderr, sem path absoluto/timestamp — F21 D10)
- [ ] **Verificar:** unit com runner fake — comando ausente → degraded; exit ≠ 0 → fail com sugestão; timeout → fail com reason de timeout; sugestão sempre presente em fail

## T4 — Camada 2 integrity (D3, VER-03)

- [ ] `src/verify/stages/integrity.ts`: reusa `loadSessionGuards`/`SessionGuardConfig` do guardKit F24 (domínio protegido = write-guard: existência/hash, realpath contra symlink); compara estado dos arquivos protegidos no momento da verificação; reason-id = `GUARD_REASON_IDS` do F24 (validar no Execute se SessionGuardConfig expõe hashes ou se a camada re-captura)
- [ ] **Verificar:** unit com snapshot de hashes — arquivo protegido alterado → fail com reason F24; intocado → pass; symlink para alvo protegido → fail; nada de definição nova de "protegido" (herança F24)

## T5 — Camada 3 sufficiency (QA-2, VER-04) — **depende da resposta QA-2**

- [ ] `src/verify/stages/sufficiency.ts`: implementação do critério composto recomendado (QA-2a): (i) escopo de arquivos — todo arquivo do diff ∈ escopo do goal (manifesto do goal/ledger ou `sufficiency.scopePaths`) senão `scope-violation`; (ii) proporção — `added+deleted tokens ∈ [minRatio, maxRatio] × |spec|` senão `empty` (diff vazio) ou `oversized`; ajuste barato se QA-2b/c/d
- [ ] **Verificar:** unit — diff vazio → empty com sugestão "mudança ausente"; diff gigante → oversized; arquivo fora do escopo → scope-violation; limites exatos (== minRatio/maxRatio); sem spec → camada segue com degraded (QA-3)

## T6 — Camada 4 embedding local (D4/D5, VER-07/08)

- [ ] `src/verify/stages/embedding.ts`: vetores TF de char n-gram (n=3) + cosseno, implementação pura (Map/hash, zero deps, zero rede), O(|spec|+|output|); scores arredondados (4 casas, tolerância documentada); boundaries (D5); spec ausente/output vazio/indisponível → política `degrade.embeddingUnavailable` (default skip + veredito `degraded` registrado — QA-3)
- [ ] **Verificar:** unit — score ∈ [0,1]; spec fiel vs output → pass (≥ max); output desconexo → fail (≤ min); meio → gray; spec ausente → degraded com reason; output vazio → fail (score 0); determinismo (mesmo input → mesmo score); stub de rede que falharia se fosse usado (zero fetch)

## T7 — Camada 5 judge env-gated (D5/D6, VER-09/10) — **depende de QA-3 (grayZoneNoJudge)**

- [ ] `src/verify/stages/judge.ts`: chamada SÓ com veredito `gray` + `RUNECRAFT_VERIFY_LLM_JUDGE=1` (env off → zero invocação, spy nos testes); adaptador LLM read-only (mecanismo a validar no Execute: auditor in-process AD-021 vs RPC pr-review F20); prompt versionado com critérios de faithfulness derivados da SPEC (nunca auto-avaliação); parse estrito `{verdict: pass|fail, confidence, reasons[]}`; inválido/timeout → fail-closed + contabilizado no cap; gray sem env → `grayZoneNoJudge` (default fail — QA-3)
- [ ] **Verificar:** unit com fake LLM — env off → zero chamadas (mesmo com gray); env on + gray → chamada com a spec no prompt (assert de faithfulness, sem auto-avaliação); JSON inválido → fail-closed; confidence no veredito; CI simulado (env off) → nenhuma chamada

## T8 — Política + cost caps (D7, VER-05) — **depende de QA-3 (defaults degrade)**

- [ ] `src/verify/cost.ts`: CostLedger por execução (goal) — `maxCascadeRuns` (retries), `maxJudgeCalls`, `maxJudgeTokens`; cap esgotado → HALT (block/exit 2) com reason de contabilidade; judge nunca chamado após o cap
- [ ] `src/verify/verdict.ts`: resolução de política — `retry` re-roda até maxCascadeRuns; `skip` registra veredito + sugestão e não bloqueia; `halt` bloqueia (D8); defaults por camada conforme QA-1 (recomendado: integrity/sufficiency halt; structural/embedding/judge skip)
- [ ] **Verificar:** unit — retry conta contra o cap; cap de judge esgotado → HALT e judge não é mais chamado (spy); skip registra sem bloqueio; halt bloqueia; contabilidade visível no reason

## T9 — Integração sessão no enforcer F24 (D8/D11, VER-01/05) — **depende de QA-1**

- [ ] `src/guards/todo-continuation-enforcer.ts`: no branch de `complete_goal`, DEPOIS do check de pendências do F24 (e só se F24 não bloqueou), chama `runVerificationCascade` (D11 — um único ponto, ordem determinística; verify/ é biblioteca, sem extensão nova)
- [ ] `src/verify/suggestions.ts`: reason no formato `<verifyId>: <camada> — <motivo>; <sugestão>` (sem path absoluto/timestamp — F21 D10); política `halt` → `{ block: true, reason }`; `skip` → veredito gravado no state + reason de resposta (não bloqueia); transcript registra
- [ ] **Verificar:** integração na fixture F21 — sessão com lint quebrado → veredito estrutural com sugestão (SOFT se política skip); tocar arquivo protegido → block (HARD); cap → HALT block; kill switch → inerte; F24 pendências continua bloqueando primeiro (sem regressão EVAL-006/007)

## T10 — CLI harness verify (D10, VER-06)

- [ ] `src/commands/verify.ts` (padrão F11 dispatch): MESMA `runVerificationCascade` com output = diff do working tree; escopo default = repo atual (goal ativo via ledger F19 — validar no Execute); flags `--json`, `--cwd`; exit codes 0 pass · 1 fail · 2 halt · 3 config/infra inválida; report `--json` = `{ok, checks[], warnings[], verdict}` (shape verify-gate do arcanum); kill switch → inativo, exit 0
- [ ] **Verificar:** repo fixture — limpo → 0; lint quebrado → 1; halt/cap → 2; config inválida → 3; paridade com o veredito de sessão no mesmo repo (mesma engine, teste de paridade); --json shape estável (golden)

## T11 — Port verification-reminder/verify-gate + docs (D12, VER-11)

- [ ] Recuperar a fonte no checkout `~/Projects/arcanum` (`packages/guild/src/hooks/verification-reminder.ts` + `packages/guild/src/tools/verify-gate.ts`) e documentar o mapeamento (tabela do design D12) em `docs/` + seção "Verification" no ROUTING.md (F19 D9 goldens); sugestões acionáveis em `suggestions.ts` cobrem o conteúdo semântico do reminder (diff/checks/validação de comportamento/gate decision)
- [ ] **Verificar:** docs com a tabela de mapeamento e citação da fonte (sem fabricação); sugestão da camada 1 contém o conteúdo semântico do reminder; goldens do ROUTING verdes (F19)

## T12 — Evals + evidência (D13, VER-13)

- [ ] EVAL-MATRIX v3 aditivo (política F21 D9, bump MATRIX_VERSION): EVAL-008 (cascata sessão short-circuit), EVAL-009 (integridade + suficiência), EVAL-010 (zona cinza + degrade + kill switch), EVAL-011 (CLI exit codes); teste de consistência matriz ↔ testes (varre `test/verify/`)
- [ ] `test/verify/{setup,engine,stages,config,cli,cascade-eval}.test.ts` na infra F21 (fixture OpenAI-wire, agentDir temp, env isolado — padrão F24 T7); evidência via `evalTest()` (F21 D10) → last-run.json; adversarial (política alterada no config → falha com diagnóstico)
- [ ] **Verificar:** `bun test test/verify test/guards test/eval` verde offline/$0 (loopback, apiKey literal, zero fetch externo, judge nunca presente); EVAL-008..011 na matriz ↔ testes; evidência no last-run.json; **sem regressão nos 398 testes do F24** (EVAL-006/007 intactos)

## Success Criteria (spec)

- [ ] Cascata roda 1→2→3→4→(5) com short-circuit em sessão Pi real (fixture F21) e via CLI — MESMA engine pura, paridade testada
- [ ] P1 (camadas 1–3) 100% offline/$0 por construção, verificado em CI (lane F21)
- [ ] Decisão de escalada = código (limiares min/max explícitos + zona cinza); judge nunca decide escalar; fora da zona aprova/reprova sem judge
- [ ] Judge só na zona cinza com `RUNECRAFT_VERIFY_LLM_JUDGE=1`; CI e merge gate nunca chamam judge; cap → HALT sem judge
- [ ] Mapeamento verification-reminder/verify-gate → feature documentado com fonte real do arcanum (sem fabricação)
- [ ] EVAL-008..011 na EVAL-MATRIX v3; evidência JSON no last-run.json (F23); sem regressão nos 398 testes do F24
- [ ] Config aditiva `verification` validada fail-closed, freeze por sessão, kill switch `RUNECRAFT_VERIFY=0`; doctor/status honestos

## Traceability VER → tasks

| Requirement | Tasks |
| --- | --- |
| VER-01 (ordem/short-circuit) | T2, T9 |
| VER-02 (estrutural) | T3 |
| VER-03 (integridade) | T4 |
| VER-04 (suficiência) | T5 |
| VER-05 (política/caps) | T8, T9 |
| VER-06 (CLI) | T10 |
| VER-07 (embedding) | T6 |
| VER-08 (degrade) | T6, T8 |
| VER-09 (escalada = código) | T2, T7 |
| VER-10 (judge env-gated) | T7 |
| VER-11 (port reminder/verify-gate) | T11 |
| VER-12 (config aditiva) | T1 |
| VER-13 (evals/evidência) | T12 |

**Cobertura:** 13/13 · toda user story da spec tem requirement ID ("P1: Cascata determinística offline"→VER-01..04, "P1: Política e custo"→VER-05, "P1: CLI harness verify"→VER-06, "P2: Embedding local"→VER-07/08, "P3: Judge env-gated"→VER-09/10, "P3: Port+config+evidência"→VER-11/12/13) · todo requisito tem task.
