// eval-e2e/runner.test.ts — orquestração da rodada com deps FAKE (offline).
//
// HARD CONSTRAINT: o caminho real é env-gated e NUNCA roda em CI — estes
// testes provam a máquina da rodada com cenários/sessão/preflight fakes:
// exit codes (0 pass · 1 fail · 2 cost cap), sanity, rodada parcial, timeout,
// versionamento, fail-closed de config. Zero rede, zero tokens.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readRound } from "./lib/results.ts";
import { executeRound, resolveExitCode, resolveHarnessVersion, withTimeout } from "./lib/runner.ts";
import { loadScenarios } from "./scenarios/index.ts";
import type {
	PreflightResult,
	RoundResult,
	RunOutcome,
	RunnerDeps,
	ScenarioModule,
	SessionDriver,
	UsageLike,
} from "./types.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

interface FakeSessionOptions {
	usage?: Partial<UsageLike>;
	/** prompt lança? */
	promptError?: string;
}

function fakeSession(opts: FakeSessionOptions = {}): SessionDriver {
	const usage: UsageLike = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { total: 0 },
		...opts.usage,
	};
	return {
		async prompt() {
			if (opts.promptError !== undefined) throw new Error(opts.promptError);
		},
		async abort() {},
		toolRegistered: () => true,
		usage,
		tokensApprox: usage.totalTokens ?? null,
		observations: { compactionEvents: [], agentEnds: 0, toolCalls: [] },
		dispose() {},
	};
}

/** Lê o round do outcome (assere que foi gravado — helper dos testes). */
function roundOf(outcome: RunOutcome): RoundResult {
	expect(outcome.resultsPath).not.toBeNull();
	if (outcome.resultsPath === null) throw new Error("resultsPath null — rodada não gravada");
	const round = readRound(outcome.resultsPath);
	expect(round).not.toBeNull();
	if (round === null) throw new Error("round não lido do arquivo");
	return round;
}

function passScenario(overrides: Partial<ScenarioModule> = {}): ScenarioModule {
	return {
		id: "COEX-05",
		name: "hello-world-sdlc",
		description: "test",
		sanity: true,
		timeoutMs: 10_000,
		async run() {
			return { checks: [{ id: "ok", ok: true }], notes: [], confounders: [] };
		},
		...overrides,
	};
}

function failingScenario(name: string, id: string): ScenarioModule {
	return {
		...passScenario({ id, name, sanity: false }),
		async run() {
			return {
				checks: [{ id: "check-x", ok: false, detail: "arquivo ausente" }],
				notes: [],
				confounders: [],
			};
		},
	};
}

function hangingScenario(name: string, id: string): ScenarioModule {
	return {
		...passScenario({ id, name, sanity: false, timeoutMs: 50 }),
		run() {
			return new Promise(() => {
				// nunca resolve — o timeout do runner vira limit
			});
		},
	};
}

const okPreflight: RunnerDeps["preflight"] = async () => {
	const result: PreflightResult = {
		ok: true,
		aborts: [],
		confounders: [],
		environment: { bun: "1.3.14", node: "24.3.0", os: "linux" },
		ghAuthed: true,
	};
	return result;
};

function baseDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
	const resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-runner-"));
	return {
		env: { RUNECRAFT_E2E: "1", RUNECRAFT_E2E_API_KEY: "sk-test" },
		repoRoot: REPO_ROOT,
		resultsRoot,
		scenarios: [passScenario()],
		createSession: async () => fakeSession(),
		preflight: okPreflight,
		exec: async () => ({ ok: true, stdout: "", stderr: "" }),
		out: () => {},
		err: () => {},
		...overrides,
	};
}

describe("executeRound — exit codes (0 pass · 1 fail · 2 cost cap)", () => {
	test("tudo pass → exit 0 + JSON versionado no path da spec", async () => {
		const deps = baseDeps();
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(0);
		expect(outcome.resultsPath).not.toBeNull();
		expect(roundOf(outcome).harnessVersion !== "").toBe(true);
		const round = roundOf(outcome);
		expect(round?.harnessVersion).toBe("0.1.0");
		expect(round?.scenarios).toHaveLength(1);
		expect(round?.scenarios[0]?.status).toBe("pass");
		expect(round?.scenarios[0]?.name).toBe("hello-world-sdlc");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("fail em cenário não-sanity → exit 1 (status fail no JSON)", async () => {
		const deps = baseDeps({
			scenarios: [passScenario(), failingScenario("baseline-load", "COEX-01")],
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(1);
		const round = roundOf(outcome);
		expect(round?.scenarios[1]?.status).toBe("fail");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("cost cap estourado → exit 2 + cenário atual vira limit + parcial", async () => {
		let sessions = 0;
		const deps = baseDeps({
			scenarios: [
				passScenario(),
				passScenario({ id: "COEX-01", name: "baseline-load", sanity: false }),
			],
			createSession: async () => {
				sessions += 1;
				// probe (1ª sessão) não custa; o cenário estoura o cap
				return sessions === 1
					? fakeSession()
					: fakeSession({
							usage: { input: 1000, output: 1000, totalTokens: 2000, cost: { total: 11 } },
						});
			},
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(2);
		const round = roundOf(outcome);
		expect(round?.partial).toBe(true);
		expect(round?.scenarios[0]?.status).toBe("limit");
		expect(round?.scenarios).toHaveLength(1); // restantes não rodaram (HALT)
		expect(round?.scenarios[0]?.notes.join(" ")).toContain("cost cap");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("sanity fail → sanityFailed + parcial + exit 1 (rodada inválida p/ F23)", async () => {
		const deps = baseDeps({
			scenarios: [
				{
					...failingScenario("hello-world-sdlc", "COEX-05"),
					sanity: true,
				},
			],
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(1);
		const round = roundOf(outcome);
		expect(round?.sanityFailed).toBe(true);
		expect(round?.partial).toBe(true);
		expect(round?.scenarios).toHaveLength(1);
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("sanity fail-infra → aborta com instruções (rodada registrada, sanityFailed)", async () => {
		const deps = baseDeps({
			scenarios: [
				{
					...passScenario(),
					async run() {
						throw new Error("429 rate limit");
					},
				},
			],
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(1);
		const round = roundOf(outcome);
		expect(round?.sanityFailed).toBe(true);
		expect(round?.scenarios[0]?.status).toBe("fail-infra");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("timeout de cenário → limit (nunca fail — D7), rodada segue", async () => {
		const deps = baseDeps({
			scenarios: [passScenario(), hangingScenario("baseline-load", "COEX-01")],
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(0);
		const round = roundOf(outcome);
		expect(round?.scenarios[1]?.status).toBe("limit");
		expect(round?.scenarios[1]?.notes.join(" ")).toContain("timeout");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});
});

describe("executeRound — fail-closed e contrato do sanity", () => {
	test("sem API key → exit 1 com mensagem clara, NENHUM arquivo gravado", async () => {
		const deps = baseDeps({ env: { RUNECRAFT_E2E: "1" } });
		const errors: string[] = [];
		const outcome = await executeRound({ ...deps, err: (l) => errors.push(l) });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.resultsPath).toBeNull();
		expect(errors.join("\n")).toContain("RUNECRAFT_E2E_API_KEY");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("cenário 0 sem sanity → recusa (E2EV-03)", async () => {
		const deps = baseDeps({ scenarios: [passScenario({ sanity: false })] });
		const errors: string[] = [];
		const outcome = await executeRound({ ...deps, err: (l) => errors.push(l) });
		expect(outcome.exitCode).toBe(1);
		expect(errors.join("\n")).toContain("sanity");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("preflight com abort → exit 1 com instruções, nada roda (zero sessões)", async () => {
		let sessionsCreated = 0;
		const deps = baseDeps({
			preflight: async () => ({
				ok: false,
				aborts: [
					{ check: "pi no PATH", message: "binário pi não detectado", remedy: "Instale o Pi" },
				],
				confounders: [],
				environment: {},
				ghAuthed: false,
			}),
			createSession: async () => {
				sessionsCreated += 1;
				return fakeSession();
			},
		});
		const errors: string[] = [];
		const outcome = await executeRound({ ...deps, err: (l) => errors.push(l) });
		expect(outcome.exitCode).toBe(1);
		expect(sessionsCreated).toBe(0);
		expect(errors.join("\n")).toContain("Instale o Pi");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});
});

describe("executeRound — probe e versões", () => {
	test("probe de modelo roda antes dos cenários e contabiliza no cap", async () => {
		let sessions = 0;
		const deps = baseDeps({
			createSession: async () => {
				sessions += 1;
				return fakeSession({
					usage: { input: 100, output: 10, totalTokens: 110, cost: { total: 0.001 } },
				});
			},
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(0);
		expect(sessions).toBe(2); // probe + 1 cenário
		const round = roundOf(outcome);
		expect(round?.probe).not.toBeNull();
		expect(round?.probe?.tokensApprox).toBe(110);
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("skipProbe (RUNECRAFT_E2E_PROBE=0) não cria sessão de probe", async () => {
		let sessions = 0;
		const deps = baseDeps({
			env: { RUNECRAFT_E2E: "1", RUNECRAFT_E2E_API_KEY: "sk-test", RUNECRAFT_E2E_PROBE: "0" },
			createSession: async () => {
				sessions += 1;
				return fakeSession();
			},
		});
		const outcome = await executeRound(deps);
		expect(outcome.exitCode).toBe(0);
		expect(sessions).toBe(1);
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});

	test("probe falha → exit 1, rodada não inicia (economia de tokens)", async () => {
		const deps = baseDeps({
			createSession: async () => fakeSession({ promptError: "429 rate limit" }),
		});
		const errors: string[] = [];
		const outcome = await executeRound({ ...deps, err: (l) => errors.push(l) });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.round).toBeNull();
		expect(errors.join("\n")).toContain("probe");
		fs.rmSync(deps.resultsRoot, { recursive: true, force: true });
	});
});

describe("resolveHarnessVersion / resolveExitCode / withTimeout", () => {
	test("harnessVersion vem do package.json do umbrella (0.1.0)", () => {
		expect(resolveHarnessVersion(REPO_ROOT)).toBe("0.1.0");
	});

	test("resolveExitCode: cap → 2; fail/fail-infra → 1; pass/limit → 0", () => {
		const round = {
			scenarios: [{ status: "pass" }, { status: "limit" }],
			sanityFailed: false,
		} as never;
		expect(resolveExitCode(round as never, false)).toBe(0);
		expect(resolveExitCode(round as never, true)).toBe(2);
		const withFail = { scenarios: [{ status: "fail" }], sanityFailed: false } as never;
		expect(resolveExitCode(withFail, false)).toBe(1);
		const withInfra = { scenarios: [{ status: "fail-infra" }], sanityFailed: false } as never;
		expect(resolveExitCode(withInfra, false)).toBe(1);
	});

	test("withTimeout resolve ok antes do timer", async () => {
		const result = await withTimeout(Promise.resolve(42), 1000, "x");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(42);
	});

	test("withTimeout vira timeout (não rejeita)", async () => {
		const result = await withTimeout(new Promise(() => {}), 30, "lento");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("timeout");
	});

	test("withTimeout rejeições do promise propagam (o caller classifica)", async () => {
		await expect(
			withTimeout(Promise.reject(new Error("429 rate limit")), 1000, "x"),
		).rejects.toThrow("429");
	});
});

// Garante que os cenários reais carregam (o registry é parte do contrato).
describe("cenários reais carregam offline", () => {
	test("loadScenarios resolve os 6 módulos sem tocar em rede", async () => {
		const loaded = await loadScenarios();
		expect(loaded).toHaveLength(6);
	});
});
