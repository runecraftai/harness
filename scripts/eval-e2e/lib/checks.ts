// eval-e2e/lib/checks.ts — helpers de evidência determinística p/ os checks (D3).
//
// Vereditos do harness: fs/git/ledger/transcript — nunca julgamento do modelo.
// O ledger do goal-loop-audit: `<cwd>/.pi-glla/active.jsonl` (fallback
// read-only `.pi-gla` — F19 D8/AD-019), JSONL `{type, value, at}` — eventos
// `state` (goal com auditHistory) e `goal_archived` (status, stopReason).
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GoalLedger {
	/** goal_archived (status complete) — null quando não arquivou. */
	archived: { status: string | null; stopReason: string | null } | null;
	/** entradas de auditoria (approved/report/regressionShieldPassed). */
	audits: Array<{
		approved: boolean | null;
		report: string;
		regressionShieldPassed: boolean | null;
	}>;
	/** goal continuations enviadas (two-driver S2 — sem continuation dupla). */
	continuationsSent: number;
	/** goal criado? */
	created: boolean;
	ledgerPath: string | null;
}

/** Lê o ledger do goal (active.jsonl com fallback .pi-gla). Defensivo (F19). */
export function readGoalLedger(repoDir: string): GoalLedger {
	const candidates = [
		path.join(repoDir, ".pi-glla", "active.jsonl"),
		path.join(repoDir, ".pi-gla", "active.jsonl"),
	];
	const ledgerPath = candidates.find((p) => fs.existsSync(p)) ?? null;
	const result: GoalLedger = {
		archived: null,
		audits: [],
		continuationsSent: 0,
		created: false,
		ledgerPath,
	};
	if (ledgerPath === null) return result;

	const lines = fs.readFileSync(ledgerPath, "utf8").split("\n");
	for (const line of lines) {
		if (line.trim() === "") continue;
		let evt: { type?: string; value?: unknown; at?: string };
		try {
			evt = JSON.parse(line) as { type?: string; value?: unknown };
		} catch {
			continue; // linha malformada/truncada — nunca derruba o check (F19)
		}
		if (evt.type === "goal_created") result.created = true;
		if (evt.type === "goal_continuation_sent") result.continuationsSent += 1;
		if (evt.type === "goal_archived") {
			const value = (evt.value ?? {}) as { status?: string; stopReason?: string };
			result.archived = { status: value.status ?? null, stopReason: value.stopReason ?? null };
		}
		if (evt.type === "state") {
			const value = (evt.value ?? {}) as {
				goal?: { auditHistory?: Array<Record<string, unknown>> };
			};
			const history = value.goal?.auditHistory ?? [];
			for (const entry of history) {
				result.audits.push({
					approved: typeof entry.approved === "boolean" ? entry.approved : null,
					report: typeof entry.report === "string" ? entry.report : "",
					regressionShieldPassed:
						typeof entry.regressionShieldPassed === "boolean" ? entry.regressionShieldPassed : null,
				});
			}
		}
	}
	return result;
}

/** Alias usado pelos cenários (nomenclatura do runner). */
export const checkLedgerGoal = readGoalLedger;

/** Auditoria aprovou? (approved true OU report com <approved/> OU stopReason "approved"). */
export function auditApproved(ledger: GoalLedger): boolean {
	for (const audit of ledger.audits) {
		if (audit.approved === true) return true;
		if (/<approved\/>/i.test(audit.report)) return true;
	}
	if (ledger.archived?.stopReason !== null && /approved/i.test(ledger.archived?.stopReason ?? ""))
		return true;
	return false;
}

/** Evidência por item do contrato? (<evidence> no report — design S0). */
export function auditHasEvidence(ledger: GoalLedger): boolean {
	return ledger.audits.some(
		(audit) => /<evidence/i.test(audit.report) || /## Evidence|Evidence:/i.test(audit.report),
	);
}

/**
 * Auditor usou SÓ ferramentas de leitura (COEX-06 — isolamento por perfil de
 * tools). O fork hardcoda o loader do auditor com tools ⊆ read/grep/find/ls/bash
 * (F21 AD-021 #3 — fato do source); a checagem empírica varre o report do
 * auditor por chamadas a tools de escrita/extensão (edit/write/subagent/
 * taskflow/complete_goal). Chamada de escrita no report → falha (o auditor
 * "viu" tools que não deveria ter).
 */
const WRITE_TOOL_MARKERS = [
	/\b(edit|write)\s*\(/i,
	/\b(subagent|taskflow|complete_goal|propose_task_list|update_task_status)\b/i,
	/```\s*(bash|sh)\s*$/m, // comando shell de escrita no report — sinal de risco
];
export function auditorReadOnly(ledger: GoalLedger): boolean {
	if (ledger.audits.length === 0) return false;
	return ledger.audits.every((audit) => !WRITE_TOOL_MARKERS.some((re) => re.test(audit.report)));
}

/** Diff do working tree (git status --porcelain) — evidência de implementação. */
export function gitStatus(repoDir: string): string {
	try {
		return execSync("git status --porcelain", { cwd: repoDir, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

/** Últimos commits (git log --oneline -5) — evidência de implementação/commit. */
export function gitLog(repoDir: string, max = 5): string[] {
	try {
		const out = execSync(`git log --oneline -${max}`, { cwd: repoDir, encoding: "utf8" });
		return out
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}
