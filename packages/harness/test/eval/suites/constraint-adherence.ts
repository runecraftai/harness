// suites/constraint-adherence.ts — EVAL-014: constraint adherence v1 (F24).
//
// Suite do framework com os subjects guards F24 (decisão 4 do usuário —
// garantias antes de agentes): os cases verdes (write-guard-block e
// ranger-md-only) rodam com os guards default fail-closed (D10) / lista
// preenchida no beforeSession do case. O case adversarial-guard-off NÃO
// entra na suite (falha por contrato — desvio induzido; exercitado isolado
// pelo teste de framework, EVAL-014 AC3). Categorias bloqueadas
// (tool-use/routing F32, compaction F27, failover F30) NÃO têm entrada —
// tabela de dependência em docs/EVAL-FRAMEWORK.md (D5, sem inventar design).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "constraint-adherence",
  title: "Constraint Adherence v1 (guards F24 — EVAL-014)",
  phase: "trajectory",
  caseFiles: ["../cases/write-guard-block.ts", "../cases/ranger-md-only.ts"],
  suiteMetadata: {
    title: "Constraint Adherence v1",
    routingKind: "trajectory",
    familyId: "constraint-adherence",
    familyTitle: "Constraint Adherence",
    viewId: "guards",
    viewTitle: "Guards F24",
  },
  tags: ["constraint-adherence"],
} satisfies EvalSuiteManifest;
