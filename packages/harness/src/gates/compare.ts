// gates/compare.ts — comparison algebra v1 (design fluxo 4).
//
// Every comparison re-derives evidence from the LIVE git repo with the
// canonical diff command (D5) and never mutates a receipt. Projection is the
// staged index only on pre-commit (a dirty working tree is ignored by
// construction); pre-push compares the aggregate diff of the pushed commits.
//
// Relations:
//   exact (pre-commit)              sha256(git diff --cached <base.sha> …) == diff_hash
//   exact (pre-push)                <local_sha> == head_sha && diff(<base>,<local>) == diff_hash
//   compatible_base_advance         merge-base preservado + paths idênticos + diff idêntico
//   drift / changed / unrelated     diff difere / paths mudaram / merge-base quebrou → deny
//   ambiguous / unknown             ref remota do base ou head/base.sha não resolvíveis → deny (fetch hint)
//
// The caller iterates receipts newest→oldest; the first PASS wins. This
// module returns structured outcomes; the caller owns the deny messages
// (design fluxo 4 — "o quê falhou + o que fazer").
import { diffNameOnly, hashGitDiff, mergeBase, runGit } from "./git.ts";
import type { Receipt } from "../receipt/schema.ts";

export type PreCommitRelation = "exact" | "drift" | "ambiguous";
export type PrePushRelation = "exact" | "compatible_base_advance" | "drift" | "changed" | "unrelated" | "ambiguous";

export interface PreCommitResult {
  relation: PreCommitRelation;
  expectedHash?: string;
  obtainedHash?: string;
  /** ambiguous reason (base.sha ausente, git falhou). */
  detail?: string;
  /** bytes of the diff stream (perf threshold warning). */
  bytes?: number;
}

export interface PrePushResult {
  relation: PrePushRelation;
  expectedHash?: string;
  obtainedHash?: string;
  detail?: string;
  bytes?: number;
}

function commitExists(cwd: string, sha: string): boolean {
  return runGit(cwd, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

/**
 * pre-commit: compare the STAGED INDEX against the receipt's base.sha.
 * Projection is the index ONLY (a dirty working tree is ignored by
 * construction). The index is materialized as a tree (`git write-tree`) and
 * diffed with the same canonical command as the capture — `git diff --cached
 * <base>` would emit `c/`/`i/` path prefixes instead of `a/`/`b/`, breaking
 * byte parity with the receipt hash for new files (validado no Execute:
 * `git diff <base> <tree>` is byte-identical to `git diff <base> <head>`).
 */
export async function comparePreCommit(cwd: string, receipt: Receipt): Promise<PreCommitResult> {
  const base = receipt.candidate.base.sha;
  if (!commitExists(cwd, base)) {
    return {
      relation: "ambiguous",
      detail: `base.sha ${base.slice(0, 8)} não presente localmente — rode \`git fetch ${receipt.candidate.base.remote} ${receipt.candidate.base.ref} ${receipt.candidate.head_sha}\``,
    };
  }
  const tree = runGit(cwd, ["write-tree"]);
  if (!tree.ok) {
    return { relation: "ambiguous", detail: `git write-tree falhou (index ilegível): ${tree.stderr.trim() || "exit não-zero"}` };
  }
  const indexTree = tree.stdout.trim();
  const diff = await hashGitDiff(cwd, [base, indexTree]);
  if (!diff.ok) {
    return { relation: "ambiguous", detail: `git diff falhou: ${diff.stderr.trim() || "exit não-zero"}`, bytes: diff.bytes };
  }
  if (diff.hash === receipt.candidate.diff_hash) {
    return { relation: "exact", expectedHash: receipt.candidate.diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
  }
  return { relation: "drift", expectedHash: receipt.candidate.diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
}

/**
 * pre-push: exact OR compatible_base_advance for one pushed local sha
 * (aggregate diff base..local). `remoteRef` = `refs/remotes/<remote>/<ref>` —
 * the design's canonical comparison point; a missing remote ref is
 * `ambiguous` (fetch pending — never interpreted as "changed").
 */
export async function comparePrePush(
  cwd: string,
  receipt: Receipt,
  localSha: string,
  remoteRef: string,
): Promise<PrePushResult> {
  const { base, head_sha, diff_hash } = receipt.candidate;

  // exact (pre-push): local_sha == head_sha && diff idêntico.
  if (localSha === head_sha) {
    const diff = await hashGitDiff(cwd, [base.sha, localSha]);
    if (!diff.ok) {
      return {
        relation: "ambiguous",
        detail: `base.sha ${base.sha.slice(0, 8)} não presente localmente — rode \`git fetch ${base.remote} ${base.ref} ${head_sha}\``,
        bytes: diff.bytes,
      };
    }
    if (diff.hash === diff_hash) return { relation: "exact", expectedHash: diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
    return { relation: "drift", expectedHash: diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
  }

  // compatible_base_advance — três condições (fluxo 4).
  if (!commitExists(cwd, head_sha)) {
    return {
      relation: "ambiguous",
      detail: `head_sha ${head_sha.slice(0, 8)} não presente localmente — rode \`git fetch ${base.remote} ${base.ref} ${head_sha}\``,
    };
  }
  if (!commitExists(cwd, base.sha)) {
    return {
      relation: "ambiguous",
      detail: `base.sha ${base.sha.slice(0, 8)} não presente localmente — rode \`git fetch ${base.remote} ${base.ref} ${head_sha}\``,
    };
  }
  // (1) merge-base preservado.
  const mergeBaseSha = mergeBase(cwd, remoteRef, localSha);
  if (mergeBaseSha === null) {
    return {
      relation: "ambiguous",
      detail: `ref remota do base ${remoteRef} não resolvível localmente — rode \`git fetch ${base.remote} ${base.ref}\``,
    };
  }
  if (mergeBaseSha !== base.sha) {
    return {
      relation: "unrelated",
      detail: `merge-base mudou (esperado ${base.sha.slice(0, 8)}, obtido ${mergeBaseSha.slice(0, 8)}) — história reescrita ou divergente; o conteúdo novo não foi revisado`,
    };
  }
  // (2) paths idênticos (fast-fail diagnóstico; subsumido por 3).
  const localPaths = diffNameOnly(cwd, base.sha, localSha);
  const headPaths = diffNameOnly(cwd, base.sha, head_sha);
  if (localPaths.length !== headPaths.length || localPaths.some((p, i) => p !== headPaths[i])) {
    return { relation: "changed", detail: "paths do diff mudaram — conteúdo novo não revisado" };
  }
  // (3) diff idêntico.
  const diff = await hashGitDiff(cwd, [base.sha, localSha]);
  if (!diff.ok) {
    return { relation: "ambiguous", detail: `git diff falhou: ${diff.stderr.trim() || "exit não-zero"}`, bytes: diff.bytes };
  }
  if (diff.hash === diff_hash) {
    return { relation: "compatible_base_advance", expectedHash: diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
  }
  return { relation: "drift", expectedHash: diff_hash, obtainedHash: diff.hash, bytes: diff.bytes };
}

/** Priority for the best-failure message when no receipt matches (higher wins). */
export function failurePriority(relation: PrePushRelation | PreCommitRelation): number {
  switch (relation) {
    case "ambiguous":
      return 4;
    case "unrelated":
      return 3;
    case "changed":
      return 2;
    case "drift":
      return 1;
    default:
      return 0;
  }
}
