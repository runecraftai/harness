# F34 — Own the Product (un-vendor + remap gentle-ai + skills + docs) — Specification

**Scope:** Large (multi-component — 4 fronts: desmontagem do vendoring, remap de menções gentle-ai, cópia de skills do arcanum, reestruturação de docs estilo gentle-ai; ~11 tasks, 14 requirement IDs UNV/REM/SKL/DOC).
**Prereq (roadmap):** F1–F33 ✓ (100%) · F8 ✓ (docs base — AD-035/036/038) · F10 ✓ (sync workflow — sendo removido) · F23 ✓ (ratchets/goldens — contrato E2E tocado com cuidado).
**Grupo:** M6 — Public Release (independência do vendoring + docs estilo gentle-ai; F9 publish segue aguardando OK do usuário — fora de escopo).
**Status:** Spec pronta para Design/Execute. Decisões de escopo do usuário travadas (4 fronts confirmados — não relitigar). Open questions QA-1..6 em design.md.

## Problem Statement

O repo é um monorepo de forks (`@runecraft/*`, 12 packages com `vendor.json`) com máquina de vendoring completa (vendor.manifest.json + scripts/vendor.ts + scripts/sync-upstream.ts + scripts/sync-upstream/ + patches/ + docs/SYNC.md). Decisão do usuário: **os forks ficam como source commitado; a máquina de vendoring sai**. Em paralelo o produto vira **"seu próprio gentle-ai"**: (2) remap das menções de estilo/atribuição ("padrão gentle-ai"), (3) cópia de skills do arcanum (spells) e (4) docs no padrão gentle-ai (README com tabela de roteamento + docs/ por tópico + codebase guide). O sucesso exige repo verde em cada passo, zero mudança nos 13 packages de fork, zero edição em `.specs/` (registros de decisão) e nenhuma remoção da coexistência funcional com o gentle-ai real.

**Fatos verificados no recon (2026-08-08 — sem fabricação):**

### Front 1 — Un-vendor
1. **Inventário da máquina (verificado)**: `vendor.manifest.json` (12 upstreams) · `scripts/vendor.ts` · `scripts/sync-upstream.ts` · `scripts/sync-upstream/` (18 arquivos incl. 58 testes) · `patches/` (4 `registry.json`) · `docs/SYNC.md` (184 ln) · **12 `vendor.json`** (`subagents`, `goal-loop-audit`, `pr-review`, `taskflow/{core,pi,dsl,mcp-core,hosts,codex,claude,opencode,grok}` — **não 13**; `packages/harness` não tem). Root `package.json` scripts a remover: `vendor`, `sync:upstream`, `test:sync-upstream`. **Knock-on extra (não listado no briefing)**: `scripts/tsconfig.json:12` inclui `sync-upstream.ts` + `sync-upstream/**/*.ts` — ajustar o `include`. **Verificado limpo**: `.gitignore` (sem entradas vendor/sync), `turbo.json`, `biome.json`, `prepack.mjs` (usa `bundledDependencies` do package.json — intacto). Zero deps a remover.
2. **`src/versions.ts` é AUTO-GENERADO** por `packages/harness/scripts/gen-versions.mjs` a partir do `vendor.manifest.json` (header do arquivo, mecanismo F11: arquivo commitado para npm pack hermético). Consumidores: `commands/doctor.ts` (check de versão esperada), `commands/status.ts` (tabela), `commands/sync.ts` (three-way), `commands/uninstall.ts` (preservação), `adapters/mcpConfig.ts` (pin npx `@runecraft/taskflow-<adapter>`), `extensions/observability.ts` + `observability/bundle.ts` (fingerprint sha256 inclui `forks: {...HARNESS_VERSIONS}`), `plan.ts` (comentário linha 3 + msg de erro linha 97 "fonte: vendor.manifest.json"). `test/plan.test.ts` tem o teste **"HARNESS_VERSIONS vs vendor.manifest.json (fonte única)"** (12 entradas + length) — **quebra** com a remoção do manifest. Decisão D1: a fonte única vira **os 12 package.json commitados dos forks**; o arquivo estático commitado permanece (consumidores intocados).
3. **`vendorHash` no E2E (contrato versionado F23 P2)**: `scripts/eval-e2e/types.ts:173-174` (campo `RoundResult.vendorHash: string | null`), `lib/runner.ts:55-57` (função lê vendor.manifest.json → sha256 16 hex) + `:134` (grava no round), `lib/results.ts:43` (serialização). Fixtures: `results.test.ts:33` (`"abc123"`), `ratchet-e2e.test.ts:65` (`null`). **Verificado**: nenhum teste de ratchet/normalize pinha o schema — `ratchet-e2e.ts` lê os resultados commitados com `JSON.parse` leniente (campos extras ignorados); `results.test.ts:54` só verifica presença de campos obrigatórios; `env/gate/classify/checks/scenarios/usage/runner.test.ts` não usam vendorHash. Rodadas E2E commitadas em `.specs/features/f22-e2e-benchmark/results/` contêm vendorHash — `.specs` intocadas; leitura leniente segue OK. Decisão D2: **remoção deliberada do campo** (alternativa em design.md).
4. **Knock-ons de README (verificados)**: root `README.md` ("All versions are pinned in `vendor.manifest.json`" na seção Packages; `bun run vendor --list` em Development) · `packages/harness/README.md` ("Versions are pinned in `vendor.manifest.json` (single source of truth)"; Docs: "upstream sync runbook (`docs/SYNC.md` at the repo root)" + link `../../docs/SYNC.md`) · `packages/harness/docs/README.md` (link para `../../../docs/SYNC.md`) · 4 fork READMEs ("pinned at ... (SHA ..., see `vendor.json`)") · `packages/taskflow/README.md:21` (vendor.manifest + "kept in sync three-way ... by the harness sync workflow").

### Front 2 — Remap gentle-ai
5. **Hits verificados** (grep case-insensitive "gentle", excluindo node_modules/.git/.specs/.turbo/bun.lock/vendored/.pi):
   - **Estilo/atribuição (REMAP)**: `scripts/eval-e2e/README.md:4` ("padrão gentle-ai") · `scripts/eval-e2e/lib/env.ts:9` (comentário) **e `:24` (string user-facing do `skipMessage()` — o teste `env.test.ts` não pinha o texto, só as substrings "RUNECRAFT_E2E não setado", "RUNECRAFT_E2E=1 bun run eval:e2e", "zero tokens" → reescrever é seguro)** · `scripts/eval-e2e/run.ts:14` (comentário) · `packages/harness/src/adapters/types.ts:13` ("gentle-ai pattern") · **extras encontrados (mesma categoria)**: `test/eval/layer2/fixture/scenarios.ts:7`, `test/eval/update.ts:3`, `test/EVAL-MATRIX.md:9` (prosa do header — **entradas datadas intocáveis**).
   - **Comentários de mecanismo (listados pelo usuário como REMAP)**: `doctor.ts:249-250` (doc comment do check 14), `doctor.ts:362` (comentário da tabela de checks), `doctor.ts:1061-1064` (comentário F31 two-driver — **descreve semântica real do produto; borderline** → QA-3), `install.ts:216` (comentário do gate MXST-04), `status.ts:111` (JSDoc de `owners`), `adapters/registry.ts:23` (compat de aliases copilot), `lock.ts:35` (rationale do lock).
   - **KEEP (coexistência funcional — NÃO tocar)**: `owners.ts` detecção (state file `~/.gentle-ai/state.json` + marcadores `<!-- gentle-ai:` — código 117-136 e 173), `doctor.ts` check 14 strings (~259,263,266), `plan.ts:72` (`gentle-pi` na lista de colisão), `scripts/eval-e2e/lib/preflight.ts` (`GENTLE_AI_MARKERS`), ROUTING.md §7 (linha 146) e §8.12 (457,483,485,489,839 — two-driver), testes `f18-coexistence.test.ts`/`adapters.test.ts`/`agent-install.test.ts`, root `README.md:50` (coexistência runtime).
   - **Correções do mapa do usuário (verificado por grep — registrar)**: ROUTING.md **§8.11 não tem** menções gentle (os hits são §7 + §8.12 — funcionais KEEP) · `docs/EVAL-FRAMEWORK.md` **tem zero** hits gentle · `eval-e2e/README.md:121` é a **lista de confounders** ("gentle-ai instalado" = detecção do preflight) — funcional, KEEP (→ QA-2). `owners.ts:6-9,173` foram listados como REMAP mas **são o mecanismo de detecção** (comentário de fontes de evidência + código) — conflita com o KEEP "owners.ts marker detection" (→ QA-1).

### Front 3 — Skills do arcanum
6. **Fonte**: `/home/rehem/Projects/arcanum/packages/spells/skills/` — 22 skills (pacote MIT `@runecraft/spells`; cada skill com `SKILL.md` e **frontmatter de licença própria (CC-BY-4.0) — manter as-is**). **Confirmada: skill-forge** (SKILL.md 291 ln + README.md + `assets/SKILL.template.md` + `references/` ×5 + `scripts/validate.py` — **stdlib-only, python3 ≥3.10, opcional**; não wire em CI). **Propostas (4)**: `test-driven-development` (390 ln), `using-agent-skills` (200 ln), `memory-management` (198 ln), `spec-driven` (176 ln). `loop-*` (5 skills) **não propostas por default** — sobreposição com a mecânica de loop do fork glla (two-driver); disponíveis se o usuário pedir. **Collision check**: skills dos forks = `pi-subagents` + `taskflow` — **sem colisão** com as propostas. Destino: `packages/harness/skills/<name>/` (layout using-runes: dir com SKILL.md). Wiring: `package.json pi.skills` += `"./skills/<name>"` (o `files` do npm já inclui `skills/`; nenhum teste pinha o array `pi.skills` — verificado).

### Front 4 — Docs estilo gentle-ai
7. **Home de docs**: `packages/harness/docs/` (já em `files` do npm — ships no tarball; `docs/` raiz contém só SYNC.md, que morre no Front 1) — decisão D3. **Padrão gentle-ai (referência verificada pelo usuário)**: README com tabela de roteamento ("Core Workflow") + `docs/{intended-usage, usage, agents, components, pi, trigger-rules, rollback, platforms, CODEBASE-GUIDE, architecture, testing}`. **Existentes**: `ROUTING.md` (862 ln — §1-7 EN, §8.x PT-BR, **§9 apêndice GOLDEN do F19 D9 — intocável**), `EVENTS.md`, `MEMORY.md`, `PI.md`, `EVAL-FRAMEWORK.md`, `docs/README.md` (índice). READMEs: raiz (EN) + umbrella `packages/harness/README.md` (EN, com tabela de agentes + "Relationship to upstreams") + 4 forks pointer-style.

## Goals

- [ ] **Front 1 — Un-vendor**: máquina de vendoring removida; `versions.ts` com fonte única nos package.json dos forks (UNV-01); `vendorHash` removido do contrato E2E deliberadamente (UNV-02); knock-ons de README/tsconfig ajustados (UNV-03); delete completo + scripts raiz removidos, repo verde (UNV-04); 13 fork packages intocados (UNV-05)
- [ ] **Front 2 — Remap**: menções ao gentle-ai removidas/mudadas em todo o repo (docs, comentários, apresentação, constantes, testes) (REM-01); literais de detecção preservados como dados — funcionamento intacto (REM-02); correções do mapa + QA-1/2/3 resolvidas (REM-03)
- [ ] **Front 3 — Skills**: skill-forge copiada byte-a-byte (frontmatter as-is) + wired no manifest pi (SKL-01); skills propostas copiadas após escolha do usuário (SKL-02); sem colisão com forks; validate.py opcional (SKL-03)
- [ ] **Front 4 — Docs**: home decidida (packages/harness/docs/) (DOC-01); páginas estilo gentle-ai criadas a partir de conteúdo existente (DOC-02); READMEs reestruturados com tabela de roteamento + posicionamento próprio (DOC-03/04); docs EN, links resolvem, verificação final verde (DOC-05)

## Out of Scope

| Item | Motivo |
| --- | --- |
| Mudança nos 13 fork packages (código, testes, READMEs além dos knock-ons de Front 1/3) | São source commitado do produto; escopo travado |
| Edição de `.specs/` (ADRs, ROADMAP, STATE, resultados F22, specs F1..F33) | Registros de decisão (instrução explícita) — inclusive `results/` com vendorHash (leitura leniente) |
| Remoção da detecção de coexistência (owners, check 14, preflight, ROUTING §7/§8.12, testes) | Funcionamento preservado — só apresentação/menções mudam; literais de detecção ficam como dados |
| `LICENSE-THIRD-PARTY.md` / atribuições de terceiros | AD-035 fechada (remoção; risco aceito) |
| Tradução integral de ROUTING.md §8.x (PT-BR → EN) | Grande (862 ln); default = headers + conteúdo novo nas páginas EN; corpo completo diferido (QA-4) |
| Camada visual/SVG dos READMEs (beautify-github-readme visual) | Usuário aplica depois — Front 4 planeja só a camada markdown/conteúdo |
| Features inventadas nas docs | Regra F8: docs honestas, zero invenção |
| `.pi/skills/roadmap-loop/` (untracked local) | Local do usuário; nota opcional (linhas 25/33 citam F10/sync-upstream) |
| F9 publishing pipeline | Aguardando OK do usuário (independe do F34) |
| Deps novas | Zero deps em todos os fronts |

## Decisões da spec (assumptions herdadas + atualizadas)

- **Idioma**: docs shipped EN (AD-038); `.specs` PT-BR (esta spec).
- **Fonte de verdade das versões** = 12 package.json commitados dos forks (D1); `HARNESS_VERSIONS` continua estático/commitado (hermético p/ npm pack — mecanismo F11 preservado).
- **vendorHash** = remoção deliberada (D2; ver QA-6 — alternativa documentada).
- **Home de docs** = `packages/harness/docs/` (D3).
- **Remap** = menções removidas/mudadas em todo o repo (docs, comentários, apresentação, nomes de constantes/checks/owners, testes); literais de detecção (path/prefixo de marcador/nome npm) permanecem como dados — funcionamento intacto (REM-02 é invariante de verificação).
- **Skills** = cópia byte-a-byte (frontmatter as-is); propostas marcadas vs confirmadas; wiring via `pi.skills`.
- **Docs honestas** (F8): posicionamento com differentiators reais (F24/F25/F26/F27/F28/F33/F21/F23/F31) e áreas de paridade (F13/F20/F29/F30) — nada inventado.
- **Green at every step**: ordem UNV (consumidores antes do delete) → REM → SKL → DOC (ver design.md D9).

## User Stories

### P1: Un-vendor — fonte única das versões migrada (UNV-01) ⭐ MVP

**User Story**: Como mantenedor, quero remover o vendor.manifest.json sem quebrar doctor/status/sync/uninstall/mcpConfig/observability (que consomem `HARNESS_VERSIONS`) — a fonte das versões passa a ser os próprios forks commitados.

**Acceptance Criteria**:

1. WHEN `gen-versions.mjs` roda THEN ele lê os 12 package.json commitados dos forks (nunca o vendor.manifest.json) e regenera `src/versions.ts` byte-idêntico ao atual (mesmas 12 entradas)
2. WHEN `bun run generate:versions` roda THEN `--check`/regeneração não produz diff (hermético, determinístico)
3. WHEN `test/plan.test.ts` roda THEN o teste "HARNESS_VERSIONS vs ..." compara com os package.json dos forks (não com o manifest) — 12 entradas, consistência com COMPONENTS mantida
4. WHEN o manifest é deletado (T4) THEN `generate:versions` continua funcionando (fonte = forks) e `plan.ts`/`versions.ts` não citam mais vendor.manifest.json
5. WHEN o tarball npm é empacotado THEN `HARNESS_VERSIONS` segue estático no pacote (hermético — nada depende de arquivo fora do package)

**Independent Test**: `bun run generate:versions` → `git diff --stat src/versions.ts` vazio; `bun test test/plan.test.ts` verde; grep "vendor.manifest" em packages/harness/src + scripts/gen-versions.mjs vazio (pós-T4).

### P1: Un-vendor — contrato E2E sem vendorHash (UNV-02) ⭐ MVP

**User Story**: Como mantenedor, quero remover o campo `vendorHash` do contrato E2E (F23 P2) deliberadamente, sem quebrar a suite offline nem o ratchet que lê rodadas commitadas.

**Acceptance Criteria**:

1. WHEN `RoundResult` é definido THEN `vendorHash` NÃO existe mais em `scripts/eval-e2e/types.ts`; `runner.ts` não computa hash de manifest (função removida); `results.ts` não serializa o campo
2. WHEN fixtures de teste rodam THEN `results.test.ts` (schema, presença de campos obrigatórios, serialização determinística) e `ratchet-e2e.test.ts` são atualizados sem o campo — **nenhum outro teste usa vendorHash** (verificado)
3. WHEN rodadas E2E commitadas antigas (`.specs/features/f22-e2e-benchmark/results/`, com vendorHash) são lidas pelo ratchet THEN continuam parseando (leitura leniente — campos extras ignorados); `.specs` intocadas
4. WHEN `bun test scripts/eval-e2e` roda THEN os 71 testes offline passam (env-gated: sem RUNECRAFT_E2E → skip/exit 0)

**Independent Test**: `bun test scripts/eval-e2e` verde; `grep -rn "vendorHash" scripts/eval-e2e` vazio; rodada commitada antiga parseada pelo ratchet-e2e (teste existente `ratchet-e2e.test.ts` verde).

### P1: Un-vendor — knock-ons de docs/tsconfig (UNV-03)

**User Story**: Como mantenedor, quero que nenhuma doc ou config referencie a máquina de vendoring após o delete.

**Acceptance Criteria**:

1. WHEN root `README.md` é lido THEN "All versions are pinned in `vendor.manifest.json`" e `bun run vendor --list` não existem mais (substituídos por referência à fonte real: forks + `versions.ts`)
2. WHEN `packages/harness/README.md` é lido THEN a linha "Versions are pinned in vendor.manifest.json" e as referências a `docs/SYNC.md` somem (versões agora vêm dos forks; docs index sem SYNC)
3. WHEN `packages/harness/docs/README.md` é lido THEN o link para `../../../docs/SYNC.md` some
4. WHEN os 4 fork READMEs são lidos THEN "see `vendor.json`" some (pin permanece como fato: versão + SHA do upstream); `packages/taskflow/README.md` perde a menção a vendor.manifest + sync workflow
5. WHEN `scripts/tsconfig.json` é lido THEN o `include` não lista mais `sync-upstream.ts`/`sync-upstream/**`

**Independent Test**: `grep -rn "vendor.manifest\|vendor.json\|SYNC.md" README.md packages/harness/README.md packages/harness/docs/README.md packages/*/README.md packages/taskflow/README.md` → só hits legítimos restantes (ex.: "relationship to upstream", pins históricos).

### P1: Un-vendor — delete + repo verde (UNV-04) ⭐ MVP

**User Story**: Como mantenedor, quero o delete físico da máquina com o repo 100% verde e os forks intocados.

**Acceptance Criteria**:

1. WHEN o delete roda THEN somem: `vendor.manifest.json`, `scripts/vendor.ts`, `scripts/sync-upstream.ts`, `scripts/sync-upstream/`, `patches/`, `docs/SYNC.md`, os 12 `packages/*/vendor.json`
2. WHEN root `package.json` é lido THEN os scripts `vendor`, `sync:upstream`, `test:sync-upstream` não existem
3. WHEN `git status` é consultado THEN **nenhum arquivo sob packages/{subagents,taskflow,goal-loop-audit,pr-review}/** aparece como modificado (forks intocados — UNV-05)
4. WHEN a suite roda THEN `bun run lint` + `bun run build` + `bun test` (1193 harness) verdes; goldens/ratchets sem `--update`
5. WHEN o count de testes é reportado THEN 58 sync tests saem (1193 harness + 71 e2e offline permanecem)

**Independent Test**: `bun run lint && bun run build && bun test` verde; greps de remanescência (vendor.manifest/vendor.ts/sync-upstream/patches/SYNC.md/vendor.json) vazios; `git status --porcelain packages/` mostra zero mudanças nos forks.

### P1: Remap — menções removidas em todo o repo, funcionamento preservado (REM-01) ⭐ MVP

**User Story**: Como owner, quero remover/mudar TODA menção ao gentle-ai no repo (docs, comentários, strings de apresentação, nomes de constantes/checks/owners, testes) — mantendo o funcionamento: a detecção de coexistência continua operacional, com os literais de detecção (fingerprints) tratados como dados.

**Acceptance Criteria**:

1. WHEN a apresentação é varrida THEN nenhuma menção user-facing permanece: prosa de estilo (eval-e2e/README.md:4, lib/env.ts:9,24 — string reescrita mantendo as 3 substrings pinadas, run.ts:14, adapters/types.ts:13, scenarios.ts:7, update.ts:3, EVAL-MATRIX.md:9 prosa do header); comentários de mecanismo (doctor.ts:249-250,362,1061-1064, install.ts:216, status.ts:111, registry.ts:23, lock.ts:35, owners.ts:6-9); docs (ROUTING §7/§8.12, root README:50, eval-e2e README:121)
2. WHEN a apresentação do subsistema de coexistência muda THEN: owner name `"gentle-ai"` → genérico (ex.: `"upstream-installer"`); título do check 14 genérico (ex.: "upstream coexistence"); detail strings sem nome de produto; constante `GENTLE_AI_MARKERS` → nome neutro (`UPSTREAM_MARKERS`) com valores preservados
3. WHEN os literais de detecção são avaliados THEN permanecem como dados (o funcionamento exige): path `~/.gentle-ai/state.json`, prefixo de marcador `"gentle-ai:"`, nome npm `gentle-pi` na lista de colisão — documentados como fingerprints de terceiros (nota em CODEBASE-GUIDE)
4. WHEN os testes são atualizados THEN: fixtures continuam usando os literais reais (dados); asserts/descrições/nomes que pinavam a apresentação ("[14] gentle-ai", `o.name === "gentle-ai"`) mudam para o nome genérico; comportamento (warn, no-clobber, abort) inalterado
5. WHEN um teste roda THEN a suite completa verde (1193 harness + 71 e2e offline)

**Independent Test**: grep case-insensitive "gentle" (excluindo node_modules/.git/.specs/.turbo/vendored/.pi) retorna SÓ os literais de dados documentados (owners.ts path/prefixo, plan.ts:72, fixtures de teste) — zero apresentação; `bun test` verde; comportamento de coexistência coberto pelos testes atualizados.

### P1: Remap — correções do mapa (REM-03)

**User Story**: Como owner, quero que o plano registre as correções do mapa de menções verificadas por grep (sem ação de edição onde não há hit).

**Acceptance Criteria**:

1. WHEN ROUTING.md §8.11 é procurado por "gentle" THEN zero hits (correção registrada; os hits funcionais estão em §7:146 e §8.12 — KEEP)
2. WHEN `docs/EVAL-FRAMEWORK.md` é procurado por "gentle" THEN zero hits (correção registrada — nada a editar)
3. WHEN `eval-e2e/README.md:121` é avaliado THEN é a lista de confounders (funcional, ligada ao preflight KEEP) — sem edição (QA-2)
4. WHEN `owners.ts` é avaliado THEN (QA-1 resolvida 2026-08-08 — usuário: "remover menções, manter funcionamento"): comentários 6-9 reescritos sem nome de produto; owner name/details genericizados; literais de detecção (`~/.gentle-ai/state.json`, prefixo `"gentle-ai:"`) permanecem como dados

**Independent Test**: greps acima documentados no design.md/tasks.md com resultado verificado (zero/lista).

### P1: Skills — skill-forge (SKL-01) ⭐ MVP

**User Story**: Como owner, quero a skill skill-forge do arcanum copiada para o harness com frontmatter de licença intacto e disponível no Pi.

**Acceptance Criteria**:

1. WHEN `packages/harness/skills/skill-forge/` é criado THEN contém byte-a-byte: SKILL.md (291 ln), README.md, `assets/SKILL.template.md`, `references/` (5 arquivos), `scripts/validate.py` — frontmatter `license: CC-BY-4.0` intacto
2. WHEN `packages/harness/package.json` é lido THEN `pi.skills` inclui `"./skills/skill-forge"` (layout using-runes: dir com SKILL.md)
3. WHEN o Pi carrega o manifest THEN a skill é descoberta (mesmo mecanismo do using-runes); sem colisão de nome com skills dos forks (pi-subagents, taskflow — verificado)
4. WHEN `validate.py` é avaliado THEN é stdlib-only (argparse/json/re) python3 ≥3.10 — **opcional**: commitado como asset, NÃO wire em CI (sem dependência de python no repo)

**Independent Test**: `diff -r packages/harness/skills/skill-forge /home/rehem/Projects/arcanum/packages/spells/skills/skill-forge` vazio; frontmatter com license intacto; `pi.skills` atualizado; `bun test` verde.

### P1: Skills — propostas (SKL-02)

**User Story**: Como owner, quero as skills propostas (2-4, escolha minha) copiadas e wired, preenchendo os gaps vs gentle-ai.

**Acceptance Criteria**:

1. WHEN o usuário escolhe as skills (QA-5 — default: test-driven-development, using-agent-skills, memory-management, spec-driven) THEN cada uma é copiada byte-a-byte para `packages/harness/skills/<name>/` com frontmatter intacto
2. WHEN o wiring roda THEN `pi.skills` ganha `"./skills/<name>"` por skill escolhida
3. WHEN `loop-*` não é escolhido THEN permanece fora (overlap com o fork glla — two-driver; nota no design)
4. WHEN o Pi carrega THEN sem colisão de nomes; `bun test` verde

**Independent Test**: `diff -r` por skill copiada vazio; `pi.skills` com entradas; grep de nomes duplicados no array vazio.

### P2: Docs — home + páginas (DOC-01/02)

**User Story**: Como mantenedor, quero docs no padrão gentle-ai — README que roteia + páginas por tópico — com a home decidida e conteúdo extraído do existente (zero invenção).

**Acceptance Criteria**:

1. WHEN a home é decidida THEN é `packages/harness/docs/` (já em `files` do npm; `docs/` raiz fica vazia após o Front 1) — registrada em design.md D3
2. WHEN as páginas novas são criadas THEN seguem o mapa (design D4): `intended-usage.md` (hello world SDLC F7/F19 + quando usar o quê), `usage.md` (quickstart + install/doctor/status), `agents.md` (matriz 7 papéis F32 + agentes não-Pi F17/F31 — extraída do umbrella README + ROUTING §8.13), `components.md` (4 forks + camada MCP + guards/verification/evals/resilience/observability/memory/routing — extraída de ROUTING §8.5-8.14 + F17), `CODEBASE-GUIDE.md` (repository-map + mental-model + maintainer-playbook), `testing.md` (evals: reenquadra/links EVAL-FRAMEWORK.md)
3. WHEN qualquer página menciona capacidades THEN a fonte é conteúdo existente (checklist de extração — nada inventado; regra F8)
4. WHEN páginas são escritas THEN idioma EN (AD-038); ROUTING.md §9 (apêndice golden F19 D9) intocado

**Independent Test**: todos os links das páginas resolvem (`ls` de cada path); checklist de extração por página (fonte → seção) preenchido nas tasks; grep "F1[0-9]|F2[0-9]|F3[0-9]" nas páginas novas só com refs pontuais de relacionamento.

### P2: Docs — READMEs + posicionamento (DOC-03/04)

**User Story**: Como owner, quero o README (raiz + umbrella) reestruturado no método beautify-github-readme com o produto posicionado como seu próprio gentle-ai — diferente, honesto.

**Acceptance Criteria**:

1. WHEN o README raiz é reestruturado THEN segue a ordem: o que é → prova/valor (evals, ratchets, garantias) → quickstart → **tabela de roteamento (Core Workflow)** → links de docs → development — sem a seção "vendor"
2. WHEN a tabela de roteamento é criada THEN espelha ROUTING.md §3 (ferramentas × quando usar × two-driver) sem duplicar o texto completo (link para ROUTING.md)
3. WHEN o posicionamento é escrito THEN o produto tem identidade própria com differentiators reais (F24 guards com bloqueio real de tool_call, F25 cascata de verificação com limiares em código, F26/F21/F23 eval harness + ratchets/goldens, F27 resiliência/stall detection, F28 event store tipado, F33 roteador codificado, F31 claude-auth/copilot) e áreas de paridade (F30 SDD, F20 receipts, F29 memória, F30 persona, F13 backup) — zero features inventadas (regra F8)
4. WHEN o umbrella README é reestruturado THEN perde o log de features F1x-F3x e as refs de vendor (Front 1); ganha link para o novo índice de docs
5. WHEN os links rodam THEN README → índice de docs → páginas resolvem (cadeia de navegação)

**Independent Test**: grep "F1[0-9]|F2[0-9]|F3[0-9]" no README raiz/umbrella retorna vazio (ou só refs pontuais); tabela de roteamento consistente com ROUTING §3 (checklist); `bun test` verde (nada funcional mudou).

### P2: Docs — índice + verificação final (DOC-05)

**User Story**: Como mantenedor, quero o índice de docs atualizado e a verificação final garantindo repo verde + greps limpos.

**Acceptance Criteria**:

1. WHEN `packages/harness/docs/README.md` é atualizado THEN lista: ROUTING, EVENTS, MEMORY, PI, EVAL-FRAMEWORK + as páginas novas (intended-usage, usage, agents, components, CODEBASE-GUIDE, testing) — sem SYNC.md
2. WHEN os greps de completude rodam THEN vazio: vendor.manifest/vendor.json/SYNC.md nos docs shipped; "padrão gentle-ai" (estilo); `@runecraft/harness` (nome antigo)
3. WHEN a suite completa roda THEN `bun run lint` + `bun run build` + `bun test` (1193) verdes; golden chain F19 (§9) intacto; zero `--update` de ratchets/goldens
4. WHEN o idioma é verificado THEN docs shipped EN (AD-038)

**Independent Test**: todos os links do índice resolvem; os 3 greps de completude vazios; suite verde.

## Edge Cases

- WHEN o delete da máquina roda ANTES do gen-versions migrado THEN `generate:versions` quebra (lê manifest ausente) → ordem travada: T1 (consumidores) antes de T4 (delete) — green at every step
- WHEN o manifest some e `plan.ts:97` cita "fonte: vendor.manifest.json" THEN a msg de erro é reescrita para apontar os package.json dos forks (T1)
- WHEN rodadas E2E commitadas antigas contêm vendorHash e o campo some do schema THEN ratchet lê lenientemente (JSON.parse ignora extra) — `.specs` intocadas; teste existente cobre
- WHEN `skipMessage()` muda o texto (remap) THEN nenhum assert pinha o wording — só as 3 substrings (verificado em env.test.ts)
- WHEN EVAL-MATRIX.md:9 tem "padrão gentle-ai" na prosa do header THEN só a prosa muda — entradas datadas (EVAL-nnn) intocáveis (governança F21 D9)
- WHEN um fork README perde "see vendor.json" THEN o pin (versão + SHA) permanece como fato histórico de relacionamento (sem link para arquivo deletado)
- WHEN python3 não está disponível THEN validate.py fica como asset inerte (opcional) — nunca vira dependência de CI/test
- WHEN o usuário escolhe skills com nomes que colidem com forks THEN a escolha é recusada na task (verificado: nenhuma das propostas colide — pi-subagents/taskflow)
- WHEN ROUTING.md §8.x continua PT-BR e uma página nova EN extrai conteúdo dele THEN a página nova é a fonte EN; o §8.x não é duplicado (link) — QA-4
- WHEN o golden chain F19 (renderRules ↔ ROUTING §9) é tocado por acidente THEN a task de docs falha a verificação (teste f19-routing) — §9 intocável
- WHEN um grep de completude encontra hit não listado THEN o hit é avaliado contra a lista de literais de dados e documentado (nunca removido silenciosamente — pode ser fingerprint funcional)
- WHEN o owner name é genericizado THEN os testes que filtram `o.name === "gentle-ai"` e o check 14 (`"[14] gentle-ai"`) são atualizados junto — o comportamento (warn/no-clobber/abort) não muda

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| UNV-01 | P1: Fonte única das versões migrada para os package.json dos forks (gen-versions + plan.ts + plan.test.ts) | Design | Pending |
| UNV-02 | P1: vendorHash removido do contrato E2E (types/runner/results + fixtures); suite offline verde; rodadas antigas lenientes | Design | Pending |
| UNV-03 | P1: Knock-ons de docs/tsconfig (README raiz/umbrella/docs-index/4 forks + scripts/tsconfig.json include) | Design | Pending |
| UNV-04 | P1: Delete da máquina + scripts raiz; repo verde; forks intocados | Design | Pending |
| UNV-05 | P1: Invariante — zero mudança nos 13 fork packages (verificação em UNV-04) | Design | Pending |
| REM-01 | P1: Remap do estilo/atribuição (hits verificados + extras; string user-facing segura) | Design | Pending |
| REM-02 | P1: Funcionamento preservado — literais de detecção como dados (invariante de verificação) | Design | Pending |
| REM-03 | P1: Correções do mapa registradas (ROUTING §8.11/EVAL-FRAMEWORK zero hits; README:121 funcional; owners.ts borderline) | Design | Pending |
| SKL-01 | P1: skill-forge copiada byte-a-byte + wired no pi.skills; validate.py opcional | Design | Pending |
| SKL-02 | P1: Skills propostas (QA-5) copiadas + wired | Design | Pending |
| SKL-03 | P1: Sem colisão com skills dos forks (verificado) — invariante | Design | Pending |
| DOC-01 | P2: Home de docs decidida (packages/harness/docs/) | Design | Pending |
| DOC-02 | P2: Páginas estilo gentle-ai (intended-usage/usage/agents/components/CODEBASE-GUIDE/testing) extraídas do existente | Design | Pending |
| DOC-03 | P2: READMEs reestruturados (beautify-github-readme + tabela Core Workflow) | Design | Pending |
| DOC-04 | P2: Posicionamento próprio (differentiators × paridade) — honesto (F8) | Design | Pending |
| DOC-05 | P2: Índice + verificação final (links, greps, suite verde, golden F19) | Design | Pending |
| DOC-06 | P2: README visual via skill beautify-github-readme (preview local + aprovação; zero invenção) | Design | Pending |

**Coverage:** 16 total, 0 mapeados, 16 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Máquina de vendoring 100% removida (manifest, scripts, patches, SYNC.md, 12 vendor.json, scripts raiz, tsconfig include) — repo verde a cada passo (lint/build/test 1193 + e2e 71 offline)
- [ ] `HARNESS_VERSIONS` funcional com fonte única nos forks (gen-versions regenera sem diff; plan.test.ts consistente; tarball hermético)
- [ ] Contrato E2E sem vendorHash (deliberado, fixtures atualizados, rodadas antigas lenientes, suite offline verde)
- [ ] Remap aplicado nos hits verificados; KEEP list byte-a-byte (grep de completude = só KEEP + documentados); zero quebra de teste
- [ ] skill-forge + skills escolhidas copiadas byte-a-byte com frontmatter intacto e wired no `pi.skills`; zero colisão
- [ ] Docs estilo gentle-ai: README com tabela de roteamento + 6 páginas novas EN + índice; posicionamento próprio honesto (differentiators reais × paridade); links resolvem; golden chain F19 intacto
- [ ] 13 fork packages intocados; `.specs/` intocados; coexistência funcional intacta; zero deps novas; zero features inventadas
- [ ] ≤6 open questions para o usuário (QA-1..6 em design.md)
