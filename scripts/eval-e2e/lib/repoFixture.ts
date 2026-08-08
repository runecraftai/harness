// eval-e2e/lib/repoFixture.ts — repo de teste descartável por cenário (D3/F7).
//
// Isolamento máximo: git config LOCAL (F21 edge — isola o config global do
// runner), tmp dir, removido no cleanup (--keep preserva para debug).
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface RepoFixture {
	dir: string;
	cleanup(): void;
}

export function createRepoFixture(prefix: string): RepoFixture {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `runecraft-e2e-${prefix}-`));
	// Git local: config de identidade e default branch — NUNCA toca o global.
	runGit(dir, "init", "-q", "-b", "main");
	runGit(dir, "config", "user.email", "e2e@runecraft.local");
	runGit(dir, "config", "user.name", "Runecraft E2E");
	runGit(dir, "config", "commit.gpgsign", "false");
	return {
		dir,
		cleanup() {
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function runGit(cwd: string, ...args: string[]): string {
	const out = execSync(`git ${args.map(quote).join(" ")}`, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return out.trim();
}

function quote(arg: string): string {
	return /^[a-zA-Z0-9._/-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
