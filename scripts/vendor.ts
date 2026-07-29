#!/usr/bin/env bun
/**
 * Vendoring script: fetches a pinned upstream GitHub source tarball and extracts
 * it into the destination package directory, recording provenance in vendor.json.
 *
 * Usage:
 *   bun scripts/vendor.ts --list
 *   bun scripts/vendor.ts <name> [--force]
 *
 * Names come from vendor.manifest.json. GitHub tarballs contain no .git/ directory,
 * so vendored copies carry full source (including tests) without history.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface Upstream {
	repo: string;
	ref: string;
	npmName: string;
	npmVersion: string;
	subpath: string | null;
	dest: string;
}

interface Manifest {
	upstreams: Record<string, Upstream>;
}

const ROOT = resolve(import.meta.dir, "..");
const MANIFEST_PATH = join(ROOT, "vendor.manifest.json");

function fail(message: string): never {
	console.error(`vendor: ${message}`);
	process.exit(1);
}

async function loadManifest(): Promise<Manifest> {
	if (!existsSync(MANIFEST_PATH)) fail(`manifest not found at ${MANIFEST_PATH}`);
	return (await Bun.file(MANIFEST_PATH).json()) as Manifest;
}

function listUpstreams(manifest: Manifest): void {
	const entries = Object.entries(manifest.upstreams);
	console.log(`${entries.length} pinned upstream(s):\n`);
	for (const [name, u] of entries) {
		const sub = u.subpath ? ` (subpath ${u.subpath})` : "";
		console.log(
			`  ${name.padEnd(16)} ${u.repo}@${u.ref}${sub} -> ${u.dest}  [${u.npmName}@${u.npmVersion}]`,
		);
	}
}

async function githubJson(url: string): Promise<Record<string, unknown>> {
	const res = await fetch(url, {
		headers: { "User-Agent": "runecraft-harness-vendor", Accept: "application/vnd.github+json" },
	});
	if (!res.ok) fail(`GitHub API ${res.status} for ${url}`);
	return (await res.json()) as Record<string, unknown>;
}

async function resolveSha(repo: string, ref: string): Promise<string> {
	const data = await githubJson(`https://api.github.com/repos/${repo}/commits/${ref}`);
	const sha = data.sha;
	if (typeof sha !== "string" || sha.length !== 40)
		fail(`could not resolve SHA for ${repo}@${ref}`);
	return sha;
}

async function downloadTarball(repo: string, ref: string, destFile: string): Promise<void> {
	const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`;
	const res = await fetch(url, { headers: { "User-Agent": "runecraft-harness-vendor" } });
	if (!res.ok) fail(`tarball download failed (${res.status}) for ${url}`);
	const body = await res.arrayBuffer();
	if (body.byteLength === 0) fail(`empty tarball from ${url}`);
	await Bun.write(destFile, body);
}

async function extractTarball(tarball: string, into: string): Promise<string> {
	mkdirSync(into, { recursive: true });
	const proc = Bun.spawn(["tar", "-xzf", tarball, "-C", into], { stderr: "pipe" });
	const code = await proc.exited;
	if (code !== 0) {
		const err = await new Response(proc.stderr).text();
		fail(`tar extraction failed: ${err.trim()}`);
	}
	const top = readdirSync(into);
	if (top.length !== 1 || top[0] === undefined)
		fail(`expected single top-level dir in tarball, found: ${top.join(", ")}`);
	return join(into, top[0]);
}

async function vendor(name: string, force: boolean): Promise<void> {
	const manifest = await loadManifest();
	const upstream = manifest.upstreams[name];
	if (!upstream) {
		fail(`unknown upstream "${name}". Known: ${Object.keys(manifest.upstreams).join(", ")}`);
	}

	const dest = join(ROOT, upstream.dest);
	if (existsSync(dest) && readdirSync(dest).length > 0) {
		if (!force) fail(`${upstream.dest} already exists and is not empty. Use --force to overwrite.`);
		rmSync(dest, { recursive: true, force: true });
	}

	console.log(`vendor: resolving ${upstream.repo}@${upstream.ref}`);
	const resolvedSha = await resolveSha(upstream.repo, upstream.ref);
	console.log(`vendor: resolved to ${resolvedSha}`);

	const tmp = mkdtempSync(join(tmpdir(), "harness-vendor-"));
	try {
		const tarball = join(tmp, "src.tar.gz");
		console.log("vendor: downloading source tarball");
		await downloadTarball(upstream.repo, upstream.ref, tarball);

		const extracted = join(tmp, "extracted");
		const topDir = await extractTarball(tarball, extracted);

		const sourceDir = upstream.subpath ? join(topDir, upstream.subpath) : topDir;
		if (!existsSync(sourceDir)) {
			const available = readdirSync(topDir).join(", ");
			fail(`subpath "${upstream.subpath}" not found in tarball. Top-level contents: ${available}`);
		}

		mkdirSync(dirname(dest), { recursive: true });
		cpSync(sourceDir, dest, { recursive: true });

		const provenance = {
			upstreamRepo: upstream.repo,
			ref: upstream.ref,
			resolvedSha,
			npmName: upstream.npmName,
			npmVersion: upstream.npmVersion,
			subpath: upstream.subpath,
			vendoredAt: new Date().toISOString(),
		};
		writeFileSync(join(dest, "vendor.json"), `${JSON.stringify(provenance, null, "\t")}\n`);

		console.log(`vendor: done -> ${upstream.dest} (vendor.json written)`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
	console.log("Usage: bun scripts/vendor.ts --list | <name> [--force]");
	process.exit(args.length === 0 ? 1 : 0);
}

if (args.includes("--list")) {
	listUpstreams(await loadManifest());
} else {
	const name = args.find((a) => !a.startsWith("--"));
	if (!name) fail("missing upstream name");
	await vendor(name, args.includes("--force"));
}
