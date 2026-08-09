# Memory — Persistent cross-session memory (runes → Pi)

The harness persistent memory layer ("durable memory queryable by tool")
ports the `runes` package into REAL mechanisms of the Pi SDK 0.81.0:
**10 agent tools `rune_*` registered via `pi.registerTool(defineTool(...))`**,
a local SQLite database via `bun:sqlite` (zero new dependencies) on the Bun
runtime and `node:sqlite` on the Node runtime — the production runtime of Pi
(dual driver in `src/memory/client.ts`). **The file
`.runecraft/memory/runes.db` IS the cross-session memory**: the SDK's
`appendEntry` is a session log and does not persist between sessions, while
a file database persists by construction; the state loads CONFIG, not
content.

## Storage & concurrency

- **Location**: `<gitRoot | cwd>/.runecraft/memory/runes.db` (gitignored) —
  override `RUNECRAFT_MEMORY_DATA_DIR` (evals/CLI).
- **Per-repo scope**: the slug comes from the normalized git remote
  (`remote.origin.url`, SSH/HTTPS regex, strip `.git`); no remote → absolute
  cwd path; no git root → absolute cwd path. Worktrees of the same repo share
  the same `.runecraft` → the same memory. Deterministic override:
  `RUNECRAFT_MEMORY_PROJECT_SLUG`.
- **WAL** (`PRAGMA journal_mode = WAL`) + `foreign_keys = ON` +
  `busy_timeout = 5000`: concurrent readers + serialized writer
  (multi-session in the same repo). Open with a 1×/100ms retry; persistent
  failure → tools absent + warning (fail-closed — the session continues
  without memory; `harness memory doctor` diagnoses).

## Schema (AS-IS from runes v1)

`schema.sql` ported in full (verified executable in bun:sqlite — and in
node:sqlite on Node ≥22.19 with FTS5):

- `projects` (id, slug UNIQUE, root_path, remote_url, created_at)
- `sessions` (id, project_id FK, agent, started_at, ended_at, summary)
- `memories` (id UNIQUE, project_id, session_id, category, title, what, why,
  where_ref, learned, importance, soft_deleted, created_at, updated_at)
- `memories_fts` — FTS5 `tokenize='unicode61 remove_diacritics 2'` (matches
  "café" and "cafe") with triggers `memories_ai/ad/au/soft_delete_au`
  (soft-delete removes from the index)
- `schema_meta` — `SCHEMA_VERSION = 1` (idempotent migration; future changes
  are ADDITIVE)

## Tools (10/10 ported, SAME names)

| Tool | What it does |
| --- | --- |
| `rune_save` | saves a memory (category/title/what/why/where_ref/learned/importance) + compaction signal |
| `rune_search` | FTS5 over titles/content, ordered by rank; category filter; soft-deleted excluded |
| `rune_get` | fetch by id (NOT_FOUND when soft-deleted) |
| `rune_update` | field patch (importance clamp [1,10]; NOT_FOUND) |
| `rune_delete` | soft-delete (disappears from search/get/context; `doctor --purge` hard-deletes) |
| `rune_context` | snapshot: project + active session + 10 recent + relevant (query) by importance |
| `rune_timeline` | recent sessions (started_at DESC) |
| `rune_stats` | totals per category + last activity |
| `rune_session_start` | starts a session (idempotent — reuses the active one) |
| `rune_session_end` | ends a session with an optional summary |

Port adaptations: `tool()` of `@opencode-ai/plugin` → `defineTool` of the Pi
SDK; zod → TypeBox `parameters` (the real defineTool shape) + manual
validation in `src/memory/validate.ts` with the SAME error codes of the
source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG, EMPTY_WHAT,
WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT); the hardcoded agent `"opencode"`
(rune_context/rune_session_start) → `RUNECRAFT_AGENT_ID` ?? `"pi"`; returns =
the same JSON strings of the source.

## Categories (8)

`project_rules` · `architecture` · `constraints` · `config_values` · `naming`
· `decisions` · `corrections` · `learnings` — the usage guide (what to save
in each) lives in the skill `skills/using-runes/SKILL.md`.

## Compaction

`rune_save` enforces the per-category cap (`categoryCap`, default 10 — config
`memory` of the state). Above the softCap → signal with candidates (≤5) for
curation; above the hardCap (2×) → transactional pruning
(`importance ASC, created_at ASC, rowid ASC` tie-break) of the oldest
lowest-importance memories. Signal `compaction.pruned_count > 0` = data
pruned without curation.

## Config

Additive `memory` section in state.json (schemaVersion 1 — next to
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

- **Frozen per session**: snapshot at extension init — a mid-session change
  has no effect.
- **Kill switch**: `RUNECRAFT_MEMORY=0|false|off` → INERT layer (no tool
  registered, no file created; the CLI refuses with a message — exit 0).
- **Fail-closed per module**: invalid config → safe defaults + reported
  problem (warning on the extension stderr).
- Source fields NOT ported (honest findings): `importance_floor` (parsed but
  never enforced in the source), `disabled_skills` (the OpenCode skill
  system, n/a on Pi), `data_dir` JSONC (→ env + state).

## Bridge from observability

`harness memory import-lessons [--dry-run]` imports
`.runecraft/lessons/promoted.jsonl` (versioned team memory — OWNED by the
observability layer) into `learnings` memories:

- `title` = trigger · `what` = "Anti-pattern: …\nPreferred pattern: …" ·
  `where_ref = "lesson:<lessonId>"` (idempotency key) · importance = mapped
  priority (low=3 / med=5 / high=8).
- **Idempotent**: a 2nd import → zero inserts (where_ref collision → skip —
  never overwrites user memory). **Source never rewritten** (opened
  read-only; a test asserts byte-for-byte hash).
- `importLessonsOnStart: true` → import at extension init (after registering
  tools). `--dry-run` → report without writing. Missing/empty file → no-op
  (exit 0).

## CLI

```
harness memory search <query>            # markdown table (FTS, all projects)
harness memory stats                     # counts per category + last activity
harness memory doctor [--purge]          # drift memories vs memories_fts; --purge hard-deletes + rebuild
harness memory import-lessons [--dry-run] # observability bridge (idempotent)
```

Exit codes (port of the bin): 0 ok · 1 error/drift without `--purge`/
inaccessible store · 2 wrong usage. `--json` → stable shape per subcommand.
Kill switch → fail-visible refusal (nothing created).

## Determinism

- DI in the `Repository`: injectable `clock`/`idGen` (defaults `Date.now`/
  `randomUUID`) — evals inject fixed sequences (timestamps are informational
  payload, never identity).
- Explicit tie-breaks in orderings without a total key (fixes a latent source
  bug — documented): `recentMemories` → `created_at DESC, rowid DESC`;
  `selectOldestLowestPriority` → `importance ASC, created_at ASC, rowid ASC`;
  `listSessions` → `started_at DESC, id DESC`.
- FTS5 `rank` is deterministic for the same corpus+query on the same runtime
  (Bun) — the memory eval compares complete results with injected
  clock/id.

## Privacy

- Memory content (title/what/why/…) lives **ONLY in the DB**
  (`.runecraft/memory/runes.db` — gitignored). It is never written raw into
  events/ (the recorder uses `argsHash` — normalized sha256), state.json,
  continuation.json, lessons.jsonl or logs (the memory layer logs only
  metadata: ids/counts).
- The tool returns to the agent are the mechanism (transcript — inherent to
  the memory function); the CLI writes to the TERMINAL stdout (explicit
  inspection — the purpose of the port).
- **Do not save secrets** (the skill is the soft warning; this doc is the
  explicit warning).

## Boundaries

| Sink | Owner |
| --- | --- |
| `events/` + `lessons.jsonl` + `lessons/promoted.jsonl` | observability (memory reads promoted read-only) |
| `continuation.json` + `resilience-events.jsonl` | resilience |
| `verify-verdicts.jsonl` | verification |
| ledger `.pi-glla/` | guards/resilience |
| `.runecraft/memory/` | **memory** |
