# F22 Design — Cenários E2E Versionados (benchmark com modelos reais)

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** frequência manual sob demanda (`RUNECRAFT_E2E=1 bun run eval:e2e`) + obrigatório antes de tag de release (F9) · resultados em `.specs/features/f22-e2e-benchmark/results/<versão-do-harness>/<data>.json` (local fixo da spec — não muda) · env-gating via `RUNECRAFT_E2E` (padrão gentle-ai `GENTLE_AI_REAL_AGENT_E2E=1`; CI normal fica verde sem tokens) · `fail (infra)` (modelo indisponível/rate limit) ≠ `fail (harness)` — infra não conta como regressão no F23 · local do runner: `scripts/eval-e2e/` no root (decisão do gray area da F21) · modelo barato haiku-class por rodada (decisão F7)

## Contexto

O F7 provou coexistência **1x** (cenários em `scenarios.md`); o F21 prova orquestração com modelo fakeado (fixture OpenAI-wire, zero tokens, CI). Falta a terceira camada do grupo EVAL (AD-010): cenários do F7 com **modelos reais** rodando de forma reproduzível e versionada — resultados datados por versão do harness para que mudanças de prompts/templates tenham evidência de impacto, e o F23 meça não-regressão. Padrão gentle-ai (verificado 2026-08-05): E2E com agente real + fixture gated por env, custo alto (~15 min), fora do merge gate, CI matrix dedicada.

Cadeia: F7 entrega os cenários (IDs estáveis `COEX-01..06`); F19 define o hello world SDLC (goal com "Done when" → dispatch → auditor isolado com evidência → review → ciclo fecha) como cenário de sanity; F21 entrega a infra de sessão headless (SDK: `runPrintMode`/`runRpcMode`, `--mode rpc`); F23 consome os resultados (pass rate por versão, fail-only-on-worse). F22 fecha o loop: `scenarios.md` vira benchmark executável.

**Estado dos insumos (verificado 2026-08-05):** `scenarios.md` do F7 **ainda não existe** (Execute do F7 pendente; placeholder COEX-05) — o runner usa os IDs e passos da spec do F7 como contrato estável; o alinhamento fino com `scenarios.md` acontece no Execute do F22 — **F7 é prereq** (spec F22): o scenarios.md fecha antes; a primeira rodada F22 usa o resultado do F7 (revisão 2026-08-05 — M5). `packages/harness/` (umbrella, F6) ainda não existe — a fonte da `harnessVersion` vive lá quando criado.

## Decisões

### D1 — Runner em `scripts/eval-e2e/` no root do monorepo

- `eval:e2e` no `package.json` do root: `"eval:e2e": "bun scripts/eval-e2e/run.ts"`.
- **Por que root e não `packages/harness/`**: decisão do gray area da F21 ("E2E reais ficam em `scripts/eval-e2e/`" — o package fica com `test/eval/` determinístico). O runner é ferramenta de dev do monorepo: **não é publicado no npm** (F9 publica `packages/*`), não roda em `bun test`/turbo, não entra em CI.
- Estrutura:

```
scripts/eval-e2e/
├── run.ts                # orchestrator: preflight → cenários em ordem → resumo
├── config.ts             # modelo default, timeouts, retries, scopes (por rodada via env)
├── preflight.ts          # D2 — checagens com instruções claras (--doctor expõe)
├── README.md             # D9 — doc do procedimento (fonte única para o F8)
├── lib/
│   ├── piSession.ts      # spawn de sessão Pi headless (D3) — mecanismo a validar no Execute
│   ├── repoFixture.ts    # repo de teste descartável por cenário (git config local — F21 edge)
│   ├── results.ts        # escrita atômica do JSON (D4)
│   └── verdict.ts        # framework de checks determinísticos por cenário (D3)
└── scenarios/
    ├── 00-hello-world.ts     # COEX-05 (sanity — cenário 0)
    ├── 01-baseline-load.ts   # COEX-01
    ├── 02-goal-subagent.ts   # COEX-02
    ├── 03-taskflow-goal.ts   # COEX-03
    ├── 04-pr-review.ts       # COEX-04
    └── 05-auditor-isolation.ts # COEX-06
```

- **`harnessVersion`**: lida de `packages/harness/package.json` (o umbrella — F6) quando existir; antes disso, fallback `0.0.0-dev` + `git describe --always`. **Validar no Execute**: fonte exata (package.json direto vs `versions.ts` gerado do F13) e o que fazer quando a versão do umbrella não mudou mas os forks mudaram (registrar `vendor.manifest.json` hash como extra no JSON — D4).

### D2 — Preflight: pré-requisitos verificados no início, falha clara com instruções

`preflight.ts` roda antes de qualquer cenário; cada check falho imprime o problema + o comando exato de correção. Dois níveis: **aborta a rodada** (sem preflight ok, nada roda) e **registra confundidor** (não aborta).

| Check | Como verifica | Falha → |
| --- | --- | --- |
| `pi` no PATH | `command -v pi` + `pi --version` | **aborta** — instrução de instalação do Pi |
| Umbrella/4 forks carregáveis | `pi list` mostra `@runecraft/*` (padrão F12 check 1) | **aborta** — instrução `pi install` do umbrella (F6) |
| `gh` autenticado | `gh auth status` | **não aborta** — COEX-04 reporta `fail-infra` com nota "gh ausente" (degradação F5 edge preservada) |
| Modelo acessível | probe barato: 1 chamada trivial em sessão print (orçamento < 30 s) | **aborta** com `fail-infra` + instrução (modelo indisponível/rate limit; o probe evita gastar uma rodada inteira) |
| Git local configurado | repo de teste cria config local (F21 edge — isola git config global do runner) | **aborta** — ambiente não isolável |
| gentle-ai / upstreams instalados | grep de marcadores `gentle-ai:` e pacotes upstream (detecção F18) | registra **confundidor** (D9), não aborta |
| Versões de pi/gh/bun/node | coleta para `environment` do JSON | registra, não aborta |

Modo `--doctor`: roda só o preflight e sai com tabela — auto-documentação do ambiente (insumo para o README, D9).

### D3 — Automação: sessões Pi headless reais, vereditos determinísticos do harness

**Nível de automação: total via spawn de `pi` headless** (subprocess com modo print/RPC — mecanismos que o F21 já mapeou no SDK: `runPrintMode`/`runRpcMode`, `--mode rpc`), usando o Pi real do usuário com o umbrella instalado. **Validar no Execute**: o mecanismo exato de spawn headless com extensões reais carregadas (flag CLI vs SDK; carregar os 4 forks em modo print/RPC é o risco central de automação — se o modo headless não carregar extensões, o fallback documentado é "manual assistido": o script imprime os comandos, o humano roda no TUI, o script coleta evidência e roda os checks — o cenário reporta `limit` com nota "assistido").

Cada cenário = módulo que: (1) cria repo de teste descartável (`repoFixture` — tmp dir, git config local; padrão F7/F21); (2) spawna sessão Pi headless com o modelo da rodada; (3) emite as instruções do cenário; (4) coleta evidência (fs, git log, transcript, state do goal/taskflow); (5) roda a **check list determinística** (`verdict.ts` — vereditos são do harness, nunca do modelo).

**Vereditos do harness (não-determinismo aceito):** o conteúdo de findings/review do LLM (mesmo diff → findings diferentes) vai para `notes` sem julgamento; pass/fail vem de checks objetivos por cenário, ex.:

| Cenário | Passos (contrato F7/F19) | Checks principais (determinísticos) |
| --- | --- | --- |
| **S0 — COEX-05 hello world** (sanity) | goal trivial com "Done when" → implementação via dispatch (subagents ou taskflow) → auditor isolado verifica com evidência (regression_shield) → review → ciclo fecha | goal criado com contrato; diff/commit de implementação existe; auditor spawnou limpo; evidência por item do contrato (`<approved/>` sem `<evidence>` → falha); review produziu JSON estruturado; `complete_goal` sobreviveu ao auditor |
| **S1 — COEX-01 baseline load** | sessão Pi carrega os 4 via umbrella | load sem erro; tools/comandos dos 4 registrados (`pi list`/transcript); sem conflito de registro |
| **S2 — COEX-02 goal + subagent chain** | goal ativo; chain de subagents roda na mesma sessão | chain completou; goal-loop continuou são (sem continuation dupla no transcript; subagent activity contou como atividade — sem hang); sem clobber de session handle |
| **S3 — COEX-03 taskflow DAG + goal ativo** | DAG multi-fase com `dependsOn` roda com goal ativo | DAG completou (FlowIR ok); goal completou/segue são; estados (taskflow + goal) sem interferência |
| **S4 — COEX-04 pr-review com nossos subagents** | PR de teste descartável + dispatch dos reviewers | verdict JSON válido; publicação COMMENT-only (padrão F5); PR/repo limpos ao final |
| **S5 — COEX-06 isolamento do auditor** | auditor roda com umbrella instalado | auditor sem extensões/skills/prompts (verificação de ambiente do spawn); só read/grep/find/ls/bash; não vê a conversa do implementador |

- **Modelo por rodada**: env `RUNECRAFT_E2E_MODEL` (default haiku-class em `config.ts` — valor exato a validar no Execute, junto com o mecanismo de fixar o modelo na sessão headless: candidatos models.json por role do F14, env do pi, flag da CLI). Se não houver mecanismo suportado de pin: roda com default e registra `model: "default (não pinado)"` + confundidor — nunca mente sobre o modelo no JSON.
- **Sequência fixa**: S0 primeiro (sanity — AC 1.3). S0 `fail` (harness) → **aborta a rodada** e grava `sanityFailed: true` (rodada inválida como evidência para o F23 — economia de tokens). S0 `fail-infra` → aborta com instruções. Demais falhas não abortam a sequência (cada cenário é independente, repo próprio).
- **Repo descartável por cenário** (isolamento máximo; F7 edge: paralelismo não suportado — sequencial, documentado como limite). COEX-04: repo remoto descartável via `gh repo create` + PR de teste (padrão F5), fechado/deletado no fim (`--keep` preserva para debug). **Validar no Execute**: permissões do token gh (repo:create/PR) e a convenção de nome do repo de teste.

### D4 — Resultado JSON: schema, escrita atômica, rodada parcial

Local fixo (spec, não muda): `.specs/features/f22-e2e-benchmark/results/<harnessVersion>/<data>.json`, com `<data>` = timestamp ISO do início da rodada (ex.: `2026-08-05T14-30-00Z.json`) — mesma versão, 2 rodadas → 2 arquivos (AC 2.2); bump de versão → dir novo (AC 2.1). `results/` versionado em git (F23 lê de lá; evidência é parte do repo).

Schema (spec + campos aditivos marcados):

```json
{
  "harnessVersion": "0.1.0",
  "piVersion": "2.4.0",
  "model": "claude-3-5-haiku-latest",
  "date": "2026-08-05T14:30:00.000Z",
  "roundId": "2026-08-05T14-30-00Z",
  "partial": false,
  "sanityFailed": false,
  "environment": { "bun": "1.3.14", "node": "22.19", "gh": "authed", "os": "linux" },
  "confounders": ["gentle-ai instalado (marcadores gentle-ai: em CLAUDE.md)"],
  "scenarios": [
    {
      "id": "COEX-05",
      "name": "hello-world-sdlc",
      "status": "pass",
      "durationMs": 240000,
      "tokensApprox": 18000,
      "verdict": { "checks": [ { "id": "evidence-per-contract", "ok": true } ] },
      "notes": "findings resumidos; limites encontrados (nunca julgados pelo modelo)",
      "confounders": []
    }
  ]
}
```

- **`status`**: `pass` (checks do harness ok) · `fail` (check falhou — potencial regressão; conta no F23) · `limit` (executou até limite documentável — timeout do cenário, comportamento conhecido do fork; classificação F7 "limite documentável") · `fail-infra` (ambiente/modelo: rate limit, gh ausente, spawn falhou — não conta como regressão no F23).
- **Escrita atômica por cenário**: após cada cenário, `results.ts` reescreve o arquivo da rodada inteira (tmp + rename no mesmo dir). Rodada interrompida (Ctrl-C/crash) preserva os cenários completos, `partial: true` + `interruptedAt`. Nunca existe arquivo "pela metade".
- **`tokensApprox`**: usage exposto pela sessão Pi se disponível; senão estimativa por transcript (chars/modelo). **Validar no Execute** como o Pi headless expõe usage; indisponível → `null` + nota.
- **`confounders`** (edge da spec): round-level e por cenário — gentle-ai instalado, upstreams detectados, versões de pi/gh, modelo não pinado, rodada assistida.
- **Comparabilidade F23**: F23 lê `pass|fail|limit|fail-infra` por `(versão, cenário, data)` e calcula pass rate — os campos aditivos (verdict, environment, confounders) são opcionais e não quebram o consumidor.

### D5 — Env-gating: skip explícito, zero tokens

- `run.ts` sem `RUNECRAFT_E2E` no ambiente → imprime mensagem clara ("RUNECRAFT_E2E não setado — cenários skipped (padrão gentle-ai). CI não roda E2E: zero tokens.") e **exit 0** (skip = verde — AC 1.4; se o script for acidentalmente ligado num pipeline, não falha).
- `RUNECRAFT_E2E=1` + preflight falho → **exit 1** (opt-in explícito = falha alta, com instruções).
- O runner **nunca** é invocado por `bun test`/turbo test/CI push — o gating é a segunda linha (defesa em profundidade); a primeira é o script não existir no grafo de testes.

### D6 — Integração com release (F9): pré-tag obrigatório, PRs nunca bloqueados

- O fluxo de release do F9 (workflow manual dispatch com changesets — fora da CI push) chama o gate antes de criar a tag: `bun run eval:e2e --pre-tag`.
- O gate exige, na rodada recém-executada:
  1. **S0 (hello world) = `pass`** — sanity obrigatório (AC 1.3);
  2. **sem `fail` (harness) novo** vs baseline do F23 (`baselines/e2e-passrate.txt` da versão anterior — comparação por `(cenário, status)`, fail-only-on-worse);
  3. `fail-infra` **não bloqueia** — reportado no output para decisão manual (re-tentar em outro momento é o fluxo esperado).
- Primeira release sem baseline: rodada completa sem `fail` não-infra **vira o baseline** (via `bun run eval:ratchet --update` do F23 — o F23 é dono do arquivo; F22 só chama a função de comparação importada do ratchet).
- **Não bloqueia PRs**: nada no CI push lane (F9 out-of-scope "CI rodando cenários E2E com modelos" respeitado).

### D7 — Custo, rate limit e timeouts

Estimativas **a calibrar no Execute** (primeira rodada registra o real e ajusta a tabela):

| Cenário | Tokens aprox. (haiku-class) | Tempo aprox. | Timeout (config.ts) |
| --- | --- | --- | --- |
| S0 COEX-05 hello world | 15–25k | ~4 min | 10 min |
| S1 COEX-01 baseline | 2–5k | ~1 min | 5 min |
| S2 COEX-02 goal+subagent | 10–15k | ~3 min | 8 min |
| S3 COEX-03 taskflow+goal | 10–15k | ~3 min | 8 min |
| S4 COEX-04 pr-review | 8–12k | ~3 min | 8 min |
| S5 COEX-06 auditor | 3–6k | ~1,5 min | 5 min |
| **Total/rodada** | **~50–75k** | **~15 min** | — |

- **Rate limit (429)**: retry com backoff exponencial (maxRetries 3, base 5 s — config.ts); persistindo → cenário `fail-infra` + nota "rate limit" e segue para o próximo cenário (edge da spec).
- **Timeout de cenário** → `limit` com nota (não é regressão de harness).
- Orçamento global opcional: `RUNECRAFT_E2E_MAX_TOKENS` aborta a rodada antes do próximo cenário quando estourado (proteção de custo; **validar no Execute** se a estimativa de tokens em tempo real é viável).

### D8 — Progresso e logs (rodada longa ~15 min)

- stdout por cenário: `[2/6] COEX-02 goal-subagent — running (47s) … pass (182s, ~12.1k tok)` — tabela resumo markdown no final (status, duração, tokens, notas curtas).
- `--verbose`: transcript completo da sessão Pi no stdout; sempre: log de rodada em `.runecraft/eval-e2e/<roundId>.log` (state/backups padrão F13; `.runecraft/` gitignored — não é evidência versionada, o JSON é).
- Heartbeat: linhas do transcript do subprocess Pi prefixadas (`[pi]`) — o operador vê que a sessão está viva, não apenas um timer.

### D9 — Documentação do procedimento (E2EV-06)

- `scripts/eval-e2e/README.md` é a fonte única: pré-requisitos (Pi + modelo haiku-class + gh para COEX-04), comando (`RUNECRAFT_E2E=1 bun run eval:e2e`), flags, o que cada cenário cobre (tabela D3), como ler os resultados (schema D4 + o que é confundidor).
- F8 (docs) referencia sem duplicar (padrão F19 D1 — uma fonte).
- `--doctor` do preflight é auto-doc do ambiente.

## Arquitetura — módulos

```
scripts/eval-e2e/                    # ferramenta de dev do monorepo (não vai ao npm)
├── run.ts → preflight.ts → scenarios/00..05 → results.ts (atômico) → resumo
├── lib/piSession.ts                 # spawn pi headless (D3 — mecanismo a validar no Execute)
├── lib/repoFixture.ts               # repo descartável + git config local (F21 edge)
├── lib/verdict.ts                   # checks determinísticos (vereditos do harness, nunca do modelo)
├── lib/results.ts                   # JSON atômico em .specs/features/f22-e2e-benchmark/results/<v>/<data>.json
└── config.ts                        # modelo, timeouts, retries, orçamento (env-overridable)
```

Dependências entre features: F22 **importa** a função de comparação do F23 (dono do baseline `e2e-passrate.txt`); F22 **consome** contrato de cenários do F7 (`COEX-01..06`) e o hello world do F19; F21 é fonte dos mecanismos headless (sem dependência de código — a infra de sessão vem de `@earendil-works/pi-coding-agent` — SDK; não há fork do Pi, AD-003; revisão 2026-08-05 — M3).

## Fluxos

### F1 — Rodada completa

```
bun run eval:e2e (sem env)          → mensagem de skip, exit 0 (D5)
RUNECRAFT_E2E=1 bun run eval:e2e
  → preflight (D2): aborta com instruções ou registra confundidores
  → S0 COEX-05 (sanity): fail → aborta rodada (sanityFailed); fail-infra → aborta com instruções
  → S1..S5 em ordem fixa, repo descartável novo por cenário (D3)
  → por cenário: resultado gravado atômico em results/<v>/<data>.json (D4)
  → resumo markdown no stdout (D8)
```

### F2 — Interrupção / rodada parcial

```
Ctrl-C ou crash no cenário N
  → cenários 0..N-1 já gravados (escrita atômica por cenário)
  → results.ts marca partial: true + interruptedAt (edge da spec)
  → nova rodada: arquivo novo (timestamp) — nunca sobrescreve a parcial; a parcial fica como evidência marcada
```

### F3 — Gate pré-tag (release F9)

```
release workflow (manual) → bun run eval:e2e --pre-tag
  → rodada completa (F1)
  → valida: S0 pass + sem fail (harness) novo vs baseline F23 (função importada do ratchet)
  → fail-infra: reporta, não bloqueia (decisão manual)
  → ok → changesets version → tag → publish (F9)
```

### F4 — Manutenção (novo cenário / mudança de passo)

```
1. F7 scenarios.md muda (novo limite descoberto) ou F19 hello world muda
2. atualiza módulo do cenário (passos + checks) — status anterior fica nos resultados antigos (imutáveis)
3. mudança de checks = potencial mudança de veredito → rodada de referência nova + revisão do baseline F23 (--update humano, explícito — padrão F23)
4. nunca editar resultados gravados; nunca re-rodar "no lugar" de um resultado
```

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Custo de tokens por rodada** (~50–75k tok, haiku-class — estimativa a calibrar) | modelo barato fixado (D3); rodada sob demanda + gate pré-tag apenas; skip sem env = zero tokens (D5); orçamento global `RUNECRAFT_E2E_MAX_TOKENS` (D7); S0 aborta cedo em falha de sanity (D3) |
| **Rate limits (429) — modelo indisponível** | probe no preflight (D2); retry com backoff; persistindo → `fail-infra` (não conta no F23) e segue o próximo cenário (D7) |
| **Não-determinismo (mesmo diff → findings diferentes)** | vereditos são checks determinísticos do harness (fs/git/estado/transcript), nunca julgamento do LLM; conteúdo de findings vai em `notes`; limitação declarada do gentle-ai (F21) documentada no README |
| **Rodada longa (~15 min) — operador no escuro** | progresso por cenário + heartbeat do transcript + tabela resumo (D8); interrupção preserva completos (D4) |
| **Ambiente do usuário varia (versões pi/gh/bun, extensões extras)** | preflight com instruções exatas (D2); versões gravadas em `environment`; divergências viram confundidores — resultados comparáveis exigem confundidores conhecidos, não ambiente idêntico |
| **Spawn headless não carrega extensões reais (risco central de automação)** | mecanismo validado no Execute (D3) com fallback documentado "manual assistido" (cenário reporta `limit` + nota) — nunca fingir automação |
| **`scenarios.md` do F7 pendente (placeholder COEX-05)** | IDs e contrato vêm da spec do F7 (estáveis); alinhamento fino no Execute; hello world do F19 cobre S0 |
| **Fronteira F21 (fixture) vs F22 (real) divergindo** | divergência de comportamento entre os modos é esperada → vira nota/confundidor, não falha (F21 limitação declarada: não prova que modelo vivo faria os mesmos tool calls) |
| **gh sem permissão para criar repo/PR (COEX-04)** | preflight detecta e COEX-04 reporta `fail-infra` com instrução; fluxo alternativo: PR em repo fixo de teste do org (validar no Execute) |
| **Resultado parcial interpretado como rodada completa** | `partial`/`sanityFailed` no JSON; F23 ignora rodadas marcadas; README explica a leitura |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| E2EV-01 | P1: Benchmark (AC 1.1 cenários F7 executáveis) | D1 (runner) + D2 (preflight) + D3 (automação headless, repo descartável, ordem fixa) + Fluxo F1 |
| E2EV-02 | P1: Benchmark (AC 1.2 resultado gravado) | D4 (schema com status/duração/tokens/vereditos; escrita atômica em `results/<v>/<data>.json`) |
| E2EV-03 | P1: Benchmark (AC 1.3 hello world sanity) | D3 (S0 = COEX-05 primeiro; falha aborta e marca `sanityFailed`) + D6 (gate exige S0 pass) |
| E2EV-04 | P1: Benchmark (AC 1.4 env-gated skip) | D5 (sem `RUNECRAFT_E2E` → skip + exit 0; fora do grafo de testes; CI verde sem tokens) |
| E2EV-05 | P1: Versionado (AC 2.1/2.2/2.3) | D4 (`results/<harnessVersion>/` por versão; timestamp por rodada; F23 lê por versão) |
| E2EV-06 | P2: Doc (AC 3.1) | D9 (`scripts/eval-e2e/README.md` — pré-requisitos, comando, cobertura dos cenários, leitura dos resultados; F8 referencia sem duplicar) |

**Edge cases da spec:** rate limit → D7 (`fail-infra`, retry/backoff, não conta no F23) · PR real → D3/S4 (repo + PR de teste descartável, padrão F5, limpo ao final) · rodada interrompida → D4 (`partial` + `interruptedAt`, completos preservados) · gentle-ai instalado → D9/D2 (confundidor registrado no JSON, round-level e por cenário).

**Edge cases do F7 herdados:** notificação de completion disputada (batching vs push do goal) → observação registrada em `notes` de S2 (**validar no Execute**) · auditor sob umbrella sem extensões → S5 (check explícito de isolamento) · dois cenários em paralelo → não suportado (sequencial, documentado como limite — F7 edge).

**Notas de revisão cruzada:** F21 é dono do local `scripts/eval-e2e/` e da infra headless (SDK print/RPC) — F22 usa, não duplica · F23 é dono do baseline `e2e-passrate.txt` e da função de comparação — F22 importa e não cria baseline próprio · F9 é dono do workflow de release — F22 entrega `--pre-tag` como gate chamável · F19 (ROUTING.md seção 5, D4) consome o resultado do hello world da primeira rodada F22 para preencher o placeholder COEX-05 · F7 `scenarios.md` pendente é o alinhamento fino de passos (IDs estáveis desde já).

## Validar no Execute (resumo)

1. Mecanismo de spawn headless do Pi com os 4 forks carregados (flag CLI vs SDK print/RPC; fallback manual assistido).
2. Mecanismo de fixar o modelo por rodada (models.json por role do F14 / env / flag) e exposição de token usage.
3. Fonte exata da `harnessVersion` (package.json do umbrella vs `versions.ts` do F13).
4. Estimativas de tokens/tempos (tabela D7) — calibrar com a primeira rodada real.
5. Alinhamento fino dos passos com `scenarios.md` do F7 quando existir; observação de batching vs push em S2.
6. Permissões do token gh para repo/PR descartável de COEX-04 (alternativa: repo fixo de teste).
7. Cálculo exato de pass rate / comparação por status no F23 (F22 define a tupla `(cenário, status)`; o ratchet formaliza).
