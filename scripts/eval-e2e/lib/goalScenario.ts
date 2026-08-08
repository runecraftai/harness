// eval-e2e/lib/goalScenario.ts — helpers comuns dos cenários com goal (S0/S2/S3/S5).
//
// Padrão F7: UM prompt `/goal "…Done when: …"` → o goal loop dirige a
// implementação + auditor isolado + fechamento (goal_archived). Os cenários
// esperam a evidência no ledger (`.pi-glla/active.jsonl`) com polling.
import type { ScenarioContext, ScenarioOutcome } from "../types.ts";
import { type GoalLedger, auditApproved, auditHasEvidence, checkLedgerGoal } from "./checks.ts";
import { check } from "./verdict.ts";
import { waitForCondition } from "./wait.ts";

export interface GoalRun {
	prompt: string;
	/** checks adicionais após a espera (recebem o ledger). */
	extraChecks?: (
		ledger: GoalLedger,
		ctx: ScenarioContext,
	) => Promise<ScenarioOutcome["checks"]> | ScenarioOutcome["checks"];
	timeoutMs: number;
	label: string;
}

/** Roda um goal e monta o outcome com os checks canônicos (sanity/auditoria). */
export async function runGoalScenario(
	ctx: ScenarioContext,
	goal: GoalRun,
): Promise<ScenarioOutcome> {
	await ctx.session.prompt(goal.prompt);

	const ledgerReady = await waitForCondition(() => checkLedgerGoal(ctx.repoDir).archived !== null, {
		timeoutMs: goal.timeoutMs,
		label: goal.label,
	});

	const ledger = checkLedgerGoal(ctx.repoDir);
	const checks: ScenarioOutcome["checks"] = [
		check("goal-created", ledger.created, ledger.ledgerPath ?? undefined),
		check(
			"goal-archived",
			ledgerReady && ledger.archived !== null,
			ledger.archived?.status ?? undefined,
		),
		check("audit-approved", auditApproved(ledger), undefined),
		check("audit-evidence", auditHasEvidence(ledger), undefined),
	];
	if (goal.extraChecks !== undefined) {
		checks.push(...(await goal.extraChecks(ledger, ctx)));
	}

	const notes: string[] = [];
	if (!ledgerReady)
		notes.push(`ledger não chegou a goal_archived em ${Math.round(goal.timeoutMs / 1000)}s`);
	if (ledger.archived !== null && ledger.archived.stopReason !== null) {
		notes.push(`stopReason: ${ledger.archived.stopReason}`);
	}
	notes.push(`continuations enviadas pelo goal loop: ${ledger.continuationsSent}`);

	return { checks, notes, confounders: [] };
}
