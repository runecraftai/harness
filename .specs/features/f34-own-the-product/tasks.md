# F34 — Tasks (Own the Product: un-vendor + remap + skills + docs)

**Base:** design.md D1-D11 (QA-4..7 para confirmar — defaults recomendados implementáveis) · infra: F8 (docs, AD-035/036/038), F10 (sync — sendo removido), F23 (ratchets/goldens), F21/F26 (evals), F19 (ROUTING canônico + golden §9), F29 (skills Pi — using-runes layout).
**Dependências de decisão:** T2 (QA-6 vendorHash — default remoção) · T5 (QA-1/2/3 RESOLVIDAS 2026-08-08 — usuário: remover/mudar menções em todo o repo, manter funcionamento) · T7 (QA-5 skills — default 4 propostas) · T8-T10 (QA-4 docs §8.x — default headers EN + páginas novas) · T12 (QA-7 skill mode — default Whole README raiz).
**Regra de ouro:** 13 fork packages intocados · `.specs/` intocados · coexistência funcional com gentle-ai intacta · green at every step · 1 commit atômico por task (padrão da casa).

## T1 — Fonte única das versões migrada (D1, UNV-01) — Front 1, primeiro

- [x] `packages/harness/scripts/gen-versions.mjs`: reescrever a fonte — ler os **12 package.json commitados dos forks** (`packages/subagents/package.json`, `packages/taskflow/{core,pi,dsl,mcp-core,hosts,codex,claude,opencode,grok}/package.json`, `packages/goal-loop-audit/package.json`, `packages/pr-review/package.json` → `version` → `HARNESS_VERSIONS[name]` com os nomes `@runecraft/*` atuais); manter o cross-check com `dependencies` do package.json do harness (drift guard — a fonte mudou, o guard permanece); manter o modo `--check` e a geração do arquivo estático commitado (mecanismo F11 hermético)
- [x] Atualizar comentários/strings que citam vendor.manifest.json como fonte: header de `src/versions.ts` (gerado pelo próprio script), `src/plan.ts:3` e `plan.ts:97` (msg de erro → "fonte: package.json dos forks — rode `bun run generate:versions`")
- [x] `test/plan.test.ts`: substituir o teste "HARNESS_VERSIONS vs vendor.manifest.json (fonte única)" por "HARNESS_VERSIONS vs package.json dos forks" (mesmos 12 nomes/versões + length 12; sem o RENAMES do manifest — path direto por package)
- [x] **Verificar:** `bun run generate:versions` → `git diff src/versions.ts` **vazio** (conteúdo idêntico ao atual); `bun test test/plan.test.ts` verde; TSC limpo; grep "vendor.manifest" em `packages/harness/scripts/gen-versions.mjs` + `packages/harness/src/{versions.ts,plan.ts}` vazio

## T2 — vendorHash removido do contrato E2E (D2, UNV-02) — último da frente 1

- [x] `scripts/eval-e2e/types.ts`: remover o campo `vendorHash` de `RoundResult` (linhas ~173-174) + doc comment
- [x] `scripts/eval-e2e/lib/runner.ts`: remover a função `vendorHash()` (55-57) e o uso em `:134` (round sem o campo)
- [x] `scripts/eval-e2e/lib/results.ts`: remover `vendorHash: round.vendorHash` da serialização (`:43`)
- [x] Fixtures: `scripts/eval-e2e/results.test.ts:33` (remover `vendorHash: "abc123"` do sample) e `packages/harness/test/eval/ratchet-e2e.test.ts:65` (remover `vendorHash: null` do fixture) — checar nenhum outro uso (verificado: nenhum)
- [x] Registrar a mudança de schema no commit/mensagem (contrato versionado F23 P2 — remoção deliberada; rodadas antigas em `.specs/features/f22-e2e-benchmark/results/` seguem legíveis por parse leniente — `.specs` intocadas)
- [x] **Verificar:** `bun test scripts/eval-e2e` verde (71 testes offline — env-gated: sem RUNECRAFT_E2E → skip/exit 0); `bun test test/eval/ratchet-e2e.test.ts` verde (lê rodada commitada antiga com o campo extra); `grep -rn "vendorHash" scripts/eval-e2e packages/harness/test/eval/ratchet-e2e.ts` vazio

## T3 — Knock-ons de docs/tsconfig (D1/D8, UNV-03) — antes do delete

- [x] `README.md` (raiz): remover "All versions are pinned in `vendor.manifest.json`" (seção Packages — substituir por "versions come from the committed fork packages, see `packages/harness/src/versions.ts`" ou equivalente) e `bun run vendor --list` (seção Development)
- [x] `packages/harness/README.md`: remover "Versions are pinned in `vendor.manifest.json` (single source of truth)" e as 2 refs a `docs/SYNC.md` (Docs section: "upstream sync runbook" + link `../../docs/SYNC.md`)
- [x] `packages/harness/docs/README.md`: remover o bullet/link de `../../../docs/SYNC.md`
- [x] 4 fork READMEs (`subagents`, `pr-review`, `goal-loop-audit`, `taskflow`): trocar "see `vendor.json`" por nada (o pin versão+SHA permanece como fato de relacionamento); `packages/taskflow/README.md:21`: remover "per-package `vendor.json` refs in `vendor.manifest.json`" e "kept in sync three-way ... by the harness sync workflow" (forks são source commitado agora)
- [x] `scripts/tsconfig.json`: `include` sem `sync-upstream.ts`/`sync-upstream/**/*.ts`
- [x] **Verificar:** `bun test` verde (nada funcional mudou — docs-only); `grep -rn "vendor.manifest\|SYNC.md" README.md packages/harness/README.md packages/harness/docs/README.md packages/{subagents,pr-review,goal-loop-audit,taskflow}/README.md` → zero hits (ou só documentados)

## T4 — Delete da máquina + scripts raiz (D8/D9, UNV-04/05)

- [x] `git rm`: `vendor.manifest.json` · `scripts/vendor.ts` · `scripts/sync-upstream.ts` · `scripts/sync-upstream/` (18 arquivos, 58 testes) · `patches/` (4 registry.json) · `docs/SYNC.md` · os **12** `packages/*/vendor.json`
- [x] `package.json` (raiz): remover scripts `vendor`, `sync:upstream`, `test:sync-upstream` (manter `eval:e2e`/`test:eval-e2e` — são do produto)
- [x] **Verificar:** `bun run lint` + `bun run build` + `bun test` verdes (1193 harness + 71 e2e offline; 58 sync saem); goldens/ratchets sem `--update`; `git status --porcelain packages/{subagents,taskflow,goal-loop-audit,pr-review}` **vazio** (UNV-05); greps de remanescência vazios: `vendor.manifest|vendor.ts|sync-upstream|patches/|SYNC.md|vendor.json` (fora de .specs/node_modules)

## T5 — Remap: menções removidas em todo o repo, funcionamento preservado (D10, REM-01/02/03) — após Front 1

- [x] **Apresentação — prosa de estilo**: reescrever sem nomear o produto (ex.: "env-gated (fail-closed, zero tokens em CI)", "explicit human-in-the-loop update"): `scripts/eval-e2e/README.md:4` · `lib/env.ts:9` e `:24` (**string user-facing do skipMessage — manter as 3 substrings que o env.test.ts pinha**: "RUNECRAFT_E2E não setado", "RUNECRAFT_E2E=1 bun run eval:e2e", "zero tokens") · `run.ts:14` · `packages/harness/src/adapters/types.ts:13` · `test/eval/layer2/fixture/scenarios.ts:7` · `test/eval/update.ts:3` · `test/EVAL-MATRIX.md:9` (só prosa do header — entradas datadas EVAL-nnn intocáveis)
- [x] **Apresentação — comentários de mecanismo**: reword sem nome de produto, preservando o fato técnico: `src/commands/doctor.ts:249-250` (doc comment check 14 → "coexistência com outros installers"), `doctor.ts:362`, `doctor.ts:1061-1064` (fato two-driver genérico — QA-3 resolvida), `install.ts:216` (gate MXST-04 → "owners (coexistência, upstreams Pi, MCP)"), `status.ts:111` (JSDoc owners), `adapters/registry.ts:23` (fato "vscode/vscode-copilot/github-copilot aceitos por compat"), `lock.ts:35` ("a parallel sync/harness run"), `src/owners.ts:6-9` (header de evidências → "upstream installer state file", "upstream marker pairs" — QA-1 resolvida)
- [x] **Apresentação — subsistema de coexistência**: `src/owners.ts` owner name `"gentle-ai"` → genérico (ex.: `"upstream-installer"`); detail "marcadores gentle-ai: em ..." → "marcadores de outro installer em ..."; `src/commands/doctor.ts` check 14: título/detalhe/remedy genéricos ("upstream coexistence", sem nome de produto); `scripts/eval-e2e/lib/preflight.ts`: constante `GENTLE_AI_MARKERS` → `UPSTREAM_MARKERS` (valores preservados); `src/plan.ts` comentário do `gentle-pi` se houver
- [x] **Docs de coexistência**: `docs/ROUTING.md` §7:146 + §8.12:457,483,485,489,839 reescritos genericamente ("outros installers", "marker pairs de terceiros", two-driver sem nome de produto); root `README.md:50` → "Coexistence with other installers is detected (doctor check)"; `scripts/eval-e2e/README.md:121` (lista de confounders → "upstream installers presentes" — QA-2 resolvida)
- [x] **Testes atualizados (comportamento inalterado)**: `test/f18-coexistence.test.ts` — fixtures continuam com os literais reais (dados); nomes/descrições/comentários de teste e asserts de apresentação genericizados (`o.name === "gentle-ai"` → nome genérico; `"[14] gentle-ai"` → título novo; `toContain("gentle-ai")` em stdout/stderr → só onde o caminho aparece como dado); `test/adapters.test.ts` + `test/agent-install.test.ts` — fixtures de marcador mantidas, descrições genericizadas
- [x] **DADOS (não tocar — funcionamento)**: path `~/.gentle-ai/state.json` (owners.ts + fixtures), prefixo `"gentle-ai:"` (owners.ts + fixtures), nome npm `gentle-pi` (plan.ts:72) — documentar em CODEBASE-GUIDE (T10): "third-party fingerprints — data, not branding"
- [x] **Correções do mapa registradas (REM-03)**: ROUTING §8.11 = zero hits · EVAL-FRAMEWORK.md = zero hits · QA-1/2/3 resolvidas — registrar no corpo do commit e neste tasks.md
- [x] **Verificar:** `bun test` (1193) + `bun test scripts/eval-e2e` (71) verdes; `grep -rni "gentle" . --include='*.ts' --include='*.md'` (excl. node_modules/.git/.specs/.turbo/vendored/.pi) → **só** literais de dados documentados (owners.ts path/prefixo, plan.ts:72, fixtures de teste); `grep -rn "padrão gentle\|gentle-ai pattern"` vazio; `git diff --stat` mostra só linhas de comentário/prosa/strings de apresentação + testes (nenhuma mudança no mecanismo de detecção)

## T6 — skill-forge copiada + wired (D7, SKL-01/03)

- [x] `cp -r /home/rehem/Projects/arcanum/packages/spells/skills/skill-forge packages/harness/skills/` — manter SKILL.md (291 ln), README.md, `assets/SKILL.template.md`, `references/` (5), `scripts/validate.py` — **frontmatter `license: CC-BY-4.0` intacto (as-is)**
- [x] `packages/harness/package.json`: `pi.skills` += `"./skills/skill-forge"` (layout using-runes — dir com SKILL.md; sem colisão: forks = pi-subagents/taskflow)
- [x] `scripts/validate.py` **não** wire em CI (asset opcional — python3 stdlib ≥3.10; documentar no CODEBASE-GUIDE como opcional)
- [x] **Verificar:** `diff -r packages/harness/skills/skill-forge /home/rehem/Projects/arcanum/packages/spells/skills/skill-forge` **vazio**; frontmatter com license intacto; `pi.skills` com a entrada; `bun test` verde; (smoke manual opcional) sessão Pi headless lista a skill

## T7 — Skills propostas (D7, SKL-02) — GATED na escolha do usuário (QA-5)

- [x] **Default recomendado (4)**: `test-driven-development` (390 ln), `using-agent-skills` (200 ln), `memory-management` (198 ln), `spec-driven` (176 ln) — copiar byte-a-byte para `packages/harness/skills/<name>/` (frontmatter as-is); `pi.skills` += `"./skills/<name>"` por skill
- [x] Se o usuário escolher `loop-*` (loop-contract/judge/learn/roadmap/run): copiar com nota de two-driver (overlap com a mecânica de loop do fork glla) — não recomendado por default
- [x] **Verificar:** `diff -r` por skill copiada vazio; `pi.skills` com as entradas; zero nome duplicado no array; `bun test` verde; `bun run lint` verde (biome cobre scripts/ — skills são markdown, sem lint)

## T8 — Docs páginas 1/3: intended-usage + usage (D3/D4, DOC-01/02) — após Front 1+2

- [x] `packages/harness/docs/intended-usage.md` (EN) ← ROUTING §1-2 (quando usar o quê) + §5 (hello world SDLC versionado F7/F19 — prova de uso real) + two-driver em uma linha (link ROUTING §2)
- [x] `packages/harness/docs/usage.md` (EN) ← README raiz quickstart + umbrella (install `companion`, doctor/status/sync/uninstall/restore, config essencial, troubleshooting → link) + nota de coexistência (owners/check 14 — KEEP language) + rollback/backups (F13, uma seção)
- [x] **Verificar:** links resolvem; conteúdo extraído (checklist fonte→seção no corpo da task); EN; §9 ROUTING intocado; `bun test` verde

## T9 — Docs páginas 2/3: agents + components (D4, DOC-02)

- [x] `packages/harness/docs/agents.md` (EN) ← umbrella README (tabela 7 papéis F32 — planner/builder/reviewer/auditor/scout/researcher/security + allowlist/delegação) + ROUTING §8.13 + matriz não-Pi (F17/F31: claude-code/opencode/codex/copilot + colunas mcp/rules/unsupported)
- [x] `packages/harness/docs/components.md` (EN) ← ROUTING §8.5-8.14 (guards F24, verification F25, evals F26, resilience F27, observability F28, memory F29, persona/models F30, copilot F31, agents F32, routing F33) + F6/F17 (4 forks + camada MCP + pin npx `@runecraft/taskflow-*`) — tabela de componentes × o que faz × onde configurar
- [x] **Verificar:** links resolvem; tabelas consistentes com src (checklist por componente); EN; sem duplicação integral de ROUTING (links); `bun test` verde

## T10 — Docs páginas 3/3: CODEBASE-GUIDE + testing (D4, DOC-02)

- [x] `packages/harness/docs/CODEBASE-GUIDE.md` (EN) — repository-map (workspaces + 13 packages + scripts + patches? não — pós-un-vendor: sem scripts de vendoring) · mental-model (camadas: forks → extensões → guards/verification/evals/resilience/observability/memory/routing → CLI) · maintainer-playbook (testes: `bun test` harness + e2e offline; convenções EN docs/PT-BR código AD-038; forks são source commitado — **sem sync**; onde mora cada contrato: versions.ts, ratchets, goldens)
- [x] `packages/harness/docs/testing.md` (EN) — landing de evals: suites determinísticas F21 (fixture), framework F26, ratchets/goldens F23 (comandos), E2E env-gated F22 (RUNECRAFT_E2E=1) → link para EVAL-FRAMEWORK.md (referência detalhada, sem reescrita)
- [x] **Verificar:** links resolvem (incl. EVAL-FRAMEWORK.md); zero menção a vendor/sync (estado pós-Front 1); EN; `bun test` verde

## T11 — READMEs + índice + verificação final (D5/D6/D9, DOC-03/04/05)

- [x] Root `README.md`: reestruturar na ordem beautify-github-readme — o que é → **prova/valor** (1193 testes, ratchets/goldens, garantias com nomes reais) → quickstart → **tabela de roteamento (Core Workflow** — espelha ROUTING §3: tool × quando usar × two-driver; link ROUTING) → docs links (índice) → development (sem vendor)
- [x] `packages/harness/README.md`: idem (sem log F1x-F3x — já sem refs vendor do T3); link para o novo índice
- [x] **Posicionamento (DOC-04)**: identidade runecraft — "seu próprio gentle-ai" — differentiators REAIS (F24 guards com bloqueio de tool_call, F25 cascata de verificação com limiares em código, F26/F21/F23 evals + ratchets/goldens, F27 resiliência/stall detection, F28 event store tipado, F33 roteador codificado, F31 claude-auth/copilot) × paridade (F30 SDD, F20 receipts, F29 memória, F30 persona, F13 backup) — **zero features inventadas (F8)**
- [x] `packages/harness/docs/README.md` (índice): ROUTING / EVENTS / MEMORY / PI / EVAL-FRAMEWORK + **intended-usage / usage / agents / components / CODEBASE-GUIDE / testing** — sem SYNC.md; root README aponta para o índice
- [x] **Verificar (gates finais D9):** `bun run lint` + `bun run build` + `bun test` (1193) verdes; golden chain F19 (`test/f19-routing.test.ts` — §9 intocado); todos os links de docs resolvem; greps: `vendor.manifest|vendor.json|SYNC.md` vazio nos docs shipped; `padrão gentle-ai` vazio; menções na apresentação vazias (só literais de dados); `@runecraft/harness` vazio fora de .specs; `git status --porcelain packages/` zero nos forks; docs shipped EN (AD-038); tabela Core Workflow consistente com ROUTING §3 (checklist)

## T12 — README raiz via skill beautify-github-readme (D11, DOC-06) — GATED na escolha do usuário (QA-7)

- [ ] Instalar a skill: `npx skills add oil-oil/beautify-github-readme` (verificar SKILL.md carregável no ambiente)
- [ ] Executar a skill no modo escolhido (QA-7 — default **Whole README** sobre o README raiz): a skill LÊ o repo real primeiro (prova: 1193 testes, ratchets/goldens, E2E, guards) e deriva o sistema visual project-native (hero SVG, tipografia/cores do projeto runecraft) — zero capacidades inventadas (regra F8; checklist contra components.md)
- [ ] **Preview local obrigatório**: assets GitHub-safe (SVG editável como fallback estático; GIF só opt-in; texto pesquisável/copiável preservado; links resolvem); **nenhum commit/push sem aprovação explícita do usuário** (regra da skill)
- [ ] Após aprovação: commit atômico dos assets + README raiz; escopo = README raiz (umbrella opcional se o usuário pedir no preview — QA-7c)
- [ ] **Verificar:** preview renderizado localmente (SVG abre no browser); aprovação registrada no corpo do commit; `bun test` verde; links do README resolvem; checklist de capacidade sem invenção

## Traceability → tasks

| Requirement | Tasks |
| --- | --- |
| UNV-01 | T1 |
| UNV-02 | T2 |
| UNV-03 | T3 |
| UNV-04 | T4 |
| UNV-05 | T4 |
| REM-01 | T5 |
| REM-02 | T5 |
| REM-03 | T5 |
| SKL-01 | T6 |
| SKL-02 | T7 |
| SKL-03 | T6, T7 |
| DOC-01 | T8 |
| DOC-02 | T8, T9, T10 |
| DOC-03 | T11 |
| DOC-04 | T11 |
| DOC-05 | T11 |
| DOC-06 | T12 |

**Cobertura:** 17/17 · toda user story da spec tem requirement ID · todo requisito tem task.
