// adapters/shell.ts — minimal command resolution (F15 detection).
//
// `command -v <bin>` with a bounded timeout. Never executes the install hint
// (fail-closed display-only). PATH prefix with fake bins is the F21 fixture
// mechanism — the env is inherited as-is.
import { execFile } from "node:child_process";

/** Resolve a binary on PATH; returns the absolute path or undefined.
 *  Uses `sh -c "command -v <bin>"` — `command` is a shell builtin, not an
 *  executable, so execFile("command") would ENOENT. */
export function resolveBinaryOnPath(bin: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", `command -v ${bin} 2>/dev/null`], { env: env as Record<string, string>, timeout: 5_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const out = stdout.trim();
      resolve(out.length > 0 ? out : undefined);
    });
  });
}
