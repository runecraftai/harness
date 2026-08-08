/**
 * T6 — --status (vendored vs latest, injectable fetcher) + --check offline.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest } from "./manifest.ts";
import {
	GitHubLatestFetcher,
	type LatestFetcher,
	buildStatus,
	destDirty,
	renderStatus,
	runCheck,
} from "./report.ts";
import { writeTree, writeVendorJson } from "./test-helpers.ts";
import { run } from "./util.ts";

const tmpDirs: string[] = [];
afterEach(() => {
	while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

function repoRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "status-root-"));
	tmpDirs.push(root);
	const manifest = {
		upstreams: {
			subagents: {
				repo: "fixture/subagents",
				ref: "v0.37.2",
				npmName: "pi-subagents",
				npmVersion: "0.37.2",
				subpath: null,
				dest: "packages/subagents",
			},
			"goal-loop-audit": {
				repo: "fixture/gla",
				ref: "21b6bb0abdf5c21c88c976231f312465c3900128",
				npmName: "pi-goal-list-loop-audit",
				npmVersion: "0.28.34",
				subpath: null,
				dest: "packages/goal-loop-audit",
			},
		},
	};
	writeFileSync(join(root, "vendor.manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	for (const dest of ["packages/subagents", "packages/goal-loop-audit"]) {
		mkdirSync(join(root, dest), { recursive: true });
		writeTree(join(root, dest), [{ rel: "package.json", content: '{ "name": "x" }\n' }]);
	}
	writeVendorJson(join(root, "packages/subagents"), {
		repo: "fixture/subagents",
		ref: "v0.37.2",
		sha: "a".repeat(40),
		npmName: "pi-subagents",
		npmVersion: "0.37.2",
	});
	writeVendorJson(join(root, "packages/goal-loop-audit"), {
		repo: "fixture/gla",
		ref: "21b6bb0abdf5c21c88c976231f312465c3900128",
		sha: "b".repeat(40),
		npmName: "pi-goal-list-loop-audit",
		npmVersion: "0.28.34",
	});
	return root;
}

/** Fixture latest-fetcher: tag-based for subagents, SHA+package.json for gla. */
class FixtureLatest implements LatestFetcher {
	async latestTag(repo: string): Promise<string | null> {
		return repo === "fixture/subagents" ? "v0.39.0" : null;
	}
	async headSha(repo: string): Promise<string> {
		return "c".repeat(40);
	}
	async packageJsonVersion(_repo: string, _ref: string): Promise<string | null> {
		return "0.29.0";
	}
}

describe("T6 — --status", () => {
	test("status rows: vendored vs latest (tags / SHA+package.json for tagless repos) + local state", async () => {
		const root = repoRoot();
		const manifest = loadManifest(root);
		const rows = await buildStatus(root, manifest, new FixtureLatest());
		const subagents = rows.find((r) => r.name === "subagents");
		expect(subagents?.vendoredRef).toBe("v0.37.2");
		expect(subagents?.latestRef).toBe("v0.39.0");
		const gla = rows.find((r) => r.name === "goal-loop-audit");
		expect(gla?.latestRef).toBe("c".repeat(12));
		expect(gla?.latestVersion).toBe("0.29.0");
		const text = renderStatus(rows, false);
		expect(text).toContain("subagents");
		expect(text).toContain("v0.39.0");
	});

	test("offline status skips the network fetcher", async () => {
		const root = repoRoot();
		const manifest = loadManifest(root);
		const rows = await buildStatus(root, manifest, null);
		for (const r of rows) expect(r.latestRef).toBeNull();
	});

	test("dirty dest detection via git status --porcelain", () => {
		const root = repoRoot();
		run("git", ["init", "-q"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: root });
		expect(destDirty(root, "packages/subagents")).toBe(false);
		writeFileSync(join(root, "packages/subagents/package.json"), '{ "name": "dirty" }\n');
		expect(destDirty(root, "packages/subagents")).toBe(true);
	});
});

describe("T6 — --check (offline, CI-safe)", () => {
	test("clean committed tree → green", () => {
		const root = repoRoot();
		run("git", ["init", "-q"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: root });
		const manifest = loadManifest(root);
		const result = runCheck(root, manifest);
		expect(result.problems).toEqual([]);
	});

	test("missing vendor.json + dirty dest → red report pointing at the entry", () => {
		const root = repoRoot();
		run("git", ["init", "-q"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: root });
		run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: root });
		rmSync(join(root, "packages/goal-loop-audit/vendor.json"));
		writeFileSync(join(root, "packages/subagents/package.json"), "dirty\n");
		const manifest = loadManifest(root);
		const result = runCheck(root, manifest);
		expect(result.problems.some((p) => p.startsWith("goal-loop-audit:"))).toBe(true);
		expect(
			result.problems.some((p) => p.startsWith("subagents:") && p.includes("local changes")),
		).toBe(true);
	});
});

describe("T6 — GitHubLatestFetcher shape (no network in tests)", () => {
	test("class exists and exposes the LatestFetcher surface", () => {
		const f = new GitHubLatestFetcher();
		expect(typeof f.latestTag).toBe("function");
		expect(typeof f.headSha).toBe("function");
		expect(typeof f.packageJsonVersion).toBe("function");
	});
});
