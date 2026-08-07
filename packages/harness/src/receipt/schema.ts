// receipt/schema.ts — strict receipt validation (RCPT-04).
//
// The receipt is an immutable artifact that links a pr-review verdict to the
// exact content that was reviewed (candidate.diff_hash). Validation follows
// the strict pattern of the fork's `parsePublishableReview` but is a local
// mirror — zero dependency on packages/pr-review (D1: the fork stays pure).
//
// Rules (design fluxo 1): exact schema `"runecraft.receipt/v1"`; `head_sha`
// `^[0-9a-f]{40}(?:[0-9a-f]{24})?$` (same regex as the fork); `diff_hash` /
// `reviewHash` `^[0-9a-f]{64}$`; `base.sha` full hex; `base.ref` / `base.remote`
// without whitespace; `verdict === "approve"`; `issuedAt` ISO-8601 parseable.
// **Extra fields are rejected** (fail-closed — no free-form fields). Errors
// name the file and the field.
const HEAD_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const NO_WS_RE = /^\S+$/;

export const RECEIPT_SCHEMA = "runecraft.receipt/v1" as const;

export interface ReceiptBase {
  sha: string;
  ref: string;
  remote: string;
}

export interface ReceiptCandidate {
  head_sha: string;
  diff_hash: string;
  base: ReceiptBase;
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA;
  candidate: ReceiptCandidate;
  verdict: "approve";
  reviewHash: string;
  issuedAt: string;
}

export interface ReceiptParseResult {
  receipt?: Receipt;
  /** human-readable error naming the file and the field (RCPT-04). */
  error?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Which fields the object carries that are NOT in the allowed set. */
function extraKeys(value: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/** ISO-8601 parseable (strict shape + valid calendar date via Date.parse). */
function isValidIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Validate a parsed receipt JSON object. `file` is only used in error
 * messages ("<file>: campo <field> — <reason>").
 */
export function validateReceipt(value: unknown, file = "<receipt>"): ReceiptParseResult {
  if (!isPlainObject(value)) {
    return { error: `${file}: receipt deve ser um objeto JSON` };
  }
  const topKeys = ["schema", "candidate", "verdict", "reviewHash", "issuedAt"];
  const extra = extraKeys(value, topKeys);
  if (extra.length > 0) {
    return { error: `${file}: campos extras não permitidos: ${extra.join(", ")}` };
  }
  if (value.schema !== RECEIPT_SCHEMA) {
    return { error: `${file}: campo schema — esperado "${RECEIPT_SCHEMA}", encontrado ${JSON.stringify(value.schema)}` };
  }
  const candidate = value.candidate;
  if (!isPlainObject(candidate)) {
    return { error: `${file}: campo candidate — esperado objeto` };
  }
  const candidateKeys = ["head_sha", "diff_hash", "base"];
  const extraCandidate = extraKeys(candidate, candidateKeys);
  if (extraCandidate.length > 0) {
    return { error: `${file}: campos extras não permitidos em candidate: ${extraCandidate.join(", ")}` };
  }
  if (typeof candidate.head_sha !== "string" || !HEAD_SHA_RE.test(candidate.head_sha)) {
    return { error: `${file}: campo candidate.head_sha — esperado SHA hexadecimal completo (40 ou 64 hex)` };
  }
  if (typeof candidate.diff_hash !== "string" || !HEX64_RE.test(candidate.diff_hash)) {
    return { error: `${file}: campo candidate.diff_hash — esperado sha256 hexadecimal (64 hex)` };
  }
  const base = candidate.base;
  if (!isPlainObject(base)) {
    return { error: `${file}: campo candidate.base — esperado objeto` };
  }
  const baseKeys = ["sha", "ref", "remote"];
  const extraBase = extraKeys(base, baseKeys);
  if (extraBase.length > 0) {
    return { error: `${file}: campos extras não permitidos em candidate.base: ${extraBase.join(", ")}` };
  }
  if (typeof base.sha !== "string" || !HEAD_SHA_RE.test(base.sha)) {
    return { error: `${file}: campo candidate.base.sha — esperado SHA hexadecimal completo` };
  }
  if (typeof base.ref !== "string" || !NO_WS_RE.test(base.ref)) {
    return { error: `${file}: campo candidate.base.ref — esperado string sem whitespace` };
  }
  if (typeof base.remote !== "string" || !NO_WS_RE.test(base.remote)) {
    return { error: `${file}: campo candidate.base.remote — esperado string sem whitespace` };
  }
  if (value.verdict !== "approve") {
    return { error: `${file}: campo verdict — receipt só é emitido para "approve", encontrado ${JSON.stringify(value.verdict)}` };
  }
  if (typeof value.reviewHash !== "string" || !HEX64_RE.test(value.reviewHash)) {
    return { error: `${file}: campo reviewHash — esperado sha256 hexadecimal (64 hex)` };
  }
  if (!isValidIso(value.issuedAt)) {
    return { error: `${file}: campo issuedAt — esperado ISO-8601 parseável` };
  }
  return {
    receipt: {
      schema: RECEIPT_SCHEMA,
      candidate: {
        head_sha: candidate.head_sha,
        diff_hash: candidate.diff_hash,
        base: { sha: base.sha, ref: base.ref, remote: base.remote },
      },
      verdict: "approve",
      reviewHash: value.reviewHash,
      issuedAt: value.issuedAt,
    },
  };
}
