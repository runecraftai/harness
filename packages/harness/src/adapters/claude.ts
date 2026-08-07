// adapters/claude.ts — Claude Code adapter (F15 D5/D6/D8).
//
// Rules → ~/.claude/CLAUDE.md (marker section). MCP → ~/.claude/.mcp.json
// (mcpServers.taskflow, plugin scope). ~/.claude.json (user-scope OAuth) is
// NEVER read for writing, never reset, never removed (D8). Install hint:
// official installer (validated against code.claude.com/docs 2026-08-07).
import * as fs from "node:fs";
import * as path from "node:path";
import { claudeCodeHome, type Runtime } from "../config.ts";
import { resolveBinaryOnPath } from "./shell.ts";
import { removeSection, upsertSection, RULES_SECTION } from "./rules.ts";
import { readJsonConfig, upsertJsonKey, removeJsonKey, type JsonFile } from "./jsonc.ts";
import { mcpEntryContentHash, sha256Hex } from "./mcpConfig.ts";
import type { AgentAdapter, AgentContext, DetectResult, HostPaths, InjectResult, RemoveResult } from "./types.ts";

const MCP_FILE = ".mcp.json";
const MCP_KEY = "taskflow";

export const claudeAdapter: AgentAdapter = {
  id: "claude-code",
  bin: "claude",
  installHint: "curl -fsSL https://claude.ai/install.sh | bash",

  async detect(rt: Runtime): Promise<DetectResult> {
    const binPath = await resolveBinaryOnPath("claude", rt.env);
    const configHome = claudeCodeHome(rt.env);
    if (binPath) return { installed: true, binPath, configHome, reasons: [] };
    return {
      installed: false,
      configHome,
      reasons: [`comando 'claude' não encontrado no PATH — instale com: ${claudeAdapter.installHint}`],
    };
  },

  paths(rt: Runtime): HostPaths {
    const configHome = claudeCodeHome(rt.env);
    return {
      rulesFile: path.join(configHome, "CLAUDE.md"),
      mcpFile: path.join(configHome, MCP_FILE),
      mcpKey: MCP_KEY,
      configHome,
    };
  },

  async inject(ctx: AgentContext): Promise<InjectResult> {
    const paths = this.paths(ctx.rt);
    const written: string[] = [];
    const conflicts: InjectResult["conflicts"] = [];

    // Rules: marker section (append/upsert, idempotent).
    const rules = upsertSection(paths.rulesFile, RULES_SECTION, ctx.rulesContent);
    if (rules.changed) written.push(paths.rulesFile);

    // MCP: upsert mcpServers.taskflow only when absent or registered as ours
    // (F15 D5 — a foreign entry is reported, never overwritten). "Ours" = the
    // current entry fingerprints equal the registered target (same formula as
    // remove D7 — not shape-dependent managedEntries).
    const entry = mcpEntry(ctx);
    const cfg: JsonFile = fs.existsSync(paths.mcpFile) ? readJsonConfig(paths.mcpFile, false) : { file: paths.mcpFile, existed: false, indent: "  ", content: {} };
    const servers = cfg.content.mcpServers;
    const existing = (servers as Record<string, unknown> | undefined)?.[MCP_KEY];
    const registeredMcp = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (existing !== undefined && registeredMcp) {
      // registrada como nossa (D5-b) → reescreve no lugar (rerun idempotente;
      // mesmo que o usuário tenha editado — o fingerprint é gate do REMOVE/D7,
      // não do inject; sync/rerun re-aplicam a config do harness).
      const up = upsertJsonKey(paths.mcpFile, ["mcpServers", MCP_KEY], entry);
      if (up.changed) written.push(paths.mcpFile);
    } else if (existing !== undefined) {
      conflicts.push({ file: paths.mcpFile, entry: MCP_KEY, reason: "entry MCP existente não registrada no state (possível upstream ou configuração manual) — não sobrescrita" });
    } else {
      const up = upsertJsonKey(paths.mcpFile, ["mcpServers", MCP_KEY], entry, true);
      if (up.changed) written.push(paths.mcpFile);
    }
    return { agentId: "claude-code", written, conflicts };
  },

  async remove(ctx: AgentContext): Promise<RemoveResult> {
    const paths = this.paths(ctx.rt);
    const removed: string[] = [];
    const preserved: string[] = [];
    const edited: RemoveResult["edited"] = [];
    const conflicts: RemoveResult["conflicts"] = [];
    const deleted: string[] = [];

    // Rules section.
    const afterRules = fs.existsSync(paths.rulesFile) ? removeSection(paths.rulesFile, RULES_SECTION) : null;
    if (afterRules !== null) {
      if (afterRules.trim() === "") {
        fs.unlinkSync(paths.rulesFile);
        deleted.push(paths.rulesFile);
      } else {
        fs.writeFileSync(paths.rulesFile, afterRules, "utf8");
        removed.push(paths.rulesFile);
      }
    }

    // MCP entry: remove only when current value == registered fingerprint (D7).
    const target = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (target && fs.existsSync(paths.mcpFile)) {
      const current = readClaudeMcpEntry(paths.mcpFile);
      if (current !== undefined) {
        if (target.contentHash === sha256Hex(JSON.stringify(current))) {
          removeJsonKey(paths.mcpFile, ["mcpServers", MCP_KEY]);
          removed.push(paths.mcpFile);
          // Empty config → delete the file (D6): `{}` or `{"mcpServers": {}}`.
          const after = readJsonConfig(paths.mcpFile, false);
          const servers = after.content.mcpServers as Record<string, unknown> | undefined;
          if (Object.keys(after.content).length === 0 || (Object.keys(after.content).length === 1 && servers && Object.keys(servers).length === 0)) {
            fs.unlinkSync(paths.mcpFile);
            deleted.push(paths.mcpFile);
          }
        } else {
          edited.push({ file: paths.mcpFile, entry: MCP_KEY });
          preserved.push(paths.mcpFile);
        }
      } else {
        preserved.push(paths.mcpFile);
      }
    }
    return { agentId: "claude-code", removed, preserved, edited, conflicts, deleted };
  },

  readMcpFingerprint(rt: Runtime): string | null {
    const mcpFile = path.join(claudeCodeHome(rt.env), MCP_FILE);
    const current = readClaudeMcpEntry(mcpFile);
    return current === undefined ? null : sha256Hex(JSON.stringify(current));
  },
};

export function mcpEntry(ctx: AgentContext): Record<string, unknown> {
  const [command, ...args] = ctx.mcpBinCommand ?? ["node", ctx.mcpBin];
  return {
    type: "stdio",
    command,
    ...(args.length > 0 ? { args } : {}),
  };
}

/** Read the current mcpServers.taskflow entry value; undefined when absent. */
function readClaudeMcpEntry(mcpFile: string): unknown {
  if (!fs.existsSync(mcpFile)) return undefined;
  const cfg = readJsonConfig(mcpFile, false);
  const servers = cfg.content.mcpServers as Record<string, unknown> | undefined;
  return servers?.[MCP_KEY];
}

