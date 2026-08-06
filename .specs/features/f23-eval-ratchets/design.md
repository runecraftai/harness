# F23 Design — Ratchet Baselines de Não-Regressão

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** 4 métricas v1 — (a) falhas conhecidas da suite (baseline keyed por identidade estável, may only shrink), (b) cobertura de comandos do CLI (lista só cresce), (c) goldens de assets (templates/prompts/configs renderizadas), (d) pass rate E2E (fail-only-on-worse por versão, excluindo fail-infra) · `--update` explícito e humano (nunca autocorreção em PR; recusa com `CI=true`) · baselines em arquivos versionados no repo · CI falha se piora, avisa se melhora (remover do baseline é aviso, não falha)

## Contexto

Testes pegam regressão quando alguém roda; ratchets pegam **crescimento silencioso**. O F23 fecha o grupo EVAL (F21–F23, AD-010) transferindo para o harness TS os 3 padrões de baseline do gentle-ai, verificados na pesquisa 2026-08-05:

| Padrão gentle-ai | Formato verificado | Comportamento |
| --- | --- | --- |
| `.refusal-ratchet-baseline.txt` (1563 entradas) | refusals keyed por (file, mensagem) — **nunca linha** | "may only shrink"; update via env `GENTLE_AI_REFUSAL_RATCHET_UPDATE=1` |
| `.deadcode-baseline.txt` (243) | `<arquivo>\t<símbolo>` normalizado, ordenado sob `LC_ALL=C` (collation pinada, senão `comm` produz nonsense) | CI falha se ENTRAM funções novas; avisa se saem; update via `scripts/deadcode-ratchet.sh --update` |
| `.guard-population-baseline.txt` (9) | `arquivo, família, too-tight\|too-loose, nodeKind, sha256, justificativa` | CI falha se novo guard site aparece sem declaração |

Filosofia comum (citada na spec): "freezing today's violations and refusing growth is the part that pays for itself" — **ratchet, não gate limpo**; o objetivo não é zero violações, é violações estáveis, explícitas e nunca crescendo em silêncio.

Fontes que alimentam o F23: o F21 grava evidência JSON (resultados por teste com identidade estável `(testFile, testName, mensagem normalizada)`, DETR-06 AC 3.2) e exercita os comandos do CLI (camada 1); o F22 grava resultados datados em `.specs/features/f22-e2e-benchmark/results/<versão>/<data>.json` com `status: pass|fail|limit|fail-infra` (E2EV-02). Os primeiros candidatos a golden já existem como decisão: o template `renderRules()` do F19 (D9 — anti-divergência doc ↔ template, apêndice golden no ROUTING.md) e as configs MCP renderizadas do F15 (D4 — `renderMcpConfig(host, ctx)`).

Nota de layout: os paths abaixo assumem `packages/harness/` (F6 PLANNED, ROADMAP M2) e `test/eval/` dentro do package (recomendação da spec do F21, gray area "Onde vive" — validar no Execute quando o F6 criar o package). A lane CI dos evals é do F9 (ROADMAP M6; "lane CI dos evals (F21)") — o F23 define o que roda nessa lane.

## Decisões

### D1 — Layout e formato exato dos baselines

Baselines e goldens vivem **no repo, versionados por git**, dentro do package harness. Evidência efêmera do F21 é gitignored — contraste deliberado com os results do F22 (versionados, `.specs/features/f22-e2e-benchmark/results/`).

```
packages/harness/
├── test/
│   ├── eval/
│   │   ├── ratchet.test.ts        # runner determinístico (bun test — lane CI)
│   │   ├── ratchet-e2e.ts         # runner E2E pass rate (release/manual)
│   │   ├── update.ts              # --update (grava baselines + regenera goldens)
│   │   ├── normalize.ts           # identidade estável (D2)
│   │   ├── sort.ts                # ordenação determinística (D2)
│   │   ├── diff.ts                # unified diff mínimo p/ goldens (zero deps)
│   │   ├── baselines/             # ⭐ VERSIONADOS
│   │   │   ├── known-failures.txt
│   │   │   ├── command-coverage.txt
│   │   │   └── e2e-passrate.txt
│   │   └── results/               # evidência JSON do F21 (gitignored — efêmera)
│   └── golden/                    # ⭐ VERSIONADOS
│       ├── rules-pi.golden
│       ├── rules-nonpi.golden
│       ├── section-workflow.golden
│       ├── mcp-claude.golden
│       ├── mcp-opencode.golden
│       └── mcp-codex.golden
```

**Formato exato de cada um dos 4 artefatos:**

**1. `baselines/known-failures.txt`** — ratchet de falhas (métrica a; may only shrink):

```
# runecraft harness — known failures (may only shrink)
# formato: testFile<TAB>testName<TAB>mensagemNormalizada
# gerado por: bun run eval:ratchet --update
test/eval/layer1/install.test.ts	install dry-run zero writes	expected 0 writes, got 2
test/eval/layer1/status.test.ts	status json driver field	state file unreadable
```

- Identidade estável = `(testFile, testName, mensagem normalizada)` — **nunca linha crua** (edge spec: mensagem varia entre runs). A mensagem gravada é a **primeira linha** do erro, sanitizada (newlines → espaço, sem tabs) e truncada em 200 chars — o resto do stack não entra na identidade.
- TSV com tab literal como separador; o conteúdo da mensagem nunca contém tab (sanitizado).
- Ordenado com a colação pinada do D2.

**2. `baselines/command-coverage.txt`** — cobertura de comandos (métrica b; lista só cresce):

```
# runecraft harness — command coverage (list only grows)
# formato: comando<TAB>flagsCanonicas (nomes ordenados, valores removidos)
# gerado por: bun run eval:ratchet --update
install	dry-run preset
doctor	json
status	
sync	
uninstall	agent
```

- Identidade = `comando` + multiset de **nomes de flag** (parse de argv do teste), ordenados alfabeticamente, **valores removidos** (`--preset minimal` → `preset`). Granularidade por valor fica nos testes/goldens do F21 — v1 não congela valores (estabilidade > fine-grain; validar no Execute se valor relevante como `--agent` precisar entrar).
- Comando sem flags = linha `comando` + tab vazio.

**3. Goldens `test/eval/golden/*.golden`** — métrica c; arquivos de texto puro, **byte a byte** (D4).

**4. `baselines/e2e-passrate.txt`** — tendência E2E (métrica d; fail-only-on-worse):

```
# runecraft harness — E2E pass rate per version (fail-only-on-worse; fail-infra excluded)
# formato: harnessVersion<TAB>scenarioId<TAB>status   (scenarioId = campo `name` do F22 — ex.: hello-world-sdlc; revisão 2026-08-05 — I4)
0.1.0	hello-world-sdlc	pass
0.1.0	goal-subagent-chain	limit
0.1.0	taskflow-dag	pass
0.2.0	hello-world-sdlc	pass
```

- Uma linha por cenário da **última rodada aceita por versão**; `--update` **adiciona** a rodada nova (histórico por versão nunca é removido — o arquivo cresce como histórico versionado).
- **Sem data na linha**: a data já vive no filename do F22 (`results/<versão>/<data>.json`); data no baseline só produziria diff ruidoso a cada `--update`. Divergência proposital da proposta da spec (que pedia data na linha — resolvido aqui: a fonte da data é o F22; registrado na spec — M1, revisão 2026-08-05).
- Referência de comparação = última rodada de versão **anterior** presente no arquivo (procura `versão < atual`; a mais recente). Validar no Execute: critério exato de comparação semver vs ordem de linhas.

### D2 — Identidade estável e normalização

Função compartilhada `normalize.ts` — **a mesma função aplicada na gravação do baseline e na comparação** (o baseline congela mensagem já normalizada; a evidência crua do F21 é normalizada na leitura). O F21 grava a mensagem **crua** na evidência JSON (preserva diagnóstico); a normalização é responsabilidade do F23.

**Removido da identidade** (regexes documentadas e versionadas em `normalize.ts`, cada uma com teste dedicado — a normalização em si é testada):

| Padrão | Exemplo | Por quê |
| --- | --- | --- |
| Timestamps (ISO/epoch) | `2026-08-05T10:00:00Z`, `1785...` | varia a cada run |
| Paths absolutos | `/tmp/runecraft-test-abc123/...`, valores de `RUNECRAFT_*_HOME` (fixtures F21) | varia por runner/máquina |
| Portas efêmeras | `:54321` (port 0, edge F21) | varia a cada run |
| Versões de pacote / hashes | `@runecraft/harness@0.1.0`, `21b6bb0` | variam com bump legítimo |
| Durações | `(1.2s)`, `123ms` | varia com a máquina |
| ANSI escapes | `\x1b[...m` | varia com TTY |

**NUNCA removido**: números de assert (`expected 0 writes, got 2`) — assert com número diferente = identidade diferente = falha nova = vermelho, que é o comportamento correto (o contrato do teste mudou). A normalização é **fail-safe**: padrão não previsto → mensagem aparece crua no diff (nunca mascara por regex excessiva).

Regras de identidade:

- **Primeira linha** do erro como mensagem; newlines → espaço; tabs → espaço; truncamento em 200 chars.
- **Dedup canônico** (edge spec): um mapa por identidade; duas falhas que normalizam para a mesma identidade = **uma linha** no baseline (sem contagem — contagem varia e não é contrato).
- **Colação pinada** (`sort.ts`): ordenação por comparador próprio (code points / UTF-16 units do JS) — determinístico cross-platform, nunca `localeCompare` (locale-dependent). No CI, `LC_ALL=C` é setado no job mesmo assim, para ferramentas externas (git diff, sort de shell). Diferença vs gentle-ai (que usa `comm`/`sort` de shell com byte order): nós ordenamos em TS — pinado na implementação, equivalente funcional do `LC_ALL=C` (requisito é *mesma ordem nos dois lados*, não byte order específico; validar no Execute se algum passo externo exige `LC_ALL=C sort`).

### D3 — Mecanismo de comparação (fail-only-on-worse)

`ratchet.test.ts` (bun test) lê baselines + evidência atual e aplica as regras por métrica:

| Métrica | Entrada nova (piorou) | Entrada que some (melhorou) | Resultado esperado |
| --- | --- | --- | --- |
| known-failures | **FALHA** (regressão real; lista cada entrada nova) | **aviso** (sugere `--update` para remover) | verde com falhas congeladas listadas |
| command-coverage | — (cobertura extra = melhoria) | **FALHA** (comando deixou de ser exercitado) | cobertura atual ⊇ baseline; extra = aviso "rode --update para congelar" |
| goldens | render ≠ golden → **FALHA** com diff unificado | — | byte a byte |
| e2e-passrate | pass rate pior vs versão anterior → **FALHA** (sinalização) | pass rate melhor → aviso + `--update` | fail-infra excluído (D5) |

- **Exit codes**: 0 = verde (com avisos no stderr); 1 = falha. Aviso nunca muda exit code — só imprime "ⓘ aviso: X saiu do baseline — rode bun run eval:ratchet --update".
- Output: relatório `N falhas congeladas, M novas (FAIL), K saíram (aviso)` — legível em CI log.
- Falhas **fail-infra** (classificação do F21, edge spec F23: "falhas de ambiente SHALL ser marcadas e excluídas") não entram no ratchet de falhas — mesma semântica do `fail (infra)` do F22. Como o F21 classifica infra (env de bun/node mudou, git config, rede indisponível) é do design do F21 — **validar no Execute** o contrato (status `fail-infra` no JSON de evidência; o ratchet só respeita o campo).
- O runner **nunca** atualiza nada sozinho: `--update` recusa com `CI=true` (proteção explícita — "nunca autocorreção em PR", padrão gentle-ai).

**Contrato de evidência** (mínimo que o F23 exige do F21 — o F21 define o formato final no Execute; alinhar lá):

```json
{
  "harnessVersion": "0.0.0",
  "results": [
    { "testFile": "test/eval/layer1/install.test.ts", "testName": "dry-run zero writes",
      "status": "fail", "message": "expected 0 writes, got 2" }
  ],
  "coverage": [
    { "command": "install", "flags": ["--dry-run", "--preset", "minimal"] }
  ]
}
```

Gravado em `test/eval/evidence/last-run.json` (path do F21; gitignored — efêmero por PR). Contrato (revisão 2026-08-05, B1): **mensagem CRUA** — o F21 grava crua, o F23 normaliza na leitura (única implementação em `normalize.ts`); `status` aceita `pass|fail|fail-infra` (classificação do F21, `setup.ts`); `coverage[]` via helper `recordCoverage(command, flags)` do F21.

### D4 — Goldens de assets

**Lista v1** (todos derivados de código já decidido — nada inventado):

| Golden | Fonte do render | Nota |
| --- | --- | --- |
| `section-workflow-pi.golden` | seção completa `<!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->` render para Pi (F15 D3/F18, família HTML) | junção rules.ts + marcadores (Pi) |
| `section-workflow-nonpi.golden` | idem para os 3 não-Pi (F19 D6) | junção rules.ts + marcadores (não-Pi) |
| `mcp-claude.golden` | `renderMcpConfig("claude-code", ctx)` (F15 D4) | bin fixado pelo teste (D4 abaixo) |
| `mcp-opencode.golden` | `renderMcpConfig("opencode", ctx)` (F15 D4) | idem |
| `mcp-codex.golden` | `renderMcpConfig("codex", ctx)` (F15 D4) | idem |

O golden de **rules** (`renderRules`) NÃO duplica aqui (revisão 2026-08-05, I2): vive no F21 (`routing-golden.test.ts`) com o apêndice do ROUTING.md como espelho humano — cadeia `renderRules == golden == apêndice` testada lá (5 `.golden` neste design).

- **Prompts**: o harness v1 não define prompt próprio (os forks têm os deles) — **validar no Execute**; se nenhum asset de prompt existir, a categoria fica vazia com nota no README do test/eval. Quando surgir prompt próprio (ex.: F20 gates), entra na lista com `--update`.
- **Determinismo do render**: os testes de golden fixam o ambiente (ex.: `RUNECRAFT_TASKFLOW_<HOST>_BIN=/test/fixtures/bin/<host>-taskflow-mcp`) para que o render de MCP seja byte a byte reproduzível; `renderRules` já é pura (F19 D5 — sem data/env/sessão). Comparação **byte a byte** — golden é drift exato, sem normalização (aqui normalização seria mascarar).
- **Diff revisável**: divergência → teste vermelho com unified diff (helper `diff.ts` próprio, zero deps de runtime — decisão alinhada ao F11 "zero deps"; validar no Execute se o helper mínimo cobre ou se vale usar `toMatchSnapshot` do bun com trade-off documentado).
- **Relação com F19 D9 (revisão 2026-08-05, I2)**: o teste único de rules vive no F21 (`routing-golden.test.ts`): `renderRules == golden == apêndice` — apêndice do ROUTING.md como espelho humano; divergência em qualquer par = vermelho. Este design NÃO duplica rules; goldens aqui são só `mcp-*` e `section-workflow-*`.
- **Regra de ouro**: golden nunca é editado à mão fora de PR; conteúdo deliberadamente novo = `--update` + revisão do diff na PR (edge spec).
- **Limite de tamanho**: assert de tamanho nos testes (rules ≤ ~45 linhas Pi / ~25 não-Pi — herdado do F19 D5, calibrar no Execute); goldens de MCP são pequenos por construção; golden que cresce demais → revisar granularidade (split), não aceitar silenciosamente.

### D5 — Pass rate E2E (tendência por versão)

- **Fonte**: `results/<versão>/<data>.json` do F22 (E2EV-02) — rodadas versionadas, nunca sobrescritas.
- **Rodada válida**: cenário 0 (hello world, F22 AC 1.3) presente; se o sanity falhou (qualquer status ≠ pass) a rodada é **inválida** e o ratchet não compara — avisa (F22: "falha dele invalida a rodada"). Rodada interrompida (parcial, marcada pelo F22) → compara só cenários completos; se nenhum completo, inconclusiva (não sinaliza).
- **Cálculo**: pass rate = `pass / (pass + fail + limit)` — `fail-infra` excluído do numerador **e** denominador (F22 edge: infra não conta como regressão no F23). Denominador = 0 → rodada inconclusiva (não sinaliza).
- **Comparação**: rodada nova (versão V) vs referência = última rodada de versão `< V` no baseline (D1). Piorou → **sinalização** com exit ≠ 0 e mensagem `regressão vs v<anterior>: 80% → 60% (cenários: ...)`; melhorou/igual → verde + aviso de `--update`.
- **Onde roda**: **fora do merge gate** — nunca na lane de PR (E2E é caro, F22). Roda em release (pré-tag, F9) e manual (`RUNECRAFT_E2E=1 bun run eval:ratchet --e2e`). O release **sinaliza** (exit ≠ 0) mas a decisão de prosseguir é humana — o pipeline exato do F9 não existe ainda, **validar no Execute** se release bloqueia ou só reporta.
- **`--update`**: grava a rodada mais recente encontrada em `results/` como nova entrada por versão (aditivo — histórico preservado).

### D6 — Comando de update (`--update`)

- Entry: `bun run eval:ratchet` no `package.json` do harness → `test/eval/ratchet.test.ts` (modo compare = CI) com subcomandos: `--update` (grava os 3 baselines + regenera os 6 goldens), `--e2e` (modo E2E do D5, combina com `--update`). Validar no Execute: entry exato (bun test vs script TS próprio + wrapper fino para o turbo test).
- **O que atualiza**: (1) `known-failures.txt` — estado atual das falhas (entradas que sumiram são removidas — é o mecanismo do "aviso vira remoção"; nunca remove falha que ainda ocorre), (2) `command-coverage.txt` — cobertura atual (congela extras), (3) `e2e-passrate.txt` — rodada mais recente (aditivo), (4) goldens — regrava do render atual.
- **Output**: relatório do que mudou — `X entradas adicionadas, Y removidas, Z inalteradas` por baseline + lista de goldens regenerados + diff resumido. O diff completo fica na PR (git).
- **Recusas**: `CI=true` → recusa (`--update` é humano; padrão gentle-ai: env explícito no refusal, flag explícita no deadcode). Sem `--update`, o runner é estritamente read-only.
- Fluxo canônico: `bun run eval:ratchet` (vermelho com instrução) → decide (regressão real = corrige; conhecida = `bun run eval:ratchet --update`) → PR contém código + baseline → revisão humana do diff.

### D7 — Integração CI (F9 lane)

- **Lane de PR** (offline, $0 — F21 AC 3.1): `bun test` roda a suite do F21 (que grava `latest.json`) + `ratchet.test.ts` (métricas a, b, c). Falha → merge bloqueado. Avisos → verde.
- **PR que só mexe em código** sem atualizar baseline: pego pela métrica que piora (cobertura que some = vermelho; golden que diverge = vermelho) — não há caminho de drift silencioso.
- **Release** (F9): `RUNECRAFT_E2E=1` rodada E2E + `ratchet --e2e` (métrica d) — sinalização, fora do merge gate.
- **Ambiente**: `LC_ALL=C` no job (ferramentas externas); ordenação TS pinada (D2); zero rede/tokens na lane de PR.

## Arquitetura — módulos

```
packages/harness/
├── test/
│   ├── eval/
│   │   ├── ratchet.test.ts        # comparação determinística (a/b/c) — CI
│   │   ├── ratchet-e2e.ts         # comparação E2E (d) — release/manual
│   │   ├── update.ts              # --update: grava 3 baselines + regenera goldens
│   │   ├── normalize.ts           # identidade estável + regexes versionadas + testes
│   │   ├── sort.ts                # comparador canônico (code points) — colação pinada
│   │   ├── diff.ts                # unified diff mínimo p/ goldens
│   │   ├── baselines/             # known-failures.txt · command-coverage.txt · e2e-passrate.txt (versionados)
│   │   └── results/               # latest.json do F21 (gitignored)
│   └── golden/                    # 5 .golden (versionados — D4)
└── package.json                   # scripts: "eval:ratchet": "bun test/eval/ratchet.test.ts"
```

Dependências: **zero deps novas** (alinhado ao F11) — normalização, ordenação e diff são TS puro. Importa `renderRules` (F19) e `renderMcpConfig` (F15) do src.

## Fluxos

### F1 — Lane CI de PR (determinístico, offline, $0)

```
PR abre
  → bun test: suite F21 roda (camadas 1 e 2) e grava test/eval/results/latest.json
  → ratchet.test.ts:
      known-failures: falhas atuais × baseline → novas = FAIL · congeladas = verde · sumidas = aviso
      command-coverage: atual ⊇ baseline → faltando = FAIL · extra = aviso
      goldens: renderRules/renderMcpConfig (+seção) × .golden → divergência = FAIL com diff
  → verde: merge liberado · vermelho: PR bloqueada com o relatório e a instrução de --update
```

### F2 — Falha nova descoberta (regressão real ou conhecida)

```
teste falha → ratchet vermelho (entrada nova listada)
  dev decide:
    regressão real   → corrige o código (baseline intocado)
    falha conhecida  → bun run eval:ratchet --update → baseline ganha a entrada
  PR com código + baseline → revisão humana do diff (nunca autocorreção em CI)
```

### F3 — Falha congelada some (melhoria)

```
falha do baseline deixa de ocorrer
  → ratchet verde + aviso: "ⓘ X saiu do baseline — rode bun run eval:ratchet --update"
  → --update remove a entrada (o aviso vira remoção explícita; remover é aviso, não falha)
```

### F4 — Golden drift (mudança deliberada de template)

```
template mudou (F19 D5 v1→v2, F15 MCP, etc.)
  → ratchet vermelho com unified diff (render atual × golden)
  → revisão: --update regenera → PR mostra o diff do conteúdo injetado como código
  → bump WORKFLOW_RULES_VERSION quando aplicável (F19 D5) + espelho do ROUTING.md (D9) conferido
```

### F5 — Release E2E (pré-tag, F9)

```
RUNECRAFT_E2E=1 bun run eval:e2e        # F22 grava results/<versão>/<data>.json
bun run eval:ratchet --e2e              # lê rodada mais recente × baseline da versão anterior
  sanity (cenário 0) falhou → rodada inválida: avisa, não compara
  pass rate piorou (fail-infra excluído) → sinalização exit ≠ 0 (decisão humana)
  melhorou/igual → verde + aviso de --update
bun run eval:ratchet --e2e --update     # grava a rodada como baseline da versão nova (aditivo)
```

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Normalização frágil** (mensagem varia de jeito não previsto — timestamps novos, paths inesperados) | Regexes versionadas + teste dedicado por regex em `normalize.ts`; fail-safe: padrão não previsto aparece cru no diff (entrada nova = vermelho), nunca mascarado; se a regex mudar, o baseline antigo diverge → diff revisável via `--update` |
| **Falso positivo por ambiente do CI** (bun/node subiu, git config do runner, rede) | Classificação `fail-infra` no F21 (edge spec F23) excluída do ratchet — mesmo contrato do F22; validar no Execute como o F21 classifica |
| **Goldens grandes → diff ruidoso** | Limites de tamanho com assert (herdado F19 D5); goldens de MCP pequenos por construção; golden que cresce → split por arquivo, não aceite silencioso; unified diff padrão |
| **Baseline esquecido em PR que só mexe em código** | Não há caminho de drift silencioso: cobertura que some = vermelho, golden divergente = vermelho, falha nova = vermelho; o CI imprime a instrução de `--update` |
| **Colação do ambiente** (Linux vs macOS sort; `localeCompare`) | Ordenação em TS com comparador de code points (determinístico cross-platform, nunca locale-dependent); `LC_ALL=C` no job para ferramentas externas; sem depender de `sort`/`comm` de shell (diferente do gentle-ai, que é Go+shell) |
| **`--update` rodando em CI/automático** | Recusa com `CI=true` (D6); runner estritamente read-only sem a flag; padrão gentle-ai (update explícito e humano) |
| **Dois baselines apontando para o mesmo teste** (edge spec) | Dedup por identidade canônica (D2) — uma entrada por identidade, contagem fora do contrato |
| **Evidência do F21 ausente/antiga** (latest.json não existe, PR sem suite) | ratchet falha com mensagem clara ("evidência não encontrada — suite F21 não rodou?") — nunca compara contra vazio e passa em silêncio |
| **E2E caro / rodada inválida** | Fora do merge gate (release/manual, F22); sanity do cenário 0 valida a rodada; parcial marca e compara só completos (D5) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| RCTH-01 | P1: Ratchet falhas (AC 1.1–1.4) | D1 (formato `known-failures.txt` TSV) + D2 (identidade estável `(testFile, testName, mensagem normalizada)`, dedup, colação) + D3 (tabela de comparação: nova = FAIL, congelada = verde listada, some = aviso) + Fluxo F1/F2/F3 |
| RCTH-02 | P1: Ratchet falhas (AC 1.5 `--update`) | D6 (comando, o que atualiza, output do que mudou, recusa com `CI=true`) + Fluxo F3 |
| RCTH-03 | P1: Goldens (AC 2.1–2.3) | D4 (lista v1: rules Pi/não-Pi do F19, seção `runecraft:workflow` do F15/F18, configs MCP do F15; comparação byte a byte com diff revisável; regeneração via `--update`; nunca editar à mão fora de PR) + Fluxo F4 |
| RCTH-04 | P2: Tendência E2E (AC 3.1–3.3) | D5 (lê `results/` do F22, baseline por versão anterior, fail-infra excluído, sanity cenário 0, sinalização em release fora do merge gate, `--update` aditivo) + Fluxo F5 |

**Cobertura:** 4/4 mapeados. Edge cases da spec: mensagem varia entre runs → D2 (normalização fail-safe) · ambiente do CI mudou → D3 (`fail-infra` excluído, contrato com o F21 a validar no Execute) · golden muda de propósito → D4/D6 (`--update` + revisão na PR) · dois baselines, mesmo teste → D2 (dedup canônico).

**Notas de revisão cruzada:** F19 D9 mantido e reforçado — o `.golden` vira a fonte mecânica única e o apêndice do ROUTING.md (seção 9) permanece como espelho humano verificado por teste de cadeia (ajuste do teste do F19 no Execute do F23). F21 fornece a evidência JSON e o helper de cobertura (contrato mínimo definido em D3; formato final alinhado no Execute — o design do F21 ainda não existe). F22 fornece `results/<versão>/<data>.json`; o F23 não escreve nesse diretório (read-only) — o baseline próprio fica em `test/eval/baselines/`. F9 (lane CI + release) consome: PR = métricas a/b/c; release = métrica d. Paths assumem `packages/harness/` do F6 (PLANNED) — confirmar no Execute do F6.
