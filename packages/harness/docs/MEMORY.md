# Memory (F29) — Persistent cross-session memory (runes → Pi)

A camada de memória persistente do harness (M7, pilar 7 do doc do usuário —
"memória durável consultável por tool") é o port do pacote `runes` do arcanum
(org própria, MIT — AD-002; fonte: `packages/runes` em
`~/Projects/arcanum`) para MECANISMOS REAIS do Pi 0.81.0: **10 agent tools
`rune_*` registradas via `pi.registerTool(defineTool(...))`**, SQLite local
via `bun:sqlite` (zero deps novas), **o arquivo `.runecraft/memory/runes.db`
É a memória cross-session** (D2 — resolução honesta do wording do roadmap:
`appendEntry` do SDK é log de sessão e não persiste entre sessões; o DB em
arquivo persiste por construção; state F13 carrega a CONFIG, não conteúdo).

## Storage & concurrency (D1/D4)

- **Local**: `<gitRoot | cwd>/.runecraft/memory/runes.db` (gitignored) —
  override `RUNECRAFT_MEMORY_DATA_DIR` (evals/CLI).
- **Escopo por repo**: o slug vem do remote git normalizado
  (`remote.origin.url`, regex SSH/HTTPS, strip `.git` — port de
  `lib/project.ts`); sem remote → path absoluto do cwd; sem git root → path
  absoluto do cwd. Worktrees do mesmo repo compartilham o mesmo `.runecraft`
  → mesma memória. Override determinístico: `RUNECRAFT_MEMORY_PROJECT_SLUG`.
- **WAL** (`PRAGMA journal_mode = WAL`) + `foreign_keys = ON` +
  `busy_timeout = 5000`: leitores concorrentes + escritor serializado
  (multi-sessão no mesmo repo). Abertura com retry 1×/100ms (port
  `db/client.ts`); falha persistente → tools ausentes + aviso (fail-closed —
  a sessão segue sem memória; `harness memory doctor` diagnostica).

## Schema (D4 — AS-IS do runes v1)

`schema.sql` portado integral (verificado executável em bun:sqlite, D12):

- `projects` (id, slug UNIQUE, root_path, remote_url, created_at)
- `sessions` (id, project_id FK, agent, started_at, ended_at, summary)
- `memories` (id UNIQUE, project_id, session_id, category, title, what, why,
  where_ref, learned, importance, soft_deleted, created_at, updated_at)
- `memories_fts` — FTS5 `tokenize='unicode61 remove_diacritics 2'` (match
  "café" e "cafe") com triggers `memories_ai/ad/au/soft_delete_au` (soft-delete
  remove do índice)
- `schema_meta` — `SCHEMA_VERSION = 1` (migração idempotente; mudanças
  futuras são ADITIVAS — política F13)

## Tools (D3 — 10/10 portadas, MESMOS nomes)

| Tool | O que faz |
| --- | --- |
| `rune_save` | salva memória (categoria/título/what/why/where_ref/learned/importance) + sinal de compaction |
| `rune_search` | FTS5 sobre títulos/conteúdo, ordenado por rank; filtro de categoria; soft-deleted excluído |
| `rune_get` | busca por id (NOT_FOUND quando soft-deleted) |
| `rune_update` | patch de campos (importance clamp [1,10]; NOT_FOUND) |
| `rune_delete` | soft-delete (some de search/get/context; `doctor --purge` hard-deleta) |
| `rune_context` | snapshot: project + sessão ativa + 10 recentes + relevantes (query) por importância |
| `rune_timeline` | sessões recentes (started_at DESC) |
| `rune_stats` | totais por categoria + last activity |
| `rune_session_start` | inicia sessão (idempotente — reusa ativa) |
| `rune_session_end` | encerra sessão com summary opcional |

Adaptações do port (tabela D3): `tool()` de `@opencode-ai/plugin` →
`defineTool` do SDK; zod → TypeBox `parameters` (shape REAL do defineTool —
validado no Execute) + validação manual em `src/memory/validate.ts` com os
MESMOS códigos do source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG,
EMPTY_WHAT, WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT); agent hardcoded
`"opencode"` (rune_context/rune_session_start) → `RUNECRAFT_AGENT_ID` ?? `"pi"`
(F24); retorno = mesmas strings JSON do source.

## Categorias (8)

`project_rules` · `architecture` · `constraints` · `config_values` · `naming`
· `decisions` · `corrections` · `learnings` — o guia de uso (o que salvar em
cada uma) vive na skill `skills/using-runes/SKILL.md`.

## Compaction

`rune_save` enforça o cap por categoria (`categoryCap`, default 10 — config
`memory` do state). Acima do softCap → sinal com candidatos (≤5) para
curadoria; acima do hardCap (2×) → poda transacional
(`importance ASC, created_at ASC, rowid ASC` — D6 tie-break) dos mais
antigos de menor importância. Sinal `compaction.pruned_count > 0` = dado
podado sem curadoria.

## Config (D5 — MEM-05)

Seção `memory` ADITIVA no state.json (F13, schemaVersion 1 — ao lado de
guards/verification/resilience/observability):

```jsonc
{
  "memory": {
    "enabled": true,
    "categoryCap": 10,
    "disabledTools": [],
    "importLessonsOnStart": false
  }
}
```

- **Freeze por sessão**: snapshot no init da extensão (padrão F24 D12) —
  mudança mid-session não afeta.
- **Kill switch**: `RUNECRAFT_MEMORY=0|false|off` → camada INERTE (nenhum
  tool registrado, nenhum arquivo criado; CLI recusa com mensagem — exit 0).
- **Fail-closed por módulo (F24 D10)**: config inválida → defaults seguros +
  problema reportado (warn no stderr da extensão).
- Campos do source NÃO portados: `importance_floor` (achado honesto —
  parsed, nunca enforced no source), `disabled_skills` (skill-system do
  OpenCode, n/a no Pi), `data_dir` JSONC (→ env + state).

## Bridge F28 (D7 — MEM-06)

`harness memory import-lessons [--dry-run]` importa
`.runecraft/lessons/promoted.jsonl` (memória de time VERSIONADA — DONO do
F28) para memórias `learnings`:

- `title` = trigger · `what` = "Anti-padrão: …\nPadrão preferido: …" ·
  `where_ref = "lesson:<lessonId>"` (chave de idempotência) ·
  importance = priority mapeado (low=3 / med=5 / high=8).
- **Idempotente**: 2º import → zero inserts (colisão de `where_ref` → skip —
  nunca sobrescreve memória do usuário). **Fonte nunca reescrita** (abre
  read-only; teste asserta hash byte-a-byte).
- `importLessonsOnStart: true` → import no init da extensão (após registrar
  tools). `--dry-run` → relatório sem escrever. Arquivo ausente/vazio →
  no-op (exit 0).

## CLI (D8 — MEM-07)

```
harness memory search <query>            # markdown table (FTS, all projects)
harness memory stats                     # contagens por categoria + last activity
harness memory doctor [--purge]          # drift memories vs memories_fts; --purge hard-deleta + rebuild
harness memory import-lessons [--dry-run] # bridge F28 (idempotente)
```

Exit codes (port do bin): 0 ok · 1 erro/drift sem `--purge`/store inacessível
· 2 uso errado. `--json` → shape estável por subcomando. Kill switch → recusa
fail-visible (nada criado).

## Determinismo (D6)

- DI no `Repository`: `clock`/`idGen` injetáveis (defaults `Date.now`/
  `randomUUID`) — evals injetam sequências fixas (F21 D10: timestamps são
  payload informacional, nunca identidade).
- Tie-breaks explícitos em ordenações sem chave total (corrige bug latente
  do source — documentado): `recentMemories` → `created_at DESC, rowid DESC`;
  `selectOldestLowestPriority` → `importance ASC, created_at ASC, rowid ASC`;
  `listSessions` → `started_at DESC, id DESC`.
- FTS5 `rank` é determinístico para o mesmo corpus+query no mesmo runtime
  (Bun) — EVAL-037 compara resultados completos com relógio/id injetados.

## Privacidade (D10 — MEM-09)

- Conteúdo de memória (title/what/why/…) vive **SÓ no DB**
  (`.runecraft/memory/runes.db` — gitignored). Nunca é gravado cru em
  events/ (F28 recorder usa `argsHash` — sha256 normalizado), state.json,
  continuation.json, lessons.jsonl ou logs (log da camada memory só com
  metadados: ids/contagens).
- O retorno das tools para o agente é o mecanismo (transcript — inerente à
  função de memória); o CLI escreve no stdout do TERMINAL (inspeção
  explícita — propósito do port).
- **Não salvar secrets** (skill é o aviso soft; docs o aviso explícito).

## Fronteiras

| Sink | Dono |
| --- | --- |
| `events/` + `lessons.jsonl` + `lessons/promoted.jsonl` | F28 (F29 lê promoted read-only) |
| `continuation.json` + `resilience-events.jsonl` | F27 |
| `verify-verdicts.jsonl` | F25 |
| ledger `.pi-glla/` | F24/F27 |
| `.runecraft/memory/` | **F29** |

## Atribuição

Schema, Repository, tools, CLI e skill são ports do pacote `runes` do arcanum
(`~/Projects/arcanum/packages/runes` — org própria, MIT; AD-002). Cada port
cita o arquivo-fonte no código. `bun:sqlite` (builtin do Bun 1.3.14) é o
runtime — sem fallback node:sqlite (documentado em `src/memory/client.ts`).
