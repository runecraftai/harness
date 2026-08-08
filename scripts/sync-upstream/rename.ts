/**
 * Auto-rename pass (F10 D4, SYNC-07).
 *
 * Upstream content arrives with upstream names; this pass mechanically
 * re-applies the per-fork rename maps over the merged tree:
 *
 *  - package.json: `name`, dependency keys (deps/dev/peer/optional/bundled),
 *    `pi.extensions|skills|prompts` `node_modules/<specifier>/...` paths.
 *    Cross-fork dependency keys renamed to `@runecraft/*` get the workspace:*
 *    protocol value (monorepo convention — validated against the 12 dests).
 *  - module specifier contexts in text files: static `from "X"` / `import "X"`,
 *    dynamic `import("X")` (plain + template literals — BUG-1), and
 *    `import.meta.resolve("X")`. Subpath forms (`X/foo`) keep their suffix.
 *
 * The pass is TOKEN-AWARE: prose, log prefixes (`[pi-subagents] ...`), temp dir
 * names and comments are never touched. It is idempotent — already-renamed
 * content has no upstream keys left to match.
 */

import { join } from "node:path";
import { isBinary, readText, walk, writeText } from "./util.ts";

export interface RenameRecord {
	file: string;
	from: string;
	to: string;
}

export interface RenameReport {
	filesTouched: string[];
	renames: RenameRecord[];
}

/** package.json dep sections whose KEYS are module specifiers. */
const DEP_SECTIONS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/** pi.* arrays that may carry `node_modules/<specifier>/...` entries. */
const PI_PATH_SECTIONS = ["extensions", "skills", "prompts"] as const;

/**
 * Regex matching a specifier in a module-specifier context:
 * `from "X"`, `import "X"`, `import("X")`, `import.meta.resolve("X")`,
 * `require("X")` — single/double/template quotes, optional `/subpath` suffix.
 */
function specifierRegex(from: string): RegExp {
	const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Quote/subpath classes live in plain strings so the template literal below
	// never contains a raw backtick (a literal backtick would need a triple
	// escape inside a template — unreadable).
	const quoteClass = "([\"'`])";
	const subpathClass = "[^\"'`]";
	return new RegExp(
		`((?:from|import)\\s*|import\\(\\s*|import\\.meta\\.resolve\\(\\s*|require\\(\\s*)${quoteClass}${esc}(\\/${subpathClass}*)?${quoteClass}`,
		"g",
	);
}

/** Rename specifiers inside module-specifier contexts of a text file. */
export function renameSpecifiersInText(
	content: string,
	renameMap: Record<string, string>,
): { content: string; renames: { from: string; to: string }[] } {
	let out = content;
	const renames: { from: string; to: string }[] = [];
	for (const [from, to] of Object.entries(renameMap)) {
		const re = specifierRegex(from);
		let matched = false;
		out = out.replace(
			re,
			(_all, ctx: string, quote: string, sub: string | undefined, close: string) => {
				matched = true;
				return `${ctx}${quote}${to}${sub ?? ""}${close}`;
			},
		);
		if (matched) renames.push({ from, to });
	}
	return { content: out, renames };
}

/** Mutate a parsed package.json in place; returns the renames performed. */
export function renamePackageJsonFields(
	pkg: Record<string, unknown>,
	renameMap: Record<string, string>,
): { from: string; to: string }[] {
	const renames: { from: string; to: string }[] = [];

	const name = pkg.name;
	if (typeof name === "string") {
		const target = renameMap[name];
		if (target) {
			pkg.name = target;
			renames.push({ from: target, to: name });
		}
	}

	for (const section of DEP_SECTIONS) {
		const deps = pkg[section];
		if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
		const next: Record<string, string> = {};
		for (const [key, value] of Object.entries(deps as Record<string, string>)) {
			if (renameMap[key]) {
				// Cross-fork deps use the workspace:* protocol in this monorepo.
				next[renameMap[key]] = "workspace:*";
				renames.push({ from: key, to: renameMap[key] });
			} else {
				next[key] = value;
			}
		}
		pkg[section] = next;
	}

	const bundled = pkg.bundledDependencies;
	if (Array.isArray(bundled)) {
		pkg.bundledDependencies = bundled.map((k) =>
			typeof k === "string" && renameMap[k] ? renameMap[k] : k,
		);
	}

	const pi = pkg.pi as Record<string, unknown> | undefined;
	if (pi && typeof pi === "object") {
		for (const section of PI_PATH_SECTIONS) {
			const list = pi[section];
			if (!Array.isArray(list)) continue;
			pi[section] = list.map((entry) => {
				if (typeof entry !== "string") return entry;
				for (const [from, to] of Object.entries(renameMap)) {
					const marker = `node_modules/${from}/`;
					if (entry.startsWith(marker)) {
						renames.push({ from, to });
						return `node_modules/${to}/${entry.slice(marker.length)}`;
					}
				}
				return entry;
			});
		}
	}

	return renames;
}

/** Apply the rename pass over every text file of the tree (in place). */
export function applyRenamePass(treeDir: string, renameMap: Record<string, string>): RenameReport {
	const report: RenameReport = { filesTouched: [], renames: [] };
	for (const rel of walk(treeDir)) {
		const file = join(treeDir, rel);
		if (isBinary(file)) continue;
		const original = readText(file);

		let next = original;
		const fileRenames: { from: string; to: string }[] = [];

		if (rel === "package.json") {
			let pkg: Record<string, unknown>;
			try {
				pkg = JSON.parse(original) as Record<string, unknown>;
			} catch {
				continue; // unparseable → conflict markers will have reported it
			}
			fileRenames.push(...renamePackageJsonFields(pkg, renameMap));
			next = `${JSON.stringify(pkg, null, "\t")}\n`;
		} else {
			const res = renameSpecifiersInText(original, renameMap);
			next = res.content;
			fileRenames.push(...res.renames);
		}

		if (next !== original) {
			writeText(file, next);
			report.filesTouched.push(rel);
			for (const r of fileRenames) report.renames.push({ file: rel, ...r });
		}
	}
	report.filesTouched.sort();
	return report;
}

export { join };
