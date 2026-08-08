// eval-e2e/classify.test.ts — classificação fail-infra (edge da spec).
//
// fail-infra (rate limit, auth, rede, spawn) NÃO conta como regressão no F23;
// timeout → limit (limite documentável — D7); o resto → fail.
import { describe, expect, test } from "bun:test";
import { classifyCheckFailure, classifyExecutionFailure, infraNote } from "./lib/classify.ts";

describe("classifyExecutionFailure", () => {
	test("rate limit (429) → fail-infra", () => {
		expect(classifyExecutionFailure(new Error("429 Too Many Requests"), "429 rate limit")).toBe(
			"fail-infra",
		);
		expect(classifyExecutionFailure(new Error("rate_limit_exceeded"), "rate_limit_exceeded")).toBe(
			"fail-infra",
		);
	});

	test("auth/API key → fail-infra", () => {
		expect(classifyExecutionFailure(new Error("401 unauthorized"), "401 unauthorized")).toBe(
			"fail-infra",
		);
		expect(classifyExecutionFailure(new Error("invalid api key"), "invalid api key")).toBe(
			"fail-infra",
		);
	});

	test("rede fora de loopback → fail-infra", () => {
		expect(classifyExecutionFailure(new Error("fetch failed"), "ENOTFOUND api.anthropic.com")).toBe(
			"fail-infra",
		);
	});

	test("spawn/modelo indisponível → fail-infra", () => {
		expect(classifyExecutionFailure(new Error("spawn pi ENOENT"), "spawn pi ENOENT")).toBe(
			"fail-infra",
		);
		expect(
			classifyExecutionFailure(
				new Error("model deepseek not available"),
				"model deepseek not available",
			),
		).toBe("fail-infra");
	});

	test("timeout → limit (nunca fail — D7)", () => {
		const err = new Error("timeout") as Error & { name: string };
		err.name = "TimeoutError";
		expect(classifyExecutionFailure(err, "timeout")).toBe("limit");
	});

	test("check falho comum → fail (regressão potencial)", () => {
		expect(
			classifyExecutionFailure(new Error("greeting.txt not found"), "greeting.txt not found"),
		).toBe("fail");
	});
});

describe("classifyCheckFailure", () => {
	test("check com detalhe de infra → fail-infra", () => {
		expect(classifyCheckFailure("verdict-json", "rate limit 429")).toBe("fail-infra");
	});
	test("check comum → fail", () => {
		expect(classifyCheckFailure("notes-exists", "arquivo ausente")).toBe("fail");
	});
});

describe("infraNote", () => {
	test("nota marca a exclusão do F23", () => {
		const note = infraNote("gh ausente");
		expect(note).toContain("fail-infra");
		expect(note).toContain("não conta como regressão no F23");
	});
});
