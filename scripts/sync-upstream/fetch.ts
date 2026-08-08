/**
 * Tarball fetch/extract for the sync engine (F10 D3, SYNC-01).
 *
 * Real mode (GitHubFetcher) follows the vendor.ts pattern: resolve the SHA via
 * the GitHub API, download the source tarball from codeload, extract with tar.
 * The `SyncFetcher` interface is injectable so tests can serve LOCAL fixture
 * tarballs — the engine itself never touches the network.
 *
 * The SYNC is manual + networked by design (hard constraint); --check/--status
 * are the offline surfaces.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./util.ts";

export interface SyncFetcher {
	/** Resolve a tag/branch/SHA ref to a full 40-hex commit SHA. */
	resolveSha(repo: string, ref: string): Promise<string>;
	/** Download the source tarball for repo@ref into destFile. */
	downloadTarball(repo: string, ref: string, destFile: string): Promise<void>;
}

/** Real implementation (network — manual sync only, never CI). */
export class GitHubFetcher implements SyncFetcher {
	private readonly ua = "runecraft-harness-sync-upstream";

	async resolveSha(repo: string, ref: string): Promise<string> {
		const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
		const res = await fetch(url, {
			headers: { "User-Agent": this.ua, Accept: "application/vnd.github+json" },
		});
		if (!res.ok) {
			throw new Error(`GitHub API ${res.status} for ${url} (ref ${ref} not resolvable?)`);
		}
		const data = (await res.json()) as { sha?: unknown };
		if (typeof data.sha !== "string" || data.sha.length !== 40) {
			throw new Error(`could not resolve SHA for ${repo}@${ref}`);
		}
		return data.sha;
	}

	async downloadTarball(repo: string, ref: string, destFile: string): Promise<void> {
		const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
		const res = await fetch(url, { headers: { "User-Agent": this.ua } });
		if (!res.ok) throw new Error(`tarball download failed (${res.status}) for ${url}`);
		const body = await res.arrayBuffer();
		if (body.byteLength === 0) throw new Error(`empty tarball from ${url}`);
		await Bun.write(destFile, body);
	}
}

/**
 * Local fixture fetcher — serves LOCAL tarballs for (repo, ref) with fixed
 * SHAs. Used by tests and by the CLI's SYNC_UPSTREAM_FIXTURE hook (offline
 * end-to-end runs against fixture "upstreams"; zero network).
 */
export class LocalFixtureFetcher implements SyncFetcher {
	constructor(
		private readonly repo: string,
		private readonly refs: Record<string, { sha: string; tarball: string }>,
	) {}

	private entryFor(ref: string): { sha: string; tarball: string } {
		const byRef = this.refs[ref];
		if (byRef) return byRef;
		// ref may already be a resolved SHA (base = vendor.json resolvedSha).
		const bySha = Object.values(this.refs).find((e) => e.sha === ref);
		if (bySha) return bySha;
		throw new Error(`fixture fetcher: unknown ref ${ref}`);
	}

	async resolveSha(_repo: string, ref: string): Promise<string> {
		return this.entryFor(ref).sha;
	}

	async downloadTarball(_repo: string, ref: string, destFile: string): Promise<void> {
		const entry = this.entryFor(ref);
		const buf = await Bun.file(entry.tarball).arrayBuffer();
		await Bun.write(destFile, buf);
	}
}

/** Build a LocalFixtureFetcher from a SYNC_UPSTREAM_FIXTURE JSON file. */
export function fixtureFetcherFromFile(file: string): SyncFetcher {
	const data = JSON.parse(readFileSync(file, "utf8")) as {
		repo: string;
		refs: Record<string, { sha: string; tarball: string }>;
	};
	return new LocalFixtureFetcher(data.repo, data.refs);
}
/** Extract a tarball into `into`; returns the single top-level dir path. */
export function extractTarball(tarball: string, into: string): string {
	mkdirSync(into, { recursive: true });
	const res = run("tar", ["-xzf", tarball, "-C", into]);
	if (res.code !== 0) {
		throw new Error(`tar extraction failed: ${res.stderr.trim() || res.stdout.trim()}`);
	}
	const top = readdirSync(into);
	if (top.length !== 1 || top[0] === undefined) {
		throw new Error(`expected single top-level dir in tarball, found: ${top.join(", ")}`);
	}
	return join(into, top[0]);
}

/** Fetch + extract repo@ref and return the tree root (subpath applied). */
export async function materializeTree(
	fetcher: SyncFetcher,
	repo: string,
	ref: string,
	subpath: string | null,
	into: string,
): Promise<{ dir: string; sha: string }> {
	const sha = await fetcher.resolveSha(repo, ref);
	rmSync(into, { recursive: true, force: true });
	mkdirSync(into, { recursive: true });
	const tarball = join(into, "src.tar.gz");
	await fetcher.downloadTarball(repo, ref, tarball);
	const topDir = extractTarball(tarball, join(into, "extracted"));
	const dir = subpath ? join(topDir, subpath) : topDir;
	if (!existsSync(dir)) {
		throw new Error(`subpath "${subpath}" not found in tarball of ${repo}@${ref}`);
	}
	return { dir, sha };
}

/**
 * Cache a fetched+extracted tree by (repo, ref) — the taskflow group fetches
 * ONE tarball for 9 subpaths (SYNC-06).
 */
export class TreeCache {
	private readonly entries = new Map<string, { dir: string; sha: string }>();
	private readonly tmpDirs = new Set<string>();

	constructor(
		private readonly fetcher: SyncFetcher,
		private readonly tmpBase: string,
	) {}

	async get(
		repo: string,
		ref: string,
		subpath: string | null,
	): Promise<{ dir: string; sha: string }> {
		const key = `${repo}@${ref}`;
		let entry = this.entries.get(key);
		if (!entry) {
			const dir = mkdtempSync(join(this.tmpBase, "tree-"));
			this.tmpDirs.add(dir);
			const sha = await this.fetcher.resolveSha(repo, ref);
			const tarball = join(dir, "src.tar.gz");
			await this.fetcher.downloadTarball(repo, ref, tarball);
			const topDir = extractTarball(tarball, join(dir, "extracted"));
			entry = { dir: topDir, sha };
			this.entries.set(key, entry);
		}
		const sub = subpath ? join(entry.dir, subpath) : entry.dir;
		if (!existsSync(sub)) {
			throw new Error(`subpath "${subpath}" not found in tarball of ${repo}@${ref}`);
		}
		return { dir: sub, sha: entry.sha };
	}

	dispose(): void {
		for (const dir of this.tmpDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		this.tmpDirs.clear();
		this.entries.clear();
	}
}

export { existsSync, join, mkdtempSync, tmpdir };
