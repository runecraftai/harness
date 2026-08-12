// matrix.ts — component×agent matrix (F17 D1): single source of truth for
// "what each agent receives". install/doctor/status/sync read from it —
// never from scattered strings. Tier model (Phase A — messaging rebalance;
// roadmap: docs/PARITY.md):
//
//   Tier 1 Pi    = full column: 4 forks (pi-packages) + rules native — the
//                  reference implementation of the full layer
//   Tier 2 non-Pi = taskflow-MCP + workflow rules today; the other 4
//                  components are unsupported cells whose reason carries the
//                  PLANNED native surface ("planned: …"; phase id only where
//                  the roadmap assigns it — PARITY.md owns attribution)
//   Tier 3 other  = detect-only with a guide (registry.ts DETECT_ONLY_GUIDES)
//
// A cell is one of:
//   pi-packages  → npm specs resolved via versions.ts (plan.ts owns pins)
//   mcp          → taskflow MCP entry in the host config (adapter.paths)
//   rules        → marker section in a text file (RULES_SECTION)
//   native       → delivered by other components; no CLI action (Pi rules)
//   unsupported  → fail-closed per cell; reason = refusal + "planned: …"
//                  (the roadmap's native surface for that agent×component)
//
// File paths in `rules` cells are declarative (~ shorthand); the real paths
// come from adapter.paths(rt) at runtime (F15 D1) — the matrix does not
// duplicate resolution logic.
import { RULES_SECTION } from "./adapters/rules.ts";
import type { AgentId } from "./adapters/types.ts";
import { ROUTING_SECTION } from "./routing/claudeSection.ts";
import { capabilityReason, type ManifestAgentId } from "./capabilities/manifest.ts";

export type MatrixAgentId = "pi" | AgentId;

export type ComponentId = "subagents" | "taskflow" | "goal-loop-audit" | "pr-review" | "rules" | "guards" | "routing";

export interface AgentDef {
  /** binary name resolved on PATH (install fail-closed, doctor detection). */
  binary: string;
  display: string;
  /** limitation note (e.g. Codex solo-agent) shown in the status legend. */
  note: string;
}

export const AGENTS: Record<MatrixAgentId, AgentDef> = {
  pi: { binary: "pi", display: "Pi", note: "nativo (F2–F5)" },
  "claude-code": { binary: "claude", display: "Claude Code", note: "" },
  opencode: { binary: "opencode", display: "OpenCode", note: "" },
  codex: { binary: "codex", display: "Codex", note: "solo-agent (sem permissions/output styles — regras adaptadas)" },
  // F31 D8: Copilot (VS Code) — alvos repo-scoped (workspace). Sem enforcement:
  // guards são Pi-only (F24) — a coluna declara unsupported com motivo.
  copilot: { binary: "code", display: "Copilot (VS Code)", note: "repo-scoped (workspace); sem enforcement — guards são Pi-only (F24)" },
};

export type Cell =
  | { kind: "pi-packages"; group: string }
  | { kind: "mcp"; entry: string }
  | { kind: "rules"; file: string; section: string }
  | { kind: "native" }
  | { kind: "unsupported"; reason: string };

export const MATRIX: Record<MatrixAgentId, Partial<Record<ComponentId, Cell>>> = {
  pi: {
    subagents: { kind: "pi-packages", group: "subagents" },
    taskflow: { kind: "pi-packages", group: "taskflow" },
    "goal-loop-audit": { kind: "pi-packages", group: "goal-loop-audit" },
    "pr-review": { kind: "pi-packages", group: "pr-review" },
    rules: { kind: "native" },
    // F24 D9: guards são extensão Pi do harness (envio junto com o package) —
    // coluna Pi-only, sem ação de CLI (native).
    guards: { kind: "native" },
    // F33: coded routing é extensão Pi (before_agent_start) — native.
    routing: { kind: "native" },
  },
  "claude-code": {
    taskflow: { kind: "mcp", entry: "taskflow" },
    rules: { kind: "rules", file: "~/.claude/CLAUDE.md", section: RULES_SECTION },
    // B1: coded-routing directive como seção de CLAUDE.md (motor F18) — mesmo
    // tratamento de target rules do workflow (registro + three-way por conteúdo).
    routing: { kind: "rules", file: "~/.claude/CLAUDE.md", section: ROUTING_SECTION },
    // planned: superfície nativa do roadmap (docs/PARITY.md) — o motivo da
    // célula lê "v1", não "nunca". Os motivos são FONTE ÚNICA do manifest B0
    // (capabilityReason) — B1/B2/B4/B7 = fases do PARITY.md.
    subagents: { kind: "unsupported", reason: capabilityReason("claude-code", "subagents", "subagents") },
    "goal-loop-audit": { kind: "unsupported", reason: capabilityReason("claude-code", "goal-loop", "goal-loop-audit") },
    "pr-review": { kind: "unsupported", reason: capabilityReason("claude-code", "pr-review", "pr-review") },
    guards: { kind: "unsupported", reason: capabilityReason("claude-code", "guards", "guards") },
  },
  opencode: {
    taskflow: { kind: "mcp", entry: "taskflow" },
    rules: { kind: "rules", file: "~/.config/opencode/AGENTS.md", section: RULES_SECTION },
    routing: { kind: "unsupported", reason: capabilityReason("opencode", "persona", "routing") },
    subagents: { kind: "unsupported", reason: capabilityReason("opencode", "subagents", "subagents") },
    "goal-loop-audit": { kind: "unsupported", reason: capabilityReason("opencode", "goal-loop", "goal-loop-audit") },
    "pr-review": { kind: "unsupported", reason: capabilityReason("opencode", "pr-review", "pr-review") },
    guards: { kind: "unsupported", reason: capabilityReason("opencode", "guards", "guards") },
  },
  codex: {
    taskflow: { kind: "mcp", entry: "taskflow" },
    rules: { kind: "rules", file: "~/.codex/AGENTS.md", section: RULES_SECTION },
    routing: { kind: "unsupported", reason: capabilityReason("codex", "persona", "routing") },
    subagents: { kind: "unsupported", reason: capabilityReason("codex", "subagents", "subagents") },
    "goal-loop-audit": { kind: "unsupported", reason: capabilityReason("codex", "goal-loop", "goal-loop-audit") },
    "pr-review": { kind: "unsupported", reason: capabilityReason("codex", "pr-review", "pr-review") },
    guards: { kind: "unsupported", reason: capabilityReason("codex", "guards", "guards") },
  },
  // F31 D8 (aditiva): copilot = taskflow-MCP (servers.taskflow em
  // .vscode/mcp.json) + rules repo-scoped (.github/copilot-instructions.md)
  // + 4 células unsupported. Guards honestos: VS Code não expõe hooks de
  // tool-call (sem superfície nativa) — o roadmap documenta detect-only (B2).
  copilot: {
    taskflow: { kind: "mcp", entry: "taskflow" },
    rules: { kind: "rules", file: ".github/copilot-instructions.md", section: RULES_SECTION },
    routing: { kind: "unsupported", reason: capabilityReason("copilot", "persona", "routing") },
    subagents: { kind: "unsupported", reason: capabilityReason("copilot", "subagents", "subagents") },
    "goal-loop-audit": { kind: "unsupported", reason: capabilityReason("copilot", "goal-loop", "goal-loop-audit") },
    "pr-review": { kind: "unsupported", reason: capabilityReason("copilot", "pr-review", "pr-review") },
    guards: { kind: "unsupported", reason: capabilityReason("copilot", "guards", "guards") },
  },
};

/** Cell for a (agent × component) pair; undefined when the column has no entry. */
export function cellFor(agent: MatrixAgentId, component: ComponentId): Cell | undefined {
  return MATRIX[agent][component];
}

/** Components with an actionable cell (install/sync apply them; `native` is no-op). */
export function columnComponents(agent: MatrixAgentId): ComponentId[] {
  return (Object.keys(MATRIX[agent]) as ComponentId[]).filter(
    (id) => MATRIX[agent][id]?.kind !== "native",
  );
}

/**
 * First fail-closed pair among the requested agents×components (D5 step 3).
 * Returns the unsupported cell's reason — install refuses with it before any
 * write. Detect-only agents (outside the matrix) have no cells and never
 * reach this helper.
 */
export function firstUnsupported(
  agents: MatrixAgentId[],
  components: ComponentId[],
): { agent: MatrixAgentId; component: ComponentId; reason: string } | undefined {
  for (const agent of agents) {
    for (const component of components) {
      const cell = MATRIX[agent][component];
      if (cell?.kind === "unsupported") {
        return { agent, component, reason: cell.reason };
      }
    }
  }
  return undefined;
}
