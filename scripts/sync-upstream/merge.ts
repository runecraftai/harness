/**
 * Three-way merge engine (F10 D1/D7, SYNC-01).
 *
 * Strategy: materialized base (tarball at the pinned resolvedSha) + theirs
 * (tarball at the new ref), merged against ours (the current dest) per file
 * with `git merge-file` (diff3 markers on conflict). Zero new dependencies —
 * git is already a harness requirement.
 *
 * Classification (union of base ∪ theirs ∪ ours paths):
 *   only theirs            → copy (new upstream file)
 *   only ours              → keep (our addition)
 *   only base              → both deleted → stays deleted
 *   base+theirs, no ours   → we deleted; theirs unchanged → deleted preserved
 *                            (F2 install.mjs); theirs changed → modify/delete conflict
 *   base+ours, no theirs   → upstream deleted; ours == base → delete;
 *                            ours modified → keep + divergence report
 *   ours+theirs, no base   → both added; identical → keep; different → conflict
 *   all three              → git merge-file (clean → apply; conflict → fail-closed)
 *
 * ATOMICITY (validated in Execute): the merged tree is built in a staging dir
 * and copied over the dest ONLY when the whole merge is clean. On ANY conflict
 * the working tree is untouched — zero writes, provenance intact (fail-closed).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	copyFile,
	filesEqual,
	isBinary,
	isExcluded,
	readText,
	removeIfExists,
	requireGit,
	run,
	walk,
	writeText,
} from "./util.ts";

export type ConflictReason = "conflict" | "modify-delete" | "binary" | "both-added";

export interface ConflictFile {
	rel: string;
	reason: ConflictReason;
}

export interface MergeResult {
	kind: "clean" | "conflict";
	/** Files whose merged/new content lands in the dest (clean merges + new upstream files). */
	applied: string[];
	/** Files preserved from ours (our additions / preserved deletions / untouched). */
	kept: string[];
	/** Files deleted (upstream deleted, we did not modify). */
	deleted: string[];
	/** Conflicts — when non-empty the sync aborts and NOTHING is written. */
	conflicts: ConflictFile[];
	/** Upstream deleted a file we modified → kept ours + divergence reported (registry suggested). */
	divergences: string[];
}

export interface MergeInput {
	/** Materialized base tree (tarball at resolvedSha, subpath applied). */
	baseDir: string;
	/** Materialized theirs tree (tarball at new ref, subpath applied). */
	theirsDir: string;
	/** Current dest dir. */
	oursDir: string;
	/** Staging dir where the merged tree is built. */
	stagingDir: string;
	/** Exclude patterns (rel paths) never part of the universe. */
	excludes: string[];
}

const MERGE_LABELS = ["ours", "base", "theirs"] as const;

function excludedSet(dir: string, excludes: string[]): Set<string> {
	const set = new Set<string>();
	for (const rel of walk(dir)) {
		if (isExcluded(rel, excludes)) set.add(rel);
	}
	return set;
}

/**
 * Run `git merge-file` over three copies. Returns the merged content plus a
 * clean/conflict verdict. Never mutates caller inputs (works on staging copies).
 */
export function gitMergeFile(
	stagingDir: string,
	rel: string,
	baseFile: string,
	theirsFile: string,
	oursFile: string,
): { clean: boolean; content: string } {
	requireGit();
	const merged = join(stagingDir, rel);
	// git merge-file writes the result into the FIRST argument; use a copy so a
	// conflict leaves the staged file untouched for reporting.
	const tmp = `${merged}.merge-tmp`;
	copyFile(oursFile, tmp);
	const res = run("git", [
		"merge-file",
		"-L",
		"ours",
		"-L",
		"base",
		"-L",
		"theirs",
		"--diff3",
		tmp,
		baseFile,
		theirsFile,
	]);
	if (res.code === 0) {
		const content = readText(tmp);
		removeIfExists(tmp);
		return { clean: true, content };
	}
	if (res.code === 1) {
		// Conflict: markers live in the tmp file — read them for the report.
		const content = existsSync(tmp) ? readText(tmp) : "";
		removeIfExists(tmp);
		return { clean: false, content };
	}
	removeIfExists(tmp);
	throw new Error(`git merge-file failed for ${rel}: ${res.stderr.trim() || res.stdout.trim()}`);
}

/**
 * Three-way merge base/theirs against ours into stagingDir.
 * Result kind is "conflict" when ANY file conflicts (caller must abort, zero writes).
 */
export function threeWayMerge(input: MergeInput): MergeResult {
	const { baseDir, theirsDir, oursDir, stagingDir, excludes } = input;
	removeIfExists(stagingDir);
	mkdirSync(stagingDir, { recursive: true });

	const baseFiles = walk(baseDir);
	const theirsFiles = walk(theirsDir);
	const oursFiles = walk(oursDir);
	const baseEx = excludedSet(baseDir, excludes);
	const theirsEx = excludedSet(theirsDir, excludes);
	const oursEx = excludedSet(oursDir, excludes);

	const inBase = (rel: string) => baseFiles.includes(rel) && !baseEx.has(rel);
	const inTheirs = (rel: string) => theirsFiles.includes(rel) && !theirsEx.has(rel);
	const inOurs = (rel: string) => oursFiles.includes(rel) && !oursEx.has(rel);

	const universe = new Set<string>([...baseFiles, ...theirsFiles, ...oursFiles]);
	for (const rel of [...baseEx, ...theirsEx, ...oursEx]) universe.delete(rel);

	const result: MergeResult = {
		kind: "clean",
		applied: [],
		kept: [],
		deleted: [],
		conflicts: [],
		divergences: [],
	};

	for (const rel of [...universe].sort()) {
		const b = inBase(rel);
		const t = inTheirs(rel);
		const o = inOurs(rel);
		const baseFile = join(baseDir, rel);
		const theirsFile = join(theirsDir, rel);
		const oursFile = join(oursDir, rel);
		const stagingFile = join(stagingDir, rel);

		// 1) only theirs — new upstream file.
		if (t && !b && !o) {
			copyFile(theirsFile, stagingFile);
			result.applied.push(rel);
			continue;
		}
		// 2) only ours — our addition.
		if (o && !b && !t) {
			copyFile(oursFile, stagingFile);
			result.kept.push(rel);
			continue;
		}
		// 3) only base — both sides deleted it.
		if (b && !t && !o) {
			result.deleted.push(rel);
			continue;
		}
		// 4) base+theirs, no ours — we deleted (F2 semantics).
		if (b && t && !o) {
			if (filesEqual(baseFile, theirsFile)) {
				result.kept.push(rel); // upstream untouched → deletion preserved
			} else {
				result.conflicts.push({ rel, reason: "modify-delete" });
			}
			continue;
		}
		// 5) base+ours, no theirs — upstream deleted.
		if (b && o && !t) {
			if (filesEqual(baseFile, oursFile)) {
				result.deleted.push(rel); // we never touched it → deletion wins
			} else {
				copyFile(oursFile, stagingFile); // we modified → keep ours + report
				result.kept.push(rel);
				result.divergences.push(rel);
			}
			continue;
		}
		// 6) ours+theirs, no base — both added independently.
		if (o && t && !b) {
			if (filesEqual(oursFile, theirsFile)) {
				copyFile(oursFile, stagingFile);
				result.kept.push(rel);
			} else {
				result.conflicts.push({ rel, reason: "both-added" });
			}
			continue;
		}
		// 7) all three — git merge-file (binary-aware).
		if (b && t && o) {
			const anyBinary = isBinary(baseFile) || isBinary(theirsFile) || isBinary(oursFile);
			if (anyBinary) {
				if (filesEqual(oursFile, theirsFile)) {
					copyFile(oursFile, stagingFile);
					result.kept.push(rel);
				} else {
					result.conflicts.push({ rel, reason: "binary" });
				}
				continue;
			}
			const merged = gitMergeFile(stagingDir, rel, baseFile, theirsFile, oursFile);
			if (merged.clean) {
				writeText(stagingFile, merged.content);
				result.applied.push(rel);
			} else {
				result.conflicts.push({ rel, reason: "conflict" });
			}
			continue;
		}
		// Unreachable: every path-set combination is covered above.
		result.conflicts.push({ rel, reason: "conflict" });
	}

	result.kind = result.conflicts.length > 0 ? "conflict" : "clean";
	return result;
}
