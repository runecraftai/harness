// eval-e2e/scenarios/00-hello-world.ts — COEX-05 (SANITY obrigatório — E2EV-03).
//
// Hello world SDLC do harness (F19 ROUTING.md §5 / F7 COEX-05): UM prompt
// `/goal "… Done when: …"` cobre goal loop + implementação + auditor isolado
// com evidência + fechamento. Falha dele invalida a rodada (o runner aborta
// com sanityFailed — economia de tokens).
import * as fs from "node:fs";
import * as path from "node:path";
import { runGoalScenario } from "../lib/goalScenario.ts";
import { check } from "../lib/verdict.ts";
import type { ScenarioModule } from "../types.ts";

export const HELLO_WORLD_GOAL =
	"Create a file greeting.txt whose content is the exact text 'hello harness'. Done when: greeting.txt exists in the repo root and its content is exactly 'hello harness'.";

const scenario: ScenarioModule = {
	id: "COEX-05",
	name: "hello-world-sdlc",
	description:
		"hello world SDLC (sanity): goal com Done when → implementação → auditor isolado → fechamento",
	sanity: true,
	timeoutMs: 10 * 60_000,
	async run(ctx) {
		return runGoalScenario(ctx, {
			prompt: `/goal start ${HELLO_WORLD_GOAL}`,
			timeoutMs: this.timeoutMs,
			label: "goal_archived (hello world)",
			extraChecks: (_ledger, c) => {
				const greeting = path.join(c.repoDir, "greeting.txt");
				const exists = fs.existsSync(greeting);
				const content = exists ? fs.readFileSync(greeting, "utf8") : "";
				return [
					check("greeting-exists", exists, undefined),
					check("greeting-content", exists && content === "hello harness", `len=${content.length}`),
				];
			},
		});
	},
};

export default scenario;
