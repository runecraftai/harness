# F25 — Verification Cascade (determinismo de saída) Specification

**Scope:** Large (multi-component: engine puro de verificação + integração session-level no `complete_goal` + CLI `harness verify` + evals/matriz/evidência)
**Prereq:** F24 ✓ (guards, enforcer de `complete_goal`, guardKit, kill switch, freeze por sessão), F21 ✓ (fixture OpenAI-wire, materialização de extensões, EVAL-MATRIX v2, evidência JSON), F20 ✓ (padrão fail-closed + kill switch), F13/F14 ✓ (state/merge), F19 ✓ (ledger do glla/ROUTING)
**Grupo:** M7 — Garantias (pilares 3–7; F25 = determinismo de **saída** — decisão 3c do briefing + AD-022 d6)

## Problem Statement

O harness hoje garante **assets** (F11–F20) e a **execução** dentro da sessão (F24: bloqueio real de `tool_call` via `{ block: true }`). Mas a **saída** não é verificada: um goal pode ser concluído com diff desproporcional ao escopo, arquivos protegidos alterados que escaparam do write-guard, ou resultado infiel à spec — e nada verifica antes da conclusão. No OpenCode o guild mitigava com `verification-reminder`, um **aviso de texto injetado no prompt** (verificado no arcanum: "This is a strong persistent prompt injection, not a kernel-level completion block" — a LLM pode ignorar; `verify-gate` rodava comandos e reportava `{ok, checks[], warnings[]}` sem enforcement). No Pi, o mesmo padrão do F24 se aplica: o que era prompt vira **mecanismo**. F25 implementa a cascata de verificação cheap→expensive com **limiares explícitos em código** (decisão 3c; AD-022 d6): estrutural → integridade de arquivo → suficiência de mudança → fidelidade de embedding (filtro grosso) → zona cinza → judge LLM **só** na zona cinza, env-gated, fora do merge gate. A decisão de escalar é **sempre código** (limiares min/max calibrados por projeto), nunca a LLM; política RETRY/SKIP/HALT e cost caps por execução; cap esgotado → HALT sem judge. Offline/$0 em CI por construção (princípio F21).

## Goals

- [ ] Cascata ordenada cheap→expensive com short-circuit: cada etapa é MAIS CARA e MAIS PROFUNDA; o que cai no lint não chega ao judge; falha classificada com **sugestão acionável**
- [ ] Escalação para o judge LLM **somente** na zona cinza entre limiares min/max; fora da zona aprova/reprova sem judge; **decisão de escalar = código** com limiares explícitos calibrados por projeto (decisão 3c)
- [ ] Política RETRY/SKIP/HALT configurável por projeto; cost caps por execução; cap esgotado → HALT sem judge
- [ ] P1 (camadas 1–3: estrutural, integridade, suficiência) totalmente offline/$0; judge LLM env-gated (`RUNECRAFT_VERIFY_LLM_JUDGE=1`, padrão F22); CI e merge gate (F20) nunca chamam judge
- [ ] Port de `verification-reminder`/`verify-gate` do arcanum → gate real de verificação (o que era texto de prompt vira veredito + sugestão estruturada)
- [ ] Embedding = filtro grosso **local determinístico** (similaridade TF/char-n-gram, sem rede, sem custo); API de embedding fora do F25
- [ ] Evals EVAL-008+ aditivos (EVAL-MATRIX v3) + testes determinísticos na infra F21 + evidência JSON para o ratchet do F23

## Out of Scope

| Feature | Reason |
| --- | --- |
| Correção automática de falhas (auto-fix) | F25 é gate/classificação; a sugestão é acionável, o reparo é do agente/usuário (auto-fix = candidato futuro) |
| Judge LLM em CI ou no merge gate (F20) | env-gated por construção (padrão F22, decisão 3c); CI é offline/$0 (princípio F21) |
| API de embedding paga (opção b) | Decidido no design D4: filtro grosso local determinístico cobre o propósito; reavaliar só se provar insuficiente (Deferred Ideas) |
| Reescrever/integrar F24 | F25 integra **aditivamente**: reusa guardKit (camada 2) e o handler de `complete_goal` do enforcer; denial continua sendo o único bloqueio real de tool |
| Auto-calibração de limiares (tooling) | Calibração por projeto é manual no v1 (editar config); tooling de calibração = candidato futuro (registrado no STATE.md) |
| Verificação de agentes não-Pi | Extensões são Pi-only (matriz F17 honesta); o CLI `harness verify` roda em qualquer repo (caminho CI/manual), mas o gate de sessão é Pi |
| packages/guild, .pi/, packages/claude-auth/ | Arcanum está supersedido (AD-001); o port é **semântico** (prompt → gate); fonte recuperada do checkout arcanum apenas para mapeamento (T11) |
| Config nova (arquivo próprio de verificação) | Reusa state.json aditivo (`verification`, F13 schemaVersion 1) + merge F14 + env `RUNECRAFT_*`; sem superfície nova |

## Gray area (resolver antes do Execute — 3 decisões do usuário)

O escopo de F25 está travado (decisões do briefing + AD-022 d6 + infra F24/F21). Três pontos de **produto** permanecem abertos — apresentados com opções e recomendação no design (QA-1..QA-3); o Execute NÃO começa sem as respostas:

- **QA-1 — Semântica de bloqueio da cascata em sessão**: o que acontece quando a cascata falha no `complete_goal`? (a) gate estrito (toda falha bloqueia) · (b) **recomendado** — HARD/SOFT por camada via política (integridade/suficiência/cap = HALT bloqueia; estrutural/embedding/judge = veredito + sugestão) · (c) detect-only em sessão (enforcement só no CLI/CI)
- **QA-2 — Critério exato de "suficiência de mudança" (camada 3)**: (a) **recomendado** — composto: escopo de arquivos (todo arquivo tocado ∈ escopo do goal) + proporção de tamanho (`added+deleted ∈ [minRatio,maxRatio] × |spec|`) · (b) só proporção · (c) só escopo de arquivos · (d) overlap de conteúdo diff↔spec (redundante com a camada 4)
- **QA-3 — Comportamento degradado**: camada 4 indisponível / zona cinza sem judge: (a) **recomendado** — políticas explícitas com defaults `embeddingUnavailable: "skip"` (veredito degraded registrado) e `grayZoneNoJudge: "fail"` (fail-closed: CI não certifica caso duvidoso sem judge) · (b) fail-closed rígido (ambos sempre falham) · (c) pass-through (ambos viram skip/warning)

**Já decidido (não é gray area):** "arquivo protegido" na camada 2 = domínio do write-guard do F24 (herda semântica de existência/hash/realpath e o reason-id; sem definição nova); "escalar é código" (decisão 3c); judge env-gated e fora do merge gate; embedding offline; config aditiva; escopo `packages/harness`.

## User Stories

### P1: Cascata determinística offline (camadas 1–3) ⭐ MVP

**User Story**: Como mantenedor, quero que a conclusão de um goal seja verificada por uma cascata determinística (estrutural → integridade → suficiência) com limiares em código e short-circuit, para que saída fora de forma seja classificada com sugestão acionável — sem LLM e sem custo.

**Why P1**: É a fatia desbloqueada pelo AD-022 d6 (código puro) e o coração do pilar de determinismo de saída.

**Acceptance Criteria**:

1. WHEN `complete_goal` é chamado THEN a cascata roda na ordem 1 → 2 → 3 (→ 4 → 5 se configurada) e a primeira falha short-circuita (camadas posteriores não rodam)
2. WHEN a camada 1 falha (lint/typecheck/testes) THEN o veredito classifica a falha com sugestão acionável (comando/arquivo) e as camadas 2+ não rodam
3. WHEN a camada 2 detecta alteração em arquivo protegido THEN o veredito de integridade reusa a semântica do write-guard F24 (existência/hash, realpath) e o reason-id do F24
4. WHEN a camada 3 detecta diff fora dos limiares THEN o veredito classifica em `empty`/`oversized`/`scope-violation` (critério QA-2)
5. WHEN a política do veredito é `halt` (default: integridade/suficiência/cap) THEN `complete_goal` SHALL ser bloqueado com reason classificado (semântica QA-1)
6. WHEN o cap de custo esgota THEN HALT sem judge (o judge nunca roda depois do cap)

**Independent Test**: sessão Pi com fixture F21 → script induz lint quebrado → veredito estrutural com sugestão (sem block); toca arquivo protegido → veredito de integridade com reason F24 (block); diff vazio → veredito `empty`; diff gigante → `oversized`.

### P1: Política e custo (RETRY/SKIP/HALT + cost caps)

**User Story**: Como mantenedor, quero afinar a cascata por projeto (política RETRY/SKIP/HALT, cost caps por execução), para que o comportamento de falha seja previsível e o custo limitado.

**Why P1**: O doc do usuário pede "Judge calibrável: limiar de confiança, máximo de retentativas, política RETRY/SKIP/HALT afina por projeto" e "cost cap por execução" como guardrail.

**Acceptance Criteria**:

1. WHEN a política de uma camada é `retry` THEN a cascata re-roda (até `maxCascadeRuns`) antes do veredito final
2. WHEN a política é `skip` THEN a falha é registrada (veredito + sugestão) e a cascata segue/termina sem bloqueio
3. WHEN a política é `halt` (ou o cap esgotou) THEN `complete_goal` SHALL ser bloqueado com reason nomeando camada + contabilidade
4. WHEN `maxJudgeCalls`/`maxJudgeTokens` esgotam THEN o judge não é mais chamado e o veredito vira HALT com reason de custo
5. WHEN `RUNECRAFT_VERIFY=0` THEN a cascata SHALL estar inativa (sessão e CLI) — kill switch (padrão F20)

**Independent Test**: fixture → política `halt` na camada 1 bloqueia; `skip` registra e passa; cap de judge esgotado → HALT sem chamada ao judge (spy); kill switch → sessão sem verificação.

### P1: CLI `harness verify` (mesma engine, uso manual/CI)

**User Story**: Como mantenedor, quero rodar a MESMA cascata via CLI (`harness verify`) com exit codes determinísticos, para usar manualmente e no CI sem sessão Pi.

**Why P1**: O ponto de ancoragem é duplo (decisão do usuário): gate de sessão em `complete_goal` + CLI para uso manual/CI — a engine pura é compartilhada e testável.

**Acceptance Criteria**:

1. WHEN `harness verify` roda THEN usa a MESMA `runVerificationCascade` do gate de sessão (paridade testada)
2. WHEN tudo passa THEN exit code 0; falha → 1; zona cinza sem judge (`grayZoneNoJudge: fail`) → 1; HALT/cap → 2; config inválida → 3 (com motivo)
3. WHEN `--json` THEN o report segue o shape de checks (`verify-gate` do arcanum: `{ok, checks[], warnings[]}` + veredito)
4. WHEN `RUNECRAFT_VERIFY=0` THEN o CLI reporta inativo e sai 0 (kill switch)

**Independent Test**: repo fixture → lint quebrado → exit 1; repo limpo → 0; config com min>max → 3; paridade com o veredito de sessão no mesmo repo.

### P2: Embedding local (camada 4) — filtro grosso determinístico

**User Story**: Como mantenedor, quero que a fidelidade spec↔saída seja estimada por similaridade determinística local (char n-gram/TF, sem rede), para filtrar grosso: claramente fiel passa, claramente infiel falha, dúvida vai para a zona cinza — "quase de graça".

**Why P2**: Pillar 3/4 do doc: "Embedding é o filtro grosso, quase de graça... Só casos duvidosos escalam pro juiz caro".

**Acceptance Criteria**:

1. WHEN `score ≥ max` THEN a camada 4 aprova (pass) sem judge
2. WHEN `score ≤ min` THEN a camada 4 reprova (fail) sem judge
3. WHEN `min < score < max` THEN zona cinza → escalada SÓ se `RUNECRAFT_VERIFY_LLM_JUDGE=1`; senão política `grayZoneNoJudge` (default fail — QA-3)
4. WHEN não há spec (repo/sem goal com spec) ou o cálculo está indisponível THEN política `embeddingUnavailable` (default skip + veredito `degraded` registrado)
5. WHEN a camada 4 roda THEN é offline, determinística e sem rede (mesmo input → mesmo score, tolerância documentada)

**Independent Test**: unit — spec vs output fiel → pass; output desconexo → fail; casos no meio → gray; spec ausente → degraded; stub de rede que falharia se fosse usado.

### P3: Judge LLM env-gated (zona cinza)

**User Story**: Como usuário, quero que apenas casos da zona cinza cheguem ao judge (caro), controlado por env e fora do merge gate, com critérios derivados da spec — para custo zero em CI e escalada sempre decidida por código.

**Why P3**: Decisão 3c + AD-022 d6: a decisão de escalar é SEMPRE código; o judge nunca decide escalar nem se auto-avalia.

**Acceptance Criteria**:

1. WHEN o veredito da camada 4 é `gray` E `RUNECRAFT_VERIFY_LLM_JUDGE=1` THEN o judge roda com (spec, output, diff) e critérios de **faithfulness** derivados da spec (nunca auto-avaliação)
2. WHEN o env está ausente/≠1 THEN o judge NUNCA roda (nem em CI, nem em sessão; verificado por spy)
3. WHEN o judge responde THEN veredito = `pass|fail` com `confidence` e razões; resposta inválida/timeout → fail-closed com reason, contabilizada no cap
4. WHEN o merge gate F20 roda (pre-commit/pre-push) THEN a verificação é 100% offline (o judge nunca está presente)

**Independent Test**: unit com fake LLM — env off → zero chamadas; env on + gray → chamada com a spec no prompt e critérios de faithfulness; JSON inválido → fail-closed; CI simulado (env off) → nenhuma chamada de rede.

### P3: Port `verification-reminder`/`verify-gate` + config + evidência

**User Story**: Como mantenedor, quero que o verification-reminder do arcanum vire um gate real (não prompt), configurado via state.json aditivo, com evidência para o ratchet do F23.

**Why P3**: É a tese do F24 aplicada à saída; fecha o loop de evidência (F21 → F23).

**Acceptance Criteria**:

1. WHEN uma falha é classificada THEN a sugestão acionável cobre o conteúdo semântico do `verification-reminder` do arcanum (diff/checks/validação de comportamento — o que era texto de prompt vira reason estruturado; ver D12/T11)
2. WHEN o config `verification` é inválido (ex.: `min ≥ max`, tipos errados, política desconhecida) THEN a validação determinística rejeita com motivo e a cascata opera fail-closed (padrão F24 D10, isolamento por camada)
3. WHEN o config muda no meio da sessão THEN a cascata usa o config congelado do início (padrão F24 D12)
4. WHEN um eval de cascata roda THEN a evidência JSON é gravada via `evalTest()` (F21 D10) e há entrada EVAL-008+ na EVAL-MATRIX v3
5. WHEN `status --json`/`doctor` rodam THEN há seção/check de verificação (estado, limiares, env do judge — informativo)

**Independent Test**: fixture → config inválida → doctor reporta + cascata fail-closed; evidência no last-run.json; EVAL-008..011 na matriz ↔ testes (consistência).

## Edge Cases

- WHEN `min ≥ max` ou limiares negativos/não-numéricos THEN validação rejeita com motivo (fail-closed, exit 3 no CLI)
- WHEN o diff está vazio (nenhuma mudança) THEN camada 3 classifica `empty` (sugestão: mudança ausente) — determinístico
- WHEN o repo/goal não tem spec THEN camada 4 degrada (`degraded` registrado) e as camadas 1–3 seguem
- WHEN a camada 4 está indisponível THEN política `embeddingUnavailable` (default skip + degraded)
- WHEN a zona cinza ocorre sem judge (CI, env off) THEN política `grayZoneNoJudge` (default fail — fail-closed honesto)
- WHEN `score == min` ou `score == max` THEN boundaries determinísticos: `≥ max` passa, `≤ min` falha (inclusivos, documentados no código)
- WHEN o cap esgota exatamente no limite / judge dá timeout THEN HALT sem judge, reason com contabilidade
- WHEN o judge responde fora do schema (JSON inválido) THEN fail-closed + contabilizado no cap
- WHEN um arquivo protegido é symlink THEN realpath antes da checagem (padrão F24)
- WHEN o config muda no meio da sessão THEN congelado no `session_start` (F24 D12) — sem drift mid-turn
- WHEN há múltiplos goals na mesma sessão THEN veredito e custo são por goal (cap por execução)
- WHEN `complete_goal` não carrega mensagem de saída THEN output = última mensagem do assistant no transcript + diff desde o início do goal (fallback a validar no Execute)
- WHEN dois handlers de `complete_goal` existem (F24 + cascata) THEN ordem determinística: pendências do F24 primeiro, cascata só se o F24 não bloqueou (D11)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| VER-01 | P1: Cascata ordenada 1→2→3→4→5 com short-circuit; camada cara nunca roda após falha de barata | Design | Pending |
| VER-02 | P1: Camada 1 estrutural offline determinística; falha classificada com sugestão acionável | Design | Pending |
| VER-03 | P1: Camada 2 integridade = semântica write-guard F24 (existência/hash/realpath, reason-id F24) | Design | Pending |
| VER-04 | P1: Camada 3 suficiência com limiares explícitos (QA-2); classificação empty/oversized/scope-violation | Design | Pending |
| VER-05 | P1: Política RETRY/SKIP/HALT configurável; HALT bloqueia; cost cap → HALT sem judge | Design | Pending |
| VER-06 | P1: CLI `harness verify` = mesma engine; exit codes determinísticos; kill switch `RUNECRAFT_VERIFY=0` | Design | Pending |
| VER-07 | P2: Camada 4 embedding local determinístico offline; min/max → fail/pass; entre → gray; boundaries inclusivos | Design | Pending |
| VER-08 | P2: Degrade determinístico (sem spec/indisponível) com veredito degraded registrado | Design | Pending |
| VER-09 | P3: Escalada SÓ na zona cinza; decisão de escalar = código com limiares (nunca a LLM) | Design | Pending |
| VER-10 | P3: Judge env-gated `RUNECRAFT_VERIFY_LLM_JUDGE=1`; fora do merge gate/CI; critérios da spec (faithfulness), nunca auto-avaliação; veredito + confidence | Design | Pending |
| VER-11 | P3: Port verification-reminder/verify-gate → gate real com sugestões acionáveis; mapeamento documentado | Design | Pending |
| VER-12 | P1/P3: Config aditiva `verification` no state.json (schemaVersion 1, merge F14); validação fail-closed; freeze por sessão; sem superfície nova | Design | Pending |
| VER-13 | P1/P2/P3: Evals EVAL-008..011 aditivos (EVAL-MATRIX v3) + testes determinísticos (F21) + evidência JSON p/ F23 | Design | Pending |

**Coverage:** 13 total, 0 mapeados, 13 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Cascata roda 1→2→3→4→(5) com short-circuit em sessão Pi real (fixture F21) e via CLI — MESMA engine pura, paridade testada
- [ ] P1 (camadas 1–3) 100% offline/$0 por construção, verificado em CI (lane F21)
- [ ] Decisão de escalada = código (limiares min/max explícitos + zona cinza); judge nunca decide escalar; fora da zona aprova/reprova sem judge
- [ ] Judge só na zona cinza com `RUNECRAFT_VERIFY_LLM_JUDGE=1`; CI e merge gate nunca chamam judge; cap → HALT sem judge
- [ ] Mapeamento verification-reminder/verify-gate → feature documentado com fonte real do arcanum (sem fabricação)
- [ ] EVAL-008..011 na EVAL-MATRIX v3; evidência JSON no last-run.json (F23); sem regressão nos 398 testes do F24
- [ ] Config aditiva `verification` validada fail-closed, freeze por sessão, kill switch `RUNECRAFT_VERIFY=0`; doctor/status honestos
