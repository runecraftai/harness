import {
	DEFAULT_COST_CAP_USD,
	DEFAULT_E2E_MODEL,
	DEFAULT_E2E_PROVIDER,
	resolveRateTable,
} from "../config.ts";
// eval-e2e/lib/env.ts — env-gating (E2EV-04/D5) + resolução de config (fail-closed).
//
// - Sem RUNECRAFT_E2E=1 → skip explícito, exit 0, ZERO tokens (padrão gentle-ai).
// - Config da rodada vem do env: modelo (RUNECRAFT_E2E_MODEL, default haiku-class
//   provado no F7), provider, API key (RUNECRAFT_E2E_API_KEY ou env padrão do
//   provider) — fail-closed com mensagem clara quando a key falta.
// - A API key NUNCA é logada; redactKey sanitiza qualquer output.
import type { E2EConfig } from "../types.ts";

/** Gating (D5): só roda com RUNECRAFT_E2E=1. */
export function isE2EEnabled(env: NodeJS.ProcessEnv): boolean {
	return env.RUNECRAFT_E2E === "1";
}

/** Mensagem de skip (D5 — CI fica verde sem tokens). */
export function skipMessage(): string {
	return [
		"RUNECRAFT_E2E não setado — cenários E2E skipped (padrão gentle-ai).",
		"CI normal não roda E2E com modelos reais: zero tokens, zero rede.",
		"Para rodar a rodada completa: RUNECRAFT_E2E=1 bun run eval:e2e",
		"Modos offline disponíveis sem env: --list-scenarios, --dry-run, --doctor",
	].join("\n");
}

/** Env padrão de API key por provider (apenas os conhecidos — sem invenção). */
const PROVIDER_API_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	google: "GOOGLE_API_KEY",
	gemini: "GEMINI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
};

function providerApiKeyEnv(provider: string): string | undefined {
	const key = PROVIDER_API_KEY_ENV[provider.toLowerCase()];
	return key !== undefined ? key : undefined;
}

export function resolveConfig(
	env: NodeJS.ProcessEnv,
): { ok: true; config: E2EConfig } | { ok: false; error: string } {
	const model = env.RUNECRAFT_E2E_MODEL?.trim() || DEFAULT_E2E_MODEL;
	const provider = env.RUNECRAFT_E2E_PROVIDER?.trim() || DEFAULT_E2E_PROVIDER;

	const apiKey = env.RUNECRAFT_E2E_API_KEY?.trim() || "";
	const standardEnv = providerApiKeyEnv(provider);
	const standardKey = standardEnv !== undefined ? (env[standardEnv]?.trim() ?? "") : "";
	const key = apiKey || standardKey;
	if (key === "") {
		const standardHint = standardEnv !== undefined ? ` (ou ${standardEnv})` : "";
		return {
			ok: false,
			error: [
				`Config E2E incompleta: nenhuma API key encontrada para o provider "${provider}".`,
				`  Defina RUNECRAFT_E2E_API_KEY${standardHint} — a chave é lida SÓ do env,`,
				"  nunca é logada e nunca entra nos resultados.",
			].join("\n"),
		};
	}

	const capRaw = env.RUNECRAFT_E2E_COST_CAP_USD?.trim();
	const cap = capRaw !== undefined && capRaw !== "" ? Number(capRaw) : DEFAULT_COST_CAP_USD;
	if (!Number.isFinite(cap) || cap <= 0) {
		return {
			ok: false,
			error: `RUNECRAFT_E2E_COST_CAP_USD inválido: "${capRaw}" (esperado número > 0)`,
		};
	}

	return {
		ok: true,
		config: {
			model,
			provider,
			apiKey: key,
			baseUrl: env.RUNECRAFT_E2E_BASE_URL?.trim() || undefined,
			api: env.RUNECRAFT_E2E_API?.trim() || undefined,
			costCapUsd: cap,
			rate: resolveRateTable(env),
			timeouts: {
				helloWorld: ms(env.RUNECRAFT_E2E_TIMEOUT_HELLO, 10 * 60_000),
				baselineLoad: ms(env.RUNECRAFT_E2E_TIMEOUT_BASELINE, 5 * 60_000),
				goalSubagent: ms(env.RUNECRAFT_E2E_TIMEOUT_SUBAGENT, 8 * 60_000),
				taskflowGoal: ms(env.RUNECRAFT_E2E_TIMEOUT_TASKFLOW, 8 * 60_000),
				prReview: ms(env.RUNECRAFT_E2E_TIMEOUT_PR, 8 * 60_000),
				auditorIsolation: ms(env.RUNECRAFT_E2E_TIMEOUT_AUDITOR, 5 * 60_000),
			},
			verbose: env.RUNECRAFT_E2E_VERBOSE === "1",
			keep: env.RUNECRAFT_E2E_KEEP === "1",
			skipProbe: env.RUNECRAFT_E2E_PROBE === "0",
		},
	};
}

function ms(raw: string | undefined, fallback: number): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Sanitiza um texto substituindo a API key por "<redacted>" (nunca logar a key). */
export function redactKey(text: string, apiKey: string): string {
	if (apiKey === "") return text;
	return text.split(apiKey).join("<redacted>");
}

/** Objeto de uso com a key removida (defesa: nenhum campo serializado contém a key). */
export function redactRecord(
	record: Record<string, unknown>,
	apiKey: string,
): Record<string, unknown> {
	if (apiKey === "") return record;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = typeof value === "string" ? redactKey(value, apiKey) : value;
	}
	return out;
}
