/**
 * T5 — auto-rename pass (SYNC-07) incl. BUG-1 (dynamic import() +
 * import.meta.resolve) and package.json handling. Fixture content only.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRenamePass, renameSpecifiersInText } from "./rename.ts";
import { readText } from "./util.ts";

const MAP = { "pi-subagents": "@runecraft/subagents", "taskflow-core": "@runecraft/taskflow-core" };

function dirWith(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "rename-tree-"));
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

describe("renameSpecifiersInText — token-aware specifier contexts", () => {
	test("static import from", () => {
		const res = renameSpecifiersInText('import { x } from "pi-subagents/util";\n', MAP);
		expect(res.content).toBe('import { x } from "@runecraft/subagents/util";\n');
	});

	test("side-effect import", () => {
		const res = renameSpecifiersInText("import 'pi-subagents/styles.css';\n", MAP);
		expect(res.content).toBe("import '@runecraft/subagents/styles.css';\n");
	});

	test("dynamic import() — plain string (BUG-1 case)", () => {
		const res = renameSpecifiersInText('const { verify } = await import("taskflow-core");\n', MAP);
		expect(res.content).toBe('const { verify } = await import("@runecraft/taskflow-core");\n');
	});

	test("dynamic import() — template literal (BUG-1 regression)", () => {
		const res = renameSpecifiersInText(
			"const m = await import(`taskflow-core/detached-runner`);\n",
			MAP,
		);
		expect(res.content).toBe(
			"const m = await import(`@runecraft/taskflow-core/detached-runner`);\n",
		);
	});

	test("import.meta.resolve (BUG-1 case)", () => {
		const res = renameSpecifiersInText(
			'import.meta.resolve("taskflow-core/detached-runner")\n',
			MAP,
		);
		expect(res.content).toBe('import.meta.resolve("@runecraft/taskflow-core/detached-runner")\n');
	});

	test("require() specifier", () => {
		const res = renameSpecifiersInText('const x = require("pi-subagents");\n', MAP);
		expect(res.content).toBe('const x = require("@runecraft/subagents");\n');
	});

	test("prose/log prefixes/temp dirs are never touched", () => {
		const input = [
			'console.warn("[pi-subagents] watchdog failed");',
			'const dir = path.join(os.tmpdir(), "pi-subagents-123");',
			"// pi-subagents — upstream name in a comment",
			'const x = "pi-subagents"; // not a specifier',
			"pi-subagents",
		].join("\n");
		const res = renameSpecifiersInText(input, MAP);
		expect(res.content).toBe(input);
	});

	test("already-renamed content is untouched (idempotent)", () => {
		const input = 'import { x } from "@runecraft/taskflow-core";\n';
		const res = renameSpecifiersInText(input, MAP);
		expect(res.content).toBe(input);
	});

	test("specifier with subpath keeps the subpath", () => {
		const res = renameSpecifiersInText(
			'import { verifyTaskflow } from "taskflow-core/verify";\n',
			MAP,
		);
		expect(res.content).toBe('import { verifyTaskflow } from "@runecraft/taskflow-core/verify";\n');
	});
});

describe("applyRenamePass — package.json + whole-tree pass", () => {
	test("package.json name + dep keys get workspace:* + pi paths", () => {
		const pkg = {
			name: "pi-taskflow",
			version: "0.2.6",
			dependencies: { "taskflow-core": "0.2.6" },
			devDependencies: { typescript: "6.0.3" },
			pi: { extensions: ["node_modules/pi-taskflow/dist/index.js", "./local.ts"] },
		};
		const dir = dirWith({ "package.json": JSON.stringify(pkg, null, 2) });
		const report = applyRenamePass(dir, {
			"pi-taskflow": "@runecraft/taskflow",
			"taskflow-core": "@runecraft/taskflow-core",
		});
		const out = JSON.parse(readText(join(dir, "package.json"))) as {
			name?: string;
			dependencies?: Record<string, string>;
			pi?: { extensions?: string[] };
		};
		expect(out.name).toBe("@runecraft/taskflow");
		expect(out.dependencies?.["@runecraft/taskflow-core"]).toBe("workspace:*");
		expect(out.pi?.extensions).toEqual([
			"node_modules/@runecraft/taskflow/dist/index.js",
			"./local.ts",
		]);
		expect(report.filesTouched).toContain("package.json");
	});

	test("whole-tree pass renames dynamic import + import.meta.resolve in src", () => {
		const dir = dirWith({
			"src/index.ts": [
				'import { verifyTaskflow } from "taskflow-core";',
				'const m = await import("taskflow-core");',
				'const r = import.meta.resolve("taskflow-core/detached-runner");',
				"",
			].join("\n"),
		});
		const report = applyRenamePass(dir, MAP);
		const out = readText(join(dir, "src/index.ts"));
		expect(out).toContain('from "@runecraft/taskflow-core"');
		expect(out).toContain('await import("@runecraft/taskflow-core")');
		expect(out).toContain('import.meta.resolve("@runecraft/taskflow-core/detached-runner")');
		expect(out).not.toContain('"taskflow-core"');
		expect(report.filesTouched).toContain("src/index.ts");
	});
});
