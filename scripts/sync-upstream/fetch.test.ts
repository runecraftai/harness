/**
 * T7 — fetch/extract + TreeCache. A group sync (taskflow) fetches ONE tarball
 * per ref and materializes the 9 subpaths from the SAME extraction — this test
 * proves the sharing with LOCAL fixture tarballs (zero network).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFixtureFetcher, TreeCache, extractTarball } from "./fetch.ts";
import { makeTarball } from "./test-helpers.ts";
import { readText } from "./util.ts";

const REPO = "fixture/taskflow";
const SHA = "3c2dfdba9678673b8f18305b4533f8f3a62c1d1b";

describe("fetch — tarball extraction + subpath + group sharing", () => {
	test("extractTarball returns the single top-level dir", () => {
		const tmp = mkdtempSync(join(tmpdir(), "fetch-test-"));
		const tarball = makeTarball(
			"taskflow",
			SHA,
			[
				{ rel: "package.json", content: '{"name":"taskflow-core"}\n' },
				{ rel: "src/index.ts", content: "export const x = 1;\n" },
			],
			tmp,
		);
		const top = extractTarball(tarball, join(tmp, "out"));
		expect(existsSync(join(top, "src/index.ts"))).toBe(true);
		expect(readText(join(top, "package.json"))).toContain("taskflow-core");
	});

	test("TreeCache shares one extraction across 9 subpaths (group sync)", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "cache-test-"));
		const tarball = makeTarball(
			"taskflow",
			SHA,
			[
				{ rel: "packages/taskflow-core/package.json", content: '{"name":"taskflow-core"}\n' },
				{ rel: "packages/taskflow-core/src/index.ts", content: "core\n" },
				{ rel: "packages/pi-taskflow/package.json", content: '{"name":"pi-taskflow"}\n' },
				{ rel: "packages/pi-taskflow/src/index.ts", content: "pi\n" },
				{ rel: "packages/taskflow-mcp-core/src/mcp.ts", content: "mcp\n" },
			],
			tmp,
		);
		const fetcher = new LocalFixtureFetcher(REPO, { "v0.2.6": { sha: SHA, tarball } });
		const cache = new TreeCache(fetcher, tmp);

		const subpaths = [
			"packages/taskflow-core",
			"packages/pi-taskflow",
			"packages/taskflow-mcp-core",
			"packages/taskflow-dsl", // absent from tarball → must throw
		];

		const core = subpaths[0] as string;
		const pi = subpaths[1] as string;
		const a = await cache.get(REPO, "v0.2.6", core);
		const b = await cache.get(REPO, "v0.2.6", pi);
		expect(a.sha).toBe(SHA);
		expect(readText(join(a.dir, "package.json"))).toContain("taskflow-core");
		expect(readText(join(b.dir, "package.json"))).toContain("pi-taskflow");

		// Same (repo,ref) → same extraction dir (1 tarball, shared).
		expect(a.dir).not.toBe(b.dir); // subpath differs, extraction is shared below the subpath
		const parentOf = (d: string) => d.split("/").slice(0, -1).join("/");
		expect(parentOf(a.dir)).toBe(parentOf(b.dir));

		await expect(cache.get(REPO, "v0.2.6", subpaths[3] as string)).rejects.toThrow(/subpath/);
		cache.dispose();
	});

	test("TreeCache fetches the new ref once per repo across refs", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "cache-test2-"));
		const base = makeTarball(
			"taskflow",
			"a".repeat(40),
			[{ rel: "src.ts", content: "base\n" }],
			tmp,
		);
		const next = makeTarball(
			"taskflow",
			"b".repeat(40),
			[{ rel: "src.ts", content: "next\n" }],
			tmp,
		);
		const fetcher = new LocalFixtureFetcher(REPO, {
			"v0.1.0": { sha: "a".repeat(40), tarball: base },
			"v0.2.0": { sha: "b".repeat(40), tarball: next },
		});
		const cache = new TreeCache(fetcher, tmp);
		const one = await cache.get(REPO, "v0.1.0", null);
		const two = await cache.get(REPO, "v0.2.0", null);
		expect(readText(join(one.dir, "src.ts"))).toBe("base\n");
		expect(readText(join(two.dir, "src.ts"))).toBe("next\n");
		cache.dispose();
	});
});
