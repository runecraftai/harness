// eval-e2e/scenarios/03-taskflow-goal.ts — COEX-03 (DAG do taskflow + goal ativo).
//
// O DAG multi-fase roda enquanto o goal está ativo (F7 COEX-03: 16 turns, 18
// tools) — estados (taskflow + goal) sem interferência. Workaround do BUG-2
// do fork (taskflow-core dist/agents/ não empacotado — F7 §Achados): symlink
// de packages/subagents/agents → agentDir/agents (o taskflow descobre os
// agentes de usuário ali). Se o DAG falhar com "Unknown agent" mesmo com o
// workaround → `limit` (comportamento conhecido do fork — D4), nunca fail.
import * as fs from "node:fs";
import * as path from "node:path";
import { checkLedgerGoal } from "../lib/checks.ts";
import { runGoalScenario } from "../lib/goalScenario.ts";
import { check } from "../lib/verdict.ts";
import { waitForCondition } from "../lib/wait.ts";
import type { ScenarioContext, ScenarioModule, ScenarioOutcome } from "../types.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

const GOAL =
	"Use the taskflow tool (action 'run' with a define chain, do NOT call verify or compile actions) to produce analysis.md: step 1 scout reads README.md and lists repo contents, step 2 worker writes the analysis into analysis.md. Done when: analysis.md exists, is non-empty, and the taskflow run completed successfully.";

/** Aplica o workaround do BUG-2 (F7 §Achados): expõe scout/worker ao taskflow. */
function applyBug2Workaround(agentDir: string): string | null {
	const source = path.join(REPO_ROOT, "packages", "subagents", "agents");
	const target = path.join(agentDir, "agents");
	if (!fs.existsSync(source))
		return "packages/subagents/agents não encontrado — workaround BUG-2 não aplicável";
	if (fs.existsSync(target)) return null;
	try {
		fs.symlinkSync(source, target, "dir");
		return null;
	} catch (error) {
		return `symlink falhou: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/** Evidência do DAG: runs do taskflow com fases done (.pi/taskflows/runs). */
function taskflowRunDone(repoDir: string): {
	done: boolean;
	detail: string;
	unknownAgent: boolean;
} {
	const runsDir = path.join(repoDir, ".pi", "taskflows", "runs");
	if (!fs.existsSync(runsDir)) return { done: false, detail: "sem runs dir", unknownAgent: false };
	const traces: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".trace.jsonl")) traces.push(full);
		}
	};
	try {
		walk(runsDir);
	} catch {
		return { done: false, detail: "runs dir ilegível", unknownAgent: false };
	}
	let donePhases = 0;
	let unknownAgent = false;
	for (const trace of traces) {
		for (const line of fs.readFileSync(trace, "utf8").split("\n")) {
			if (line.trim() === "") continue;
			try {
				const evt = JSON.parse(line) as {
					kind?: string;
					status?: string;
					phaseId?: string;
					error?: string;
				};
				if (evt.kind === "phase-end" && evt.status === "done") donePhases += 1;
				// Fix cleric F22 #7: a fonte do erro BUG-2 É o trace do DAG
				// ("Unknown agent" no evento de erro da fase) — detectado aqui,
				// escopado, nunca no ledger inteiro.
				if (typeof evt.error === "string" && /unknown agent/i.test(evt.error)) unknownAgent = true;
			} catch {
				// linha malformada — ignora (fail-open do sink)
			}
		}
	}
	return {
		done: donePhases >= 2,
		detail: `fases done=${donePhases}, traces=${traces.length}`,
		unknownAgent,
	};
}

const scenario: ScenarioModule = {
	id: "COEX-03",
	name: "taskflow-dag-goal",
	description:
		"DAG multi-fase do taskflow (dependsOn) rodando com goal ativo — sem interferência de estado",
	timeoutMs: 8 * 60_000,
	async run(ctx) {
		// Workaround BUG-2 (F7 §Achados) — confundidor documentado, aplicado
		// somente neste cenário (fiel ao F7).
		const workaroundIssue = applyBug2Workaround(ctx.agentDir);
		const confounders = workaroundIssue === null ? [] : [workaroundIssue];
		if (workaroundIssue === null) {
			confounders.push(
				"workaround BUG-2 (taskflow-core dist/agents não empacotado) aplicado — F7 scenarios.md §Achados",
			);
		}

		const outcome = await runGoalScenario(ctx, {
			prompt: `/goal start ${GOAL}`,
			timeoutMs: this.timeoutMs,
			label: "analysis.md + taskflow done (COEX-03)",
			extraChecks: (ledger, c) => {
				const analysis = path.join(c.repoDir, "analysis.md");
				const exists = fs.existsSync(analysis);
				const nonEmpty = exists && fs.statSync(analysis).size > 0;
				const run = taskflowRunDone(c.repoDir);
				return [
					check("analysis-exists", exists, undefined),
					check("analysis-non-empty", nonEmpty, undefined),
					check("taskflow-run-done", run.done, run.detail),
				];
			},
		});

		// BUG-2 conhecido: se o DAG falhou por "Unknown agent" mesmo com o
		// workaround, é comportamento documentado do fork → limit, nunca fail.
		const ledger = checkLedgerGoal(ctx.repoDir);
		const runEvidence = taskflowRunDone(ctx.repoDir);
		if (!runEvidence.done && runEvidence.unknownAgent) {
			// Fix cleric F22 #7: BUG-2 detectado no evento de erro do trace do
			// DAG (fonte escopada) — qualquer outra falha vira fail real.
			return {
				...outcome,
				statusOverride: "limit",
				notes: [
					...outcome.notes,
					"DAG falhou por 'Unknown agent' — BUG-2 do fork (taskflow-core dist/agents); limit (comportamento conhecido do fork — D4)",
				],
				confounders,
			};
		}
		return { ...outcome, confounders };
	},
};

export default scenario;
