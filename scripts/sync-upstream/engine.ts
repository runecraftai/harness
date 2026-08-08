/**
 * Sync orchestration (F10 SYNC-01/02/03/06/07).
 *
 * Per entry (or per group): fetch base (pinned resolvedSha tarball) + theirs
 * (--to tarball) → three-way merge into staging → auto-rename pass on the
 * merged tree → atomic copy over the dest → conditional provenance update.
 *
 * Fail-closed: on ANY conflict the whole cycle aborts with ZERO writes
 * (working tree, vendor.json and manifest untouched). Groups are atomic: one
 * conflicted member blocks every member's writes (SYNC-06: 1 report, 1
 * provenance update, 1 commit).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFor } from "./config.ts";
import { type SyncFetcher, TreeCache } from "./fetch.ts";
import {
	type Manifest,
	type UpstreamEntry,
	groupMembers,
	loadManifest,
	loadVendorJson,
} from "./manifest.ts";
import { threeWayMerge } from "./merge.ts";
import { updateManifestEntry, writeVendorJson } from "./provenance.ts";
import { applyRenamePass } from "./rename.ts";
import {
	type SyncReport,
	type SyncReportEntry,
	computeUpstreamDelta,
	intersectRegistry,
	loadRegistry,
} from "./report.ts";
import { copyFile, isExcluded, readJson, removeIfExists, walk } from "./util.ts";

export interface SyncOptions {
	root: string;
	fetcher: SyncFetcher;
	name?: string;
	group?: string;
	to: string;
	baseOverride?: string;
	dryRun: boolean;
}

function readNpmVersion(treeDir: string): string | null {
	const pkg = readJson<{ version?: unknown }>(join(treeDir, "package.json"));
	return pkg && typeof pkg.version === "string" ? pkg.version : null;
}

/** Sync staging tree into the dest: copy merged files, remove dest files the
 *  merge deleted (excluding config-excluded paths like node_modules/dist). */
export function applyStagingToDest(dest: string, staging: string, excludes: string[]): void {
	mkdirSync(dest, { recursive: true });
	const staged = new Set(walk(staging));
	for (const rel of staged) {
		copyFile(join(staging, rel), join(dest, rel));
	}
	for (const rel of walk(dest)) {
		if (!staged.has(rel) && !isExcluded(rel, excludes)) {
			rmSync(join(dest, rel), { force: true });
		}
	}
}

export async function runSync(opts: SyncOptions): Promise<SyncReport> {
	const manifest = loadManifest(opts.root);
	const entries: { name: string; entry: UpstreamEntry }[] = opts.group
		? groupMembers(manifest, opts.group)
		: (() => {
				const entry = manifest.upstreams[opts.name as string];
				if (!entry) {
					throw new Error(
						`unknown upstream "${opts.name}". Known: ${Object.keys(manifest.upstreams).join(", ")}`,
					);
				}
				return [{ name: opts.name as string, entry }];
			})();
	if (entries.length === 0) {
		throw new Error(
			`unknown upstream "${opts.name}". Known: ${Object.keys(manifest.upstreams).join(", ")}`,
		);
	}

	const tmpBase = mkdtempSync(join(tmpdir(), "harness-sync-"));
	const treeCache = new TreeCache(opts.fetcher, tmpBase);
	const report: SyncReport = {
		dryRun: opts.dryRun,
		group: opts.group ?? null,
		entries: [],
		conflicted: false,
	};

	// Resolve the new SHA once per repo (a group shares one tarball — SYNC-06).
	const newShaByRepo = new Map<string, string>();
	for (const { entry } of entries) {
		if (!newShaByRepo.has(entry.repo)) {
			newShaByRepo.set(entry.repo, await opts.fetcher.resolveSha(entry.repo, opts.to));
		}
	}

	// Phase 1: merge every entry into staging (no writes yet).
	const phase: {
		name: string;
		entry: UpstreamEntry;
		vendorSha: string;
		staging: string;
		base: string;
		theirs: string;
		theirsVersion: string | null;
	}[] = [];
	for (const { name, entry } of entries) {
		const vendor = loadVendorJson(opts.root, entry.dest);
		const baseSha = opts.baseOverride ?? vendor.resolvedSha;
		const newSha = newShaByRepo.get(entry.repo) as string;
		const base = await treeCache.get(entry.repo, baseSha, entry.subpath);
		const theirs = await treeCache.get(entry.repo, newSha, entry.subpath);
		const staging = join(tmpBase, `staging-${name}`);
		const merge = threeWayMerge({
			baseDir: base.dir,
			theirsDir: theirs.dir,
			oursDir: join(opts.root, entry.dest),
			stagingDir: staging,
			excludes: configFor(name).excludeFiles,
		});
		const delta = intersectRegistry(
			computeUpstreamDelta(base.dir, theirs.dir),
			loadRegistry(opts.root, name),
		);
		phase.push({
			name,
			entry,
			vendorSha: vendor.resolvedSha,
			staging,
			base: base.dir,
			theirs: theirs.dir,
			theirsVersion: readNpmVersion(theirs.dir),
		});

		const entryReport: SyncReportEntry = {
			name,
			dest: entry.dest,
			delta,
			merge,
			renamePass: { filesTouched: [] },
		};
		report.entries.push(entryReport);
		if (merge.kind === "conflict") report.conflicted = true;
	}

	// Fail-closed: ANY conflict → zero writes.
	if (report.conflicted) {
		removeIfExists(tmpBase);
		return report;
	}

	// Phase 2: rename pass on the merged trees.
	for (const p of phase) {
		const rep = report.entries.find((e) => e.name === p.name);
		if (rep) {
			const renamePass = applyRenamePass(p.staging, configFor(p.name).renameMap);
			rep.renamePass = { filesTouched: renamePass.filesTouched };
		}
	}

	// Phase 3: apply to dest + provenance (skipped in dry-run).
	if (!opts.dryRun) {
		const syncedAt = new Date().toISOString();
		for (const p of phase) {
			applyStagingToDest(join(opts.root, p.entry.dest), p.staging, configFor(p.name).excludeFiles);
			writeVendorJson(opts.root, p.entry.dest, {
				ref: opts.to,
				resolvedSha: newShaByRepo.get(p.entry.repo) as string,
				npmVersion: p.theirsVersion ?? loadVendorJson(opts.root, p.entry.dest).npmVersion,
				syncedAt,
			});
			updateManifestEntry(opts.root, p.name, {
				ref: opts.to,
				resolvedSha: newShaByRepo.get(p.entry.repo) as string,
				npmVersion: p.theirsVersion ?? loadVendorJson(opts.root, p.entry.dest).npmVersion,
				syncedAt,
			});
		}
	}

	removeIfExists(tmpBase);
	return report;
}

export { existsSync, join };
