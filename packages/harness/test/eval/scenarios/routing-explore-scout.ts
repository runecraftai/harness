// scenarios/routing-explore-scout.ts — cenário EVAL-072 (routing: explore).
//
// Script do fixture F21 (escolha fakeada, execução REAL): a sessão recebe um
// input com sinais de recon (locate/map the codebase/module boundaries) → o
// roteador classifica explore → o agente delega ao scout via tool subagent
// (F2 — evento delegation do F28). A chain explore.chain.md é materializada
// em .pi/chains/ pelo case (beforeSession) — sem ela o router fail-closed
// para direct (EVAL-078 cobre esse caminho).
//
// Delta vs EVAL-064 (D6): EVAL-064 prova a delegação builder→scout via evento
// tipado; ESTE cenário prova a ADIÇÃO do roteador codificado (classificação
// explore → delegação ao scout no transcript real — routing completeness).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "routing-explore-scout",
  title: "Coded routing: explore → subagent(agent=scout)",
  description:
    "EVAL-072: input com sinais de recon (locate/map the codebase) → delegação real ao scout via tool subagent no transcript",
  prompt: "Locate the module boundaries and map the codebase before touching anything.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["subagent"] },
        reply: { kind: "tool", name: "subagent", args: { agent: "scout", task: "Recon the module boundaries and return compressed context.", async: true } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "routing-explore-scout",
    description: "EVAL-072: rota explore → scout (recon read-only) via subagent",
  },
} satisfies HarnessScenario;
