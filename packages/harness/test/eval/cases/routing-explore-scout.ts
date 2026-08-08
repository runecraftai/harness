// cases/routing-explore-scout.ts — EVAL-072: routing completeness (explore).
//
// Case framework-driven: sessão real com o roteador codificado ativo
// (extensão routing materializada no agentDir do fixture) + a chain
// explore.chain.md em .pi/chains/ (sem ela o router fail-closed para direct —
// EVAL-078) → input de recon → delegação REAL ao scout via tool subagent →
// trajectory-assertion (subagent → read) + tool-policy.
//
// Delta vs EVAL-064 (D6): EVAL-064 prova a delegação builder→scout via evento
// tipado; ESTE case prova a ADIÇÃO do roteador codificado (a classificação
// explore → a delegação ao scout no transcript real) — categoria routing
// completeness (F26, desbloqueada na v10 → F33 completa com o roteador).
import type { EvalCase } from "../../../src/eval/types.ts";
import { materializePilotChains } from "../helpers/routingChains.ts";

export default {
  id: "routing-explore-scout",
  title: "Coded routing: explore → subagent(agent=scout) (EVAL-072)",
  description:
    "sessão real com roteador ativo + chain explore.chain.md → input de recon → subagent(agent=scout) → read; trajectory-assertion + tool-policy",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "bash", "write", "subagent", "intercom"],
    beforeSession: ({ repoDir }) => {
      materializePilotChains(repoDir, ["explore"]);
    },
  },
  executor: { kind: "trajectory-run", scenarioRef: "routing-explore-scout" },
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
    "EVAL-072: delta vs EVAL-064 — a delegação via evento tipado já é provada; a ADIÇÃO é o roteador codificado (classificação explore → scout no transcript real)",
} satisfies EvalCase;
