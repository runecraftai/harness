// suites/observability.ts — suite do F28 (Observability & Lessons — EVAL-022..029).
//
// Suite do framework para a categoria observability (pilar 7 — "Eventos tipados
// em event store auditável ... exportável pra Langfuse/OTel"). Os cases puros
// (EVAL-022..025/027/028/029) são unit do framework (test/eval/framework/
// observability.test.ts — mesmo padrão EVAL-017..020 do F27: o executor
// trajectory-run exige sessão); o case trajectory da suite é o observability-
// block (EVAL-026/029 — observação REAL do bloqueio F24 numa sessão com a
// extensão do F28, com a prova do guard:blocked no store no teste de framework).
// Delta vs EVAL-006/007/014/019 documentado em cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "observability",
  title: "Observability & Lessons (F28 — EVAL-022..029)",
  phase: "trajectory",
  caseFiles: ["../cases/observability-block.ts"],
  suiteMetadata: {
    title: "Observability & Lessons",
    routingKind: "trajectory",
    familyId: "observability",
    familyTitle: "Observability & Lessons",
    viewId: "observability",
    viewTitle: "Observability & Lessons F28",
  },
  tags: ["observability"],
} satisfies EvalSuiteManifest;
