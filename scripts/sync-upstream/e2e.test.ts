/**
 * E2E — full sync flow with LOCAL fixture upstreams (F10 success criteria).
 *
 *  (i)   clean merge applies + renames + provenance
 *  (ii)  conflict → NOTHING written + CLI exit 2 (fail-closed)
 *  (iii) --dry-run → zero writes
 *  (iv)  --check offline green on a clean tree, red on corruption
 *  (v)   BUG-1 rename rule (dynamic import/import.meta.resolve) on a fixture
 *  (vi)  group taskflow — 9 subpaths from ONE tarball (SYNC-06)
 *
 * Zero network: fixture tarballs created in temp dirs, served by
 * LocalFixtureFetcher. The CLI is exercised as a real subprocess via the
 * SYNC_UPSTREAM_ROOT / SYNC_UPSTREAM_FIXTURE hooks.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TASKFLOW_BUILD_ORDER, configFor } from "./config.ts";
import { runSync } from "./engine.ts";
import { LocalFixtureFetcher } from "./fetch.ts";
import { type Manifest, loadManifest } from "./manifest.ts";
import {
	SHA_BASE,
	SHA_NEW,
	makeTarball,
	treeSnapshot,
	writeTree,
	writeVendorJson,
} from "./test-helpers.ts";
import { readText, run } from "./util.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE_REPO = "fixture/subagents";
const BASE_REF = "v0.37.2";
const NEW_REF = "v0.38.0";

// name (line 2) and version (line 6) sit 3 lines apart so git merge-file
// resolves ours-renamed + theirs-version-bumped cleanly (conservative hunks).
const PKG_BASE = `{
  "name": "pi-subagents",
  "description": "fixture",
  "keywords": ["a"],
  "license": "MIT",
  "version": "0.37.2"
}
`;
const PKG_OURS = `{
  "name": "@runecraft/subagents",
  "description": "fixture",
  "keywords": ["a"],
  "license": "MIT",
  "version": "0.37.2"
}
`;
const PKG_THEIRS = `{
  "name": "pi-subagents",
  "description": "fixture",
  "keywords": ["a"],
  "license": "MIT",
  "version": "0.38.0"
}
`;

const IDX_BASE = [
	'import { helper } from "pi-subagents/util";',
	"export function run() { return helper(); }",
	'export const VERSION = "0.37.2";',
	'export const NOTE = "n";',
	'export const MODE = "prod";',
	"",
].join("\n");
const IDX_OURS = [
	'import { helper } from "@runecraft/subagents/util";',
	"export function run() { return helper(); }",
	'export const VERSION = "0.37.2";',
	'export const NOTE = "n";',
	'export const MODE = "prod";',
	'export const OURS = "local-change";',
	"",
].join("\n");
const IDX_THEIRS = [
	'import { helper } from "pi-subagents/util";',
	"export function run() { return helper(); }",
	'export const VERSION = "0.38.0";',
	'export const NOTE = "n";',
	'export const MODE = "prod";',
	"",
].join("\n");
const IDX_THEIRS_CONFLICT = [
	'import { helper } from "pi-subagents/util";',
	"export function run() { return helper(); }",
	'export const VERSION = "0.38.0";',
	'export const NOTE = "n";',
	'export const MODE = "prod";',
	'export const UPSTREAM = "clashes-with-ours";',
	"",
].join("\n");

interface Fixture {
	root: string;
	dest: string;
	manifest: Manifest;
	fixtureJson: string;
}

function setupSubagents(conflict: boolean): Fixture {
	const base = mkdtempSync(join(tmpdir(), "e2e-src-"));
	const baseFiles = [
		{ rel: "package.json", content: PKG_BASE },
		{ rel: "src/index.ts", content: IDX_BASE },
		{ rel: "src/util.ts", content: 'export const helper = () => "base";\n' },
		{ rel: "install.mjs", content: 'console.log("installer");\n' },
		{ rel: "README.md", content: "readme base\n" },
	];
	const baseTar = makeTarball("pi-subagents", SHA_BASE, baseFiles, base);

	const theirs = [
		{ rel: "package.json", content: PKG_THEIRS },
		{ rel: "src/index.ts", content: conflict ? IDX_THEIRS_CONFLICT : IDX_THEIRS },
		{ rel: "src/util.ts", content: 'export const helper = () => "v0.38.0";\n' },
		{
			rel: "src/new-file.ts",
			content: 'import { helper } from "pi-subagents/util";\nexport const NEW = helper();\n',
		},
		{ rel: "install.mjs", content: 'console.log("installer");\n' },
		{ rel: "README.md", content: "readme v0.38.0\n" },
	];
	const theirsTar = makeTarball("pi-subagents", SHA_NEW, theirs, base);

	const root = mkdtempSync(join(tmpdir(), "e2e-root-"));
	const manifest: Manifest = {
		upstreams: {
			subagents: {
				repo: FIXTURE_REPO,
				ref: BASE_REF,
				npmName: "pi-subagents",
				npmVersion: "0.37.2",
				subpath: null,
				dest: "packages/subagents",
			},
		},
	};
	writeFileSync(join(root, "vendor.manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	const dest = join(root, "packages/subagents");
	mkdirSync(dest, { recursive: true });
	writeTree(dest, [
		{ rel: "package.json", content: PKG_OURS },
		{ rel: "src/index.ts", content: IDX_OURS },
		{ rel: "src/util.ts", content: 'export const helper = () => "base";\n' },
		{ rel: "README.md", content: "readme base\n" },
	]);
	writeVendorJson(dest, {
		repo: FIXTURE_REPO,
		ref: BASE_REF,
		sha: SHA_BASE,
		npmName: "pi-subagents",
		npmVersion: "0.37.2",
	});

	const fixtureJson = join(root, "fixture.json");
	writeFileSync(
		fixtureJson,
		JSON.stringify({
			repo: FIXTURE_REPO,
			refs: {
				[BASE_REF]: { sha: SHA_BASE, tarball: baseTar },
				[NEW_REF]: { sha: SHA_NEW, tarball: theirsTar },
			},
		}),
	);
	return { root, dest, manifest, fixtureJson };
}

const tmpDirs: string[] = [];
afterEach(() => {
	while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

function cli(
	args: string[],
	env: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
	const res = run("bun", ["scripts/sync-upstream.ts", ...args], { cwd: REPO_ROOT, env });
	return { code: res.code, stdout: res.stdout, stderr: res.stderr };
}

describe("e2e — clean sync applies + renames + provenance (fixture upstream)", () => {
	test("(i) clean merge applies upstream delta, renames specifiers, preserves F2 deletion, updates provenance", async () => {
		const fx = setupSubagents(false);
		tmpDirs.push(fx.root);
		const fetcher = new LocalFixtureFetcher(
			FIXTURE_REPO,
			JSON.parse(readFileSync(fx.fixtureJson, "utf8")).refs,
		);

		const report = await runSync({
			root: fx.root,
			fetcher,
			name: "subagents",
			to: NEW_REF,
			dryRun: false,
		});
		expect(report.conflicted).toBe(false);
		expect(report.entries).toHaveLength(1);

		// merged + renamed
		const index = readText(join(fx.dest, "src/index.ts"));
		expect(index).toContain('import { helper } from "@runecraft/subagents/util";');
		expect(index).toContain('export const OURS = "local-change";');
		expect(index).toContain('export const VERSION = "0.38.0";');

		// new upstream file copied + renamed
		const newFile = readText(join(fx.dest, "src/new-file.ts"));
		expect(newFile).toContain('import { helper } from "@runecraft/subagents/util";');

		// upstream modification applied where ours untouched
		expect(readText(join(fx.dest, "src/util.ts"))).toBe('export const helper = () => "v0.38.0";\n');
		expect(readText(join(fx.dest, "README.md"))).toBe("readme v0.38.0\n");

		// F2 deletion preserved
		expect(existsSync(join(fx.dest, "install.mjs"))).toBe(false);

		// package.json name preserved (ours won the name line, theirs won version)
		const pkg = JSON.parse(readText(join(fx.dest, "package.json"))) as {
			name: string;
			version: string;
		};
		expect(pkg.name).toBe("@runecraft/subagents");
		expect(pkg.version).toBe("0.38.0");

		// provenance: vendor.json + manifest updated, vendoredAt preserved
		const vendor = JSON.parse(readText(join(fx.dest, "vendor.json"))) as {
			ref: string;
			resolvedSha: string;
			npmVersion: string;
			syncedAt: string;
			vendoredAt: string;
		};
		expect(vendor.ref).toBe(NEW_REF);
		expect(vendor.resolvedSha).toBe(SHA_NEW);
		expect(vendor.npmVersion).toBe("0.38.0");
		expect(vendor.syncedAt).toBeDefined();
		expect(vendor.vendoredAt).toBe("2026-08-08T00:00:00.000Z");
		const manifest = loadManifest(fx.root);
		expect(manifest.upstreams.subagents?.ref).toBe(NEW_REF);
		expect(manifest.upstreams.subagents?.npmVersion).toBe("0.38.0");
	});

	test("(ii) conflict → nothing written, CLI exits 2 with restore hint", async () => {
		const fx = setupSubagents(true);
		tmpDirs.push(fx.root);
		const before = treeSnapshot(fx.dest);
		const beforeVendor = readFileSync(join(fx.dest, "vendor.json"), "utf8");
		const beforeManifest = readFileSync(join(fx.root, "vendor.manifest.json"), "utf8");

		const res = cli(["subagents", "--to", NEW_REF], {
			SYNC_UPSTREAM_ROOT: fx.root,
			SYNC_UPSTREAM_FIXTURE: fx.fixtureJson,
		});
		expect(res.code).toBe(2);
		expect(`${res.stdout}${res.stderr}`).toContain("CONFLICT");
		expect(`${res.stdout}${res.stderr}`.toLowerCase()).toContain("git restore");

		// fail-closed: dest byte-identical, provenance untouched
		expect(treeSnapshot(fx.dest)).toEqual(before);
		expect(readFileSync(join(fx.dest, "vendor.json"), "utf8")).toBe(beforeVendor);
		expect(readFileSync(join(fx.root, "vendor.manifest.json"), "utf8")).toBe(beforeManifest);
	});

	test("(iii) --dry-run reports the delta with zero writes", async () => {
		const fx = setupSubagents(false);
		tmpDirs.push(fx.root);
		const before = treeSnapshot(fx.dest);
		const beforeVendor = readFileSync(join(fx.dest, "vendor.json"), "utf8");
		const beforeManifest = readFileSync(join(fx.root, "vendor.manifest.json"), "utf8");

		const res = cli(["subagents", "--to", NEW_REF, "--dry-run"], {
			SYNC_UPSTREAM_ROOT: fx.root,
			SYNC_UPSTREAM_FIXTURE: fx.fixtureJson,
		});
		expect(res.code).toBe(0);
		expect(res.stdout).toContain("DRY-RUN");
		expect(res.stdout).toContain("added upstream (1)");
		expect(res.stdout).toContain("modified upstream (4)");
		expect(treeSnapshot(fx.dest)).toEqual(before);
		expect(readFileSync(join(fx.dest, "vendor.json"), "utf8")).toBe(beforeVendor);
		expect(readFileSync(join(fx.root, "vendor.manifest.json"), "utf8")).toBe(beforeManifest);
	});

	test("(iv) --check offline: green on a clean committed tree, red on corruption", async () => {
		const fx = setupSubagents(false);
		tmpDirs.push(fx.root);
		// make it a git repo so dirty detection works
		run("git", ["init", "-q"], { cwd: fx.root });
		run("git", ["-c", "user.name=test", "-c", "user.email=test@test", "add", "-A"], {
			cwd: fx.root,
		});
		run("git", ["-c", "user.name=test", "-c", "user.email=test@test", "commit", "-qm", "fixture"], {
			cwd: fx.root,
		});

		const green = cli(["--check"], { SYNC_UPSTREAM_ROOT: fx.root });
		expect(green.code).toBe(0);
		expect(green.stdout).toContain("0 problem(s)");

		// corrupt: drop resolvedSha
		const vendorPath = join(fx.dest, "vendor.json");
		const vendor = JSON.parse(readFileSync(vendorPath, "utf8")) as Record<string, unknown>;
		const corrupted = Object.fromEntries(
			Object.entries(vendor).filter(([k]) => k !== "resolvedSha"),
		);
		writeFileSync(vendorPath, `${JSON.stringify(corrupted, null, "\t")}\n`);
		const red = cli(["--check"], { SYNC_UPSTREAM_ROOT: fx.root });
		expect(red.code).toBe(1);
		expect(`${red.stdout}${red.stderr}`).toContain("resolvedSha");
	});

	test("(v) BUG-1 fixture — dynamic import() + import.meta.resolve renamed via config (taskflow-pi)", async () => {
		const base = mkdtempSync(join(tmpdir(), "bug1-src-"));
		const pkgBase = `{\n  "name": "pi-taskflow",\n  "description": "x",\n  "keywords": ["a"],\n  "license": "MIT",\n  "version": "0.2.6"\n}\n`;
		const pkgTheirs = `{\n  "name": "pi-taskflow",\n  "description": "x",\n  "keywords": ["a"],\n  "license": "MIT",\n  "version": "0.2.7"\n}\n`;
		const idxBase =
			'const { compileTaskflow } = await import("taskflow-core");\n// stable a\n// stable b\n';
		const baseTar = makeTarball(
			"pi-taskflow",
			SHA_BASE,
			[
				{ rel: "packages/pi-taskflow/src/index.ts", content: idxBase },
				{ rel: "packages/pi-taskflow/package.json", content: pkgBase },
			],
			base,
		);
		// Upstream v0.2.7 adds a NEW file carrying the un-renamed dynamic imports
		// (exactly the BUG-1 shape found in packages/taskflow/pi/src/index.ts).
		const theirsTar = makeTarball(
			"pi-taskflow",
			SHA_NEW,
			[
				{ rel: "packages/pi-taskflow/src/index.ts", content: idxBase },
				{
					rel: "packages/pi-taskflow/src/verify.ts",
					content: [
						'const { verifyTaskflow } = await import("taskflow-core");',
						'const runner = import.meta.resolve("taskflow-core/detached-runner");',
						"",
					].join("\n"),
				},
				{ rel: "packages/pi-taskflow/package.json", content: pkgTheirs },
			],
			base,
		);
		const root = mkdtempSync(join(tmpdir(), "bug1-root-"));
		tmpDirs.push(root);
		const manifest: Manifest = {
			upstreams: {
				"taskflow-pi": {
					repo: "fixture/taskflow",
					ref: "v0.2.6",
					npmName: "pi-taskflow",
					npmVersion: "0.2.6",
					subpath: "packages/pi-taskflow",
					dest: "packages/taskflow/pi",
				},
			},
		};
		writeFileSync(join(root, "vendor.manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
		const dest = join(root, "packages/taskflow/pi");
		mkdirSync(dest, { recursive: true });
		writeTree(dest, [
			{
				rel: "src/index.ts",
				content:
					'const { compileTaskflow } = await import("@runecraft/taskflow-core");\n// stable a\n// stable b\n',
			},
			{
				rel: "package.json",
				content: `{\n  "name": "@runecraft/taskflow",\n  "description": "x",\n  "keywords": ["a"],\n  "license": "MIT",\n  "version": "0.2.6"\n}\n`,
			},
		]);
		writeVendorJson(dest, {
			repo: "fixture/taskflow",
			ref: "v0.2.6",
			sha: SHA_BASE,
			npmName: "pi-taskflow",
			npmVersion: "0.2.6",
			subpath: "packages/pi-taskflow",
		});
		const fetcher = new LocalFixtureFetcher("fixture/taskflow", {
			"v0.2.6": { sha: SHA_BASE, tarball: baseTar },
			"v0.2.7": { sha: SHA_NEW, tarball: theirsTar },
		});

		// The REAL config drives the pass (proves BUG-1 is fixed by config, T10).
		expect(configFor("taskflow-pi").renameMap["pi-taskflow"]).toBe("@runecraft/taskflow");
		const report = await runSync({
			root,
			fetcher,
			name: "taskflow-pi",
			to: "v0.2.7",
			dryRun: false,
		});
		expect(report.conflicted).toBe(false);
		const out = readText(join(dest, "src/index.ts"));
		expect(out).toContain('await import("@runecraft/taskflow-core")');
		expect(out).not.toContain('import("taskflow-core")');
		const verify = readText(join(dest, "src/verify.ts"));
		expect(verify).toContain('await import("@runecraft/taskflow-core")');
		expect(verify).toContain('import.meta.resolve("@runecraft/taskflow-core/detached-runner")');
		// no bare upstream specifier remains (quote directly before the old name)
		expect(verify).not.toMatch(/["'`]taskflow-core/);
		expect(verify).not.toMatch(/["'`]pi-taskflow/);
	});
});

describe("e2e — group taskflow (SYNC-06): 9 subpaths from ONE tarball", () => {
	test("(vi) group sync merges all 9 dests, build order + MCP test command configured", async () => {
		const base = mkdtempSync(join(tmpdir(), "group-src-"));
		const members = [
			["taskflow-core", "packages/taskflow-core"],
			["taskflow-pi", "packages/pi-taskflow"],
			["taskflow-dsl", "packages/taskflow-dsl"],
			["taskflow-mcp-core", "packages/taskflow-mcp-core"],
			["taskflow-hosts", "packages/taskflow-hosts"],
			["taskflow-codex", "packages/codex-taskflow"],
			["taskflow-claude", "packages/claude-taskflow"],
			["taskflow-opencode", "packages/opencode-taskflow"],
			["taskflow-grok", "packages/grok-taskflow"],
		] as const;
		const pkg = (name: string, version: string, scoped: boolean) =>
			`{\n  "name": "${scoped ? `@runecraft/${name}` : name}",\n  "description": "x",\n  "keywords": ["a"],\n  "license": "MIT",\n  "version": "${version}"\n}\n`;
		const baseFiles = members.flatMap(([name, sub]) => [
			{ rel: `${sub}/package.json`, content: pkg(name, "0.2.6", false) },
			{
				rel: `${sub}/src/index.ts`,
				content: `export const v = "0.2.6";\n// stable a\n// stable b\n// ${name} base\n`,
			},
		]);
		const theirsFiles = members.flatMap(([name, sub]) => [
			{ rel: `${sub}/package.json`, content: pkg(name, "0.2.7", false) },
			{
				rel: `${sub}/src/index.ts`,
				content: `export const v = "0.2.7";\n// stable a\n// stable b\n// ${name} base\n`,
			},
		]);
		const baseTar = makeTarball("taskflow", SHA_BASE, baseFiles, base);
		const theirsTar = makeTarball("taskflow", SHA_NEW, theirsFiles, base);

		const root = mkdtempSync(join(tmpdir(), "group-root-"));
		tmpDirs.push(root);
		const upstreams: Manifest["upstreams"] = {};
		for (const [name, sub] of members) {
			upstreams[name] = {
				repo: "fixture/taskflow",
				ref: "v0.2.6",
				npmName: name,
				npmVersion: "0.2.6",
				subpath: sub,
				dest: `packages/taskflow/${name.replace("taskflow-", "").replace("pi", "pi")}`,
			};
			const dest = join(root, "packages/taskflow", name.replace("taskflow-", ""));
			mkdirSync(dest, { recursive: true });
			writeTree(dest, [
				{
					rel: "src/index.ts",
					content: `export const v = "0.2.6";\n// stable a\n// stable b\n// ${name} ours\n`,
				},
				{
					rel: "package.json",
					content: `{\n  "name": "@runecraft/${name}",\n  "description": "x",\n  "keywords": ["a"],\n  "license": "MIT",\n  "version": "0.2.6"\n}\n`,
				},
			]);
			writeVendorJson(dest, {
				repo: "fixture/taskflow",
				ref: "v0.2.6",
				sha: SHA_BASE,
				npmName: name,
				npmVersion: "0.2.6",
				subpath: sub,
			});
		}
		writeFileSync(
			join(root, "vendor.manifest.json"),
			`${JSON.stringify({ upstreams }, null, "\t")}\n`,
		);
		const fetcher = new LocalFixtureFetcher("fixture/taskflow", {
			"v0.2.6": { sha: SHA_BASE, tarball: baseTar },
			"v0.2.7": { sha: SHA_NEW, tarball: theirsTar },
		});

		const report = await runSync({ root, fetcher, group: "taskflow", to: "v0.2.7", dryRun: false });
		expect(report.conflicted).toBe(false);
		expect(report.entries).toHaveLength(9);
		for (const [name] of members) {
			const dest = join(root, "packages/taskflow", name.replace("taskflow-", ""));
			expect(readText(join(dest, "src/index.ts"))).toContain("0.2.7");
			const vendor = JSON.parse(readFileSync(join(dest, "vendor.json"), "utf8")) as {
				ref: string;
				npmVersion: string;
			};
			expect(vendor.ref).toBe("v0.2.7");
			expect(vendor.npmVersion).toBe("0.2.7");
		}
		const manifest = loadManifest(root);
		for (const [name] of members) expect(manifest.upstreams[name]?.ref).toBe("v0.2.7");

		// F16 codification: build order + MCP test mode present in config
		expect(TASKFLOW_BUILD_ORDER).toHaveLength(9);
		expect(TASKFLOW_BUILD_ORDER[0]).toBe("taskflow-core");
		expect(TASKFLOW_BUILD_ORDER[1]).toBe("taskflow-mcp-core");
		expect(configFor("taskflow-mcp-core").testCommand).toContain("--experimental-strip-types");
	});
});

describe("e2e — BUG-2 config rule (taskflow-core dist/agents packaging)", () => {
	test("config documents files/exports + build copy for dist/agents and applies to the real fork package.json", () => {
		const cfg = configFor("taskflow-core");
		const adaptations = (cfg.adaptations ?? []).join("\n");
		expect(adaptations).toContain("BUG-2");
		expect(adaptations).toContain("dist/agents");
		// The real fork must be re-buildable after the 1st sync: agents sources exist
		expect(existsSync(join(REPO_ROOT, "packages/taskflow/core/src/agents"))).toBe(true);
		expect(readText(join(REPO_ROOT, "packages/taskflow/core/package.json"))).toContain('"dist"');
	});
});
