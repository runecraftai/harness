// eval-e2e/checks.test.ts — helpers de evidência determinística (D3).
//
// Ledger do glla: `.pi-glla/active.jsonl` (fallback `.pi-gla`), JSONL
// `{type, value, at}` — eventos state (goal+auditHistory) e goal_archived.
// Vereditos do harness: parse defensivo (linha malformada nunca derruba).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditApproved, auditHasEvidence, auditorReadOnly, readGoalLedger } from "./lib/checks.ts";

function writeLedger(lines: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-checks-"));
	const file = path.join(dir, ".pi-glla", "active.jsonl");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${lines.join("\n")}\n`);
	return dir;
}

const GOAL_CREATED = JSON.stringify({
	type: "goal_created",
	value: { goalId: "g1", objective: "x" },
	at: "2026-08-08T12:00:00Z",
});
const GOAL_ARCHIVED = JSON.stringify({
	type: "goal_archived",
	value: { goalId: "g1", status: "complete", stopReason: "auditor deepseek-v4-flash approved" },
	at: "2026-08-08T12:00:10Z",
});
const STATE_AUDIT = (report: string, approved: boolean) =>
	JSON.stringify({
		type: "state",
		value: {
			goal: { auditHistory: [{ at: "t", approved, report, regressionShieldPassed: true }] },
		},
		at: "2026-08-08T12:00:05Z",
	});

describe("readGoalLedger", () => {
	test("ledger completo: archived + audit approved + continuations", () => {
		const dir = writeLedger([
			GOAL_CREATED,
			JSON.stringify({ type: "goal_continuation_sent", value: { goalId: "g1" }, at: "t" }),
			STATE_AUDIT("<evidence>greeting.txt existe</evidence>", true),
			GOAL_ARCHIVED,
		]);
		try {
			const ledger = readGoalLedger(dir);
			expect(ledger.created).toBe(true);
			expect(ledger.continuationsSent).toBe(1);
			expect(ledger.archived?.status).toBe("complete");
			expect(ledger.audits).toHaveLength(1);
			expect(auditApproved(ledger)).toBe(true);
			expect(auditHasEvidence(ledger)).toBe(true);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("linha malformada é pulada (defensivo — F19)", () => {
		const dir = writeLedger(["{not-json", GOAL_ARCHIVED]);
		try {
			const ledger = readGoalLedger(dir);
			expect(ledger.archived?.status).toBe("complete");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sem ledger → shape vazio (sem crash)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-checks-"));
		try {
			const ledger = readGoalLedger(dir);
			expect(ledger.archived).toBeNull();
			expect(ledger.audits).toEqual([]);
			expect(ledger.ledgerPath).toBeNull();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fallback .pi-gla (pré-rename — F19 D8)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-checks-"));
		try {
			const file = path.join(dir, ".pi-gla", "active.jsonl");
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, `${GOAL_ARCHIVED}\n`);
			const ledger = readGoalLedger(dir);
			expect(ledger.archived?.status).toBe("complete");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("auditApproved/auditHasEvidence/auditorReadOnly", () => {
	test("<approved/> no report conta como aprovação", () => {
		const dir = writeLedger([STATE_AUDIT("... <approved/>", false)]);
		try {
			expect(auditApproved(readGoalLedger(dir))).toBe(true);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("approved sem <evidence> → evidência ausente (design S0: falha)", () => {
		const dir = writeLedger([STATE_AUDIT("looks fine <approved/>", true)]);
		try {
			expect(auditHasEvidence(readGoalLedger(dir))).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("auditor com tool de escrita no report → NÃO read-only (COEX-06)", () => {
		const dir = writeLedger([STATE_AUDIT("usei edit(arquivo) para verificar", true)]);
		try {
			expect(auditorReadOnly(readGoalLedger(dir))).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("auditor read-only (ls/stat/cmp) → read-only", () => {
		const dir = writeLedger([
			STATE_AUDIT("ls, stat, od -c, wc -c, cmp — evidência em <evidence>", true),
		]);
		try {
			expect(auditorReadOnly(readGoalLedger(dir))).toBe(true);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("auditoria ausente → read-only false (nada a verificar)", () => {
		const dir = writeLedger([GOAL_CREATED]);
		try {
			expect(auditorReadOnly(readGoalLedger(dir))).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
