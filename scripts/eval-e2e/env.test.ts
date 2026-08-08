// eval-e2e/env.test.ts — env-gating (E2EV-04/D5) + resolução de config fail-closed.
//
// HARD CONSTRAINT: o caminho real é env-gated e NUNCA roda em CI — estes
// testes provam: sem RUNECRAFT_E2E → skip + exit 0 (zero tokens, zero rede);
// config sem API key → fail-closed com mensagem clara; redação da key.
import { describe, expect, test } from "bun:test";
import { isE2EEnabled, redactKey, redactRecord, resolveConfig, skipMessage } from "./lib/env.ts";

describe("env-gating (D5)", () => {
	test("sem RUNECRAFT_E2E → disabled (skip, exit 0, zero tokens)", () => {
		expect(isE2EEnabled({})).toBe(false);
		expect(isE2EEnabled({ RUNECRAFT_E2E: "0" })).toBe(false);
		expect(isE2EEnabled({ RUNECRAFT_E2E: "" })).toBe(false);
		expect(isE2EEnabled({ RUNECRAFT_E2E: "1" })).toBe(true);
	});

	test("mensagem de skip é clara e instrui o comando exato", () => {
		const msg = skipMessage();
		expect(msg).toContain("RUNECRAFT_E2E não setado");
		expect(msg).toContain("RUNECRAFT_E2E=1 bun run eval:e2e");
		expect(msg).toContain("zero tokens");
	});
});

describe("config fail-closed (E2EV-01/AC 1.4 + API key do env)", () => {
	test("sem API key → erro claro, sem rodar", () => {
		const res = resolveConfig({ RUNECRAFT_E2E: "1" });
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain("RUNECRAFT_E2E_API_KEY");
			expect(res.error).toContain("provider");
		}
	});

	test("RUNECRAFT_E2E_API_KEY resolve", () => {
		const res = resolveConfig({ RUNECRAFT_E2E: "1", RUNECRAFT_E2E_API_KEY: "sk-test" });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.config.apiKey).toBe("sk-test");
			expect(res.config.costCapUsd).toBe(10); // default AD-037
			expect(res.config.model).toBe("deepseek-v4-flash"); // haiku-class default (F7)
			expect(res.config.provider).toBe("opencode-go");
		}
	});

	test("env padrão do provider cai como fallback (anthropic → ANTHROPIC_API_KEY)", () => {
		const res = resolveConfig({
			RUNECRAFT_E2E: "1",
			RUNECRAFT_E2E_PROVIDER: "anthropic",
			ANTHROPIC_API_KEY: "sk-ant",
		});
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.config.apiKey).toBe("sk-ant");
	});

	test("cost cap custom e inválido", () => {
		const ok = resolveConfig({
			RUNECRAFT_E2E: "1",
			RUNECRAFT_E2E_API_KEY: "k",
			RUNECRAFT_E2E_COST_CAP_USD: "2.5",
		});
		expect(ok.ok).toBe(true);
		if (ok.ok) expect(ok.config.costCapUsd).toBe(2.5);
		const bad = resolveConfig({
			RUNECRAFT_E2E: "1",
			RUNECRAFT_E2E_API_KEY: "k",
			RUNECRAFT_E2E_COST_CAP_USD: "abc",
		});
		expect(bad.ok).toBe(false);
	});
});

describe("redação da API key (privacidade — nunca logar)", () => {
	test("redactKey substitui a key em qualquer texto", () => {
		expect(redactKey("usa sk-test aqui", "sk-test")).toBe("usa <redacted> aqui");
		expect(redactKey("sem segredo", "sk-x")).toBe("sem segredo");
	});

	test("redactRecord sanitiza campos string (defesa — results nunca contêm a key)", () => {
		const record = { model: "m", env: "apiKey=sk-test" };
		const out = redactRecord(record, "sk-test");
		expect(out.env).toBe("apiKey=<redacted>");
	});
});
