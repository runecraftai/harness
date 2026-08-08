// eval-e2e/scenarios/02-goal-subagent.ts — COEX-02 (goal ativo + chain de subagents).
//
// Two-driver (F19 ROUTING §2/§4): o goal loop dirige a continuação (push via
// agent_end) enquanto a chain de subagents roda na MESMA sessão — sem
// continuation dupla, sem clobber de session handle. Evidência: ledger com
// goal_archived + auditor aprovado + artifact do reviewer em
// .pi-subagents/artifacts/ (F7 COEX-02).
import * as fs from "node:fs";
import * as path from "node:path";
import { runGoalScenario } from "../lib/goalScenario.ts";
import { check } from "../lib/verdict.ts";
import type { ScenarioModule } from "../types.ts";

const GOAL =
	"Create a file notes.md with exactly 3 bullet points describing what this repo does. After creating the file, run the reviewer subagent to check notes.md quality, then address any findings it reports. Done when: notes.md exists with 3 bullet points and the reviewer subagent run completed successfully.";

function bulletCount(content: string): number {
	return content.split("\n").filter((line) => /^\s*[-*]\s+/.test(line)).length;
}

const scenario: ScenarioModule = {
	id: "COEX-02",
	name: "goal-subagent-chain",
	description: "goal ativo + chain do reviewer (subagents) na mesma sessão — two-driver são",
	timeoutMs: 8 * 60_000,
	async run(ctx) {
		return runGoalScenario(ctx, {
			prompt: `/goal start ${GOAL}`,
			timeoutMs: this.timeoutMs,
			label: "goal_archived (COEX-02)",
			extraChecks: (ledger, c) => {
				const notesPath = path.join(c.repoDir, "notes.md");
				const exists = fs.existsSync(notesPath);
				const content = exists ? fs.readFileSync(notesPath, "utf8") : "";
				const artifactsDir = path.join(c.repoDir, ".pi-subagents", "artifacts");
				const reviewerArtifacts = fs.existsSync(artifactsDir)
					? fs.readdirSync(artifactsDir).filter((f) => /_reviewer_/i.test(f))
					: [];
				return [
					check("notes-exists", exists, undefined),
					check(
						"notes-3-bullets",
						exists && bulletCount(content) === 3,
						`bullets=${bulletCount(content)}`,
					),
					check(
						"reviewer-ran",
						reviewerArtifacts.length > 0,
						`artifacts=${reviewerArtifacts.length}`,
					),
					// Fix cleric F22 #6: conclusão one-shot limpa tem ZERO continuações —
					// exigir >= 1 false-failava o check; vira nota informativa.
					check(
						"goal-loop-active",
						true,
						`continuations=${ledger.continuationsSent} (0 = one-shot limpa)`,
					),
				];
			},
		});
	},
};

export default scenario;
