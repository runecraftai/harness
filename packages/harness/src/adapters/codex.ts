// adapters/codex.ts — Codex adapter (F15 D5/D6).
//
// Rules → ~/.codex/AGENTS.md (marker section). MCP → ~/.codex/config.toml
// ([mcp_servers.taskflow] upsert, tool_timeout_sec: 1800 preserved — the only
// upstream customization, F16 D6). Install hint: official installer
// (validated against openai/codex README 2026-08-07).
import * as fs from "node:fs";
import * as path from "node:path";
import { codexHome, type Runtime } from "../config.ts";
import { resolveBinaryOnPath } from "./shell.ts";
import { removeSection, upsertSection, RULES_SECTION } from "./rules.ts";
import { upsertTomlSection, renderMcpServerBlock, readTomlSection, removeTomlSection } from "../toml.ts";
import { sha256Hex } from "./mcpConfig.ts";
import type { AgentAdapter, AgentContext, DetectResult, HostPaths, InjectResult, RemoveResult } from "./types.ts";

const MCP_FILE = "config.toml";
const MCP_KEY = "taskflow";
const TOOL_TIMEOUT_SEC = 1800;

export const codexAdapter: AgentAdapter = {
  id: "codex",
  bin: "codex",
  installHint: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",

  async detect(rt: Runtime): Promise<DetectResult> {
    const binPath = await resolveBinaryOnPath("codex", rt.env);
    const configHome = codexHome(rt.env);
    if (binPath) return { installed: true, binPath, configHome, reasons: [] };
    return {
      installed: false,
      configHome,
      reasons: [`comando 'codex' não encontrado no PATH — instale com: ${codexAdapter.installHint}`],
    };
  },

  paths(rt: Runtime): HostPaths {
    const configHome = codexHome(rt.env);
    return {
      rulesFile: path.join(configHome, "AGENTS.md"),
      mcpFile: path.join(configHome, MCP_FILE),
      mcpKey: MCP_KEY,
      configHome,
    };
  },

  async inject(ctx: AgentContext): Promise<InjectResult> {
    const paths = this.paths(ctx.rt);
    const written: string[] = [];
    const conflicts: InjectResult["conflicts"] = [];

    const rules = upsertSection(paths.rulesFile, RULES_SECTION, ctx.rulesContent);
    if (rules.changed) written.push(paths.rulesFile);

    // MCP: [mcp_servers.taskflow] upsert; conflict rule like the JSON hosts.
    const commandParts = ctx.mcpBinCommand ?? ["node", ctx.mcpBin];
    const cmd = commandParts[0] ?? "node";
    const block = renderMcpServerBlock(MCP_KEY, [cmd, ...commandParts.slice(1)], { tool_timeout_sec: TOOL_TIMEOUT_SEC });
    const existing = readTomlSection(paths.mcpFile, MCP_KEY);
    const registeredMcp = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (existing !== null && registeredMcp && registeredMcp.contentHash === sha256Hex(existing)) {
      const up = upsertTomlSection(paths.mcpFile, MCP_KEY, block, true);
      if (up?.changed) written.push(paths.mcpFile);
    } else if (existing !== null) {
      conflicts.push({ file: paths.mcpFile, entry: MCP_KEY, reason: "seção [mcp_servers.taskflow] existente não registrada no state — não sobrescrita" });
    } else {
      const up = upsertTomlSection(paths.mcpFile, MCP_KEY, block, true);
      if (up?.changed) written.push(paths.mcpFile);
    }
    return { agentId: "codex", written, conflicts };
  },

  async remove(ctx: AgentContext): Promise<RemoveResult> {
    const paths = this.paths(ctx.rt);
    const removed: string[] = [];
    const preserved: string[] = [];
    const edited: RemoveResult["edited"] = [];
    const conflicts: RemoveResult["conflicts"] = [];
    const deleted: string[] = [];

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

    const target = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (target && fs.existsSync(paths.mcpFile)) {
      const current = readTomlSection(paths.mcpFile, MCP_KEY);
      if (current !== null) {
        if (target.contentHash === sha256Hex(current)) {
          const next = removeTomlSection(paths.mcpFile, MCP_KEY) ?? "";
          // Colapsa APENAS a região do bloco removido (nada além disso — D6):
          // até 2 newlines consecutivos no ponto de remoção.
          const cleaned = next.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
          if (cleaned.trim() === "") {
            fs.unlinkSync(paths.mcpFile);
            deleted.push(paths.mcpFile);
          } else {
            fs.writeFileSync(paths.mcpFile, cleaned, "utf8");
            removed.push(paths.mcpFile);
          }
        } else {
          edited.push({ file: paths.mcpFile, entry: MCP_KEY });
          preserved.push(paths.mcpFile);
        }
      } else {
        preserved.push(paths.mcpFile);
      }
    }
    return { agentId: "codex", removed, preserved, edited, conflicts, deleted };
  },

  readMcpFingerprint(rt: Runtime): string | null {
    const mcpFile = path.join(codexHome(rt.env), MCP_FILE);
    const current = readTomlSection(mcpFile, MCP_KEY);
    return current === null ? null : sha256Hex(current);
  },
};
