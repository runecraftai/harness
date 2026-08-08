/**
 * Shared helpers for the upstream sync workflow (F10).
 * Zero dependencies — Node builtins + the git CLI (already a harness
 * requirement). Everything here is pure/file-system level so the engine
 * stays testable against fixture trees in temp dirs.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export interface SpawnResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Run a command synchronously via Bun.spawnSync. */
export function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string; env?: Record<string, string> } = {},
): SpawnResult {
	const proc = Bun.spawnSync({
		cmd: [cmd, ...args],
		cwd: opts.cwd,
		env: opts.env ? { ...process.env, ...opts.env } : process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: proc.exitCode ?? -1,
		stdout: proc.stdout?.toString() ?? "",
		stderr: proc.stderr?.toString() ?? "",
	};
}

/** Assert the git CLI exists (hard requirement for `git merge-file`). */
export function requireGit(): void {
	const res = run("git", ["--version"]);
	if (res.code !== 0) {
		throw new Error(
			"git CLI not available — the sync engine requires git (git merge-file drives the three-way merge). Install git and retry.",
		);
	}
}

/** Recursively list files under a dir as sorted relative paths. */
export function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const visit = (d: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const full = join(d, entry.name);
			if (entry.isDirectory()) visit(full);
			else if (entry.isFile()) out.push(relative(dir, full));
		}
	};
	visit(dir);
	return out.sort();
}

/** Basic binary detection: NUL byte in the first 8KiB. */
export function isBinary(file: string): boolean {
	if (!existsSync(file)) return false;
	const bytes = readFileSync(file);
	return bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0);
}

export function readText(file: string): string {
	return readFileSync(file, "utf8");
}

export function writeText(file: string, content: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, "utf8");
}

/** Read+parse JSON, or null when missing/invalid. */
export function readJson<T>(file: string): T | null {
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return null;
	}
}

/** Write JSON in the repo convention: tabs + trailing newline. */
export function writeJson(file: string, data: unknown): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

/** Compare two files byte-for-byte. */
export function filesEqual(a: string, b: string): boolean {
	if (!existsSync(a) || !existsSync(b)) return existsSync(a) === existsSync(b);
	return readFileSync(a).equals(readFileSync(b));
}

/** Copy a file, creating parent dirs. */
export function copyFile(src: string, dest: string): void {
	mkdirSync(dirname(dest), { recursive: true });
	writeFileSync(dest, readFileSync(src));
}

/** Remove a tree if present. */
export function removeIfExists(dir: string): void {
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** A path is a file (not dir) when it exists. */
export function isFile(p: string): boolean {
	return existsSync(p) && statSync(p).isFile();
}

/** Match a relative path against exclude patterns ("vendor.json", "dist/**"). */
export function isExcluded(rel: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (pattern.endsWith("/**")) {
			const prefix = pattern.slice(0, -3); // strip "/**"
			if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
		} else if (pattern.endsWith("/")) {
			if (rel.startsWith(pattern)) return true;
		} else if (rel === pattern) {
			return true;
		}
	}
	return false;
}

/** dirname of the caller module's file, resolved absolute. */
export function moduleDir(meta: ImportMeta): string {
	return dirname(resolve(meta.dir));
}

export { basename, dirname, join, relative, resolve };
