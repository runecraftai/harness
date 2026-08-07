// backup.ts — pre-write snapshot engine (F13, STBK-04..07).
//
// Before any modification the harness snapshots the config files the operation
// will touch into `<scope backups dir>/runecraft-<YYYYMMDD-HHmmss-ms>.tar.gz`
// (STBK-04). Zero runtime deps: hand-rolled ustar writer + reader + node:zlib.
//
// Engine rules (design F13):
//   - manifest interno paths.json: { schemaVersion, createdAt, scope, reason,
//     files (originais), hash (conteúdo) } — restore escreve nos paths originais
//   - dedupe (STBK-05): hash do conteúdo (path completo + bytes); snapshot
//     idêntico a um existente não é reescrito — o existente é reutilizado
//   - prune (STBK-06): mantém os 5 mais recentes por createdAt; pinados
//     (pins.json) nunca são pruned
//   - fail-safe (STBK-07): checa espaço livre no dir (statvfs, threshold
//     50 MB) antes de escrever; falha → throw (caller aborta antes de modificar)
//   - symlinks preservados como symlinks, não seguidos/expandidos (edge F13)
//   - state.json NUNCA é snapshotted: estado é bookkeeping do harness, não
//     config do usuário (edge F13)
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { Scope } from "./config.ts";

/** Fail-safe free-space threshold for the backups dir (design F12/F13: 50 MB). */
export const BACKUP_MIN_FREE_BYTES = 50 * 1024 * 1024;

/** Snapshot file name prefix (design F13). */
export const SNAPSHOT_PREFIX = "runecraft-";

/** pins.json — snapshots pinned against prune (design F13). */
export const PINS_FILE = "pins.json";

export interface SnapshotManifest {
  schemaVersion: 1;
  createdAt: string;
  /** scope recorded at snapshot time (design: scopes have separate dirs). */
  scope?: Scope;
  /** trigger: install | sync | uninstall | restore | manual. */
  reason?: string;
  /** absolute paths of the captured files, index-aligned with files/<n> entries. */
  files: string[];
  /** sha256 of the captured content (dedupe key). */
  hash: string;
}

export interface SnapshotResult {
  /** absolute path of the snapshot .tar.gz (existing file when deduped). */
  file: string;
  /** sha256 of the captured content (dedupe key, stable across timestamps). */
  hash: string;
  /** absolute paths captured (only existing files). */
  files: string[];
  createdAt: string;
  /** true when an identical snapshot already existed and was reused (STBK-05). */
  deduped: boolean;
}

export interface CreateSnapshotOptions {
  /** absolute paths to snapshot (only existing files are captured). */
  files: string[];
  /** destination directory (scope backups dir); created if needed. */
  destDir: string;
  now?: Date;
  /** trigger recorded in the manifest (install/sync/uninstall/restore). */
  reason?: string;
  scope?: Scope;
  /** dedupe against existing snapshots (default true, STBK-05). */
  dedupe?: boolean;
  /** prune to maxKeep after write (default true, STBK-06). */
  prune?: boolean;
  /** snapshots kept after prune (default 5). */
  maxKeep?: number;
  /** fail-safe minimum free bytes in destDir (default 50 MB, STBK-07). */
  minFreeBytes?: number;
  /** free-bytes probe (test hook; default freeBytesOnDisk). */
  freeBytes?: (dir: string) => number | null;
}

/** One captured file: regular content or symlink target (edge F13). */
interface CapturedEntry {
  path: string;
  kind: "file" | "symlink";
  content?: Buffer;
  linkTarget?: string;
}

interface TarEntry {
  type: "file" | "symlink";
  content?: Buffer;
  linkname?: string;
}

// ---------------------------------------------------------------------------
// ustar writer (zero deps)
// ---------------------------------------------------------------------------

/** Pads a Buffer to a multiple of blockSize with NULs. */
function padBlock(buf: Buffer, blockSize = 512): Buffer {
  const rem = buf.length % blockSize;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(blockSize - rem)]);
}

/** Builds one ustar header (regular file "0" or symlink "2"). */
function tarHeader(name: string, type: "file" | "symlink", size: number, mtimeSec: number, linkname?: string): Buffer {
  const header = Buffer.alloc(512);
  const nameBuf = Buffer.from(name, "utf8");
  if (nameBuf.length > 100) throw new Error(`tar: name too long: ${name}`);
  nameBuf.copy(header, 0);
  writeOctal(header, 100, 0o644, 7); // mode
  writeOctal(header, 108, 0, 7); // uid
  writeOctal(header, 116, 0, 7); // gid
  writeOctal(header, 124, size, 11); // size (octal, 11 digits + NUL)
  writeOctal(header, 136, mtimeSec, 11); // mtime
  header.write(type === "symlink" ? "2" : "0", 156, 1, "ascii"); // typeflag
  if (type === "symlink" && linkname !== undefined) {
    const target = Buffer.from(linkname, "utf8");
    if (target.length > 100) throw new Error(`tar: symlink target too long: ${linkname}`);
    target.copy(header, 157); // linkname
  }
  header.write("ustar\u000000", 257, 8, "ascii"); // magic + version
  // checksum: sum with the checksum field blanked, then written back
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i] ?? 0;
  header.write(sum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20; // space after checksum
  return header;
}

function writeOctal(header: Buffer, offset: number, value: number, fieldSize: number): void {
  const str = value.toString(8).padStart(fieldSize, "0").slice(0, fieldSize);
  header.write(str, offset, fieldSize, "ascii");
  header[offset + fieldSize] = 0; // NUL terminator
}

// ---------------------------------------------------------------------------
// capture + content hash
// ---------------------------------------------------------------------------

/** lstat each path; missing files are skipped (F11 contract), symlinks kept as symlinks. */
function capture(files: string[]): CapturedEntry[] {
  const entries: CapturedEntry[] = [];
  for (const file of files) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(file);
    } catch {
      continue; // not an error: pi may create the file during install
    }
    if (st.isSymbolicLink()) {
      entries.push({ path: file, kind: "symlink", linkTarget: fs.readlinkSync(file) });
    } else if (st.isFile()) {
      entries.push({ path: file, kind: "file", content: fs.readFileSync(file) });
    }
  }
  return entries;
}

/**
 * Content hash — the dedupe key (STBK-05). Covers the full original path +
 * content bytes (or symlink target) so identical snapshots of different scopes
 * never collide (edge F13). Stable across timestamps (unlike a hash of the tar,
 * which embeds createdAt).
 */
function contentHash(entries: CapturedEntry[]): string {
  const h = crypto.createHash("sha256");
  for (const entry of entries) {
    h.update(Buffer.from(entry.path, "utf8"));
    h.update(Buffer.from([0]));
    h.update(entry.kind === "symlink" ? Buffer.from(entry.linkTarget ?? "", "utf8") : (entry.content ?? Buffer.alloc(0)));
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

/** Builds the tar.gz: paths.json manifest + files/<n> entries (ustar, gzip). */
function buildTar(entries: CapturedEntry[], manifest: SnapshotManifest): Buffer {
  const mtimeSec = Math.floor(new Date(manifest.createdAt).getTime() / 1000);
  const chunks: Buffer[] = [];

  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  chunks.push(tarHeader("paths.json", "file", manifestBuf.length, mtimeSec));
  chunks.push(padBlock(manifestBuf));

  entries.forEach((entry, index) => {
    const name = `files/${index}`;
    if (entry.kind === "symlink") {
      chunks.push(tarHeader(name, "symlink", 0, mtimeSec, entry.linkTarget));
    } else {
      const content = entry.content ?? Buffer.alloc(0);
      chunks.push(tarHeader(name, "file", content.length, mtimeSec));
      chunks.push(padBlock(content));
    }
  });

  chunks.push(Buffer.alloc(1024)); // two zero blocks: end of archive
  return zlib.gzipSync(Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------
// ustar reader (zero deps)
// ---------------------------------------------------------------------------

function readCString(buf: Buffer, offset: number, length: number): string {
  const end = buf.indexOf(0, offset);
  const limit = end === -1 ? offset + length : end;
  return buf.subarray(offset, limit).toString("utf8");
}

function readOctal(buf: Buffer, offset: number, length: number): number {
  const raw = readCString(buf, offset, length).trim();
  if (raw === "") return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + 512; i += 1) {
    if ((buf[i] ?? 0) !== 0) return false;
  }
  return true;
}

/** Parses a tar buffer into entries by name (our own writer layout). */
export function parseTar(buf: Buffer): Map<string, TarEntry> {
  const entries = new Map<string, TarEntry>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    if (isZeroBlock(buf, offset)) break; // end of archive
    const header = buf.subarray(offset, offset + 512);
    const name = readCString(header, 0, 100);
    const size = readOctal(header, 124, 11);
    const typeflag = String.fromCharCode(header[156] ?? 0x30);
    if (typeflag === "2") {
      entries.set(name, { type: "symlink", linkname: readCString(header, 157, 100) });
    } else {
      const content = size > 0 ? Buffer.from(buf.subarray(offset + 512, offset + 512 + size)) : Buffer.alloc(0);
      entries.set(name, { type: "file", content });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// manifest + listing + pins + prune
// ---------------------------------------------------------------------------

/** Reads the paths.json manifest out of a snapshot; null when unreadable/invalid. */
export function readSnapshotManifest(file: string): SnapshotManifest | null {
  try {
    const tar = parseTar(zlib.gunzipSync(fs.readFileSync(file)));
    const manifestEntry = tar.get("paths.json");
    if (!manifestEntry || manifestEntry.type !== "file") return null;
    const raw: unknown = JSON.parse((manifestEntry.content ?? Buffer.alloc(0)).toString("utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const manifest = raw as Record<string, unknown>;
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) return null;
    const scope = manifest.scope === "global" || manifest.scope === "workspace" ? manifest.scope : undefined;
    return {
      schemaVersion: 1,
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "",
      scope,
      reason: typeof manifest.reason === "string" ? manifest.reason : undefined,
      files: manifest.files as string[],
      hash: typeof manifest.hash === "string" ? manifest.hash : "",
    };
  } catch {
    return null;
  }
}

export interface SnapshotInfo {
  name: string;
  file: string;
  createdAt: string;
  sizeBytes: number;
  scope?: Scope;
  reason?: string;
  files: string[];
  hash?: string;
  pinned: boolean;
}

/** Lists snapshots (newest first). Snapshot files without a readable manifest still appear (mtime fallback). */
export function listSnapshots(dir: string): SnapshotInfo[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return []; // dir de backups corrompido → lista vazia, sem crash
  const pinned = readPinned(dir);
  const infos: SnapshotInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".tar.gz")) continue;
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const manifest = readSnapshotManifest(file);
    infos.push({
      name,
      file,
      createdAt: manifest?.createdAt || stat.mtime.toISOString(),
      sizeBytes: stat.size,
      scope: manifest?.scope,
      reason: manifest?.reason,
      files: manifest?.files ?? [],
      hash: manifest?.hash || undefined,
      pinned: pinned.has(name),
    });
  }
  return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Finds the newest snapshot with the given content hash (STBK-05). */
function findSnapshotByHash(dir: string, hash: string): SnapshotInfo | undefined {
  if (hash === "" || !fs.existsSync(dir)) return undefined;
  return listSnapshots(dir).find((info) => info.hash === hash);
}

/** Pinned snapshot names from pins.json (missing/corrupt → empty set). */
export function readPinned(dir: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, PINS_FILE), "utf8"));
    if (typeof raw !== "object" || raw === null) return new Set();
    const pinned = (raw as { pinned?: unknown }).pinned;
    return new Set(Array.isArray(pinned) ? pinned.filter((p): p is string => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

/** Pins a snapshot against prune: `backups --keep <name>` (STBK-06). Throws when not found. */
export function pinSnapshot(dir: string, name: string): void {
  const fileName = name.endsWith(".tar.gz") ? name : `${name}.tar.gz`;
  const file = path.join(dir, fileName);
  if (!fs.existsSync(file)) throw new Error(`snapshot não encontrado: ${name}`);
  const pinned = readPinned(dir);
  pinned.add(fileName);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${PINS_FILE}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, pinned: [...pinned].sort() }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path.join(dir, PINS_FILE));
}

/**
 * Prunes snapshots down to maxKeep (STBK-06): keeps the newest `maxKeep`
 * non-pinned snapshots by createdAt; pinned ones are never removed.
 * Returns the removed file names.
 */
export function pruneSnapshots(dir: string, maxKeep = 5): string[] {
  if (!fs.existsSync(dir) || maxKeep <= 0) return [];
  const removable = listSnapshots(dir).filter((info) => !info.pinned);
  const toRemove = removable.slice(maxKeep);
  for (const info of toRemove) {
    try {
      fs.rmSync(info.file);
    } catch {
      // a snapshot that fails to delete stays — never blocks the operation
    }
  }
  return toRemove.map((info) => info.name);
}

// ---------------------------------------------------------------------------
// free space (fail-safe, STBK-07)
// ---------------------------------------------------------------------------

/** Nearest existing ancestor of `dir` (backups dirs may not exist yet). */
function nearestExistingDir(dir: string): string {
  let current = dir;
  for (;;) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** Free bytes on the filesystem backing `dir` (null when statfs fails). */
export function freeBytesOnDisk(dir: string): number | null {
  try {
    const stat = fs.statfsSync(nearestExistingDir(dir));
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// createSnapshot — the pre-write contract used by install/sync/uninstall
// ---------------------------------------------------------------------------

function timestampName(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `-${pad(date.getMilliseconds(), 3)}`
  );
}

/**
 * Snapshots the given files into `<destDir>/runecraft-<ts>.tar.gz` and prunes.
 * Throws on failure (incl. low free space) — callers must abort the operation
 * before writing anything (nothing has been modified when this throws).
 */
export function createSnapshot(opts: CreateSnapshotOptions): SnapshotResult {
  const destDir = opts.destDir;
  const now = opts.now ?? new Date();
  const minFree = opts.minFreeBytes ?? BACKUP_MIN_FREE_BYTES;
  const freeProbe = opts.freeBytes ?? freeBytesOnDisk;

  // Fail-safe (STBK-07): check space BEFORE any write.
  const free = freeProbe(destDir);
  if (free !== null && free < minFree) {
    throw new Error(
      `espaço livre insuficiente em ${destDir} (${free} bytes livres < threshold ${minFree} bytes) — nada foi modificado`,
    );
  }

  const entries = capture(opts.files);
  const hash = contentHash(entries);
  const createdAt = now.toISOString();
  const fileName = `${SNAPSHOT_PREFIX}${timestampName(now)}.tar.gz`;

  // Dedupe (STBK-05): identical content → reuse the existing snapshot.
  if (opts.dedupe !== false) {
    const existing = findSnapshotByHash(destDir, hash);
    if (existing) {
      return {
        file: existing.file,
        hash,
        files: entries.map((entry) => entry.path),
        createdAt: existing.createdAt,
        deduped: true,
      };
    }
  }

  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    createdAt,
    scope: opts.scope,
    reason: opts.reason,
    files: entries.map((entry) => entry.path),
    hash,
  };
  const tarGz = buildTar(entries, manifest);
  fs.mkdirSync(destDir, { recursive: true });
  const file = path.join(destDir, fileName);
  fs.writeFileSync(file, tarGz);

  if (opts.prune !== false) pruneSnapshots(destDir, opts.maxKeep ?? 5);

  return { file, hash, files: entries.map((entry) => entry.path), createdAt, deduped: false };
}

// ---------------------------------------------------------------------------
// restore support (STBK-08)
// ---------------------------------------------------------------------------

export interface ExtractedSnapshot {
  manifest: SnapshotManifest;
  /** index-aligned with manifest.files. */
  entries: Array<{ kind: "file" | "symlink"; content: Buffer; linkTarget?: string }>;
}

/**
 * Reads and validates a snapshot for restore. Throws on invalid/incomplete
 * snapshots — restore is fail-closed: nothing is written when this throws.
 */
export function extractSnapshot(file: string): ExtractedSnapshot {
  const manifest = readSnapshotManifest(file);
  if (!manifest) {
    throw new Error(`snapshot inválido ou corrompido: ${path.basename(file)}`);
  }
  let tar: Map<string, TarEntry>;
  try {
    tar = parseTar(zlib.gunzipSync(fs.readFileSync(file)));
  } catch (error) {
    throw new Error(`snapshot inválido ou corrompido: ${path.basename(file)} (${(error as Error).message})`);
  }
  const entries = manifest.files.map((_file, index) => {
    const entry = tar.get(`files/${index}`);
    if (!entry) {
      throw new Error(`snapshot incompleto: entry files/${index} ausente no arquivo ${path.basename(file)}`);
    }
    if (entry.type === "symlink") {
      return { kind: "symlink" as const, content: Buffer.alloc(0), linkTarget: entry.linkname ?? "" };
    }
    return { kind: "file" as const, content: entry.content ?? Buffer.alloc(0) };
  });
  return { manifest, entries };
}

/**
 * Resolves a user-supplied backup reference: an existing absolute path, or a
 * name (with or without .tar.gz) inside the scope backups dir. Null when not found.
 */
export function resolveSnapshot(dir: string, ref: string): string | null {
  const trimmed = ref.trim();
  if (trimmed === "") return null;
  if (path.isAbsolute(trimmed)) {
    return fs.existsSync(trimmed) ? trimmed : null;
  }
  const candidates = trimmed.endsWith(".tar.gz") ? [trimmed] : [trimmed, `${trimmed}.tar.gz`];
  for (const candidate of candidates) {
    const file = path.join(dir, candidate);
    if (fs.existsSync(file)) return file;
  }
  return null;
}
