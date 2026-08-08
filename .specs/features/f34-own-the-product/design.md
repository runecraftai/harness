# F34 Design — Own the Product (un-vendor + remap + skills + docs)

**Status:** Ready for Tasks (decisões de escopo do usuário travadas; QA-1..6 para confirmação antes do Execute).
**Decisões aprovadas (usuário, travadas):** os 4 fronts confirmados · forks ficam como source commitado (zero mudança nos 13 packages) · máquina de vendoring sai · `.specs/` intocados (registros) · coexistência funcional preservada (literais como dados; menções removidas) · AD-035 (sem LICENSE-THIRD-PARTY) · AD-038 (docs shipped EN, .specs PT-BR) · skill-forge confirmada + 2-4 propostas a escolher · docs honestas (regra F8) · zero deps novas · camada visual/SVG dos READMEs fica para o usuário.

## Contexto (fatos verificados no recon — fonte citada)

### Front 1 — Un-vendor
1. Inventário: `vendor.manifest.json` (12 upstreams) · `scripts/vendor.ts` · `scripts/sync-upstream.ts` · `scripts/sync-upstream/` (18 arquivos, 58 testes) · `patches/` (4 registry.json) · `docs/SYNC.md` (184 ln) · **12** `vendor.json` (não 13 — packages/harness não tem). Root scripts `vendor`/`sync:upstream`/`test:sync-upstream`. `scripts/tsconfig.json:12` inclui sync-upstream. `.gitignore`/`turbo.json`/`biome.json`/`prepack.mjs` limpos.
2. `src/versions.ts` (AUTO-GENERATED por `packages/harness/scripts/gen-versions.mjs` do vendor.manifest.json) → consumido por doctor:34/181, status:24/239, sync:28/100/126, uninstall:34/504, mcpConfig:9/84 (pin npx), observability bundle:22/147 + extension:59/329, plan.ts:3/97. `test/plan.test.ts:54` pinha o manifest (12 entradas).
3. `vendorHash`: types.ts:173-174, runner.ts:55-57/134, results.ts:43; fixtures results.test.ts:33 (`"abc123"`), ratchet-e2e.test.ts:65 (`null`). Nenhum teste de ratchet/normalize pinha o schema (ratchet-e2e.ts:192 JSON.parse leniente; results.test.ts:54 presence-only). Rodadas commitadas em `.specs/features/f22-e2e-benchmark/results/` (intocadas).
4. Knock-ons: root README (2 refs), harness README (2 refs vendor + 2 refs SYNC), docs/README.md (1 link SYNC), 4 fork READMEs ("see vendor.json"), taskflow README:21 (manifest + sync workflow).

### Front 2 — Remap
5. Hits verificados (grep case-insensitive "gentle" excl. node_modules/.git/.specs/.turbo/bun.lock/vendored/.pi): **APRESENTAÇÃO (remover/mudar — decisão do usuário)**: prosa de estilo (eval-e2e/README.md:4, lib/env.ts:9+24 — string user-facing reescrita mantendo as 3 substrings pinadas, run.ts:14, adapters/types.ts:13, scenarios.ts:7, update.ts:3, EVAL-MATRIX.md:9 prosa do header), comentários de mecanismo (doctor.ts:249-250/362/1061-1064, install.ts:216, status.ts:111, registry.ts:23, lock.ts:35, owners.ts:6-9), docs de coexistência (ROUTING §7:146 + §8.12:457,483,485,489,839, root README:50, eval-e2e README:121), apresentação do subsistema (owner name, título/detalhes do check 14, nome da constante GENTLE_AI_MARKERS, nomes/descrições/asserts de testes). **DADOS (permanecem como literais — o funcionamento exige)**: path `~/.gentle-ai/state.json` (owners.ts + fixtures), prefixo `"gentle-ai:"` (owners.ts + fixtures), nome npm `gentle-pi` (plan.ts:72).
6. Correções do mapa: ROUTING §8.11 = zero hits; EVAL-FRAMEWORK.md = zero hits; eval-e2e README:121 = funcional (reescrever apresentação, manter detecção); owners.ts:6-9/173 = decisão registrada (QA-1 resolvida — remover menções, manter funcionamento).

### Front 3 — Skills
7. Fonte: `/home/rehem/Projects/arcanum/packages/spells/skills/` (22 skills; MIT package; frontmatter CC-BY-4.0 por skill — manter as-is). skill-forge: SKILL.md 291 ln + README + assets/SKILL.template.md + references/×5 + scripts/validate.py (stdlib, python3 ≥3.10, opcional). Propostas: tdd 390 ln, using-agent-skills 200, memory-management 198, spec-driven 176. Forks skills: pi-subagents + taskflow — sem colisão. Wiring: `pi.skills` += `"./skills/<name>"` (layout using-runes; `files` já inclui skills/; nenhum teste pinha o array).

### Front 4 — Docs
8. Home: packages/harness/docs/ (em `files` do npm). Padrão gentle-ai (referência do usuário): README com tabela "Core Workflow" + docs/{intended-usage, usage, agents, components, pi, trigger-rules, rollback, platforms, CODEBASE-GUIDE, architecture, testing}. Existentes: ROUTING.md (862 ln; §1-7 EN, §8.x PT-BR, §9 golden F19 D9), EVENTS/MEMORY/PI/EVAL-FRAMEWORK.md, docs/README.md. READMEs raiz (EN) + umbrella (EN) + 4 forks pointer-style.

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Fonte única das versões = os 12 package.json commitados dos forks** (UNV-01). `gen-versions.mjs` é reescrito: lê `packages/<fork>/package.json` (mapeamento direto nome → path, sem RENAMES de manifest), mantém o cross-check com `dependencies` do package.json do harness e a geração do arquivo estático commitado. Header/comentários de `versions.ts` e `plan.ts:3/97` atualizados. `test/plan.test.ts` passa a comparar contra os package.json dos forks (12 entradas + consistência COMPONENTS). `HARNESS_VERSIONS` permanece estático e idêntico (0 diff após regenerar) — consumidores (doctor/status/sync/uninstall/mcpConfig/observability/plan) **intocados** | Mecanismo F11 (arquivo commitado p/ tarball hermético) preservado; zero mudança em 8 consumidores; a fonte mora nos forks (que são o source commitado do produto) — sem arquivo extra de pinning; risco de drift eliminado pelo cross-check package.json |
| D2 | **vendorHash removido do contrato E2E deliberadamente** (UNV-02). Remover: campo em types.ts, função + uso em runner.ts, serialização em results.ts; atualizar fixtures (results.test.ts, ratchet-e2e.test.ts). Documentar a mudança de schema no commit (contrato F23 P2). Rodadas commitadas antigas seguem legíveis (parse leniente — ratchet-e2e.ts:192). **Alternativa (se o usuário preferir manter o campo):** hash do fingerprint dos 12 fork package.json commitados (substitui o manifest como fonte estável) — QA-6 | Verificado: nenhum teste de ratchet/normalize pinha o schema; o campo era correlação de confounder (forks mudaram sem bump) que perde sentido quando os forks SÃO o source; remoção é mais limpa que inventar nova fonte; rodadas antigas não quebram (leniente) |
| D3 | **Home de docs = `packages/harness/docs/`** (DOC-01) | Já em `files` do npm (ships no tarball); `docs/` raiz só tem SYNC.md (morre no Front 1); evita dir raiz com página única que não empacota; mantém o padrão F8 (índice + ROUTING já lá) |
| D4 | **Mapa de páginas estilo gentle-ai** (DOC-02) — extração do existente, zero invenção: | |
| | `intended-usage.md` (novo) ← ROUTING §1-2/§5 (hello world SDLC F7/F19, quando usar o quê) | gentle-ai tem intended-usage; o hello world versionado é a prova de uso real |
| | `usage.md` (novo) ← README raiz quickstart + umbrella (install/doctor/status/sync/uninstall/config) | gentle-ai usage; centraliza o quickstart fora do README |
| | `agents.md` (novo) ← umbrella README (tabela 7 papéis F32) + ROUTING §8.13 + F17 matriz (não-Pi: claude-code/opencode/codex/copilot) | gentle-ai agents (matrix); extrai a matriz que hoje vive no README |
| | `components.md` (novo) ← ROUTING §8.5-8.14 + F17 + F6 (4 forks + camada MCP + guards/verification/evals/resilience/observability/memory/persona/routing) | gentle-ai components; o mapa de capacidades do harness |
| | `CODEBASE-GUIDE.md` (novo) ← estrutura do repo + STATE/F8 convenções (repository-map, mental-model, maintainer-playbook — incl. "forks são source commitado, sem sync") | gentle-ai CODEBASE-GUIDE; guia de contribuidor |
| | `testing.md` (novo) ← EVAL-FRAMEWORK.md (reenquadra como landing page de evals: suites/ratchets/goldens/E2E + comandos) | gentle-ai testing; EVAL-FRAMEWORK.md vira referência linkada (sem reescrita) |
| | `ROUTING.md` permanece (mental model canônico) · `EVENTS.md`/`MEMORY.md`/`PI.md` permanecem (linkados) · **não criar**: trigger-rules (ROUTING já é o trigger/mecanismo), rollback (uninstall/backups F13 — seção no usage.md), platforms (components.md cobre os agentes), architecture (sem doc de arquitetura hoje — CODEBASE-GUIDE mental-model cobre; criar só se o usuário pedir — QA-4b) | Padrão gentle-ai adaptado à realidade do harness; zero features/estruturas inventadas |
| D5 | **READMEs reestruturados (beautify-github-readme — camada markdown)** (DOC-03): root README = o que é → prova/valor (1193 testes, ratchets/goldens, garantias F24-F28/F33) → quickstart → **tabela de roteamento (Core Workflow** — espelha ROUTING §3: tool × quando usar × two-driver; link para ROUTING) → docs links → development. Umbrella README = idem sem log F1x-F3x e sem refs vendor. Camada visual/SVG fica para o usuário (fora) | Método do usuário (beautify-github-readme); a tabela Core Workflow é o padrão gentle-ai de roteamento; nada duplicado integralmente (link ROUTING) |
| D6 | **Posicionamento: produto próprio, "seu gentle-ai"** (DOC-04): identidade runecraft + differentiators REAIS — F24 (guards com bloqueio real de tool_call `{block:true}`), F25 (cascata de verificação com limiares em código, judge LLM env-gated), F21/F26/F23 (eval harness determinístico + goldens/ratchets versionados), F27 (resiliência/stall detection/fallback), F28 (event store tipado com prevHash chain), F33 (roteador codificado — rota por código, nunca LLM), F31 (claude-auth/copilot adapter); áreas de paridade (padrões gentle-ai que o harness também tem): F30 SDD, F20 receipts, F29 memória, F30 persona, F13 backup. **Nenhuma feature inexistente é mencionada (regra F8)** | O usuário constrói "seu próprio gentle-ai"; docs honestas (F8) — differentiators com evidência (EVAL-nnn/features), paridade sem claim de superioridade |
| D7 | **Skills: skill-forge confirmada + 4 propostas** (SKL-01/02): copy byte-a-byte (frontmatter as-is) para `packages/harness/skills/<name>/`; wiring `pi.skills`; `loop-*` fora por default (overlap com a mecânica de loop do fork glla — two-driver; disponível se pedido). validate.py = asset opcional, não wire em CI | Escopo do usuário (skill-forge confirmada; 2-4 propostas a escolher — QA-5); zero colisão (verificado); CC-BY-4.0 do frontmatter é a licença da skill — mantida |
| D8 | **Ordem de execução — green at every step** (UNV-04): T1 (versions/consumidores) → T2 (vendorHash E2E — "último na frente" do Front 1) → T3 (knock-ons docs/tsconfig) → T4 (delete máquina + scripts raiz) → T5 (remap) → T6/T7 (skills) → T8-T11 (docs). Front 1 fecha antes de T5 porque os docs do Front 4 (T8+) consomem o estado pós-un-vendor; T4 exige T1-T3 verdes (delete só depois dos consumidores) | O delete do manifest ANTES do gen-versions migrado quebraria `generate:versions`; o remap antes do Front 1 reescreveria linhas que o Front 1 também toca (READMEs) — ordem evita conflito/retrabalho |
| D9 | **Gates de verificação** (todas as tasks): `bun test` (1193 harness + 71 e2e offline — após T4, sem os 58 sync) · `bun run lint` + `bun run build` · goldens/ratchets sem `--update` · greps de completude (vendor.manifest/vendor.json/SYNC.md/"padrão gentle-ai"/`@runecraft/harness`) · `git status --porcelain packages/` zero nos forks · golden chain F19 (§9 ROUTING) intacto · links de docs resolvem | Casa: cada task tem verificação independente (padrão F1-F33); os greps são o contrato de completude |
| D10 | **Menções removidas em todo o repo, funcionamento preservado** (QA-1/2/3 resolvidas 2026-08-08 — decisão do usuário): apresentação genericizada (owner name, check 14, details, constantes, comentários, docs, testes); **literais de detecção permanecem como dados**: path `~/.gentle-ai/state.json`, prefixo `"gentle-ai:"`, nome npm `gentle-pi` — a detecção de coexistência exige os fingerprints; documentar em CODEBASE-GUIDE ("third-party fingerprints — data, not branding") | Detecção intocável no mecanismo; só nomes/exibição/comentários/asserts mudam. Literais = dados, não menção |

## Arquitetura — mudanças por front

```
repo raiz/
├── vendor.manifest.json            ✗ REMOVER (T4)
├── scripts/
│   ├── vendor.ts                   ✗ REMOVER (T4)
│   ├── sync-upstream.ts            ✗ REMOVER (T4)
│   ├── sync-upstream/              ✗ REMOVER (T4 — 18 arquivos, 58 testes)
│   └── tsconfig.json               ✎ include: remover sync-upstream.ts + sync-upstream/** (T3)
├── patches/                        ✗ REMOVER (T4 — 4 registry.json)
├── docs/SYNC.md                    ✗ REMOVER (T4)
├── package.json                    ✎ scripts: vendor/sync:upstream/test:sync-upstream removidos (T4)
└── packages/
    ├── {subagents,taskflow/*,goal-loop-audit,pr-review}/
    │   ├── vendor.json             ✗ REMOVER ×12 (T4)
    │   └── README.md               ✎ refs "see vendor.json" + taskflow README:21 (T3)
    └── harness/
        ├── scripts/gen-versions.mjs        ✎ fonte: vendor.manifest.json → 12 package.json dos forks (T1)
        ├── src/versions.ts                 ✎ header/comentários (T1; conteúdo idêntico)
        ├── src/plan.ts                     ✎ comentários linha 3/97 (T1)
        ├── test/plan.test.ts               ✎ teste de consistência → package.json dos forks (T1)
        ├── skills/{skill-forge,...}/       ✚ cópias byte-a-byte (T6/T7)
        ├── docs/                           ✚ pages novas (T8-T10) + README.md índice (T11)
        ├── README.md                       ✎ reestruturação (T11)
        └── package.json                    ✎ pi.skills += "./skills/<name>" (T6/T7)
scripts/eval-e2e/
├── types.ts · lib/runner.ts · lib/results.ts   ✎ vendorHash removido (T2)
├── README.md · lib/env.ts · run.ts             ✎ remap estilo (T5)
packages/harness/src/commands/{doctor,install,status}.ts · src/adapters/{types,registry}.ts · src/lock.ts   ✎ remap comentários (T5)
test/eval/layer2/fixture/scenarios.ts · test/eval/update.ts · test/EVAL-MATRIX.md   ✎ remap prosa (T5)
README.md (raiz)                                ✎ remover refs vendor (T3) + reestruturação (T11)
```

## Ordem de execução (green at every step — D8)

```
T1 (UNV-01) → T2 (UNV-02) → T3 (UNV-03) → T4 (UNV-04/05) → T5 (REM) → T6 (SKL-01) → T7 (SKL-02, gated QA-5) → T8 (DOC-02a) → T9 (DOC-02b) → T10 (DOC-02c) → T11 (DOC-03/04/05)
```

Racional: T1 antes de T4 (gen-versions migrado antes do delete do manifest); T2 é "o último da frente" (contrato E2E muda por último no Front 1); T3 antes de T4 (docs não apontam para o que vai sumir); Front 4 por último (consome o estado pós-un-vendor + linguagem remapeada). Cada task é um commit atômico (padrão da casa) com verificação independente.

## Verificação — gates (D9)

| Gate | Comando/Checagem | Onde |
| --- | --- | --- |
| Suite harness | `bun test` (1193) — verde, zero `--update` | T1..T11 |
| Suite E2E offline | `bun test scripts/eval-e2e` (71) — env-gated skip | T2, T5 |
| Lint/build | `bun run lint` · `bun run build` | T4, T11 (e pós-edit) |
| Golden chain F19 | `bun test test/f19-routing.test.ts` (§9 ROUTING intocado) | T8-T11 |
| Forks intocados | `git status --porcelain packages/{subagents,taskflow,goal-loop-audit,pr-review}` vazio | T4 e final |
| Grep vendor | `vendor.manifest|vendor.json|SYNC.md` fora de .specs/vendored — só hits documentados | T3, T4, T11 |
| Grep gentle | "gentle" case-insensitive → só literais de dados (path/prefixo/nome npm) + documentados | T5, T11 |
| Grep nome antigo | `@runecraft/harness` → vazio fora de .specs | T11 |
| Grep estilo | `padrão gentle-ai|gentle-ai pattern` → vazio | T5, T11 |
| Skills | `diff -r` vs fonte = vazio; frontmatter license intacto; `pi.skills` wired | T6, T7 |
| Docs | todos os links resolvem; EN; checklist de extração por página | T8-T11 |
| generate:versions | `bun run generate:versions` → 0 diff | T1 |

## Requisitos cobertos

| Requirement | Decisões | Tasks |
| --- | --- | --- |
| UNV-01 | D1 | T1 |
| UNV-02 | D2 | T2 |
| UNV-03 | D1/D8 | T3 |
| UNV-04 | D8/D9 | T4 |
| UNV-05 | D9 | T4 |
| REM-01 | D10 | T5 |
| REM-02 | D10/D9 | T5 |
| REM-03 | D10 | T5 |
| SKL-01 | D7 | T6 |
| SKL-02 | D7 | T7 |
| SKL-03 | D7/D9 | T6, T7 |
| DOC-01 | D3 | T8 |
| DOC-02 | D4 | T8, T9, T10 |
| DOC-03 | D5 | T11 |
| DOC-04 | D6 | T11 |
| DOC-05 | D4/D9 | T11 |

## Open questions para o usuário (QA-4..6 — confirmar antes do Execute)

- **QA-1 — owners.ts (RESOLVIDA 2026-08-08 — usuário: "remover menções, manter funcionamento")**: comentários 6-9 reescritos sem nome de produto; `name`/`detail` do owner genericizados; **literais de detecção permanecem como dados** (`~/.gentle-ai/state.json`, prefixo `"gentle-ai:"`); testes atualizados (fixtures = dados reais, asserts = nome genérico)
- **QA-2 — eval-e2e/README.md:121 (RESOLVIDA — mesma decisão)**: lista de confounders reescrita genericamente ("upstream installers"); o preflight continua detectando com os literais
- **QA-3 — doctor.ts:1061-1064 (RESOLVIDA — mesma decisão)**: reword sem nome de produto; fato two-driver preservado genericamente
- **QA-4 — ROUTING.md §8.x PT-BR → EN**: as seções 8.5-8.14 são PT-BR (headers e corpo) enquanto §1-7 são EN; Front 4 exige docs EN. **(a) recomendado — headers dos §8.x traduzidos + conteúdo novo nas páginas EN (components/agents extraem); tradução integral do corpo diferida (862 ln, sem valor de usuário imediato)** · (b) tradução integral agora (task extra, grande) · (c) sem tradução (páginas novas são a fonte EN)
- **QA-5 — skills propostas (escolher 2-4)**: **(a) recomendado — test-driven-development, using-agent-skills, memory-management, spec-driven** (4) · (b) subconjunto menor (ex.: tdd + spec-driven) · (c) incluir loop-* (nota: overlap com a mecânica de loop do fork glla — two-driver; não recomendado por default) · (d) só skill-forge (sem propostas)
- **QA-6 — vendorHash (confirmar decisão D2)**: **(a) recomendado — remover o campo deliberadamente** (verificado: nenhum teste pinha o schema; rodadas antigas lidas lenientemente) · (b) manter o campo com nova fonte (hash do fingerprint dos 12 fork package.json — continua detectando "forks mudaram sem bump")
