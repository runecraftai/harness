// suites/roles.ts — suite do F32 (Objective Role Agents — EVAL-057..066).
//
// Suite do framework para as categorias **tool-use correctness** e
// **routing completeness** (F26 — desbloqueadas na v10): os papéis
// objetivos como agentes-dados (.pi/agents/*.md), allowlists fail-closed
// (D3), descoberta/shadowing reais do fork (D1/D2), delegação via template
// (D5) e a interface de modelos F30 (D8). Os cases EVAL-057/058/062..066
// são unit/fixture do framework (test/eval/framework/roles.test.ts — mesmo
// padrão EVAL-017..020 do F27); os cases trajectory são EVAL-059/060/061
// (tool-use: sessões com allowlists reais dos papéis + guards). Delta vs
// EVAL-001..056 documentado em cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "roles",
  title: "Objective Role Agents (F32 — EVAL-057..066)",
  phase: "trajectory",
  caseFiles: ["../cases/roles-scout-readonly.ts", "../cases/roles-builder-write.ts"],
  suiteMetadata: {
    title: "Objective Role Agents",
    routingKind: "trajectory",
    familyId: "roles",
    familyTitle: "Objective Role Agents",
    viewId: "roles",
    viewTitle: "Objective Role Agents F32",
  },
  tags: ["roles"],
} satisfies EvalSuiteManifest;
