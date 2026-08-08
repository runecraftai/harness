# test/eval — ratchets de não-regressão (F23, grupo EVAL AD-010)

O F23 congela os baselines da suite determinística (F21) e dos assets
injetados (F15/F18/F19) com a filosofia do gentle-ai: *freezing today's
violations and refusing growth is the part that pays for itself* — ratchet,
não gate limpo. Escopo: (a) falhas conhecidas, (b) cobertura de comandos,
(c) goldens de assets, (d) pass-rate E2E (**P2, lançado com o F22** —
`ratchet-e2e.ts` + `baselines/e2e-passrate.txt`, release/manual, fora do
merge gate).

## O que roda onde

| Artefato | Papel | Vivo em |
| --- | --- | --- |
| `baselines/known-failures.txt` | falhas congeladas (may only shrink) | repo (versionado) |
| `baselines/command-coverage.txt` | cobertura do CLI (lista só cresce) | repo (versionado) |
| `baselines/e2e-passrate.txt` | pass rate E2E por versão (fail-only-on-worse) | repo (versionado; entradas vêm da 1ª rodada F22 real via `--e2e --update`) |
| `../golden/*.golden` (5) | drift de templates/seções/configs MCP | repo (versionado) |
| `evidence/` (F21) | evidência JSON efêmera por run | gitignored (D10) |
| `normalize.ts` / `sort.ts` / `diff.ts` | identidade estável, colação pinada, diff | código |

> **Reconciliação de path (Execute):** o design do F23 (escrito pré-F21)
> assumia `test/eval/results/latest.json`. O F21 implementou a evidência em
> `test/eval/evidence/` (`partial/*.jsonl` → `scripts/eval-merge-evidence.ts`
> → `evidence/last-run.json`). O ratchet usa o path REAL do F21 e **sempre
> re-mergea** o `partial/` antes de comparar — nunca confia em `last-run.json`
> velho. Evidência ausente = FAIL: *"evidência não encontrada — suite F21 não
> rodou?"* (nunca compara contra vazio em silêncio).

## Fluxo canônico

```sh
bun test                    # suite F21/guards/verify + ratchet (chained no script test)
bun run eval:ratchet        # compara (read-only; exit 0 verde / 1 vermelho)
bun run eval:ratchet --update   # humano e explícito: congela o estado atual
bun run eval:ratchet --e2e      # lane E2E (release/manual — fora do merge gate)
bun run eval:ratchet --e2e --update  # congela a rodada F22 mais recente (aditivo)
```

## Lane E2E (métrica d — F23 P2, D5/D6)

Roda **fora do merge gate** (release/manual): `bun run eval:ratchet --e2e`.
O runner **NUNCA invoca o E2E do F22** (zero tokens/rede) — lê os resultados
COMMITTED em `.specs/features/f22-e2e-benchmark/results/<versão>/<data>.json`
e compara a rodada mais recente da versão atual contra a última rodada de
versão ANTERIOR no `baselines/e2e-passrate.txt`:

- **Rodada válida** = cenário 0 (COEX-05 `hello-world-sdlc`) presente E pass;
  senão → aviso e **exit 2** (não compara). Rodada parcial compara só os
  cenários completos; zero completos → inconclusiva (verde).
- **Pass rate** = `pass / (pass + fail + limit)` — `fail-infra` excluído do
  numerador E do denominador. Denominador 0 → inconclusivo (não sinaliza).
- **Piorou** → **exit 1** com a mensagem `regressão vs v<prev>: 80% → 60%
  (cenários: …)`; melhorou/igual → verde + aviso de `--e2e --update`.
- **Exit codes**: 0 verde (avisos ok) · 1 regressão · 2 infra/config (JSON
  inválido, sem baseline, rodada inválida, `--update` recusado).
- **`--e2e --update`** é **aditivo** (histórico nunca é removido — appenda a
  rodada mais recente por versão; a última ocorrência por `(versão, cenário)`
  é o estado efetivo) e **recusa com `CI=true`** (D6, mesmo contrato do P1).
  Entradas reais só entram a partir da primeira rodada F22 — o arquivo
  commitado começa vazio (header apenas).
- Variáveis de override (testes hermeticos): `RUNECRAFT_E2E_RATCHET_RESULTS_ROOT`,
  `RUNECRAFT_E2E_RATCHET_BASELINE`, `RUNECRAFT_E2E_RATCHET_VERSION`.

- `--update` **recusa com `CI=true`** (nunca autocorreção em PR — padrão
  gentle-ai). O diff completo fica na PR para revisão.
- O `test` do package roda `bun test … ; bun run eval:ratchet` preservando o
  exit code da suite (suite vermelha = PR bloqueada — contrato F21; o ratchet
  roda MESMO assim para classificar nova vs congelada). Entry escolhido no
  Execute (D6): script TS próprio (`ratchet-run.ts`, não `*.test.ts`) — o bun
  test roda arquivos em paralelo; um runner `.test.ts` leria a evidência
  parcial antes da suite terminar (raça). `ratchet.test.ts`/`goldens.test.ts`/
  `normalize.test.ts` são os testes UNIT do núcleo (fixtures em temp, sem
  dependência de evidência).
- **Rode a suite completa antes de comparar.** O ratchet tem piso de
  completude (`MIN_EVIDENCE_FILES` no `ratchet-run.ts` — fix cleric F23):
  runs parciais (`bun test test/eval/layer1`) produzem evidência com menos
  arquivos que o piso → FAIL "evidência INCOMPLETA" (nunca verde falso).
  Bump explícito do piso quando um arquivo de teste novo com `evalTest()`
  entrar na suite (revisão como golden). **F26 (v4):** piso 13 → 14 — o
  `test/eval/framework/constraint-adherence.test.ts` (EVAL-014/EVAL-012,
  lane do framework de evals) entrou na evidência. **F27 (v5):** piso 14 →
  15 — o `test/eval/framework/compaction-recovery.test.ts` (EVAL-017..021,
  lane do F27 Resilience & Continuity) entrou na evidência. **F31 (v9):**
  piso 18 → 19 — o `test/eval/framework/copilot.test.ts` (EVAL-049..056,
  lane do F31 Copilot/VSCode Adapter) entrou na evidência.

## Regras (D3, fail-only-on-worse)

| Métrica | Piorou | Melhorou | Resultado |
| --- | --- | --- | --- |
| known-failures | falha NOVA (não no baseline) | falha some do baseline | **FAIL** listando entradas / verde + aviso `--update` |
| command-coverage | comando deixa de ser coberto | cobertura extra | **FAIL** / verde + aviso `--update` |
| goldens | render ≠ golden (byte a byte) | — | **FAIL** com unified diff (`diff.ts`, zero deps) |
| e2e-passrate | pass rate piora vs versão anterior | pass rate melhora | **exit 1** com `regressão vs v<prev>: …` / verde + aviso `--e2e --update` |

- Identidade de falha = `(testFile, testName, mensagem normalizada)` — nunca
  linha crua. Normalização em `normalize.ts` (regexes versionadas, uma por
  padrão, teste dedicado por regex): timestamps/paths/portas/IPs/versões/
  hashes/durações/ANSI removidos; **números de assert nunca** (número
  diferente = contrato mudou = vermelho); fail-safe (padrão não previsto
  aparece crua no diff).
- Colação pinada (`sort.ts`): code points do JS, nunca `localeCompare`;
  `LC_ALL=C` no job do CI é para ferramentas externas (git diff/sort).
- `fail-infra` (classificação do F21 `setup.ts` — git ausente, rede fora de
  loopback, versão de bun) é **excluído** do ratchet (D3, mesmo contrato do
  `fail (infra)` do F22).
- Dedup canônico: duas falhas com a mesma identidade = uma entrada (contagem
  fora do contrato).

## Goldens (D4)

| Golden | Fonte do render |
| --- | --- |
| `section-workflow-pi.golden` / `-nonpi.golden` | markers html (F18 `sections.ts`) + `renderRules` (F19) — seção `runecraft:workflow` completa |
| `mcp-claude.golden` / `-opencode.golden` / `-codex.golden` | `renderMcpConfig` (F15 `mcpConfig.ts`) com bins pinados via `RUNECRAFT_TASKFLOW_*_BIN` (env fixture — determinismo byte a byte; os bins nunca são executados) |

- O golden de **rules** (`renderRules`) NÃO é duplicado aqui: vive no
  `f19-routing.test.ts` (apêndice do ROUTING.md, D9 — cadeia
  `renderRules == golden == apêndice`).
- **Prompts: categoria VAZIA** — o harness v1 não define prompt próprio (os
  forks têm os deles; `pi.prompts` do package.json aponta para
  `@runecraft/subagents` e `@runecraft/pr-review`). Quando surgir prompt
  próprio (ex.: gates do F20), entra na lista com `--update`.
- Determinismo: env fixado no teste; render puro; comparação byte a byte (aqui
  normalização seria mascarar drift). Golden nunca editado à mão fora de PR.
- Limites de tamanho assertados nos testes (pi ≤ 48 / não-pi ≤ 27 linhas,
  calibrados no Execute: 46/13 linhas de regras + 2 de markers; MCP pequeno
  por construção ≤ 20).

## Caveats conhecidos

- O merge do F21 agrupa por `runId` (timestamp do worker, granularidade de
  segundo). Um run completo normalmente compartilha UM runId (workers sobem no
  mesmo segundo); se um worker subir no segundo seguinte, o merge pode pegar
  um grupo menor (evidência parcial → possível falso FAIL de cobertura). Não
  tocamos no contrato do F21; o re-run resolve.
- Falha congelada ainda deixa a SUITE vermelha (o `evalTest` do F21 re-throwa
  — contrato AD-015). O ratchet classifica (congelada = verde no relatório)
  mas não destrava o bun test: corrigir ou `--update` são os caminhos.
