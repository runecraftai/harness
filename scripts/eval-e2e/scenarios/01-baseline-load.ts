import { classifyCheckFailure } from "../lib/classify.ts";
import { check } from "../lib/verdict.ts";
// eval-e2e/scenarios/01-baseline-load.ts — COEX-01 (baseline load dos 4 forks).
//
// Sessão carrega os 4 forks via umbrella SEM erro de load e sem conflito de
// registro. Evidência determinística: tools registradas na sessão (glla:
// complete_goal; subagents: subagent; taskflow: taskflow) + chamada real da
// tool subagent (o modelo decide — E2E sem script) + probes de comando sem
// erro. Limitação honesta: o output de `ctx.ui.notify` (widget TUI) não é
// observável em sessão in-process (o F7 viu via RPC) — nota, não check.
import type { ScenarioModule, ScenarioOutcome } from "../types.ts";

const scenario: ScenarioModule = {
	id: "COEX-01",
	name: "baseline-load",
	description: "os 4 forks carregam via umbrella sem erro de load/conflito de registro",
	timeoutMs: 5 * 60_000,
	async run(ctx) {
		const checks: ScenarioOutcome["checks"] = [
			check("glla-registered", ctx.session.toolRegistered("complete_goal"), undefined),
			check("subagents-registered", ctx.session.toolRegistered("subagent"), undefined),
			check("taskflow-registered", ctx.session.toolRegistered("taskflow"), undefined),
		];
		const notes: string[] = [];
		const confounders: string[] = [];

		// Probes de comando (executam sem erro — o output de notify não é
		// observável in-process; o F7 observou via RPC).
		// Fix cleric F22 #5: `/pr-review 1` sai das probes — o repo fixture
		// NUNCA tem PR #1 (falha crônica → falsa regressão no F23; pr-review é
		// exercitado pelo cenário 04). Erros restantes são classificados por
		// infra (gh/spawn/auth/rede) e viram nota, nunca fail.
		for (const probe of ["/goal status", "/tf list"]) {
			try {
				await ctx.session.prompt(probe);
				notes.push(`probe ok: ${probe}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (classifyCheckFailure(`probe-${probe}`, message) === "fail-infra") {
					notes.push(
						`probe ${probe}: falha de ambiente — ${message.slice(0, 140)} (fail-infra, não regressão)`,
					);
				} else {
					checks.push(check(`probe-${probe.replace(/[^a-z0-9]/gi, "-")}`, false, message));
				}
			}
		}

		// Surface de subagents: o modelo recebe a chamada literal e decide
		// invocar a tool (E2E — sem script; F7 COEX-01: o modelo chamou).
		try {
			await ctx.session.prompt("subagent({action:'list'})");
			checks.push(
				check("subagents-call", ctx.session.observations.toolCalls.includes("subagent"), undefined),
			);
			if (!ctx.session.observations.toolCalls.includes("subagent")) {
				notes.push(
					"o modelo não invocou a tool subagent nesta rodada (comportamento do modelo, não falha de load)",
				);
			}
		} catch (error) {
			checks.push(
				check("subagents-call", false, error instanceof Error ? error.message : String(error)),
			);
		}

		notes.push(
			`tools invocadas na sessão: ${[...new Set(ctx.session.observations.toolCalls)].join(", ") || "nenhuma"}`,
		);
		confounders.push(
			"output de notify (TUI widget) não observável em sessão in-process — os probes cobrem a superfície sem erro; o F7 viu os textos via RPC",
		);
		return { checks, notes, confounders };
	},
};

export default scenario;
