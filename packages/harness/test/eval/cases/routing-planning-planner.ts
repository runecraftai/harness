// cases/routing-planning-planner.ts — EVAL-074: routing completeness
// (planning + SDD).
//
// Case framework-driven: sessão real com o roteador codificado ativo + a
// chain plan.chain.md em .pi/chains/ + `.specs/features/f1/spec.md` (SDD —
// feature de arquivo D3 → +2 planning) → input de planejamento → delegação
// REAL ao planner via tool subagent → trajectory-assertion + tool-policy.
//
// Delta vs EVAL-062 (D6): a delegação planner→builder via evento tipado já é
// provada; a ADIÇÃO é o roteador codificado (classificação planning com SDD →
// planner no transcript real — routing completeness).
import type { EvalCase } from "../../../src/eval/types.ts";
import { materializePilotChains, writeSpecFile } from "../helpers/routingChains.ts";

export default {
  id: "routing-planning-planner",
  title: "Coded routing: planning (SDD) → subagent(agent=planner) (EVAL-074)",
  description:
    "sessão real com roteador ativo + chain plan.chain.md + .specs/features/f1/spec.md → input de planejamento → subagent(agent=planner) → read",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "bash", "write", "subagent", "intercom"],
    beforeSession: ({ repoDir }) => {
      materializePilotChains(repoDir, ["plan"]);
      writeSpecFile(repoDir, "f1");
    },
  },
  executor: { kind: "trajectory-run", scenarioRef: "routing-planning-planner" },
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
        web_search: false,
      },
    },
  ],
  tags: ["routing", "routing-completeness"],
  notes:
    "EVAL-074: delta vs EVAL-062 — a ADIÇÃO é o roteador codificado (classificação planning com a feature SDD → planner no transcript real)",
} satisfies EvalCase;
