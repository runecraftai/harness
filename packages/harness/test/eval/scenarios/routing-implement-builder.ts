// scenarios/routing-implement-builder.ts — cenário EVAL-075 (routing:
// implement — builder → reviewer, gate de veredito).
//
// Script do fixture F21 (escolha fakeada, execução REAL): a sessão recebe um
// input com sinais de implementação (implement/fix) → o roteador classifica
// implement → o agente delega ao builder via tool subagent (F2) e depois ao
// reviewer (gate da chain — veredito [APPROVE]/[REJECT] + ≤3 blocking
// issues). A chain implement.chain.md é materializada em .pi/chains/ pelo
// case (beforeSession).
//
// Delta vs EVAL-063 (D6): EVAL-063 prova a delegação builder→reviewer via
// evento tipado; ESTE cenário prova a ADIÇÃO do roteador codificado
// (classificação implement → sequência builder→reviewer no transcript real).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "routing-implement-builder",
  title: "Coded routing: implement → subagent(builder) → subagent(reviewer)",
  description:
    "EVAL-075: input de implementação → delegação real ao builder e ao reviewer (gate da chain) via tool subagent no transcript",
  prompt: "Implement the feature and fix the reported bug.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["subagent"] },
        reply: { kind: "tool", name: "subagent", args: { agent: "builder", task: "Execute the implementation plan with verified edits.", async: true } },
      },
      {
        expect: { toolsSubset: ["subagent"] },
        reply: { kind: "tool", name: "subagent", args: { agent: "reviewer", task: "Review the work and return a structured verdict.", async: true } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "routing-implement-builder",
    description: "EVAL-075: rota implement → builder → reviewer (gate) via subagent",
  },
} satisfies HarnessScenario;
