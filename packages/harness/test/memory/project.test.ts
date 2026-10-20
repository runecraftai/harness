// test/memory/project.test.ts — T1 (MEM-04): slug por remote git (fixture git
// com remote fake — regex SSH/HTTPS, strip .git) + fallback path absoluto +
// sem git root + env override.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveSlugFromRemote,
	disambiguatedSlugForRemote,
	findGitRoot,
	normalizeRemoteUrl,
	resolveProjectSlugSync,
	resolveSharedGitRootSync,
} from "../../src/memory/project.ts";

function makeGitRepo(): string {
	const dir = join(tmpdir(), `f29-proj-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "-q", dir], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: tmpdir() } });
	return dir;
}

/** Env isolado do git do usuário (fixtures de worktree). */
function gitEnv(): NodeJS.ProcessEnv {
	return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: tmpdir() };
}

/** Repo real com commit + remote + linked worktree (git worktree add). */
function makeRepoWithWorktree(remote: string): { base: string; main: string; worktree: string } {
	const base = join(tmpdir(), `f29-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
	const main = join(base, "main");
	const worktree = join(base, "task-worktree");
	mkdirSync(main, { recursive: true });
	const run = (args: string[]): void => {
		execFileSync("git", ["-C", main, ...args], { env: gitEnv() });
	};
	run(["init", "-q"]);
	run(["remote", "add", "origin", remote]);
	writeFileSync(join(main, "f.txt"), "x\n");
	run(["add", "."]);
	run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
	run(["worktree", "add", "-q", worktree]);
	return { base, main, worktree };
}

describe("normalizeRemoteUrl / deriveSlugFromRemote (port lib/project.ts)", () => {
	test("SSH remote → caminho após host, sem .git", () => {
		expect(normalizeRemoteUrl("git@github.com:foo/bar.git")).toBe("foo/bar");
		expect(deriveSlugFromRemote("git@github.com:foo/bar.git")).toBe("bar");
	});

	test("HTTPS remote → caminho após host, sem .git", () => {
		expect(normalizeRemoteUrl("https://github.com/runecraft-ai/harness.git")).toBe("runecraft-ai/harness");
		expect(deriveSlugFromRemote("https://github.com/runecraft-ai/harness.git")).toBe("harness");
	});

	test("URL sem .git → mantém", () => {
		expect(deriveSlugFromRemote("git@example.com:org/repo")).toBe("repo");
	});

	test("path puro → normalize inalterado", () => {
		expect(normalizeRemoteUrl("/abs/path/repo.git")).toBe("/abs/path/repo");
		expect(normalizeRemoteUrl("relative/path")).toBe("relative/path");
	});
});

describe("findGitRoot", () => {
	test("acha o git root subindo a árvore", () => {
		const repo = makeGitRepo();
		try {
			const nested = join(repo, "a", "b");
			mkdirSync(nested, { recursive: true });
			expect(findGitRoot(nested)).toBe(repo);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("sem .git → null", () => {
		const dir = join(tmpdir(), `f29-nogit-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		try {
			expect(findGitRoot(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("resolveSharedGitRootSync", () => {
	test("worktree linkada → checkout PRINCIPAL (findGitRoot devolve o worktree)", () => {
		const { base, main, worktree } = makeRepoWithWorktree("git@github.com:runecraft-ai/harness.git");
		try {
			expect(findGitRoot(worktree)).toBe(worktree);
			expect(resolveSharedGitRootSync(worktree)).toBe(main);
			expect(resolveSharedGitRootSync(join(worktree, "deep"))).toBe(main);
			expect(resolveSharedGitRootSync(main)).toBe(main);

			const fromMain = resolveProjectSlugSync(main, gitEnv());
			const fromWorktree = resolveProjectSlugSync(worktree, gitEnv());
			expect(fromWorktree.slug).toBe(fromMain.slug);
			expect(fromWorktree.slug).toBe("harness");
			expect(fromWorktree.rootPath).toBe(main);
			expect(fromWorktree.remoteUrl).toBe(fromMain.remoteUrl);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("sem git root → null", () => {
		const dir = join(tmpdir(), `f29-nogit-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		try {
			expect(resolveSharedGitRootSync(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("disambiguatedSlugForRemote", () => {
	test("remotes distintos com o mesmo último segmento → slugs distintos e estáveis", () => {
		const a = "https://one.example/team/shared.git";
		const b = "https://two.example/other/shared.git";
		expect(deriveSlugFromRemote(a)).toBe("shared");
		expect(deriveSlugFromRemote(b)).toBe("shared");
		const slugA = disambiguatedSlugForRemote("shared", a);
		const slugB = disambiguatedSlugForRemote("shared", b);
		expect(slugA).not.toBe(slugB);
		expect(slugA.startsWith("shared-")).toBe(true);
		expect(slugA).toBe(disambiguatedSlugForRemote("shared", a));
		expect(slugB).toBe(disambiguatedSlugForRemote("shared", b));
	});
});

describe("resolveProjectSlugSync", () => {
	test("git repo com remote → slug do remote (worktrees compartilham)", () => {
		const repo = makeGitRepo();
		try {
			execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:runecraft-ai/harness.git"], {
				env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
			});
			const identity = resolveProjectSlugSync(repo, { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
			expect(identity.slug).toBe("harness");
			expect(identity.rootPath).toBe(repo);
			expect(identity.remoteUrl).toBe("git@github.com:runecraft-ai/harness.git");
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("git repo sem remote → path absoluto", () => {
		const repo = makeGitRepo();
		try {
			const identity = resolveProjectSlugSync(repo, { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
			expect(identity.slug).toBe(repo);
			expect(identity.remoteUrl).toBeNull();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("sem git root → path absoluto do cwd (edge case da spec)", () => {
		const dir = join(tmpdir(), `f29-nogit-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		try {
			const identity = resolveProjectSlugSync(dir, process.env);
			expect(identity.slug).toBe(dir);
			expect(identity.rootPath).toBe(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("env override RUNECRAFT_MEMORY_PROJECT_SLUG vence", () => {
		const dir = join(tmpdir(), `f29-env-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		try {
			const identity = resolveProjectSlugSync(dir, { ...process.env, RUNECRAFT_MEMORY_PROJECT_SLUG: "fixed-slug" });
			expect(identity.slug).toBe("fixed-slug");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
