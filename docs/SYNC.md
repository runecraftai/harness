# SYNC — Upstream Sync Workflow (F10)

Three-way sync of the 12 vendored forks against their upstreams. The engine is
`scripts/sync-upstream.ts` (see `--help`); this doc is the operating manual.

> **Design**: three-way merge with a materialized base. Base = the source
> tarball of the pinned `resolvedSha` (from each dest's `vendor.json`),
> theirs = the tarball of the ref you target, ours = the current dest.
> Per-file merge via `git merge-file` (diff3 markers); `patches/<fork>/registry.json`
> is a **documental** registry of known divergences (never applied — the engine
> is three-way, not patch-queue).

---

## 1. Prereqs

- `git` (required — `git merge-file` drives the three-way merge)
- `bun` (>= 1.3)
- Network **only for the manual sync step** (GitHub API + codeload tarballs).
  CI stays offline: `--check` / `--status --offline` never touch the network.
- A clean working tree on `main` (dirty dests are reported by `--check`).

## 2. Check new upstream releases

| Fork | Where to look |
| --- | --- |
| subagents (`nicobailon/pi-subagents`) | GitHub tags (`vX.Y.Z`) |
| taskflow (`heggria/taskflow`, 9 packages) | GitHub tags — **one** tarball per release covers all 9 |
| pr-review (`10ego/pi-pr-review`) | GitHub tags (`vX.Y.Z`) |
| goal-loop-audit (`DraconDev/pi-goal-list-loop-audit`) | **No git tags** — pin by full SHA; `--status` compares against the `package.json` version of the default-branch HEAD |

Quick check:

```bash
bun run sync:upstream --status          # network: vendored vs latest + local dirty
bun run sync:upstream --status --offline  # local-only (vendored pins + dirty state)
```

## 3. Dry-run first (always)

```bash
bun run sync:upstream subagents --to v0.38.0 --dry-run
bun run sync:upstream --group taskflow --to v0.2.7 --dry-run
```

The report shows, per dest: renamed/added/modified/removed upstream files,
conflicts (with reason: `conflict` / `modify-delete` / `binary` / `both-added`),
divergences (upstream deleted a file we modified — kept ours), and rename-pass
touches. Lines flagged `intersects registry <ids>` mean upstream touched a file
with a known divergence — read `patches/<fork>/registry.json` before applying.

`--dry-run` writes **nothing** (working tree, `vendor.json` and
`vendor.manifest.json` stay byte-identical).

> **Note**: `git merge-file` is deliberately conservative — edits on the same
> or adjacent lines from both sides surface as conflicts even when `git merge`
> would auto-resolve them. Expect some trivial `conflict` entries on churny
> files; resolve them by hand (below).

## 4. Apply

```bash
bun run sync:upstream subagents --to v0.38.0
bun run sync:upstream --group taskflow --to v0.2.7
```

- `--to` is **required and explicit** (tag or full SHA — no `--to latest`; AD-034).
- `--base <sha>` overrides the base (default: the dest's `vendor.json.resolvedSha`).
- **Clean merge** → merged tree applied, auto-rename pass re-applied
  (`@runecraft/*` in package.json + static/dynamic imports + `import.meta.resolve`),
  then `vendor.json` (dest) and `vendor.manifest.json` (ref/npmVersion) updated
  with `syncedAt`. `vendoredAt` is preserved.
- **Any conflict** → **nothing is written** (fail-closed). The report lists the
  conflicted files and prints:
  `hint: git restore packages/<dir>` (or `git checkout -- <files>`).

### Typical conflict resolution

1. **package.json name/version** — upstream bumps `version`, ours renamed
   `name` to `@runecraft/*`. Keep both: ours' `name`, upstream's `version`.
   Renamed deps go back to `workspace:*` (the pass re-applies this).
2. **import specifiers** — a file mixes the old upstream specifier with our
   renamed one; keep `@runecraft/*` on both sides.
3. **plugin/ configs** — prefer the local fork path (F15 D6: env > dev fork >
   `@runecraft` pin); never restore the upstream `npx` pin.
4. **mass renames/moves** — the dry-run's `renamed upstream` list shows them
   before you apply; if ours never touched the file, take theirs (delete ours'
   copy if the path changed).
5. **modify/delete** — we deleted a file upstream changed (or vice-versa):
   decide per case; if the divergence is permanent, record it (section 8).
6. **binary** — take theirs if we never changed it; otherwise decide manually.

After resolving: re-run the sync (it will re-merge over the resolved state) or
commit the manual resolution as part of the sync commit.

## 5. Gates (SYNC-09) — required before committing

```bash
bun run sync:upstream --gate
```

Chain: per-package tests → harness suite (1152) + F23 ratchet + goldens →
biome (tracked root-level paths + `scripts/` + `docs/` — never `.pi/.guild`) →
`turbo build` → explicit ratchet (no `--update`) → `known-failures.txt` empty.

- New test failures **never** enter the ratchet as a shortcut.
- Legitimate baseline/golden drift from the sync → explicit update, committed
  **inside** the sync commit with the added/removed/unchanged report:
  `cd packages/harness && bun run eval:ratchet --update` (refused with `CI=true`).
- A sync that bumps `vendor.manifest.json` must re-run
  `cd packages/harness && bun run generate:versions` (committed with the sync).

## 6. Provenance verification

```bash
bun run sync:upstream --check   # offline: manifest↔vendor.json consistency + dirty dests
```

After a clean sync, every dest's `vendor.json` shows the new `ref`/`resolvedSha`
plus `syncedAt`; `vendor.manifest.json` shows the new `ref`/`npmVersion`.

## 7. Commit convention

One sync = one atomic commit per entry or group, **separate from feature commits**:

```
chore(subagents): sync upstream v0.37.2..v0.38.0
chore(taskflow): sync upstream v0.2.6..v0.2.7   # --group taskflow, 9 packages, 1 commit
```

Include in the body, when applicable: the `--update` report (added/removed/
unchanged baselines/goldens) and a summary of resolved conflicts. Never mix a
feature change into a sync commit.

## 8. Registering a divergence

When a sync surfaces a permanent local divergence (upstream deleted a file we
keep, we must keep a fix upstream reverts, …):

1. Add an entry to `patches/<fork>/registry.json`
   (`{id, title, type: deleted|renamed|fixed|pending, files[], commits[], status}`).
2. Record the decision as an AD in `.specs/project/STATE.md`.
3. The diff report of later syncs will flag intersecting files automatically.

## 9. First taskflow sync cycle — BUG-1 / BUG-2 (T10)

Both are resolved **inside the 1st taskflow sync** (AD-034):

- **BUG-1** (dynamic imports not renamed): the rename pass covers `import()`
  (plain + template literals) and `import.meta.resolve()` via the shared config
  renameMap — the sync re-applies it over the merged tree, fixing
  `packages/taskflow/pi/src/index.ts` automatically. Verify after the cycle:
  `grep -rn 'import("taskflow-core")\|import.meta.resolve("taskflow-core' packages/taskflow --include=*.ts` → empty.
- **BUG-2** (`dist/agents/` not packaged → `Unknown agent: default`): the build
  must copy `src/agents/*.md` → `dist/agents/` (tsc emits `.ts` only). The
  config documents the fix; apply it to the fork build in the same commit:
  add a copy step to `packages/taskflow/core`'s build script and keep
  `"files": ["dist"]` (it already packages `dist/agents/*.md` once copied).
  Verify: `bun run build` in `packages/taskflow/core`, then run a flow with the
  `default` agent.

## 10. Taskflow group specifics (SYNC-06)

`--group taskflow` fetches **one** tarball per ref and materializes the 9
subpaths from the same extraction. Codified F16 facts:

- Build order: core → mcp-core → hosts → dsl → pi → codex → claude → opencode → grok
  (turbo `dependsOn: ["^build"]`; see `config.ts` `TASKFLOW_BUILD_ORDER`).
- MCP-layer tests run with the MCPL-06 mode
  (`node --experimental-strip-types --test 'test/**/*.test.ts'`).
- MCP bins: `*-taskflow-mcp` → `dist/mcp/bin.js`.
- The 6 MCP packages depend on `@runecraft/taskflow-core` / `@runecraft/taskflow-hosts`
  as `workspace:*` (the rename pass re-applies this after every cycle).

## 11. Reverting a bad sync

Conflicts leave the tree untouched, but after a clean-but-wrong sync:

```bash
git restore packages/<dir> vendor.json vendor.manifest.json
```

then re-run the dry-run and decide. Since a sync is a single atomic commit,
`git revert <sync-commit>` also works.
