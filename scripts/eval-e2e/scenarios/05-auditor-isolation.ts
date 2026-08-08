import { auditorReadOnly, readGoalLedger } from "../lib/checks.ts";
import { runGoalScenario } from "../lib/goalScenario.ts";
import { check } from "../lib/verdict.ts";
// eval-e2e/scenarios/05-auditor-isolation.ts — COEX-06 (auditor isolado).
//
// O isolamento do auditor é GARANTIDO POR CONSTRUÇÃO no fork (F7 COEX-06
// método 1; F21 AD-021 #3): makeAuditorResourceLoader hardcoda extensions/
// skills/prompts/themes/agentsFiles vazios + system prompt de auditor + tools
// ⊆ read/grep/find/ls/bash (sem editor, sem subagents, sem taskflow). O
// harness não participa desse loader — isolamento não depende de config.
// Checagem empírica da rodada: o report da auditoria não contém chamadas a
// tools de escrita/extensão (auditorReadOnly) — evidência de que o auditor
// não "viu" as ferramentas do implementador.
import type { ScenarioModule } from "../types.ts";

const GOAL =
	"Create a file note.txt whose content is the exact text 'isolated'. Done when: note.txt exists in the repo root and its content is exactly 'isolated'.";

const scenario: ScenarioModule = {
	id: "COEX-06",
	name: "auditor-isolation",
	description:
		"auditor isolado SEM extensões/skills/prompts — só tools de leitura, não vê a conversa do implementador",
	timeoutMs: 5 * 60_000,
	async run(ctx) {
		const outcome = await runGoalScenario(ctx, {
			prompt: `/goal start ${GOAL}`,
			timeoutMs: this.timeoutMs,
			label: "goal_archived (COEX-06)",
			extraChecks: (_ledger, c) => {
				const ledger = readGoalLedger(c.repoDir);
				return [
					check("audit-ran", ledger.audits.length > 0, `auditorias=${ledger.audits.length}`),
					check("auditor-read-only", auditorReadOnly(ledger), undefined),
				];
			},
		});
		return {
			...outcome,
			notes: [
				...outcome.notes,
				"isolamento por construção (F7 método 1): loader do auditor no fork hardcoda extensions/skills/prompts vazios + tools ⊆ read/grep/find/ls/bash — verificado no source (F21 AD-021 #3); o auditor roda em AgentSession própria (não vê a conversa do implementador)",
			],
			confounders: [],
		};
	},
};

export default scenario;
