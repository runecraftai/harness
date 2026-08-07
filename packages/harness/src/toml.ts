// toml.ts — minimal [mcp_servers.taskflow] upsert for codex config.toml (F15).
//
// Zero runtime deps (F11). Operates ONLY on the `[mcp_servers.taskflow]`
// block: renders basic-string values (command/args/environment), preserves
// every other section byte for byte. Strings with quotes/backslashes are
// escaped as TOML basic strings. Validation smoke test uses a TOML parser as
// devDep (F15 Riscos).
import * as fs from "node:fs";
import * as path from "node:path";

export function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function tomlArray(values: string[]): string {
  return `[${values.map(tomlBasicString).join(", ")}]`;
}

/** Render the BODY of the `[mcp_servers.<entry>]` block (keys canonical order).
 *  The `[mcp_servers.<entry>]` header is added by upsertTomlSection. */
export function renderMcpServerBlock(
  entry: string,
  command: string[],
  extra: Record<string, string | number | string[]> = {},
): string {
  void entry;
  const lines: string[] = [];
  lines.push(`command = ${tomlBasicString(command[0] ?? "")}`);
  if (command.length > 1) lines.push(`args = ${tomlArray(command.slice(1))}`);
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "number") lines.push(`${key} = ${value}`);
    else if (Array.isArray(value)) lines.push(`${key} = ${tomlArray(value)}`);
    else lines.push(`${key} = ${tomlBasicString(value)}`);
  }
  return lines.join("\n");
}

export interface TomlUpsertResult {
  changed: boolean;
  /** true when the target [section] block was replaced (not appended). */
  replaced: boolean;
}

/**
 * Upsert the `[mcp_servers.<entry>]` block in a TOML file.
 * - File missing → created with the block.
 * - Block present → replaced in place (regex-anchored to the section header).
 * - Other sections/comments → preserved byte for byte.
 * Returns the new content, or null when the file does not exist (caller
 * decides creation). `createMissing` renders the file when absent.
 */
export function upsertTomlSection(
  file: string,
  entry: string,
  blockBody: string,
  createMissing: boolean,
): { next: string; changed: boolean; replaced: boolean } | null {
  let existed = true;
  let original = "";
  try {
    original = fs.readFileSync(file, "utf8");
  } catch {
    existed = false;
    if (!createMissing) return null;
  }
  const header = `[mcp_servers.${entry}]`;
  // Match the header line, then every following line that does not start a new
  // top-level `[section]` (block body = key/value lines, possibly indented).
  const blockPattern = new RegExp(`^${escapeRegExp(header)}[^\\n]*(?:\\n(?:[^\\[].*)?)*`, "m");
  const replacement = `${header}\n${blockBody}`;
  const existedBlock = blockPattern.test(original);
  const next = existedBlock
    ? original.replace(blockPattern, replacement)
    : `${original.replace(/\s*$/, "")}\n\n${replacement}\n`;
  const changed = next !== original;
  if (changed || !existed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, "utf8");
  }
  return { next, changed, replaced: existedBlock };
}

/** Read a TOML section's raw text (for diff/validation); null when absent. */
export function readTomlSection(file: string, entry: string): string | null {
  if (!fs.existsSync(file)) return null;
  const original = fs.readFileSync(file, "utf8");
  const header = `[mcp_servers.${entry}]`;
  const blockPattern = new RegExp(`^${escapeRegExp(header)}[^\\n]*(?:\\n(?:[^\\[].*)?)*`, "m");
  const match = original.match(blockPattern);
  return match ? match[0] : null;
}

/** Remove the section block (header + body lines); returns the new content
 *  (unchanged when absent). Uses the same line-anchored pattern as the upsert
 *  so blocks containing `[` inside arrays are NOT truncated (fix F15 review). */
export function removeTomlSection(file: string, entry: string): string | null {
  if (!fs.existsSync(file)) return null;
  const original = fs.readFileSync(file, "utf8");
  const header = `[mcp_servers.${entry}]`;
  const blockPattern = new RegExp(`^${escapeRegExp(header)}[^\\n]*(?:\\n(?:[^\\[].*)?)*`, "m");
  if (!blockPattern.test(original)) return null;
  return original.replace(blockPattern, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
