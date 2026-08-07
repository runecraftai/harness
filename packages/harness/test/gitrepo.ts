// gitrepo.ts — real git repos in tmp for the F20 test suites (receipt/gates).
//
// The F20 gates re-derive evidence from the LIVE git repo, so the tests use
// real `git` in tmp dirs: base commit on main, feature branch with the
// reviewed change, and the remote tracking refs (refs/remotes/origin/main +
// origin/HEAD) that the capture/gate comparisons need. This is the
// Independent Test the F20 spec asks for (receipt com diff_hash correto
// derivado do git real).
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function git(dir: string, ...args: string[]): string {
  const res = execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return res.trim();
}

export function gitOk(dir: string, ...args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface TestRepo {
  dir: string;
  baseSha: string;
  headSha: string;
  /** refs/remotes/origin/main — advanced in compatible/related tests. */
  originMain: string;
  cleanup(): void;
}

/** init + base commit on main + feature commit + origin tracking refs. */
export function initReviewRepo(): TestRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-f20-"));
  try {
    git(dir, "init", "-q");
    git(dir, "checkout", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@runecraft");
    git(dir, "config", "user.name", "Test");
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    git(dir, "add", "base.txt");
    git(dir, "commit", "-q", "-m", "base");
    const baseSha = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
    git(dir, "add", "feature.txt");
    git(dir, "commit", "-q", "-m", "feature");
    const headSha = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "main");
    // Simula o remote já buscado (capture/gate usam refs/remotes/origin/main).
    git(dir, "update-ref", "refs/remotes/origin/main", baseSha);
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(dir, "checkout", "-q", "feature");
    return {
      dir,
      baseSha,
      headSha,
      originMain: baseSha,
      cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Independent diff hash: sha256 of the canonical diff command (D5) — computed
 * here with plain git, exactly as the receipt capture does. For the staged
 * projection the index is materialized with `git write-tree` (same byte
 * parity as the two-commit form — `--cached` would emit c//i/ prefixes).
 */
export function diffHash(dir: string, base: string, head: string, staged = false): string {
  const target = staged ? git(dir, "write-tree") : head;
  const args = ["diff", base, target, "--binary", "--full-index", "--no-ext-diff", "--no-renames"];
  const out = execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return crypto.createHash("sha256").update(out).digest("hex");
}

export interface ReviewFixtureOptions {
  pr?: number;
  headSha?: string;
  verdict?: "approve" | "request_changes" | "comment";
  findings?: Array<{ title: string; body: string; severity: string; blocking: boolean; confidence_score: number }>;
  disposition?: "reviewed" | "skipped";
}

/** A structurally valid pr-review JSON (subset the capture validator checks). */
export function reviewFixture(opts: ReviewFixtureOptions = {}): string {
  const review = {
    pr: { number: opts.pr ?? 42, title: "Test PR", head_sha: opts.headSha ?? "a".repeat(40) },
    disposition: opts.disposition ?? "reviewed",
    verification: "verified against exact head",
    overview: "overview",
    overall_explanation: "explanation",
    strengths: ["solid"],
    findings: opts.findings ?? [],
    notes: { correctness: "ok", security: "ok", performance: "ok" },
    verdict: opts.verdict ?? "approve",
    overall_correctness: "patch is correct",
    overall_confidence_score: 0.9,
  };
  return JSON.stringify(review);
}

export function p0Finding(): { title: string; body: string; severity: string; blocking: boolean; confidence_score: number } {
  return { title: "security hole", body: "bad", severity: "P0", blocking: true, confidence_score: 0.95 };
}

export function p1Finding(): { title: string; body: string; severity: string; blocking: boolean; confidence_score: number } {
  return { title: "bug", body: "bad", severity: "P1", blocking: true, confidence_score: 0.8 };
}
