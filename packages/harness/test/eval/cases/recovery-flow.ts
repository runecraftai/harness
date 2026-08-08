// cases/recovery-flow.ts — EVAL-021: fluxo completo de recuperação (F27).
//
// Case framework-driven sobre a invariante F24 (RES-07/AD-024): sessão glla
// REAL + cenário scriptado (trajectory-run) → transcript → trajectory-
// assertion (sequência + o complete_goal BLOQUEADO como alvo) + tool-policy.
// O conjunto de recuperação (pendências 4,5 do ledger) é exatamente o que a
// continuação do F27 re-injeta (mesma derivação — EVAL-017); completá-lo →
// complete_goal verde (sem phantom-block deadlock).
//
// Delta vs EVAL-007 (D6/D8 — sem double-test): EVAL-007 valida o MECANISMO
// do enforcer (pendências bloqueiam conclusão); este case valida o INVARIANTE
// de recuperação pós-compactação (3/5 → completa o resto → verde) — o reason
// NÃO é re-assertado (marcador do fixture cobre — D7c).
//
// Nota honesta (fix cleric F27): o fluxo termina na aprovação do auditor do
// fixture (`<approved/>`) — o ARQUIVAMENTO do goal (goal_archived no ledger)
// NÃO é assertado neste case; o invariante provado é o complete_goal verde
// sem phantom-block.
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "recovery-flow",
  title: "Recuperação pós-compactação: pendências do ledger completáveis → complete_goal verde",
  description:
    "sessão glla real: goal 3/5 → complete_goal BLOQUEADO (enforcer F24) → completa 4 e 5 → complete_goal verde; invariante AD-024 no fluxo",
  phase: "trajectory",
  target: { kind: "single-turn-agent", agent: "main" },
  executor: { kind: "trajectory-run", scenarioRef: "recovery-flow" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: [
        "propose_task_list",
        "write",
        "update_task_status",
        "update_task_status",
        "update_task_status",
        "complete_goal",
        "update_task_status",
        "complete_task",
        "complete_goal",
        "read",
      ],
      // O complete_goal bloqueado (pendências) é alvo do trace (delegationTargets).
      expectedDelegationTargets: ["complete_goal"],
      minTurns: 12,
      maxTurns: 12,
    },
    { kind: "tool-policy", expectations: { propose_task_list: true, update_task_status: true, complete_goal: true, write: true, read: true } },
  ],
  tags: ["compaction-recovery", "resilience"],
  notes:
    "EVAL-021: delta vs EVAL-007 — invariante de recuperação do F27 (3/5 → completa pendências → complete_goal verde); o reason do enforcer não é re-assertado (marcador do fixture); emissão real de session_compact no fixture não viável (QA-5 — handler exportado com eventos scriptados cobre o trigger)",
} satisfies EvalCase;
