// adapters/opencode.ts — OpenCode adapter (F15 D5/D6).
//
// Rules → <cfg>/AGENTS.md (marker section). MCP → <cfg>/opencode.json
// (mcp.taskflow, deep-merged ONLY at that key + skills.paths). XDG-aware:
// $XDG_CONFIG_HOME/opencode when absolute, else ~/.config/opencode.
// Install hint: official installer (validated against opencode.ai/docs 2026-08-07).
import * as fs from "node:fs";
import * as path from "node:path";
import { opencodeHome, type Runtime } from "../config.ts";
import { resolveBinaryOnPath } from "./shell.ts";
import { removeSection, upsertSection, RULES_SECTION } from "./rules.ts";
import { readJsonConfig, upsertJsonKey, removeJsonKey } from "./jsonc.ts";
import { sha256Hex } from "./mcpConfig.ts";
import type { AgentAdapter, AgentContext, DetectResult, HostPaths, InjectResult, RemoveResult } from "./types.ts";

const MCP_FILE = "opencode.json";
const MCP_KEY = "taskflow";

export const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  bin: "opencode",
  installHint: "curl -fsSL https://opencode.ai/install | bash",

  async detect(rt: Runtime): Promise<DetectResult> {
    const binPath = await resolveBinaryOnPath("opencode", rt.env);
    const configHome = opencodeHome(rt.env);
    if (binPath) return { installed: true, binPath, configHome, reasons: [] };
    return {
      installed: false,
      configHome,
      reasons: [`comando 'opencode' não encontrado no PATH — instale com: ${opencodeAdapter.installHint}`],
    };
  },

  paths(rt: Runtime): HostPaths {
    const configHome = opencodeHome(rt.env);
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

    // MCP: deep merge only at mcp.taskflow; conflict rule like claude (D5).
    const entry = {
      type: "local",
      command: ctx.mcpBinCommand ?? ["node", ctx.mcpBin],
      enabled: true,
    };
    const cfg = fs.existsSync(paths.mcpFile) ? readJsonConfig(paths.mcpFile, false) : { file: paths.mcpFile, existed: false, indent: "  ", content: {} };
    const mcp = cfg.content.mcp as Record<string, unknown> | undefined;
    const existing = mcp?.[MCP_KEY];
    const registeredMcp = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (existing !== undefined && registeredMcp && registeredMcp.contentHash === sha256Hex(JSON.stringify(existing))) {
      const up = upsertJsonKey(paths.mcpFile, ["mcp", MCP_KEY], entry);
      if (up.changed) written.push(paths.mcpFile);
    } else if (existing !== undefined) {
      conflicts.push({ file: paths.mcpFile, entry: MCP_KEY, reason: "entry MCP existente não registrada no state — não sobrescrita" });
    } else {
      const up = upsertJsonKey(paths.mcpFile, ["mcp", MCP_KEY], entry, true);
      if (up.changed) written.push(paths.mcpFile);
    }
    // skills.paths — only when the fork ships a skills dir (F16 D6 opencode).
    if (ctx.mcpEnvironment?.skillsPaths) {
      const cfg2 = fs.existsSync(paths.mcpFile) ? readJsonConfig(paths.mcpFile, false) : { file: paths.mcpFile, existed: false, indent: "  ", content: {} };
      const pathsEntry = cfg2.content.skills as { paths?: unknown } | undefined;
      const current = Array.isArray(pathsEntry?.paths) ? (pathsEntry.paths as string[]) : [];
      if (!current.includes(ctx.mcpEnvironment.skillsPaths)) {
        upsertJsonKey(paths.mcpFile, ["skills", "paths"], [...current, ctx.mcpEnvironment.skillsPaths]);
        written.push(paths.mcpFile);
      }
    }
    return { agentId: "opencode", written, conflicts };
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
      const cfg = readJsonConfig(paths.mcpFile, false);
      const mcp = cfg.content.mcp as Record<string, unknown> | undefined;
      const current = mcp?.[MCP_KEY];
      if (current !== undefined) {
        if (target.contentHash === sha256Hex(JSON.stringify(current))) {
          removeJsonKey(paths.mcpFile, ["mcp", MCP_KEY]);
          removed.push(paths.mcpFile);
          const after = readJsonConfig(paths.mcpFile, false);
          const mcp = after.content.mcp as Record<string, unknown> | undefined;
          if (Object.keys(after.content).length === 0 || (Object.keys(after.content).length === 1 && mcp && Object.keys(mcp).length === 0)) {
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
    return { agentId: "opencode", removed, preserved, edited, conflicts, deleted };
  },

  readMcpFingerprint(rt: Runtime): string | null {
    const paths = opencodeHome(rt.env);
    const mcpFile = path.join(paths, MCP_FILE);
    if (!fs.existsSync(mcpFile)) return null;
    const cfg = readJsonConfig(mcpFile, false);
    const mcp = cfg.content.mcp as Record<string, unknown> | undefined;
    const current = mcp?.[MCP_KEY];
    return current === undefined ? null : sha256Hex(JSON.stringify(current));
  },
};
