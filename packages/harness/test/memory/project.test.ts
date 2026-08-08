// test/memory/project.test.ts — T1 (MEM-04): slug por remote git (fixture git
// com remote fake — regex SSH/HTTPS, strip .git) + fallback path absoluto +
// sem git root + env override.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveSlugFromRemote,
	findGitRoot,
	normalizeRemoteUrl,
	resolveProjectSlugSync,
} from "../../src/memory/project.ts";

function makeGitRepo(): string {
	const dir = join(tmpdir(), `f29-proj-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "-q", dir], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: tmpdir() } });
	return dir;
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
