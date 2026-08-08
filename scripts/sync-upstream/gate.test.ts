/**
 * T8 — post-sync gate policy (SYNC-09).
 *
 *  - `--update` is refused when CI=true (fail-closed — mirrors F23's policy)
 *  - biome step lints ONLY tracked root-level paths (never .pi/.guild)
 *  - known-failures.txt policy: empty or the gate fails
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UpdateRefusedError, assertUpdateAllowed, biomeCheck, packageTests } from "./gate.ts";
import { run } from "./util.ts";

const ROOT = resolve(import.meta.dir, "../..");

describe("T8 — gate policy", () => {
	test("--update refused when CI=true (fail-closed, no autocorrection)", () => {
		const prev = process.env.CI ?? "";
		try {
			process.env.CI = "true";
			expect(() => assertUpdateAllowed()).toThrow(UpdateRefusedError);
			process.env.CI = "1";
			expect(() => assertUpdateAllowed()).toThrow(UpdateRefusedError);
		} finally {
			process.env.CI = prev;
		}
	});

	test("--update allowed locally (CI unset)", () => {
		const prev = process.env.CI ?? "";
		try {
			process.env.CI = "";
			expect(() => assertUpdateAllowed()).not.toThrow();
		} finally {
			process.env.CI = prev;
		}
	});

	test("biome gate lints only tracked root-level paths — excludes .pi/.guild", () => {
		// The real repo has untracked .pi/.guild dirs with JSON that fails biome;
		// the gate must lint tracked files only and stay green.
		const res = biomeCheck(ROOT);
		expect(res.ok, res.detail).toBe(true);
		expect(res.detail).not.toContain(".pi");
	});

	test("known-failures.txt stays empty (new failures never enter the ratchet)", () => {
		const file = join(ROOT, "packages/harness/test/eval/baselines/known-failures.txt");
		if (existsSync(file)) {
			const body = readFileSync(file, "utf8")
				.split("\n")
				.filter((l) => l && !l.startsWith("#"));
			expect(body.length).toBe(0);
		}
	});
});

describe("T8 — gate subprocess (CI policy via the real CLI)", () => {
	test("packageTests runs the MCPL-06 glob through the shell (real tests, not zero)", () => {
		const res = packageTests(ROOT, "taskflow-mcp-core", "packages/taskflow/mcp-core");
		expect(res.ok, res.detail).toBe(true);
		expect(res.detail).not.toMatch(/duration_ms 0\./); // glob expanded → tests actually ran
	});

	test("CLI --gate --update refuses early under CI=true (no chain runs)", () => {
		const prev = process.env.CI ?? "";
		const start = Date.now();
		const res = run("bun", ["scripts/sync-upstream.ts", "--gate", "--update"], {
			cwd: ROOT,
			env: { CI: "true" },
		});
		const elapsed = Date.now() - start;
		expect(res.code).toBe(1);
		expect(res.stdout).toContain("CI=true");
		expect(elapsed).toBeLessThan(10_000); // refused before any heavy step
		process.env.CI = prev;
	});
});
