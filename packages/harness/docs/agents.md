# Agents

The harness works with two families of agents: **7 objective role agents**
(Pi-native, data-driven) and **non-Pi agents** managed through their matrix
column.

## The 7 objective roles

The harness ships 7 professional roles, materialized as data-driven agents in
`<cwd>/.pi/agents/` via `companion install`/`sync` (project scope; three-way
merge by content — your edits are preserved). The fork `@runecraft/subagents`
discovers `.pi/agents/*.md` natively, and the project-scope file shadows the
same-named builtin.

| Role | Identity | Tools (allowlist) | Delegation |
| --- | --- | --- | --- |
| `planner` | plans only — never implements | read, grep, find, ls, intercom | never |
| `builder` | executes the plan, verifies before reporting | read, grep, find, ls, bash, edit, write, intercom, contact_supervisor, subagent | only: scout + reviewer |
| `reviewer` | `[APPROVE]`/`[REJECT]` verdict + ≤3 blocking issues (read-only) | read, grep, find, ls, bash, intercom | never |
| `auditor` | compliance audit (writes only `.md`) | read, grep, find, ls, bash, write, intercom | never |
| `scout` | read-only codebase recon, reports on return | read, grep, find, ls, intercom | never |
| `researcher` | external research with sources (read-only) | read, grep, find, ls, web_search, fetch_content, get_search_content, intercom | never |
| `security` | read-only security review (triage + fast-exit) | read, grep, find, ls, bash, intercom | never |

Properties:

- **Agents are data**: any new `.md` in the agents dir is discovered
  (extensible by construction); user edits are preserved by the three-way
  sync (never auto-healed).
- **Fail-closed allowlist**: what is not in the list does not exist.
- **Delegation**: only `builder` spawns (scout + reviewer); the other roles
  do not have the `subagent` tool.
- **Models**: the 7 role ids are valid `state.models.agents.<id>` ids
  (fallback chains are user config, never hardcoded — see
  [PI.md](PI.md) / [ROUTING.md](ROUTING.md) §8.13).

## Non-Pi agents

The CLI manages non-Pi agents in the same detect/inject/remove pattern. Each
agent is a Tier 2 column: taskflow-MCP + workflow rules today (Claude Code,
OpenCode, Codex) or repo-scoped rules + MCP (Copilot for VS Code), with
native parity planned per agent — see [PARITY.md](PARITY.md).

| Agent | Binary detection | MCP | Rules | Delivery (v1 + parity B0/B1) |
| --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | `claude` on PATH | ✅ `taskflow-claude` (`.mcp.json` → `mcpServers`) | ✅ `CLAUDE.md` (`runecraft:workflow` + `runecraft:routing`) | **B1**: 7 role agents in `~/.claude/agents/` + coded-routing directive (Task-tool delegation, only `builder` spawns). ❌ refused in v1: goal-loop/pr-review/guards — planned native surface in [PARITY.md](PARITY.md) |
| OpenCode (`opencode`) | `opencode` on PATH | ✅ `taskflow-opencode` (config) | ✅ `AGENTS.md` | ❌ refused in v1 — planned: overlay agents, permission overlay, external supervisor, task subagents |
| Codex (`codex`) | `codex` on PATH | ✅ `taskflow-codex` (config.toml) | ✅ `AGENTS.md` (solo) | ❌ refused in v1 — planned: codex exec, PreToolUse hooks, model profiles, headless review |
| Copilot for VS Code (`copilot`; aliases `vscode`, `vscode-copilot`, `github-copilot`) | `code`/`code-insiders` or `github.copilot*` extension dir | ✅ `servers.taskflow` in `.vscode/mcp.json` (reuses `@runecraft/taskflow-claude` host) | ✅ `.github/copilot-instructions.md` (repo-scoped) | ❌ refused in v1 — planned: runSubagent, external supervisor, harness review CLI; guards: no hook surface (detect-only) |

- **Detection is informative, never blocking**: binary on PATH = installed;
  config dir presence alone does not gate.
- **Fail-closed install**: installing without detection refuses with a hint
  (zero writes to the targets).
- **Unsupported components** are refused with the reason ("is a Pi
  extension; use `--agent pi`") plus the planned native surface
  ("planned: …", roadmap phase) — the refusal reads as "v1", not "never"
  ([PARITY.md](PARITY.md)).
- Copilot's persona overlap with another installer is detected (owners) and
  the install gate asks for confirmation — third-party content is never
  touched ([ROUTING.md](ROUTING.md) §7/§8.12).

See [ROUTING.md](ROUTING.md) §8.13 (roles in depth), §8.15 (Claude Code
parity B0/B1) and §8.12 (Copilot).

## Claude Code roles & routing (B1)

`companion install --agent claude-code` delivers two of the four tools
through Claude Code's native surface:

- **7 role agents** materialized to `~/.claude/agents/` (`planner`, `builder`,
  `reviewer`, `auditor`, `scout`, `researcher`, `security` — the same
  objective identities as the Pi roles, in Claude agent-file format:
  frontmatter `name`/`description`/`tools` + system prompt). Delegation uses
the native **Task tool** (the `Agent` tool) naming the role; only the
`builder` role carries the delegation tool in its allowlist (QA-5 mirror) —
non-delegator roles never spawn. Three-way sync (F19 D7): user edits are
preserved, never overwritten.
- **Coded-routing directive** as a second `CLAUDE.md` section
(`runecraft:routing`): a deterministic directive rendered from the same
route catalog as the F33 classifier — explicit thresholds (2; high ×2,
medium ×1), security MANDATORY, fail-closed direct, Task-tool delegation.
- The **capability manifest** (`src/capabilities/manifest.ts`, B0) is the
single source for what each agent claims per capability — `doctor` check 25
and `status` (Capabilities section) read from it; the native-surface tables
in [PARITY.md](PARITY.md) are its projection.

Verify with `companion doctor` (check 24 Claude role agents, check 25
capability manifest) and `companion status` (Claude role agents / Routing /
Capabilities sections).
