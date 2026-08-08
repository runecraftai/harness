// cases/observability-block.ts — EVAL-026/029 (F28): observação do bloqueio
// F24 pelo F28 em sessão REAL via framework (F26).
//
// Case framework-driven: sessão SDK in-process (single-turn-agent) com guards
// F24 + extensão de observabilidade (materializada no agentDir pelo
// beforeSession do cenário) → cenário scriptado (trajectory-run) →
// trajectory-assertion (sequência + bloqueio como alvo do trace) + tool-policy.
// O reason NÃO é re-assertado aqui (marcador do fixture cobre — D7c); a prova
// do guard:blocked no STORE vive no teste de framework (EVAL-026/029 — leitura
// direta do .runecraft/events/<sessionId>.jsonl após a sessão real).
//
// Delta vs EVAL-006/014 (D6 — sem double-test): este case adiciona o SUJEITO
// F28 (observabilidade) ao fluxo — a observação do bloqueio (tool_execution_end
// → guard:blocked) é o delta; o mecanismo do guard já é coberto por EVAL-006.
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "observability-block",
  title: "Bloqueio F24 observado pelo F28 (guard:blocked) — framework-driven",
  description:
    "sessão real (guards + observability): write README.md → BLOQUEADO → write notes.txt passa → read; trace assegura sequência + bloqueio + registry",
  phase: "trajectory",
  target: { kind: "single-turn-agent", agent: "main" },
  executor: { kind: "trajectory-run", scenarioRef: "observability-block" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["write", "write"],
      expectedDelegationTargets: ["write"],
      minTurns: 3,
      maxTurns: 3,
    },
    { kind: "tool-policy", expectations: { write: true, read: true } },
  ],
  tags: ["observability", "guards"],
  notes:
    "EVAL-026/029: delta vs EVAL-006/014 — sujeito F28 (observação do bloqueio via tool_execution_end → guard:blocked no store); reason não re-assertado (marcador do fixture)",
} satisfies EvalCase;
