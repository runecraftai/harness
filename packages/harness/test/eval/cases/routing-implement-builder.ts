// cases/routing-implement-builder.ts — EVAL-075: routing completeness
// (implement — builder → reviewer, gate de veredito).
//
// Case framework-driven: sessão real com o roteador codificado ativo + a
// chain implement.chain.md em .pi/chains/ → input de implementação →
// delegação REAL ao builder E ao reviewer (gate da chain) via tool subagent →
// trajectory-assertion (subagent → subagent → read) + tool-policy. O veredito
// estruturado ([APPROVE]/[REJECT] + ≤3 blocking issues) vive no asset da
// chain (assertado no framework — EVAL-075).
//
// Delta vs EVAL-063 (D6): a delegação builder→reviewer via evento tipado já é
// provada; a ADIÇÃO é o roteador codificado (classificação implement → a
// sequência builder→reviewer no transcript real — routing completeness).
import type { EvalCase } from "../../../src/eval/types.ts";
import { materializePilotChains } from "../helpers/routingChains.ts";

export default {
  id: "routing-implement-builder",
  title: "Coded routing: implement → subagent(builder) → subagent(reviewer) (EVAL-075)",
  description:
    "sessão real com roteador ativo + chain implement.chain.md → input de implementação → subagent(builder) + subagent(reviewer) → read; trajectory-assertion da sequência",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "bash", "write", "edit", "subagent", "intercom", "contact_supervisor"],
    beforeSession: ({ repoDir }) => {
      materializePilotChains(repoDir, ["implement"]);
    },
  },
  executor: { kind: "trajectory-run", scenarioRef: "routing-implement-builder" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["subagent", "subagent"],
      minTurns: 3,
      maxTurns: 3,
    },
    {
      kind: "tool-policy",
      expectations: {
        read: true,
        subagent: true,
        edit: true,
        web_search: false,
      },
    },
  ],
  tags: ["routing", "routing-completeness"],
  notes:
    "EVAL-075: delta vs EVAL-063 — a ADIÇÃO é o roteador codificado (classificação implement → sequência builder→reviewer no transcript real; gate de veredito no asset da chain)",
} satisfies EvalCase;
