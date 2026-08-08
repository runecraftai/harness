// suites/copilot.ts — suite do F31 (Copilot/VSCode Adapter — EVAL-049..056).
//
// Suite do framework para a categoria copilot-adapter (M8 — adapter F15 +
// coluna matriz F17 + two-driver F18 + reuso F19). Os cases EVAL-049..056
// são unit/fixture do framework (test/eval/framework/copilot.test.ts — mesmo
// padrão EVAL-017..020 do F27 / EVAL-039..048 do F30): detecção, injeção
// repo-scoped (rules .github/copilot-instructions.md + MCP .vscode/mcp.json),
// remoção content-based, fail-closed, matriz/status, two-driver gentle-ai e
// sync/state. A suite não tem case trajectory próprio (nenhum fluxo SDLC
// novo — o adapter é mecanismo; a prova vive no framework). Delta vs
// EVAL-017..048 documentado em cada case (D6 — sem double-test).
import type { EvalSuiteManifest } from "../../../src/eval/types.ts";

export default {
  id: "copilot",
  title: "Copilot/VSCode Adapter (F31 — EVAL-049..056)",
  phase: "trajectory",
  caseFiles: [],
  suiteMetadata: {
    title: "Copilot (VS Code)",
    routingKind: "trajectory",
    familyId: "copilot",
    familyTitle: "Copilot/VSCode Adapter",
    viewId: "copilot",
    viewTitle: "Copilot/VSCode F31",
  },
  tags: ["copilot"],
} satisfies EvalSuiteManifest;
