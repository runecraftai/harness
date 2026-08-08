// adapters/copilot.ts — Copilot (VS Code) adapter (F31 D1/D2/D3/D6/D7).
//
// Rules → <workspace>/.github/copilot-instructions.md (marker section
// `runecraft:workflow`, família html F18 — repo-scoped: o VS Code aplica o
// arquivo a TODOS os requests de chat; docs verificadas no design D2).
// MCP → <workspace>/.vscode/mcp.json (servers.taskflow; schema VS Code
// verificado: `{"servers": {<nome>: {type: "stdio", command, args?, env?}}}`;
// o Agent Host NÃO lê o arquivo diretamente — o VS Code repassa os servers;
// entry SEM `${input:...}` por isso — D3/QA-5).
// Detecção (D6): bin `code`/`code-insiders` no PATH OU dirs de extensão
// `github.copilot*` sob `~/.vscode*/extensions` (homeDir via env.HOME —
// lição F15: nunca os.homedir()).
// Workspace root (D7): process.cwd() — alvos repo-level resolvidos da raiz
// onde o comando roda (determinístico em workspace temp de teste).
// Install hint: display-only (VS Code + extensão GitHub Copilot — nunca
// executado; fail-closed F15 ADPT-02).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { homeDir, type Runtime } from "../config.ts";
import { resolveBinaryOnPath } from "./shell.ts";
import { removeSection, upsertSection, RULES_SECTION } from "./rules.ts";
import { readJsonConfig, upsertJsonKey, removeJsonKey } from "./jsonc.ts";
import { renderMcpEntry, sha256Hex } from "./mcpConfig.ts";
import type { AgentAdapter, AgentContext, DetectResult, HostPaths, InjectResult, RemoveResult } from "./types.ts";

const MCP_FILE = ".vscode/mcp.json";
const MCP_KEY = "taskflow";
const RULES_FILE = path.join(".github", "copilot-instructions.md");

/** Sufixos de dirs de extensão do VS Code sob o HOME (D6 — cobre
 *  ~/.vscode, ~/.vscode-insiders, ~/.vscode-server, ~/.vscode-exploration). */
const VSCODE_EXTENSION_SUFFIXES = ["", "-insiders", "-server", "-exploration"];

/** Raiz do workspace (QA-4a: cwd — o harness roda na raiz do repo). */
export function workspaceRoot(rt: Runtime): string {
  return rt.cwd;
}

export function copilotPaths(rt: Runtime): HostPaths {
  const ws = workspaceRoot(rt);
  return {
    rulesFile: path.join(ws, RULES_FILE),
    mcpFile: path.join(ws, MCP_FILE),
    mcpKey: MCP_KEY,
    configHome: path.join(ws, ".vscode"),
  };
}

/** Dirs de extensão do VS Code candidatos (env.HOME — lição F15). */
export function vsCodeExtensionRoots(env: NodeJS.ProcessEnv): string[] {
  const home = homeDir(env);
  return VSCODE_EXTENSION_SUFFIXES.map((suffix) => path.join(home, `.vscode${suffix}`, "extensions"));
}

/**
 * Extensão do Copilot instalada? Glob de dirs de extensão `github.copilot*`
 * (D6): o sinal REAL do Copilot é a extensão (o CLI `code` nem sempre está
 * no PATH — shell command opcional do VS Code). Retorna o dir da extensão
 * ou undefined. Síncrono (doctor/status são read-only — LIFE-01).
 */
export function findCopilotExtension(env: NodeJS.ProcessEnv): string | undefined {
  for (const root of vsCodeExtensionRoots(env)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue; // dir ausente/ilegível — próximo candidato
    }
    const match = entries.find((e) => e.startsWith("github.copilot"));
    if (match) return path.join(root, match);
  }
  return undefined;
}

export interface CopilotSyncDetection {
  installed: boolean;
  /** bin `code`/`code-insiders` resolvido (quando a detecção foi por bin). */
  binPath?: string;
  /** dir da extensão github.copilot* (quando a detecção foi por extensão). */
  extensionDir?: string;
  reasons: string[];
}

/** `command -v <bin>` síncrono (doctor/status — mesmo padrão do doctor.ts). */
function binOnPath(env: NodeJS.ProcessEnv, bin: string): string | undefined {
  try {
    const out = execFileSync("sh", ["-c", `command -v ${bin} 2>/dev/null`], {
      env: env as Record<string, string>,
      timeout: 5_000,
      encoding: "utf8",
    });
    const p = out.trim().split(/\r?\n/)[0] ?? "";
    return p.length > 0 ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detecção síncrona (F31 D6) — compartilhada pelo doctor (check 21) e status
 * (coluna copilot): bin `code`/`code-insiders` OU extensão github.copilot*.
 * Ausente → installed: false + reasons com hint display-only.
 */
export function detectCopilotSync(env: NodeJS.ProcessEnv): CopilotSyncDetection {
  const binPath = binOnPath(env, "code") ?? binOnPath(env, "code-insiders");
  if (binPath) return { installed: true, binPath, reasons: [] };
  const extensionDir = findCopilotExtension(env);
  if (extensionDir) return { installed: true, extensionDir, reasons: [] };
  return {
    installed: false,
    reasons: [
      "VS Code com a extensão GitHub Copilot não detectado (sem bin 'code'/'code-insiders' no PATH nem dir de extensão github.copilot* em ~/.vscode*/extensions)",
    ],
  };
}

export const copilotAdapter: AgentAdapter = {
  id: "copilot",
  bin: "code",
  installHint: "instale o VS Code (https://code.visualstudio.com) + a extensão GitHub Copilot (https://marketplace.visualstudio.com/items?itemName=GitHub.copilot)",

  async detect(rt: Runtime): Promise<DetectResult> {
    const binPath =
      (await resolveBinaryOnPath("code", rt.env)) ?? (await resolveBinaryOnPath("code-insiders", rt.env));
    const configHome = copilotPaths(rt).configHome;
    if (binPath) return { installed: true, binPath, configHome, reasons: [] };
    const extensionDir = findCopilotExtension(rt.env);
    if (extensionDir) return { installed: true, configHome, reasons: [] };
    return {
      installed: false,
      configHome,
      reasons: [
        `VS Code com a extensão GitHub Copilot não detectado (sem bin 'code'/'code-insiders' no PATH nem dir de extensão github.copilot* em ~/.vscode*/extensions). Instale com: ${copilotAdapter.installHint} (display-only — o harness nunca instala runtimes).`,
      ],
    };
  },

  paths(rt: Runtime): HostPaths {
    return copilotPaths(rt);
  },

  async inject(ctx: AgentContext): Promise<InjectResult> {
    const paths = copilotPaths(ctx.rt);
    const written: string[] = [];
    const conflicts: InjectResult["conflicts"] = [];

    // Rules: marker section (append/upsert, idempotente). F19 D7:
    // preserveRules (rules editada pelo usuário no sync) → nunca reescreve.
    const rules = ctx.preserveRules
      ? { changed: false, created: false, replaced: false }
      : upsertSection(paths.rulesFile, RULES_SECTION, ctx.rulesContent);
    if (rules.changed) written.push(paths.rulesFile);

    // MCP: upsert servers.taskflow only when absent or registered as ours
    // (F15 D5 — entry estrangeira é reportada, nunca sobrescrita).
    const entry = renderMcpEntry("copilot", ctx) as Record<string, unknown>;
    const cfg = fs.existsSync(paths.mcpFile)
      ? readJsonConfig(paths.mcpFile, false)
      : { file: paths.mcpFile, existed: false, indent: "  ", content: {} };
    const servers = cfg.content.servers as Record<string, unknown> | undefined;
    const existing = servers?.[MCP_KEY];
    const registeredMcp = ctx.targets?.find((t) => t.kind === "mcp" && t.entry === MCP_KEY);
    if (existing !== undefined && registeredMcp) {
      // registrada como nossa (D5-b) → reescreve no lugar (rerun idempotente).
      const up = upsertJsonKey(paths.mcpFile, ["servers", MCP_KEY], entry);
      if (up.changed) written.push(paths.mcpFile);
    } else if (existing !== undefined) {
      conflicts.push({
        file: paths.mcpFile,
        entry: MCP_KEY,
        reason: "entry MCP existente não registrada no state (possível upstream ou configuração manual) — não sobrescrita",
      });
    } else {
      const up = upsertJsonKey(paths.mcpFile, ["servers", MCP_KEY], entry, true);
      if (up.changed) written.push(paths.mcpFile);
    }
    return { agentId: "copilot", written, conflicts };
  },

  async remove(ctx: AgentContext): Promise<RemoveResult> {
    const paths = copilotPaths(ctx.rt);
    const removed: string[] = [];
    const preserved: string[] = [];
    const edited: RemoveResult["edited"] = [];
    const conflicts: RemoveResult["conflicts"] = [];
    const deleted: string[] = [];

    // Rules section (F18 — remove só o bloco runecraft:workflow).
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
      const cfg = readJsonConfig(paths.mcpFile, false);
      const servers = cfg.content.servers as Record<string, unknown> | undefined;
      const current = servers?.[MCP_KEY];
      if (current !== undefined) {
        if (target.contentHash === sha256Hex(JSON.stringify(current))) {
          removeJsonKey(paths.mcpFile, ["servers", MCP_KEY]);
          removed.push(paths.mcpFile);
          // Arquivo vazio → delete (D6): `{}` ou `{"servers": {}}`.
          const after = readJsonConfig(paths.mcpFile, false);
          const serversAfter = after.content.servers as Record<string, unknown> | undefined;
          if (
            Object.keys(after.content).length === 0 ||
            (Object.keys(after.content).length === 1 && serversAfter && Object.keys(serversAfter).length === 0)
          ) {
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
    return { agentId: "copilot", removed, preserved, edited, conflicts, deleted };
  },

  readMcpFingerprint(rt: Runtime): string | null {
    const current = readCopilotMcpEntry(copilotPaths(rt).mcpFile);
    return current === undefined ? null : sha256Hex(JSON.stringify(current));
  },

  readMcpEntry(rt: Runtime): unknown {
    return readCopilotMcpEntry(copilotPaths(rt).mcpFile) ?? null;
  },
};

/** Read the current servers.taskflow entry value; undefined when absent. */
function readCopilotMcpEntry(mcpFile: string): unknown {
  if (!fs.existsSync(mcpFile)) return undefined;
  const cfg = readJsonConfig(mcpFile, false);
  const servers = cfg.content.servers as Record<string, unknown> | undefined;
  return servers?.[MCP_KEY];
}
