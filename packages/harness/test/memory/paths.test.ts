// test/memory/paths.test.ts — T1 (D1): resolveMemoryDir com env override e
// fallback <gitRoot|cwd>/.runecraft/memory; ensureMemoryDir cria o dir.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDir, memoryDbPath, resolveMemoryDir } from "../../src/memory/paths.ts";

function makeDir(prefix: string): string {
	const dir = join(tmpdir(), `f29-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("resolveMemoryDir (D1/QA-1a)", () => {
	test("RUNECRAFT_MEMORY_DATA_DIR override vence (evals)", () => {
		const dir = makeDir("env");
		try {
			const override = join(dir, "mem-override");
			expect(resolveMemoryDir("/some/cwd", { ...process.env, RUNECRAFT_MEMORY_DATA_DIR: override })).toBe(override);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sem git root → <cwd>/.runecraft/memory", () => {
		const dir = makeDir("nogit");
		try {
			expect(resolveMemoryDir(dir, process.env)).toBe(join(dir, ".runecraft", "memory"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("git root → <gitRoot>/.runecraft/memory (worktrees compartilham)", () => {
		const root = makeDir("gitroot");
		const sub = join(root, "sub", "deep");
		mkdirSync(sub, { recursive: true });
		mkdirSync(join(root, ".git"), { recursive: true });
		try {
			expect(resolveMemoryDir(sub, process.env)).toBe(join(root, ".runecraft", "memory"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("memoryDbPath → <memoryDir>/runes.db", () => {
		const dir = makeDir("dbp");
		try {
			expect(memoryDbPath(dir, process.env)).toBe(join(dir, ".runecraft", "memory", "runes.db"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("ensureMemoryDir", () => {
	test("cria o dir recursivamente", () => {
		const dir = makeDir("ens");
		try {
			const memoryDir = ensureMemoryDir(dir, process.env);
			expect(existsSync(memoryDir)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
