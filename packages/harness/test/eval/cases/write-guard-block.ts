// cases/write-guard-block.ts — EVAL-014: write-existing-file-guard (F24) via framework.
//
// Case framework-driven sobre o subject GUARD-01/02: sessão SDK in-process
// (single-turn-agent) + cenário scriptado real (trajectory-run) → transcript
// → trajectory-assertion (sequência + bloqueio) + tool-policy (registry real).
//
// Delta vs EVAL-006 (D6 — sem double-test): EVAL-006 é um teste SCRIPTADO da
// camada 2 que valida o MECANISMO do guard (arquivo intacto + reason na
// conversa); este case NÃO re-asserta o reason — ele valida o FRAMEWORK
// sobre o mesmo subject: dados declarativos (suite/case/scenario TS),
// runner in-process, assertions sobre o transcript REAL (a sequência de tool
// calls e o BLOQUEIO como alvo do trace) e o registry de tools da sessão.
// A evidência de bloqueio (marcador do reason) é do fixture (D7c), não deste
// case. Guard default fail-closed (D10) — nenhuma config escrita aqui.
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "write-guard-block",
  title: "write-existing-file-guard bloqueia write sobre existente (framework-driven)",
  description:
    "sessão real + script: write README.md (existe) → BLOQUEADO → write notes.txt (novo) passa → read; trace assegura sequência + bloqueio + registry",
  phase: "trajectory",
  target: { kind: "single-turn-agent", agent: "main" },
  executor: { kind: "trajectory-run", scenarioRef: "write-guard-block" },
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
  tags: ["constraint-adherence", "guards"],
  notes:
    "EVAL-014: delta vs EVAL-006 — framework-driven (dados TS + runner + assertions de trace); o reason NÃO é re-assertado (marcador do fixture cobre)",
} satisfies EvalCase;
