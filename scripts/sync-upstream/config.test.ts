/**
 * T5/T10 — config completeness validated against the 12 REAL dests (offline).
 *
 * Runs the rename pass over COPIES of the real fork source trees and asserts
 * zero upstream module-specifier references remain — including the REAL
 * BUG-1 occurrences in packages/taskflow/pi/src/index.ts (dynamic
 * `import("taskflow-core")` + `import.meta.resolve("taskflow-core/...")`).
 * Prose/log prefixes (e.g. `[pi-subagents] watchdog ...`) are untouched.
 */

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configFor } from "./config.ts";
import { loadManifest } from "./manifest.ts";
import { applyRenamePass } from "./rename.ts";
import { isExcluded, walk } from "./util.ts";

const ROOT = resolve(import.meta.dir, "../..");
const UPSTREAM_SPECIFIERS = [
	"pi-subagents",
	"pi-taskflow",
	"taskflow-core",
	"taskflow-dsl",
	"taskflow-mcp-core",
	"taskflow-hosts",
	"codex-taskflow",
	"claude-taskflow",
	"opencode-taskflow",
	"grok-taskflow",
	"pi-goal-list-loop-audit",
	"pi-pr-review",
];

/** Copy the source files of a dest into a temp tree (no node_modules/dist). */
function copySourceTree(dest: string): string {
	const tree = mkdtempSync(join(tmpdir(), "cfg-copy-"));
	for (const rel of walk(dest)) {
		if (
			isExcluded(rel, [
				"node_modules/**",
				"dist/**",
				".turbo/**",
				"vendor.json",
				"package-lock.json",
			])
		)
			continue;
		const from = join(dest, rel);
		const to = join(tree, rel);
		cpSync(from, to);
	}
	return tree;
}

describe("T5 — config rename maps cover the 12 real dests", () => {
	const manifest = loadManifest(ROOT);

	test("every manifest entry has a config whose renameMap covers its npmName", () => {
		for (const [name, entry] of Object.entries(manifest.upstreams)) {
			const map = configFor(name).renameMap;
			expect(map[entry.npmName], `${name}: renameMap missing ${entry.npmName}`).toBeDefined();
		}
	});

	test("the full shared map is applied to every fork (cross-fork specifiers)", () => {
		for (const name of Object.keys(manifest.upstreams)) {
			const map = configFor(name).renameMap;
			for (const spec of UPSTREAM_SPECIFIERS)
				expect(map[spec], `${name}: missing ${spec}`).toBeDefined();
		}
	});

	test("BUG-1: the real taskflow pi source carries un-renamed dynamic imports today", () => {
		const src = readFileSync(join(ROOT, "packages/taskflow/pi/src/index.ts"), "utf8");
		expect(src).toMatch(/import\("taskflow-core"\)/);
		expect(src).toMatch(/import\.meta\.resolve\("taskflow-core\/detached-runner"\)/);
	});

	test("rename pass over copies of ALL 12 real dests leaves zero upstream specifier contexts", () => {
		const leftovers: string[] = [];
		// The SAME context regex the pass targets: from/import/import()/import.meta.resolve/require.
		// Prose (README/CHANGELOG) and runtime string literals (log prefixes, temp dirs) are
		// intentionally out of scope (design D4 — token-aware pass).
		const specAlternation = UPSTREAM_SPECIFIERS.join("|");
		// Quote classes in plain strings so the template below never contains a raw backtick.
		const qc = "([\"'`])";
		const contextRe = new RegExp(
			`((?:from|import)\\s*|import\\(\\s*|import\\.meta\\.resolve\\(\\s*|require\\(\\s*)${qc}(?:${specAlternation})(?:/|${qc})`,
			"g",
		);
		for (const [name, entry] of Object.entries(manifest.upstreams)) {
			const dest = join(ROOT, entry.dest);
			if (!existsSync(dest)) continue;
			const tree = copySourceTree(dest);
			applyRenamePass(tree, configFor(name).renameMap);
			for (const rel of walk(tree)) {
				if (!/\.(ts|js|mjs|cjs|mts|cts|tsx|jsx)$/.test(rel)) continue;
				const content = readFileSync(join(tree, rel), "utf8");
				contextRe.lastIndex = 0;
				const m = content.match(contextRe);
				if (m) leftovers.push(`${name}/${rel}: ${m.join(", ")}`);
			}
		}
		expect(leftovers, "upstream specifiers left in module-specifier contexts").toEqual([]);
	});

	test("prose log prefixes are NOT renamed (token-aware scope)", () => {
		const tree = copySourceTree(join(ROOT, "packages/subagents"));
		applyRenamePass(tree, configFor("subagents").renameMap);
		const watchdog = readFileSync(join(tree, "src/watchdog/change-signature.ts"), "utf8");
		expect(watchdog).toContain('"[pi-subagents] watchdog');
	});
});
