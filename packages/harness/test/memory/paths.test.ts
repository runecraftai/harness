// test/memory/paths.test.ts — T1 (D1): resolveMemoryDir com env override e
// fallback <sharedGitRoot|cwd>/.runecraft/memory; ensureMemoryDir cria o dir;
// linked worktree REAL (git worktree add) resolve para o MESMO root do
// checkout principal.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDir, memoryDbPath, resolveMemoryDir } from "../../src/memory/paths.ts";

function makeDir(prefix: string): string {
	const dir = join(tmpdir(), `f29-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Env isolado do git do usuário (evita hooks/config globais nos fixtures). */
function gitEnv(): NodeJS.ProcessEnv {
	return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: tmpdir() };
}

function git(cwd: string, args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args], { env: gitEnv() });
}

/** Repo real com um commit + linked worktree (`git worktree add`). */
function makeRepoWithWorktree(): { base: string; main: string; worktree: string } {
	const base = makeDir("wt");
	const main = join(base, "main");
	const worktree = join(base, "task-worktree");
	mkdirSync(main, { recursive: true });
	git(main, ["init", "-q"]);
	writeFileSync(join(main, "file.txt"), "x\n");
	git(main, ["add", "."]);
	git(main, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
	git(main, ["worktree", "add", "-q", worktree]);
	return { base, main, worktree };
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

	test("linked worktree e checkout principal → UM memory root (worktree REAL)", () => {
		const { base, main, worktree } = makeRepoWithWorktree();
		try {
			const mainDir = resolveMemoryDir(main, process.env);
			expect(mainDir).toBe(join(main, ".runecraft", "memory"));
			expect(resolveMemoryDir(worktree, process.env)).toBe(mainDir);
			expect(resolveMemoryDir(join(worktree, "sub"), process.env)).toBe(mainDir);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("linked worktree → o DB é o do principal (não some com o worktree)", () => {
		const { base, main, worktree } = makeRepoWithWorktree();
		try {
			const dbPath = memoryDbPath(worktree, process.env);
			expect(dbPath).toBe(join(main, ".runecraft", "memory", "runes.db"));
			git(main, ["worktree", "remove", "--force", worktree]);
			expect(existsSync(worktree)).toBe(false);
			// O root resolvido antes da limpeza continua apontando para o principal.
			expect(dbPath.startsWith(join(base, "main"))).toBe(true);
			expect(resolveMemoryDir(main, process.env)).toBe(join(main, ".runecraft", "memory"));
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("git ilegível em `.git` arquivo → degrada para o próprio dir (sem path errado)", () => {
		const root = makeDir("fakegitfile");
		try {
			writeFileSync(join(root, ".git"), "gitdir: /nonexistent/gitdir\n");
			expect(resolveMemoryDir(root, process.env)).toBe(join(root, ".runecraft", "memory"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("submodule (`.git` arquivo apontando para outro repo) NÃO herda o root do superprojeto", () => {
		const base = makeDir("submod");
		const inner = join(base, "inner-repo");
		const superRepo = join(base, "super");
		const sub = join(superRepo, "sub");
		try {
			mkdirSync(inner, { recursive: true });
			git(inner, ["init", "-q"]);
			writeFileSync(join(inner, "a.txt"), "x\n");
			git(inner, ["add", "."]);
			git(inner, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
			mkdirSync(superRepo, { recursive: true });
			git(superRepo, ["init", "-q"]);
			writeFileSync(join(superRepo, "b.txt"), "y\n");
			git(superRepo, ["add", "."]);
			git(superRepo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
			// protocol.file.allow: exigido pelo git moderno para submodule local.
			git(superRepo, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", "../inner-repo", "sub"]);
			expect(resolveMemoryDir(sub, process.env)).toBe(join(sub, ".runecraft", "memory"));
			expect(resolveMemoryDir(superRepo, process.env)).toBe(join(superRepo, ".runecraft", "memory"));
		} finally {
			rmSync(base, { recursive: true, force: true });
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
