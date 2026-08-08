/**
 * Per-fork adaptation config (F10 D4/D5, SYNC-07/SYNC-06).
 *
 * The sync engine is a three-way merge driven by tarballs; upstream content
 * arrives with upstream names. This module documents — per manifest entry —
 * the mechanical adaptation the engine re-applies on every sync cycle:
 *
 *  - renameMap: upstream module specifiers → `@runecraft/*` (import specifiers
 *    static + dynamic `import()` + `import.meta.resolve` + package.json fields)
 *  - excludeFiles: paths never merged (provenance, build output, junk)
 *  - testCommand: how the gate runs this fork's tests (default: the package's
 *    own `test` script; the taskflow MCP layer uses MCPL-06's node test mode)
 *  - pluginPaths: local `plugin/` config paths (F15 D6 — never upstream npx pins)
 *  - adaptations: documented build/package fixes that live in ours and must
 *    survive a sync (BUG-2: taskflow-core `dist/agents/` packaging; MCP bins)
 *
 * Mapas v1 validated against the 12 vendored dests (design D4).
 */

export interface RenameRule {
	/** Upstream specifier (bare package name, no scope). */
	from: string;
	/** Local `@runecraft/*` specifier. */
	to: string;
}

export interface ForkConfig {
	/** Module specifiers renamed by the pass (SYNC-07). */
	renameMap: Record<string, string>;
	/** Relative paths/globs excluded from the merge universe. */
	excludeFiles: string[];
	/** Test command for the gate (default: the package's `test` script). */
	testCommand?: string;
	/** Local plugin/ config paths (F15 D6: env > dev fork > @runecraft pin). */
	pluginPaths?: string[];
	/** Documented build/package adaptations that live in ours (never upstream). */
	adaptations?: string[];
	/** Build order index for the taskflow group (F16 codification, D5). */
	buildOrder?: number;
}

/** Paths never part of the three-way universe on ANY fork. */
export const DEFAULT_EXCLUDES = ["vendor.json", "node_modules/**", "dist/**", ".turbo/**"];

/**
 * Rename maps v1 (design D4) — upstream specifier → @runecraft/*.
 * The same rules fix BUG-1 (dynamic `import("taskflow-core")` /
 * `import.meta.resolve("taskflow-core/...")` that F16's manual re-vendor
 * left un-renamed in packages/taskflow/pi/src/index.ts): the rename pass
 * applies these in dynamic-import and import.meta.resolve contexts too.
 */
export const SHARED_RENAME_MAP: Record<string, string> = {
	"pi-subagents": "@runecraft/subagents",
	"taskflow-core": "@runecraft/taskflow-core",
	"pi-taskflow": "@runecraft/taskflow",
	"taskflow-dsl": "@runecraft/taskflow-dsl",
	"taskflow-mcp-core": "@runecraft/taskflow-mcp-core",
	"taskflow-hosts": "@runecraft/taskflow-hosts",
	"codex-taskflow": "@runecraft/taskflow-codex",
	"claude-taskflow": "@runecraft/taskflow-claude",
	"opencode-taskflow": "@runecraft/taskflow-opencode",
	"grok-taskflow": "@runecraft/taskflow-grok",
	"pi-goal-list-loop-audit": "@runecraft/goal-loop-audit",
	"pi-pr-review": "@runecraft/pr-review",
};

/** MCP-layer test mode (MCPL-06, F16): node --experimental-strip-types --test. */
export const MCP_TEST_COMMAND = "node --experimental-strip-types --test 'test/**/*.test.ts'";

/** taskflow group build order (D5, F16 codification): core→mcp-core→hosts→dsl→pi→adapters. */
export const TASKFLOW_BUILD_ORDER = [
	"taskflow-core",
	"taskflow-mcp-core",
	"taskflow-hosts",
	"taskflow-dsl",
	"taskflow-pi",
	"taskflow-codex",
	"taskflow-claude",
	"taskflow-opencode",
	"taskflow-grok",
];

const TASKFLOW_ADAPTATIONS = [
	"BUG-1: dynamic import()/import.meta.resolve specifiers renamed by the rename pass (config renameMap applies in dynamic contexts)",
	'BUG-2: taskflow-core ships src/agents/*.md built-in agent definitions — the build must copy them to dist/agents/ and `files:["dist"]` already packages them; the harness build re-runs tsc + the copy (see docs/SYNC.md §BUG-1/BUG-2)',
	"plugin/ configs reference local fork paths (F15 D6) — never upstream npx pins",
	"MCP bins: *-taskflow-mcp → dist/mcp/bin.js (F16)",
];

/**
 * Per-entry config. Entries not listed fall back to the shared rename map and
 * default excludes (engine still renames their upstream specifiers).
 */
export const FORK_CONFIGS: Record<string, ForkConfig> = {
	subagents: {
		renameMap: { "pi-subagents": "@runecraft/subagents" },
		excludeFiles: [...DEFAULT_EXCLUDES, "install.mjs", "package-lock.json"],
		adaptations: [
			"F2: install.mjs removed (commit efdd9da) — three-way preserves the deletion when upstream leaves it unchanged",
			"plugin/ and skills/ point at local fork paths",
		],
	},
	"taskflow-core": {
		renameMap: { "taskflow-core": "@runecraft/taskflow-core" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 0,
	},
	"taskflow-pi": {
		renameMap: { "pi-taskflow": "@runecraft/taskflow" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 4,
	},
	"taskflow-dsl": {
		renameMap: { "taskflow-dsl": "@runecraft/taskflow-dsl" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 3,
	},
	"taskflow-mcp-core": {
		renameMap: { "taskflow-mcp-core": "@runecraft/taskflow-mcp-core" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 1,
	},
	"taskflow-hosts": {
		renameMap: { "taskflow-hosts": "@runecraft/taskflow-hosts" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 2,
	},
	"taskflow-codex": {
		renameMap: { "codex-taskflow": "@runecraft/taskflow-codex" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 5,
	},
	"taskflow-claude": {
		renameMap: { "claude-taskflow": "@runecraft/taskflow-claude" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 6,
	},
	"taskflow-opencode": {
		renameMap: { "opencode-taskflow": "@runecraft/taskflow-opencode" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 7,
	},
	"taskflow-grok": {
		renameMap: { "grok-taskflow": "@runecraft/taskflow-grok" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		testCommand: MCP_TEST_COMMAND,
		adaptations: TASKFLOW_ADAPTATIONS,
		buildOrder: 8,
	},
	"goal-loop-audit": {
		renameMap: { "pi-goal-list-loop-audit": "@runecraft/goal-loop-audit" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
	},
	"pr-review": {
		renameMap: { "pi-pr-review": "@runecraft/pr-review" },
		excludeFiles: [...DEFAULT_EXCLUDES, "package-lock.json"],
		adaptations: [
			"F5: hardcoded pi-pr-review/10ego refs fixed in scripts/verify-package-contents.mjs + tests/tooling/package-contents.node.mjs (commit b1ba279) — sync must keep @runecraft/pr-review + runecraft-ai/harness URLs",
		],
	},
};

/**
 * Config for an entry. Every fork carries the FULL shared rename map (D4 v1):
 * upstream specifiers can cross fork boundaries (the pi package imports
 * `taskflow-core` — a separate fork), so each fork must rename ALL upstream
 * specifiers it may encounter, not only its own npmName. Per-fork overrides
 * (excludes/testCommand/adaptations) still apply.
 */
export function configFor(name: string): ForkConfig {
	const base: ForkConfig = FORK_CONFIGS[name] ?? {
		renameMap: {},
		excludeFiles: [...DEFAULT_EXCLUDES],
	};
	return {
		...base,
		renameMap: { ...SHARED_RENAME_MAP, ...base.renameMap },
	};
}
