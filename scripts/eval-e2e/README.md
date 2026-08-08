# E2E Benchmark — modelos reais, resultados versionados (F22)

Benchmark executável com **modelos reais (haiku-class)** dos cenários do F7
(`COEX-01..06`), env-gated (`RUNECRAFT_E2E=1`, fail-closed — zero tokens em CI) — **fora do
merge gate**: CI normal não roda E2E (zero tokens, zero rede). Cada rodada
grava resultados **datados e versionados** em
`.specs/features/f22-e2e-benchmark/results/<harnessVersion>/<roundId>.json` —
evidência versionada que o F23 (ratchet P2) consome para a tendência de pass
rate por versão.

- **Custo**: cap de **US$ 10 por rodada** (AD-037) — estourado → HALT (rodada
  parcial, exit 2). Modelo default haiku-class: `deepseek-v4-flash`
  (opencode-go — o modelo provado no F7/COEX-05).
- **Exit codes** (contrato F23): `0` tudo pass (limit conta como não-falha) ·
  `1` qualquer fail/fail-infra · `2` cost cap atingido.
- **Sanity obrigatório**: o cenário 0 (`hello-world-sdlc`, COEX-05) é o hello
  world do F19 — falha dele invalida a rodada (`sanityFailed: true` no JSON;
  o F23 ignora rodadas inválidas).

## Pré-requisitos (D9)

| Requisito | Para quê | Falha → |
| --- | --- | --- |
| `pi` no PATH (`pi --version`) | children de subagents/pr-review spawnam `pi` real | **aborta** com instrução de instalação |
| git | repo descartável por cenário (config local — F21 edge) | **aborta** |
| API key do provider | modelos reais — `RUNECRAFT_E2E_API_KEY` (ou env padrão do provider, ex. `ANTHROPIC_API_KEY`) | **aborta** fail-closed (mensagem clara) |
| `gh` autenticado | COEX-04 (PR de teste descartável) | **não aborta** — COEX-04 reporta `fail-infra` (degradação F5 preservada) |
| modelo acessível | probe barato (< 30s) no preflight | **aborta** `fail-infra` com instrução (evita gastar a rodada) |

`bun run eval:e2e --doctor` roda só o preflight e mostra o ambiente (auto-doc).

## Como rodar

```bash
# 1. Diagnóstico do ambiente (offline — sem env):
bun run eval:e2e --doctor
bun run eval:e2e --list-scenarios
bun run eval:e2e --dry-run

# 2. Rodada completa (env-gated — exige API key):
export RUNECRAFT_E2E=1
export RUNECRAFT_E2E_API_KEY=sk-...          # a key NUNCA é logada nem entra nos resultados
bun run eval:e2e

# 3. Gate pré-tag (release F9/D6 — S0 pass obrigatório):
RUNECRAFT_E2E=1 bun run eval:e2e --pre-tag
#    (a comparação com o baseline do F23 é do ratchet: bun run eval:ratchet --e2e — P2)
```

Modelo/provider custom:

```bash
RUNECRAFT_E2E=1 RUNECRAFT_E2E_MODEL=minimax-m2.7 RUNECRAFT_E2E_PROVIDER=opencode-go \
  RUNECRAFT_E2E_API_KEY=sk-... bun run eval:e2e
```

Provider OpenAI-wire custom (`api`/`baseUrl` só entram quando fornecidos —
nunca inventados):

```bash
RUNECRAFT_E2E=1 RUNECRAFT_E2E_PROVIDER=custom RUNECRAFT_E2E_API=openai-completions \
  RUNECRAFT_E2E_BASE_URL=https://... RUNECRAFT_E2E_API_KEY=sk-... bun run eval:e2e
```

Flag `--keep` preserva os repos de teste (debug). Flag `--verbose` é RESERVADA
(fix cleric F22 #4): o runner observa usage/compaction/confounders mas não
emite transcript da sessão in-process — implementação de transcript fica para
uma rodada futura; a flag não muda o comportamento hoje.

## Cenários (cobertura — contrato F7)

| # | ID | name (F23 scenarioId) | Cobre | Checks principais (determinísticos) |
| --- | --- | --- | --- | --- |
| 0 | COEX-05 | `hello-world-sdlc` | **sanity** — hello world SDLC (F19 ROUTING §5): goal com Done when → implementação → auditor isolado com evidência → fechamento | greeting.txt exato; goal_archived complete; auditor aprovou; `<evidence>` no report |
| 1 | COEX-01 | `baseline-load` | os 4 forks carregam via umbrella sem conflito | tools registradas (complete_goal/subagent/taskflow); probe de comando; tool subagent invocada |
| 2 | COEX-02 | `goal-subagent-chain` | two-driver: goal ativo + chain do reviewer na mesma sessão | notes.md 3 bullets; reviewer artifact `.pi-subagents/artifacts/`; goal loop ativo |
| 3 | COEX-03 | `taskflow-dag-goal` | DAG do taskflow rodando com goal ativo | analysis.md; fases done no trace; goal_archived (workaround BUG-2 documentado) |
| 4 | COEX-04 | `pr-review` | pr-review real com nossos subagents (PR descartável) | verdict JSON publicado; COMMENT-only (PR aberto); limpeza |
| 5 | COEX-06 | `auditor-isolation` | auditor SEM extensões/skills/prompts, só leitura | audit ran; report sem tools de escrita (isolamento por construção + empírico) |

**Extensível**: adicionar um cenário = criar `scenarios/NN-nome.ts` com
`export default ScenarioModule` — o registry inclui automaticamente em ordem.

## Como ler os resultados

`results/<harnessVersion>/<roundId>.json` — schema da spec (F22 D4):

```json
{
  "harnessVersion": "0.1.0",
  "piVersion": "0.84.1",
  "model": "deepseek-v4-flash",
  "date": "2026-08-08T14:30:00.000Z",
  "roundId": "2026-08-08T14-30-00Z",
  "partial": false,
  "sanityFailed": false,
  "environment": { "bun": "...", "node": "...", "gh": "authed", "os": "linux" },
  "confounders": ["..."],
  "scenarios": [
    {
      "id": "COEX-05",
      "name": "hello-world-sdlc",
      "status": "pass",
      "durationMs": 23400,
      "tokensApprox": 18000,
      "verdict": { "checks": [{ "id": "greeting-exists", "ok": true }] },
      "notes": ["..."],
      "confounders": []
    }
  ]
}
```

- **`status`**: `pass` (checks do harness ok) · `fail` (check falhou —
  regressão potencial, conta no F23) · `limit` (timeout/limite documentável ou
  cost cap — não é regressão) · `fail-infra` (rate limit, gh ausente, spawn
  falhou, modelo sem resposta — **não conta no F23**).
- **`tokensApprox`**: usage REAL do SDK (`message_end.usage` + tool results —
  inclui o auditor in-process do glla). Indisponível → `null` + nota — nunca
  estimativa inventada.
- **`confounders`** (round + cenário): upstream installers presentes, upstreams
  detectados, `pi list` sem @runecraft (a sessão usa materialização direta das
  extensões — F21 H1), workaround BUG-2, compaction emitido (F27), repo de
  teste não deletado (token gh sem `delete_repo` — pendência F7).
- **Rodada parcial** (`partial: true` + `interruptedAt`): Ctrl-C/crash/cap —
  os cenários completos ficam gravados (escrita atômica por cenário); o F23
  compara só cenários completos e ignora rodadas inválidas.
- **Verditos são do harness, nunca do modelo**: o conteúdo de findings/review
  do LLM vai para `notes` sem julgamento (mesmo diff → findings diferentes é
  esperado — D3).

## Orçamento e limites (honestidade)

| Cenário | Tokens aprox. (haiku-class) | Tempo aprox. | Timeout |
| --- | --- | --- | --- |
| S0 COEX-05 | 15–25k | ~4 min | 10 min |
| S1 COEX-01 | 2–5k | ~1 min | 5 min |
| S2 COEX-02 | 10–15k | ~3 min | 8 min |
| S3 COEX-03 | 10–15k | ~3 min | 8 min |
| S4 COEX-04 | 8–12k | ~3 min | 8 min |
| S5 COEX-06 | 3–6k | ~1,5 min | 5 min |
| **Total** | **~50–75k** | **~15 min** | — |

Tabela do design D7 — **a calibrar com a primeira rodada real** (a rodada
registra o real e a tabela é ajustada; resultados antigos nunca são editados).

- **Custo**: o ledger (padrão F25) usa o `cost` real calculado pelo SDK
  (taxas do modelo configurado — `pi-ai calculateCost`); fallback documentado
  = tabela haiku-class em `config.ts` (Claude 3.5 Haiku pública: input
  $0.80/M, output $4/M, cacheRead $0.08/M, cacheWrite $0.80/M —
  `RUNECRAFT_E2E_RATE_*` override). Cap `RUNECRAFT_E2E_COST_CAP_USD` (default
  **10**). O cap é verificado **entre cenários**; um cenário individual é
  limitado pelo seu timeout (um cenário estourando US$10 sozinho exigiria
  ~10M+ tokens — patológico, documentado).
- **Rate limit (429)**: retry com backoff exponencial (`RETRY_MAX=3`,
  base 5s) é responsabilidade do SDK/forks; persistindo, o cenário reporta
  `fail-infra` e segue (edge da spec).
- **Limitações conhecidas**: (1) o output de `ctx.ui.notify` (widget TUI) não
  é observável em sessão in-process — os probes de comando do COEX-01 cobrem a
  superfície sem erro (o F7 viu os textos via RPC); (2) o BUG-2 do taskflow
  (`dist/agents/` não empacotado) exige workaround no COEX-03 — documentado e
  registrado como confundidor; (3) o modelo decide as tool calls (E2E sem
  script — F21/AD-021) — o comportamento do modelo vira nota/confundidor,
  nunca veredito de harness; (4) `session_compact`/modelSwitch/handshake VS
  Code Copilot: o runner OBSERVA a emissão de compaction (compaction_start/end
  → confundidor) mas cenários dedicados ficam para validações futuras
  (extensível — ver README da spec F22).

## Integração

- **CI**: nada — o runner não existe no grafo de testes (D5 defesa em
  profundidade); sem `RUNECRAFT_E2E` → skip + exit 0.
- **Testes offline**: `bun run test:eval-e2e` (71 testes — env-gating,
  enumeração, serialização determinística, cost accounting, classificação
  fail-infra, orquestração com fakes). Zero tokens, zero rede.
- **Release (F9)**: `--pre-tag` roda a rodada completa e exige S0 `pass`
  (D6); a comparação com o baseline do F23 é do ratchet (`eval:ratchet
  --e2e` — P2, fora do escopo do F22).
