// adapters/jsonc.ts — minimal JSON config upsert helpers (F15).
//
// Deep-merge only at the target key path; the rest of the file is preserved.
// Re-stringify with the file's detected indentation (2/4/tabs). Used by the
// claude (.mcp.json) and opencode (opencode.json) adapters.
import * as fs from "node:fs";
import * as path from "node:path";

export class InvalidJsonError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`config JSON inválida em ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.file = file;
  }
}

export interface JsonFile {
  file: string;
  existed: boolean;
  indent: string;
  content: Record<string, unknown>;
}

export function readJsonConfig(file: string, createMissing: boolean): JsonFile {
  let existed = true;
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    existed = false;
    if (!createMissing) throw new InvalidJsonError(file, "arquivo não encontrado");
  }
  const indent = existed ? detectIndent(raw) : "  ";
  let content: Record<string, unknown>;
  try {
    const parsed: unknown = existed ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new InvalidJsonError(file, "raiz não é objeto");
    }
    content = parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof InvalidJsonError) throw e;
    throw new InvalidJsonError(file, e);
  }
  return { file, existed, indent, content };
}

export interface JsonUpsertResult {
  changed: boolean;
  /** true when the target key existed before (replaced in place). */
  replaced: boolean;
  /** true when the file was created from scratch. */
  created: boolean;
}

/**
 * Deep-merge `patch` at `keyPath` (e.g. ["mcpServers","taskflow"]). Other keys
 * of the file are preserved. Writes with the file's own indentation + trailing
 * newline. Returns {changed:false} when the target already equals the patch
 * (idempotent rerun).
 */
export function upsertJsonKey(
  file: string,
  keyPath: string[],
  patch: unknown,
  createMissing = true,
): JsonUpsertResult {
  const cfg = readJsonConfig(file, createMissing);
  let cursor: Record<string, unknown> = cfg.content;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const seg = keyPath[i]!;
    const next = cursor[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[seg] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  const last = keyPath[keyPath.length - 1]!;
  const existing = cursor[last];
  const replaced = existing !== undefined;
  if (JSON.stringify(existing) === JSON.stringify(patch)) {
    return { changed: false, replaced, created: !cfg.existed };
  }
  cursor[last] = patch;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg.content, null, cfg.indent)}\n`, "utf8");
  return { changed: true, replaced, created: !cfg.existed };
}

/** Remove the key at keyPath; returns true when it existed. */
export function removeJsonKey(file: string, keyPath: string[]): boolean {
  if (!fs.existsSync(file)) return false;
  const cfg = readJsonConfig(file, false);
  let cursor: Record<string, unknown> = cfg.content;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const next = cursor[keyPath[i]!];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    cursor = next as Record<string, unknown>;
  }
  const last = keyPath[keyPath.length - 1]!;
  if (!(last in cursor)) return false;
  delete cursor[last];
  fs.writeFileSync(file, `${JSON.stringify(cfg.content, null, cfg.indent)}\n`, "utf8");
  return true;
}

function detectIndent(raw: string): string {
  const line = raw.split("\n").find((l) => /^[\t ]+/.test(l));
  if (!line) return "  ";
  const leading = line.match(/^[\t ]+/)?.[0] ?? "  ";
  return leading;
}
