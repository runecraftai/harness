# F33 Design — Coded Routing & Pilot Coordination

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-033)
**Decisões aprovadas (usuário/briefing, travadas):** determinismo (decisão 3c) — rota por CÓDIGO com thresholds explícitos, NUNCA LLM · sem port do mecanismo probabilístico (só semântica de categoria) · bard = orquestração codificada (NÃO vira subagente — F32) · pilot coordination = chain orchestration · zero deps novas · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v11 (após F32 fechar v10 — one writer thread, F21 D9) · evidência via evalTest (F21) · requirement IDs RTE-01..09 · rotas ↔ papéis F32 (catalog.ts read-only) · chains formato harness `.chain.md` (F30 AD-030) · delegação via tool `subagent` (F2) · freeze por sessão + kill switch `RUNECRAFT_ROUTING=0` (padrão F24) · two-driver: sessão supervisionada → inerte (F19 sessionDriver) · fail-closed (sem sinal → direct; chain ausente → direct + warn) · lessons (F28) informam prompts, nunca rotas · TUI fora (AD-005).

## Contexto

O guild roteava por LLM (bard temperatura 0.1 decide a rota pelo prompt); o harness determinístico exige rota por CÓDIGO (decisão 3c). F33 porta a SEMÂNTICA dos sinais do bard (categorias, thresholds implícitos, obrigatoriedade de segurança) para um classificador puro + catálogo de rotas como dados + chains de piloto, com o hook no `before_agent_start` (único hook de rewrite de prompt com evidência no harness).

**Evidência (source lido — citado):**
1. **keyword-detector.ts REAL é determinístico** (`src/hooks/keyword-detector.ts` — lido): `detectKeywords(message, actions)` filtra `KeywordAction[]` por substring (defaults `ultrawork`/`ulw` → injeção "[ULTRAWORK MODE ACTIVATED]..."). **O que era probabilístico no arcanum é a ORQUESTRAÇÃO do bard** (a LLM escolhe rota). Porta-se: (a) o PADRÃO `keyword → injection` vira `input features → route directive`; (b) a semântica de CATEGORIA = os sinais do prompt-composer (abaixo); (c) a injeção "ULTRAWORK MODE" NÃO é portada (tema RPG — AD-022 decisão 2; mecanismo sem valor determinístico).
2. **Sinais do bard (lidos em `src/agents/bard/prompt-composer.ts`)** — tabela no D3: simples → direto; substancial → delegar; rogue = recon (delegar primeiro); warlock = pesquisa; wizard = planejamento; fighter = execução via /start-work; ranger-{category} = padrões de arquivo; cleric = review 3+ arquivos; **paladin = OBRIGATÓRIO** em auth/crypto/tokens/signatures/input validation/secrets/passwords/sessions/CORS/CSP/.env/OAuth/OIDC/SAML ("MUST ... not optional"); PlanWorkflow = PLAN→REVIEW→EXECUTE→RESUME→HANDOFF (features grandes/refactors/5+ passos; skip p/ quick fixes/single-file); ReviewWorkflow = review ad-hoc; delegação narrada.
3. **Workflow engine do guild** (`src/features/workflow/` — lido, index.ts): steps interactive/autonomous/gate; completion methods user_confirm/plan_created/plan_complete/review_verdict/agent_signal; artifacts `{{artifacts.NAME}}`; gate `on_reject: pause|fail`; lifecycle via `session.idle`. **Equivalente harness = chains** `.chain.md` (front-matter + `worker "..." -> reviewer "..."`; precedente real `.pi/chains/f3-taskflow.chain.md` lido; consumido pelo fork subagents — F30 AD-030 QA-1).
4. **call_guild_agent** (`src/tools/call-guild-agent.ts` — lido): child session (`client.session.create({parentID})`) + `client.session.prompt({agent, parts:[text]})` + extração do texto do assistant. **Equivalente harness = tool `subagent` do fork (F2)** — nativa; evento delegation no F28.
5. **Hook — evidência no harness**: eventos usados em F21..F28 (AD-021/024/027/028): session_start, tool_call, tool_execution_end, turn_end, agent_end, session_shutdown, context, session_before_compact, session_compact. **Sem evento `input`/`message` descoberto** → STOP RULES: hook = **`before_agent_start`** (rewrite encadeável do systemPrompt — F27 types.d.ts:792 chaining; F28 adendo marker `<!-- runecraft:lessons -->`). Classificação = features de texto DETERMINÍSTICAS do prompt/tarefa (ainda código — decisão 3c satisfeita); leitura da 1ª mensagem do usuário via client API read-only a validar no Execute (precedente: call-guild-agent prova `client.session.prompt` devolve messages; endpoint exato a confirmar — candidatos: mensagens do response do prompt / list de mensagens do client).
6. **F32 (AD-032)**: `catalog.ts` (7 papéis; só builder tem tool `subagent` — QA-5), `delegation.ts` (`renderDelegationPrompt` + `buildKeyTriggersSection`), `.pi/agents/` sync. F33 consome READ-ONLY.
7. **F30 (AD-030)**: chains SDD `.chain.md` assets + `models.agents.<id>.fallbackChain` (D5) + `src/models/` (D4 — zero IDs inventados). F33 consome por contrato de ids.
8. **F27/F28/F19/F24/F26 (COMPLETE)**: F27 fallback engine (modelSwitch interface NO-OP → F30); F28 lessons adendo before_agent_start; F19 sessionDriver (ledger glla — isSupervising) + two-driver; F24 freeze por sessão + kill switch pattern + RUNECRAFT_AGENT_ID; F26 categorias tool-use/routing DESBLOQUEADAS pelo F32 + trajectory-assertion (delegationSequence = replyTool real).
9. **EVAL-MATRIX v10 (F32 planned)** → **v11 (F33)** aditiva; `MIN_EVIDENCE_FILES` bump (AD-025); floor de testes.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Mecanismo = classificador puro + chains (ambos); hook = `before_agent_start`** (RTE-01/03; QA-1a recomendado): `src/routing/classifier.ts` — função pura `classifyRoute(input: RouteInput): RouteDecision` (features de texto + features de arquivo; thresholds em constantes; zero LLM); a rota SELECIONA uma chain (D4); a extensão `src/extensions/routing.ts` hooka `before_agent_start` e reescreve o systemPrompt com o ROUTING DIRECTIVE (bloco marker `<!-- runecraft:routing -->`, precedente F28). Classificação do texto do prompt/tarefa (STOP RULES — sem evento de input no surface F21..F28); leitura da 1ª mensagem via client API read-only a VALIDAR no Execute (endpoint exato; fallback honesto: classificar o prompt disponível no evento — ainda código determinístico). Freeze por sessão (F24 D12: snapshot da config routing no session start — a rota NÃO muda por passo/subagente); kill switch `RUNECRAFT_ROUTING=0` (padrão F20/F24/F25/F27/F28 — extensão inerte); fail-closed (exceção/erro → nenhum rewrite, rota = direct implícita) | Decisão 3c exige CÓDIGO (classificador puro, testável, 2 runs idênticos); chains dão o "o quê" declarativo (workflow engine → dados) e o classificador dá o "quando" (decisão em código); before_agent_start é o ÚNICO hook de rewrite com evidência (F27/F28); sem inventar evento `input` (STOP RULES + flag honesta); freeze/kill switch = padrões consolidados do harness |
| D2 | **Catálogo de rotas = DADOS** (RTE-02): `src/routing/routes.ts` — `ROUTE_CATALOG` tipado (id, role: id do catalog F32, keywords {high[], medium[]}, fileFeature?, priority, mandatory?) — o "categories" do bard (CategoriesConfig) portado como dados, extensível por construção (config aditiva `state.routing.routes.<id>` override — F13). Catálogo default: **explore→scout**, **research→researcher**, **implement→builder**, **review→reviewer**, **security→security (mandatory)**, **planning→planner**, **direct→null (fail-closed)**. `catalog.ts` do F32 é a fonte dos ids de papel (read-only) | Rotas = dados (extensível por construção — precedente F32 agentes como dados); papel = contrato F32 (ids estáveis); zero RPG; configuração aditiva sem bump de schema (AD-013) |
| D3 | **Semântica do classificador** (RTE-01/02): score por rota = Σ (high ×2, medium ×1) das keywords encontradas no texto (case-insensitive, token-boundary onde aplicável); **`ROUTE_THRESHOLD = 2`** (constante explícita — score ≥2 → rota; <2 → direct); **security = OBRIGATÓRIA**: qualquer high-signal de segurança → rota security SEM threshold (espelho do paladin "MUST ... not optional"); **prioridade em empate**: security > planning > implement > review > research > explore (determinística, testada); **features de arquivo**: presença de `.specs/**/spec.md` mencionada/relacionada (SDD) → +2 planning (a SDD é o gatilho do fluxo spec-driven — precedente tlc-spec-driven); contagem de arquivos alterados (`git status --porcelain` — precedente F25) NÃO muda a ROTA inicial (é gate da CHAIN — D4: ≥3 arquivos → passo de review); entrada vazia/ilegível → direct (fail-closed). **Validar no Execute**: lista exata de keywords (calibração empírica nos evals — sem invenção de comportamento; base = texto real do prompt-composer) | Thresholds explícitos em código (decisão 3c); segurança inegociável (semântica real do paladin); SDD como feature de planejamento (workflow da casa); file-count como gate da chain (o bard usava para REVIEW, não para rota inicial) |
| D4 | **Pilot coordination = chains** (RTE-04; QA-3a recomendado): assets `packages/harness/chains/*.chain.md` (5 pilot chains — implement/plan/research/explore/security) + alvo "chains" no install/sync → `<cwd>/.pi/chains/` (three-way F19 D7 + contentHash F13; **se F30 já criar o alvo chains p/ assets SDD, F33 REUSA** — validar no Execute); formato harness (front-matter description + `worker "..." -> reviewer "..."` — precedente f3-taskflow; consumido pelo fork — F30 AD-030). Semântica do workflow engine portada: **plan.chain.md** = planner (produz plan.md) -> reviewer (gate veredito) -> builder (executa) -> reviewer (work review); **implement.chain.md** = builder (executa plano, todos) -> reviewer (gate veredito `[APPROVE]/[REJECT]` + ≤3 blocking issues — formato F32) -> (aprovado) builder (resumo final); **research.chain.md** = researcher (cita fontes) -> report; **explore.chain.md** = scout (recon read-only) -> report; **security.chain.md** = builder (implementa) -> security (auditoria — triage + fast-exit, classes de vulnerabilidade) -> builder (corrige achados) -> reviewer (gate). Gate steps = veredito F32 (approval bias, ≤3 blocking issues); resumo/handoff = passo final (HANDOFF do bard); RESUME = F27 continuation (fronteira — chain não reimplementa). Chain ausente → direct + warn (fail-closed — nunca inventa) | Workflow engine → dados declarativos (F30 AD-030 — mecanismo nativo do fork; zero engine novo); o "piloto" é a CHAIN (não um agente — bard vira orquestração); gates = papéis F32 (veredito cleric já definido); falha-closed em chain faltante (espírito F30 D4) |
| D5 | **Delegação integrada** (RTE-05; QA-2a recomendado): `call_guild_agent` NÃO é portado — a tool `subagent` do fork (F2) É o equivalente nativo (child session + prompt + retorno — semântica idêntica ao call-guild-agent lido); o ROUTING DIRECTIVE (D1) instrui o piloto/agente com `renderDelegationPrompt(route.role, catalog)` + `buildKeyTriggersSection` (F32) — alvos válidos listados (nome/descrição/tools); a SEQUÊNCIA de delegação = os passos da chain (o runtime do fork spawna cada passo — o piloto é a chain); política F32 QA-5 PRESERVADA (só builder tem `subagent` no allowlist; planner/spawned steps: o fork executa passos via seu próprio mecanismo — sem estender allowlist de papel; validar no Execute a interação chain-runtime × allowlist) | Sem duplicação do call-guild-agent (fork nativo, F28 já observa); política de delegação é DADO (allowlist F32) — F33 não a muda; orquestração = dados (chain), não runtime novo |
| D6 | **Two-driver + freeze + kill switch** (RTE-06): a extensão (D1) checa `sessionDriver` (F19 — ledger glla, isSupervising: loop active OU goal active+autoContinue) no session start: **supervisionado → routing INERTE** (o goal loop é o piloto — two-driver rule; nenhum directive; a rota fica `direct` implícita e a documentação do F19 vale); config `state.routing` (F13 aditiva, schemaVersion 1): `{ enabled: true, threshold: { direct: 2 }, routes: { <id>: { enabled, mandatory } } }` — defaults no código, override por config; **freeze por sessão** (D12 F24: snapshot no session start — subagentes/steps herdam a MESMA decisão); **kill switch `RUNECRAFT_ROUTING=0`** (extensão inerte; fail-visible no status/doctor) | Two-driver é limite conhecido do F19 (ROUTING.md) — routing em sessão supervisionada criaria dois pilotos; freeze = padrão F24 (determinismo intra-sessão); kill switch = padrão consolidado (F20/F24/F25/F27/F28) |
| D7 | **Fronteiras F27/F30/F28** (RTE-06/07; QA-4a recomendado): **F27**: fallback engine NÃO re-roteia (rota congelada por sessão — D6; modelSwitch do F30 troca MODELO, nunca rota; evento de resiliência → ações F27 (retry/re-inject/pause/halt) sobre a MESMA rota); **F30**: cada passo de chain referencia um papel F32 → modelo via `models.agents.<id>.fallbackChain` (contrato de ids, read-only; fim-de-chain → null + warn — F30 D4); **F28**: lessons informam PROMPTS (adendo before_agent_start intacto), NUNCA rotas — o router computa a rota por função pura do input, independente de lessons; ordem de rewrite no before_agent_start: router computa (puro) → directive; adendo F28 anexa conteúdo (não altera a decisão) | Fronteiras cross-feature explícitas (padrão AD-027/028); lessons × rotas = a decisão do usuário (QA-4): pureza da rota preserva determinismo cross-session (rotear por lessons tornaria o comportamento dependente de memória acumulada — veta 3c) |
| D8 | **Evals EVAL-067..078 + matriz v11** (RTE-08): suite `test/eval/suites/routing.ts` — casos: EVAL-067 determinismo (2 runs byte-idênticos do classificador), EVAL-068 fail-closed (sem sinal → direct), EVAL-069 boundaries (score 1 → direct; score 2 → rota; 1 high → rota), EVAL-070 security obrigatória (keyword security + outra rota → security), EVAL-071 prioridade (empate implement/review → ordem), EVAL-072 explore→scout (trajectory-assertion delegationSequence: subagent agent=scout), EVAL-073 research→researcher, EVAL-074 planning→planner (SDD spec presente), EVAL-075 implement→builder→reviewer (trajectory: subagent(builder) + subagent(reviewer) + veredito estruturado no retorno), EVAL-076 extensão (before_agent_start injeta directive marker; freeze por sessão; RUNECRAFT_ROUTING=0 → inerte), EVAL-077 two-driver (ledger glla ativo → routing skip), EVAL-078 chain selection (chain ausente → direct + warn; render determinístico; contrato F30: passo → `models.agents.<id>` resolve; fim-de-chain → null + warn). EVAL-MATRIX **v11 aditiva** (bump 10→11 APÓS F32 fechar v10 — one writer thread); nota datada completando routing completeness (F26 — última categoria; tool-use já pelo F32); `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest); consistência matriz↔suites estendida a routing.ts; floor de testes sobe. **Validar no Execute**: delegação REAL de `subagent` em sessão scriptada (precedente F28 EVAL-026/021); endpoint de leitura da 1ª mensagem no before_agent_start (fallback honesto: classificar o prompt do evento) | Política aditiva (F21 D9); trajectory = transcript REAL (F26 QA-2); routing completeness é a última categoria do F26 — fecha o ciclo com evidência (padrão F27/F30/F32) |
| D9 | **Fronteiras de escopo + docs** (RTE-09): F8/F9/F10 (barreiras M6) NÃO desenhadas (STOP RULES); keyword-detector probabilístico NÃO portado (só semântica — D1/D3); bard NÃO vira agente (chain + classificador); `docs/ROUTING.md` §nova "Coded Routing & Pilot Coordination" (mecanismo com evidência, tabela de categorias/features/thresholds, chains, fronteiras F19/F27/F30/F28/F32); tabela no README; STATE.md (AD-033 pós-resposta das QAs) | Docs = contrato de uso (precedente F19 ROUTING canônico + F32 ROUTING §papéis); fronteiras explícitas evitam retrofit |

## Arquitetura — módulos

```
packages/harness/
├── chains/                            # NOVO — assets versionados (5 pilot chains) — DADOS, zero código (D4)
│   ├── implement.chain.md · plan.chain.md · research.chain.md
│   ├── explore.chain.md · security.chain.md
├── src/routing/
│   ├── classifier.ts                  # NOVO — puro: classifyRoute(input) → RouteDecision (thresholds em constantes) (D1/D3)
│   ├── routes.ts                      # NOVO — ROUTE_CATALOG: 7 rotas × papel F32 + keywords/prioridade/mandatory (D2)
│   └── directive.ts                   # NOVO — renderRoutingDirective(route, chain, catalog) → bloco marker p/ rewrite (D1/D5)
├── src/extensions/routing.ts          # NOVO — extensão Pi: before_agent_start (freeze/kill switch/two-driver) (D1/D6)
├── src/config.ts / src/state.ts       # config aditiva `routing` (F13; defaults no código) (D6)
├── src/commands/install.ts / sync.ts  # alvo chains: copy-if-different → <cwd>/.pi/chains/ (three-way F19; contentHash F13) (D4)
├── docs/ROUTING.md                    # §nova: Coded Routing & Pilot Coordination (D9)
└── test/
    ├── routing/…                      # unit: classifier determinismo/boundaries/prioridade/mandatory; directive render; config (D1/D2/D3/D6)
    └── eval/suites/routing.ts         # cases EVAL-067..078 (D8)
```

## Fluxos

### F1 — Classificação da rota (RTE-01/02/03)

```
1. session start → extensão routing (D1) lê config routing (snapshot = freeze D6); kill switch RUNECRAFT_ROUTING=0 → inerte
2. sessionDriver (F19): supervisionado (goal-loop) → routing INERTE (two-driver D6)
3. input = texto do prompt/tarefa do before_agent_start (1ª mensagem via client API a validar no Execute — fallback: prompt do evento) + fileFeatures (presença .specs/**/spec.md)
4. classifyRoute(input) — puro: scores por rota (high ×2, medium ×1); security high-signal → OBRIGATÓRIA; ROUTE_THRESHOLD=2; empate → prioridade; sem sinal → direct
5. rota ≠ direct → seleciona chain (D4); chain ausente → direct + warn (fail-closed)
6. directive = renderRoutingDirective(rota, chain, catalog F32) → rewrite do systemPrompt (marker <!-- runecraft:routing -->); freeze: mesma rota p/ toda a sessão
```

### F2 — Pilot coordination via chain (RTE-04/05)

```
1. rota implement → chain implement.chain.md (builder -> reviewer gate -> builder resumo)
2. fork executa os passos (mecanismo nativo .chain.md — F30 AD-030): cada passo = subagente do papel F32 (tool subagent — F2; evento delegation F28)
3. gate de review: veredito [APPROVE]/[REJECT] + ≤3 blocking issues (formato F32 cleric); REJECT → on_reject (pause/fail — semântica do workflow engine do guild portada)
4. modelo por passo: models.agents.<papel>.fallbackChain (F30 — contrato de ids; fim-de-chain → null + warn)
5. resumo final = HANDOFF do bard (passo terminal da chain)
```

### F3 — Delegação (RTE-05)

```
1. directive (F1 passo 6) inclui renderDelegationPrompt(role, catalog) + buildKeyTriggersSection (F32) — alvos válidos
2. o agente/passo usa a tool subagent (F2) com agent: <papel> — a chain define QUEM/ORDEM; o allowlist F32 QA-5 define QUEM PODE (só builder in-role)
3. F28 registra delegation (tool subagent — argsHash); NENHUM call_guild_agent portado
```

### F4 — Fronteiras (RTE-06/07)

```
F19: supervisor → inerte (D6) · F27: evento de resiliência → ações F27 na MESMA rota (modelSwitch F30 troca modelo) · F30: ids de papel nos passos → models.agents.<id> · F28: adendo de lessons anexa conteúdo (NUNCA altera a rota — rota = função pura) · F32: catalog read-only; QA-5 preservado
```

### F5 — Evals (RTE-08)

```
bun test test/eval (preloads F21..F32) → EVAL-067..078 offline/$0 (fixture; workspace temp; .pi/chains/ + .pi/agents/ fake; zero LLM);
trajectory REAL (F26 QA-2): ScriptedScenario scripta input → delegationSequence com tool subagent (EVAL-072..075);
unit puro do classificador (EVAL-067..071); extensão/dois-driver/kill switch (EVAL-076/077); chain selection + contrato F30 (EVAL-078);
goldens das 5 chains (F23) · consistência matriz↔suites v11 · MIN_EVIDENCE_FILES bump (AD-025) · 2 runs idênticos
```

## Tabela de mecanismos (o que existe → o que F33 constrói)

| Mecanismo | Existe — evidência | F33 constrói |
| --- | --- | --- |
| Decisão de rota por LLM (bard) | arcanum prompt-composer (lido) | classificador PURO + thresholds (D1/D3) — sem LLM |
| keyword → injection (keyword-detector) | arcanum hooks/keyword-detector.ts (lido) | input features → route directive (D1/D3); sem "ULTRAWORK MODE" |
| Workflow engine (steps/gates/artifacts) | arcanum features/workflow (lido) | chains `.chain.md` (D4) — sem engine novo |
| call_guild_agent (child session) | arcanum tools/call-guild-agent.ts (lido) | tool `subagent` (F2) — nativa (D5) |
| Hook de rewrite de prompt | F27 (before_agent_start chaining types.d.ts:792), F28 (adendo marker) | extensão routing no before_agent_start (D1) |
| Papéis objetivos + delegação | F32 (catalog.ts, delegation.ts, QA-5) | consumo read-only (D2/D5) |
| Chains `.chain.md` + consumo | F30 AD-030 + .pi/chains/f3-taskflow.chain.md (lido) | 5 pilot chains assets + sync (D4) |
| Models por agente | F30 (planned) models.agents.<id>.fallbackChain | contrato de ids nos passos (D7) |
| Fallback engine / modelSwitch | F27 (interface NO-OP) + F30 (implementação) | fronteira: não re-roteia (D7) |
| sessionDriver / two-driver | F19 (ledger glla, isSupervising) | routing inerte em sessão supervisionada (D6) |
| Freeze + kill switch + config aditiva | F24 (D12) / F20/F24/F25/F27/F28 / F13 | RUNECRAFT_ROUTING=0 + state.routing (D6) |
| Evals + goldens + ratchet | F21/F23/F26 + EVAL-MATRIX | EVAL-067..078 + v11 (D8) |

## EVAL-MATRIX — entradas aditivas v11 (política F21 D9)

| ID | Fluxo | Script esperado | Notas |
| --- | --- | --- | --- |
| EVAL-067 | classifier determinismo | classifyRoute(input) 2 runs → decisão byte-idêntica | D1/D3; F21 D10 |
| EVAL-068 | classifier fail-closed | input sem sinais → direct (nenhuma rota inventada) | D3 |
| EVAL-069 | classifier boundaries | score 1 (1 medium) → direct; score 2 → rota; 1 high → rota | D3; ROUTE_THRESHOLD=2 |
| EVAL-070 | classifier security obrigatória | keyword security + sinal de outra rota → security (bypassa threshold) | D3; paladin "not optional" |
| EVAL-071 | classifier prioridade | empate implement/review → ordem determinística (implement) | D3 |
| EVAL-072 | routing explore→scout | ScriptedScenario input recon → trajectory delegationSequence: subagent agent=scout | D4/D5; routing completeness |
| EVAL-073 | routing research→researcher | input pesquisa → subagent agent=researcher | D4/D5; routing |
| EVAL-074 | routing planning→planner | input planejamento + .specs/**/spec.md → subagent agent=planner | D3/D4; SDD feature |
| EVAL-075 | routing implement→builder→reviewer | input implementação → subagent(builder) + subagent(reviewer) + veredito [APPROVE]/[REJECT] | D4/D5; chain gate |
| EVAL-076 | extensão routing | before_agent_start injeta directive (marker); freeze por sessão; RUNECRAFT_ROUTING=0 → inerte | D1/D6 |
| EVAL-077 | two-driver | ledger glla supervisionando → routing skip (nenhum directive) | D6; F19 |
| EVAL-078 | chain selection + F30 | chain ausente → direct + warn; render determinístico 2 runs; passo → models.agents.<id> resolve; fim-de-chain → null + warn | D4/D7; F30 D4/D5 |

Nota datada v11: roteamento codificado (F33) — classificador determinístico puro + catálogo de rotas como dados + pilot coordination via chains (workflow engine → .chain.md) + hook before_agent_start (freeze/kill switch/two-driver) + fronteiras F19/F27/F30/F28; categoria **routing completeness** (F26) COMPLETA — última categoria do framework. Bump de MATRIX_VERSION 10→11 depende do F32 fechar a v10 (one writer thread).

## Integração CI

- **Roda com**: mesma lane F21..F32 — `bun test test/eval` (offline/$0: loopback, apiKey literal, workspace temp, PATH mínimo, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM
- **Evidência**: evalTest() nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (goldens das 5 chains + identidade estável)
- **Consistência**: matrix-consistency v11 varre `test/eval/suites` incluindo routing.ts; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Sem evento `input` no SDK para hookar o router** | STOP RULES: hook = before_agent_start com classificação determinística do texto do prompt/tarefa (ainda código — 3c satisfeita); leitura da 1ª mensagem via client API a validar no Execute (precedente call-guild-agent: client.session.prompt retorna messages); fallback honesto documentado; EVAL-076 cobre a injeção |
| **F32/F30 ainda em execução quando F33 planeja** (interfaces podem mudar) | Alinhamento por CONTRATO: catalog.ts ids (F32), models.agents.<id> (F30 D5), chains .chain.md (F30 AD-030) — F33 consome read-only; se o shape mudar, ajuste local no Execute |
| **Alvo "chains" colidir com F30 (assets SDD)** | Reuso: se F30 criar o alvo chains, F33 NÃO duplica (valida no Execute o estado do F30; senão F33 cria o alvo no padrão F32 agents) |
| **Delegação real de `subagent` via chain em sessão scriptada inviável** | Precedente F28 (EVAL-026 observou delegação) + F21 layer2 + F32 EVAL-062..064; fallback honesto: trajectory-assertion sobre o delegation event do F28 (delegation:delegate) — nota no case |
| **Keywords do catálogo descalibradas (falsos positivos/negativos)** | Base = texto REAL do prompt-composer (sem invenção); calibração empírica nos evals (EVAL-069 boundaries); configuração aditiva permite ajuste por usuário sem mudar código |
| **Thresholds muito agressivos (tudo → direct)** | Fail-closed é o DEFAULT CERTO (decisão 3c — rotear menos é mais seguro que inventar rota); usuário ajusta via state.routing; evals fixam os boundaries |
| **Chain do usuário editada entre syncs** | Three-way "preservada (editada)" (F19 D7); nunca auto-cura; RPC do fork respeitado por conteúdo (órfãos F18) |
| **Termos RPG vazando (ex.: "ULTRAWORK")** | Deny-list nos evals (EVAL-067 — precedente F30/F32); sem port da injeção ultrawork (D1) |
| **before_agent_start dispara por subagente (re-classificação por passo)** | Freeze por sessão (D6 — snapshot no session start): a MESMA rota/directive vale p/ todos os passos; nenhuma re-classificação por spawn |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| RTE-01 | P1: Classificador puro | D1/D3 + src/routing/classifier.ts + EVAL-067..071 |
| RTE-02 | P1: Catálogo de rotas | D2/D3 + src/routing/routes.ts + EVAL-069/070/071 |
| RTE-03 | P1: Extensão routing | D1/D6 + src/extensions/routing.ts + src/routing/directive.ts + EVAL-076 |
| RTE-04 | P1: Chains de piloto | D4 + chains/*.chain.md + install/sync + EVAL-072..075/078 |
| RTE-05 | P1: Delegação integrada | D5 + directive (F32 render/template) + EVAL-072..075 |
| RTE-06 | P2: Fronteiras F19/F27/F30 | D6/D7 + EVAL-077/078 |
| RTE-07 | P2: Fronteira F28 | D7 + docs |
| RTE-08 | P2: Evals | D8 + test/eval/suites/routing.ts + EVAL-MATRIX v11 |
| RTE-09 | P2: Docs | D9 + ROUTING §nova + README + STATE.md |

**Cobertura:** 9/9 mapeados. Edges da spec: sem sinal → direct (D3) · segurança vence (D3) · abaixo do threshold → direct (D3) · rota sem chain → direct + warn (D4) · `.pi/chains/` ausente → mkdir (D4) · chain editada → preservada (D4) · fork ausente → dados inertes (D4) · state.routing ausente → defaults (D6) · supervisor → inerte (D6) · subagente → freeze (D6) · fim-de-chain → null + warn (D7) · 2 runs → idênticos (D8).

**Pontos a validar no Execute** (consolidado): endpoint exato de leitura da 1ª mensagem do usuário no before_agent_start (client API — candidato: messages do response de session.prompt, provado no call-guild-agent; fallback: classificar o texto do prompt do evento); interação chain-runtime do fork × allowlist F32 QA-5 (o fork spawna passos nativamente — confirmar que não viola a política por papel); alvo "chains" no sync (reuso do alvo do F30 vs alvo novo — estado real do F30 no Execute); lista/calibração exata de keywords do catálogo (base: texto real do prompt-composer; evals de boundary); delegação real de `subagent` via chain em sessão scriptada do fixture (fallback: delegation event F28); shape de `state.routing` no merge F13 (aditivo, schemaVersion 1); `MIN_EVIDENCE_FILES` pós-bumps de F30/F31/F32; precedência/ordem dos rewrites no before_agent_start (router × F27 continuation × F28 lessons — encadeamento).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Hook do router** (D1): (a) **recomendado — `before_agent_start` (STOP RULES): classificação determinística do texto do prompt/tarefa; leitura da 1ª mensagem via client API read-only a validar no Execute** · (b) evento `input`/`turn_start` (sem evidência no surface F21..F28 — risco de invenção) · (c) tool chamada pelo agente principal (quebra 3c — a LLM decidiria)
2. **QA-2 — Extensão da delegação** (D5): (a) **recomendado — F32 QA-5 preservado (só builder spawna in-role); pilot = chains executadas pelo fork** · (b) novos papéis com tool `subagent` · (c) sem chains no v1 (só directive)
3. **QA-3 — Chain assets** (D4): (a) **recomendado — 5 pilot chains versionadas + sync `.pi/chains/` (reuso do alvo do F30 se existir)** · (b) só chains do usuário · (c) chains em código (template strings)
4. **QA-4 — F28 lessons × routing** (D7): (a) **recomendado — lessons informam prompts, nunca rotas (pureza/determinismo cross-session)** · (b) lessons ajustam thresholds · (c) lessons mudam a rota (veta 3c)
5. **QA-5 — Evals de rota** (D8): (a) **recomendado — ScriptedScenario input → trajectory-assertion da delegação REAL (tool subagent no transcript)** · (b) assert só do directive no prompt · (c) ambos
