# F33 — Tasks (Coded Routing & Pilot Coordination)

**Base:** design.md D1–D9 (aguarda QA-1..QA-5 → AD-033) · infra reutilizada: F2 (fork subagents — tool `subagent` + mecanismo `.pi/chains/*.chain.md`; consumido READ-ONLY), F13 (state targets + contentHash), F17/F19 (sync three-way por conteúdo; órfãos; `sessionDriver` two-driver), F21/F26 (fixture ScriptedScenario, evalTest, trajectory-assertion/tool-policy, EVAL-MATRIX), F23 (goldens/ratchet, `MIN_EVIDENCE_FILES` AD-025), F24 (freeze por sessão + kill switch pattern), F27 (fallback engine — fronteira), F28 (evento delegation + lessons adendo — fronteira), F30 (planned — `models.agents.<id>.fallbackChain` + chains .chain.md), F32 (planned — `catalog.ts` + `renderDelegationPrompt`/`buildKeyTriggersSection` + QA-5)
**Dependências de decisão:** T1 (QA-1 hook — default `before_agent_start` + classificação de texto; leitura da 1ª mensagem a validar no Execute) · T1/T5 (QA-2 delegação — default F32 QA-5 preservado) · T4 (QA-3 chains — default 5 pilot chains + sync) · T6 (QA-4 lessons — default prompts sim, rotas não) · T7 (QA-5 evals — default trajectory real) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — Classificador puro + catálogo (D1/D2/D3, RTE-01/02) — depende QA-1

- [ ] `src/routing/routes.ts`: `ROUTE_CATALOG` tipado — 7 rotas como DADOS (id/role = id do catalog F32/keywords {high[], medium[]}/fileFeature/priority/mandatory):
  - explore→scout · research→researcher · implement→builder · review→reviewer · **security→security (mandatory: true)** · planning→planner · direct→null (fail-closed)
  - keywords extraídas do texto REAL do prompt-composer do bard (D3): explore (locate/find where/trace/map the codebase/where is…), research (research/look up docs/external docs/check the docs…), implement (implement/build/refactor/fix/add feature/port…), review (review/validate/check my work/approve…), security (auth/crypto/token/secret/password/session/cors/csp/oauth/oidc/saml/.env/input validation/signature…), planning (plan/spec/design/roadmap/break down/scope…)
- [ ] `src/routing/classifier.ts`: `classifyRoute(input: RouteInput): RouteDecision` — função PURA:
  - score por rota = Σ(high ×2, medium ×1) case-insensitive; `ROUTE_THRESHOLD = 2` em constante; security high-signal → OBRIGATÓRIA (bypassa threshold); empate → prioridade determinística (security > planning > implement > review > research > explore); sem sinal/abaixo → `direct` (fail-closed)
  - `RouteInput` = { text, specPath?: string|null } — features de arquivo: presença de `.specs/**/spec.md` (SDD) → +2 planning (D3); entrada vazia/ilegível → direct
  - file-count (`git status --porcelain`) NÃO entra na rota inicial (é gate da chain — T4); zero I/O dentro do classificador (features injetadas pelo caller — pureza/testabilidade)
- [ ] **Verificar:** unit puro (fs temp + inputs fixos): determinismo 2 runs byte-idêntico (EVAL-067), fail-closed (EVAL-068), boundaries score 1/2 + 1 high (EVAL-069), security obrigatória (EVAL-070), prioridade em empate (EVAL-071); TSC limpo; zero deps novas

## T2 — Directive (D1/D5, RTE-03/05) — depende T1

- [ ] `src/routing/directive.ts`: `renderRoutingDirective(route, chain, catalog)` — bloco determinístico com marker `<!-- runecraft:routing -->` (precedente F28): rota resolvida, chain selecionada, `renderDelegationPrompt` + `buildKeyTriggersSection` (F32 — alvos válidos nome/descrição/tools), instrução de delegação via tool `subagent` (F2 — NUNCA call_guild_agent)
- [ ] Política: rota direct → NENHUM bloco (sem directive; o agente opera normal — fail-closed silencioso)
- [ ] **Verificar:** unit — render determinístico 2 runs; rota direct → vazio; inclui alvos válidos do catalog F32; TSC limpo

## T3 — Extensão routing no before_agent_start (D1/D6, RTE-03/06) — depende T1/T2; QA-1

- [ ] `src/extensions/routing.ts` — extensão Pi hookando `before_agent_start` (rewrite encadeável — F27 types.d.ts:792):
  - kill switch `RUNECRAFT_ROUTING=0` → inerte (padrão F20/F24); freeze por sessão (D12 F24 — snapshot da config + rota no session start; subagentes/steps herdam a MESMA decisão — sem re-classificação por spawn)
  - two-driver: `sessionDriver` (F19 — isSupervising: loop active OU goal active+autoContinue) → routing INERTE (nenhum rewrite)
  - input de classificação: texto do prompt/tarefa do evento (STOP RULES — sem evento `input` no surface F21..F28); **validar no Execute**: leitura da 1ª mensagem do usuário via client API read-only (precedente: call-guild-agent — client.session.prompt retorna messages; endpoint exato a confirmar); fallback honesto: classificar o texto do prompt disponível (ainda código determinístico)
  - rewrite: anexa `renderRoutingDirective` ao systemPrompt (encadeamento com F27 continuation e F28 lessons — ordem de rewrite a validar no Execute)
  - falha/erro → nenhum rewrite (fail-closed; rota = direct implícita) + warn no log
- [ ] Config aditiva `state.routing` (F13, schemaVersion 1 — padrão guards/verification/resilience): `{ enabled: true, threshold: { direct: 2 }, routes: { <id>: { enabled?, mandatory? } } }` — defaults no código; kill switch documentado; freeze por sessão
- [ ] **Verificar:** unit com handlers exportados (padrão F27/F28 — eventos sintéticos): kill switch inerte; supervisor → inerte; sessão normal → rewrite com marker; 2ª chamada (subagente) → mesmo directive (freeze); erro → sem rewrite; TSC limpo

## T4 — Chains de piloto + sync (D4, RTE-04) — depende T1; QA-2/QA-3

- [ ] `packages/harness/chains/{implement,plan,research,explore,security}.chain.md` — formato harness (front-matter description + `worker "..." -> reviewer "..."` — precedente `.pi/chains/f3-taskflow.chain.md`; consumido pelo fork — F30 AD-030):
  - implement: builder (executa plano/todos) -> reviewer (gate: veredito `[APPROVE]/[REJECT]` + ≤3 blocking issues — formato F32) -> builder (resumo final = HANDOFF do bard)
  - plan: planner (produz plan.md) -> reviewer (gate) -> builder (executa) -> reviewer (work review)
  - research: researcher (cita fontes) -> report · explore: scout (recon read-only) -> report
  - security: builder (implementa) -> security (auditoria — triage + fast-exit, classes de vulnerabilidade) -> builder (corrige achados) -> reviewer (gate)
  - gate REJECT → on_reject pause|fail (semântica do workflow engine do guild portada — sem engine novo); zero RPG; zero "ULTRAWORK"
- [ ] Alvo "chains" no install/sync → `<cwd>/.pi/chains/` (three-way F19 D7: re-injetada/atualizada vN→vM/preservada (editada)/already in sync; contentHash F13 — targets `chains.pi.targets`; mkdir recursivo; órfãos reportados nunca removidos F18; **validar no Execute: se F30 já criou o alvo chains (assets SDD), F33 REUSA — sem duplicação**)
- [ ] Seleção: rota ≠ direct → chain pelo catálogo (rota→chain 1:1 no v1); chain ausente em `.pi/chains/` → direct + warn (fail-closed — nunca inventa)
- [ ] **Verificar:** workspace temp com `.pi/chains/` fake: 1ª install copia (byte-idêntico aos assets), idempotente, edição do usuário → "preservada (editada)" e NUNCA reescrita; fork ausente → dados inertes; sem regressão nos targets existentes (rules/mcp/agents); goldens das 5 chains (F23)

## T5 — Delegação + política (D5, RTE-05) — depende T2/T4; QA-2

- [ ] Integração: directive (T2) usa `renderDelegationPrompt` + `buildKeyTriggersSection` do F32 (catalog read-only); sequência de delegação = passos da chain (runtime do fork spawna por passo — tool `subagent`; evento delegation F28)
- [ ] Política QA-5 PRESERVADA: só builder tem tool `subagent` no allowlist (F32 — zero mudança nos `.md`/catalog); **validar no Execute**: interação chain-runtime do fork × allowlist por papel (o fork spawna passos nativamente — confirmar que a orquestração por chain não viola a política)
- [ ] **Verificar:** unit — directive referencia apenas papéis válidos do catalog; papel não-builder sem instrução de delegação in-role; TSC limpo

## T6 — Fronteiras F27/F30/F28 (D7, RTE-06/07) — paralelo; QA-4

- [ ] F27: rota CONGELADA por sessão (T3 freeze) — fallback engine age sobre a MESMA rota (retry/re-inject/pause/halt; modelSwitch F30 troca modelo, nunca rota); zero mudança em `src/resilience/` (fronteira — teste de contrato)
- [ ] F30: passos das chains referenciam ids de papel F32 → modelo via `models.agents.<id>.fallbackChain` (contrato de ids; fim-de-chain → null + warn — F30 D4); zero mudança em `src/models/` (teste de contrato)
- [ ] F28 (QA-4a): lessons informam PROMPTS (adendo F28 intacto), NUNCA rotas — rota = função pura do input (T1); ordem de rewrite router × adendo documentada (T3)
- [ ] **Verificar:** testes de contrato — resolver modelo de passo com chain do state (sem tocar F30); fallback com rota congelada (evento sintético F27 → mesma rota); adendo F28 presente não altera decisão do classificador; TSC limpo

## T7 — Evals EVAL-067..078 + matriz v11 + MIN_EVIDENCE_FILES (D8, RTE-08) — depende T1..T6; QA-5

- [ ] Suite `test/eval/suites/routing.ts` + cases EVAL-067..078 (formato F26; delta vs EVAL-001..066 documentado em comentário em cada case): EVAL-067 determinismo (classifyRoute 2 runs byte-idêntico), EVAL-068 fail-closed (sem sinal → direct), EVAL-069 boundaries (score 1 → direct; 2 → rota; 1 high → rota), EVAL-070 security obrigatória (keyword + outra rota → security), EVAL-071 prioridade (empate implement/review → ordem), EVAL-072 explore→scout (ScriptedScenario input recon → trajectory-assertion delegationSequence: subagent agent=scout), EVAL-073 research→researcher, EVAL-074 planning→planner (+ `.specs/**/spec.md` fake), EVAL-075 implement→builder→reviewer (trajectory: subagent(builder) + subagent(reviewer) + veredito estruturado no retorno), EVAL-076 extensão (directive marker no rewrite; freeze por sessão; RUNECRAFT_ROUTING=0 → inerte), EVAL-077 two-driver (ledger glla fake supervisionando → routing skip), EVAL-078 chain selection (chain ausente → direct + warn; render determinístico 2 runs; contrato F30: passo → `models.agents.<id>` resolve; fim-de-chain → null + warn)
- [ ] EVAL-MATRIX v11 aditivo (bump 10→11 **após F32 fechar v10** — one writer thread; EVAL-067..078 + nota datada completando **routing completeness** no docs/EVAL-FRAMEWORK.md — última categoria do F26); consistência matriz↔suites estendida a routing.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest; valor a validar no Execute pós-F30/F31/F32)
- [ ] **Verificar:** EVAL-067..078 verdes offline/$0 na lane F21 (workspace temp, PATH mínimo, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..066; consistência v11 verde

## T8 — Docs (D9, RTE-09) — paralelo

- [ ] `docs/ROUTING.md` §nova: Coded Routing & Pilot Coordination — mecanismo (classificador puro + hook before_agent_start com evidência F27/F28 + sem evento input — nota honesta), tabela de categorias (7 rotas × papel F32 × keywords × threshold × prioridade × mandatory), features (texto/SDD/file-count como gate), chains (5 pilot chains + gate de veredito), fronteiras (F19 two-driver inerte; F27 não re-roteia; F30 modelos por papel; F28 lessons → prompts; F32 QA-5 preservado; call_guild_agent → subagent), kill switch + freeze + config `state.routing`
- [ ] Tabela no README do harness (roteamento codificado); STATE.md (AD-033 pós-resposta das QAs)
- [ ] **Verificar:** docs conferidas contra src/assets (checklist: rotas, keywords, thresholds, chains, fronteiras); ROUTING sem quebrar goldens do F19 (renderRules NÃO muda); zero RPG nos textos

## Success Criteria (spec)

- [ ] Classificador puro com evidência: `src/routing/classifier.ts` — features de texto determinísticas, thresholds EXPLÍCITOS em constantes, zero LLM, 2 runs idênticos, fail-closed `direct`
- [ ] Catálogo de rotas como DADOS (`src/routing/routes.ts`): 7 rotas ↔ papéis F32; keywords da semântica REAL do bard; segurança OBRIGATÓRIA; prioridade determinística; SDD → planning
- [ ] Mecanismo com evidência: hook = `before_agent_start` (F27 chaining; F28 adendo; STOP RULES — classificação de texto do prompt/tarefa; leitura da 1ª mensagem via client API a validar no Execute); freeze por sessão (F24 D12); kill switch `RUNECRAFT_ROUTING=0`
- [ ] Pilot coordination = chains (workflow engine → `.chain.md` formato harness): implement/plan/research/explore/security com gate de veredito F32; seleção pelo classificador; chain ausente → direct + warn
- [ ] Delegação integrada: `call_guild_agent` → tool `subagent` (F2); directive com F32 render/template; QA-5 preservado
- [ ] Fronteiras explícitas: F19 two-driver inerte; F27 não re-roteia; F30 modelos por papel (contrato); F28 lessons → prompts, nunca rotas; fork read-only; zero deps
- [ ] EVAL-067..078 verdes offline/$0; EVAL-MATRIX v11 aditivo (após F32 fechar v10); routing completeness completa (F26 — última categoria); `MIN_EVIDENCE_FILES` bump; sem regressão
- [ ] F8/F9/F10 (barreiras M6) NÃO desenhadas; keyword-detector probabilístico NÃO portado (só semântica); bard NÃO vira agente
- [ ] ≤5 open questions (QA-1..QA-5)

## Traceability RTE → tasks

| Requirement | Tasks |
| --- | --- |
| RTE-01 (classificador puro) | T1, T7 |
| RTE-02 (catálogo de rotas) | T1, T7 |
| RTE-03 (extensão routing) | T2, T3, T7 |
| RTE-04 (chains de piloto) | T4, T7 |
| RTE-05 (delegação integrada) | T2, T5, T7 |
| RTE-06 (fronteiras F19/F27/F30) | T3, T6, T7 |
| RTE-07 (fronteira F28) | T6, T8 |
| RTE-08 (evals + governança) | T7 |
| RTE-09 (docs) | T8 |

**Cobertura:** 9/9 · toda user story da spec tem requirement ID (RTE-01..09) · todo requisito tem task.
