// eval-e2e/lib/classify.ts — classificação de falha (edge da spec: fail-infra).
//
// `fail-infra` = AMBIENTE/modelo (rate limit, gh ausente, spawn falhou, modelo
// não produziu resposta) — NÃO conta como regressão no F23. `fail` = check do
// harness falhou (potencial regressão). `limit` = executou até limite
// documentável (timeout do cenário, comportamento conhecido do fork — BUG-2).
import type { ScenarioStatus } from "../types.ts";

const RATE_LIMIT = /\b429\b|\brate[ _-]?limit|\btoo many requests\b|\bquota exceeded\b/i;
const AUTH = /\b(401|403|unauthorized|authentication|api ?key|invalid api)\b/i;
const NETWORK =
	/\b(ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|fetch failed|timeout of \d+ms exceeded)\b/i;
const SPAWN =
	/\b(ENOENT|command not found|unknown model|model .* not (found|available)|no model)\b/i;

/** Classifica uma falha de execução (exceção do cenário): fail-infra vs fail. */
export function classifyExecutionFailure(error: unknown, message: string): ScenarioStatus {
	if (error instanceof Error && error.name === "TimeoutError") return "limit";
	if (RATE_LIMIT.test(message)) return "fail-infra";
	if (AUTH.test(message)) return "fail-infra";
	if (NETWORK.test(message)) return "fail-infra";
	if (SPAWN.test(message)) return "fail-infra";
	return "fail";
}

/** Classifica um check de cenário falho (checks nunca são infra por si). */
export function classifyCheckFailure(checkId: string, detail: string | undefined): ScenarioStatus {
	const message = `${checkId} ${detail ?? ""}`;
	// Um check pode falhar por infra (ex.: gh ausente no COEX-04) — o check
	// declara via detalhe normalizado; aqui só os padrões conhecidos contam.
	if (
		RATE_LIMIT.test(message) ||
		AUTH.test(message) ||
		NETWORK.test(message) ||
		SPAWN.test(message)
	) {
		return "fail-infra";
	}
	return "fail";
}

/** Nota padrão para falha infra (sem paths/timestamps — F21 D10). */
export function infraNote(reason: string): string {
	return `fail-infra: ${reason} (não conta como regressão no F23)`;
}
