/**
 * Post-sync test gate (F10 D8, SYNC-09).
 *
 * Executable checklist run manually after a sync cycle (the harness CI stays
 * offline — the gate lives in the sync flow only):
 *
 *   1. per-package tests (config testCommand ?? package `test` script)
 *   2. harness suite (1152 tests) — its `test` script chains the F23 ratchet
 *   3. biome on tracked root-level paths + scripts/ + docs/ (never .pi/.guild)
 *   4. turbo build (correct inter-package order)
 *   5. ratchet without --update (fail-closed) + goldens byte-identical
 *   6. known-failures.txt remains empty
 *
 * Baseline/golden drift that legitimately follows a sync requires the explicit
 * `--update` (refused when CI=true — F23 policy mirrored here), committed
 * INSIDE the sync commit with the added/removed/unchanged report.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configFor } from "./config.ts";
import { loadManifest } from "./manifest.ts";
import { run } from "./util.ts";

export interface GateOptions {
	root: string;
	update: boolean;
	/** Scope gate to these entry names (default: every fork with tests). */
	scope?: string[];
	log?: (line: string) => void;
}

export class UpdateRefusedError extends Error {}

/** Mirrors F23 eval/update.ts::assertUpdateAllowed — never autocorrect in CI. */
export function assertUpdateAllowed(): void {
	const ci = process.env.CI;
	if (ci === "true" || ci === "1") {
		throw new UpdateRefusedError(
			"--update é humano e explícito; CI=true detectado — recusado (nunca autocorreção em PR). Rode localmente e revise o diff.",
		);
	}
}

interface StepResult {
	name: string;
	ok: boolean;
	detail: string;
}

function step(name: string, fn: () => { ok: boolean; detail: string }): StepResult {
	const start = Date.now();
	const res = fn();
	return {
		name,
		ok: res.ok,
		detail: `${res.detail} [${((Date.now() - start) / 1000).toFixed(1)}s]`,
	};
}

/** Biome on tracked root-level paths + scripts/ + docs/ (root biome.json
 *  ignores packages/**; .pi/.guild are untracked user dirs and must not lint). */
export function biomeCheck(root: string): { ok: boolean; detail: string } {
	const tracked = run("git", ["ls-files"], { cwd: root })
		.stdout.split("\n")
		.filter(
			(f) =>
				f &&
				!f.startsWith("packages/") &&
				!f.startsWith(".specs/") &&
				!f.startsWith(".pi/") &&
				!f.startsWith(".guild/"),
		)
		.filter((f) => /\.(ts|json|md|mjs|cjs|js)$/.test(f));
	const res = run("bunx", ["biome", "check", ...tracked], { cwd: root });
	if (res.code !== 0) {
		return {
			ok: false,
			detail: `biome check failed (${tracked.length} files): ${res.stdout.trim() || res.stderr.trim()}`,
		};
	}
	return { ok: true, detail: `biome clean (${tracked.length} tracked files)` };
}

/** Run one package's tests: configured testCommand, else its `test` script. */
export function packageTests(
	root: string,
	name: string,
	dest: string,
): { ok: boolean; detail: string } {
	const cfg = configFor(name);
	const pkgDir = join(root, dest);
	const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
		scripts?: Record<string, string>;
	};
	const script = pkgJson.scripts?.test;
	const command = script ? "bun run test" : (cfg.testCommand ?? null);
	if (!command) return { ok: true, detail: `${name}: no test script configured — skipped` };
	// Run through the shell (eval) so quoted globs (MCPL-06: 'test/**/*.test.ts')
	// and script chains expand exactly as the package's own script would.
	const res = run("sh", ["-c", `cd "$1" && eval "$2"`, "sh", pkgDir, command]);
	if (res.code !== 0) {
		return {
			ok: false,
			detail: `${name}: \`${command}\` failed (${res.code})\n${res.stdout.slice(-2000)}`,
		};
	}
	const tail = res.stdout.trim().split("\n").slice(-3).join(" | ");
	return { ok: true, detail: `${name}: ${tail}` };
}

/** The full gate. Returns true when every step is green. */
export async function runGate(opts: GateOptions): Promise<boolean> {
	const log = opts.log ?? ((l: string) => console.log(l));
	// --update is human + explicit; refuse early under CI (F23 policy, D8).
	if (opts.update) {
		try {
			assertUpdateAllowed();
		} catch (e) {
			log(`\n${(e as Error).message}`);
			return false;
		}
	}
	log("SYNC-UPSTREAM GATE (SYNC-09)");
	log("===========================");

	const manifest = loadManifest(opts.root);
	const scopeNames = opts.scope ?? Object.keys(manifest.upstreams);
	const results: StepResult[] = [];

	// 1. per-package tests
	for (const name of scopeNames) {
		const entry = manifest.upstreams[name];
		if (!entry) continue;
		results.push(step(`test ${name}`, () => packageTests(opts.root, name, entry.dest)));
	}

	// 2. harness suite + F23 ratchet + goldens (the harness `test` script chains eval:ratchet)
	results.push(
		step("harness suite (1152) + ratchet + goldens", () => {
			const res = run("bun", ["run", "test"], { cwd: join(opts.root, "packages/harness") });
			const tail = res.stdout.trim().split("\n").slice(-6).join("\n");
			if (res.code !== 0)
				return { ok: false, detail: `harness test chain failed (${res.code})\n${tail}` };
			const m = [...res.stdout.matchAll(/(\d+) pass/g)].at(-1);
			return { ok: true, detail: m ? `${m[1]} pass, ratchet clean` : "pass (ratchet clean)" };
		}),
	);

	// 3. biome (tracked paths only)
	results.push(step("biome", () => biomeCheck(opts.root)));

	// 4. turbo build
	results.push(
		step("turbo build", () => {
			const res = run("bunx", ["turbo", "build"], { cwd: opts.root });
			if (res.code !== 0)
				return {
					ok: false,
					detail: `turbo build failed (${res.code})\n${res.stdout.slice(-1500)}`,
				};
			return { ok: true, detail: "all packages built" };
		}),
	);

	// 5. explicit ratchet without --update (idempotent re-check; fail-closed)
	results.push(
		step("ratchet (no --update)", () => {
			const res = run("bun", ["run", "eval:ratchet"], { cwd: join(opts.root, "packages/harness") });
			if (res.code !== 0)
				return {
					ok: false,
					detail:
						"ratchet RED — run `bun run eval:ratchet` to see the diff (never silence with known-failures.txt)",
				};
			return { ok: true, detail: "ratchet green (baselines + goldens byte-identical)" };
		}),
	);

	// 6. known-failures.txt remains empty
	results.push(
		step("known-failures.txt empty", () => {
			const file = join(opts.root, "packages/harness/test/eval/baselines/known-failures.txt");
			if (!existsSync(file)) return { ok: true, detail: "no known-failures.txt" };
			const body = readFileSync(file, "utf8")
				.split("\n")
				.filter((l) => l && !l.startsWith("#"));
			return body.length === 0
				? { ok: true, detail: "empty" }
				: { ok: false, detail: `${body.length} entries — new failures never enter the ratchet` };
		}),
	);

	for (const r of results) {
		log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);
	}

	const failed = results.filter((r) => !r.ok);
	if (failed.length > 0) {
		log(`\nGATE FAILED (${failed.length} step(s)) — do not commit the sync.`);
		if (opts.update) {
			try {
				assertUpdateAllowed();
				log(
					"Baseline/golden drift detected — run `bun run eval:ratchet --update` LOCALLY, review the added/removed/unchanged report, and commit it INSIDE the sync commit (never silent).",
				);
			} catch (e) {
				log(`\n${(e as Error).message}`);
			}
		}
		return false;
	}
	log("\nGATE GREEN — safe to commit the sync (chore(<pkg>): sync upstream vOld..vNew).");
	return true;
}
