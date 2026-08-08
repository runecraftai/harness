/**
 * Reports (F10 D6, SYNC-03/05/08).
 *
 *  - Delta report for a sync cycle: upstream changes (base→theirs, incl. rename
 *    detection), local changes (base→ours), merge outcomes, registry
 *    cross-reference (files upstream touched ∩ known divergences).
 *  - `--status`: vendored pin vs latest upstream (network, injectable) + local
 *    dirty state (offline).
 *  - `--check`: fully offline consistency validation for CI.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { UpstreamEntry } from "./manifest.ts";
import type { ConflictFile, MergeResult } from "./merge.ts";
import { filesEqual, readJson, run, walk } from "./util.ts";

export interface RegistryEntry {
	id: string;
	title: string;
	type: "deleted" | "renamed" | "fixed" | "pending";
	files: string[];
	commits: string[];
	status: string;
}

export interface RegistryDoc {
	fork: string;
	entries: RegistryEntry[];
}

export function loadRegistry(root: string, fork: string): RegistryDoc | null {
	return readJson<RegistryDoc>(join(root, "patches", fork, "registry.json"));
}

/** Upstream delta base→theirs: added / modified / removed / renamed candidates. */
export interface UpstreamDelta {
	added: string[];
	modified: string[];
	removed: string[];
	renamed: { from: string; to: string }[];
	/** Upstream files that intersect known divergences in the fork registry. */
	intersections: { file: string; registryIds: string[] }[];
}

function contentHash(file: string): string {
	return createHash("sha1").update(readFileSync(file)).digest("hex");
}

function detectRenames(
	baseFiles: string[],
	theirsFiles: string[],
	baseDir: string,
	theirsDir: string,
) {
	const renamed: { from: string; to: string }[] = [];
	const removed = baseFiles.filter((f) => !theirsFiles.includes(f));
	const added = theirsFiles.filter((f) => !baseFiles.includes(f));
	const addedHashes = new Map<string, string[]>();
	for (const f of added) {
		const h = contentHash(join(theirsDir, f));
		const list = addedHashes.get(h) ?? [];
		list.push(f);
		addedHashes.set(h, list);
	}
	for (const f of removed) {
		const h = contentHash(join(baseDir, f));
		const twins = addedHashes.get(h);
		if (twins && twins.length > 0) {
			renamed.push({ from: f, to: twins[0] as string });
			addedHashes.set(h, twins.slice(1));
		}
	}
	return renamed;
}

/** Compute the upstream delta between the materialized base and theirs trees. */
export function computeUpstreamDelta(baseDir: string, theirsDir: string): UpstreamDelta {
	const baseFiles = walk(baseDir);
	const theirsFiles = walk(theirsDir);
	const added = theirsFiles.filter((f) => !baseFiles.includes(f));
	const removed = baseFiles.filter((f) => !theirsFiles.includes(f));
	const renamed = detectRenames(baseFiles, theirsFiles, baseDir, theirsDir);
	const renamedTos = new Set(renamed.map((r) => r.to));
	const renamedFroms = new Set(renamed.map((r) => r.from));
	const modified = theirsFiles.filter(
		(f) => baseFiles.includes(f) && !filesEqual(join(baseDir, f), join(theirsDir, f)),
	);
	return {
		added: added.filter((f) => !renamedTos.has(f)),
		modified,
		removed: removed.filter((f) => !renamedFroms.has(f)),
		renamed,
		intersections: [],
	};
}

/** Cross-reference upstream-touched files against the fork registry (SYNC-08 AC2). */
export function intersectRegistry(
	delta: UpstreamDelta,
	registry: RegistryDoc | null,
): UpstreamDelta {
	if (!registry) return delta;
	const touched = new Set([
		...delta.added,
		...delta.modified,
		...delta.removed,
		...delta.renamed.map((r) => r.to),
	]);
	const byFile = new Map<string, string[]>();
	for (const entry of registry.entries) {
		for (const file of entry.files) {
			if (touched.has(file)) {
				const list = byFile.get(file) ?? [];
				list.push(entry.id);
				byFile.set(file, list);
			}
		}
	}
	delta.intersections = [...byFile.entries()].map(([file, registryIds]) => ({ file, registryIds }));
	return delta;
}

export interface SyncReportEntry {
	name: string;
	dest: string;
	delta: UpstreamDelta;
	merge: MergeResult;
	renamePass: { filesTouched: string[] };
}

export interface SyncReport {
	dryRun: boolean;
	group: string | null;
	entries: SyncReportEntry[];
	conflicted: boolean;
}

/** Render the human-readable sync report (CLI + docs). */
export function renderSyncReport(report: SyncReport): string {
	const lines: string[] = [];
	lines.push(report.dryRun ? "SYNC-UPSTREAM DRY-RUN (nothing written)" : "SYNC-UPSTREAM");
	if (report.group) lines.push(`group: ${report.group}`);
	for (const entry of report.entries) {
		lines.push("");
		lines.push(`== ${entry.name} -> ${entry.dest}`);
		const d = entry.delta;
		if (d.renamed.length) {
			lines.push(`  renamed upstream: ${d.renamed.map((r) => `${r.from} -> ${r.to}`).join(", ")}`);
		}
		if (d.added.length)
			lines.push(
				`  added upstream (${d.added.length}): ${d.added.slice(0, 10).join(", ")}${d.added.length > 10 ? " …" : ""}`,
			);
		if (d.modified.length)
			lines.push(
				`  modified upstream (${d.modified.length}): ${d.modified.slice(0, 10).join(", ")}${d.modified.length > 10 ? " …" : ""}`,
			);
		if (d.removed.length)
			lines.push(
				`  removed upstream (${d.removed.length}): ${d.removed.slice(0, 10).join(", ")}${d.removed.length > 10 ? " …" : ""}`,
			);
		for (const { file, registryIds } of d.intersections) {
			lines.push(
				`  ! upstream touched ${file} — intersects registry ${registryIds.join(", ")} (see patches/${entry.name}/registry.json)`,
			);
		}
		if (entry.merge.divergences.length) {
			lines.push(
				`  ! upstream deleted but we modified (kept ours — consider a registry entry): ${entry.merge.divergences.join(", ")}`,
			);
		}
		if (entry.merge.conflicts.length) {
			for (const c of entry.merge.conflicts) lines.push(`  CONFLICT [${c.reason}] ${c.rel}`);
		}
		if (entry.renamePass.filesTouched.length) {
			lines.push(
				`  rename pass touched (${entry.renamePass.filesTouched.length}): ${entry.renamePass.filesTouched.slice(0, 10).join(", ")}${entry.renamePass.filesTouched.length > 10 ? " …" : ""}`,
			);
		}
		if (entry.merge.conflicts.length === 0) {
			lines.push(
				`  merge clean: ${entry.merge.applied.length} applied, ${entry.merge.kept.length} kept, ${entry.merge.deleted.length} deleted`,
			);
		}
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// --status (SYNC-05) + --check (SYNC-05, offline)
// ---------------------------------------------------------------------------

export interface LatestFetcher {
	/** Latest tag (first of /tags) or null when the repo uses no tags. */
	latestTag(repo: string): Promise<string | null>;
	/** SHA of the default-branch HEAD. */
	headSha(repo: string): Promise<string>;
	/** `version` from package.json at ref via the contents API. */
	packageJsonVersion(repo: string, ref: string): Promise<string | null>;
}

/** Real implementation (network — manual `--status` only; CI uses --check). */
export class GitHubLatestFetcher implements LatestFetcher {
	private readonly ua = "runecraft-harness-sync-upstream";

	private async json(url: string): Promise<Record<string, unknown>> {
		const res = await fetch(url, {
			headers: { "User-Agent": this.ua, Accept: "application/vnd.github+json" },
		});
		if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
		return (await res.json()) as Record<string, unknown>;
	}

	async latestTag(repo: string): Promise<string | null> {
		try {
			const data = (await this.json(`https://api.github.com/repos/${repo}/tags`)) as unknown;
			if (Array.isArray(data) && data.length > 0) {
				const first = data[0] as { name?: unknown };
				return typeof first.name === "string" ? first.name : null;
			}
			return null;
		} catch {
			return null;
		}
	}

	async headSha(repo: string): Promise<string> {
		const data = await this.json(`https://api.github.com/repos/${repo}/commits/HEAD`);
		return typeof data.sha === "string" ? data.sha : "";
	}

	async packageJsonVersion(repo: string, ref: string): Promise<string | null> {
		try {
			const data = await this.json(
				`https://api.github.com/repos/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`,
			);
			const content = data.content;
			if (typeof content !== "string") return null;
			const decoded = Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
			const pkg = JSON.parse(decoded) as { version?: unknown };
			return typeof pkg.version === "string" ? pkg.version : null;
		} catch {
			return null;
		}
	}
}

export interface StatusRow {
	name: string;
	vendoredRef: string;
	vendoredSha: string;
	latestRef: string | null;
	latestVersion: string | null;
	local: "clean" | "dirty";
}

/** Local dirty detection per dest (offline; git status --porcelain). */
export function destDirty(root: string, dest: string): boolean {
	const res = run("git", ["status", "--porcelain", "--", dest], { cwd: root });
	if (res.code !== 0) return true; // not a git repo / git missing → assume dirty
	return res.stdout.trim().length > 0;
}

/** Build the status table. `latest` is null when --offline. */
export async function buildStatus(
	root: string,
	manifest: { upstreams: Record<string, UpstreamEntry> },
	latest: LatestFetcher | null,
): Promise<StatusRow[]> {
	const rows: StatusRow[] = [];
	for (const [name, entry] of Object.entries(manifest.upstreams)) {
		const vendor = readJson<{ ref?: string; resolvedSha?: string }>(
			join(root, entry.dest, "vendor.json"),
		);
		const vendoredRef = vendor?.ref ?? "MISSING";
		const vendoredSha = vendor?.resolvedSha ?? "MISSING";
		let latestRef: string | null = null;
		let latestVersion: string | null = null;
		if (latest) {
			const tag = await latest.latestTag(entry.repo);
			if (tag) {
				latestRef = tag;
			} else {
				// No tags (goal-loop-audit) → compare against default-branch HEAD
				// package.json version (design D6).
				const sha = await latest.headSha(entry.repo);
				latestRef = sha.slice(0, 12);
				latestVersion = (await latest.packageJsonVersion(entry.repo, sha)) ?? null;
			}
		}
		rows.push({
			name,
			vendoredRef,
			vendoredSha: vendoredSha.slice(0, 12),
			latestRef,
			latestVersion,
			local: destDirty(root, entry.dest) ? "dirty" : "clean",
		});
	}
	return rows;
}

export function renderStatus(rows: StatusRow[], offline: boolean): string {
	const lines: string[] = [];
	lines.push(`SYNC-UPSTREAM --status${offline ? " (offline)" : ""}`);
	lines.push("name              vendored           latest-upstream   local ");
	for (const r of rows) {
		const vend =
			r.vendoredRef === r.vendoredSha ? r.vendoredRef : `${r.vendoredRef}@${r.vendoredSha}`;
		const latest = r.latestRef
			? r.latestVersion
				? `${r.latestRef} (v${r.latestVersion})`
				: r.latestRef
			: "—";
		lines.push(`${r.name.padEnd(16)} ${vend.padEnd(19)} ${latest.padEnd(18)} ${r.local}`);
	}
	return lines.join("\n");
}

export interface CheckResult {
	problems: string[];
	entriesChecked: number;
}

/** Offline consistency check (SYNC-05 AC2) — never touches the network. */
export function runCheck(
	root: string,
	manifest: { upstreams: Record<string, UpstreamEntry> },
): CheckResult {
	const problems: string[] = [];
	let entriesChecked = 0;
	for (const [name, entry] of Object.entries(manifest.upstreams)) {
		entriesChecked += 1;
		const dest = join(root, entry.dest);
		const vendorFile = join(dest, "vendor.json");
		const vendor = readJson<{ ref?: string; npmName?: string; resolvedSha?: string }>(vendorFile);
		if (!vendor) {
			problems.push(
				`${name}: vendor.json missing/unparseable at ${relative(root, vendorFile)} — re-vendor with \`bun run vendor ${name} --force\``,
			);
			continue;
		}
		if (!vendor.resolvedSha || !/^[0-9a-f]{40}$/.test(vendor.resolvedSha)) {
			problems.push(`${name}: vendor.json missing valid resolvedSha`);
		}
		if (vendor.ref !== entry.ref)
			problems.push(`${name}: vendor.json ref "${vendor.ref}" != manifest ref "${entry.ref}"`);
		if (vendor.npmName !== entry.npmName)
			problems.push(
				`${name}: vendor.json npmName "${vendor.npmName}" != manifest "${entry.npmName}"`,
			);
		if (destDirty(root, entry.dest))
			problems.push(
				`${name}: dest ${entry.dest} has local changes (git status --porcelain not empty)`,
			);
	}
	return { problems, entriesChecked };
}
