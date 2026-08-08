// eval/ratchet-e2e.test.ts — lane E2E do F23 P2 (métrica d): runner + regras
// D5/D6 com fixtures em temp dir (NUNCA roda o F22 — lê arquivos commitados).
// Cobre: valid-round/sanity, fail-infra excluído, denominador 0, regressão
// (exit 1 + mensagem exata), melhora (verde + aviso), rodada inválida (2),
// sem baseline/resultados (2), JSON inválido (2), --update aditivo + recusa
// com CI=true, e o wiring do CLI (subprocess: `bun run eval:ratchet --e2e`).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	compareE2ERound,
	compareVersions,
	E2E_PASSRATE_HEADER,
	findLatestRound,
	parsePassrateBaseline,
	passRateOf,
	readRoundFile,
	referenceVersion,
	roundValidity,
	runE2ERatchet,
	sanityScenario,
	serializePassrateBaseline,
	severityOf,
	type E2EScenarioLike,
	type PassrateEntry,
} from "./ratchet-e2e.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..");
const RATCHET_RUN = path.resolve(import.meta.dir, "ratchet-run.ts");
const RATCHET_E2E = path.resolve(import.meta.dir, "ratchet-e2e.ts");

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "f23-e2e-ratchet-"));
}

function scn(id: string, name: string, status: string): E2EScenarioLike {
	return { id, name, status };
}

/** Escreve um round F22 válido (schema D4) em results/<version>/<roundId>.json. */
function writeRound(
	resultsRoot: string,
	version: string,
	roundId: string,
	scenarios: E2EScenarioLike[],
	over: Partial<{ partial: boolean; sanityFailed: boolean; harnessVersion: string; model: string }> = {},
): string {
	const file = path.join(resultsRoot, version, `${roundId}.json`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const round = {
		harnessVersion: over.harnessVersion ?? version,
		piVersion: "2.4.0",
		model: over.model ?? "claude-3-5-haiku-latest",
		provider: "anthropic",
		date: `${roundId.slice(0, 10)}T${roundId.slice(11, 19).replace(/-/g, ":")}.000Z`,
		roundId,
		partial: over.partial ?? false,
		sanityFailed: over.sanityFailed ?? false,
		interruptedAt: null,
		environment: {},
		confounders: [],
		probe: null,
		vendorHash: null,
		scenarios: scenarios.map((s) => ({
			id: s.id,
			name: s.name,
			status: s.status,
			durationMs: 1000,
			tokensApprox: 10,
			verdict: { checks: [] },
			notes: [],
			confounders: [],
		})),
	};
	fs.writeFileSync(file, `${JSON.stringify(round, null, 2)}\n`, "utf8");
	return file;
}

/** Baseline e2e-passrate.txt: header + linhas dadas (sem data na linha — D1). */
function writeBaseline(dir: string, lines: string[]): string {
	const file = path.join(dir, "e2e-passrate.txt");
	fs.writeFileSync(file, lines.length === 0 ? `${E2E_PASSRATE_HEADER}\n` : `${E2E_PASSRATE_HEADER}\n${lines.join("\n")}\n`, "utf8");
	return file;
}

function baselineLines(version: string, entries: Array<[string, string]>): string[] {
	return entries.map(([scenario, status]) => `${version}\t${scenario}\t${status}`);
}

/** Cenários padrão de uma rodada (sanity + 5) — names reais do F22. */
function fullRound(overrides: Record<string, string> = {}): E2EScenarioLike[] {
	const defaults: Array<[string, string, string]> = [
		["COEX-05", "hello-world-sdlc", "pass"],
		["COEX-01", "baseline-load", "pass"],
		["COEX-02", "goal-subagent-chain", "pass"],
		["COEX-03", "taskflow-dag-goal", "pass"],
		["COEX-04", "pr-review", "pass"],
		["COEX-06", "auditor-isolation", "pass"],
	];
	return defaults.map(([id, name, status]) => scn(id, name, overrides[name] ?? status));
}

/** spawn do runner com env hermético (scrub RUNECRAFT_E2E* e CI — gate F22). */
function runCli(args: string[], overrides: Record<string, string>): { code: number; stdout: string } {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (k.startsWith("RUNECRAFT_E2E") || k === "CI") continue;
		env[k] = v;
	}
	const result = spawnSync(process.execPath, args, {
		encoding: "utf8",
		env: { ...env, ...overrides },
		cwd: PACKAGE_ROOT,
		timeout: 30_000,
	});
	return { code: result.status ?? -1, stdout: result.stdout };
}

describe("compareVersions — critério de versão (D1, validar no Execute)", () => {
	test("segmentos numéricos (0.1.0 < 0.2.0; 0.9.0 < 0.10.0)", () => {
		expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
		expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
		expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
		expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
	});

	test("sufixo numérico com segmento ausente → colação pinada (1.0 < 1.0.1)", () => {
		expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
		expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
	});

	test("determinístico: nunca localeCompare", () => {
		expect(compareVersions("0.2.0", "0.10.0")).toBe(compareVersions("0.2.0", "0.10.0"));
	});
});

describe("pass rate (D5 — fail-infra excluído do numerador E denominador)", () => {
	test("mix completo: pass/(pass+fail+limit), fail-infra fora", () => {
		const r = passRateOf([
			scn("a", "hello-world-sdlc", "pass"),
			scn("b", "x", "fail"),
			scn("c", "y", "limit"),
			scn("d", "z", "fail-infra"),
			scn("e", "w", "fail-infra"),
		]);
		expect(r.rate).toBeCloseTo(1 / 3, 10);
		expect(r).toEqual({ rate: expect.closeTo(1 / 3, 10), pass: 1, fail: 1, limit: 1, failInfra: 2 });
	});

	test("denominador 0 (só fail-infra) → rate null (inconclusivo, não sinaliza)", () => {
		const r = passRateOf([scn("a", "x", "fail-infra"), scn("b", "y", "fail-infra")]);
		expect(r.rate).toBeNull();
		expect(r.failInfra).toBe(2);
	});

	test("severidade: pass > limit > fail (piorou = severidade menor)", () => {
		expect(severityOf("pass")).toBeGreaterThan(severityOf("limit"));
		expect(severityOf("limit")).toBeGreaterThan(severityOf("fail"));
	});
});

describe("baseline e2e-passrate.txt (D1 — sem data na linha)", () => {
	test("parse: ignora comentários/vazias/malformadas; última ocorrência vence", () => {
		const text = `${E2E_PASSRATE_HEADER}\n0.1.0\thello-world-sdlc\tpass\n0.2.0\ttaskflow-dag-goal\tpass\nlinha-malformada\n0.2.0\ttaskflow-dag-goal\tfail\n`;
		const parsed = parsePassrateBaseline(text);
		expect(parsed.get("0.1.0")?.get("hello-world-sdlc")).toBe("pass");
		// aditivo: bloco mais recente da versão = estado efetivo
		expect(parsed.get("0.2.0")?.get("taskflow-dag-goal")).toBe("fail");
		expect(parsed.size).toBe(2);
	});

	test("serialize: header + versões ordenadas por compareVersions, cenários pela colação pinada", () => {
		const versions = new Map<string, PassrateEntry>();
		const v2 = new Map<string, string>([["pr-review", "pass"], ["hello-world-sdlc", "pass"]]);
		const v1 = new Map<string, string>([["taskflow-dag-goal", "limit"]]);
		versions.set("0.2.0", v2);
		versions.set("0.1.0", v1);
		const text = serializePassrateBaseline(E2E_PASSRATE_HEADER, versions);
		expect(text).toBe(
			`${E2E_PASSRATE_HEADER}\n0.1.0\ttaskflow-dag-goal\tlimit\n0.2.0\thello-world-sdlc\tpass\n0.2.0\tpr-review\tpass\n`,
		);
		// roundtrip byte a byte (determinismo D2)
		expect(serializePassrateBaseline(E2E_PASSRATE_HEADER, parsePassrateBaseline(text))).toBe(text);
	});
});

describe("validade da rodada (D5 — sanity cenário 0 presente E pass)", () => {
	const round = (scenarios: E2EScenarioLike[], sanityFailed = false) => ({
		harnessVersion: "0.2.0",
		scenarios,
		sanityFailed,
	});

	test("sanityScenario: encontra por name E por id (contrato F22)", () => {
		expect(sanityScenario(round(fullRound()))?.name).toBe("hello-world-sdlc");
		expect(sanityScenario(round([scn("COEX-05", "hello-world-sdlc", "pass")]))?.name).toBe("hello-world-sdlc");
		expect(sanityScenario(round([scn("COEX-01", "baseline-load", "pass")]))).toBeNull();
	});

	test("ok: cenário 0 presente e pass", () => {
		expect(roundValidity(round(fullRound()))).toEqual({ ok: true });
	});

	test("inválida: sanity ausente", () => {
		const v = roundValidity(round([scn("COEX-01", "baseline-load", "pass")]));
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toContain("ausente");
	});

	test("inválida: sanity fail/limit (qualquer status ≠ pass)", () => {
		for (const status of ["fail", "limit", "fail-infra"]) {
			const v = roundValidity(round(fullRound({ "hello-world-sdlc": status })));
			expect(v.ok).toBe(false);
			if (!v.ok) expect(v.reason).toContain("não passou");
		}
	});

	test("inválida: sanityFailed flag do F22 (D4)", () => {
		const v = roundValidity(round(fullRound(), true));
		expect(v.ok).toBe(false);
	});
});

describe("leitura de results/ (F22 D4 — schema)", () => {
	test("readRoundFile: JSON válido → round; JSON inválido → erro", () => {
		const dir = tmpRoot();
		try {
			const good = writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			expect(readRoundFile(good).ok).toBe(true);
			const bad = path.join(dir, "0.2.0", "broken.json");
			fs.writeFileSync(bad, "{not json", "utf8");
			const read = readRoundFile(bad);
			expect(read.ok).toBe(false);
			if (!read.ok) expect(read.error).toContain("JSON inválido");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("readRoundFile: schema inválido (status desconhecido, cenário sem name)", () => {
		const dir = tmpRoot();
		try {
			const badStatus = writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", [scn("COEX-05", "hello-world-sdlc", "maybe")]);
			const r1 = readRoundFile(badStatus);
			expect(r1.ok).toBe(false);
			if (!r1.ok) expect(r1.error).toContain("status desconhecido");

			const noName = writeRound(dir, "0.2.0", "2026-08-09T11-00-00Z", [{ id: "COEX-05", status: "pass" }]);
			const r2 = readRoundFile(noName);
			expect(r2.ok).toBe(false);
			if (!r2.ok) expect(r2.error).toContain("sem name");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("findLatestRound: pega a rodada mais recente (roundId ISO cronológico)", () => {
		const dir = tmpRoot();
		try {
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			writeRound(dir, "0.2.0", "2026-08-10T09-00-00Z", fullRound());
			const latest = findLatestRound(dir, "0.2.0");
			expect(latest?.ok).toBe(true);
			if (latest?.ok) expect(latest.round.roundId).toBe("2026-08-10T09-00-00Z");
			expect(findLatestRound(dir, "0.9.9")).toBeNull(); // diretório inexistente
			const empty = path.join(dir, "0.3.0");
			fs.mkdirSync(empty, { recursive: true });
			expect(findLatestRound(dir, "0.3.0")).toBeNull(); // sem arquivos
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("comparação (compareE2ERound — D5)", () => {
	test("regressão: mensagem LOCKED com pioras por cenário", () => {
		const ref = new Map<string, string>([
			["hello-world-sdlc", "pass"],
			["taskflow-dag-goal", "pass"],
		]);
		const c = compareE2ERound(
			[scn("COEX-05", "hello-world-sdlc", "pass"), scn("COEX-03", "taskflow-dag-goal", "fail")],
			"0.1.0",
			ref,
		);
		expect(c.verdict).toBe("regression");
		expect(c.worsened).toEqual(["taskflow-dag-goal"]);
		expect(c.regressionMessage).toBe("regressão vs v0.1.0: 100% → 50% (cenários: taskflow-dag-goal)");
	});

	test("fail-infra é invisível: cenário infra não piora nem altera o rate", () => {
		const ref = new Map<string, string>([
			["hello-world-sdlc", "pass"],
			["pr-review", "pass"],
		]);
		const c = compareE2ERound(
			[
				scn("COEX-05", "hello-world-sdlc", "pass"),
				scn("COEX-04", "pr-review", "fail-infra"),
				scn("COEX-02", "goal-subagent-chain", "fail-infra"),
			],
			"0.1.0",
			ref,
		);
		expect(c.verdict).toBe("equal");
		expect(c.worsened).toEqual([]);
		expect(c.curRate).toMatchObject({ pass: 1, fail: 0, limit: 0, failInfra: 2 });
	});

	test("cenário novo falhando derruba o rate → regressão com lista de novos", () => {
		const ref = new Map<string, string>([
			["hello-world-sdlc", "pass"],
			["taskflow-dag-goal", "pass"],
		]);
		const c = compareE2ERound(
			[
				scn("COEX-05", "hello-world-sdlc", "pass"),
				scn("COEX-03", "taskflow-dag-goal", "pass"),
				scn("COEX-04", "pr-review", "fail"),
			],
			"0.1.0",
			ref,
		);
		expect(c.verdict).toBe("regression");
		expect(c.newNonPass).toEqual(["pr-review"]);
		expect(c.regressionMessage).toBe("regressão vs v0.1.0: 100% → 67% (novos cenários: pr-review)");
	});
});

describe("runner — exit codes (0 verde · 1 regressão · 2 infra/config)", () => {
	test("regressão 80% → 60% → exit 1 com a mensagem exata", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["goal-subagent-chain", "pass"],
					["taskflow-dag-goal", "pass"],
					["pr-review", "pass"],
					["auditor-isolation", "limit"],
				]),
			);
			// mesma carteira de cenários da referência (sem baseline-load) → 3/5 = 60%
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", [
				scn("COEX-05", "hello-world-sdlc", "pass"),
				scn("COEX-02", "goal-subagent-chain", "pass"),
				scn("COEX-03", "taskflow-dag-goal", "fail"),
				scn("COEX-04", "pr-review", "pass"),
				scn("COEX-06", "auditor-isolation", "limit"),
			]);
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(1);
			expect(result.lines).toContain("regressão vs v0.1.0: 80% → 60% (cenários: taskflow-dag-goal)");
			expect(result.lines.join("\n")).toContain("→ VERMELHO (exit 1)");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("melhora 33% → 100% → exit 0 + aviso de --update", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["taskflow-dag-goal", "fail"],
					["pr-review", "limit"],
				]),
			);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "taskflow-dag-goal": "pass", "pr-review": "pass" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(0);
			expect(result.lines.join("\n")).toContain("melhorou");
			expect(result.lines.join("\n")).toContain("ⓘ aviso: pass rate melhorou/igual — rode bun run eval:ratchet --e2e --update");
			expect(result.lines.join("\n")).toContain("→ VERDE (exit 0)");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("igual → exit 0 + aviso de --update", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["taskflow-dag-goal", "pass"],
				]),
			);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "taskflow-dag-goal": "pass" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(0);
			expect(result.lines.join("\n")).toContain("ⓘ aviso: pass rate melhorou/igual");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fail-infra no numerador E denominador: rodada com infra não piora (igual → 0)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["goal-subagent-chain", "pass"],
					["taskflow-dag-goal", "fail"],
				]),
			);
			writeRound(
				dir,
				"0.2.0",
				"2026-08-09T10-00-00Z",
				fullRound({ "taskflow-dag-goal": "fail", "pr-review": "fail-infra", "auditor-isolation": "fail-infra" }),
			);
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(0);
			expect(result.lines.join("\n")).toContain("2 fail-infra excluídas");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rodada inválida (sanity fail) → exit 2, sem comparação", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "hello-world-sdlc": "fail" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("rodada inválida");
			expect(result.lines.join("\n")).not.toContain("regressão vs");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sem rodada para a versão → exit 2", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.1.0", "2026-08-09T10-00-00Z", fullRound());
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.3.0", wantUpdate: false });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("nenhuma rodada em results/0.3.0/");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sem baseline de versão anterior → exit 2 (primeira rodada: --update)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, []);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("sem baseline de versão anterior");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("JSON inválido → exit 2", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			const file = path.join(dir, "0.2.0", "2026-08-09T10-00-00Z.json");
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, "{nope", "utf8");
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("JSON inválido");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("harnessVersion do JSON diverge do diretório → exit 2 (mal rotulada)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound(), { harnessVersion: "9.9.9" });
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("mal rotulada");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("queda de rate por cenário NOVO falhando → exit 1 com (novos cenários: …)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["taskflow-dag-goal", "pass"],
				]),
			);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", [
				scn("COEX-05", "hello-world-sdlc", "pass"),
				scn("COEX-03", "taskflow-dag-goal", "pass"),
				scn("COEX-04", "pr-review", "fail"), // novo — derruba o rate p/ 2/3
			]);
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(1);
			expect(result.lines).toContain("regressão vs v0.1.0: 100% → 67% (novos cenários: pr-review)");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rodada parcial sem cenários completos → inconclusiva (exit 0, não sinaliza)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", [], { partial: true });
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: false });
			expect(result.exitCode).toBe(0);
			expect(result.lines.join("\n")).toContain("inconclusiva");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("--update (D5/D6 — aditivo, histórico preservado)", () => {
	test("aditivo: baseline da versão anterior preservado + rodada nova appenda", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["taskflow-dag-goal", "limit"],
				]),
			);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(0);
			const text = fs.readFileSync(baseline, "utf8");
			// histórico da 0.1.0 intocado
			expect(text).toContain("0.1.0\ttaskflow-dag-goal\tlimit");
			// rodada nova appenda
			expect(text).toContain("0.2.0\thello-world-sdlc\tpass");
			expect(text).toContain("0.2.0\tauditor-isolation\tpass");
			const parsed = parsePassrateBaseline(text);
			expect(parsed.get("0.1.0")?.get("taskflow-dag-goal")).toBe("limit");
			expect(parsed.get("0.2.0")?.size).toBe(6);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("re-update da MESMA versão: bloco novo appenda; estado efetivo = rodada mais recente", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.2.0", [["taskflow-dag-goal", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "taskflow-dag-goal": "pass" }));
			writeRound(dir, "0.2.0", "2026-08-10T09-00-00Z", fullRound({ "taskflow-dag-goal": "fail" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(0);
			const parsed = parsePassrateBaseline(fs.readFileSync(baseline, "utf8"));
			// última ocorrência = rodada de 2026-08-10 (fail) — histórico preservado
			expect(parsed.get("0.2.0")?.get("taskflow-dag-goal")).toBe("fail");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fail-infra nunca entra no baseline", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, []);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "pr-review": "fail-infra" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(0);
			const text = fs.readFileSync(baseline, "utf8");
			expect(text).not.toContain("pr-review"); // infra é invisível (D5)
			expect(text).toContain("0.2.0\thello-world-sdlc\tpass");
			// pass rate do baseline fica limpo: 5 cenários não-infra
			expect(parsePassrateBaseline(text).get("0.2.0")?.size).toBe(5);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rodada inválida é ignorada; nada válido → exit 2", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, []);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "hello-world-sdlc": "fail" }));
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("ignorada (baseline só recebe rodada válida)");
			expect(result.lines.join("\n")).toContain("nada gravado");
			expect(fs.readFileSync(baseline, "utf8")).toBe(`${E2E_PASSRATE_HEADER}\n`); // intocado
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rodada parcial é ignorada no baseline (fix cleric F23 P2 — partial nunca vira referência)", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, []);
			// Rodada válida (sanity pass) PORÉM interrompida (partial: true —
			// Ctrl-C do F22): cenários ausentes distorceriam o pass rate.
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound(), { partial: true });
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("PARCIAL (interrompida) — ignorada no baseline");
			expect(result.lines.join("\n")).toContain("nada gravado");
			expect(fs.readFileSync(baseline, "utf8")).toBe(`${E2E_PASSRATE_HEADER}\n`); // intocado
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("--update recusa com CI=true (D6) → exit 2", () => {
		const dir = tmpRoot();
		const previous = process.env.CI;
		try {
			const baseline = writeBaseline(dir, []);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			process.env.CI = "true";
			const result = runE2ERatchet({ resultsRoot: dir, baselinePath: baseline, version: "0.2.0", wantUpdate: true });
			expect(result.exitCode).toBe(2);
			expect(result.lines.join("\n")).toContain("refusado: --update é humano e explícito; CI=true detectado");
			expect(fs.readFileSync(baseline, "utf8")).toBe(`${E2E_PASSRATE_HEADER}\n`); // recusado = intocado
		} finally {
			if (previous === undefined) delete process.env.CI;
			else process.env.CI = previous;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("referenceVersion: maior versão < atual no baseline", () => {
		const baseline = parsePassrateBaseline(
			`${E2E_PASSRATE_HEADER}\n0.1.0\ta\tpass\n0.9.0\tb\tpass\n0.2.0\tc\tpass\n`,
		);
		expect(referenceVersion(baseline, "0.3.0")).toBe("0.2.0");
		expect(referenceVersion(baseline, "0.1.0")).toBeNull();
		expect(referenceVersion(baseline, "0.10.0")).toBe("0.9.0");
	});
});

describe("CLI wiring — `bun run eval:ratchet --e2e` (D6: mesmo entry, flag nova)", () => {
	test("ratchet-run.ts --e2e: regressão na fixture → exit 1 + mensagem exata", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(
				dir,
				baselineLines("0.1.0", [
					["hello-world-sdlc", "pass"],
					["goal-subagent-chain", "pass"],
					["taskflow-dag-goal", "pass"],
					["pr-review", "pass"],
					["auditor-isolation", "limit"],
				]),
			);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", [
				scn("COEX-05", "hello-world-sdlc", "pass"),
				scn("COEX-02", "goal-subagent-chain", "pass"),
				scn("COEX-03", "taskflow-dag-goal", "fail"),
				scn("COEX-04", "pr-review", "pass"),
				scn("COEX-06", "auditor-isolation", "limit"),
			]);
			const { code, stdout } = runCli([RATCHET_RUN, "--e2e"], {
				RUNECRAFT_E2E_RATCHET_RESULTS_ROOT: dir,
				RUNECRAFT_E2E_RATCHET_BASELINE: baseline,
				RUNECRAFT_E2E_RATCHET_VERSION: "0.2.0",
			});
			expect(code).toBe(1);
			expect(stdout).toContain("regressão vs v0.1.0: 80% → 60% (cenários: taskflow-dag-goal)");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("execução direta do ratchet-e2e.ts --e2e (guard de argv) → exit 1", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound({ "pr-review": "fail" }));
			const { code } = runCli([RATCHET_E2E, "--e2e"], {
				RUNECRAFT_E2E_RATCHET_RESULTS_ROOT: dir,
				RUNECRAFT_E2E_RATCHET_BASELINE: baseline,
				RUNECRAFT_E2E_RATCHET_VERSION: "0.2.0",
			});
			expect(code).toBe(1);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("--e2e --update com CI=true → recusado (exit 2), baseline intocado", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, []);
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			const { code, stdout } = runCli([RATCHET_RUN, "--e2e", "--update"], {
				RUNECRAFT_E2E_RATCHET_RESULTS_ROOT: dir,
				RUNECRAFT_E2E_RATCHET_BASELINE: baseline,
				RUNECRAFT_E2E_RATCHET_VERSION: "0.2.0",
				CI: "true",
			});
			expect(code).toBe(2);
			expect(stdout).toContain("refusado");
			expect(fs.readFileSync(baseline, "utf8")).toBe(`${E2E_PASSRATE_HEADER}\n`);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("--e2e --update (sem CI): roda aditivo e grava a rodada", () => {
		const dir = tmpRoot();
		try {
			const baseline = writeBaseline(dir, baselineLines("0.1.0", [["hello-world-sdlc", "pass"]]));
			writeRound(dir, "0.2.0", "2026-08-09T10-00-00Z", fullRound());
			const { code, stdout } = runCli([RATCHET_RUN, "--e2e", "--update"], {
				RUNECRAFT_E2E_RATCHET_RESULTS_ROOT: dir,
				RUNECRAFT_E2E_RATCHET_BASELINE: baseline,
				RUNECRAFT_E2E_RATCHET_VERSION: "0.2.0",
			});
			expect(code).toBe(0);
			expect(stdout).toContain("aditivo — histórico preservado");
			const text = fs.readFileSync(baseline, "utf8");
			expect(text).toContain("0.1.0\thello-world-sdlc\tpass");
			expect(text).toContain("0.2.0\thello-world-sdlc\tpass");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

