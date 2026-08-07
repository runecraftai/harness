// sections.ts — marker-section engine (F18, motor de seções).
//
// One engine for every marker family: text files (CLAUDE.md/AGENTS.md) use
// HTML comments `<!-- runecraft:<id> -->`; executable files (F20 git hooks)
// use shell comments `# BEGIN runecraft:<id>` / `# END runecraft:<id>` (an
// HTML comment would break the shell). The family is selected by the target
// file type; id, operations (insert/update/remove), contentHash and encoding
// rules are identical across families.
//
// Rules (design F18): insert = append (never touches other owners' content);
// update = replace only the body between same-id markers; remove = only
// runecraft: blocks; idempotent rerun; BOM preserved, CRLF detected, non-UTF8
// files abort (never corrupt). Content without markers is never claimed.
import * as fs from "node:fs";
import * as path from "node:path";

export type SectionFamily = "html" | "shell";

export interface SectionMarkers {
  open: string;
  close: string;
}

/** Marker strings per family (the id already carries the prefix, e.g. `runecraft:workflow`). */
export function markersFor(family: SectionFamily, id: string): SectionMarkers {
  if (family === "shell") {
    return { open: `# BEGIN ${id}`, close: `# END ${id}` };
  }
  return { open: `<!-- ${id} -->`, close: `<!-- /${id} -->` };
}

/** Detect the file's line ending: CRLF when any \r\n present, else \n. */
export function detectEol(buffer: Buffer): "\r\n" | "\n" {
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  return sample.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
}

export function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

/** True when the buffer decodes as UTF-8 without replacement chars. */
export function isValidUtf8(buffer: Buffer): boolean {
  const decoded = buffer.toString("utf8");
  return !decoded.includes("\ufffd");
}

/** Result of a section upsert. */
export interface SectionUpsertResult {
  /** true when the file was written (created or changed). */
  changed: boolean;
  /** true when the file was created from scratch. */
  created: boolean;
  /** true when an existing runecraft section was replaced in place. */
  replaced: boolean;
}

export class NonUtf8FileError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`arquivo não é UTF-8 legível: ${file}`);
    this.file = file;
  }
}

/**
 * Upsert a `runecraft:<id>` block into `file` using the marker family.
 * - File missing → created with the section (parent dirs created).
 * - File with user/other-owner content → section appended at the end (content intact).
 * - Section present → body replaced in place (rerun never duplicates; same id
 *   across CLI versions updates in place — MXST edge).
 * Throws NonUtf8FileError when the file is not valid UTF-8 (target aborts).
 */
export function upsertSectionFamily(file: string, id: string, content: string, family: SectionFamily): SectionUpsertResult {
  const markers = markersFor(family, id);
  let original: Buffer;
  let existed = true;
  try {
    original = fs.readFileSync(file);
  } catch {
    existed = false;
    original = Buffer.alloc(0);
  }
  if (existed && !isValidUtf8(original)) throw new NonUtf8FileError(file);
  const eol = existed ? detectEol(original) : "\n";
  const bom = existed && hasUtf8Bom(original);
  const text = original.toString("utf8");
  // Strip the BOM for matching; re-added on write.
  const body = bom ? text.slice(1) : text;
  const block = `${markers.open}${eol}${content}${eol}${markers.close}`;

  const openIdx = body.indexOf(markers.open);
  const closeIdx = openIdx >= 0 ? body.indexOf(markers.close, openIdx + markers.open.length) : -1;
  let next: string;
  let replaced = false;
  if (openIdx >= 0 && closeIdx >= 0) {
    // Replace the section body, preserving the surrounding content byte for byte.
    next = body.slice(0, openIdx) + block + body.slice(closeIdx + markers.close.length);
    replaced = true;
  } else {
    const hasContent = body.trim().length > 0;
    next = hasContent ? `${body.replace(/\s+$/, "")}${eol}${eol}${block}${eol}` : block + eol;
  }
  const out = (bom ? "\ufeff" : "") + next;
  if (existed && out === text) return { changed: false, created: false, replaced };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out, "utf8");
  return { changed: true, created: !existed, replaced };
}

/**
 * Remove the `runecraft:<id>` block. Returns the new file content, or null
 * when the section was not present. Collapses residual whitespace only at the
 * removal point (D6 — nothing beyond the markers).
 */
export function removeSectionFamily(file: string, id: string, family: SectionFamily): string | null {
  if (!fs.existsSync(file)) return null;
  const original = fs.readFileSync(file);
  if (!isValidUtf8(original)) throw new NonUtf8FileError(file);
  const bom = hasUtf8Bom(original);
  const body = bom ? original.toString("utf8").slice(1) : original.toString("utf8");
  const markers = markersFor(family, id);
  const openIdx = body.indexOf(markers.open);
  if (openIdx < 0) return null;
  const closeIdx = body.indexOf(markers.close, openIdx + markers.open.length);
  if (closeIdx < 0) return null; // dangling open marker — not ours to guess
  const eol = detectEol(original);
  const eolRe = eol === "\r\n" ? "\\r\\n" : "\\n";
  // Remove o bloco (open..close inclusive). Colapsa whitespace APENAS no
  // ponto de remoção: no máximo 2 eols consecutivos (D6 — nada além disso;
  // conteúdo do usuário em outras regiões fica byte a byte).
  let next = body.slice(0, openIdx) + body.slice(closeIdx + markers.close.length);
  const junction = openIdx; // posição da junção no conteúdo novo (prefixo inalterado)
  const prefix = next.slice(0, junction);
  const suffix = next.slice(junction);
  // Sufixo: se começa com 3+ eols (resíduo do separador da seção + conteúdo),
  // colapsa para 2; prefixo: idem se termina com 3+ eols.
  const suffixCollapsed = suffix.replace(new RegExp(`^${eolRe}{3,}`), `${eol}${eol}`);
  const prefixCollapsed = prefix.replace(new RegExp(`${eolRe}{3,}$`), `${eol}${eol}`);
  next = prefixCollapsed + suffixCollapsed;
  // Eol único no fim do arquivo (a seção era o último bloco) — sem acumular
  // eols residuais.
  next = next.replace(new RegExp(`${eolRe}+$`), eol);
  return (bom ? "\ufeff" : "") + next;
}

/**
 * Read-only presence check (F17 D3 check 9): does `file` contain the marker
 * section? Never writes. Missing file / non-UTF8 / dangling marker → false.
 */
export function hasSectionFamily(file: string, id: string, family: SectionFamily): boolean {
  if (!fs.existsSync(file)) return false;
  let original: Buffer;
  try {
    original = fs.readFileSync(file);
  } catch {
    return false;
  }
  if (!isValidUtf8(original)) return false;
  const bom = hasUtf8Bom(original);
  const body = bom ? original.toString("utf8").slice(1) : original.toString("utf8");
  const markers = markersFor(family, id);
  const openIdx = body.indexOf(markers.open);
  if (openIdx < 0) return false;
  return body.indexOf(markers.close, openIdx + markers.open.length) >= 0;
}

/**
 * List ids of complete `runecraft:` blocks present in the file (F18 uninstall:
 * a marker without a state registration is preserved and reported, never
 * removed — conservative mode). Strict open/close pair per id.
 */
export function listSectionIds(file: string, family: SectionFamily, prefix = "runecraft:"): string[] {
  if (!fs.existsSync(file)) return [];
  const original = fs.readFileSync(file);
  if (!isValidUtf8(original)) return [];
  const body = (hasUtf8Bom(original) ? original.toString("utf8").slice(1) : original.toString("utf8"));
  const ids: string[] = [];
  const openRe =
    family === "shell"
      ? new RegExp(`^# BEGIN (${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z0-9-]+)\\s*$`, "gm")
      : new RegExp(`^<!-- (${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z0-9-]+) -->\\s*$`, "gm");
  const closeOf = (id: string): string => markersFor(family, id).close;
  for (const match of body.matchAll(openRe)) {
    const id = match[1] ?? "";
    if (!id) continue;
    const closeIdx = body.indexOf(closeOf(id), (match.index ?? 0) + (match[0]?.length ?? 0));
    if (closeIdx >= 0) ids.push(id);
  }
  return ids;
}
