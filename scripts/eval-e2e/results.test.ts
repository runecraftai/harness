// eval-e2e/results.test.ts — serialização determinística + escrita atômica (D4).
//
// Dado o MESMO input, os bytes são idênticos (criterion offline); escrita
// atômica: tmp + rename — nunca existe arquivo pela metade; path versionado
// results/<harnessVersion>/<roundId>.json (E2EV-05 AC 2.1/2.2).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	readRound,
	roundIdFromDate,
	roundPath,
	serializeRound,
	writeRoundAtomic,
} from "./lib/results.ts";
import type { RoundResult } from "./types.ts";

function sampleRound(): RoundResult {
	return {
		harnessVersion: "0.1.0",
		piVersion: "0.84.1",
		model: "deepseek-v4-flash",
		provider: "opencode-go",
		date: "2026-08-08T12:00:00.000Z",
		roundId: "2026-08-08T12-00-00Z",
		partial: false,
		sanityFailed: false,
		interruptedAt: null,
		environment: { bun: "1.3.14", node: "24.3.0", os: "linux" },
		confounders: [],
		probe: { tokensApprox: 42, costUsd: 0.0001 },
		scenarios: [
			{
				id: "COEX-05",
				name: "hello-world-sdlc",
				status: "pass",
				durationMs: 23_400,
				tokensApprox: 18_000,
				verdict: { checks: [{ id: "greeting-exists", ok: true }] },
				notes: [],
				confounders: [],
			},
		],
	};
}

describe("serialização determinística (dado o mesmo input)", () => {
	test("2 serializações do mesmo round → bytes idênticos", () => {
		expect(serializeRound(sampleRound())).toBe(serializeRound(sampleRound()));
	});

	test("campos do schema da spec presentes (harnessVersion, model, date, scenarios)", () => {
		const json = serializeRound(sampleRound());
		expect(json).toContain('"harnessVersion": "0.1.0"');
		expect(json).toContain('"model": "deepseek-v4-flash"');
		expect(json).toContain('"date": "2026-08-08T12:00:00.000Z"');
		expect(json).toContain('"id": "COEX-05"');
		expect(json).toContain('"status": "pass"');
		expect(json).toContain('"tokensApprox": 18000');
		expect(json).toContain('"durationMs": 23400');
		expect(json).toContain('"name": "hello-world-sdlc"');
	});

	test("status aceita os 4 valores do contrato F23", () => {
		for (const status of ["pass", "fail", "limit", "fail-infra"]) {
			const round = sampleRound();
			const scenario = round.scenarios[0];
			if (scenario === undefined) throw new Error("sampleRound sem cenários");
			scenario.status = status as RoundResult["scenarios"][number]["status"];
			const json = serializeRound(round);
			expect(json).toContain(`"status": "${status}"`);
		}
	});

	test("roundId = ISO com : → - e sem millis (nome de arquivo)", () => {
		const date = new Date("2026-08-08T12:30:45.123Z");
		expect(roundIdFromDate(date)).toBe("2026-08-08T12-30-45Z");
	});

	test("path versionado: results/<versão>/<roundId>.json (E2EV-05)", () => {
		const p = roundPath("/root/results", "0.1.0", "2026-08-08T12-30-45Z");
		expect(p).toBe("/root/results/0.1.0/2026-08-08T12-30-45Z.json");
	});
});

describe("escrita atômica (D4 — nunca arquivo pela metade)", () => {
	test("escreve + lê de volta; tmp não sobra", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-results-"));
		try {
			const target = path.join(dir, "0.1.0", "2026-08-08T12-30-45Z.json");
			writeRoundAtomic(target, sampleRound());
			expect(fs.existsSync(target)).toBe(true);
			const round = readRound(target);
			expect(round?.roundId).toBe("2026-08-08T12-00-00Z");
			// nenhum arquivo .tmp sobra
			const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.endsWith(".tmp"));
			expect(leftovers).toEqual([]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("2 rodadas da mesma versão → 2 arquivos (E2EV-05 AC 2.2)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-results-"));
		try {
			const a = sampleRound();
			const b = sampleRound();
			b.roundId = "2026-08-08T13-00-00Z";
			b.date = "2026-08-08T13:00:00.000Z";
			writeRoundAtomic(roundPath(dir, "0.1.0", a.roundId), a);
			writeRoundAtomic(roundPath(dir, "0.1.0", b.roundId), b);
			const files = fs.readdirSync(path.join(dir, "0.1.0")).filter((f) => f.endsWith(".json"));
			expect(files).toHaveLength(2);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rodada parcial + sanityFailed serializam (F23 ignora rodadas marcadas)", () => {
		const round = sampleRound();
		round.partial = true;
		round.sanityFailed = true;
		round.interruptedAt = "2026-08-08T12:05:00.000Z";
		const json = serializeRound(round);
		expect(json).toContain('"partial": true');
		expect(json).toContain('"sanityFailed": true');
		expect(json).toContain('"interruptedAt"');
	});
});
