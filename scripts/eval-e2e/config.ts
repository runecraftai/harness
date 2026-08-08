// eval-e2e/config.ts — defaults da rodada F22 (D1/D7): modelo haiku-class,
// timeouts, retries, taxa de fallback documentada e cost cap (AD-037).
//
// Estimativas da tabela D7 (design) a calibrar com a primeira rodada real —
// os timeouts abaixo são os do design; a primeira rodada registra o real e
// a tabela é ajustada (regra F4 do design: nunca editar resultados antigos).
import type { E2EConfig, RateTable, ScenarioTimeouts } from "./types.ts";

/** Cost cap default da rodada em USD (AD-037: US$ 10 por execução). */
export const DEFAULT_COST_CAP_USD = 10;

/** Modelo haiku-class default — o PROVADO no F7 (ROUTING.md §5 / scenarios.md). */
export const DEFAULT_E2E_MODEL = "deepseek-v4-flash";

/** Provider default — o usado no F7 (sessão real opencode-go). */
export const DEFAULT_E2E_PROVIDER = "opencode-go";

/**
 * Tabela de taxas haiku-class por 1M tokens (FALLBACK documentado — D7).
 *
 * Usada SÓ quando o SDK não expõe `usage.cost` (a fonte primária é o cost
 * real calculado pelo SDK sobre a config do modelo — pi-ai calculateCost).
 * Base: taxas públicas Claude 3.5 Haiku (input US$0.80/M, output US$4/M,
 * cacheRead US$0.08/M, cacheWrite US$0.80/M). Override via env:
 * RUNECRAFT_E2E_RATE_INPUT/OUTPUT/CACHE_READ/CACHE_WRITE (por 1M).
 */
export const DEFAULT_RATE_TABLE: RateTable = {
	input: 0.8,
	output: 4,
	cacheRead: 0.08,
	cacheWrite: 0.8,
};

/** Timeouts por cenário (design D7 — tabela de estimativas). */
export const DEFAULT_TIMEOUTS: ScenarioTimeouts = {
	helloWorld: 10 * 60_000,
	baselineLoad: 5 * 60_000,
	goalSubagent: 8 * 60_000,
	taskflowGoal: 8 * 60_000,
	prReview: 8 * 60_000,
	auditorIsolation: 5 * 60_000,
};

/** Retry com backoff exponencial p/ rate limit (429 — D7). */
export const RETRY_MAX = 3;
export const RETRY_BASE_MS = 5_000;

/** Resolve a tabela de taxas com overrides de env (nunca inventa fora da env). */
export function resolveRateTable(env: NodeJS.ProcessEnv): RateTable {
	const num = (key: string, fallback: number): number => {
		const raw = env[key]?.trim();
		if (raw === undefined || raw === "") return fallback;
		const value = Number(raw);
		return Number.isFinite(value) && value >= 0 ? value : fallback;
	};
	return {
		input: num("RUNECRAFT_E2E_RATE_INPUT", DEFAULT_RATE_TABLE.input),
		output: num("RUNECRAFT_E2E_RATE_OUTPUT", DEFAULT_RATE_TABLE.output),
		cacheRead: num("RUNECRAFT_E2E_RATE_CACHE_READ", DEFAULT_RATE_TABLE.cacheRead),
		cacheWrite: num("RUNECRAFT_E2E_RATE_CACHE_WRITE", DEFAULT_RATE_TABLE.cacheWrite),
	};
}

/** Flags do CLI do runner (run.ts — parseArgs próprio, zero deps). */
export interface CliArgs {
	listScenarios: boolean;
	dryRun: boolean;
	doctor: boolean;
	preTag: boolean;
	verbose: boolean;
	keep: boolean;
	model?: string;
	provider?: string;
}

export function parseCliArgs(
	argv: string[],
): { ok: true; args: CliArgs } | { ok: false; error: string } {
	const args: CliArgs = {
		listScenarios: false,
		dryRun: false,
		doctor: false,
		preTag: false,
		verbose: false,
		keep: false,
	};
	for (const arg of argv) {
		switch (arg) {
			case "--list-scenarios":
				args.listScenarios = true;
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--doctor":
				args.doctor = true;
				break;
			case "--pre-tag":
				args.preTag = true;
				break;
			case "--verbose":
				args.verbose = true;
				break;
			case "--keep":
				args.keep = true;
				break;
			default:
				if (arg.startsWith("--model=")) {
					args.model = arg.slice("--model=".length);
				} else if (arg.startsWith("--provider=")) {
					args.provider = arg.slice("--provider=".length);
				} else if (arg === "--help" || arg === "-h") {
					return { ok: true, args: { ...args, listScenarios: true } };
				} else {
					return { ok: false, error: `flag desconhecida: ${arg}` };
				}
		}
	}
	return { ok: true, args };
}
