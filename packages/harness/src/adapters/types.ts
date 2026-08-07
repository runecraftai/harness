// adapters/types.ts — contract of a non-Pi agent adapter (F15 D1).
//
// One shape for the three v1 adapters (claude-code / opencode / codex). The Pi
// is NOT an adapter — its flow stays the F11 one. Adapters own detection,
// injection and removal; what each agent receives (matrix column) is applied
// by the caller (F17 matrix; v1 = rules + taskflow-MCP).
import type { Runtime } from "../config.ts";

export type AgentId = "claude-code" | "opencode" | "codex";

/** Result of adapter.detect(). Binary on PATH = installed; config dir is
 *  informative, never blocking (F15 ADPT-02, gentle-ai pattern). */
export interface DetectResult {
  installed: boolean;
  /** absolute path of the resolved binary (undefined when not found). */
  binPath?: string;
  /** resolved config home (env override > platform default). */
  configHome: string;
  /** human-readable reasons (e.g. command not found). */
  reasons: string[];
}

/** Resolved host paths (F15 D1 paths()). */
export interface HostPaths {
  /** rules file (CLAUDE.md / AGENTS.md) — marker-section target. */
  rulesFile: string;
  /** MCP config file (.mcp.json / opencode.json / config.toml). */
  mcpFile: string;
  /** key of the taskflow entry inside the MCP config (F17 D1 `entry`). */
  mcpKey: string;
  configHome: string;
}

/** One planned/executed file operation for reporting (F15 step 3). */
export type FileOp =
  | { file: string; op: "create" | "append" | "upsertSection" }
  | { file: string; op: "upsertJsonKey"; key: string }
  | { file: string; op: "upsertTomlKey"; key: string };

export interface InjectPlan {
  agentId: AgentId;
  paths: HostPaths;
  /** file ops in order (rules first, then MCP config). */
  ops: FileOp[];
}

/** Context passed to inject()/remove(). */
export interface AgentContext {
  rt: Runtime;
  /** resolved taskflow MCP bin (from resolveMcpBin; F15 D4). */
  mcpBin: string;
  /** full command for the MCP entry (defaults to ["node", mcpBin]). */
  mcpBinCommand?: string[];
  /** rendered rules section content (F15 rules.ts; F17 provides final text). */
  rulesContent: string;
  /** F19 D7: when true, inject must NOT rewrite the rules section (user-edited
   *  content is preserved; the sync reports `preserved (edited)` instead). */
  preserveRules?: boolean;
  /** command args after the bin (per-host; e.g. []). */
  mcpArgs: string[];
  /** extra env for the MCP entry (opencode skills paths etc.). */
  mcpEnvironment?: Record<string, string>;
  /** registered targets of the agent (D7: fingerprint for removal). */
  targets?: Array<{ kind: "rules" | "mcp"; file: string; entry?: string; section?: string; contentHash: string }>;
}

export interface InjectResult {
  agentId: AgentId;
  /** files written during this inject. */
  written: string[];
  /** entries/conflicts detected but NOT overwritten (F15 D5). */
  conflicts: Array<{ file: string; entry: string; reason: string }>;
}

export interface RemoveResult {
  agentId: AgentId;
  /** files whose managed content was removed (marker sections / MCP entries). */
  removed: string[];
  /** files that keep user content — preserved intact. */
  preserved: string[];
  /** entries preserved because the user edited them (D7, SETM-05/06). */
  edited: Array<{ file: string; entry: string }>;
  /** entries reported as conflicts (never touched). */
  conflicts: Array<{ file: string; entry: string; reason: string }>;
  /** files deleted because they ended empty/whitespace-only after removal (D6). */
  deleted: string[];
}

export interface AgentAdapter {
  id: AgentId;
  /** binary name resolved on PATH (e.g. "claude"). */
  bin: string;
  /** display-only install command shown on fail-closed (never executed). */
  installHint: string;
  detect(rt: Runtime): Promise<DetectResult>;
  paths(rt: Runtime): HostPaths;
  inject(ctx: AgentContext): Promise<InjectResult>;
  remove(ctx: AgentContext): Promise<RemoveResult>;
  /** sha256 fingerprint of the CURRENT mcp entry in the config file (D7);
   *  null when absent. Same function on inject-registration and remove — the
   *  registered fingerprint must equal what remove compares against. */
  readMcpFingerprint(rt: Runtime): string | null;
  /** raw current MCP entry value (F17 D3 check 10): entry object for JSON
   *  hosts, raw TOML block string for codex; null when absent. */
  readMcpEntry(rt: Runtime): unknown;
}
