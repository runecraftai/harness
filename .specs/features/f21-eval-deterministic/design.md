# F21 Design — Suite Determinística (fixture de modelo)

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** camada 2 = só fluxos críticos do hello world (goal → dispatch via subagent → auditor isolado → review) com `test/EVAL-MATRIX.md` aditivo · suite em `packages/harness/test/eval/` (roda com `bun test`; E2E reais do F22 ficam em scripts separados) · camada 1 usa os mecanismos já desenhados (RUNECRAFT_PI_BIN, RUNECRAFT_*_HOME, golden fixtures)

## Contexto

O harness precisa de garantia contínua sem custo de tokens (AD-010). O gentle-ai testa agentes com um servidor HTTP local OpenAI-wire: o agente roda de verdade (bash/git reais); só a **escolha** do próximo tool call é fakeada (contador+switch), com fixture adversarial que inspeciona o request e falha em desvios — determinismo total, offline, $0, com a limitação declarada de não provar que um modelo vivo produziria os mesmos tool calls.

Pesquisa 2026-08-05 verificada nos docs locais do Pi (`docs/models.md`, `docs/sdk.md`, `docs/rpc.md`, `docs/usage.md`): não existe provider test/fixture built-in; os mecanismos reais são (1) `models.json` com provider OpenAI-compatível (`baseUrl`, `api: "openai-completions"`, `apiKey` dummy, `compat.supportsDeveloperRole: false` — padrão Ollama/LM Studio; auth do provider custom resolve pela própria `apiKey` do models.json, prioridade 4 de resolução), (2) extensão com `pi.registerProvider(createProvider({...}))`, (3) SDK `createAgentSession({ model, modelRuntime })` com `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath, authPath })`, `setRuntimeApiKey`, `getModel(provider, id)` incluindo models custom do models.json, `SessionManager.inMemory(cwd)` ("for testing"), `DefaultResourceLoader` com `systemPromptOverride`, eventos `turn_start/turn_end/agent_end`, `runPrintMode`/`runRpcMode`, e o env `PI_CODING_AGENT_DIR` que override o dir de config (`~/.pi/agent`). Ordem de resolução de auth: `--api-key` > `auth.json` > env var > models.json.

A cadeia que o F21 fecha: F11 entrega o CLI com `RUNECRAFT_PI_BIN`; F13 o state/backups; F15 a testabilidade dos adapters (D9: `RUNECRAFT_*_HOME`, PATH prefix, goldens before/after) e a fonte única de regras (`renderRules()`); F19 a anti-divergência doc ↔ template (D9: golden do ROUTING.md); F7 os cenários de coexistência que a camada 2 replaya deterministicamente; F23 os ratchets que consomem a evidência JSON gravada aqui.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Camada 1 = dispatch in-process com ctx injetado** (`dispatch(argv, ctx)` com `{ env, cwd, stdout, stderr, piInterop }` default = process) **+ 2 smoke tests de subprocess** do bin real | Velocidade (centenas de asserts sem spawn), asserts diretos (exit code como valor, state em memória), injeção de falha trivial; os smoke tests cobrem o que só o processo real prova (shebang, parseArgs, plumbagem de exit code). Restrição de contrato para o Execute do F11: `bin/harness.ts` = wrapper fino sobre `dispatch()` testável |
| D2 | **Fake pi = script `sh` determinístico** em `test/eval/fixtures/bin/pi`: respostas fixas por subcomando, log de chamadas (append em `RUNECRAFT_FAKE_PI_LOG`), injeção de falha por env (`RUNECRAFT_FAKE_PI_FAIL=spec1,spec2` → exit 1 nesses specs) | F11 já define `RUNECRAFT_PI_BIN`; o fake permite assertar a interop (install/remove/list/--version) e o fluxo de falha parcial de componentes sem binário real |
| D3 | **Isolamento de ambiente por teste**: `PI_CODING_AGENT_DIR` + `RUNECRAFT_CLAUDE_HOME`/`RUNECRAFT_OPENCODE_HOME`/`RUNECRAFT_CODEX_HOME` + `XDG_CONFIG_HOME` (absoluto) apontando para temp dirs; `HOME` próprio; **`GIT_CONFIG_GLOBAL=/dev/null` e `GIT_CONFIG_SYSTEM=/dev/null`** em todo spawn + config local no repo de teste | Edge da spec (git config global do runner); nada da máquina real é lido/escrito; `PI_CODING_AGENT_DIR` é o mecanismo documentado do Pi para override de config dir — dispensa hack de HOME |
| D4 | **Asserts de efeito** = diff dos arquivos alvo (byte a byte vs golden before/after do F15), conteúdo do state (schema F13), snapshots de backup (lista/conteúdo do tar.gz + manifest) | AC 1.2/1.4; falha mostra o diff esperado vs real |
| D5 | **Servidor fixture = `node:http`, zero deps, loopback, porta efêmera (port 0)**: `POST /v1/chat/completions` (única rota; resto → 404); resposta chat completion **não-streaming** com `tool_calls`, campos determinísticos (`created: 0`, contadores de usage por step, sem Date) | Paralelismo (porta única por servidor), determinismo, offline por construção; se o Pi exigir SSE para `openai-completions` (envia `stream: true`), implementar delta com `tool_calls` — **validar no Execute** |
| D6 | **Sequência scriptada = `ScriptedScenario`** (contador+switch): cada fluxo registra um script `[{ validações do request, tool_calls a retornar }]`; call N → passo N; fim do script → falha com lista de calls esperadas | Padrão gentle-ai; o script é a única coisa "fakeada" — o agente executa cada tool call de verdade |
| D7 | **Fixture adversarial**: por passo, valida (a) `model` conhecido, (b) `tools` do request = conjunto esperado (lista exata), (c) evidência em ordem (marcadores esperados na conversa), (d) call extra → falha com diagnóstico (passo esperado vs request recebido, truncado) | DETR-04 + edge da spec (request de modelo desconhecido → falha com lista de calls esperadas) |
| D8 | **Apontar o Pi para o fixture = híbrido de 2 mecanismos, mesma porta**: (A) **SDK in-process** — `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: <temp>/models.json })` + `setRuntimeApiKey("fixture", "fixture")` + `createAgentSession({ model, modelRuntime, sessionManager: SessionManager.inMemory(cwd), agentDir: <temp>/pi-agent, tools })`; (B) **models.json em `PI_CODING_AGENT_DIR` temp** para processos reais que o fluxo spawna (auditor isolado do glla) — apiKey literal `"fixture"` no arquivo (resolução 4 do Pi, nada validado) | Auditor isolado exige sessão Pi fresca spawnada pelo fork — config de arquivo é a única forma de propagar para o subprocesso; SDK é mais rápido e sem disco para a sessão principal. Wiring exato do SDK (se `getModel` enxerga o models.json custom com `modelsPath`, formato do `auth.json` se preciso) — **validar no Execute** |
| D9 | **`test/EVAL-MATRIX.md` aditivo** (formato na seção abaixo) + teste de consistência: todo `EVAL-<n>` na matriz tem teste na camada 2; todo teste de fluxo referencia um `EVAL-<n>` | Decisão aprovada; a matriz é a lista versionada do que entra — nada sai sem AD |
| D10 | **Evidência JSON para o F23** (contrato alinhado 2026-08-05, revisão EVAL — B1): por test file, o helper `evalTest()` grava JSONL parcial em `test/eval/evidence/partial/<testFile>.jsonl` (append O_APPEND, linha por teste); script de merge gera `test/eval/evidence/last-run.json` (gitignored). Cada resultado: `{testFile, testName, status: pass\|fail\|fail-infra, message: <mensagem CRUA>, evalId}` — **mensagem crua** (a normalização é responsabilidade ÚNICA do F23, `normalize.ts`); `fail-infra` classificado no `setup.ts` (env de bun/node, git config, rede — edge da spec); top-level `harnessVersion` (fonte do package umbrella, fallback `0.0.0-dev`) e `coverage[]` via helper `recordCoverage(command, flags)` (acumula no processo e serializa no merge) | F23 consome por identidade e normaliza na leitura; arquivos parciais evitam escrita concorrente entre workers do bun; crash de processo → run vermelho no CI de qualquer forma (evidência parcial não mascara) |
| D11 | **Waits explícitos, nunca sleep mágico**: helpers `waitForCondition(fn, { timeout, interval })` (evento `listening`, arquivo de evidência, saída de processo via promessa de exit) | Edge da spec (CI lento) |
| D12 | **CI = `turbo test` no package harness** (`test: "bun test test/eval"`); camada 2 exige o binário real do pi no PATH do job (devDep do package ou setup do job — **validar no Execute**); offline por construção (loopback, apiKey literal, fake pi, configs temp, nenhum `fetch` para fora de 127.0.0.1); sem tokens no ambiente do job | DETR-06; falha da suite = exit ≠ 0 = PR bloqueada |

Mecanismo (2) (`registerProvider` via extensão com `-e`) fica **descartado como primário**: exige carregar extensão no processo e não propaga para subprocessos spawnados (auditor) nem para o SDK in-process sem processo real; se o Execute revelar que o models.json não cobre algum caso (ex.: Pi ignora `modelsPath` em algum caminho), vira fallback documentado.

## Arquitetura — módulos

```
packages/harness/
├── test/
│   ├── EVAL-MATRIX.md                # registro aditivo dos fluxos da camada 2 (D9)
│   └── eval/
│       ├── setup.ts                  # preload (bun --preload): helpers globais de env/temp
│       ├── helpers/
│       │   ├── env.ts                # buildEnv(overrides) + tmpDir() + restore
│       │   ├── fakePi.ts             # cria fake pi (D2) + assertCalls(log)
│       │   ├── gitRepo.ts            # repo de teste: git init com config local,
│       │   │                         #   GIT_CONFIG_GLOBAL=/dev/null (D3)
│       │   ├── fixtureHome.ts        # materializa PI_CODING_AGENT_DIR/RUNECRAFT_*_HOME
│       │   │                         #   + models.json/auth.json (D8) + settings.json
│       │   ├── golden.ts             # assertGolden(actual, path) + --update (base do F23)
│       │   ├── wait.ts               # waitForCondition / waitForExit (D11)
│       │   └── evalTest.ts           # wrapper que grava evidência (D10)
│       ├── layer1/
│       │   ├── install.test.ts       # minimal/full/--component/dry-run/presets/idempotência
│       │   ├── doctor.test.ts        # checks + fail-closed + config quebrada
│       │   ├── status.test.ts        # tabela cruzada + --json + pi list defensivo/fallback
│       │   ├── sync.test.ts          # reconciliação + three-way rules (F19 D7)
│       │   ├── uninstall.test.ts     # remove só o gerenciado + arquivos vazios + edited
│       │   ├── lifecycle.test.ts     # casos F15: fail-closed, dry-run zero writes,
│       │   │                         #   não-clobber, colisão reportada (AC 1.4)
│       │   ├── adapters.test.ts      # claude/opencode/codex: goldens before/after,
│       │   │                         #   XDG case, BOM/CRLF, ~/.claude.json intocado,
│       │   │                         #   guard anti-upstream (F15 D9 lista)
│       │   ├── backup-restore.test.ts# F13: snapshot/dedupe/prune/pin/restore/atômico
│       │   ├── gates-receipt.test.ts # F20: enable/disable/status; receipt capture --from (fixtures)
│       │   ├── routing-golden.test.ts# F19 D9: renderRules() == apêndice do ROUTING.md;
│       │   │                         #   ausência não-Pi (grep goal|loop|subagent|pr-review|
│       │   │                         #   auditor); limites de linhas (≤45/≤25)
│       │   ├── smoke-subprocess.test.ts  # 2 testes: bin real via bun, exit code + JSON
│       │   └── state-schema.test.ts  # schema F13, upsert, escrita atômica, modo conservador
│       ├── layer2/
│       │   ├── fixture/
│       │   │   ├── chatServer.ts     # servidor OpenAI-wire (D5)
│       │   │   ├── scenarios.ts      # ScriptedScenario por EVAL-ID (D6) — fonte única
│       │   │   └── modelsTemplate.ts # gera models.json temp (D8B)
│       │   ├── sdk-session.test.ts   # EVAL-001: sessão SDK in-process + fixture
│       │   ├── coex-subagent.test.ts # EVAL-002: goal + subagent chain worker (F7 COEX-02)
│       │   ├── review.test.ts        # EVAL-004: review de diff com nosso subagents (F7 COEX-04)
│       │   ├── sdlc-helloworld.test.ts  # EVAL-005: goal → dispatch → auditor → review
│       │   ├── auditor-isolation.test.ts # EVAL-005b: tools do auditor ⊆ read/grep/find/ls/bash
│       │   └── adversarial.test.ts   # desvios induzidos → falha com diagnóstico (D7)
│       ├── evidence/
│       │   ├── partial/              # gitignored — JSONL por test file (D10)
│       │   └── last-run.json         # gitignored — merge para o F23
│       └── golden/                   # goldens F15/F19 (before/after, templates)
├── scripts/
│   └── eval-merge-evidence.ts        # partial/*.jsonl → last-run.json (D10)
└── package.json                      # test: "bun test test/eval" (--preload setup.ts)
```

## Fluxos

### F1 — Camada 1: comando contra fixtures (in-process)

```
evalTest("install minimal dry-run não escreve", () => {
  const env = buildEnv({                       // D3
    HOME: tmp, PI_CODING_AGENT_DIR: tmpPi, RUNECRAFT_CLAUDE_HOME: tmpClaude, ...
  });
  const pi = fakePi(tmp);                      // D2 (script em tmp/bin/pi)
  env.RUNECRAFT_PI_BIN = pi.bin;
  const stateDir = tmpRunecraft;               // .runecraft/ temporário (F13 paths)
  const { exitCode, stdout } = await dispatch(
    ["install", "--preset", "minimal", "--dry-run", "--json"], { env, cwd: tmpRepo });
  // asserts de efeito (D4):
  expect(exitCode).toBe(0);
  expect(pi.calls()).toEqual(["version"]);     // dry-run não instala
  expect(readTree(tmpPi)).toEqual(beforeTree); // zero writes — diff de árvore
});
```

Subprocess smoke (2 testes): spawn `bun run bin/harness.ts` com o mesmo `env`; asserta exit code, stdout JSON e stderr de fail-closed — cobre plumbagem real sem custo de centenas de spawns.

### F2 — Fake pi (contrato)

| Chamada do CLI | Resposta do fake | Assert |
| --- | --- | --- |
| `pi --version` | `pi 0.1.0 (fake)` + exit 0 | detectPi presente |
| `pi install <spec>` | `installed <spec>` + exit 0 (ou exit 1 se spec ∈ `RUNECRAFT_FAKE_PI_FAIL`) | fluxo de falha parcial (F11 edge) |
| `pi install -l <spec>` | idem (workspace) | `--scope=workspace` |
| `pi remove <spec>` | `removed <spec>` + exit 0 | uninstall |
| `pi list` | conteúdo de `RUNECRAFT_FAKE_PI_LIST` (fixture) | parse defensivo + fallback settings.json (F11) |

Toda chamada append em `RUNECRAFT_FAKE_PI_LOG` (uma linha `cmd|args`) — `assertCalls(log, [...])` verifica a interop exata, inclusive ordem.

### F3 — Camada 2: fluxo SDLC contra o fixture (EVAL-005)

```
1. setup: gitRepo() descartável (D3) + fixtureHome() materializa
   PI_CODING_AGENT_DIR=<tmp>/pi-agent com models.json (apiKey "fixture",
   compat.supportsDeveloperRole: false) e as extensões dos forks (via F6/H1 —
   mecanismo de materialização validar no Execute)
2. fixture = new ChatServer({ scenario: scenarios["EVAL-005"] }); port = await listen()
3. models.json é regravado com a porta real (port 0 — D5); nada de hardcode
4. ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
   modelsPath: <tmp>/models.json }) + setRuntimeApiKey("fixture", "fixture")  (D8A)
5. createAgentSession({ model: runtime.getModel("fixture","eval-model"),
   modelRuntime, sessionManager: SessionManager.inMemory(cwd),
   agentDir: <tmp>/pi-agent })            // agentDir limpo: só o que o teste pôs
6. session.prompt(goal trivial com "Done when") — agente REAL executa cada tool
   call scriptada (bash/git reais no repo de teste)
7. glla dispara complete_goal → spawna auditor (processo pi real, env herdado
   → PI_CODING_AGENT_DIR temp) — fixture serve a sequência do auditor
   (D8B; spawn mechanics validar no Execute)
8. auditor responde approved → goal completa; waitForCondition(goalComplete)  (D11)
9. asserts: transcript (turn_end/agent_end) confere com o script; fixture
   completou N calls sem falha adversarial; repo tem o efeito real
   (arquivo implementado, commit)
10. finally: server.close() + rm -rf tmp
```

### F4 — Isolamento do auditor (F7 COEX-06)

O fixture distingue o auditor do sessão principal **pelo perfil de tools do request** (o auditor pede só builtins; a sessão principal pede as tools das extensões) ou **por model id distinto** no models.json (se o glla permitir configurar o modelo do auditor — validar no Execute). A validação adversarial (D7b) exige para o auditor `tools ⊆ {read, grep, find, ls, bash}` — **isolation verificada pelo próprio fixture**: qualquer extensão/skill vazando para o auditor = tools extras no request = falha com diagnóstico.

### F5 — Desvio induzido (teste do próprio fixture, DETR-04)

`adversarial.test.ts` monta um `ScriptedScenario` curto e dispara contra ele: (a) request de modelo desconhecido → falha listando calls esperadas; (b) tools ausentes no passo 2 → falha "esperava tools X, veio Y"; (c) evidência fora de ordem → falha apontando o marcador ausente; (d) call além do script → falha "nenhuma call esperada restante". O teste valida que o fixture **é** adversarial (o mecanismo não regride silenciosamente).

### F6 — Evidência (D10)

```
evalTest(id, name, fn)  →  executa; grava {testFile, testName, status,
  message (normalizada), durationMs, evalId?} como linha JSON no partial/<file>.jsonl
merge (scripts/eval-merge-evidence.ts) → last-run.json {suite, suiteVersion,
  schemaVersion, runner, runId, results[]}
CI: bun test → merge → ratchet do F23 consome last-run.json (falha nova = vermelho)
```

## EVAL-MATRIX.md — formato e política

`packages/harness/test/EVAL-MATRIX.md` (na raiz de `test/`, não dentro de `eval/` — é o registro de governo dos fluxos, visível a quem abre o package). Cabeçalho com `MATRIX_VERSION` (bump a cada entrada adicionada — entra na evidência como `suiteVersion`). Tabela:

| ID | Fluxo (evidência F7) | Ferramentas | Script esperado (tool calls por turno) | Notas |
| --- | --- | --- | --- | --- |
| EVAL-001 | goal trivial (P1 camada 2) | goal-loop-audit | 1. cria goal com "Done when"; 2. implementa de verdade (bash/edit); 3. `complete_goal` com `<evidence>` por item; 4. auditor (sessão fresca, tools ⊆ builtins); 5. approved → goal completa | auditor sem extensões (F7 COEX-06); nomes exatos das tools do glla validar no Execute |
| EVAL-002 | goal ativo + subagent chain worker (F7 COEX-02) | glla + subagents | 1. goal; 2. subagent chain (passo recebe `{previous}`); 3. worker executa bash real; 4. chain completa; 5. `complete_goal` | sem continuation dupla; subagent = worker |
| EVAL-003 | ~~goal ativo + taskflow DAG (F7 COEX-03)~~ — **FORA da camada 2** (revisão 2026-08-05, I1): decisão aprovada era só hello world; o cenário standalone fica no F22 S3 | — | — | |
| EVAL-004 | review de diff (F7 COEX-04) | pr-review | 1. diff real (commit no repo de teste); 2. review (JSON verdict) | dispatch compatível com nosso subagents |
| EVAL-005 | hello world SDLC completo (F7 COEX-05 replay determinístico) | todos | EVAL-001 + EVAL-002 + EVAL-004 encadeados: goal → dispatch subagent → auditor isolado → review → `complete_goal` sobrevive ao auditor | fluxo canônico do ROUTING.md seção 5 (F19 D4) |

**Política aditiva**: entradas só são acrescentadas (com novo `EVAL-<n>` e bump de `MATRIX_VERSION`); **nada sai sem AD**. Correção in-place do script (ex.: fork mudou nome de tool) é permitida com nota de revisão datada na linha — o diff da revisão aparece na PR. Mudança **semântica** de fluxo (novo passo de tool call no meio) = entrada nova, nunca edição da antiga (preserva o histórico do que o harness já provou).

## Evidência JSON para o F23 (RCTH-01/02)

`test/eval/evidence/last-run.json` (gitignored; o CI o regenera a cada run e o arquiva como artefato do job):

```json
{
  "schema": "runecraft-eval-evidence",
  "schemaVersion": 1,
  "suite": "eval-deterministic",
  "suiteVersion": "3",
  "runner": { "bun": "1.3.14", "node": "22.19.0" },
  "runId": "<YYYYMMDD-HHmmss>-<sha curto do head>",
  "results": [
    {
      "testFile": "test/eval/layer1/install.test.ts",
      "testName": "install minimal dry-run não escreve",
      "status": "pass",
      "message": "",
      "durationMs": 42,
      "evalId": ""
    },
    {
      "testFile": "test/eval/layer2/sdlc-helloworld.test.ts",
      "testName": "EVAL-005: goal → dispatch → auditor → review",
      "status": "fail",
      "message": "fixture: call 4 (auditor): tools extra esperadas=[read grep find ls bash] recebidas=[read grep find ls bash bash]",
      "durationMs": 3120,
      "evalId": "EVAL-005"
    }
  ]
}
```

**Normalização** (padrão gentle-ai: identidade estável, nunca linha crua): regex de substituição no `message` — paths de temp dirs (`/tmp/runecraft-eval-*` → `$TMP`), timestamps ISO → `$TS`, portas → `$PORT`, `runId` → `$RUN`. Regra para o fixture: diagnóstico adversarial **nunca** embute porta/path — só "call esperada vs recebida" (nome de tool, marcador de evidência, modelo).

**Consumo do F23**: o ratchet lê `last-run.json`, extrai falhas, keya por `(testFile, testName, message normalizada)`, compara com `baselines/known-failures.txt` (falha nova → vermelho; conhecida → congelada; sumiu → aviso); `--update` regenera o baseline a partir da evidência. A identidade é a mesma nos dois lados — F21 grava exatamente o que F23 compara.

## Integração CI

- **Roda com**: `turbo test` (root) → task `test` do package harness → `bun test test/eval` (`--preload test/eval/setup.ts`); turbo `dependsOn: ["build"]` já existente no repo. Nada de job separado para a camada 1; o F22 (E2E real, env-gated) fica em `scripts/eval-e2e/` fora do `bun test`.
- **Camada 2 e o binário pi**: os fluxos que spawnam o auditor exigem `pi` no PATH. Duas opções (validar no Execute): devDep `@earendil-works/pi-coding-agent` no package harness (mesmo package do npx cache — SDK + bin; confirma publish/nome no Execute) ou setup do job de CI com o installer oficial. A suite nunca instala nada em runtime.
- **Offline garantido**: por construção — fixture em loopback (port 0), apiKey literal `"fixture"`, fake pi (camada 1), `PI_CODING_AGENT_DIR`/`RUNECRAFT_*_HOME`/`GIT_CONFIG_*` isolados; nenhum teste executa `fetch`/`spawn` para fora de 127.0.0.1 (revisão de código + o fixture 404 para qualquer host). Job de CI roda sem tokens de modelo; `bun install` do CI usa o cache normal (fora do escopo da suite).
- **Falha em regressão**: exit ≠ 0 do `bun test` → turbo vermelho → PR bloqueada (lane F9). Evidência é gravada mesmo em falha (JSONL por teste) — o ratchet do F23 classifica no mesmo pipeline.
- **Evidência**: merge pós-teste no mesmo job; `last-run.json` arquivado; baselines versionados no repo (F23).

## Riscos

| Risco | Mitigação |
| --- | --- |
| **CI lento / timing** | Camada 2 = 5 fluxos (escopo aprovado); fixture local = latência ~0; waits explícitos com timeout generous (D11); sem sleep mágico; smoke tests de subprocess limitados a 2 |
| **Git config global do runner vaza para os testes** | `GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_SYSTEM=/dev/null` em todo spawn + config local por repo + `HOME` isolado (D3) |
| **Fixture frágil a mudanças de prompt dos forks** | EVAL-MATRIX aditivo (D9): mudança de script = diff revisável na PR; diagnóstico adversarial diz exatamente o que mudou (call esperada vs recebida); limitação declarada (não prova modelo vivo) documentada no README do test/eval |
| **Paralelismo (bun test roda arquivos em workers)** | Porta efêmera por servidor (D5); repo descartável por teste; evidência parcial por arquivo (D10 — sem escrita concorrente); env mutado só dentro do arquivo (workers são processos separados) |
| **Custo de manutenção das sequências scriptadas** | Escopo mínimo (só hello world, decisão aprovada); scripts centralizados em `scenarios.ts` com a matriz como espelho legível; teste de consistência matriz ↔ testes impede entrada órfã |
| **Wiring do SDK do Pi (modelsPath, getModel, auth)** | Fatos verificados nos docs (ModelRuntime.create com credentials/modelsPath, setRuntimeApiKey, getModel inclui models custom); pontos restantes marcados "validar no Execute" no Execute do F21 com exemplo do `docs/sdk.md` |
| **Como o glla spawna o auditor (env/bin herdados)** | Depende do mecanismo do fork (F2/F4); se o spawn não herdar env, EVAL-005 usa PATH prefix + bin real e fallback de scenario por model id; mecanismo confirmado no Execute antes de fechar a camada 2 |
| **`stream: true` no request do Pi** | Resposta não-streaming pode bastar (cliente aceita); se não, SSE com delta de tool_calls no fixture — validar no Execute |
| **Evidência incompleta em crash de processo** | Crash = run vermelho (exit ≠ 0) independente da evidência; ratchet não mascara (falha nova ausente da evidência não entra no baseline) |
| **Materialização das extensões dos forks no agentDir temp** | Depende do mecanismo H1 do F6 (copy vs symlink) — validar no Execute; helper `fixtureHome.ts` espelha o que o F6 decidir |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| DETR-01 | P1: Camada 1 (AC 1.1 cobertura de comandos) | D1 (dispatch in-process + ctx) + F1/F2 + `layer1/` (install com dry-run e presets, doctor, status, sync, uninstall; smoke de subprocess) |
| DETR-02 | P1: Camada 1 (AC 1.2/1.3/1.4 determinismo/offline/goldens) | D2 (fake pi) + D3 (isolamento de ambiente/git) + D4 (asserts de efeito) + `lifecycle.test.ts` (casos F15: fail-closed, dry-run zero writes, não-clobber, colisão) + `routing-golden.test.ts` (F19 D9) + offline por construção (D12) |
| DETR-03 | P1: Camada 2 (AC 2.1 sequência scriptada) | D5 (servidor OpenAI-wire) + D6 (ScriptedScenario contador+switch) + D8 (SDK in-process + models.json) + D9 (EVAL-MATRIX) + F3 (agente executa cada passo de verdade em repo descartável) |
| DETR-04 | P1: Camada 2 (AC 2.2 adversarial) | D7 (valida modelo/tools/evidência/call extra com diagnóstico) + F5 (teste induzido de desvio) |
| DETR-05 | P1: Camada 2 (AC 2.3/2.4 isolamento/offline) | D8B (auditor via sessão fresca com PI_CODING_AGENT_DIR temp) + F4 (tools ⊆ read/grep/find/ls/bash verificada pelo fixture) + offline/$0 (loopback + apiKey literal) |
| DETR-06 | P2: CI (AC 3.1/3.2) | D10 (evidência JSON com identidade estável) + D12 (turbo test, falha bloqueia merge) + F6 + seção Integração CI |

**Cobertura:** 6/6 mapeados. Edge cases da spec: git config global → D3 · timing → D11 · modelo desconhecido → D7a · paralelismo → D5/D10.

**Pontos a validar no Execute** (consolidado): wiring do SDK (modelsPath/getModel/setRuntimeApiKey), spawn do auditor pelo glla (env/PATH/model id), `stream: true` do Pi (SSE?), materialização das extensões dos forks (F6 H1), forma de obter o binário pi no CI, nomes exatos das tools do glla nos scripts da matriz, limites de linhas dos templates (≤45/≤25, calibrar).

**Notas de revisão cruzada:** F11 Execute deve manter `dispatch(argv, ctx)` testável (D1 — contrato deste design); F15 D9 lista os mecanismos que a camada 1 exercita (RUNECRAFT_*_HOME, PATH prefix, `RUNECRAFT_TASKFLOW_<HOST>_BIN`); F19 D9 exige o teste golden renderRules × ROUTING.md (aqui em `routing-golden.test.ts`); F23 consome `last-run.json` com a identidade definida na seção Evidência; o F22 referencia a camada 2 como base (mesmo `fixture/`, cenários reais em `scripts/eval-e2e/`).
