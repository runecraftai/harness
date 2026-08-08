// suites/memory.ts — suite do F29 (Memory — EVAL-030..038).
//
// Suite do framework para a categoria memory (pilar 7 — "memória persistente
// cross-session"). Os cases puros (EVAL-030/032..037) são unit do framework
// (test/eval/framework/memory.test.ts — mesmo padrão EVAL-017..020 do F27);
// o case trajectory da suite é o memory-roundtrip (EVAL-031 — tools rune_*
// reais no loop do Pi, com a prova do round-trip no runes.db no teste de
// framework). Delta vs EVAL-006/007/014/019/022..029 documentado em cada
// case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "memory",
  title: "Memory (F29 — EVAL-030..038)",
  phase: "trajectory",
  caseFiles: ["../cases/memory-roundtrip.ts"],
  suiteMetadata: {
    title: "Memory",
    routingKind: "trajectory",
    familyId: "memory",
    familyTitle: "Memory",
    viewId: "memory",
    viewTitle: "Memory F29",
  },
  tags: ["memory"],
} satisfies EvalSuiteManifest;
