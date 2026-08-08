// adapters/registry.ts — id → adapter dispatch (F15 D1) + detect-only list.
//
// Known ids WITHOUT an adapter (cursor, grok, …) are detect-only with a manual
// guide — never a hard fail (F15 ADPT-03, F17 D4). Unknown ids get a generic
// guide; supported ids without a binary fail closed in the install flow.
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { opencodeAdapter } from "./opencode.ts";
import { copilotAdapter } from "./copilot.ts";
import type { AgentAdapter, AgentId } from "./types.ts";

export const ADAPTERS: Record<AgentId, AgentAdapter> = {
  "claude-code": claudeAdapter,
  opencode: opencodeAdapter,
  codex: codexAdapter,
  copilot: copilotAdapter,
};

export const SUPPORTED_AGENT_IDS: readonly AgentId[] = ["claude-code", "opencode", "codex", "copilot"];

/** Aliases accepted in --agent (e.g. "claude" → "claude-code").
 *  F31 (D1): copilot + vscode/vscode-copilot/github-copilot (compat com a
 *  nomenclatura do gentle-ai — docs/agents.md id `vscode-copilot`). */
export const AGENT_ALIASES: Record<string, AgentId> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  opencode: "opencode",
  codex: "codex",
  copilot: "copilot",
  vscode: "copilot",
  "vscode-copilot": "copilot",
  "github-copilot": "copilot",
};

/**
 * Curated detect-only list (F17 D4): known agents without an adapter — report
 * with a manual guide, never fail. grok is vendored (F16) but out of the v1
 * matrix (decision AD-009): the guide points at its vendored MCP bin.
 */
export const DETECT_ONLY_GUIDES: Record<string, string> = {
  grok: "grok não tem adapter no v1. Instale o MCP manualmente apontando para o bin do pacote vendored @runecraft/taskflow-grok (dist/mcp/bin.js) no seu config de MCP.",
  cursor: "cursor não tem adapter no v1. Configure o MCP do taskflow manualmente (stdio) no config de MCP do cursor.",
};

export function isSupportedAgentId(id: string): id is AgentId {
  return id in ADAPTERS;
}

/** Resolve an --agent value to a supported adapter id, or undefined. */
export function resolveAgentId(value: string): AgentId | undefined {
  return AGENT_ALIASES[value];
}

/** Generic manual-config guide for unknown agents (F17 D4; doc link F8). */
export function genericDetectOnlyGuide(agent: string): string {
  return `${agent} não tem adapter no v1. Configure o MCP do taskflow manualmente (protocolo stdio) — ver docs de configuração manual do harness.`;
}
