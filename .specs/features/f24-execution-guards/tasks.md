# F24 — Tasks (Execution Guards — tool_call blocking)

**Base:** design.md D1–D12 (aprovado) · infra reutilizada: F21 (fixture/evidência/EVAL-MATRIX), F13/F14 (state/merge), F20 (fail-closed/kill switch), F15 (renderRules)

## T1 — guardKit + registry (D1/D2/D12)

- [ ] `src/guards/guardKit.ts`: `isToolCallEventType(name, event)` (write/edit + tools de todo), `block(reason)` → `{ block: true, reason }` (formato `<guardId>: <mensagem>`, sem path absoluto — D3), `loadGuardConfig(pi)` (state read-only F13, kill switch `RUNECRAFT_GUARDS=0`, freeze por sessão D12), logger dedicado (sem console.log)
- [ ] `src/guards/index.ts`: `installGuards(pi)` — registry D1 (espelho do create-hooks do guild); ordem de registro documentada (write-guard → ranger → todo-*); um guard com config inválida não derruba os outros (D10)
- [ ] **Verificar:** unit com evento fake: block retorna shape exato; kill switch desliga tudo; config inválida de um guard → os demais operam; logger não vaza para stdout da sessão

## T2 — write-existing-file-guard (GUARD-01/02)

- [ ] `src/guards/write-existing-file-guard.ts`: intercepta `write`/`edit`; resolve path real (realpath/symlink — edge); path existe → `{ block: true, reason }`; path novo → passa; `allow`/`force` no config → passa (AC 1.2); reason com path relativo ao cwd (D3)
- [ ] **Verificar:** unit (evento fake): existente bloqueia, novo passa, allow passa, symlink para alvo existente bloqueia · integração EVAL-006: sessão Pi com fixture, script induz write sobre existente → transcript com o block; desvio (guard off) → teste falha com diagnóstico

## T3 — ranger-md-only (GUARD-03)

- [ ] `src/guards/ranger-md-only.ts`: agente atual ∈ `guards.rangerMdOnly.mdOnlyAgents` → extensão ∉ {md, MD, Markdown} (case-insensitive) → block; lista vazia (default v1) → inerte (D5); texto da regra reusa a linguagem de constraints do F15 (renderRules)
- [ ] **Verificar:** unit: `.ts` bloqueia para agente da lista, `.md`/`.MD` passa, agente fora da lista passa, lista vazia → nada bloqueia · integração com fixture de agente md-only (agentDir temp)

## T4 — todo-description-override (GUARD-04)

- [ ] `src/guards/todo-writer.ts`: formato canônico de todo (critério "Done when" por item) — helper compartilhado
- [ ] `src/guards/todo-description-override.ts`: intercepta a tool de todo do glla (nome a validar no Execute); reescreve `event.input` para o formato canônico; tool executa com o input reescrito (AC 3.1)
- [ ] **Verificar:** unit: descrição livre → input reescrito; input já canônico → inalterado (idempotente) · integração EVAL-007 parcial: transcript mostra o input reescrito

## T5 — todo-continuation-enforcer (GUARD-05)

- [ ] `src/guards/todo-continuation-enforcer.ts`: hook `turn_end`/`agent_end` (evento a validar no Execute); lê o ledger de todos do glla (formato a validar no Execute); pendências → block com reason listando itens; sem pendências → passa; guard desabilitado → não intervém (AC 3.2–3.4)
- [ ] **Verificar:** unit com ledger fake: pendência bloqueia com reason listando itens; tudo done passa; disabled passa · integração EVAL-007 completo

## T6 — Config/status/doctor/sync (GUARD-06)

- [ ] `src/state.ts` aditivo: `guards: Record<GuardId, { enabled, options? }>` (schemaVersion 1 — precedente F15 T1); parser tolerante a campos desconhecidos
- [ ] `doctor` check "guards" (por guard: enabled/disabled + config válida; inválida → fail-closed reportado); `status --json` seção `guards` (estado + kill switch); `sync` re-aplica config ao state (SETM F14, idempotente)
- [ ] **Verificar:** fixture → doctor/status refletem config; config com tipo errado → doctor reporta + guard opera fail-closed; sync re-aplica sem diff residual

## T7 — Testes determinísticos + evidência (GUARD-07)

- [ ] `test/guards/setup.ts` (preload): env isolado (HOME temp, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `PI_CODING_AGENT_DIR` temp — padrão F21 D3)
- [ ] `test/guards/write-guard.test.ts`, `ranger-md-only.test.ts`, `todo-guards.test.ts`, `config-status.test.ts`, `adversarial.test.ts` (desvio induzido → falha com diagnóstico; golden de reason estável — sem $TMP/$TS/$PORT)
- [ ] Evidência via `evalTest()` (F21 D10) nos mesmos `partial/*.jsonl`; merge existente inclui guards; golden de reason versionado
- [ ] **Verificar:** `bun test test/guards test/eval` verde offline/$0 (loopback, apiKey literal, zero fetch externo); desligar um guard no meio → falha com diagnóstico; evidência aparece no last-run.json

## T8 — Matriz/ROUTING/docs (GUARD-08)

- [ ] EVAL-MATRIX aditivo: EVAL-006 (write-guard block) + EVAL-007 (todo enforcer) com bump de MATRIX_VERSION (política F21 D9); teste de consistência matriz ↔ testes
- [ ] ROUTING.md seção "Guards": o quê cada guard bloqueia, Pi-only, detect-only para não-Pi (F15 ADPT-03); coluna guards na matriz do F17
- [ ] **Verificar:** entrada EVAL-006/007 na matriz ↔ testes existentes (consistência); ROUTING.md goldens (F19 D9) atualizados e verdes

## Success Criteria (spec)

- [ ] Write sobre arquivo existente bloqueado de verdade em sessão Pi (fixture), com reason; allow/force e kill switch verificados
- [ ] Ranger md-only bloqueia não-`.md` para agentes da lista; default v1 inerte
- [ ] Todo override reescreve input; enforcer bloqueia conclusão com pendências
- [ ] doctor/status refletem guards; config inválida → fail-closed reportado
- [ ] Suite de guards offline/$0 em CI, com evidência JSON para o F23; EVAL-006/007 na matriz
