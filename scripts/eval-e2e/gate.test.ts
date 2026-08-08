// eval-e2e/gate.test.ts — env-gating no nível do PROCESSO (E2EV-04/D5).
//
// Prova end-to-end offline: sem RUNECRAFT_E2E, o runner imprime o skip e sai
// 0 (CI fica verde — zero tokens, zero rede). As superfícies offline
// (--list-scenarios/--dry-run/--doctor) funcionam sem env.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const RUNNER = path.resolve(import.meta.dir, "run.ts");

function runRunner(
	args: string[],
	env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [RUNNER, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 30_000,
	});
	return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("env-gating do processo (D5 — CI normal fica verde sem tokens)", () => {
	test("sem RUNECRAFT_E2E → mensagem de skip + exit 0", () => {
		const { code, stdout } = runRunner([]);
		expect(code).toBe(0);
		expect(stdout).toContain("RUNECRAFT_E2E não setado");
		expect(stdout).toContain("zero tokens");
	});

	test("RUNECRAFT_E2E=0 → skip (mesmo contrato)", () => {
		const { code, stdout } = runRunner([], { RUNECRAFT_E2E: "0" });
		expect(code).toBe(0);
		expect(stdout).toContain("RUNECRAFT_E2E não setado");
	});

	test("--list-scenarios funciona offline (sem env) e lista o sanity primeiro", () => {
		const { code, stdout } = runRunner(["--list-scenarios"]);
		expect(code).toBe(0);
		expect(stdout).toContain("hello-world-sdlc");
		expect(stdout).toContain("COEX-05");
		expect(stdout).toContain("**sanity**");
	});

	test("--dry-run funciona offline e avisa sobre o env", () => {
		const { code, stdout } = runRunner(["--dry-run"]);
		expect(code).toBe(0);
		expect(stdout).toContain("Plano da rodada E2E");
		expect(stdout).toContain("RUNECRAFT_E2E não setado");
	});
});
