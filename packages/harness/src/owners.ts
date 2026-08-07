// owners.ts — owner detection for managed files (F18, decisão aprovada:
// marcadores conhecidos + state files decidem; heurística de conteúdo só
// informa, nunca bloqueia).
//
// Evidence sources:
//   1. gentle-ai state file  ~/.gentle-ai/state.json (presence = installer owner)
//   2. gentle-ai markers     `<!-- gentle-ai:` strict pairs in managed rules files
//   3. Pi upstreams          pi-subagents/pi-taskflow/pi-goal-list-loop-audit/
//                            pi-pr-review/gentle-pi in `pi list` (scanConflicts)
//   4. MCP upstreams         any entry in host MCP configs referencing a
//                            non-runecraft package (codex-taskflow, …)
//   5. user content          managed text file without any known marker → info
//
// Scan is stateless: it runs on every command (covers "upstream installed
// after the harness" — no watcher needed, spec edge case).
import * as fs from "node:fs";
import * as path from "node:path";
import { homeDir, type Runtime } from "./config.ts";
import { type PiInterop } from "./pi.ts";
import { scanConflicts } from "./conflicts.ts";
import { ADAPTERS, SUPPORTED_AGENT_IDS } from "./adapters/registry.ts";
import { listSectionIds } from "./sections.ts";
import { readJsonConfig } from "./adapters/jsonc.ts";
import { isUpstreamMcpEntry } from "./adapters/mcpConfig.ts";
import type { AgentId } from "./adapters/types.ts";

export type OwnerKind = "installer" | "package" | "mcp" | "content";
export type OwnerSeverity = "warn" | "info";

export interface OwnerEvidence {
  name: string;
  kind: OwnerKind;
  severity: OwnerSeverity;
  detail: string;
  file?: string;
}

export interface OwnersReport {
  owners: OwnerEvidence[];
  /** owners grouped by the file they touch (for the status Owners section). */
  byFile: Record<string, OwnerEvidence[]>;
}

/** Strict open/close marker pairs with the given prefix (html family). */
function hasMarkerPrefix(file: string, prefix: string): boolean {
  return listSectionIds(file, "html", prefix).length > 0;
}

/** MCP config entries of all hosts that reference an upstream package. */
export function scanMcpUpstreams(rt: Runtime): Array<{ agent: AgentId; file: string; entry: string }> {
  const found: Array<{ agent: AgentId; file: string; entry: string }> = [];
  for (const id of SUPPORTED_AGENT_IDS) {
    const paths = ADAPTERS[id].paths(rt);
    if (!fs.existsSync(paths.mcpFile)) continue;
    if (id === "codex") {
      // config.toml: scan de TODOS os blocos [mcp_servers.<name>] — inclusive
      // seções DUPLICADAS (achado F17: o config real do usuário tem a seção
      // taskflow 2x; readTomlSection só vê a primeira). O bloco vai do header
      // até a próxima seção — args multiline não trunca a detecção.
      let text: string;
      try {
        text = fs.readFileSync(paths.mcpFile, "utf8");
      } catch {
        continue; // ilegível — check 11 reporta
      }
      const sectionRe = /^\[mcp_servers\.([^\]]+)\]$/gm;
      const nextSectionRe = /^\[/gm;
      for (const match of text.matchAll(sectionRe)) {
        const name = match[1] ?? "";
        if (!name) continue;
        const blockStart = (match.index ?? 0) + (match[0]?.length ?? 0);
        nextSectionRe.lastIndex = blockStart;
        const nextHeader = nextSectionRe.exec(text);
        const block = text.slice(blockStart, nextHeader ? nextHeader.index : text.length);
        if (isUpstreamMcpEntry(block)) {
          found.push({ agent: id, file: paths.mcpFile, entry: name });
        }
      }
      continue;
    }
    // JSON hosts: mcpServers (claude) / mcp (opencode).
    let content: Record<string, unknown>;
    try {
      content = readJsonConfig(paths.mcpFile, false).content;
    } catch {
      continue; // ilegível — check 11 reporta
    }
    const entries = (id === "claude-code"
      ? (content.mcpServers as Record<string, unknown> | undefined)
      : (content.mcp as Record<string, unknown> | undefined)) ?? {};
    for (const [name, entry] of Object.entries(entries)) {
      if (isUpstreamMcpEntry(entry)) {
        found.push({ agent: id, file: paths.mcpFile, entry: name });
      }
    }
  }
  return found;
}

/**
 * Stateless owner detection for the current environment. `pi` may be a real
 * interop or a fake (tests); the caller decides which interop to pass.
 */
export function detectOwners(rt: Runtime, pi: PiInterop): OwnersReport {
  const owners: OwnerEvidence[] = [];
  const byFile: Record<string, OwnerEvidence[]> = {};
  const add = (owner: OwnerEvidence): void => {
    owners.push(owner);
    if (owner.file) {
      (byFile[owner.file] ??= []).push(owner);
    }
  };

  // 1. gentle-ai state file (presence; unreadable = present without details).
  const gaState = path.join(homeDir(rt.env), ".gentle-ai", "state.json");
  if (fs.existsSync(gaState)) {
    add({
      name: "gentle-ai",
      kind: "installer",
      severity: "warn",
      detail: `state file presente (${gaState}) — coexiste, nunca removido`,
    });
  }

  // 2. gentle-ai markers in managed rules files (strict pairs).
  for (const id of SUPPORTED_AGENT_IDS) {
    const file = ADAPTERS[id].paths(rt).rulesFile;
    if (hasMarkerPrefix(file, "gentle-ai:")) {
      add({
        name: "gentle-ai",
        kind: "installer",
        severity: "warn",
        detail: `marcadores gentle-ai: em ${file}`,
        file,
      });
    }
  }

  // 3. Pi upstreams (two-driver — F7).
  const list = pi.list();
  if (!list.error) {
    for (const conflict of scanConflicts(list.packages)) {
      add({
        name: conflict.package,
        kind: "package",
        severity: "warn",
        detail: `instalado via pi — ${conflict.suggestion}`,
      });
    }
  }

  // 4. taskflow-MCP upstreams in host configs.
  for (const up of scanMcpUpstreams(rt)) {
    add({
      name: up.entry,
      kind: "mcp",
      severity: "warn",
      detail: `entry MCP '${up.entry}' aponta para pacote upstream em ${up.file}`,
      file: up.file,
    });
  }

  // 5. User content: managed text file without any known marker → info only.
  for (const id of SUPPORTED_AGENT_IDS) {
    const file = ADAPTERS[id].paths(rt).rulesFile;
    if (!fs.existsSync(file)) continue;
    if (hasMarkerPrefix(file, "runecraft:") || hasMarkerPrefix(file, "gentle-ai:")) continue;
    let content = "";
    try {
      content = fs.readFileSync(file, "utf8").trim();
    } catch {
      continue;
    }
    if (content.length > 0) {
      add({
        name: "usuário",
        kind: "content",
        severity: "info",
        detail: `conteúdo sem marcadores em ${file} (append-only — nunca assumido)`,
        file,
      });
    }
  }

  return { owners, byFile };
}

/** Convenience: owners with severity warn (install gate — MXST-04). */
export function warnOwners(rt: Runtime, pi: PiInterop): OwnerEvidence[] {
  return detectOwners(rt, pi).owners.filter((o) => o.severity === "warn");
}
