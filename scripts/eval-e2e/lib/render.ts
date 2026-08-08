// eval-e2e/lib/render.ts — progresso por cenário + tabela resumo (D8).
import type { RoundResult, ScenarioModule, ScenarioResult } from "../types.ts";

/** Linha de progresso: `[2/6] COEX-02 goal-subagent-chain — running (47s)`. */
export function progressLine(
	index: number,
	total: number,
	scenario: ScenarioModule,
	elapsedMs: number,
): string {
	return `[${index + 1}/${total}] ${scenario.id} ${scenario.name} — running (${Math.round(elapsedMs / 1000)}s)`;
}

/** Linha de resultado: `… pass (182s, ~12.1k tok)`. */
export function resultLine(scenario: ScenarioResult): string {
	const tok =
		scenario.tokensApprox !== null ? `, ~${formatTokens(scenario.tokensApprox)} tok` : ", tok n/d";
	const status = scenario.status === "pass" ? "pass" : scenario.status;
	return ` ${status} (${formatDuration(scenario.durationMs)}${tok})`;
}

/** Tabela resumo markdown (D8 — status, duração, tokens, notas curtas). */
export function summaryTable(round: RoundResult): string {
	const lines = ["", "## Resumo da rodada", ""];
	lines.push("| # | Cenário | Status | Duração | Tokens | Notas |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	round.scenarios.forEach((s, i) => {
		const tok = s.tokensApprox !== null ? String(s.tokensApprox) : "—";
		const note = s.notes[0] ?? "";
		lines.push(
			`| ${i} | ${s.name} | ${s.status} | ${formatDuration(s.durationMs)} | ${tok} | ${note} |`,
		);
	});
	lines.push("");
	if (round.partial)
		lines.push(
			`⚠ rodada PARCIAL (interrompida ${round.interruptedAt ?? "?"}) — cenários completos preservados.`,
		);
	if (round.sanityFailed)
		lines.push("✗ sanity (hello world) FALHOU — rodada inválida como evidência (F23 não compara).");
	if (round.confounders.length > 0) {
		lines.push(`Confundidores: ${round.confounders.join(" · ")}`);
	}
	return lines.join("\n");
}

export function formatTokens(tokens: number): string {
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
	return String(tokens);
}

export function formatDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds >= 60) return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
	return `${seconds}s`;
}
