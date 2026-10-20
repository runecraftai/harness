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

- **Location**: `<repoRoot | cwd>/.runecraft/memory/runes.db` (gitignored) —
  override `RUNECRAFT_MEMORY_DATA_DIR` (evals/CLI). `<repoRoot>` is the MAIN
  checkout, not "wherever the current `.git` is": a linked worktree
  (`git worktree add`) resolves through the git common directory to the main
  checkout's `.runecraft/memory` (`resolveSharedGitRootSync` in
  `src/memory/project.ts`). Submodules keep their own root: their `.git` is
  also a file, but their git dir equals their common dir (the inner repo's main
  worktree is a bare dir inside the superproject), so the submodule checkout
  itself stays the memory root instead of anything under the superproject.
  The resolved root is never a git directory: the main-worktree candidate must
  pass `git rev-parse --show-toplevel` on itself and differ from the git common
  dir. When git reports a git dir instead of a checkout — a main repo that is
  bare (`git clone --bare` + `git worktree add`) or that uses
  `--separate-git-dir` — there is no shared checkout to point at, so the linked
  worktree keeps its own `.runecraft/memory` (see the table below). The same
  fallback applies when the main checkout was deleted/moved or git cannot be
  read.
- **Per-repo scope — two separate roles**: the BASE SLUG comes from
  `normalizeRemoteUrl` (`remote.origin.url`, SSH/HTTPS path after the host,
  strip `.git`) — its last path segment; no remote → absolute cwd path; no git
  root → absolute cwd path. That derivation is **frozen**: it is byte-compatible
  with the released behavior (e.g. `https://host/o/r.git/` keeps the historical
  slug `r.git`), because renaming it would hide the memories of every existing
  project. REPO EQUIVALENCE uses `canonicalRemoteKey` instead
  (`host/path`, with scheme, `user@`, port, trailing `/` and `.git` ignored) —
  used only for `sameRemote` and for the disambiguation hash, never for the
  slug. Deterministic override: `RUNECRAFT_MEMORY_PROJECT_SLUG` (pins the base
  slug).
- **Collision-free identity** (`getOrCreateProject`): the last segment alone
  is not unique (`one.example/team/shared` vs `two.example/other/shared`). A
  remote that finds its base slug already owned by a DIFFERENT remote gets
  `<slug>-<sha256(canonicalRemoteKey)[:8]>` instead, so two projects with
  distinct remotes never share rows. Rules that keep this stable:
  - The first project to claim a base slug keeps it. **Existing rows are never
    rewritten — the change requires no migration**: an existing project
    (single remote) keeps its exact slug, its project id and its memories.
  - The same repo over SSH and HTTPS is ONE project: remotes are compared by
    canonical key (`git@host:o/r.git`, `ssh://git@host/o/r.git`,
    `git://host/o/r.git` and `https://host/o/r/` all become `host/o/r`), and
    the disambiguated suffix also hashes that key, so the same repo gets one
    identity regardless of the protocol or spelling it was cloned with. The
    host is part of the key: same path on two different hosts stays two
    projects.
  - A row with no `remote_url` is never displaced, and it is the ONE documented
    exception to "never share rows": a legacy project, or a slug pinned by
    `RUNECRAFT_MEMORY_PROJECT_SLUG`, keeps owning its slug even when a remote
    appears in the checkout — and since the row's `remote_url` stays `NULL`
    (no row rewrites), the next DIFFERENT remote deriving the same base slug is
    adopted into that same row as well. With a shared
    `RUNECRAFT_MEMORY_DATA_DIR` that mixes their memories; the fix is a
    distinct slug (rename via `RUNECRAFT_MEMORY_PROJECT_SLUG`), never an
    automatic migration.
  - Consequence for a store that already collapsed two remotes into one
    project (only reachable with a shared `RUNECRAFT_MEMORY_DATA_DIR`): the
    historical rows stay attached to the first project; the second remote
    starts a fresh project. Nothing is split, moved or deleted automatically.
- **WAL** (`PRAGMA journal_mode = WAL`) + `foreign_keys = ON` +
  `busy_timeout = 5000`: concurrent readers + serialized writer
  (multi-session in the same repo). Open with a 1×/100ms retry; persistent
  failure → tools absent + warning (fail-closed — the session continues
  without memory; `harness memory doctor` diagnoses).

### Worktrees: what is shared, what is per-worktree, what is discarded

| | Where it lives |
| --- | --- |
| **Shared** by every worktree of one repo | `.runecraft/memory/runes.db` — all projects/sessions/memories, in the main checkout (only when that main checkout is a real checkout) |
| **Per-worktree, cwd-scoped** (written to the worktree's own cwd, not by memory) | `.runecraft/events/`, `.runecraft/lessons.jsonl`, `.runecraft/continuation.json`, `.runecraft/resilience-events.jsonl`, `.runecraft/verify-verdicts.jsonl`, `.runecraft/receipts/`, `.runecraft/plans/`, `.runecraft/config.json`, `.runecraft/state.json` — observability, resilience, verification, receipts, SDD and gates state, all gitignored/untracked |
| **Per-worktree but VERSIONED** | `.runecraft/lessons/promoted.jsonl` — it is a tracked team-memory file, so `git worktree remove` only drops the worktree's unchecked-out copy; committed lessons come back from the branch |
| **Discarded** | `git worktree remove <path>` deletes the worktree directory and its per-worktree, uncommitted sinks above; the shared memory DB survives. Deleting the MAIN checkout discards the DB. `harness memory doctor --purge` hard-deletes soft-deleted rows DB-wide (all projects) |

Three honest consequences, all measured behavior:

- **A memory saved from a scratch/task worktree is NOT isolated.** It is
  written to the shared durable repo DB and stays there after
  `git worktree remove`. There is no scratch-memory mode; do not treat a
  throwaway worktree as a throwaway memory scope.
- **A linked worktree of a bare main repo or of a `--separate-git-dir` main
  gets its OWN memory DB.** Git reports a git directory (not a checkout) as the
  main worktree in those layouts, and the memory root never resolves into a git
  dir, so the worktree falls back to `<worktree>/.runecraft/memory`: that DB is
  per-worktree and is discarded by `git worktree remove`. To share memory with
  such a repo, give its worktrees a normal main checkout or pin
  `RUNECRAFT_MEMORY_DATA_DIR`.
- **A DB written by an older version inside a linked worktree is no longer
  read and is not migrated** (normal-checkout case). Before this relocation the
  memory root was the worktree itself (`<worktree>/.runecraft/memory/runes.db`);
  that file is now ignored in favour of the main checkout's DB and is deleted
  by the next `git worktree remove`. Nothing is copied automatically — copy it
  into the main checkout's `.runecraft/memory/runes.db` if those memories
  matter. (Bare/`--separate-git-dir` mains are unaffected: their worktrees still
  use their own DB, see the entry above.)
- `projects.root_path` records the main checkout, so for a repo WITH a remote
  two worktrees resolve the same slug and never create two project rows. A repo
  without a remote has no shared slug (the fallback is the absolute cwd), so
  each worktree gets its own project row in the shared DB.

## Schema (runes port; additive v2)

`schema.sql` ported from runes, extended additively in v2
(`memories.imported_from` — `migrations.ts` ALTER-backfills a v1 store);
verified executable in bun:sqlite — and in node:sqlite on Node ≥22.19 with
FTS5:

- `projects` (id, slug UNIQUE, root_path, remote_url, created_at)
- `sessions` (id, project_id FK, agent, started_at, ended_at, summary)
- `memories` (id UNIQUE, project_id, session_id, category, title, what, why,
  where_ref, learned, importance, soft_deleted, created_at, updated_at,
  imported_from)
- `memories_fts` — FTS5 `tokenize='unicode61 remove_diacritics 2'` (matches
  "café" and "cafe") with triggers `memories_ai/ad/au/soft_delete_au`
  (soft-delete removes from the index)
- `schema_meta` — `SCHEMA_VERSION = 2` (idempotent migration; future changes
  are ADDITIVE)

## Tools (10/10 ported, SAME names)

| Tool | What it does |
| --- | --- |
| `rune_save` | saves a memory (category/title/what/why/where_ref/learned/importance) + compaction signal; an optional `session_id` must belong to this project (SESSION_NOT_FOUND otherwise); a compaction failure after the insert returns `ok:false, saved:true` (see the failure contract under **Compaction**) |
| `rune_search` | FTS5 over titles/content, ordered by rank; category + **project** filter; soft-deleted excluded |
| `rune_get` | fetch by id, scoped to this project (NOT_FOUND when soft-deleted, missing, or owned by another project) |
| `rune_update` | field patch scoped to this project (importance clamp [1,10]; NOT_FOUND when missing or foreign) |
| `rune_delete` | soft-delete scoped to this project (disappears from search/get/context; `doctor --purge` hard-deletes; NOT_FOUND when missing or foreign) |
| `rune_context` | snapshot: project + active session + 10 recent + relevant (query) by importance |
| `rune_timeline` | recent sessions (started_at DESC) |
| `rune_stats` | totals per category + last activity |
| `rune_session_start` | starts a session (idempotent — reuses the active one) |
| `rune_session_end` | ends a session, scoped to this project (NOT_FOUND when missing or foreign) |

ID-based access (`rune_get`/`rune_update`/`rune_delete`) and session mutations
(`rune_session_end`, and `rune_save`'s `session_id` attach) are bound to the
calling project — a known id/session from another project in the same database
is refused as NOT_FOUND / SESSION_NOT_FOUND, the same refusal shape as a
missing id, so the response never confirms that a foreign row exists.

Port adaptations: `tool()` of `@opencode-ai/plugin` → `defineTool` of the Pi
SDK; zod → TypeBox `parameters` (the real defineTool shape) + manual
validation in `src/memory/validate.ts` with the SAME error codes of the
source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG, EMPTY_WHAT,
WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT); the hardcoded agent `"opencode"`
(rune_context/rune_session_start) → `RUNECRAFT_AGENT_ID` ?? `"pi"`; returns =
the same JSON strings of the source, except `rune_save`'s compaction-failure
shape below (the source had no failure contract).

## Categories (8)

`project_rules` · `architecture` · `constraints` · `config_values` · `naming`
· `decisions` · `corrections` · `learnings` — the usage guide (what to save
in each) lives in the skill `skills/using-runes/SKILL.md`.

## Compaction

`rune_save` enforces the per-category cap (`categoryCap`, default 10 — config
`memory` of the state). Above the softCap → signal with candidates (≤5) for
curation; above the hardCap (2×) → transactional pruning
(`importance ASC, created_at ASC, rowid ASC` tie-break) of the oldest
lowest-importance memories. Even importance 10 does not protect a row from
pruning. Signal `compaction.pruned_count > 0` = data pruned without curation.

### Save and compaction failure contract

`rune_save` commits the insert **before** checking and enforcing the limit.
Save plus compaction is **not atomic**. Pruning's soft-deletes and FTS removals
use a separate transaction: an error during that transaction rolls them back,
not the already committed insert. The category can remain above its hard cap.

- **Success**: the existing `{ok:true, memory, compaction}` response is
  unchanged (`compaction:null` when no signal is needed).
- **Validation failure before saving**: `{ok:false, error:{code, message}}`;
  no memory is inserted. Correct the input before trying again.
- **Compaction failure after saving**: the tool returns JSON, not a thrown
  database exception, with this explicit partial-failure shape:

  ```jsonc
  {
    "ok": false,
    "saved": true,
    "memory": { /* complete saved memory, including id */ },
    "error": {
      "code": "COMPACTION_FAILED",
      "message": "Memory saved, but compaction failed. Do not retry rune_save; use the returned memory id."
    }
  }
  ```

  `saved:true` confirms the insert committed; `ok:false` means the full
  save-and-apply-limit operation did not complete. `memory` is the insert
  receipt, not a fresh read of its current live/deleted state. `compaction`
  is omitted because no reliable signal is available. No `pruned_count:0`
  is implied: a failure while constructing the signal **after** the pruning
  transaction committed does not undo those deletions. Raw database exception
  messages are not returned.

**Do not retry the original `rune_save` after `COMPACTION_FAILED`**: saves
have no deduplication key, so retrying inserts another row. Use `memory.id`
with `rune_get` to inspect the current state, or `rune_update`/`rune_delete`
to act on that specific memory. Read-only calls are safe to retry. Repository
callers can retry `checkAndEnforceCompaction` with the same project, category,
and caps after resolving the fault; it recomputes overflow without inserting
another memory. There is no standalone compaction tool; subsequent independent
saves also check the limit. Unexpected insert/storage errors before an insert
receipt exists still throw and carry no safe-to-retry guarantee.

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
  `where_ref = "lesson:<lessonId>"` (idempotency key) · `imported_from` marks
  the row as bridge-owned (schema v2) · importance = mapped priority
  (low=3 / med=5 / high=8).
- **Source never rewritten** (opened read-only; a test asserts byte-for-byte
  hash).

**Revocation and source changes** — two deterministic rules, both applied on
every import:

1. **Source lesson changed** (same `lessonId`, different trigger/antiPattern/
   preferred/priority) → the stored copy is refreshed in place to match the
   current source (`updated` in the report).
2. **Source lesson disappeared** (a `lessonId` that was previously imported
   is no longer in `promoted.jsonl`) → its memory is revoked (soft-deleted)
   by the import itself (`revoked` in the report). This applies unconditionally
   whenever the file was read, including when the file is still present but
   now has zero valid lesson lines (emptied, or every line removed) — that
   state means every previously imported lesson has disappeared, not that
   the import was a no-op. It re-applies on every import, so the revocation
   is durable: as long as the lesson stays out of the source, it stays
   revoked. A line that fails validation (`malformed`) does NOT count as its
   lessonId disappearing — a single broken line never revokes an otherwise
   still-present lesson.

**Deleting only the imported copy (`rune_delete`) is NOT a revocation
mechanism.** If the lesson is still listed in `promoted.jsonl`, the next
import recreates it from the current source content — never from whatever
the deleted row used to say. To actually revoke a lesson, fix or remove it
at the source the observability layer owns.

A memory that collides on `where_ref` but lacks the `imported_from` marker
(a real user memory, or a row imported before this behavior shipped) is
never touched — the import reports it as `skipped`.

**Truncation**: the composed `what` is capped at 4000 characters (`WHAT_MAX`
in `validate.ts`, the same limit `rune_save`/`rune_update` enforce). A long
`antiPattern` can push the `preferred` remedy past that cut; the report's
`truncated` count says how many lesson lines this happened to, instead of
importing silently truncated guidance.

- `importLessonsOnStart: true` → import at extension init (after registering
  tools). `--dry-run` → report without writing (counts reflect what would
  happen; nothing is saved/updated/revoked). **Missing** file → no-op (exit
  0, `revoked: 0` — rule 2 never runs because this bridge never read the
  source). A **present but empty** file is different: it reads as zero
  valid lessons, so rule 2 revokes every previously imported row (see
  above).

## CLI

```
harness memory search <query>            # markdown table (FTS, all projects)
harness memory stats                     # counts per category + last activity
harness memory doctor [--purge]          # FTS index vs table (counts + indexed text); --purge hard-deletes soft-deleted rows + rebuild
harness memory import-lessons [--dry-run] # observability bridge (idempotent)
```

Exit codes (port of the bin): 0 ok · 1 error/drift (also drift remaining after
`--purge`)/inaccessible store · 2 wrong usage. `--json` → stable shape per subcommand.
Kill switch → fail-visible refusal (nothing created).

### `doctor` contract

What it verifies: the live row count against `memories_fts`, **and** for each
live row that the indexed `id/project_id/title/what/why/where_ref/learned`
equals the table's (so an index edited without changing the count is reported
as drift). What it does **not** verify: that the stored memory text is correct
or unaltered (the table is the source it compares against), SQLite page
integrity (`PRAGMA integrity_check` is not run and does not catch an altered
table byte), or the content of soft-deleted rows (an index row left behind
for one is still counted as drift). A clean verdict means "index matches
table", not "content is intact". The text and `--json` output both carry this
scope statement (`scope`).

`--purge` receipt (text and `--json`), measured from the store, not from the
request: `purged` = soft-deleted rows actually removed (DB-wide, **all
projects**, not only the current one) · `notRemoved` = soft-deleted rows still
present afterwards · `liveRetained` = live rows kept · `ftsAfter`. Without
`--purge`, `purged`/`notRemoved`/`liveRetained` are `null` (no purge ran), not
`0`. `contentMismatches` = index rows differing from the table, counted before
any rebuild. With `--purge`, `memories`/`memories_fts`/`contentMismatches` are
the pre-purge snapshot while `drift` and `ftsAfter` describe the state after
the rebuild — an exit 1 there means drift survived the rebuild.

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
