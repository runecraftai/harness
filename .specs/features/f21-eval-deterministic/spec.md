# F21 — Suite Determinística (fixture de modelo) Specification

**Scope:** Large (infra de teste: SDK Pi inMemory + servidor OpenAI-wire fixture)
**Prereq:** F7 ✓ (cenários), F11 ✓ (CLI existe), F13 ✓ (state/backups testáveis)
**Grupo:** EVAL (F21–F23) — evals garantem o harness (AD-010)

## Problem Statement

O harness precisa de garantia contínua sem custo de tokens. Pesquisa (2026-08-05) verificou: o gentle-ai testa agentes deterministicamente com um servidor HTTP local OpenAI-wire (agente real executa os passos de verdade; só a escolha do tool call é fakeada, com fixture adversarial que inspeciona requests e falha em desvios); no Pi não existe provider fake built-in, mas há 3 mecanismos: `models.json` com `baseUrl` loopback + apiKey dummy (`compat.supportsDeveloperRole: false`), `pi.registerProvider(createProvider({id, baseUrl, api: openAICompletionsApi(), models: []}))`, e SDK `createAgentSession({model, modelRuntime})` com `InMemoryCredentialStore` (zero rede). Para headless: `SessionManager.inMemory()` ("for testing"), `runPrintMode`/`runRpcMode`. F21 constrói a suite em 2 camadas: (1) sem modelo — comandos do CLI contra fixtures; (2) com fixture — fluxos SDLC com agente real + escolha fakeada.

## Goals

- [ ] Camada 1 (sem modelo): comandos do CLI (install/dry-run/doctor/status/sync/uninstall/gates) exercitados contra fixtures (config dirs fake via `RUNECRAFT_*_HOME`, fake pi via `RUNECRAFT_PI_BIN`) com asserts de efeito (diff de arquivos, state, backups) — determinístico, offline, $0
- [ ] Camada 2 (fixture OpenAI-wire): fluxos SDLC críticos (goal → dispatch → auditor → review) com sequência de tool calls scriptada e fixture adversarial
- [ ] Roda em CI sem tokens e sem rede; falha o pipeline em regressão
- [ ] Base do F23 (ratchets) e do F22 (E2E com modelos reais)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Benchmarks de performance/fricção | F21 é correção, não medição (o gentle-ai separa bench/ de testes) |
| E2E com modelos reais | F22 (env-gated) |
| Cobertura de TUI/interação visual | Extensões TUI têm testes próprios dos forks |
| Provar que um modelo vivo produziria os mesmos tool calls | Limitação declarada do próprio gentle-ai (fora do merge gate) |

## Gray area (resolver no Design)

**Escopo da camada 2**: quais fluxos entram na sequência scriptada (custo de manutenção é real — cada mudança de prompt quebra o script). Proposta: só os fluxos críticos do hello world (F7/F19) — goal trivial + auditor + review; subagents/taskflow entram como workers. A decisão de "o que entra" vira um `test/EVAL-MATRIX.md` versionado (aditivo, nunca removido sem AD).

**Onde vive**: `packages/harness/test/eval/` (unit+fixture, bun test) vs `scripts/eval/` separado. Recomendado: dentro do package harness (`test/eval/`) — perto do código, roda com `bun test`; E2E reais (F22) ficam em `scripts/eval-e2e/`.

## User Stories

### P1: Camada 1 — CLI contra fixtures ⭐ MVP

**User Story**: Como mantenedor, quero que cada comando do CLI seja testado contra fixtures sem rede nem tokens, para regressão barata e instantânea.

**Why P1**: É a garantia do dia a dia (o que roda em toda PR).

**Acceptance Criteria**:

1. WHEN `bun test` roda THEN os comandos install (com dry-run e presets), doctor, status, sync e uninstall SHALL ser exercitados contra fixtures (config dirs fake + `RUNECRAFT_PI_BIN` fake) com asserts de efeito real (diff dos arquivos alvo, conteúdo do state, snapshots de backup)
2. WHEN um comando falha num fixture THEN o teste SHALL falhar com o diff do efeito esperado vs. real
3. WHEN a suite roda offline THEN SHALL não tentar rede nem tokens (nenhum processo toca o registry ou APIs)
4. WHEN os casos do F15 (fail-closed, dry-run zero writes, não-clobber, uninstall remove só o gerenciado, colisão reportada) rodam THEN eles SHALL ser os mesmos testes da suite (golden fixtures de before/after)

**Independent Test**: `bun test` verde offline; quebrar um template → teste falha apontando o golden.

### P1: Camada 2 — fixture OpenAI-wire ⭐ MVP

**User Story**: Como mantenedor, quero rodar fluxos SDLC reais com a escolha do modelo fakeada, para provar que o harness orquestra as ferramentas na ordem certa sem gastar tokens.

**Why P1**: É o que o gentle-ai prova (testes de agente real determinísticos) — o diferencial dos nossos evals.

**Acceptance Criteria**:

1. WHEN um fluxo SDLC (goal → dispatch via subagent → auditor isolado → review) roda contra o provider fixture THEN a sequência de tool calls SHALL seguir o script (contador+switch: call 1 → X, call 2 → Y…) e o agente SHALL executar cada passo de verdade (bash/git reais em repo de teste descartável)
2. WHEN a evidência chega fora de ordem ou há tool call extra THEN o fixture SHALL falhar (adversarial — padrão gentle-ai)
3. WHEN o fluxo usa o auditor isolado (goal-loop) THEN o auditor SHALL rodar sem extensões (isolamento real verificado — F7 edge)
4. WHEN a suite roda THEN SHALL ser offline e $0 (apiKey literal "fixture", baseUrl loopback)

**Independent Test**: runPrintMode/`--mode rpc` com provider fixture → transcript confere com o script; desvio induzido → falha do fixture.

### P2: Integração CI

**User Story**: Como mantenedor, quero que a suite rode em toda PR, para que regressão nunca chegue ao main.

**Why P2**: CI é onde a garantia se paga (F9 lane).

**Acceptance Criteria**:

1. WHEN a PR abre THEN a suite determinística SHALL rodar (sem tokens, sem rede) e bloquear merge em falha
2. WHEN a suite passa THEN a evidência (JSON de resultados) SHALL ser gravada para o F23 (ratchets)

**Independent Test**: pipeline CI com a suite → verde; introduzir regressão → vermelho.

## Edge Cases

- WHEN um teste depende de git config global do runner THEN SHALL isolar (repo de teste com config local, padrão F13/fixtures)
- WHEN o timing varia (CI lento) THEN os testes SHALL não depender de timeout mágico (waits explícitos em evidência, não sleep)
- WHEN o fixture recebe request de modelo desconhecido THEN SHALL falhar com a lista de calls esperadas (diagnóstico)
- WHEN a suite roda em paralelo THEN os fixtures SHALL usar portas efêmeras (port 0) e repos descartáveis por teste

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DETR-01 | P1: Camada 1 (AC 1.1 cobertura de comandos) | Design | Pending |
| DETR-02 | P1: Camada 1 (AC 1.2/1.3/1.4 determinismo/offline/goldens) | Design | Pending |
| DETR-03 | P1: Camada 2 (AC 2.1 sequência scriptada) | Design | Pending |
| DETR-04 | P1: Camada 2 (AC 2.2 adversarial) | Design | Pending |
| DETR-05 | P1: Camada 2 (AC 2.3/2.4 isolamento/offline) | Design | Pending |
| DETR-06 | P2: CI (AC 3.1/3.2) | Design | Pending |

**Coverage:** 6 total, 0 mapeados, 6 unmapped

## Success Criteria

- [ ] Suite offline/$0 rodando em CI (camadas 1 e 2)
- [ ] Fixture adversarial falha em desvios de sequência (teste induzido)
- [ ] Evidência JSON gravada para os ratchets (F23)
