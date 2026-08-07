// receipt/store.ts — receipts directory (append-only, D6).
//
// Receipts live in `<repo root>/.runecraft/receipts/<ts>.json` (gitignored).
// Append-only: gates/disable/uninstall NEVER remove or mutate a receipt
// (RCPT-08 AC 4.3 — immutable delivery contract). Writing is atomic
// tmp+rename (F13 STBK-03 pattern); the file name is derived from issuedAt
// (`YYYYMMDD-HHmmss-SSS.json`), with `-1`/`-2` suffixes on collision.
// Scanning parses every `*.json`: corrupt files surface an error per file
// (the gate denies pointing at the file — fail-closed) instead of matching.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateReceipt, type Receipt } from "./schema.ts";

/** Receipts directory for a repo root (always `<root>/.runecraft/receipts`). */
export function receiptsDir(root: string): string {
  return path.join(root, ".runecraft", "receipts");
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** File name stem for an issuedAt instant: `YYYYMMDD-HHmmss-SSS` (UTC — o
 * issuedAt é ISO-8601 com Z; getters locais deslocariam o nome do valor
 * registrado e inverteriam a ordenação newest-first em fusos negativos). */
export function receiptNameFromIssuedAt(issuedAt: string): string {
  const date = new Date(issuedAt);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
    `-${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/**
 * Write a receipt into `<root>/.runecraft/receipts/`. Validates the receipt
 * against the strict schema first (RCPT-04 — never persist an invalid one),
 * then writes atomically (tmp + rename). Collisions on the issuedAt-derived
 * name get `-1`, `-2`… suffixes. Returns the written file path.
 * Throws on validation failure or IO errors (callers report and exit ≠ 0).
 */
export function writeReceipt(root: string, receipt: Receipt): string {
  const parsed = validateReceipt(receipt);
  if (!parsed.receipt) {
    throw new Error(`receipt inválido — ${parsed.error}`);
  }
  const dir = receiptsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const stem = receiptNameFromIssuedAt(receipt.issuedAt);
  let file = path.join(dir, `${stem}.json`);
  let suffix = 1;
  while (fs.existsSync(file)) {
    file = path.join(dir, `${stem}-${suffix}.json`);
    suffix += 1;
  }
  const tmp = path.join(dir, `${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

/** One scanned receipt file: a valid receipt OR a per-file error (never both). */
export interface ScannedReceipt {
  file: string;
  receipt?: Receipt;
  /** JSON unparseable or schema-invalid (the gate/log consumers decide severity). */
  error?: string;
  /** corrupt = JSON inválido (gate nega apontando o arquivo); invalid = schema (registrado, não casa). */
  errorKind?: "corrupt" | "invalid";
}

function scanFile(file: string): ScannedReceipt {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { file, error: `${file}: JSON inválido`, errorKind: "corrupt" };
  }
  const parsed = validateReceipt(raw, file);
  if (parsed.error) return { file, error: parsed.error, errorKind: "invalid" };
  return { file, receipt: parsed.receipt };
}

/**
 * Scan the receipts dir, newest first (the file name sorts by issuedAt —
 * lexicographic order == chronological order). Missing dir → empty array.
 * Corrupt files are reported per-file with `error` (they never match).
 */
export function scanReceipts(root: string): ScannedReceipt[] {
  const dir = receiptsDir(root);
  if (!fs.existsSync(dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return []; // dir ilegível → sem receipts (o gate decide fail-closed)
  }
  names.sort((a, b) => b.localeCompare(a)); // newest first
  return names.map((name) => scanFile(path.join(dir, name)));
}
