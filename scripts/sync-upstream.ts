#!/usr/bin/env bun
/**
 * F10 — Upstream Sync Workflow CLI (SYNC-01..09).
 *
 * Usage:
 *   bun run sync:upstream <name> --to <ref> [--dry-run] [--base <sha>]
 *   bun run sync:upstream --group taskflow --to <ref> [--dry-run]
 *   bun run sync:upstream --status [--offline]
 *   bun run sync:upstream --check
 *   bun run sync:upstream --gate [--update]
 *   bun run sync:upstream --list
 *   bun run sync:upstream --help
 *
 * Exit codes: 0 ok · 1 infra/args error · 2 conflicts pending (nothing written).
 *
 * The SYNC is manual + networked by design; --check/--status --offline are the
 * CI-safe offline surfaces. Never run against live upstreams in automation.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runSync } from "./sync-upstream/engine.ts";
import { GitHubFetcher, type SyncFetcher, fixtureFetcherFromFile } from "./sync-upstream/fetch.ts";
import { runGate } from "./sync-upstream/gate.ts";
import { groupMembers, loadManifest, validateManifest } from "./sync-upstream/manifest.ts";
import { renderSyncReport } from "./sync-upstream/report.ts";
import {
	GitHubLatestFetcher,
	buildStatus,
	renderStatus,
	runCheck,
} from "./sync-upstream/report.ts";

// Test hook: point the CLI at a fixture monorepo root (offline e2e).
// SYNC_UPSTREAM_FIXTURE: path to a JSON {repo, refs:{ref:{sha,tarball}}} file
// that replaces the GitHub fetcher with local tarballs (zero network).
const ROOT = process.env.SYNC_UPSTREAM_ROOT
	? resolve(process.env.SYNC_UPSTREAM_ROOT)
	: resolve(import.meta.dir, "..");

function fetcher(): SyncFetcher {
	const fixtureFile = process.env.SYNC_UPSTREAM_FIXTURE;
	if (fixtureFile) {
		if (!existsSync(fixtureFile)) fail(`SYNC_UPSTREAM_FIXTURE file not found: ${fixtureFile}`);
		return fixtureFetcherFromFile(fixtureFile);
	}
	return new GitHubFetcher();
}

const USAGE = `sync-upstream — three-way upstream sync for the vendored forks (F10)

Usage:
  bun run sync:upstream <name> --to <ref> [--dry-run] [--base <sha>]
  bun run sync:upstream --group taskflow --to <ref> [--dry-run]
  bun run sync:upstream --status [--offline]
  bun run sync:upstream --check
  bun run sync:upstream --gate [--update]
  bun run sync:upstream --list
  bun run sync:upstream --help

<name>  manifest entry (see --list). --to requires an explicit ref (tag or SHA).
--group taskflow   syncs the 9 taskflow packages from ONE tarball (SYNC-06).
--dry-run          reports the delta + merge outcomes, writes nothing.
--base <sha>       override the base (default: vendor.json resolvedSha).
--status           vendored vs latest upstream (network) + local dirty state.
--offline          --status without the network comparison.
--check            offline consistency manifest↔vendor.json + dirty dests (CI-safe).
--gate             post-sync test gate: per-package tests → harness → biome →
                   build → ratchet/goldens (--update refused with CI=true).
--list             list manifest entries and groups.

Exit codes: 0 ok · 1 infra/args · 2 conflicts (nothing written; hint: git restore).`;

function fail(message: string): never {
	console.error(`sync:upstream: ${message}`);
	process.exit(1);
}

interface CliArgs {
	mode: "sync" | "status" | "check" | "gate" | "list" | "help";
	name?: string;
	group?: string;
	to?: string;
	base?: string;
	dryRun: boolean;
	offline: boolean;
	update: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		mode: "sync",
		dryRun: false,
		offline: false,
		update: false,
	};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === "--to") {
			const value = argv[++i];
			if (!value) fail("--to requires a ref (tag or full SHA). Explicit refs only (AD-034).");
			out.to = value;
		} else if (arg === "--base") {
			const value = argv[++i];
			if (!value) fail("--base requires a SHA");
			out.base = value;
		} else if (arg === "--dry-run") out.dryRun = true;
		else if (arg === "--offline") out.offline = true;
		else if (arg === "--update") out.update = true;
		else if (arg === "--status") out.mode = "status";
		else if (arg === "--check") out.mode = "check";
		else if (arg === "--gate") out.mode = "gate";
		else if (arg === "--list") out.mode = "list";
		else if (arg === "--help" || arg === "-h") out.mode = "help";
		else if (arg === "--group") {
			const value = argv[++i];
			if (!value) fail("--group requires a name (taskflow)");
			out.group = value;
		} else if (arg.startsWith("--")) {
			fail(`unknown flag "${arg}"`);
		} else {
			rest.push(arg);
		}
	}
	if (out.mode === "sync") out.name = rest[0];
	if (rest.length > 1) fail(`unexpected positional args: ${rest.slice(1).join(", ")}`);
	if (out.mode === "sync" && !out.name && !out.group) {
		fail(
			"missing <name> or --group. Run `bun run sync:upstream --list` to see entries. Use --help for usage.",
		);
	}
	if (out.mode === "sync" && out.name && out.group) fail("pass either <name> OR --group, not both");
	if (out.mode === "sync" && !out.to) {
		fail("--to <ref> is required (explicit ref — no `--to latest`; AD-034). Run --dry-run first.");
	}
	return out;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const manifest = loadManifest(ROOT);

	switch (args.mode) {
		case "help": {
			console.log(USAGE);
			return 0;
		}
		case "list": {
			console.log(`${Object.keys(manifest.upstreams).length} pinned upstream(s):`);
			for (const [name, entry] of Object.entries(manifest.upstreams)) {
				const sub = entry.subpath ? ` (subpath ${entry.subpath})` : "";
				console.log(
					`  ${name.padEnd(16)} ${entry.repo}@${entry.ref}${sub} -> ${entry.dest} [${entry.npmName}@${entry.npmVersion}]`,
				);
			}
			console.log("\ngroups:");
			for (const [group, def] of Object.entries({ taskflow: "taskflow (9 entries, 1 tarball)" })) {
				console.log(`  ${group.padEnd(16)} ${def}`);
			}
			return 0;
		}
		case "check": {
			const result = runCheck(ROOT, manifest);
			for (const p of result.problems) console.error(`  ✗ ${p}`);
			console.log(
				`sync:upstream --check: ${result.entriesChecked} entries, ${result.problems.length} problem(s)`,
			);
			return result.problems.length === 0 ? 0 : 1;
		}
		case "status": {
			const rows = await buildStatus(
				ROOT,
				manifest,
				args.offline ? null : new GitHubLatestFetcher(),
			);
			console.log(renderStatus(rows, args.offline));
			return 0;
		}
		case "gate": {
			const ok = await runGate({ root: ROOT, update: args.update });
			return ok ? 0 : 1;
		}
		case "sync": {
			// Pre-flight manifest sanity (like --check, but entry-scoped).
			const problems = validateManifest(manifest);
			if (problems.length > 0) fail(problems.join("; "));
			if (args.group) groupMembers(manifest, args.group); // throw early on unknown member

			console.log(
				`sync:upstream ${args.group ? `--group ${args.group}` : args.name} --to ${args.to}${args.dryRun ? " --dry-run" : ""}`,
			);
			const report = await runSync({
				root: ROOT,
				fetcher: fetcher(),
				name: args.name,
				group: args.group,
				to: args.to as string,
				baseOverride: args.base,
				dryRun: args.dryRun,
			});
			console.log(renderSyncReport(report));
			if (report.conflicted) {
				console.error("");
				console.error("CONFLICTS — nothing was written (fail-closed). Resolve each file, then:");
				console.error("  hint: git restore packages/<dir>   (or `git checkout -- <files>`)");
				console.error("After manual resolution, re-run the sync and commit with:");
				console.error("  chore(<pkg>): sync upstream <vOld>..<vNew>");
				return 2;
			}
			if (report.dryRun) {
				console.log(
					"\nDRY-RUN complete — nothing written. Review the delta, then re-run without --dry-run.",
				);
			} else {
				const names = report.entries.map((e) => e.name).join(", ");
				console.log(
					`\nClean sync applied to ${names}. Provenance updated (vendor.json + vendor.manifest.json).`,
				);
				console.log(
					"Next: run the gate (`bun run sync:upstream --gate`), then commit the sync separately:",
				);
				console.log("  chore(<pkg>): sync upstream <vOld>..<vNew>");
			}
			return 0;
		}
	}
}

if (!existsSync(ROOT)) fail(`repo root not found at ${ROOT}`);
process.exit(await main());
