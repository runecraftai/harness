// adapters/mcpConfig.ts — taskflow MCP entry rendering for non-Pi hosts (F15 D4/D6).
//
// resolveMcpBin(): env override > local fork path (dev, via require.resolve) >
// npx pin of the published @runecraft/taskflow-<host> (publish; pin from
// versions.ts). Guard anti-upstream (F16 AC 4.2): a resolved command that
// references upstream package names is a template error — never injected.
import { createRequire } from "node:module";
import * as path from "node:path";
import { HARNESS_VERSIONS } from "../versions.ts";
import type { Runtime } from "../config.ts";

/**
 * Guard anti-upstream (F16 AC 4.2): rejects rendered commands that reference
 * UNMANAGED upstream packages. A `npx -p <spec>` pin is upstream unless the
 * spec starts with `@runecraft/`; a path is upstream when it points into a
 * node_modules dir of a bare upstream package name (codex-taskflow,
 * taskflow-mcp-core, …). The fork's OWN bin names (`claude-taskflow-mcp`) are
 * preserved by design (F16 D4) and are NOT upstream references.
 */
const UPSTREAM_PACKAGE_NAMES = [
  "codex-taskflow",
  "claude-taskflow",
  "opencode-taskflow",
  "grok-taskflow",
  "taskflow-mcp-core",
  "taskflow-hosts",
  "taskflow-core",
  "pi-taskflow",
];

export class UpstreamReferenceError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`comando MCP referencia pacote upstream não gerenciado: ${command}`);
    this.command = command;
  }
}

export interface McpBinResolution {
  /** full command: [bin, ...args] (e.g. ["node", "<abs>/dist/mcp/bin.js"]). */
  command: string[];
  /** how it was resolved (for diagnostics). */
  source: "env" | "dev" | "publish";
}

/**
 * Resolve the taskflow MCP bin for a host (F15 D4):
 * 1. RUNECRAFT_TASKFLOW_<HOST>_BIN env override (fixtures, power users);
 * 2. dev: require.resolve("@runecraft/taskflow-<host>/package.json") →
 *    dist/mcp/bin.js (monorepo);
 * 3. publish: npx -y -p @runecraft/taskflow-<host>@<pin> <host>-taskflow-mcp.
 * The command always starts with the fork's bin — the guard rejects upstream
 * references that could sneak in through a broken resolution.
 */
export function resolveMcpBin(host: string, rt: Runtime): McpBinResolution {
  const envKey = `RUNECRAFT_TASKFLOW_${host.toUpperCase()}_BIN`;
  const envBin = rt.env[envKey];
  if (envBin) {
    const command = [envBin];
    assertNoUpstream(command);
    return { command, source: "env" };
  }
  const pkgName = `@runecraft/taskflow-${host}`;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const binPath = path.join(path.dirname(pkgJson), "dist", "mcp", "bin.js");
    if (binPath) {
      const command = ["node", binPath];
      assertNoUpstream(command);
      return { command, source: "dev" };
    }
  } catch {
    // fall through to the publish form
  }
  const pin = HARNESS_VERSIONS[pkgName] ?? "0.2.6";
  const command = ["npx", "-y", "-p", `${pkgName}@${pin}`, `${host}-taskflow-mcp`];
  assertNoUpstream(command);
  return { command, source: "publish" };
}

function assertNoUpstream(command: string[]): void {
  const joined = command.join(" ");
  // 1. npx spec pins: every `-p <spec>` must be @runecraft/*.
  const npxSpec = /(?:^|\s)-p\s+(\S+)/g;
  for (const match of joined.matchAll(npxSpec)) {
    const spec = match[1] ?? "";
    if (!spec.startsWith("@runecraft/")) throw new UpstreamReferenceError(joined);
  }
  // 2. Paths into upstream package dirs (node_modules/<bare-name>).
  for (const name of UPSTREAM_PACKAGE_NAMES) {
    if (new RegExp(`(?:^|[\\/])${name}(?:[\\/]|$)`).test(joined) && !joined.includes(`@runecraft/${name}`)) {
      throw new UpstreamReferenceError(joined);
    }
  }
}

/**
 * True when a command array references an upstream (non-runecraft) package
 * (F17 D3 check 10 — MCP collision warn; F18 owns the full detection).
 * Same rule as the inject-time guard, without throwing.
 */
export function isUpstreamCommand(command: string[]): boolean {
  try {
    assertNoUpstream(command);
    return false;
  } catch {
    return true;
  }
}

/**
 * True when an MCP entry references an upstream package. Accepts both shapes:
 * JSON hosts ({ command: string|string[], args? }) and the codex TOML block
 * (raw string with a `command = "..."` line).
 */
export function isUpstreamMcpEntry(entry: unknown): boolean {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    const command = record.command;
    if (typeof command === "string") {
      const args = Array.isArray(record.args) ? record.args.map(String) : [];
      return isUpstreamCommand([command, ...args]);
    }
    if (Array.isArray(command)) return isUpstreamCommand(command.map(String));
    return false;
  }
  if (typeof entry === "string") {
    const cmdMatch = /(?:^|\n)command\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(entry);
    const cmd = cmdMatch ? (cmdMatch[1] ?? cmdMatch[2] ?? "") : "";
    if (!cmd) return false;
    const argsMatch = /(?:^|\n)args\s*=\s*\[([^\]]*)\]/.exec(entry);
    const args = argsMatch
      ? (argsMatch[1] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""))
          .filter(Boolean)
      : [];
    return isUpstreamCommand([cmd, ...args]);
  }
  return false;
}

/** Canonical entry fingerprint (F17 D2): the command/args JSON, normalized. */
export function mcpEntryContentHash(command: string[], environment?: Record<string, string>): string {
  const canonical = JSON.stringify({ command, ...(environment ? { environment } : {}) });
  return sha256Hex(canonical);
}

export function sha256Hex(input: string): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(input).digest("hex");
}
