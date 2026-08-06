# F7 — Cenários de Coexistência (scenarios.md)

**Feature:** f7-coexistence-validation · **Status:** Executado em 2026-08-06 · **Testador:** fighter (execution lead)

Este documento é o Independent Test da spec F7: cada cenário COEX-01..06 da [spec.md](./spec.md) foi executado ao vivo contra o umbrella `@runecraft/harness` (F6) e o resultado, classificação e limites foram registrados. Nenhum código de fork ou do harness foi alterado (F7 é validação + doc). Bugs reais encontrados estão registrados com repro mínimo na seção [Achados](#achados-e-bugs-registrados) — **não foram corrigidos**.

---

## Sumário

| Cenário | Requisito | Resultado | Classificação | Duração |
|---|---|---|---|---|
| COEX-01 | Baseline load dos 4 via umbrella | **PASSA** | — | ~10s (sessão única) |
| COEX-02 | Goal ativo + subagent chain | **PASSA** | — | 230.5s |
| COEX-03 | Taskflow DAG + goal ativo | **PASSA** (com workaround de setup) | DAG roda; **BUG-1/BUG-2** de fork no taskflow | 146.2s |
| COEX-04 | pr-review disparando reviewers + nosso subagents | **PASSA** | — | 66.7s |
| COEX-05 | Fluxo SDLC E2E (hello world) | **PASSA** | — | 23.4s |
| COEX-06 | Auditor isolado SEM extensões sob umbrella | **PASSA** | garantido por construção + evidência | — |
| Edge-1 | Batching (subagents) vs push (goal) | Documentado | coexistem sem conflito | — |
| Edge-2 | Dois cenários paralelos no mesmo repo | **Limite documentável** | não suportado oficialmente; raça de estado observada | ~21s |

**Zero conflitos arquiteturais não documentados.** Os dois achados críticos (BUG-1/BUG-2) são bugs de fork do taskflow (F3), não conflitos de coexistência entre os 4 packages.

---

## Setup do ambiente de teste

Repo de teste descartável (fora do monorepo), sessão Pi headless isolada (padrão F6):

```bash
# 1. Agente Pi isolado (config dir próprio)
mkdir -p /tmp/runecraft-f7/agent
cp ~/.pi/agent/auth.json /tmp/runecraft-f7/agent/auth.json

# 2. settings.json mínimo (modelo barato haiku-class)
cat > /tmp/runecraft-f7/agent/settings.json <<'EOF'
{
  "defaultProvider": "opencode-go",
  "defaultModel": "deepseek-v4-flash",
  "defaultThinkingLevel": "low",
  "hideThinkingBlock": true,
  "subagents": { "defaultModel": "opencode-go/deepseek-v4-flash" }
}
EOF

# 3. Instala o umbrella por path local
PI_CODING_AGENT_DIR=/tmp/runecraft-f7/agent pi install /home/rehem/Projects/harness/packages/harness

# 4. Todo comando de teste roda com o agent dir isolado:
export PI_CODING_AGENT_DIR=/tmp/runecraft-f7/agent
export PI_SKIP_VERSION_CHECK=1
export GLLA_GLOBAL_SETTINGS_PATH=/tmp/runecraft-f7/agent/glla-settings.json
```

**Versões testadas:** pi `0.84.0` · `@runecraft/harness` `0.1.0` · `@runecraft/subagents` `0.37.2` · `@runecraft/taskflow(-core/-dsl)` `0.2.6` · `@runecraft/goal-loop-audit` `0.28.34` · `@runecraft/pr-review` `1.11.4`. Modelo default `opencode-go/deepseek-v4-flash` (haiku-class); COEX-04 usou `opencode-go/minimax-m2.7` (ver nota no cenário).

**Notas de execução (padrão F6):**
- Comandos cujo output vai para `ctx.ui.notify` (TUI widget) não imprimem em print/RPC mode — o output é capturado nos eventos `extension_ui_request.method=notify` do RPC e/ou nos arquivos de estado (`.pi-glla/`, `.pi/taskflows/`).
- `tmux` é usado para sessões TUI quando se quer ver o widget; o RPC (`pi --mode rpc`) foi o driver principal dos cenários por ser determinístico e auditável.
- **Atenção ao rodar via tmux:** tmux não repassa env do client para novas sessões — exportar as vars **dentro** da sessão (`tmux send-keys "export PI_CODING_AGENT_DIR=..." Enter`).
- Workaround de setup usado em COEX-03 (e somente lá): `ln -s <subagents>/agents <agentdir>/agents` para expor os agentes `scout`/`worker` como agentes de usuário ao taskflow — necessário por causa do BUG-2 (abaixo). Não é alteração de código de fork.

---

## COEX-01 — Baseline load dos 4 via umbrella

- **Requisito:** sessão Pi carrega os 4 forks via umbrella; todos comandos/tools registram sem erro de load.
- **Setup:** repo vazio `coex01`, agente isolado, umbrella instalado por path.
- **Comandos (uma sessão RPC, prompts sequenciais):**
  ```
  {"type":"prompt","message":"/goal status"}
  {"type":"prompt","message":"/tf list"}
  {"type":"prompt","message":"/pr-review"}
  {"type":"prompt","message":"subagent({action:'list'})"}
  ```
- **Resultado (RPC events, arquivo `coex01-baseline.jsonl`):**
  | Superfície | Evidência |
  |---|---|
  | goal-loop-audit | notify: `No active goal. Use /goal <objective>.` |
  | taskflow | notify: `No saved taskflows. Ask the agent to create one.` + warning de boot `[taskflow] Model roles not configured` |
  | pr-review | notify: `Invalid /pr-review invocation: a positive PR number must be the first argument` |
  | subagents | tool `subagent({action:'list'})` executado; resposta lista 9 agentes (advisor, oracle, planner, reviewer, scout, worker…) |
- **Data:** 2026-08-06T22:xx (UTC). **Resultado: PASSA.**
- Observações:
  - Nenhum erro de load; warning do goal-loop `session provider "opencode-go" is not a known built-in` é informativo (o auditor herda o modelo resolvido in-process) — ver COEX-06.
  - `subagent({action:'list'})` também revalidado em print mode (`pi -p "subagent({action:'list'})"`).
  - **Caveat de setup descoberto:** o `settings.json` do agente isolado é sobrescrito por `pi` (ex.: grava `lastChangelogVersion`); a entrada `packages` do umbrella **é preservada** em rewrites (verificado após o `pi install` + primeiras execuções). Não é bug — foi armadilha do testador ao regravar o settings manualmente sem a chave `packages`.

---

## COEX-02 — Goal ativo + subagent chain na mesma sessão

- **Requisito (two-driver):** goal ativo (goal-loop-audit dirige continuation via `agent_end`) enquanto um `subagent` chain roda; loop continua são (sem continuation dupla, sem clobber de session handle).
- **Setup:** repo `coex02` (git init). **Prompt RPC:**
  ```
  /goal "Create a file notes.md with exactly 3 bullet points describing what this repo does. After creating the file, run the reviewer subagent to check notes.md quality, then address any findings it reports. Done when: notes.md exists with 3 bullet points and the reviewer subagent run completed successfully."
  ```
- **Resultado:**
  - 15 turns / 15 tool calls na sessão: goal loop pushou continuations (`goal_continuation_sent` em `.pi-glla/active.jsonl`) enquanto o modelo trabalhou.
  - O modelo chamou `subagent({action:'list'})` e **2×** `subagent({agent:'reviewer', ...})` — chains reais: artefatos em `.pi-subagents/artifacts/*_reviewer_0_*` (transcript com stderr do child pi: `[taskflow] Model roles not configured` → **o child herda o agente isolado via env e carrega o harness também**).
  - Reviewer encontrou FAIL (2 de 3 bullets imprecisos) → modelo corrigiu (`edit` em notes.md) → 2ª revisão → `complete_goal`.
  - Auditor isolado rodou: **approved** (`auditHistory[0].approved=true`, modelo deepseek-v4-flash). Goal arquivado `complete` (`stopReason: auditor deepseek-v4-flash approved`). Um estado transitório `paused` foi observado entre turns (pausa de completion/audit, auto-recuperado) — sem hang.
- **Data:** 2026-08-06 · **Duração:** 230.5s · **Resultado: PASSA.**
- **Classificação:** sem bugs. Two-driver goal→subagents são canais separados (push do loop vs dispatch de childs); nenhuma continuation dupla, nenhum clobber de handle de sessão observado.

---

## COEX-03 — Taskflow DAG rodando enquanto goal ativo

- **Requisito:** taskflow DAG e goal ativo na mesma sessão; ambos completam sem interferência de estado.
- **Setup:** repo `coex03` + workaround BUG-2 (agents de usuário disponíveis ao taskflow, ver Setup).
  ```
  /goal "Use the taskflow tool (action 'run' with a define chain, do NOT call verify or compile actions) to produce analysis.md: step 1 scout reads README.md and lists repo contents, step 2 worker writes the analysis into analysis.md. Done when: analysis.md exists, is non-empty, and the taskflow run completed successfully."
  ```
- **Resultado:**
  - Goal ativo durante todo o DAG (16 turns, 18 tools: 5× `taskflow`, 10× `bash`, 2× `read`, 1× `complete_goal`).
  - Flow `coex03-analyze` **completed (2/2)**: phases `scout` (lê repo) e `worker` (escreve `analysis.md`) — evidência em `.pi/taskflows/runs/coex03-analyze/*.json` (ambas `status: done`).
  - `analysis.md` criado e válido; goal arquivado `complete` com auditor **approved**.
- **Data:** 2026-08-06 · **Duração:** 146.2s · **Resultado: PASSA (com workaround de setup).**
- **Classificação:** a coexistência DAG+goal **funciona** (ambos completaram, sem interferência de estado). Porém o taskflow standalone está quebrado em dois pontos reais do fork — **BUG-1** (actions `verify`/`compile`/`compile-ir`) e **BUG-2** (built-in agents ausentes) — detalhes em [Achados](#achados-e-bugs-registrados). Sem o workaround do BUG-2, `action:"run"` falha com `Unknown agent: default`; sem a correção do BUG-1, o modelo não consegue verificar o flow antes de rodar (o modelo contornou pulando `verify` — instruído no prompt).

---

## COEX-04 — pr-review disparando seus reviewers com nosso subagents instalado

- **Requisito:** `/pr-review <num>` completa com nossos subagents presentes na sessão (dispatch compatível).
- **Setup:** repo GitHub privado descartável `runecraft-f7-pr-test` (conta 90sRehem), PR #1 `feat: add multiply and scale helpers` com **bug seedado** (`scale` computa `n * factor + factor` em vez de `n * factor`, marcado com comentário `BUG:`). Push via HTTPS (`gh auth setup-git`; SSH não disponível no ambiente).
- **Comandos:**
  ```
  gh repo create runecraft-f7-pr-test --private ...
  gh pr create --title "feat: add multiply and scale helpers" ...
  # sessão pi no repo:
  {"type":"prompt","message":"/pr-review 1"}
  ```
- **Resultado (1ª tentativa, deepseek-v4-flash):** o comando enfileirou o prompt de review ao modelo; o modelo respondeu **vazio** (assistant sem texto e sem tools) → telemetria `completion: cleared`. **Não é bug de fork** — é qualidade/resposta de modelo (deepseek-v4-flash engasgou no prompt longo). Retry com `--model opencode-go/minimax-m2.7`:
  - Modelo buscou PR/diff via `gh`, chamou `review_subagents` → **5/5 passes completaram** (max_parallel=5; tiers light/medium/heavy; childs `pi` isolados herdando o agente dir via env).
  - Review final JSON: **1 finding P1** (o bug seedado, localizado em `multiply.js:9`, `confidence 1.0`), **verdict `request_changes`**.
  - Telemetria: `completion: terminal_response`, 66.7s.
- **Data:** 2026-08-06 · **Resultado: PASSA.**
- **Classificação:** dispatch compatível (reviewers do pr-review coexistem e completam com o umbrella carregado, incluindo `@runecraft/subagents`). Nota: os reviewers do pr-review usam **próprios subprocessos pi** (não a tool `subagent` do nosso fork) — a compatibilidade validada é de convivência, não de delegação interna. Limpeza: repo GitHub **pendente de exclusão** (token sem escopo `delete_repo`; ver Pendências).

---

## COEX-05 — Fluxo SDLC E2E (hello world do harness)

- **Requisito:** goal trivial com `Done when:` → implementação via dispatch → auditor isolado verifica com evidência → ciclo fecha; comandos, tempos e tokens documentados como hello world.
- **Setup:** repo `coex05` (git init). **Prompt único RPC:**
  ```
  /goal "Create a file greeting.txt whose content is the exact text 'hello harness'. Done when: greeting.txt exists in the repo root and its content is exactly 'hello harness'."
  ```
- **Transcrição do ciclo (`.pi-glla/active.jsonl`):**
  1. `goal_created` `20260806221142-v1k0jg` — contrato extraído do `Done when:`: `greeting.txt exists in the repo root and its content is exactly 'hello harness'.`
  2. `goal_continuation_sent` — loop pusha continuation.
  3. Modelo implementa (3× `bash`; `greeting.txt` com 13 bytes exatos).
  4. `complete_goal` → status `auditing` → auditor isolado roda (deepseek-v4-flash, thinking high, 10.6s): usa apenas tools de leitura (`ls`, `stat`, `od -c`, `wc -c`, `cmp`), evidência crua no report, `regressionShieldPassed: true`, `<approved/>`.
  5. `goal_archived` `complete`, `stopReason: auditor deepseek-v4-flash approved`, `reviewer_fired`.
- **Números (reproduzíveis):**
  - Wall time total: **23.4s** (goal_created → estado final completo).
  - Auditor: 10.6s.
  - Tokens (5 turns do modelo, `message_end.usage` somado): input **22 445** · output **896** · cacheRead **109 824** · custo **≈ US$ 0.004**.
- **Data:** 2026-08-06 · **Resultado: PASSA.**
- **Classificação:** hello world do harness — 1 comando (`/goal "… Done when: …"`) cobre goal loop + implementação + auditor isolado + fechamento. Reprodução idêntica no TUI (tmux) também validada em `coex01` com o mesmo formato.

---

## COEX-06 — Auditor isolado permanece SEM extensões sob o umbrella

- **Requisito:** isolamento do auditor não pode ser quebrado pelo harness.
- **Verificação (2 camadas):**
  1. **Por construção (código do fork, `extensions/goal-loop-auditor.ts` `makeAuditorResourceLoader`):** o auditor roda via `createAgentSession` com resource loader que **hardcoda** `getExtensions → { extensions: [], … }`, `getSkills → { skills: [] }`, `getPrompts → { prompts: [] }`, `getThemes → { themes: [] }`, `getAgentsFiles → { agentsFiles: [] }`, system prompt substituído pelo de auditor, e `tools: ["read","grep","find","ls","bash"]` (sem editor, sem subagents, sem taskflow). O umbrella não participa desse loader — isolamento não depende de config.
  2. **Empírica (3 runs reais — COEX-02/03/05):** os 3 audit reports usaram somente comandos de leitura (`ls`, `cat`, `wc`, `od`, `stat`, `cmp`); nenhum artifact de subagents (`$REPO/.pi-subagents/`) foi criado pelo auditor; nenhuma chamada a tools de extensão.
- **Data:** 2026-08-06 · **Resultado: PASSA.**
- Observação: o **child de subagents** (COEX-02) NÃO é isolado — herda o harness completo (stderr do child mostrou `[taskflow] Model roles not configured`). Isso é comportamento esperado do dispatch; o isolamento existe só no auditor (e nos reviewers do pr-review, que são subprocessos próprios).

---

## Edge Cases (spec)

### Edge-1 — Batching vs push do goal (notificação de completion)

Comportamento observado e documentado:

| Driver | Mecanismo | Evidência |
|---|---|---|
| goal-loop-audit | **PUSH**: a cada `agent_end`/idle, `sendContinuation` enfileira continuation com `triggerTurn` imediato (`goal_continuation_sent` logado no ledger). | `goal_continuation_sent` em todos os `.pi-glla/active.jsonl` dos cenários. |
| subagents (async) | **BATCH**: `completion-batcher.ts` segura notificações de completion 150ms–1s (defaults `debounceMs:150, maxWaitMs:1000`, straggler 75ms/400ms) e entrega agrupadas. | Fonte do fork; 2 subagents em COEX-02 sem notificação duplicada. |

Em COEX-02 os dois mecanismos operaram na mesma sessão sem disputa de canal: o loop do goal usa mensagem custom `goal-event`/`followUp` para continuation; subagents usam notificação própria de completion de run. **Sem conflito observado.**

### Edge-2 — Dois cenários paralelos no mesmo repo

- **Setup:** repo `edge-conc`; sessão A (RPC) `/goal "Create alpha.txt…"` e sessão B (RPC) `/goal "Create beta.txt…"` simultâneas, mesmo cwd.
- **Resultado (22:56:15–22:56:36):** ambos os goals foram criados e **ambos completaram** (`alpha.txt` e `beta.txt` criados; 2 auditorias em `audits.jsonl`, ambas `approved`). Porém o `active.jsonl` mostra **raça de estado**: a ativação do goal da sessão A pausou e marcou `aborted` o goal da sessão B **enquanto** a auditoria de B já estava em voo; a auditoria de B ainda assim aterrissou e sobrescreveu para `complete`. Sequência observada: beta `active → paused → aborted` · alpha `active → auditing → complete` · beta `auditing → complete`.
- **Classificação: limite documentável.** Oficialmente **não suportado** (uma sessão = um goal ativo por cwd; o goal-loop nem oferece lock cross-process). No teste, o JSONL sobreviveu sem corromper (append pequeno), mas o resultado é **não determinístico** (depende do timing das auditorias). Recomendação: rodar cenários concorrentes em repos/cwds diferentes.

---

## Achados e bugs registrados

> Regra F7: nenhum código de fork/harness foi alterado. Bugs viram issue própria. Repros mínimos abaixo.

### BUG-1 — `@runecraft/taskflow` (fork F3): import dinâmico não renomeado quebra `verify`/`compile`/`compile-ir`

- **Sintoma:** tool `taskflow` com `action:"verify"` (ou `compile`, `compile-ir`) falha com:
  ```
  Cannot find package 'taskflow-core' imported from …/node_modules/@runecraft/taskflow/dist/index.js
  ```
- **Causa:** `packages/taskflow/pi/src/index.ts` linhas **914, 971, 1016, 1691, 1716** usam `await import("taskflow-core")` — o rename do fork (F3) aplicou o escopo `@runecraft/` nos imports estáticos (linhas 16–27) mas **não nos dinâmicos**. O umbrella não publica `node_modules/taskflow-core` (unscoped).
- **Repro mínimo** (sessão com harness instalado, agent dir isolado):
  ```
  pi -p "Call the taskflow tool with action 'verify' and define {name:'repro',phases:[{id:'p1',agent:'scout',task:'list files'}]}. Report the exact result."
  # → Cannot find package 'taskflow-core' imported from .../@runecraft/taskflow/dist/index.js
  ```
- **Impacto:** todo fluxo que valide/compile um flow antes de rodar quebra. `action:"run"` (caminho de execução) **não** usa os imports dinâmicos e funciona (validado) — exceto pelo BUG-2.
- **Classificação:** **bug de fork** (rename incompleto).

### BUG-2 — `@runecraft/taskflow-core` (fork F3): `dist/agents/` não é empacotado → built-in agents ausentes → run falha `Unknown agent: default`

- **Sintoma:** `taskflow` `action:"run"` com `agent:"scout"` falha com `Unknown agent: default` (fase `failed`, `error: "Unknown agent: default"`).
- **Causa:** `discoverAgents` (core `src/agents.ts`) lê built-ins de `import.meta.dirname/agents` = `dist/agents/`. O upstream publica **22 arquivos** em `dist/agents/` (verificado: `npm pack taskflow-core@0.2.6` contém `dist/agents/*.md`); o build do fork foi simplificado para `rm -rf dist && tsc …` e **removeu o passo `node ../../scripts/copy-agents.mjs`** do script upstream (`copy-readme.mjs`/`stamp-build-info.mjs` foram removidos de propósito; `copy-agents.mjs` é runtime-data e não deveria ter saído). Resultado: `dist/agents/` não existe → zero built-ins → o runner cai no agente fallback `default`.
- **Repro mínimo:**
  ```
  pi -p "Call the taskflow tool with action 'run' and define {name:'r',chain:[{task:'List files',agent:'scout'},{task:'Write filelist.txt',agent:'worker'}]}. Report the result."
  # → Taskflow 'r' failed (0/2 done) — phase step1 error: Unknown agent: default
  ```
- **Workaround usado nos cenários (sem tocar no fork):** `ln -s <packages/subagents>/agents <agentdir>/agents` — expõe `scout`/`worker`/… como agentes de usuário; com isso o DAG roda (validado: `repro-run2 completed (2/2)`).
- **Classificação:** **bug de fork** (packaging/build).

### Observações não-bug (registradas para o F8/doc)

1. **pr-review + deepseek-v4-flash:** o modelo respondeu vazio ao prompt de review (1ª tentativa, `completion: cleared`). Contorno com `minimax-m2.7`. Não é bug de fork; é recomendação de modelo para pr-review (docs F8 devem sugerir modelos que lidam com o prompt longo).
2. **Aviso de boot do goal-loop:** `session provider "opencode-go" is not a known built-in. The auditor inherits the resolved model in-process` — informativo; auditoria funcionou normalmente.
3. **taskflow boot warning:** `[taskflow] Model roles not configured — Run /tf init` — setup opcional (F14 settings merge), não é erro.
4. **MCP/footer em sessão TUI isolada:** pi lê `~/.agents/skills` (home) mesmo com `PI_CODING_AGENT_DIR` isolado; não interfere nos forks, mas documentar no F8 que a isolação de skills por agent-dir não cobre `~/.agents`.

---

## Pendências

- **Excluir repo GitHub `runecraft-f7-pr-test`** (privado, descartável): token atual sem escopo `delete_repo`; `gh auth refresh -h github.com -s delete_repo` exigiria aprovação interativa. Deletar manualmente ou autorizar o escopo.
- **Issues a abrir** (repros prontos na seção Achados): BUG-1 e BUG-2 do taskflow (F3).
- **F8 (docs):** incorporar limite do Edge-2 (concorrência por repo não suportada), a nota do Edge-1 (push vs batching) e as recomendações de modelo do pr-review.
- **Re-validar COEX-04** com `delete_repo` autorizado para fechar a limpeza, ou aceitar o repo privado como fixture permanente.

---

## Critérios de sucesso (spec) — status

- [x] Todos os cenários executados com resultado registrado (COEX-01..06 + 2 edge cases)
- [x] Zero conflitos arquiteturais NÃO documentados (2 bugs de fork registrados; 0 conflitos de coexistência)
- [x] "Hello world" SDLC reproduzível a partir da doc (COEX-05: 1 prompt, 23.4s, ~US$ 0.004)
