# F10 — Tasks: Upstream Sync Workflow

**Convenções:** tarefas atômicas com verificação; cada tarefa referencia requisito(s) da spec; commits atômicos por tarefa; "validar no Execute" explícito onde empírico.

## Dependências

```
T1 (registry) ──────────► T5 (rename pass) ──► T7 (group sync taskflow) ──► T8 (gate)
T2 (merge.ts) ──► T3 (proveniência) ──► T4 (CLI/dry-run) ──┬────────────┘        │
T6 (status/check) ────────────────────────────────────────┘                      │
T9 (runbook) ────────────────────────────────────────────────────────────────────┘
T10 (BUG-1/2) — depende de Q1 (decisão do usuário); executa junto de T5/T7 se "no 1º ciclo"
```

## T1 — Registry de divergências conhecidas (SYNC-08)

Criar `patches/<fork>/registry.json` para subagents, pr-review, taskflow (e goal-loop-audit se houver divergência) com schema `{id, title, type: deleted|renamed|fixed|pending, files[], commits[], status}`. Registrar: F2 (install.mjs removido, commit efdd9da), F5 (hardcodes pi-pr-review/10ego, commits 2026-08-06), renames `@runecraft/*` (F2–F5/F16), BUG-1/BUG-2 (`pending`).

**Verificação:** schema validado (JSON parse + campos obrigatórios); SHAs conferem com `git log`; ≥4 divergências documentadas; teste de consistência: arquivos citados existem no dest.

## T2 — Núcleo de merge three-way (SYNC-01)

Implementar `scripts/sync-upstream/merge.ts`: materializar base (tarball do `resolvedSha` do vendor.json do dest, extração por subpath — reuso do padrão vendor.ts) e theirs (tarball do `--to`); aplicar merge por arquivo com `git merge-file` (labels `ours/base/theirs`); classificação da tabela D1 (novo/deletado/modify-delete/conflito); exit 2 em conflito com lista de arquivos + hint de restore.

**Verificação:** suite de testes com fixture sintética (3 árvores): merge limpo; conflito com marcadores diff3; arquivo novo upstream; delete preservado (caso F2 install.mjs); modify/delete reportado; binário ignorado/reportado; `git merge-file` ausente → erro claro. "Validar no Execute": classificação modify/delete e binários.

## T3 — Proveniência condicional (SYNC-02)

Atualizar `vendor.json` (dest) e `vendor.manifest.json` (ref/npmVersion) SOMENTE com merge limpo; nada escrito em conflito; `syncedAt` adicionado; `vendoredAt` preservado. Decidir no Execute: merge in-place (rollback via git) vs staging em tmp.

**Verificação:** testes: merge limpo → vendor.json+manifest atualizados (ref/resolvedSha/npmVersion/syncedAt); conflito → arquivos de proveniência byte-idênticos; entry desconhecida → abort com orientação.

## T4 — CLI sync-upstream.ts + dry-run (SYNC-01/03)

Implementar entrypoint `scripts/sync-upstream.ts` (args: `<name>|--group`, `--to`, `--dry-run`, `--base`; exit 0/1/2) + `report.ts`: delta report (added/modified/removed/renamed upstream; arquivos locais alterados; interseção com registry T1). Adicionar script `sync:upstream` no package.json raiz (NÃO `sync` — colisão com CLI F12/F17/F19).

**Verificação:** smoke subprocess: `--dry-run` não toca working tree (`git status` limpo); `--list`/help; grupo sem `--to` → erro com instrução; rename detection num caso sintético de move.

## T5 — Auto-rename pass (SYNC-07)

Implementar `scripts/sync-upstream/rename.ts` + `config.ts` (renameMap por fork, excludeFiles, testCommand, pluginPaths): token-aware em texto — package.json (name/workspace:*), import specifiers estáticos, `import()` dinâmicos com template literals (**cobre BUG-1**), `import.meta.resolve`. Mapas v1 do design D4.

**Verificação:** em cópia de teste dos 12 dests, pós-run `grep -r` por specifiers upstream retorna vazio; teste dedicado com import dinâmico template-literal (regressão BUG-1); package.json de cada dest com name `@runecraft/*`; config.ts validado contra os 12 dests reais.

## T6 — Status e check offline (SYNC-05)

Implementar `--status` (vendored vs latest via GitHub API — padrão vendor.ts; goal-loop-audit por package.json do HEAD do default branch; dirty local offline) e `--check` (offline: consistência manifest↔vendor.json + `git status --porcelain` nos dests; exit ≠ 0 com relatório).

**Verificação:** fixture com manifest/vendor.json corrompido → `--check` falha apontando entry; repo com dirty local → `--check` vermelho; repo limpo → verde; `--status` com rede mockada (fetch injetável) confere com fixture.

## T7 — Group sync taskflow + camada MCP (SYNC-06)

`--group taskflow`: 1 fetch de tarball, base/theirs por subpath, merge nos 9 dests, 1 report, 1 proveniência, 1 commit. Codificar adaptações F16 no config.ts/runbook: ordem build core→mcp-core→hosts→dsl→pi→adapters; scripts de build simplificados; `plugin/` com paths locais (F15 D6); modo de teste MCPL-06; bins `dist/mcp/bin.js`.

**Verificação:** `--group taskflow --dry-run` reporta 9 entries; ciclo real em branch descartável (dry → apply → gates D8) com zero regressão; build turbo 9/9; bins `*-taskflow-mcp` presentes.

## T8 — Gate pós-sync integrado (SYNC-09)

Script/checklist executável do gate: per-package `bun test` → harness (939) → biome → `turbo build` → ratchet SEM `--update` → goldens; política `--update` explícita (recusado com `CI=true`) com relatório added/removed/unchanged para o corpo do commit.

**Verificação:** gate verde num ciclo dry real; `--update` com `CI=true` recusado (teste F23 reusado); falha nova de teste NUNCA entra no ratchet (fail-closed — teste negativo).

## T9 — Runbook docs/SYNC.md (SYNC-04)

Escrever runbook (D9): prereqs; checar releases por upstream (goal-loop-audit por SHA); dry-run → review com cruzamento registry; apply; guia de conflitos típicos por fork; gates; proveniência; commit `chore(<pkg>): sync upstream <vOld>..<vNew>` (1 commit por grupo, separado de feature); registro de divergência (AD + registry).

**Verificação:** revisão (cobertura dos 9 requisitos de processo); **teste independente**: ciclo real executado seguindo SÓ a doc (success criterion da spec).

## T10 — Disposição BUG-1/BUG-2 (SYNC-07 + Q1) — contingent

Conforme decisão do usuário (Q1): (a) **recomendado** — resolver no 1º ciclo do taskflow (BUG-1 via rename pass T5; BUG-2 via files/export no config.ts/package.json do fork) ou (b) task pequena separada. Fechar entradas `pending` no registry e no STATE.

**Verificação:** `verify/compile/compile-ir` do taskflow funcionando (BUG-1); run com agent `default` OK com dist/agents empacotado (BUG-2); testes do taskflow verdes; STATE.md atualizado.

## Rastreabilidade

| Task | Requisito(s) | Depende |
| --- | --- | --- |
| T1 | SYNC-08 | — |
| T2 | SYNC-01 | — |
| T3 | SYNC-02 | T2 |
| T4 | SYNC-01, SYNC-03 | T2, T3 |
| T5 | SYNC-07 | T1 |
| T6 | SYNC-05 | — |
| T7 | SYNC-06 | T4, T5 |
| T8 | SYNC-09 | T7 |
| T9 | SYNC-04 | T4, T7 |
| T10 | SYNC-07 | T5 (Q1) |
