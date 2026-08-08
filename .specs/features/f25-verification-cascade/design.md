# F25 Design — Verification Cascade (determinismo de saída)

**Status:** Ready for Execute (QA-1..3 resolvidas — AD-023)
**Decisões aprovadas (usuário/briefing, travadas):** cascata cheap→expensive com limiares em código (decisão 3c) · P1 (camadas 1–3) desbloqueada, judge LLM env-gated (AD-022 d6) · offline/$0 em CI por construção (F21) · config aditiva no state.json (F13 schemaVersion 1) + merge F14 + env `RUNECRAFT_*` (sem superfície nova) · F25 NÃO reescreve F24 — integra aditivamente · escopo `packages/harness` (src/, extensions/, test/; nada de .pi/.guild/claude-auth) · judge fora do merge gate, critérios da spec (faithfulness), nunca auto-avaliação · ancoragem: `complete_goal` session-level + CLI `harness verify` com a MESMA engine pura · **QA-1**: política HARD/SOFT por camada (halt: integrity/sufficiency/cap; skip: structural/embedding/judge) · **QA-2**: suficiência = escopo de arquivos + proporção · **QA-3**: embeddingUnavailable → skip (degraded); grayZoneNoJudge → fail

## Contexto

F24 entregou a prova do mecanismo: no Pi 0.81.0 **só `tool_call` bloqueia** (turn_end/agent_end têm resultados descartados pelo runner); o enforcer de `complete_goal` (todo-continuation-enforcer) é o gate de conclusão; `guardKit.ts` expõe `loadSessionGuards()`, `SessionGuardConfig` (capture/hash), `GUARD_REASON_IDS` e `block()` com kill switch `RUNECRAFT_GUARDS=0` e freeze por sessão. F21 provou a infra de evidência (fixture OpenAI-wire, EVAL-MATRIX v2 aditivo com EVAL-006/007, `evalTest()` → last-run.json) e o fato do auditor do glla ser in-process com tools ⊆ read/grep/find/ls/bash. O arcanum (supersedido — AD-001) contém a fonte do port: `packages/guild/src/hooks/verification-reminder.ts` (prompt "Verification Required": diff/checks/validação de comportamento/gate decision — textualmente "not a kernel-level completion block") e `packages/guild/src/tools/verify-gate.ts` (runner de checks com `{ok, checks[], warnings[]}` e timeout). F25 porta essa semântica para um gate real.

Cadeia: F13/F14 (state/merge) → F24 (guardKit + enforcer complete_goal) + F21 (fixture/evidência) → F25 (engine de verificação) → F23 (ratchet consome a evidência) · F26 formalizará constraint adherence (sujeitos = guards F24) · o judge LLM segue env-gated (padrão F22) até aprovação de custo.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Ancoragem dupla, engine única**: (1) gate de sessão no handler de `complete_goal` do enforcer F24 (aditivo) e (2) comando CLI `harness verify` — ambos chamam a MESMA função pura `runVerificationCascade(input) → Verdict` em `src/verify/engine.ts` | F24 provou que tool_call é o único bloqueio real e que `complete_goal` é o gate de conclusão (o enforcer já hooka lá — zero custo de integração nova); CLI cobre uso manual/CI sem sessão; engine pura = testável unit, determinística, paridade garantida por teste |
| D2 | **5 camadas ordenadas cheap→expensive com short-circuit** (VER-01): 1 estrutural (lint/typecheck/testes) → 2 integridade (guardKit F24) → 3 suficiência (QA-2) → 4 embedding local → 5 judge (só zona cinza). Cada `StageResult = { layer, status: pass\|fail\|degraded, reasonId, suggestion }`; falha em camada barata impede as mais caras | "Cascata explícita e ordenada; cada etapa é MAIS CARA e MAIS PROFUNDA; o que cai no lint não chega no Judge" (doc pillar 3/4); custo mínimo e determinismo |
| D3 | **Camada 2 = herança direta do F24** (VER-03): reusa `loadSessionGuards`/`SessionGuardConfig`; conjunto protegido = domínio do write-guard (arquivos existentes + allow/force), verificação por existência/hash com realpath; reason-id = `GUARD_REASON_IDS` do F24 | "Semântica do write-guard F24" (locked); NENHUMA definição nova de "arquivo protegido" — se o domínio do F24 crescer (ex.: F27), F25 herda automaticamente; evita decisão de produto duplicada |
| D4 | **Embedding = opção (a) determinístico local** (VER-07/08): similaridade cosseno sobre vetores TF de char n-gram (n=3) de spec vs output; implementação pura (Map/hash, zero deps, zero rede), O(\|spec\|+\|output\|). **Única implementação no F25** — opção (b) (API de embedding env-gated) NÃO implementada | (1) offline/$0 por construção é HARD constraint do F21; (2) o judge env-gated já é o caminho caro opcional — embedding pago seria custo sem ganho de decisão (filtro grosso não precisa de semântica profunda); (3) determinismo: mesmo input → mesmo score em qualquer máquina/CI. Reavaliar (b) só se o filtro provar insuficiente (STATE.md Deferred) |
| D5 | **Zona cinza e escalada = código puro** (VER-09): `score ≥ max → pass`, `score ≤ min → fail`, `min < score < max → gray` (boundaries inclusivos, documentados no código); escalada ao judge SÓ com `gray` + env ativo; fora da zona → veredito sem judge | Decisão 3c/AD-022: "a decisão de escalar é SEMPRE código com limiares explícitos calibrados por projeto, nunca a LLM" |
| D6 | **Judge env-gated (padrão F22)** (VER-10): `RUNECRAFT_VERIFY_LLM_JUDGE=1`; off → zero invocação (CI e merge gate F20 são offline por construção); chamada LLM **read-only** (tools ⊆ read/grep/find/ls/bash — padrão do auditor do glla, AD-021; mecanismo exato a validar no Execute: auditor in-process vs RPC pr-review F20); prompt versionado com critérios de **faithfulness derivados da spec** (output cobre o escopo declarado, não inventa, diff coerente) — nunca auto-avaliação; saída JSON estrita `{verdict: pass\|fail, confidence, reasons[]}`; inválida/timeout → fail-closed + contabilizada no cap | Custo de tokens é decisão do usuário (AD-022); o judge não decide escalar nem se avalia; parse estrito mantém determinismo do veredito |
| D7 | **Política RETRY/SKIP/HALT + cost caps** (VER-05): `verification.policy.onFail: Record<layer, "retry"\|"skip"\|"halt">` (defaults = QA-1 recomendado: integrity/sufficiency/cap = halt; structural/embedding/judge = skip) + `retry.maxRuns`; `verification.costCaps = { maxCascadeRuns, maxJudgeCalls, maxJudgeTokens }`; cap esgotado → **HALT sem judge** (reason com contabilidade); custo e veredito por goal (execução) | Doc: "Judge calibrável: limiar de confiança, máximo de retentativas, política RETRY/SKIP/HALT afina por projeto"; guardrails do doc: file integrity, change sufficiency, cost cap — os três são HARD (halt) por default |
| D8 | **Semântica de bloqueio = política por camada** (QA-1): `halt` → `{ block: true, reason }` em `complete_goal` (formato `<verifyId>: <camada> — <motivo>; sugestão`, sem path absoluto/timestamp — normalização F21 D10); `skip` → veredito gravado no state + sugestão no reason de resposta (não bloqueia); `retry` → re-roda até `maxCascadeRuns`. Se o usuário escolher gate estrito (QA-1a), defaults viram halt em todas as camadas | O gate real (não prompt) precisa de bloqueio onde o guardrail é duro; soft onde o sinal é indicativo — decisão de produto, apresentada em QA-1 |
| D9 | **Config aditiva `verification` no state.json** (VER-12): campo `verification?: VerificationConfig` ao lado de `guards` (F24), schemaVersion permanece 1 (precedente F15 T1/F24 D2); merge por overlay F14; kill switch `RUNECRAFT_VERIFY=0` (padrão F20); freeze por sessão (F24 D12); validação determinística (min<max, ≥0, tipos, política conhecida) → inválida = fail-closed com motivo (exit 3 no CLI), isolamento por camada (padrão F24 D10) | Sem superfície nova; state é o contrato do harness; env é o mecanismo de emergência |
| D10 | **CLI `harness verify`** (VER-06): `src/commands/verify.ts` no padrão F11 dispatch; `--json`, `--cwd`, escopo default = repo atual (ou goal ativo via ledger F19 — validar no Execute); output = diff do working tree (CLI não tem mensagem de goal); exit codes: 0 pass (incl. skip com warning), 1 fail, 2 halt (cap/zona cinza sem judge `halt`), 3 infra/config inválida; report `{ok, checks[], warnings[]}` no shape do verify-gate do arcanum; judge nunca sem env | Caminho manual/CI determinístico; reusa o shape já validado no arcanum; paridade com a sessão por teste |
| D11 | **Integração aditiva no enforcer F24** (VER-01): o handler de `complete_goal` do todo-continuation-enforcer chama `runVerificationCascade` DEPOIS do check de pendências (F24) e só se o F24 não bloqueou — um único ponto de registro, ordem determinística (pendências primeiro, depois verificação); NÃO há extensão nova (verify/ é biblioteca consumida pelo enforcer e pelo CLI) | Evita risco de ordem entre handlers de extensão (Pi 0.81.0); F24 é o gate mais barato/duro (integridade do goal flow) — bloqueou, não gasta a cascata |
| D12 | **Port verification-reminder/verify-gate** (VER-11): mapeamento documentado (tabela abaixo); as sugestões acionáveis da cascata carregam o conteúdo semântico do reminder do arcanum (1. diff/stat, 2. checks, 3. validação de comportamento, 4. gate decision) como reason estruturado por camada; fonte recuperada do checkout arcanum (T11) — sem fabricação; `verify-gate` vira o shape de checks do CLI e o runner da camada 1 | "Port de verification-reminder → gate de verificação real (no OpenCode era texto de prompt; no Pi vira gate)" |
| D13 | **Evals e evidência** (VER-13): EVAL-008 (cascata sessão: lint quebrado → short-circuit + veredito), EVAL-009 (integridade + suficiência: block HARD), EVAL-010 (zona cinza + degrade + kill switch), EVAL-011 (CLI exit codes) — EVAL-MATRIX v3 aditivo (política F21 D9, bump MATRIX_VERSION); testes determinísticos em `test/verify/` na infra F21; evidência via `evalTest()` → last-run.json (F23); sem regressão nos 398 do F24 | Mesmo contrato de evidência do F21/F24; ratchet do F23 cobre por identidade estável |

## Arquitetura — módulos

```
packages/harness/
├── src/
│   └── verify/
│       ├── engine.ts           # runVerificationCascade(input) → Verdict (D1/D2/D5) — pura, sem rede;
│       │                       #   input = { config congelado, spec, output, diff, repoState, env }
│       ├── config.ts           # VerificationConfig: schema, validação fail-closed, freeze (D9),
│       │                       #   kill switch RUNECRAFT_VERIFY, defaults (QA-1/Q-3)
│       ├── verdict.ts          # StageResult/Verdict/PolicyResolution (retry|skip|halt),
│       │                       #   boundaries min/max inclusivos (D5/D8)
│       ├── cost.ts             # CostLedger por execução: cascadeRuns/judgeCalls/judgeTokens → cap → HALT (D7)
│       ├── suggestions.ts      # reason + sugestões acionáveis (port verification-reminder, D12)
│       └── stages/
│           ├── structural.ts   # camada 1: scripts do repo (lint/typecheck/test) com timeout (VER-02)
│           ├── integrity.ts    # camada 2: guardKit F24 — existência/hash/realpath, reason-id F24 (VER-03)
│           ├── sufficiency.ts  # camada 3: escopo de arquivos + proporção (QA-2) (VER-04)
│           ├── embedding.ts    # camada 4: char n-gram TF + cosseno, local, determinístico (VER-07/08)
│           └── judge.ts        # camada 5: env-gated, prompt de faithfulness versionado, parse estrito (VER-09/10)
│   ├── commands/verify.ts      # CLI harness verify (D10, VER-06)
│   └── guards/todo-continuation-enforcer.ts  # + chamada à cascata no branch complete_goal (D11, aditivo)
├── test/
│   ├── EVAL-MATRIX.md          # v3: + EVAL-008..011 (D13)
│   └── verify/
│       ├── setup.ts            # preload env isolado (padrão F21 D3 / F24 T7)
│       ├── engine.test.ts      # ordem/short-circuit/verdicts/boundaries/paridade sessão↔CLI (VER-01/05/09)
│       ├── stages.test.ts      # unit por camada com fakes (VER-02/03/04/07/08/10)
│       ├── config.test.ts      # validação fail-closed/freeze/kill switch (VER-12)
│       ├── cli.test.ts         # exit codes 0/1/2/3 + --json (VER-06)
│       └── cascade-eval.test.ts# integração EVAL-008..011 na fixture F21 (VER-13)
└── package.json                # test: "bun test test/verify test/guards test/eval" (mesma lane F21)
```

## Fluxos

### F1 — Gate de sessão (complete_goal)

```
1. tool_call(complete_goal) → handler do enforcer F24
2. F24: pendências no ledger (.pi-glla/active.jsonl)? → block (F24); senão segue
3. kill switch RUNECRAFT_VERIFY=0? → cascata inativa (retorna sem veredito)
4. runVerificationCascade({ config congelado (D9), spec = goal description + taskList (ledger F19),
     output = payload do complete_goal / última mensagem do assistant (validar no Execute),
     diff = git diff desde o início do goal, repoState, env })
5. camada 1 (structural): scripts do repo; fail → StageResult com sugestão → short-circuit
6. camada 2 (integrity): guardKit F24 (existência/hash/realpath) → fail com reason-id F24
7. camada 3 (sufficiency): escopo de arquivos + proporção (QA-2) → empty/oversized/scope-violation
8. camada 4 (embedding): score → pass/fail/gray (boundaries D5); sem spec/indisponível → degrade (QA-3)
9. gray + RUNECRAFT_VERIFY_LLM_JUDGE=1? → camada 5 (judge, critérios da spec); gray sem env → grayZoneNoJudge
10. Verdict → política (D7/D8): halt → { block: true, reason: "<verifyId>: <camada> — <motivo>; sugestão" };
    skip → veredito gravado no state + reason de resposta; retry → re-roda até maxCascadeRuns (cap D7)
11. transcript registra reason estável (sem $TMP/$TS — F21 D10); evidência evalTest() quando em teste
```

### F2 — CLI / CI (harness verify)

```
1. dispatch (F11) → commands/verify.ts
2. mesmo runVerificationCascade com output = diff do working tree (--cwd), escopo = repo/goal ativo
3. exit: 0 pass · 1 fail · 2 halt · 3 config/infra inválida; --json = {ok, checks[], warnings[], verdict}
4. judge nunca roda sem env (CI: env off por construção — merge gate F20 não invoca o CLI com env)
```

### F3 — Custo (cap por execução)

```
cost.ts: ledger por goal — maxCascadeRuns (retries), maxJudgeCalls, maxJudgeTokens;
qualquer cap esgotado → HALT (block/exit 2) com reason de contabilidade; judge nunca é chamado após o cap
```

### F4 — Evals (EVAL-008..011)

```
fixture F21 (chatServer + agentDir temp) → sessão Pi real → script induz falha por camada →
transcript + veredito; evidência via evalTest() → partial/*.jsonl → last-run.json (F23);
adversarial: política alterada no config → falha com diagnóstico (padrão F24 T7)
```

## Mapeamento verification-reminder / verify-gate → feature

| Arcanum (guild, OpenCode) | F25 (harness, Pi) | Onde |
| --- | --- | --- |
| `verification-reminder` (hook de prompt — "strong persistent prompt injection, not a kernel-level completion block") | Gate real: veredito + sugestão acionável estruturada; o conteúdo semântico do prompt (diff/checks/validação de comportamento/gate decision) vira `suggestions.ts` por camada | D12, T11, VER-11 |
| `verify-gate` (tool com `{ok, checks[], warnings[]}`, exec com timeout) | Runner da camada 1 (structural) + shape de report do CLI `--json` | D10/D12, T3/T10, VER-02/06 |
| (sem enforcement no OpenCode — aviso ignorável) | Bloqueio HARD via `{block:true}` em complete_goal (política halt) + cost caps → HALT | D7/D8, F1, VER-05 |
| (security gate Paladin do reminder) | Fora do F25 (papéis F32; não inventar gate de segurança agora) | Out of Scope |

Fonte recuperada do checkout `~/Projects/arcanum` (T11 recupera/cita no docs; sem fabricação).

## EVAL-MATRIX — entradas aditivas (política F21 D9)

| ID | Fluxo | Ferramentas | Script esperado | Notas |
| --- | --- | --- | --- | --- |
| EVAL-008 | cascata sessão: lint quebrado no complete_goal | verify (structural) | 1. sessão com cascade on; 2. modelo escreve código com lint quebrado; 3. complete_goal → veredito estrutural com sugestão (SOFT, sem block se política skip); 4. corrige → passa | short-circuit: camadas 2+ não rodam (spy) |
| EVAL-009 | integridade + suficiência | verify (integrity/sufficiency) | 1. modelo toca arquivo protegido → veredito integridade (reason F24) + block (halt); 2. diff vazio → empty; 3. diff gigante → oversized (sem block por padrão — QA-1) | reason estável (normalização F21) |
| EVAL-010 | zona cinza + degrade + kill switch | verify (embedding + judge) | 1. output infiel → fail (≤min) sem judge; 2. gray sem env → grayZoneNoJudge (default fail); 3. env=1 + gray → judge chamado (fake LLM) com critérios da spec; 4. RUNECRAFT_VERIFY=0 → inerte | judge nunca em CI; spy de chamadas |
| EVAL-011 | CLI verify exit codes | commands/verify | 1. repo limpo → 0; 2. lint quebrado → 1; 3. halt/cap → 2; 4. config inválida → 3; 5. --json shape {ok, checks[], warnings[]} | paridade com veredito de sessão (mesma engine) |

## Integração CI

- **Roda com**: mesma lane do F21/F24 — `turbo test` → `bun test test/verify test/guards test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); judge NUNCA presente (env off por construção)
- **Evidência**: `evalTest()` grava nos mesmos `partial/*.jsonl`; merge F21 inclui os novos checks automaticamente; ratchet F23 cobre
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)
- **CLI verify no CI do usuário**: documentado como uso externo (exit codes); o harness CI usa os testes, não o CLI

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Fonte do verification-reminder indisponível no monorepo** | Não existe aqui (arcanum supersedido — AD-001); fonte lida do checkout `~/Projects/arcanum` e citada no docs (T11); fallback: mapeamento semântico documentado — NUNCA fabricar texto |
| **Payload do complete_goal do glla (o que é "output" da sessão)** | Validar no Execute (ledger/assinatura da tool); fallback: última mensagem do assistant + diff desde o início do goal; testes não dependem do shape exato (abstração `output`) |
| **Comandos da camada 1 (lint/typecheck/test) variam por repo** | Defaults = scripts detectados no package.json do repo (lint/typecheck/test); override `verification.structural.commands`; timeout por comando (padrão verify-gate do arcanum) |
| **Mecanismo de chamada do judge no harness** | Validar no Execute: auditor do glla in-process (AD-021) vs RPC pr-review (F20); judge read-only (tools ⊆ read/grep/find/ls/bash); fake LLM nos testes |
| **Determinismo numérico do embedding (float)** | Scores arredondados (4 casas); boundaries inclusivos; testes com tolerância documentada |
| **Config inválida derruba a cascata inteira** | D9 (isolamento por camada, padrão F24 D10); validação determinística; doctor reporta; fail-closed |
| **Defaults de zona cinza geram fricção no CI** | QA-3 decide; defaults recomendados `grayZoneNoJudge: fail` (honesto) — ajustável por projeto sem código |
| **Dois handlers de complete_goal** | D11: um único ponto (enforcer F24 chama a cascata) — ordem determinística; sem extensão nova |
| **Ordem de handlers de extensão no SDK** | Evitada por construção (D11 — a cascata é biblioteca, não handler separado) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| VER-01 | P1: Cascata ordenada + short-circuit | D1/D2 + engine.ts + F1/F2 + engine.test.ts |
| VER-02 | P1: Camada 1 estrutural | D12 + stages/structural.ts + EVAL-008 |
| VER-03 | P1: Camada 2 integridade | D3 + stages/integrity.ts (guardKit F24) + EVAL-009 |
| VER-04 | P1: Camada 3 suficiência | QA-2 + stages/sufficiency.ts + EVAL-009 |
| VER-05 | P1: Política + cost caps | D7/D8 + verdict.ts/cost.ts + F1/F3 |
| VER-06 | P1: CLI harness verify | D10 + commands/verify.ts + EVAL-011 |
| VER-07 | P2: Embedding local determinístico | D4/D5 + stages/embedding.ts + EVAL-010 |
| VER-08 | P2: Degrade determinístico | D9 (degrade) + stages/embedding.ts + config.test.ts |
| VER-09 | P3: Escalada só na zona cinza (código) | D5 + engine.ts (gray gate) + EVAL-010 |
| VER-10 | P3: Judge env-gated, critérios da spec | D6 + stages/judge.ts + EVAL-010 |
| VER-11 | P3: Port reminder/verify-gate | D12 + suggestions.ts + T11 (docs) |
| VER-12 | P1/P3: Config aditiva + validação + freeze | D9 + config.ts + state.ts + config.test.ts |
| VER-13 | P1/P2/P3: Evals + evidência | D13 + test/verify/ + EVAL-MATRIX v3 |

**Cobertura:** 13/13 mapeados. Edges da spec: boundaries min/max → D5/engine.test · diff vazio → sufficiency (empty) · sem spec/indisponível → D9 degrade · zona cinza sem env → QA-3 · cap exato/timeout judge → cost.ts · symlink → integrity (realpath, padrão F24) · config mid-session → D9 freeze · multi-goal → cap por execução · output ausente → fallback transcript+diff (validar no Execute).

**Pontos a validar no Execute** (consolidado): payload do `complete_goal` do glla (shape do "output"); scripts reais de lint/typecheck/test no package.json do harness/repos (defaults da camada 1); mecanismo de chamada do judge (auditor in-process vs RPC pr-review); escopo default do CLI (repo vs goal ativo via ledger F19); se `SessionGuardConfig` expõe hash de arquivos protegidos para a camada 2 ou se a camada 2 re-captura no momento da verificação; comportamento do `block` no handler composto (pendências F24 + cascata) no SDK 0.81.0.

## Open questions para o usuário (QA-1..QA-3 — necessárias antes do Execute)

1. **QA-1 — Semântica de bloqueio da cascata em sessão (D8)**
   - (a) **Gate estrito**: toda falha de qualquer camada (e judge-fail) bloqueia `complete_goal` — "gate real" no sentido mais forte
   - (b) **Recomendado — HARD/SOFT por política**: defaults `integrity/sufficiency = halt` (bloqueia), `structural/embedding/judge = skip` (veredito + sugestão); configurável por camada — alinha com os guardrails do doc (file integrity, change sufficiency, cost cap) e evita fricção de ruído indicativo
   - (c) **Detect-only em sessão**: nada bloqueia; veredito vai ao state; enforcement só no CLI/CI (exit codes)
2. **QA-2 — Critério exato de suficiência de mudança (camada 3, VER-04)**
   - (a) **Recomendado — composto**: (i) escopo de arquivos — todo arquivo tocado ∈ escopo do goal (senão `scope-violation`); (ii) proporção — `added+deleted tokens ∈ [minRatio, maxRatio] × |spec|` (senão `empty`/`oversized`)
   - (b) Só proporção de tamanho (diff ∝ escopo literal)
   - (c) Só escopo de arquivos
   - (d) Overlap de conteúdo diff↔spec (mais caro; redundante com a camada 4)
3. **QA-3 — Comportamento degradado (VER-08)**
   - (a) **Recomendado — políticas explícitas**: `embeddingUnavailable: "skip"` (veredito `degraded` registrado; sem essa evidência não é violação) e `grayZoneNoJudge: "fail"` (fail-closed: CI não certifica caso duvidoso sem judge — exit 1); ambas configuráveis {skip, fail, halt}
   - (b) Fail-closed rígido: indisponibilidade e zona-cinza-sem-judge sempre falham
   - (c) Pass-through: ambos viram skip/pass com warning (mais fluido, menos honesto)

**Nota:** limiares iniciais (embedding min/max e sufficiency min/maxRatio) entram como defaults documentados e calibrados por projeto manualmente no v1 (tooling de calibração = candidato futuro); valores exatos são decisão de configuração, não de produto — marcados como "validar no Execute" com os defaults propostos.
