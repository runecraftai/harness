/**
 * T2 — three-way merge engine (SYNC-01). Fixture trees, zero network.
 * Validates the D1 classification table + `git merge-file` behavior on real
 * fixture trees (clean merge, diff3 conflict markers, modify/delete, binary).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MergeResult, gitMergeFile, threeWayMerge } from "./merge.ts";
import { readText } from "./util.ts";

function tree(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "merge-tree-"));
	for (const [rel, content] of Object.entries(files)) {
		const file = join(dir, rel);
		mkdirSync(
			file.split("/").slice(0, -1).join("/") ? join(dir, ...rel.split("/").slice(0, -1)) : dir,
			{
				recursive: true,
			},
		);
		writeFileSync(file, content, "utf8");
	}
	return dir;
}

function runMerge(
	base: Record<string, string>,
	theirs: Record<string, string>,
	ours: Record<string, string>,
	excludes: string[] = [],
): { result: MergeResult; staging: string } {
	const baseDir = tree(base);
	const theirsDir = tree(theirs);
	const oursDir = tree(ours);
	const staging = mkdtempSync(join(tmpdir(), "merge-staging-"));
	const result = threeWayMerge({ baseDir, theirsDir, oursDir, stagingDir: staging, excludes });
	return { result, staging };
}

describe("threeWayMerge — git merge-file on fixture trees", () => {
	test("clean merge applies upstream change and keeps ours", () => {
		const base = { "a.txt": "l1\nl2\nl3\nl4\nl5\nl6\n" };
		const ours = { "a.txt": "l1\nOURS\nl3\nl4\nl5\nl6\n" };
		const theirs = { "a.txt": "l1\nl2\nl3\nl4\nTHEIRS\nl6\n" };
		const { result, staging } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("clean");
		expect(result.conflicts).toEqual([]);
		expect(result.applied).toContain("a.txt");
		const merged = readText(join(staging, "a.txt"));
		expect(merged).toContain("OURS");
		expect(merged).toContain("THEIRS");
		expect(merged).not.toContain("<<<<<<<");
	});

	test("near-adjacent edits on both sides surface as a conflict (git merge-file is conservative)", () => {
		const base = { "a.txt": "l1\nl2\nl3\nl4\nl5\nl6\n" };
		const ours = { "a.txt": "l1\nOURS\nl3\nl4\nl5\nl6\n" };
		const theirs = { "a.txt": "l1\nl2\nTHEIRS\nl4\nl5\nl6\n" }; // same hunk region
		const { result } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("conflict");
		expect(result.conflicts).toEqual([{ rel: "a.txt", reason: "conflict" }]);
	});

	test("conflict writes diff3 markers in staging and reports fail-closed", () => {
		const base = { "a.txt": "line1\nline2\nline3\n" };
		const ours = { "a.txt": "line1\nOURS-2\nline3\n" };
		const theirs = { "a.txt": "line1\nTHEIRS-2\nline3\n" };
		const { result } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("conflict");
		expect(result.conflicts).toEqual([{ rel: "a.txt", reason: "conflict" }]);
		// nothing written to ours: the engine only stages
		expect(result.applied).not.toContain("a.txt");
	});

	test("new upstream file is copied", () => {
		const base: Record<string, string> = {};
		const ours: Record<string, string> = {};
		const theirs = { "new.ts": "export const x = 1;\n" };
		const { result, staging } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("clean");
		expect(result.applied).toContain("new.ts");
		expect(readText(join(staging, "new.ts"))).toBe("export const x = 1;\n");
	});

	test("delete preserved when we deleted and upstream left it unchanged (F2 install.mjs)", () => {
		const base = { "install.mjs": "console.log('installer');\n", "keep.txt": "k\n" };
		const ours = { "keep.txt": "k\n" }; // install.mjs deleted by us
		const theirs = { "install.mjs": "console.log('installer');\n", "keep.txt": "k\n" }; // unchanged
		const { result, staging } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("clean");
		expect(result.kept).toContain("install.mjs"); // deletion preserved
		expect(stagingHas(staging, "install.mjs")).toBe(false);
	});

	test("modify/delete conflict when upstream changed a file we deleted", () => {
		const base = { "f.js": "v1\n" };
		const ours = {}; // deleted by us
		const theirs = { "f.js": "v2-changed\n" };
		const { result } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("conflict");
		expect(result.conflicts).toEqual([{ rel: "f.js", reason: "modify-delete" }]);
	});

	test("upstream deleted a file we modified → kept ours + divergence reported", () => {
		const base = { "g.js": "v1\n" };
		const ours = { "g.js": "v1\nOURS\n" };
		const theirs = {}; // upstream deleted
		const { result, staging } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("clean");
		expect(result.divergences).toContain("g.js");
		expect(stagingHas(staging, "g.js")).toBe(true);
	});

	test("upstream deleted an untouched file → deletion applies", () => {
		const base = { "gone.md": "old\n" };
		const ours = { "gone.md": "old\n" };
		const theirs = {};
		const { result, staging } = runMerge(base, theirs, ours);
		expect(result.kind).toBe("clean");
		expect(result.deleted).toContain("gone.md");
		expect(stagingHas(staging, "gone.md")).toBe(false);
	});

	test("both sides added the same new file → kept; different content → conflict", () => {
		const base: Record<string, string> = {};
		const ours = { "shared.ts": "same\n" };
		const theirs = { "shared.ts": "same\n" };
		expect(runMerge(base, theirs, ours).result.kind).toBe("clean");
		const ours2 = { "shared.ts": "ours\n" };
		const theirs2 = { "shared.ts": "theirs\n" };
		expect(runMerge(base, theirs2, ours2).result.kind).toBe("conflict");
	});

	test("binary changed on both sides → conflict; unchanged → kept", () => {
		const base = { "img.bin": "\x00\x01\x02" };
		const ours = { "img.bin": "\x00\x01\x02" };
		const theirs = { "img.bin": "\x00\x01\x02" };
		expect(runMerge(base, theirs, ours).result.kind).toBe("clean");
		const theirs2 = { "img.bin": "\x00\x01\x03" };
		expect(runMerge(base, theirs2, ours).result.kind).toBe("conflict");
	});

	test("excludes remove paths from the universe", () => {
		const base: Record<string, string> = {};
		const theirs = { "dist/bundle.js": "theirs\n", "src/a.ts": "x\n" };
		const ours = { "dist/bundle.js": "ours-local-build\n", "src/a.ts": "x\n" };
		const { result } = runMerge(base, theirs, ours, ["dist/**"]);
		expect(result.kind).toBe("clean");
		expect(result.kept).toContain("src/a.ts"); // both added identically → kept
		expect(result.applied).not.toContain("dist/bundle.js");
		expect(result.kept).not.toContain("dist/bundle.js");
	});

	test("gitMergeFile produces diff3 markers on conflict (format)", () => {
		const base = tree({ "a.txt": "l1\nl2\nl3\n" });
		const ours = tree({ "a.txt": "l1\nO\nl3\n" });
		const theirs = tree({ "a.txt": "l1\nl2\nT\n" });
		const staging = mkdtempSync(join(tmpdir(), "merge-staging2-"));
		const res = gitMergeFile(
			staging,
			"a.txt",
			join(base, "a.txt"),
			join(theirs, "a.txt"),
			join(ours, "a.txt"),
		);
		expect(res.clean).toBe(false);
		expect(res.content).toContain("<<<<<<< ours");
		expect(res.content).toContain("||||||| base");
		expect(res.content).toContain(">>>>>>> theirs");
	});
});

function stagingHas(staging: string, rel: string): boolean {
	return existsSync(join(staging, rel));
}
