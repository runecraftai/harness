/**
 * Test helpers — offline fixture upstreams for the sync engine (F10).
 * Fixture tarballs are created in temp dirs; no network is ever touched.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncFetcher } from "./fetch.ts";
import { run } from "./util.ts";

export const SHA_BASE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const SHA_NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export interface FixtureFile {
	rel: string;
	content: string;
}

export function writeTree(root: string, files: FixtureFile[]): void {
	for (const f of files) {
		const file = join(root, f.rel);
		mkdirSync(
			file.split("/").slice(0, -1).join("/") ? join(root, ...f.rel.split("/").slice(0, -1)) : root,
			{
				recursive: true,
			},
		);
		writeFileSync(file, f.content, "utf8");
	}
}

/** Create a tarball whose single top-level dir is `<name>-<sha>` (GitHub style). */
export function makeTarball(
	repoName: string,
	sha: string,
	files: FixtureFile[],
	into: string,
): string {
	const base = mkdtempSync(join(tmpdir(), "fixture-src-"));
	const top = join(base, `${repoName}-${sha.slice(0, 7)}`);
	mkdirSync(top, { recursive: true });
	for (const f of files) {
		const file = join(top, f.rel);
		mkdirSync(join(top, ...f.rel.split("/").slice(0, -1)), { recursive: true });
		writeFileSync(file, f.content, "utf8");
	}
	const tarball = join(into, `${repoName}-${sha.slice(0, 7)}.tar.gz`);
	const res = run("tar", ["-czf", tarball, "-C", base, `${repoName}-${sha.slice(0, 7)}`]);
	if (res.code !== 0) throw new Error(`fixture tar failed: ${res.stderr}`);
	rmSync(base, { recursive: true, force: true });
	return tarball;
}

/** Serve fixture tarballs for (repo, ref) — resolveSha maps ref → sha. */
export class FixtureFetcher implements SyncFetcher {
	constructor(
		private readonly repo: string,
		private readonly refs: Record<string, { sha: string; tarball: string }>,
	) {}

	async resolveSha(_repo: string, ref: string): Promise<string> {
		const entry = this.refs[ref];
		if (!entry) throw new Error(`fixture: unknown ref ${ref}`);
		return entry.sha;
	}

	async downloadTarball(_repo: string, ref: string, destFile: string): Promise<void> {
		const entry = this.refs[ref];
		if (!entry) throw new Error(`fixture: unknown ref ${ref}`);
		const buf = await Bun.file(entry.tarball).arrayBuffer();
		await Bun.write(destFile, buf);
	}
}

/** Build a fixture monorepo root: vendor.manifest.json + a vendored dest. */
export function fixtureRoot(opts: {
	repo: string;
	name: string;
	npmName: string;
	ref: string;
	version: string;
	subpath?: string | null;
	destFiles: FixtureFile[];
}): string {
	const root = mkdtempSync(join(tmpdir(), "harness-fixture-root-"));
	const manifest = {
		upstreams: {
			[opts.name]: {
				repo: opts.repo,
				ref: opts.ref,
				npmName: opts.npmName,
				npmVersion: opts.version,
				subpath: opts.subpath ?? null,
				dest: `packages/${opts.name}`,
			},
		},
	};
	writeFileSync(join(root, "vendor.manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	const dest = join(root, "packages", opts.name);
	mkdirSync(dest, { recursive: true });
	writeTree(dest, opts.destFiles);
	return root;
}

/** Provenance file written by the vendoring flow (F1), mirroring vendor.ts. */
export function writeVendorJson(
	dest: string,
	opts: {
		repo: string;
		ref: string;
		sha: string;
		npmName: string;
		npmVersion: string;
		subpath?: string | null;
	},
): void {
	const v = {
		upstreamRepo: opts.repo,
		ref: opts.ref,
		resolvedSha: opts.sha,
		npmName: opts.npmName,
		npmVersion: opts.npmVersion,
		subpath: opts.subpath ?? null,
		vendoredAt: "2026-08-08T00:00:00.000Z",
	};
	writeFileSync(join(dest, "vendor.json"), `${JSON.stringify(v, null, "\t")}\n`);
}

/** Snapshot a tree as a sorted list of "rel:content-hash" lines for comparison. */
export function treeSnapshot(dir: string): string[] {
	const out: string[] = [];
	const visit = (d: string, prefix: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) visit(join(d, entry.name), rel);
			else {
				const bytes = readFileSync(join(d, entry.name));
				let hash = 0;
				for (const b of bytes) hash = (hash * 31 + b) >>> 0;
				out.push(`${rel}:${hash.toString(16)}`);
			}
		}
	};
	visit(dir, "");
	return out.sort();
}

export { join, mkdtempSync, readdirSync, rmSync, tmpdir };
