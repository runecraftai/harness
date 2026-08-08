---
name: memory-management
description: >
  Lightweight agent memory for non-Guild projects. Maintains project decisions
  and error patterns in a flat .agent-memory/ directory so future sessions
  can learn from past work.
  EN triggers: /memory, agent memory, project memory, remember this, record decision, capture learning.
  PT triggers: /memória, memória do agente, memória do projeto, lembrar disso, registrar decisão, capturar aprendizado.
  Do NOT use for: Guild projects (use guild-commit-learning), large knowledge bases, or replacing a proper wiki.
license: CC-BY-4.0
---

# memory-management

Lightweight agent memory for non-Guild projects. Maintains project decisions and error patterns in a flat `.agent-memory/` directory.

```
DECIDE → SELECT FILE → FORMAT ENTRY → WRITE → VERIFY
```

---

## Overview

This skill maintains two flat files in `.agent-memory/` so AI agents can persist learnings across sessions. It is intentionally simpler than Guild's `guild-commit-learning` — designed for solo developers and small teams that do not run the full Guild orchestration system.

No archive subfolder, no promotion rules, no index maintenance. Two files, one directory, one format.

---

## Directory Structure

```
.agent-memory/
├── project_decisions.md    # Architectural decisions, conventions, rationale
└── error_patterns.md       # Bugs encountered, root causes, fixes applied
```

Create the directory and both files on first use. Do not create any subdirectories or additional files.

---

## When to Use

Write to `.agent-memory/` when:

- A feature is complete and the decisions behind it are not obvious from code
- A tricky bug was fixed and the root-cause discovery is worth preserving
- An architectural choice was made (library selection, pattern adoption, API design)
- A convention was established that future sessions should follow
- You want the next agent session to know what you learned

Do not write when:

- The change is trivial and self-evident from the code
- The information duplicates what is already in ADRs, README, or docs
- You are on a Guild project (use `guild-commit-learning` instead)

---

## Process

### Step 1: Decide

Ask: Is this worth remembering?

- Does it have cross-session value?
- Is it not obvious from reading the code?
- Would knowing this save future time?

If the answer to all three is yes, proceed.

### Step 2: Select the Right File

| If the entry is about... | Write to... |
|--------------------------|-------------|
| Architectural decisions, library choices, pattern adoption, API design, conventions, rationale for a technical choice | `project_decisions.md` |
| Bugs encountered, root causes, fixes applied, symptoms, how to prevent recurrence | `error_patterns.md` |

When in doubt, prefer `project_decisions.md` for anything structural and `error_patterns.md` for anything reactive (discovered through failure).

### Step 3: Format the Entry

Use one consistent format for both files. Append new entries at the top so the most recent learning appears first.

```markdown
## [Title] (YYYY-MM-DD)

**Context**: [what was happening — the situation, the task, the system state]

**Decision/Discovery**: [what was decided or found — the thing worth remembering]

**Rationale**: [why this matters — alternatives considered, future impact, prevention]
```

Rules for good entries:

- **Title** is specific and searchable. Prefer "Why the auth service uses RS256 instead of HS256" over "Auth decision".
- **Context** gives enough background to understand the entry without reading the full codebase.
- **Decision/Discovery** states the conclusion clearly. One entry = one idea.
- **Rationale** explains the why. An entry without rationale is just a fact; with rationale it is a lesson.
- **No secrets.** Never capture API keys, tokens, passwords, or internal URLs.

### Step 4: Write

Read the target file first. Append the new entry at the top, leaving one blank line before the previous entry.

```bash
# Create directory and files if they do not exist
mkdir -p .agent-memory
[ ! -f .agent-memory/project_decisions.md ] && echo "# Project Decisions\n" > .agent-memory/project_decisions.md
[ ! -f .agent-memory/error_patterns.md ] && echo "# Error Patterns\n" > .agent-memory/error_patterns.md
```

### Step 5: Keep It Current

When re-reading entries for context:

- **Update** entries that have changed (e.g., a decision was revisited and reversed). Add a note like *(Updated: YYYY-MM-DD)* and describe what changed.
- **Remove** entries that are no longer relevant (e.g., a bug fixed by a library upgrade).
- **Merge** entries that cover the same topic. Prefer one good entry over two partial ones.

---

## Example Entries

### project_decisions.md

```markdown
## Adopted Zod v4 for runtime validation (2026-07-15)

**Context**: Evaluating validation libraries for the new API layer. Needed runtime type checking with TypeScript inference.

**Decision/Discovery**: Chose Zod v4 over Yup and io-ts. Zod's TypeScript integration is tighter, the API is simpler, and v4 adds string formats and better error messages.

**Rationale**: Yup has more plugins but weaker TypeScript inference. io-ts is powerful but harder to teach. Zod v4 strikes the right balance for a team that values type safety but not functional programming purity.
```

```markdown
## REST over GraphQL for internal services (2026-07-10)

**Context**: Designing inter-service communication for the new orders platform.

**Decision/Discovery**: REST with OpenAPI schemas, not GraphQL. Internal services need simple request/response contracts; GraphQL adds query complexity without benefit for machine-to-machine calls.

**Rationale**: GraphQL excels when a single client needs flexible data shapes. Our internal consumers are other services with fixed needs. REST + OpenAPI gives us contract generation and simpler caching.
```

### error_patterns.md

```markdown
## SQLite "database is locked" under concurrent writes (2026-07-16)

**Context**: Integration tests started failing with SQLITE_BUSY after adding parallel test workers.

**Decision/Discovery**: Root cause was multiple workers opening write transactions on the same SQLite file. SQLite serializes writes — concurrent writers get "database is locked".

**Rationale**: Fix was setting `busyTimeout` to 5000ms and adding `WAL` journal mode. For future: if write concurrency grows, switch to a client-server database. SQLite is fine for reads but serializes writes by design.
```

```markdown
## Environment variable leak in CI logs (2026-07-14)

**Context**: CI logs were printing full environment variables when a build script failed, exposing DATABASE_URL and API keys.

**Decision/Discovery**: The build script used `console.log(process.env)` in its error handler. Secrets appeared in plaintext in the CI job output.

**Rationale**: Removed the full env dump. Replaced with a filtered log that redacts values matching known secret key patterns. Added a pre-commit hook that scans for `process.env` in logging statements.
```

---

## Verification

After writing to `.agent-memory/`:

- [ ] Both `.agent-memory/project_decisions.md` and `.agent-memory/error_patterns.md` exist
- [ ] New entry is at the top of the correct file
- [ ] Entry has a dated title, Context, Decision/Discovery, and Rationale sections
- [ ] Entry has enough context to be useful standalone — a new session can understand it without reading the full codebase
- [ ] No secrets, tokens, passwords, or internal URLs captured
- [ ] Entry does not duplicate information already in ADRs, README, or docs

---

## When Not to Use This Skill

- **Guild projects.** Use `guild-commit-learning` instead — it integrates with Guild's orchestration, analytics, and knowledge graph.
- **Large knowledge bases.** Two flat files do not scale to team-wide knowledge management. When you outgrow this, consider a wiki, Notion, or Guild.
- **Replacing proper documentation.** `.agent-memory/` complements ADRs and READMEs — it does not replace them. Decisions that affect the team or public API still belong in ADRs.

---

## See Also

- `guild-commit-learning` — Full Guild-integrated memory system with archive, promotion rules, and index maintenance
- `spec-driven` — Feature workflow that produces specs worth recording as decisions
- `code-review-and-quality` — Reviews that surface bugs worth capturing in `error_patterns.md`
