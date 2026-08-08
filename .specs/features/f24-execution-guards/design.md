# F24 Design — Execution Guards (tool_call blocking)

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** guards como extensões Pi dentro do `@runecraft/harness` (registry único + guard por módulo, espelho do `create-hooks.ts` do guild) · config via state.json (F13) com merge (F14), sem superfície nova · fail-closed por padrão + kill switch `RUNECRAFT_GUARDS=0` (padrão F20) · ranger-md-only v1 config-gated com lista vazia por default (ativa no F32) · testes offline/$0 na infra do F21 + EVAL-006/007 aditivos na EVAL-MATRIX

## Contexto

F21 provou a infra: fixture OpenAI-wire (chatServer, ScriptedScenario, adversarial), materialização de extensões dos forks em `PI_CODING_AGENT_DIR` temp (mecanismo H1 do F6 — validar no Execute), evidência JSON (evalTest → last-run.json → ratchet F23). O handoff guild→pi (tabela 4.2) verificou fato-a-fato a API de extensão do Pi: `pi.on("tool_call", ...)` recebe o evento antes da execução e `return { block: true, reason }` **impede de verdade** o tool — no OpenCode o mesmo guard era um aviso no prompt que a LLM podia ignorar. É a peça que justifica o harness sobre os adapters: o Pi é o único alvo com enforcement real, e F24 entrega isso como produto.

Cadeia que F24 fecha: F15 fornece `renderRules()`/linguagem de constraints (fonte do texto do ranger); F20 fornece o padrão fail-closed + kill switch; F21 fornece fixture + materialização + evidência; F13/F14 fornecem state + merge. F24 entrega os guards; F25 consome os denial gates no HALT policy; F26 testa constraint adherence formalmente (evaluator `tool-policy`); F32 ativa o ranger-md-only para o papel auditor.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Registry único + guard por módulo**: `src/guards/index.ts` com `installGuards(pi)` registrando os guards; cada guard em `src/guards/<nome>.ts` expondo `{ id, configSchema, handlers }`; helpers comuns em `src/guards/guardKit.ts` | Espelho do `create-hooks.ts` do guild (registro central, handler por hook); testabilidade unitária por módulo; um guard novo = um arquivo novo |
| D2 | **Config no state.json (F13)**, campo aditivo `guards: Record<GuardId, { enabled: boolean; options?: ... }>` (schemaVersion permanece 1 — precedente F15 T1); merge por overlay (F14 two-pass SETM-04); **kill switch por env** `RUNECRAFT_GUARDS=0` (F20) | Sem superfície de config nova; state já é o contrato do harness; env é o mecanismo de emergência (não precisa editar arquivo); config inválida → fail-closed (bloqueia) |
| D3 | **Bloqueio = `{ block: true, reason }`** com `reason` no formato `<guardId>: <mensagem>`; **nunca** embute path absoluto do runner (só o path relativo ao cwd da sessão) nem timestamp | Normalização do F21 D10 exige identidade estável na evidência; o reason é lido pela LLM e gravado no transcript |
| D4 | **Interceptação via `isToolCallEventType("write"|"edit", event)`** (padrão do handoff 4.2); tools de todo: nomes vêm do fork glla (`todowrite`?) — **validar no Execute** e corrigir in-place na matriz com nota datada (política F21 D9) | Fato verificado no handoff; nomes de tools do glla só confirmáveis no código do fork |
| D5 | **Ranger md-only v1 config-gated**: lista `guards.rangerMdOnly.mdOnlyAgents: string[]`; **default = lista vazia** (guard ativo, inerte); F32 registra o papel auditor na lista | Não há agentes objetivos ainda (F32); guard pronto e testado, sem efeito colateral em sessões normais |
| D6 | **Todo enforcer v1 = check em `turn_end`/`agent_end`**: lê o estado de todos (arquivo/ledger do fork glla — formato a validar no Execute), bloqueia conclusão com reason listando pendências | `agent_settled`/`turn_end` são os eventos de fim de turno verificados no handoff; o formato do todo state vem do fork |
| D7 | **Testes em `packages/harness/test/guards/`**: (a) unit por módulo (evento fake, sem sessão), (b) integração na infra do F21 (chatServer + agentDir temp com as extensões materializadas via H1/F6), (c) adversarial (desvio induzido → falha com diagnóstico); evidência via `evalTest()` (F21 D10) | O custo de sessão real é alto; unit cobre a lógica, integração prova o bloqueio no loop real do Pi (transcript), adversarial prova que o mecanismo não regride |
| D8 | **Empacotamento**: source em `src/guards/`, entregue como extensão Pi do harness (manifest `pi` do F6 — MECANISMO de copy/symlink = H1 do F6, validar no Execute); extensões carregam **só em sessões gerenciadas pelo harness** (agentDir materializado), nunca global | Guards são política do harness, não do usuário; escopo por sessão evita surpresa fora do fluxo gerenciado |
| D9 | **Matriz/ROUTING honestos**: guards = coluna Pi-only (F17); ROUTING.md ganha seção "Guards" (o quê cada guard bloqueia, Pi-only, detect-only para não-Pi — F15 ADPT-03); doctor/status listam guards (F12, checks aditivos) | Não prometer enforcement onde é impossível; a matriz é o contrato de honestidade do produto (F15/F17) |
| D10 | **Fail-closed por padrão**: guards habilitados em sessões gerenciadas; desabilitar é config explícita; config inválida de UM guard não desliga os outros (isolamento por guard, padrão F15 D2) | Pilar guardrails; isolamento evita que um bug de config derrube todos |
| D11 | **Interação F20**: receipt gates continuam shell-level (pré-commit/pre-push); guards são session-level; a integridade de arquivo é verificada nas duas camadas com a MESMA semântica (existência/hash) — complementares, não redundantes (receipt pega o que escapa da sessão; guard pega o que o receipt não vê) | Um hook de receita não roda dentro da sessão; um guard não roda fora dela — juntos cobrem o ciclo |
| D12 | **Estado congelado por sessão**: config de guards lido no `session_start` e mantido durante a sessão (sem drift mid-turn) | Edge da spec (config mudando no meio); previsibilidade do comportamento |

## Arquitetura — módulos

```
packages/harness/
├── src/
│   └── guards/
│       ├── index.ts                  # installGuards(pi) — registry (D1)
│       ├── guardKit.ts               # isToolCallEventType, block(), loadGuardConfig()
│       │                             #   (state read-only, kill switch, freeze por sessão D12),
│       │                             #   logger (sem console.log — regra do guild)
│       ├── write-existing-file-guard.ts   # GUARD-01/02 (D3/D4)
│       ├── ranger-md-only.ts              # GUARD-03 (D5)
│       ├── todo-description-override.ts   # GUARD-04 (reescrita de event.input)
│       ├── todo-continuation-enforcer.ts  # GUARD-05 (D6)
│       └── todo-writer.ts                 # helper compartilhado dos todo-* (formato canônico)
├── test/
│   ├── EVAL-MATRIX.md                # + EVAL-006 (write-guard), EVAL-007 (todo enforcer) — aditivo
│   ├── golden/                       # goldens de reason (identidade estável p/ F23)
│   └── guards/
│       ├── setup.ts                  # preload: env isolado (F21 D3: GIT_CONFIG_*, HOME temp)
│       ├── write-guard.test.ts       # unit + integração EVAL-006
│       ├── ranger-md-only.test.ts    # unit (case-insensitive, symlink, lista vazia)
│       ├── todo-guards.test.ts       # unit override/enforcer + integração EVAL-007
│       ├── config-status.test.ts     # doctor/status/sync/kill switch/config inválida (GUARD-06)
│       └── adversarial.test.ts       # desvio induzido → diagnóstico (GUARD-07/08)
└── package.json                      # test: "bun test test/guards test/eval" (mesma lane F21)
```

## Fluxos

### F1 — Write guard (GUARD-01/02)

```
1. session_start: guardKit.loadGuardConfig() — lê state (F13), congela por sessão (D12)
2. pi.on("tool_call") → isToolCallEventType("write"|"edit", event)
3. path alvo resolvido (symlink real — edge); RUNECRAFT_GUARDS=0? → passa (kill switch)
4. write-existing-file-guard: existe? → { block: true, reason: "write-existing-file-guard: ..." }
   (reason sem path absoluto — D3) · allow/force no config → passa
5. ranger-md-only: agente atual ∈ mdOnlyAgents? → extensão ∉ {md,MD,Markdown}? → block
6. transcript registra o reason; fixture adversarial valida reason estável (sem $TMP/$TS)
```

### F2 — Todo guards (GUARD-04/05)

```
1. tool_call de todo (nome do fork validar no Execute) → todo-description-override
   reescreve event.input para o formato canônico ("Done when" por item) e deixa executar
2. turn_end/agent_end → todo-continuation-enforcer lê o ledger de todos do fork (formato a
   validar no Execute); pendências? → block com reason listando itens (GUARD-05)
3. sem pendências → passa
```

### F3 — Testes (GUARD-07)

```
unit: evento fake por módulo (write/edit/todo fake, config fake) — centenas de asserts, sem sessão
integração (EVAL-006/007): chatServer (F21) + agentDir temp com extensões materializadas
  (H1/F6) → sessão Pi real → script induz write sobre existente → transcript tem o block;
  adversarial: guard desligado no config → teste falha com diagnóstico
evidência: evalTest() grava partial/*.jsonl → merge → last-run.json (F21 D10, consumido no F23)
```

### F4 — Config/status (GUARD-06)

```
state.json aditivo: guards.<id> = { enabled, options } (D2)
doctor: check "guards" — por guard: enabled/disabled + config válida; inválida → fail-closed reportado
status --json: seção guards (estado + kill switch); sync: re-aplica config ao state (SETM F14)
```

## EVAL-MATRIX — entradas aditivas (política F21 D9)

| ID | Fluxo | Ferramentas | Script esperado | Notas |
| --- | --- | --- | --- | --- |
| EVAL-006 | write sobre arquivo existente em sessão gerenciada | guards (write-existing-file-guard) | 1. sessão abre com guards on; 2. modelo tenta `write` em path existente; 3. tool bloqueado com reason; 4. modelo tenta `write` em path novo → passa | valida o bloqueio REAL no loop do Pi; reason estável (normalização F21) |
| EVAL-007 | conclusão com todos pendentes | guards (todo-*) | 1. todowrite com descrição livre → input reescrito (override); 2. modelo tenta concluir com pendências → bloqueado (enforcer); 3. marca tudo done → conclui | nomes de tools do glla validar no Execute |

## Integração CI

- **Roda com**: mesma lane do F21 — `turbo test` → `bun test test/guards test/eval` (offline/$0 por construção: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`)
- **Evidência**: `evalTest()` grava nos mesmos `partial/*.jsonl`; o merge do F21 (eval-merge-evidence) inclui os guards automaticamente (mesmo schema); ratchet do F23 cobre
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Nomes de tools de todo do glla divergem** | Validar no Execute contra o código do fork; correção in-place na matriz com nota datada (F21 D9); teste falha apontando o nome esperado |
| **Mecanismo H1 do F6 (copy vs symlink) não materializa a extensão nova** | Validar no Execute; helper fixtureHome (F21) espelha o mecanismo; fallback: symlink manual no teste |
| **Reason com path/timestamp vaza para a evidência** | D3 (nunca path absoluto/timestamp); golden de reason + adversarial valida identidade estável |
| **Bypass por symlink no write-guard** | Resolve o alvo real (realpath) antes da checagem de existência (edge da spec) |
| **Config inválida derruba todos os guards** | D10 (isolamento por guard, F15 D2); doctor reporta; fail-closed por guard |
| **Drift de config no meio da sessão** | D12 (estado congelado por sessão) |
| **Extensões carregam em sessões não gerenciadas** | D8 (materialização só em agentDir gerenciado pelo harness); teste garante ausência em agentDir limpo |
| **Evento de fim de turno indisponível (turn_end vs agent_end)** | Handoff verifica ambos; validar no Execute qual o enforcer usa; fallback documentado |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| GUARD-01 | P1: Write guard (bloqueio + arquivo novo) | D1/D3/D4 + F1 (write-existing-file-guard.ts) + EVAL-006 |
| GUARD-02 | P1: Write guard (allow/force + kill switch) | D2/D3 + guardKit (kill switch) + config-status.test.ts |
| GUARD-03 | P1: Ranger md-only | D5 + ranger-md-only.ts + ranger-md-only.test.ts |
| GUARD-04 | P2: Todo override | D1/D4 + todo-description-override.ts + F2 |
| GUARD-05 | P2: Todo enforcer | D6 + todo-continuation-enforcer.ts + EVAL-007 |
| GUARD-06 | P2: Config/status/doctor/sync | D2/D10 + F4 + config-status.test.ts |
| GUARD-07 | P2: Testes offline/$0 + evidência | D7 + F3 + test/guards/ + Integração CI |
| GUARD-08 | P2: Matriz/ROUTING honesta | D9 + EVAL-MATRIX (EVAL-006/007) + ROUTING.md seção Guards |

**Cobertura:** 8/8 mapeados. Edges da spec: symlink → F1 · `.MD`/case-insensitive → ranger test · reason estável → D3/adversarial · config mid-session → D12 · paralelismo → agentDir por sessão (F21 D3).

**Pontos a validar no Execute** (consolidado): nomes exatos das tools de todo do glla e formato do ledger de todos; mecanismo H1 do F6 para materializar a extensão nova no agentDir; evento do enforcer (`turn_end` vs `agent_end`); se `event.input.path` do Pi vem absoluto (impacta D3) e se `realpath` resolve symlinks de forma confiável; carregamento da extensão com state path sob `HOME` temp.

**Notas de revisão cruzada:** F21 D10 é o contrato de evidência (F24 só consome `evalTest()` — nada de schema novo) · F23 ratchet cobre os guards pela mesma identidade · F25 consome os denial gates (HALT) e a semântica de integridade de arquivo · F26 formaliza constraint adherence com `tool-policy` (sujeitos = estes guards) · F32 liga o ranger-md-only ao papel auditor (lista `mdOnlyAgents`) · F17 matriz ganha a coluna guards (Pi-only) no F24.
