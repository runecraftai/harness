# Agents

The harness works with two families of agents: **7 objective role agents**
(Pi-native, data-driven) and **non-Pi agents** managed through their matrix
column.

## The 7 objective roles (F32)

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
- **Delegation v1**: only `builder` spawns (scout + reviewer); the other
  roles do not have the `subagent` tool.
- **Models**: the 7 role ids are valid `state.models.agents.<id>` ids
  (fallback chains are user config, never hardcoded — see
  [PI.md](PI.md) / [ROUTING.md](ROUTING.md) §8.13).

## Non-Pi agents (F15/F17/F31)

The CLI manages non-Pi agents in the same detect/inject/remove pattern. Each
agent has a matrix column: taskflow-MCP + workflow rules (Claude Code,
OpenCode, Codex) or repo-scoped rules + MCP (Copilot for VS Code).

| Agent | Binary detection | MCP | Rules | Pi-only components |
| --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | `claude` on PATH | ✅ `taskflow-claude` (`.mcp.json` → `mcpServers`) | ✅ `CLAUDE.md` | ❌ refused (`use --agent pi`) |
| OpenCode (`opencode`) | `opencode` on PATH | ✅ `taskflow-opencode` (config) | ✅ `AGENTS.md` | ❌ refused |
| Codex (`codex`) | `codex` on PATH | ✅ `taskflow-codex` (config.toml) | ✅ `AGENTS.md` (solo) | ❌ refused |
| Copilot for VS Code (`copilot`; aliases `vscode`, `vscode-copilot`, `github-copilot`) | `code`/`code-insiders` or `github.copilot*` extension dir | ✅ `servers.taskflow` in `.vscode/mcp.json` (reuses `@runecraft/taskflow-claude` host) | ✅ `.github/copilot-instructions.md` (repo-scoped) | ❌ refused |

- **Detection is informative, never blocking** (F15 ADPT-02): binary on PATH =
  installed; config dir presence alone does not gate.
- **Fail-closed install**: installing without detection refuses with a hint
  (zero writes to the targets).
- **Unsupported components** are refused with the reason ("is a Pi
  extension; use `--agent pi`").
- Copilot's persona overlap with another installer is detected (owners) and
  the install gate asks for confirmation — third-party content is never
  touched ([ROUTING.md](ROUTING.md) §7/§8.12).

See [ROUTING.md](ROUTING.md) §8.13 (roles in depth) and §8.12 (Copilot).
