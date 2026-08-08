// smoke-subprocess.test.ts — F21 D1: 2 smoke tests do bin real via bun.
//
// Cobrem o que só o processo real prova (shebang/parseArgs/exit code real):
// o bin/harness.ts é wrapper fino sobre dispatch(argv, ctx) e o subprocesso
// é o teste de verdade da plumbagem (F21 D1 contract).
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSandbox } from "../../helpers.ts";
import { evalTest, recordCoverage } from "../helpers/evalTest.ts";
import { waitForExit } from "../helpers/wait.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bin/harness.ts");

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBin(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [BIN, ...args], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    waitForExit(proc).then((code) => resolve({ code, stdout, stderr }));
  });
}

describe("smoke — bin real via subprocess (F21 D1)", () => {
  test("status --json via bin real → exit 0 + JSON válido", async () => {
    await evalTest("status --json via bin real → exit 0 + JSON válido", async () => {
      recordCoverage("status", ["--json"]);
      const sb = makeSandbox();
      try {
        const result = await runBin(["status", "--json"], sb.env, sb.dir);
        expect(result.code).toBe(0);
        const json = JSON.parse(result.stdout) as { scope: string; packages: unknown[] };
        expect(json.scope).toBe("global");
        expect(json.packages).toHaveLength(6);
      } finally {
        sb.cleanup();
      }
    });
  });

  test("install sem pi → fail-closed: exit ≠ 0 + stderr com o hint de instalação", async () => {
    await evalTest("install sem pi → fail-closed: exit ≠ 0 + stderr com o hint de instalação", async () => {
      recordCoverage("install", ["--json"]); // fix cleric F23: a flag --json é parte da identidade (D1)
      const sb = makeSandbox();
      try {
        // RUNECRAFT_PI_BIN aponta para um caminho inexistente (fail-closed — D3).
        sb.env.RUNECRAFT_PI_BIN = path.join(sb.dir, "no-such-pi");
        const result = await runBin(["install", "--json"], sb.env, sb.dir);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("pi");
        expect(result.stderr).toContain("npm install -g");
      } finally {
        sb.cleanup();
      }
    });
  });
});
