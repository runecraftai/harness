# F10 — Design: Upstream Sync Workflow

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-034)
**Prereqs de fato:** F1 (vendor.ts + manifest + vendor.json por dest), F16 (camada MCP vendorada — 9 entries taskflow), F23 (ratchet/goldens), F7 (baseline).

## D1 — Estratégia de merge: three-way com base materializada (engine) + patches/ como registry documental (híbrido)

**Contexto de fato:** forks são cópias de tarball do GitHub no ref pinado, SEM histórico git próprio (AD-002; vendor.ts grava `vendor.json` por dest com `resolvedSha`). O monorepo é git e versiona os arquivos dos forks, mas o histórico por arquivo mistura rename/adaptacões com o conteúdo upstream — reconstruir a base por git é frágil (validado: 12 dests com `vendor.json`, todos com `resolvedSha`).

**Opções avaliadas:**
- **(a) Three-way com base materializada**: base = tarball do `resolvedSha` (re-fetch), theirs = tarball do ref novo, ours = `packages/<dir>` atual (sem `vendor.json`, `node_modules/`, `dist/`). Merge por arquivo com `git merge-file` (diff3, marcadores no arquivo, exit code por conflito). Zero deps novas — git já é requisito do harness (F19/F20/monorepo).
- **(b) Patch queue**: extrair TODAS as divergências locais (renames, F2, F5) como patches e re-aplicar sobre o theirs a cada sync. Rejeitada: bookkeeping duplicado (mudança local vive no repo E no patch — qualquer fix futuro esquecido de registrar é perdido no próximo full-replace); exige retro-extração de `git log` (frágil, mesma base por arquivo); os fixes F2/F5/renames JÁ vivem no ours — re-aplicá-los é trabalho redundante.
- **(c) Híbrido (RECOMENDADO)**: three-way como engine (a) + `patches/<fork>/registry.json` como **registro documental** de divergências conhecidas (ids, SHAs, arquivos) usado pelo diff report e pelo runbook — NÃO é engine. Divergências podem ganhar `.patch` gerados (`git diff base→ours` por divergência) como artefato de revisão, verificado com `git apply --check` (nunca aplicado).

**Semântica por arquivo (union de paths base ∪ theirs ∪ ours):**
| Caso | Resultado |
| --- | --- |
| só theirs | copia (arquivo novo upstream) |
| só ours | mantém (adição nossa) |
| só base | upstream deletou e nós não tocamos → deleta; nós modificamos → conflito modify/delete (fail-closed) |
| base+theirs, sem ours | nós deletamos (F2 install.mjs) e theirs não mudou → deleta (preservado); theirs mudou → conflito (humano decide) |
| base+ours, sem theirs | upstream deletou, nós modificamos → mantém ours + reporta divergência (registry sugerido) |
| os três | `git merge-file ours base theirs`; conflito → marcadores + exit 2 |

> Validar no Execute: classificação modify/delete e arquivos binários (ignorar merge, reportar).

## D2 — Patch management: registry documental + artefatos .patch opcionais

- **Formato**: `patches/<fork>/registry.json` (schema `{id, title, type: deleted|renamed|fixed|pending, files[], commits[], status}`) + `.patch` opcionais em formato `git diff` (unified) gerados como subproduto do ciclo (base→ours por divergência), verificados com `git apply --check` — nunca aplicados pelo engine.
- **Divergências a registrar (v1)**: subagents `install.mjs` removido (F2, commit efdd9da); pr-review hardcodes `pi-pr-review`/10ego (F5, verify-package-contents.mjs + package-contents.node.mjs, commit 2026-08-06); renames `@runecraft/*` (F2–F5, F16 — arquivos package.json/imports/tsconfig); **BUG-1/BUG-2 pendentes** (status `pending`, resolvidos conforme Q1).
- **Loop apply/verify**: como o engine é three-way, "re-aplicar patches" = o rename/adaptação pass (D4) + registro. O registry alimenta o diff report (intersecção arquivos alterados upstream × divergências) para guiar conflitos (SYNC-08 AC2).

## D3 — Layout de arquivos (zero deps; padrão scripts/vendor.ts)

```
scripts/sync-upstream.ts            # entrypoint CLI (args, orquestração)
scripts/sync-upstream/
  ├── manifest.ts                   # load/validate vendor.manifest.json + vendor.json por dest
  ├── fetch.ts                      # tarball download/extract (reuso do padrão vendor.ts)
  ├── merge.ts                      # three-way por arquivo via git merge-file + classificação
  ├── rename.ts                     # auto-rename pass (mapas do config.ts)
  ├── report.ts                     # delta report / --status / --check
  └── config.ts                     # adaptação por fork (rename maps, exclusões, test commands, plugin paths)
patches/<fork>/registry.json        # divergências conhecidas (D2; documental)
docs/SYNC.md                        # runbook (SYNC-04)
```
Escopo de toque: `scripts/` (raiz) + `packages/*` (forks) + `docs/` + `patches/`. EVAL-MATRIX intocada; harness (packages/harness) intocado exceto se um gate exigir ajuste (não esperado).

## D4 — Auto-rename e adaptação por fork (SYNC-07)

- `config.ts` define por entry do manifest: `renameMap` (specifier upstream → `@runecraft/*`), `excludeFiles` (ex.: `vendor.json`, `dist/`, junk), `testCommand` (padrão `bun test`; camada MCP: `node --experimental-strip-types --test 'test/**/*.test.ts'` — decisão MCPL-06 do F16), `pluginPaths` (configs `plugin/` apontam para path local do fork / pin `@runecraft` no registry — decisão F15 D6: env > dev fork > npx @runecraft pin; nunca npx pin do upstream).
- Rename pass (token-aware, texto): `name`/`workspace:*`/deps no package.json; import specifiers estáticos; **`import()` dinâmicos incluindo template literals (cobre BUG-1)**; `import.meta.resolve`. Aplica-se sobre o resultado do merge (que chega com nomes antigos do upstream).
- Mapas v1 (validar no Execute contra os 12 dests): `pi-subagents→@runecraft/subagents`; `taskflow-core→@runecraft/taskflow-core`, `pi-taskflow→@runecraft/taskflow`, `taskflow-dsl→@runecraft/taskflow-dsl`, `taskflow-mcp-core→@runecraft/taskflow-mcp-core`, `taskflow-hosts→@runecraft/taskflow-hosts`, `codex-taskflow→@runecraft/taskflow-codex`, `claude-taskflow→@runecraft/taskflow-claude`, `opencode-taskflow→@runecraft/taskflow-opencode`, `grok-taskflow→@runecraft/taskflow-grok`; `pi-goal-list-loop-audit→@runecraft/goal-loop-audit`; `pi-pr-review→@runecraft/pr-review`.

## D5 — Group sync taskflow + codificação da camada MCP (SYNC-06)

- Manifest tem 9 entries de `heggria/taskflow` (core/pi/dsl + mcp-core/hosts/codex/claude/opencode/grok), todas @ v0.2.6 / SHA `3c2dfdb`. `--group taskflow` = 1 fetch de tarball no ref novo, base/theirs materializados por subpath, merge por dest, 1 report, 1 atualização de proveniência, 1 commit.
- O re-vendor manual do F16 vira checklist codificado no runbook + config.ts: ordem de build core→mcp-core→hosts→dsl→pi→adapters (turbo `dependsOn: ["^build"]`, decisão F3); scripts de build simplificados (sem copy-readme.mjs etc.); `plugin/` com paths locais; modo de teste MCP (MCPL-06); bins `*-taskflow-mcp` → `dist/mcp/bin.js`.

## D6 — CLI e relatório (SYNC-01/03/05)

```
bun run sync:upstream <name> --to <ref> [--dry-run] [--base <sha>]
bun run sync:upstream --group taskflow --to <ref> [--dry-run]
bun run sync:upstream --status [--offline]
bun run sync:upstream --check            # offline; para CI
```
- `<name>`/`--group` vêm do manifest; `--to` aceita tag ou SHA (goal-loop-audit: só SHA). `--base` override opcional (default: `vendor.json.resolvedSha` do dest).
- `--status`: vendored (ref/SHA do vendor.json) vs latest upstream (GitHub API — mesmo padrão do vendor.ts; goal-loop-audit: package.json do HEAD do default branch) + estado local (dirty via `git status --porcelain`, offline).
- `--check` (offline, CI-safe): consistência manifest↔vendor.json (todo dest com vendor.json non-empty; resolvedSha presente) + dirty detection. Sem rede, sem materializar base.
- Exit codes: 0 ok; 1 erro de infra/args; 2 conflitos pendentes (proveniência intocada).
- Sem TTY: dry-run obrigatório antes do apply real? — não; v1 é ferramenta de mantenedor (fail-closed via dry-run recomendado no runbook, não bloqueio).

## D7 — Proveniência condicional (SYNC-02)

- Sucesso (zero conflitos): atualiza `vendor.json` do dest (`ref`, `resolvedSha` novo, `npmVersion` do theirs se mudou, `syncedAt`) e `vendor.manifest.json` (`ref`, `npmVersion`). `vendoredAt` original preservado (histórico); `syncedAt` registra o ciclo.
- Conflito/erro: NENHUMA escrita de proveniência; working tree com marcadores + hint `git restore packages/<dir>`; `vendor.json`/manifest intactos.
- Atomicidade: aplicar merge em staging (tmp) e copiar sobre o dest só com merge limpo? — validar no Execute; v1: merge in-place (git versiona — restore cobre rollback), proveniência por último.

## D8 — Test gate (SYNC-09)

Ordem (comandos reais do repo): per-package `bun test` (turbo `--filter`) → harness `bun test` (939 testes) → `biome check .` → `turbo build` → ratchet F23 SEM `--update` (fail-closed) → goldens byte-idênticos. Política: drift legítimo de baseline/golden pós-sync → `--update` explícito (recusado com `CI=true` — F23), relatório added/removed/unchanged revisado e documentado no corpo do commit de sync. `known-failures.txt` permanece vazio; falhas novas de teste NUNCA entram no ratchet como atalho. Camada MCP usa o modo de teste MCPL-06 (config.ts). EVAL-MATRIX intocada (F10 não é feature de eval; drift de golden é domínio F23).

## D9 — Runbook e convenções (SYNC-04)

`docs/SYNC.md`: prereqs (git, bun, rede para sync manual); checar releases por upstream (tags via API; goal-loop-audit por SHA — AD note); dry-run → review do delta (com cruzamento registry); apply; resolução de conflitos típicos (package.json name/version, import specifiers, plugin configs, rename em massa — guia por fork); gates (D8); verificação de proveniência; commit `chore(<pkg>): sync upstream <vOld>..<vNew>` (1 commit por grupo, separado de commits de feature; relatório `--update` no corpo quando aplicável); registro de divergência (AD no STATE + entrada no registry).

## BUG-1/BUG-2 (surfaced — decisão Q1)

- **BUG-1** (import dinâmico não renomeado): coberto pelo rename pass do D4 (import() dinâmicos com template literals) — fix natural no 1º ciclo de sync do taskflow.
- **BUG-2** (dist/agents/ não empacotado → `Unknown agent: default`): fix em `package.json` (files/export) do fork — entra na adaptação por fork (config.ts) ou task pequena separada, conforme Q1.
- Recomendação: resolver AMBOS dentro do 1º ciclo de sync do taskflow (mesmos arquivos que o sync toca; evita re-tocar o mesmo código duas vezes).

## Riscos e notas

- Rede é necessária só na execução do sync (manual deliberado); CI offline usa `--check` (D6).
- Re-fetch da base (resolvedSha) depende da disponibilidade do ref antigo no GitHub (tarballs imutáveis por SHA — baixo risco; goal-loop-audit pin por SHA idempotente).
- Mudanças de ferramentas/testes dos forks quebram a suíte upstream nos nossos gates — política: classificar e adaptar (config.ts), nunca silenciar (ratchet fail-closed).
- "Validar no Execute": semântica modify/delete e binários (D1), atomicidade in-place vs staging (D7), mapas de rename completos (D4), resolução de `latest` para `--status` sem tags (D6).
