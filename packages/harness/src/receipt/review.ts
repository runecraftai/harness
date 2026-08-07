// receipt/review.ts — strict review validator mirror (D7; validado no Execute).
//
// The receipt capture validates the review JSON the fork produced with a
// LOCAL mirror of the fork's `parsePublishableReview` — zero dependency on
// packages/pr-review (D1). The validated subset (decisão no Execute):
// `pr.number`/`pr.title`/`pr.head_sha` (the head feeds the receipt), verdict,
// disposition, and the findings array (severity + blocking consistency +
// confidence) — "verdict + findings P0/P1 + head_sha, nada além". Fields the
// fork also validates but the receipt does not consume (verification,
// overview, strengths, notes, overall_* , code_location) are NOT checked
// here; whatever the model emitted is covered by `reviewHash` =
// sha256(JSON.stringify(review)) — the same formula as the fork
// (pr-review-publish.ts reviewHash). A single surrounding markdown code fence
// is stripped (fork parity).
//
// Receipt is emitted ONLY for `verdict === "approve"` AND zero findings with
// severity P0/P1 (D7 — defensive: the fork already ties request_changes to
// P0/P1, but the validator does not trust it).
export const REVIEW_HEAD_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

export type ReviewVerdict = "approve" | "request_changes" | "comment";

export interface ReviewLike {
  pr: { number: number; title: string; head_sha: string };
  disposition: "reviewed" | "skipped";
  verdict: ReviewVerdict;
  findings: Array<{
    title: string;
    body: string;
    severity: "P0" | "P1" | "P2" | "P3" | "nit";
    blocking: boolean;
    confidence_score: number;
  }>;
  [key: string]: unknown;
}

export interface ReviewValidationResult {
  review?: ReviewLike;
  error?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

const SEVERITIES = new Set(["P0", "P1", "P2", "P3", "nit"]);

/** Strip a single surrounding markdown code fence (fork parity). */
function stripMarkdownCodeFence(text: string): string {
  const match = text.trim().match(/^```[^\n]*\n([\s\S]*)\n```[ \t]*$/);
  return match?.[1] ?? text;
}

/**
 * Validate a review text produced by /pr-review. Returns the parsed review
 * (the object the reviewHash is computed over — key order preserved from the
 * model output) or an error naming the failing field.
 */
export function validateReview(text: string): ReviewValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(stripMarkdownCodeFence(text).trim());
  } catch {
    return { error: "final response is not exactly one JSON object" };
  }
  if (!isPlainObject(value)) return { error: "final review must be a JSON object" };
  const pr = value.pr;
  if (!isPlainObject(pr) || !Number.isInteger(pr.number) || Number(pr.number) <= 0 || typeof pr.title !== "string") {
    return { error: "pr.number and pr.title are required" };
  }
  if (typeof pr.head_sha !== "string" || !REVIEW_HEAD_SHA_RE.test(pr.head_sha)) {
    return { error: "pr.head_sha must be a full hexadecimal commit SHA" };
  }
  if (value.disposition !== "reviewed" && value.disposition !== "skipped") {
    return { error: "disposition must be reviewed or skipped" };
  }
  if (!new Set(["approve", "request_changes", "comment"]).has(String(value.verdict))) {
    return { error: "verdict is invalid" };
  }
  if (!Array.isArray(value.findings)) return { error: "findings must be an array" };
  for (const [index, finding] of value.findings.entries()) {
    if (!isPlainObject(finding)) return { error: `finding ${index + 1} must be an object` };
    if (typeof finding.title !== "string" || typeof finding.body !== "string") {
      return { error: `finding ${index + 1} title/body must be strings` };
    }
    if (typeof finding.severity !== "string" || !SEVERITIES.has(finding.severity)) {
      return { error: `finding ${index + 1} has invalid severity` };
    }
    if (typeof finding.blocking !== "boolean" || finding.blocking !== ["P0", "P1"].includes(finding.severity)) {
      return { error: `finding ${index + 1} has inconsistent blocking value` };
    }
    if (!isConfidence(finding.confidence_score)) {
      return { error: `finding ${index + 1} has invalid confidence_score` };
    }
  }
  return { review: value as unknown as ReviewLike };
}

/** D7: receipt only when approved AND no P0/P1 findings (disposition reviewed). */
export function reviewBlocksReceipt(review: ReviewLike): string | null {
  if (review.disposition !== "reviewed") {
    return `disposition ${String(review.disposition)} ≠ reviewed — sem receipt (o review foi pulado, não executado)`;
  }
  if (review.verdict !== "approve") {
    return `verdict ${review.verdict} ≠ approve — sem receipt (RCPT-03; D7)`;
  }
  const blockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
  if (blockers.length > 0) {
    return `verdict approve mas ${blockers.length} finding(s) P0/P1 presente(s): ${blockers
      .map((f) => `${f.severity} ${f.title}`)
      .join("; ")} — sem receipt (D7)`;
  }
  return null;
}
