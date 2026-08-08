/**
 * T1/T6 — registries + manifest validation. Registry schema checks: JSON
 * parses, required fields, cited files exist in the dest, cited commits exist
 * in `git log`. Also validates the manifest/vendor.json plumbing against the
 * REAL repo (offline, read-only).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { groupMembers, loadManifest, validateManifest, validateVendorJson } from "./manifest.ts";
import { loadRegistry } from "./report.ts";
import { run } from "./util.ts";

const ROOT = resolve(import.meta.dir, "../..");

const REQUIRED_FIELDS = ["id", "title", "type", "files", "commits", "status"] as const;

describe("T1 — divergence registries (patches/<fork>/registry.json)", () => {
	const forks = ["subagents", "pr-review", "taskflow", "goal-loop-audit"];
	const manifest = loadManifest(ROOT);

	test("every fork has a parseable registry with required fields", () => {
		for (const fork of forks) {
			const reg = loadRegistry(ROOT, fork);
			expect(reg, `${fork} registry missing`).not.toBeNull();
			if (!reg) continue;
			expect(reg.fork).toBe(fork);
			expect(reg.entries.length).toBeGreaterThanOrEqual(3);
			for (const entry of reg.entries) {
				for (const field of REQUIRED_FIELDS) {
					expect(entry[field], `${fork}/${entry.id} missing ${field}`).toBeDefined();
				}
				expect(["deleted", "renamed", "fixed", "pending"]).toContain(entry.type);
				expect(entry.id).toMatch(/^[A-Z0-9-]+$/);
			}
		}
	});

	test("registry files cited in the registries are consistent with dest state", () => {
		for (const fork of forks) {
			const reg = loadRegistry(ROOT, fork);
			if (!reg) continue;
			for (const entry of reg.entries) {
				for (const file of entry.files) {
					if (file.endsWith("/") || file.includes("*")) continue; // dir/glob references
					const abs = file.startsWith("packages/")
						? join(ROOT, file)
						: join(ROOT, "packages", fork, file);
					if (entry.type === "deleted") {
						expect(existsSync(abs), `${entry.id}: ${file} should be deleted`).toBe(false);
					} else {
						expect(existsSync(abs), `${entry.id}: ${file} should exist in dest`).toBe(true);
					}
				}
			}
		}
	});

	test("F2/F5 commits referenced by the registries exist in git history", () => {
		const shaRe = /^[0-9a-f]{7,40}$/;
		for (const fork of forks) {
			const reg = loadRegistry(ROOT, fork);
			if (!reg) continue;
			for (const entry of reg.entries) {
				for (const commit of entry.commits) {
					expect(commit).toMatch(shaRe);
					const res = run("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: ROOT });
					expect(res.code, `commit ${commit} (${fork}/${entry.id}) not in git history`).toBe(0);
				}
			}
		}
	});
});

describe("manifest plumbing (real repo, read-only)", () => {
	const manifest = loadManifest(ROOT);

	test("manifest validates and has 12 entries", () => {
		expect(validateManifest(manifest)).toEqual([]);
		expect(Object.keys(manifest.upstreams)).toHaveLength(12);
	});

	test("every dest has a valid vendor.json consistent with the manifest", () => {
		for (const [name, entry] of Object.entries(manifest.upstreams)) {
			const file = join(ROOT, entry.dest, "vendor.json");
			expect(existsSync(file), `${name}: vendor.json missing`).toBe(true);
			const vendor = JSON.parse(readFileSync(file, "utf8")) as {
				resolvedSha: string;
				ref: string;
				npmName: string;
			};
			expect(validateVendorJson(vendor as never, entry, entry.dest)).toEqual([]);
		}
	});

	test("taskflow group = 9 entries, all from heggria/taskflow", () => {
		const members = groupMembers(manifest, "taskflow");
		expect(members).toHaveLength(9);
		for (const { entry } of members) expect(entry.repo).toBe("heggria/taskflow");
	});
});
