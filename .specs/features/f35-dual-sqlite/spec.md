# F35 — Dual SQLite driver (bun:sqlite / node:sqlite) — Specification

**Scope:** Medium (bug fix + adaptador de driver; tasks implícitas no Execute). **Prereq:** F29 (memory), F34 (estado do repo). **Status:** Ready for Execute (decisão do usuário travada — opção B).

## Problem Statement

A extensão de memória (F29) faz `import { Database } from "bun:sqlite"` **estático** em `src/memory/client.ts`. O runtime de produção do pi é **node** (wrapper npx → node) — `bun:sqlite` não existe → o load da extensão **throwa** → a **sessão inteira morre** (exit 1) para qualquer usuário que instale `@runecraft/companion` (verificado em smoke F34: "Failed to load extension ... Cannot find module 'bun:sqlite'"). F29 foi validado só sob bun (bun test / E2E in-process — F21/F22 nunca exercitaram node).

**Fatos verificados (2026-08-08):** node v26.5.0 tem `node:sqlite` (DatabaseSync) com **FTS5 OK** (probe real: virtual table fts5 + MATCH → 1 row); bun 1.3.14 **NÃO** tem `node:sqlite` ("No such built-in module") → migração única para node:sqlite quebraria os testes (que rodam em bun). Superfície usada pelo harness é idêntica nos dois drivers: `exec` + `prepare().get/all/run` + `close` (36 call sites em repository.ts, só exec/prepare; migrations só exec). `cli.ts:14` já usa require dinâmico em `probeSqlite` (padrão existente).

**Decisão do usuário (2026-08-08):** opção **B — backend duplo**: `bun:sqlite` quando disponível (bun), fallback `node:sqlite` (DatabaseSync) no runtime node (produção). Memória funciona nos dois runtimes; FTS5 verificado nos dois.

## Requirements

- **SQL-01 — Loader de driver (client.ts)**: sem import estático de `bun:sqlite`; seletor `selectDriver(load)` injetável (ordem: bun:sqlite → node:sqlite; ambos falham → throw com hint); `getDriver()` lazy (import do módulo NUNCA throwa); `openDatabase` retorna `DatabaseLike` com retry/pragmas/migrações/fail-closed **inalterados**
- **SQL-02 — Interfaces mínimas**: `DatabaseLike` (exec/prepare/close) + `StatementLike` (get/all/run) exportadas de client.ts; `migrations.ts` e `repository.ts` trocam `import type { Database } from "bun:sqlite"` pela interface local (type-only, zero runtime)
- **SQL-03 — probe honesto**: `cli.ts probeSqlite` usa o driver compartilhado e reporta o driver ativo (`bun` | `node`) — `harness memory doctor` correto nos dois runtimes
- **SQL-04 — Testes**: unit do seletor com loaders fake (bun ok → "bun"; bun falha → "node"; ambos falham → throw com hint); suite bun (1193) verde (caminho bun exercitado)
- **SQL-05 — Smoke node commitado**: `packages/harness/scripts/smoke-memory-node.mjs` (ESM, `node:sqlite` real): pragmas (WAL/FK/busy_timeout) + FTS5 virtual table + `prepare().run/get/all` + MATCH; roda `node scripts/smoke-memory-node.mjs` (verificação manual documentada; não wire em CI)
- **SQL-06 — Docs honestas**: fatos atualizados: components.md:35, MEMORY.md:7/29, ROUTING.md:380/827 → "bun:sqlite (runtime Bun) / node:sqlite (runtime Node)"; kill switch `RUNECRAFT_MEMORY=0` inalterado

## Out of Scope

- Migração única para node:sqlite (bun não tem o módulo — SQL-01 mantém bun:sqlite como primário)
- Mudança de schema/API do repository (a superfície usada é idêntica — zero mudança de call sites)
- CI node (não existe CI; smoke manual documentado)
- Outros usos bun-only fora de `src/memory/` (varredura no Execute; se achar, registrar, não expandir escopo)

## Success Criteria

- [ ] Sessão pi (node) com o pacote instalado NÃO morre mais no load da extensão de memória; tools `rune_*` registradas com o driver node (smoke real)
- [ ] Suite bun (1193) verde; typecheck limpo; biome limpo
- [ ] `selectDriver` testado (3 casos); `probeSqlite` reporta driver ativo
- [ ] Docs citam os dois drivers; zero `import ... from "bun:sqlite"` estático fora do loader

## Requirement Traceability

| ID | Task | Status |
| --- | --- | --- |
| SQL-01 | client.ts: interfaces + selectDriver + getDriver lazy + openDatabase | Done |
| SQL-02 | migrations.ts/repository.ts: type imports → DatabaseLike | Done |
| SQL-03 | cli.ts probeSqlite → driver compartilhado + nome | Done |
| SQL-04 | test do seletor (3 casos) + suite verde | Done |
| SQL-05 | scripts/smoke-memory-node.mjs + execução manual | Done |
| SQL-06 | docs (components/MEMORY/ROUTING) + varredura bun-only | Done |
