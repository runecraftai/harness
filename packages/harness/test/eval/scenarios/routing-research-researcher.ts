// scenarios/routing-research-researcher.ts — cenário EVAL-073 (routing: research).
//
// Script do fixture F21 (escolha fakeada, execução REAL): a sessão recebe um
// input com sinais de pesquisa externa (research/check the docs/best
// practices) → o roteador classifica research → o agente delega ao researcher
// via tool subagent (F2 — evento delegation do F28). A chain
// research.chain.md é materializada em .pi/chains/ pelo case (beforeSession).
//
// Delta vs EVAL-073 do F32 (D6): a ADIÇÃO é o roteador codificado
// (classificação research → delegação ao researcher no transcript real).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "routing-research-researcher",
  title: "Coded routing: research → subagent(agent=researcher)",
  description:
    "EVAL-073: input com sinais de pesquisa (research/check the docs) → delegação real ao researcher via tool subagent no transcript",
  prompt: "Research the best practices and check the docs for the migration.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["subagent"] },
        reply: { kind: "tool", name: "subagent", args: { agent: "researcher", task: "Research the migration best practices and return a sourced brief.", async: true } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "routing-research-researcher",
    description: "EVAL-073: rota research → researcher (brief com fontes) via subagent",
  },
} satisfies HarnessScenario;
