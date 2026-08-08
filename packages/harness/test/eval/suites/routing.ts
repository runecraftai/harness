// suites/routing.ts — suite do F33 (Coded Routing & Pilot Coordination —
// EVAL-072..075).
//
// Suite do framework para a categoria **routing completeness** (F26 —
// COMPLETA na v11): o roteador codificado (classificador determinístico puro
// + catálogo de rotas como dados + pilot chains + hook before_agent_start).
// Os cases trajectory são EVAL-072..075 (sessões reais com a extensão routing
// materializada + chains em .pi/chains/ → delegação REAL via tool subagent
// no transcript — F26 QA-2); os cases puros EVAL-067..071 e os de wiring
// EVAL-076..078 vivem no framework (test/eval/framework/routing.test.ts —
// mesmo padrão EVAL-017..020 do F27). Delta vs EVAL-001..071 documentado em
// cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "routing",
  title: "Coded Routing & Pilot Coordination (F33 — EVAL-072..075)",
  phase: "trajectory",
  caseFiles: [
    "../cases/routing-explore-scout.ts",
    "../cases/routing-research-researcher.ts",
    "../cases/routing-planning-planner.ts",
    "../cases/routing-implement-builder.ts",
  ],
  suiteMetadata: {
    title: "Coded Routing & Pilot Coordination",
    routingKind: "trajectory",
    familyId: "routing",
    familyTitle: "Coded Routing & Pilot Coordination",
    viewId: "routing",
    viewTitle: "Coded Routing F33",
  },
  tags: ["routing"],
} satisfies EvalSuiteManifest;
