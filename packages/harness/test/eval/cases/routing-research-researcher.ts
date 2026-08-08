// cases/routing-research-researcher.ts — EVAL-073: routing completeness
// (research).
//
// Case framework-driven: sessão real com o roteador codificado ativo + a
// chain research.chain.md em .pi/chains/ → input de pesquisa externa →
// delegação REAL ao researcher via tool subagent → trajectory-assertion +
// tool-policy.
//
// Delta vs EVAL-062..064 (D6): a delegação via evento tipado já é provada; a
// ADIÇÃO é o roteador codificado (classificação research → researcher no
// transcript real — routing completeness).
import type { EvalCase } from "../../../src/eval/types.ts";
import { materializePilotChains } from "../helpers/routingChains.ts";

export default {
  id: "routing-research-researcher",
  title: "Coded routing: research → subagent(agent=researcher) (EVAL-073)",
  description:
    "sessão real com roteador ativo + chain research.chain.md → input de pesquisa → subagent(agent=researcher) → read; trajectory-assertion + tool-policy",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "bash", "write", "subagent", "intercom", "web_search"],
    beforeSession: ({ repoDir }) => {
      materializePilotChains(repoDir, ["research"]);
    },
  },
  executor: { kind: "trajectory-run", scenarioRef: "routing-research-researcher" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["subagent"],
      minTurns: 2,
      maxTurns: 2,
    },
    {
      kind: "tool-policy",
      expectations: {
        read: true,
        subagent: true,
      },
    },
  ],
  tags: ["routing", "routing-completeness"],
  notes:
    "EVAL-073: delta vs EVAL-062..064 — a ADIÇÃO é o roteador codificado (classificação research → researcher no transcript real)",
} satisfies EvalCase;
