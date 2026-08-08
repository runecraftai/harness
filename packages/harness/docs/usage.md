# Usage

Install, verify and operate the Runecraft harness (`companion`, alias
`harness`; package `@runecraft/companion`).

## Install

```bash
pi install npm:@runecraft/companion     # global
pi install npm:@runecraft/companion -l  # project-local (.pi/settings.json)
```

A new Pi session loads the extensions of all four forks: `/tf`, `/goal`,
`subagent({action:"list"})` and `/pr-review` respond in the same session.

## Verify the install

```bash
companion doctor                        # read-only diagnostics (pass/warn/fail + remedy)
companion status                        # cross-state report: pi list × state × manifest
pi -p "/tf --help"                      # taskflow responds
pi -p "/goal status"                    # goal-loop-audit responds
pi -p "subagent({action:'list'})"       # subagents responds
pi -p "/pr-review --help"               # pr-review responds
```

## Day-to-day operations

- `companion doctor` — read-only diagnostics: checks with pass/warn/fail and
  a remedy for each failure.
- `companion status` — installed packages and versions, cross-state report
  (pi list × state × manifest), install suggestion when nothing is managed.
- `companion sync` — idempotent reconciliation: reinstalls what the harness
  manages and is missing.
- `companion uninstall` — managed removal: removes **only** what the harness
  installed (`--component <id>` / `--all`).
- `companion restore <name>` / `companion backups` — snapshot restore and
  listing.
- `companion install --agent <id>` — manage non-Pi agents (Claude Code,
  OpenCode, Codex, Copilot) in the same detect/inject/remove pattern.

## Configuration

Each fork ships its own defaults and docs (`subagents.defaultModel`, the
goal-loop-audit auditor model, taskflow budgets, …). The recommended
`settings.json` block covering all four packages (merge of defaults) is
delivered by the harness CLI — `companion install` writes it; see the doctor
output for the effective state.

## Collisions and coexistence

- **Collision warning**: do not install alongside the original upstreams
  (`pi-subagents`, `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`) —
  commands and tools duplicate. Remove the upstreams before installing the
  harness.
- **Coexistence with other installers** is detected at runtime: a state file
  or third-party marker sections in managed rules files surface as an owner
  warning (doctor check "upstream coexistence"), and the install gate asks
  for confirmation (`--yes`) before writing. Third-party content is never
  touched (see [ROUTING.md](ROUTING.md) §7).

## Rollback and backups

The harness takes snapshots of the managed state before mutating operations.
- `companion backups` — lists snapshots (date, size, scope); `--keep <name>`
  pins a snapshot so it is never pruned.
- `companion restore <name>` — restores a snapshot.

See the umbrella README for the full troubleshooting guide.
