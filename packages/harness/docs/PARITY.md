# Parity roadmap

What each supported agent gets from the harness today, what a full layer
looks like per agent, and when the gap closes.

This document is the roadmap behind the tier table in the umbrella README.
The v1 truth for what each matrix column actually has is [ROUTING.md](ROUTING.md)
§6 — this document is the plan, not a claim.

## The tiers

- **Tier 1 — Pi**: the reference implementation. The four tools (subagents,
  taskflow, goal-loop, pr-review) plus guards, verification, resilience,
  memory, routing and persona ship as Pi packages.
- **Tier 2 — non-Pi agents** (Claude Code, OpenCode, Codex, VS Code
  Copilot): taskflow + workflow rules today. The rest of the layer is
  planned per agent on the roadmap below.
- **Tier 3 — detect-only** (Cursor, Grok, others): the CLI detects them and
  names the exact command you'd run yourself. No adapter until a user
  actually needs one.

## The gap today

The harness owns the hard parts of the full layer once: the DAG engine,
review, receipts, verification, memory and coded routing. Pi receives all
of it through the Pi SDK. Every other agent receives the shared taskflow +
rules layer, and the remaining components are refused per cell.

The table compares today's delivery with the full layer a comparable
harness (gentle-ai v2.3.0) gives its agents through each agent's native
surface. The gap is delivery, not capability: the engines exist, the
per-agent native configuration does not.

| Agent | Today (harness v1) | Full layer (reference surface) |
| --- | --- | --- |
| **Pi** | Full layer: the four tools as packages, plus guards, verification, evals, resilience, observability, memory, persona, per-agent model routing, 7 role agents, coded routing and receipts/gates. | Package-managed too — the reference implementation. |
| **Claude Code** | taskflow-MCP (`taskflow-claude` in `.mcp.json`) + taskflow-only rules in `~/.claude/CLAUDE.md`. Subagents, goal-loop, pr-review and guards are refused. | Agent files + Task-tool subagents, output styles, slash commands, skills, per-server MCP files, PreToolUse hooks, persona via CLAUDE.md, model routing via agent-file `model:` — the richest surface. |
| **OpenCode** | taskflow-MCP (`taskflow-opencode` in `opencode.json`) + rules in `AGENTS.md`. Subagents, goal-loop, pr-review and guards are refused. | Multi-mode overlay (orchestrator + phase/review subagents), per-agent model profiles, slash commands, skills, merged MCP, native `task` subagents. |
| **Codex** | taskflow-MCP (`[mcp_servers.taskflow]` in `config.toml`) + rules in `~/.codex/AGENTS.md` (solo). Subagents, goal-loop, pr-review and guards are refused. | Skills, system prompt, MCP upserts, model-selection profiles (`codex --profile`), PreToolUse hooks, advisory review. Solo-agent surface. |
| **VS Code Copilot** | `servers.taskflow` in `.vscode/mcp.json` (repo-scoped) + `.github/copilot-instructions.md` rules. Subagents, goal-loop, pr-review and guards are refused. | Skills, a user-level instructions file, user-level MCP, `runSubagent` delegation (carried in the prompt). No tool-call hook surface. |

Cross-cutting: receipts and memory engines exist today, but they are
Pi-session-bound. Porting them re-exposes the same engines through each
agent's native surface — it does not rebuild them.

## Native surfaces per agent

What each agent's configuration can actually carry, and the verdict the
roadmap works from. "Native" means the host supports the mechanism today.
"Adapt" means a harness adapter wraps an existing engine. "✗" means no
mechanism exists.

### Claude Code (`~/.claude/`)

| Component | Native mechanism | Verdict |
| --- | --- | --- |
| subagents | Task tool + agent files (`~/.claude/agents/*.md` with name/description/model/tools frontmatter). The harness's 7 role agents are already data — they materialize per agent. | native — highest-leverage port |
| taskflow | Already delivered (MCP server spawning headless `claude -p`). | done |
| goal-loop | No session-continuation API. Closest: an external supervisor CLI spawning headless `claude -p`, triggered by git hooks. | adapt (external loop) |
| pr-review | Parallel Task-tool dispatch + `harness review` CLI + receipts. | adapt |
| guards | PreToolUse hooks in `~/.claude/settings.json` (deny or rewrite tool calls), SessionStart context, Stop verification. The 4 guard semantics map 1:1. | native — closest 1:1 to the Pi guards |
| memory | Expose the runes SQLite store as an MCP server. | adapt (MCP wrapper) |
| persona / rules / routing | CLAUDE.md marker sections (the section engine already exists). The coded-routing directive is a section. | native |
| model routing | Agent-file `model:` frontmatter per subagent + `settings.json` model. | native |
| SDD assets | Skills (`~/.claude/skills/`) + slash commands (`~/.claude/commands/`); the fork chains need a format conversion to agent files. | adapt (format conversion) |

### OpenCode (`~/.config/opencode/`)

| Component | Native mechanism | Verdict |
| --- | --- | --- |
| subagents | `agent.<name>` modes in `opencode.json` (primary/subagent, per-agent tools, model). Harness roles become overlay agents. | native |
| taskflow | Already delivered (`mcp.taskflow` + skills path in `opencode.json`). | done |
| goal-loop | No cross-session continuation; plugins hook session lifecycle only. Same external-supervisor adaptation as Claude. | adapt |
| pr-review | Native `task` subagents + review skill, or `harness review` CLI. | adapt |
| guards | Permission rules (allow/deny/ask per tool and path) + plugin hooks. Blocking semantics = deny rules; weaker than hooks (no arbitrary logic per call), but real. | adapt (permission + plugin) |
| memory | MCP server entry in `opencode.json`. | adapt |
| persona / rules / routing | `AGENTS.md` + overlay agent prompt files. | native |
| model routing | Per-agent `model:` in the overlay + named profiles — the best model-routing surface of the non-Pi agents. | native |
| SDD assets | Slash commands (`commands/*.md`) + skills. | adapt (format) |

### Codex (`~/.codex/`)

| Component | Native mechanism | Verdict |
| --- | --- | --- |
| subagents | Solo agent; no stable native subagent surface. Practical delegation = headless `codex exec` (already the taskflow-codex runner). | adapt (headless exec) |
| taskflow | Already delivered (`[mcp_servers.taskflow]` in `config.toml`). | done |
| goal-loop | External supervisor via `codex exec`. | adapt |
| pr-review | `harness review` CLI + a headless `codex exec` reviewer. | adapt |
| guards | PreToolUse hooks (block or rewrite tool calls, MCP included) via `~/.codex/hooks.json` or inline `[hooks]` in `config.toml` — the adapter already owns that file. | native |
| memory | `[mcp_servers]` upsert. | adapt |
| persona / rules / routing | `AGENTS.md` system prompt (already written) + hook-injected context. | native |
| model routing | Profiles: separate `~/.codex/<name>.config.toml` picked with `codex --profile` — the closest native per-phase model mechanism for a solo agent. | native |
| SDD assets | Skills + AGENTS.md orchestrator prompt (solo mode: the orchestrator IS the executor — no phase subagents). | adapt (solo format) |

### VS Code Copilot (repo + `Code/User/`)

| Component | Native mechanism | Verdict |
| --- | --- | --- |
| subagents | `runSubagent` tool (parallel), carried in the orchestrator/system prompt rather than a config file. Harness roles become instructions-driven delegation. | adapt (prompt-carried) |
| taskflow | Already delivered (`servers.taskflow` in `.vscode/mcp.json`). | done |
| goal-loop | No extension or hook API. External supervisor only (or excluded — an open product decision). | ✗ / adapt |
| pr-review | `harness review` CLI; no native parallel review config. | adapt |
| guards | No tool-call hook surface in VS Code chat. Enforcement is advisory via instructions only. | ✗ — guard parity impossible in v1; detect-only |
| memory | MCP (`Code/User/mcp.json`). | adapt |
| persona / rules / routing | `.github/copilot-instructions.md` (repo) + `Code/User/prompts/*.instructions.md` (user) — both already targeted. | native |
| model routing | No per-agent model config; single active model. Single-mode only — acceptable. | ✗ — single-mode |
| SDD assets | Skills (`~/.copilot/skills/`). | adapt |

Takeaway: every non-Pi agent can carry taskflow (done), rules/persona
(done-ish), memory, receipts and review. The two agents with full
enforcement surfaces are Claude Code (hooks + Task tool) and Codex (hooks +
exec). OpenCode has permission-overlay enforcement. Copilot has none.

## Roadmap

Phase A (messaging rebalance — this document) is shipped. The engineering
phases below are ordered by leverage: the biggest user-visible gap first,
the cheapest surface first. Scope and order are subject to product
decisions. Each phase ends with a capability claim per agent you can verify
with `companion doctor`.

| Phase | Scope | Effort |
| --- | --- | --- |
| B0 | Foundation: a capability manifest — per-agent feature claims (hooks, subagents, MCP, models, guards) as a single source of truth consumed by install, doctor, status and this document. | 3–5 d |
| B1 | Roles + routing for Claude Code: the 7 role agents as `~/.claude/agents/*.md`, the coded-routing directive as a CLAUDE.md section, delegation via the native Task tool. Unblocks 2 of the 4 tools for the most-used non-Pi agent. | 5–8 d |
| B2 | Guards via hooks for Claude Code + Codex: the 4 guard semantics as PreToolUse hooks. OpenCode gets a permission-overlay best-effort. Copilot is documented as having no surface. | 6–10 d |
| B3 | Memory + observability via MCP: the runes SQLite store exposed as an MCP server, registered per agent. | 4–6 d |
| B4 | pr-review as a headless CLI + receipts for all: parallel headless reviewers per host; git gates already work for any repo, so receipts become agent-agnostic. | 5–8 d |
| B5 | Persona + model routing per native surface: Claude sections + agent `model:` frontmatter; OpenCode overlay + per-agent model + profiles; Codex AGENTS.md + `<name>.config.toml` profiles. | 5–8 d |
| B6 | SDD assets per agent: chains and prompts converted to Claude agent files + commands, OpenCode overlay agents, skills. | 4–6 d |
| B7 | goal-loop as an external supervisor: one supervisor per repo driving headless sessions (Claude, Codex, OpenCode) with the existing auditor. Subject to an open product decision; if excluded, taskflow + subagents are the documented substitutes. | 8–12 d |
| B8 | Evals + parity matrix: per-agent eval targets and a parity matrix asserted by tests. | 4–6 d |

## What stays Pi-only

Some mechanisms are tied to the Pi SDK and will not be ported:

- Extension hooks (`before_agent_start` chaining, `tool_call` blocking,
  `session_start`) — Pi SDK only.
- The goal-loop extension driving `agent_end` — Pi session semantics; the
  non-Pi equivalent is the external supervisor (B7).
- `rune_*` tools as registered Pi tools, `.pi/agents/` role materialization
  and `.pi/chains/` chains.
- `models.json` generation (Pi's model registry path).

## Honesty note

Tier 2 is taskflow + rules today. Nothing in this document changes that:
the roadmap is a plan, not a claim, and each phase is verifiable via
`companion doctor` before it is advertised.
