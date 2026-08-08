// scenarios/routing-planning-planner.ts — cenário EVAL-074 (routing: planning
// + SDD).
//
// Script do fixture F21 (escolha fakeada, execução REAL): a sessão recebe um
// input com sinais de planejamento (plan/break down/task list) e o repo tem
// `.specs/features/f1/spec.md` (SDD — feature de arquivo D3 → +2 planning) →
// o roteador classifica planning → o agente delega ao planner via tool
// subagent (F2). A chain plan.chain.md é materializada em .pi/chains/ pelo
// case (beforeSession).
//
// Delta vs EVAL-062 (D6): EVAL-062 prova a delegação planner→builder via
// evento tipado; ESTE cenário prova a ADIÇÃO do roteador codificado
// (classificação planning com SDD → delegação ao planner).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "routing-planning-planner",
  title: "Coded routing: planning (SDD) → subagent(agent=planner)",
  description:
    "EVAL-074: input de planejamento + .specs/features/f1/spec.md presente → delegação real ao planner via tool subagent",
  prompt: "Plan the feature and break down the work into a task list.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["subagent"] },
        reply: { kind: "tool", name: "subagent", args: { agent: "planner", task: "Create the implementation plan and produce plan.md.", async: true } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "routing-planning-planner",
    description: "EVAL-074: rota planning (+ SDD spec) → planner via subagent",
  },
} satisfies HarnessScenario;
