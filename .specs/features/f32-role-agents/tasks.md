# F32 — Tasks (Objective Role Agents)

**Base:** design.md D1–D10 (aguarda QA-1..QA-5 → AD-032) · infra reutilizada: F2 (fork subagents — descoberta `.pi/agents/*.md` + tool `subagent` + shadowing/RPC; consumido READ-ONLY), F13 (state targets + contentHash), F17/F19 (sync three-way por conteúdo; órfãos), F21/F26 (fixture, evalTest, trajectory-assertion/tool-policy, EVAL-MATRIX), F23 (goldens/ratchet), F24 (guard `rangerMdOnly` — default config-gated), F28 (evento delegation = tool subagent), F30 (planned — `models.agents.<id>.fallbackChain`)
**Dependências de decisão:** T1 (QA-1 shadowing — default shadow 4 homônimos + 3 novos) · T1/T5 (QA-2 escopo — default projeto `<cwd>/.pi/agents/`) · T7 (QA-3 composição de review — default reviewer in-loop) · T7 (QA-4 modelos — default sem chains no código) · T4 (QA-5 delegação — default só builder spawna) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — Assets: 7 papéis `.md` (D1/D2/D3, ROLE-01/02/03) — depende QA-1/QA-2

- [ ] `packages/harness/agents/{planner,builder,reviewer,auditor,scout,researcher,security}.md` — frontmatter do fork (name/description/tools/thinking/acceptanceRole/systemPromptMode/output/defaultReads/defaultContext) + corpo com identidade OBJETIVA (zero RPG):
  - planner: tools `read,grep,find,ls,intercom` · `acceptanceRole: read-only` · `output: plan.md` · `defaultReads: context.md` · thinking high · 2 modos (interactive/automatic), clarificação por escopo, NUNCA implementa
  - builder: tools `read,grep,find,ls,bash,edit,write,intercom,contact_supervisor,subagent` · `defaultReads: plan.md` · thinking high · executa o plano, verifica antes de reportar; delega scout/reviewer
  - reviewer: tools `read,grep,find,ls,bash,intercom` (read-only — SEM edit/write) · thinking high · veredito `[APPROVE]/[REJECT]` + resumo + ≤3 blocking issues; approval bias; plan review + work review
  - auditor: tools `read,grep,find,ls,bash,write,intercom` · write restrito a `.md` pelo guard F24 · veredito de conformidade; report em `.md`
  - scout: tools `read,grep,find,ls,intercom` (read-only) · `output: context.md` · thinking low · recon, reporta no retorno
  - researcher: tools `read,grep,find,ls,web_search,fetch_content,get_search_content,intercom` (read-only) · `output: research.md` · cita fontes
  - security: tools `read,grep,find,ls,bash,intercom` (read-only) · triage + fast-exit; classes de vulnerabilidade; veredito estruturado
- [ ] Conteúdo ancorado nas semânticas do arcanum (spec Fatos 3) — sem inventar comportamento; nomes dos papéis = naming travado do roadmap
- [ ] **Verificar:** frontmatter compat com o parser do fork (frontmatter.ts — keys/tools observados nos builtins); deny-list RPG ausente; name == filename; TSC limpo (assets não compilam — validados por teste, T2)

## T2 — Catalog + validação (D3, ROLE-02) — depende T1

- [ ] `src/agents/catalog.ts`: `ROLE_CATALOG` — 7 papéis como DADOS (id/nome/descrição/tools allowlist/constraints/spawnPolicy) — fonte única de verdade para render (T3/T4) e evals (T8)
- [ ] Validação catalog ↔ `.md` (unit): cada `.md` tem frontmatter com keys conhecidas, tools ⊆ vocabulário observado (`read,grep,find,ls,bash,edit,write,glob,intercom,subagent,contact_supervisor,web_search,fetch_content,get_search_content`), `name == filename`, deny-list RPG ausente no corpo; falha → erro com diagnóstico (fail-closed)
- [ ] **Verificar:** unit pura (fs temp + assets do pacote); TSC limpo; zero deps novas

## T3 — Infra de prompts portada (D4, ROLE-04) — paralelo a T2

- [ ] `src/agents/prompt-loader.ts`: port fiel do arcanum `loadPromptFile(promptFilePath, basePath?)` — sandbox (rejeita absoluto; traversal fora de basePath → null); `.md/.txt`; null se ausente; trim
- [ ] `src/agents/prompt-utils.ts`: `isAgentEnabled(name, disabled)` (port fiel)
- [ ] `src/agents/dynamic-prompt-builder.ts`: `categorizeTools` + `buildKeyTriggersSection(agents)` — render data-driven da lista de papéis (nome/descrição/tools) a partir do ROLE_CATALOG (D4); sem AGENT_NAME_VARIANTS RPG (decisão 2)
- [ ] **Verificar:** unit puro — sandbox (traversal `../`, absoluto), determinismo 2 runs byte-idêntico; TSC limpo; zero deps

## T4 — Delegação via template (D5, ROLE-05) — depende T2/T3; QA-5

- [ ] `src/agents/delegation.ts`: `renderDelegationPrompt(delegatorRole, catalog)` — instrui o delegador a usar a tool `subagent` (F2) com `agent: "<papel>"`; inclui `buildKeyTriggersSection` (alvos válidos); política por allowlist (só builder tem `subagent` — QA-5a); espelho do wizard-tool-policy (planner nunca spawna)
- [ ] Template consumido pelos papéis via frontmatter/prompt (builder: "para recon use subagent com agent: scout; para verificação use subagent com agent: reviewer") — render puro, sem runtime
- [ ] **Verificar:** unit — render determinístico 2 runs; lista os 7 papéis; papel sem `subagent` no allowlist NÃO recebe instrução de delegação; TSC limpo

## T5 — Wiring install/sync do alvo agents (D1, ROLE-01) — depende T1; QA-2

- [ ] `install`/`sync`: alvo novo "agents" — copia os 7 assets para `<cwd>/.pi/agents/` (escopo projeto — QA-2a; mkdir recursivo se ausente; precedente agent-management.ts:812); three-way por conteúdo (F19 D7: re-injetado/atualizado vN→vM/preservada (editada)/already in sync); contentHash no state (F13 — targets `agents.pi.targets`; shape a validar no Execute); órfãos reportados nunca removidos (F18)
- [ ] `status`/`doctor`: seção/check informativo (papéis instalados, versão, edições do usuário preservadas; componente subagents ausente → papéis inertes + nota — matriz F17)
- [ ] **Verificar:** workspace temp com `.pi/agents/` fake: 1ª install copia (byte-idêntico aos assets), 2ª idêntico (idempotente), edição do usuário → "preservada (editada)" e NUNCA reescrita, dir ausente criado, fork ausente → inerte; sem regressão nos targets existentes (rules/mcp)

## T6 — Ativação do auditor (D7, ROLE-07) — paralelo

- [ ] Default do state: `guards.rangerMdOnly.mdOnlyAgents` += `"auditor"` (F24 D5 — registro do papel; guard `src/guards/ranger-md-only.ts` INTOCADO; default config-gated existente; sem bump de schema — AD-013)
- [ ] **Verificar:** unit do default (lista contém "auditor"; lista vazia anterior preservada em state existente — merge aditivo F14); EVAL-061 cobre o bloqueio real (T8); TSC limpo

## T7 — Reviewer + interface de modelos (D6/D8, ROLE-06/08) — depende T1; QA-3/QA-4

- [ ] `reviewer.md` com formato de veredito cleric (já em T1) + docs da composição de review: reviewer = revisor read-only IN-LOOP (QA-3a); pr-review (F5) + receipts (F20) donos do fluxo PR; variantes (`review_models` → `reviewer-review-<key>`) = INTERFACE de dados F30 (`models.agents.reviewer.review_models` / `models.agents.security.review_models`) — sem runtime novo
- [ ] Interface de modelos (QA-4a): docs/ROUTING — os 7 ids de papel são ids válidos de `models.agents.<id>.fallbackChain` (F30 D5/D11); NENHUM chain default no código (F30 D4: zero IDs inventados); exemplo de config com a semântica arcanum (pesado: planner/researcher/security · leve: builder/scout · médio: reviewer/auditor — extraída de AGENT_MODEL_REQUIREMENTS) como EXEMPLO de usuário
- [ ] **Verificar:** testes de contrato — `resolveAgentModel` aceita ids de papel via chain custom do state (sem tocar `src/models/` do F30); docs consistentes com o design do F30 (D4/D5/D11); TSC limpo

## T8 — Evals EVAL-057..066 + matriz v10 + MIN_EVIDENCE_FILES (D9, ROLE-09) — depende T1..T7

- [ ] Suite `test/eval/suites/roles.ts` + cases EVAL-057..066 (formato F26; delta vs EVAL-001..056 documentado em comentário em cada case): EVAL-057 render/goldens (7 `.md` == assets byte-a-byte; frontmatter válido; deny-list RPG; tools ⊆ vocabulário), EVAL-058 discovery (fixture `.pi/agents/` → loadAgentsFromDir resolve; shadowing project > builtin), EVAL-059 tool-use scout (trajectory — tool-policy ⊆ read-only), EVAL-060 tool-use builder (write/edit/bash legítimos), EVAL-061 auditor md-only (write `.ts` → block ranger-md-only reason estável; write `.md` ok — identidade do agente propagada, validar no Execute), EVAL-062 routing planner→builder (trajectory-assertion delegationSequence: subagent agent=builder), EVAL-063 routing builder→reviewer (spawn + veredito estruturado), EVAL-064 routing builder→scout (recon pré-build), EVAL-065 delegation-template (render determinístico 2 runs; 7 papéis listados), EVAL-066 models interface (precedência F30 chain de papel; fim-de-chain → null + warn)
- [ ] EVAL-MATRIX v10 aditivo (bump 9→10 **após F31 fechar v9** — one writer thread; EVAL-057..066 + nota datada desbloqueando tool-use correctness + routing completeness no docs/EVAL-FRAMEWORK.md — tabela de dependência F26); consistência matriz↔suites estendida para varrer roles.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest; valor a validar no Execute pós-F29/F30/F31)
- [ ] **Verificar:** EVAL-057..066 verdes offline/$0 na lane F21 (workspace temp, PATH mínimo, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..056; consistência v10 verde

## T9 — Docs (D10, ROLE-10) — paralelo

- [ ] `docs/ROUTING.md` §nova: Objective Role Agents — tabela dos 7 papéis (identidade/tools/constraints/delegação), mapeamento honesto builtin ↔ papel (shadow planner/reviewer/scout/researcher; novos builder/auditor/security; worker/oracle/advisor/context-builder/delegate preservados; artefatos `output:` = runtime do fork), delegação (builder spawna scout/reviewer; template), modelos (ids de papel × F30), fronteiras (F24 guard default; F33 orquestração codificada — outline; pr-review/F20 fluxo PR)
- [ ] Tabela de agentes no README do harness (papéis objetivos + builtins do fork); STATE.md (AD-032 pós-resposta das QAs)
- [ ] **Verificar:** docs conferidas contra src/assets (checklist: nomes, tools, frontmatter, deny-list RPG); ROUTING sem quebrar goldens do F19 (renderRules NÃO muda)

## Success Criteria (spec)

- [ ] 7 papéis objetivos como `.md` versionados em `packages/harness/agents/` — agentes como dados, extensíveis por construção; sincronizados para `<cwd>/.pi/agents/` (three-way + contentHash)
- [ ] Mecanismo com evidência: fork descobre `.pi/agents/*.md` (agents.ts loadAgentsFromDir/resolveNearestProjectAgentDirs; agent-management.ts shadowing/RPC) — citado no design
- [ ] Tabela de definições dos 7 papéis (identidade objetiva, tools allowlist fail-closed, constraints, delegação) — zero RPG
- [ ] Mapeamento honesto builtin ↔ papel objetivo (shadow 4 homônimos; novos builder/auditor/security; demais builtins preservados)
- [ ] Infra portada como módulos puros (prompt-loader/prompt-utils/dynamic-prompt-builder) + delegação via template (spawn-wizard); agent-builder/custom-agent-factory/builtin-agents satisfeitos pelo fork + dados (sem duplicação)
- [ ] Composição de review decidida: reviewer read-only in-loop; pr-review/F20 donos do fluxo PR; review-resolver/model-variants = interface F30
- [ ] Auditor ativado: default `guards.rangerMdOnly.mdOnlyAgents` += "auditor" — guard F24 intocado
- [ ] Interface de modelos F30 alinhada: 7 ids de papel consumíveis por `models.agents.<id>.fallbackChain`; zero IDs inventados
- [ ] EVAL-057..066 verdes offline/$0; EVAL-MATRIX v10 aditivo (após F31 fechar v9); tool-use correctness + routing completeness desbloqueadas; `MIN_EVIDENCE_FILES` bump; sem regressão
- [ ] Fronteiras explícitas: F24/F30/F33/F19/F5/F20/fork — sem retrofit; zero deps novas
- [ ] ≤5 open questions (QA-1..QA-5)

## Traceability ROLE → tasks

| Requirement | Tasks |
| --- | --- |
| ROLE-01 (mecanismo `.pi/agents/*.md`) | T1, T5, T8 |
| ROLE-02 (definições dos 7 papéis) | T1, T2, T8 |
| ROLE-03 (mapeamento builtin ↔ papel) | T1, T9, T8 |
| ROLE-04 (infra de prompts) | T3, T8 |
| ROLE-05 (delegação via template) | T4, T8 |
| ROLE-06 (composição de review) | T7, T8 |
| ROLE-07 (auditor ativado) | T6, T8 |
| ROLE-08 (interface de modelos) | T7, T8 |
| ROLE-09 (evals + governança) | T8 |
| ROLE-10 (docs) | T9 |

**Cobertura:** 10/10 · toda user story da spec tem requirement ID (ROLE-01..10) · todo requisito tem task.
