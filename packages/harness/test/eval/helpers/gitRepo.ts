// eval/helpers/gitRepo.ts — repo de teste descartável (D3).
//
// Edge da spec (git config global do runner): todo spawn de git usa
// GIT_CONFIG_GLOBAL=/dev/null + GIT_CONFIG_SYSTEM=/dev/null e config local.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TestRepo {
  dir: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
}

export function git(dir: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  const res = execFileSync("git", args, {
    cwd: dir,
    env: gitEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return res.trim();
}

/** Init de um repo com config local (user/email) e um commit base. */
export function initEvalRepo(base: string, env: NodeJS.ProcessEnv): TestRepo {
  const dir = path.join(base, "repo");
  fs.mkdirSync(dir, { recursive: true });
  git(dir, env, "init", "-q", "-b", "main");
  git(dir, env, "config", "user.email", "eval@runecraft.test");
  git(dir, env, "config", "user.name", "Runecraft Eval");
  fs.writeFileSync(path.join(dir, "README.md"), "# eval repo\n");
  git(dir, env, "add", "README.md");
  git(dir, env, "commit", "-q", "-m", "chore: base");
  return {
    dir,
    env,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}
