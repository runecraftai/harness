// gates/git.ts — git helpers for the F20 receipt gates (D5).
//
// The capture and the gates re-derive evidence from the live git repo with a
// single canonical diff command (D5): `git diff <base> <head> --binary
// --full-index --no-ext-diff --no-renames` (+ `--cached` in pre-commit). The
// flags make the hash immune to user git config (diff.external, diff.renames).
//
// Root resolution (validado no Execute): `dirname(git rev-parse
// --git-common-dir)` — for a linked worktree git-common-dir is the main
// repo's `.git` dir (absolute), so `.runecraft/` and receipts resolve to the
// main root. The hooks path is `git rev-parse --git-path hooks` (resolved
// against cwd): for a main repo it is `.git/hooks`; for a worktree it is the
// common `<root>/.git/hooks` — git's find_hook falls back to
// `$GIT_COMMON_DIR/hooks` when the per-worktree hooks dir does not exist, so
// hooks installed at the root path run in linked worktrees too (verified
// empirically with a real worktree).
import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as path from "node:path";

export interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Sync git run with a generous buffer (diff/name-only outputs). */
export function runGit(cwd: string, args: string[]): GitResult {
  let res;
  try {
    res = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    return { ok: false, code: null, stdout: "", stderr: (error as Error).message };
  }
  return { ok: res.status === 0, code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * Root of the repository (the MAIN root in linked worktrees):
 * `dirname(git rev-parse --git-common-dir)`. Null when the cwd is not inside
 * a git repository (a hook only ever runs inside one — callers fail closed).
 */
export function repoRoot(cwd: string): string | null {
  const res = runGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (!res.ok) return null;
  const common = res.stdout.trim();
  if (common === "") return null;
  const abs = path.isAbsolute(common) ? common : path.resolve(cwd, common);
  return path.dirname(abs);
}

/**
 * Effective git hooks directory for the cwd (where the pre-commit/pre-push
 * hooks live). Resolved via `git rev-parse --git-path hooks` against cwd —
 * the same place git looks up the hooks (validado no Execute: worktrees
 * resolve to the common hooks path).
 */
export function hooksDir(cwd: string): string | null {
  const res = runGit(cwd, ["rev-parse", "--git-path", "hooks"]);
  if (!res.ok) return null;
  const raw = res.stdout.trim();
  if (raw === "") return null;
  return path.resolve(cwd, raw);
}

/** sha256 hex of a buffer/string (node:crypto — same hasher as the fork). */
export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Threshold for the diff-size perf warning (design Riscos: > 50 MB). */
export const DIFF_WARN_BYTES = 50 * 1024 * 1024;

export interface HashDiffResult {
  hash: string;
  bytes: number;
  ok: boolean;
  code: number | null;
  stderr: string;
}

/**
 * Streaming hash of `git diff <args> --binary --full-index --no-ext-diff
 * --no-renames` (memory stays bounded for huge diffs). The canonical flags are
 * appended here so capture and gates share exactly one diff form (D5). The
 * byte count enables the >50 MB perf warning.
 */
export function hashGitDiff(cwd: string, args: string[]): Promise<HashDiffResult> {
  return new Promise((resolve) => {
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    let stderr = "";
    const child = spawn("git", ["diff", ...args, "--binary", "--full-index", "--no-ext-diff", "--no-renames"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ hash: "", bytes, ok: false, code: null, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ hash: hash.digest("hex"), bytes, ok: code === 0, code, stderr });
    });
  });
}

/** `git merge-base <a> <b>` → full sha or null (ambiguous/unknown → fail-closed). */
export function mergeBase(cwd: string, a: string, b: string): string | null {
  const res = runGit(cwd, ["merge-base", a, b]);
  if (!res.ok) return null;
  const sha = res.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** `git diff --name-only <a>...<b>` → sorted file list (compatible_base_advance paths check). */
export function diffNameOnly(cwd: string, a: string, b: string): string[] {
  const res = runGit(cwd, ["diff", "--name-only", `${a}...${b}`]);
  if (!res.ok) return [];
  return res.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** `git rev-parse --abbrev-ref HEAD` → current branch short name (or ""). */
export function currentBranch(cwd: string): string {
  const res = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!res.ok) return "";
  const branch = res.stdout.trim();
  return branch === "HEAD" ? "" : branch;
}

/** `git config --get <key>` → value or null. */
export function gitConfig(cwd: string, key: string): string | null {
  const res = runGit(cwd, ["config", "--get", key]);
  if (!res.ok) return null;
  const value = res.stdout.trim();
  return value === "" ? null : value;
}

/**
 * Remote for the current branch: `branch.<current>.remote` with fallback
 * `origin` (design fluxo 2). Returns "origin" even when unset.
 */
export function currentRemote(cwd: string): string {
  const branch = currentBranch(cwd);
  if (branch !== "") {
    const remote = gitConfig(cwd, `branch.${branch}.remote`);
    if (remote !== null && /^[a-zA-Z0-9._-]+$/.test(remote)) return remote;
  }
  return "origin";
}
