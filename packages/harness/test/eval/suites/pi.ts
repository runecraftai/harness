// suites/pi.ts — suite do F30 (Pi First-Class & SDD Assets — EVAL-039..048).
//
// Suite do framework para a categoria pi-first-class (M8 — persona/rules/
// first-message + model routing + modelSwitch + SDD assets). Os cases
// EVAL-039..048 são unit/fixture do framework (test/eval/framework/pi.test.ts
// — mesmo padrão EVAL-017..020 do F27): a emissão real de before_agent_start
// com múltiplas extensões é exercitada via sessão com handlers exportados
// (AD-027 QA-5 — eventos scriptados) e via fixture ModelRuntime para os
// models. A suite não tem case trajectory próprio (nenhum fluxo SDLC novo —
// a prova da camada vive no framework). Delta vs EVAL-017..021/022..029/
// 030..038 documentado em cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "pi",
  title: "Pi First-Class & SDD Assets (F30 — EVAL-039..048)",
  phase: "trajectory",
  caseFiles: [],
  suiteMetadata: {
    title: "Pi First-Class",
    routingKind: "trajectory",
    familyId: "pi",
    familyTitle: "Pi First-Class & SDD Assets",
    viewId: "pi",
    viewTitle: "Pi First-Class F30",
  },
  tags: ["pi"],
} satisfies EvalSuiteManifest;
