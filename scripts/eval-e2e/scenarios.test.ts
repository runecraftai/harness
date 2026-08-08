// eval-e2e/scenarios.test.ts — enumeração de cenários (extensível por arquivo).
//
// O contrato F23 usa o campo `name` como scenarioId (ex.: hello-world-sdlc) —
// os nomes são parte do baseline e2e-passrate.txt; o sanity é o cenário 0.
import { describe, expect, test } from "bun:test";
import { loadScenarios } from "./scenarios/index.ts";

describe("enumeração de cenários (D1 — add a file = add a scenario)", () => {
	test("6 cenários do F7 em ordem fixa (00 primeiro)", async () => {
		const scenarios = await loadScenarios();
		expect(scenarios).toHaveLength(6);
		expect(scenarios[0]?.id).toBe("COEX-05");
		expect(scenarios.map((s) => s.id)).toEqual([
			"COEX-05",
			"COEX-01",
			"COEX-02",
			"COEX-03",
			"COEX-04",
			"COEX-06",
		]);
	});

	test("cenário 0 é o sanity (hello world — E2EV-03)", async () => {
		const scenarios = await loadScenarios();
		expect(scenarios[0]?.sanity).toBe(true);
		expect(scenarios[0]?.name).toBe("hello-world-sdlc");
		expect(scenarios.filter((s) => s.sanity)).toHaveLength(1);
	});

	test("names estáveis (contrato F23 — e2e-passrate.txt)", async () => {
		const scenarios = await loadScenarios();
		const names = scenarios.map((s) => s.name);
		for (const expected of [
			"hello-world-sdlc",
			"baseline-load",
			"goal-subagent-chain",
			"taskflow-dag-goal",
			"pr-review",
			"auditor-isolation",
		]) {
			expect(names).toContain(expected);
		}
		expect(new Set(names).size).toBe(names.length); // únicos
	});

	test("COEX-04 exige gh (needsGh)", async () => {
		const scenarios = await loadScenarios();
		const pr = scenarios.find((s) => s.id === "COEX-04");
		expect(pr?.needsGh).toBe(true);
	});

	test("todo cenário tem timeout > 0 e run()", async () => {
		const scenarios = await loadScenarios();
		for (const s of scenarios) {
			expect(s.timeoutMs).toBeGreaterThan(0);
			expect(typeof s.run).toBe("function");
		}
	});
});
