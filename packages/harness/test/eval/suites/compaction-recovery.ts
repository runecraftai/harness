// suites/compaction-recovery.ts — suite do F27 (Resilience & Continuity).
//
// Suite do framework para a categoria compaction-recovery do eval-coverage
// (bloqueada no F26 — "após F27"; EVAL-MATRIX v5). Os cases verdes rodam
// com o runner do F26 (loader → runner → single-turn-agent + trajectory-run
// → assertions sobre o transcript REAL).
//
// Cobertura EVAL-017..021 (ver test/eval/framework/compaction-recovery.test.ts):
//   - EVAL-017 continuation builder (puro — determinismo, scoping, invariante D7)
//   - EVAL-018 todo preserver (snapshot/restore decisions — D3/D7)
//   - EVAL-019 stall detection (puro + wiring com eventos scriptados — D4)
//   - EVAL-020 classify + fallback policy (puro — D5/D6)
//   - EVAL-021 fluxo completo de recuperação (invariante F24 em sessão real +
//     wiring com eventos scriptados — QA-5)
// Os cases puros (EVAL-017/018/019/020) são unit do framework (o executor
// trajectory-run exige sessão); o case trajectory da suite é o recovery-flow
// (EVAL-021 — invariante em sessão glla REAL). Delta vs EVAL-006/007/014
// documentado em cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "compaction-recovery",
  title: "Compaction Recovery (F27 Resilience & Continuity — EVAL-017..021)",
  phase: "trajectory",
  caseFiles: ["../cases/recovery-flow.ts"],
  suiteMetadata: {
    title: "Compaction Recovery",
    routingKind: "trajectory",
    familyId: "compaction-recovery",
    familyTitle: "Compaction Recovery",
    viewId: "resilience",
    viewTitle: "Resilience & Continuity F27",
  },
  tags: ["compaction-recovery", "resilience"],
} satisfies EvalSuiteManifest;
