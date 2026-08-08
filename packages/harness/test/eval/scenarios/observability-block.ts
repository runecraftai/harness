// scenarios/observability-block.ts — cenário EVAL-026/029 (F28 observability).
//
// Script do fixture F21 (counter+switch — escolha fakeada, execução REAL):
// write sobre README.md (existe) → BLOQUEADO pelo guard F24 → write em path
// novo passa → read. A extensão de observabilidade do F28 é materializada no
// agentDir via beforeSession (append ao settings.json — MESMO mecanismo que o
// F24 usa para a config de guards; a sessão real dispara session_start →
// store + tool_execution_end → guard:blocked).
//
// Delta vs EVAL-006/014 (D6 — sem double-test): EVAL-006 valida o MECANISMO
// do guard; EVAL-014 o framework sobre o subject; ESTE cenário prova a
// OBSERVAÇÃO do F28 (guard:blocked no store tipado via tool_execution_end —
// o tool_call NÃO expõe o block, validado no Execute runner.js) numa sessão
// REAL — sem duplicar os asserts de reason (o marcador do fixture cobre).
import * as fs from "node:fs";
import * as path from "node:path";
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

const OBSERVABILITY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/observability.ts",
);

export default {
  id: "observability-block",
  title: "Guard F24 bloqueia write; F28 observa guard:blocked no store tipado",
  description:
    "EVAL-026/029: sessão real (guards + observability) → write README.md bloqueado → tool_execution_end → guard:blocked no .runecraft/events/<sessionId>.jsonl",
  prompt: "Update the repository: overwrite README.md, then create notes.txt.",
  withRepo: true,
  beforeSession: ({ agentDir }) => {
    const settingsPath = path.join(agentDir, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
    const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
    if (!extensions.includes(OBSERVABILITY_EXTENSION)) extensions.push(OBSERVABILITY_EXTENSION);
    settings.extensions = extensions;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["write"] },
        reply: { kind: "tool", name: "write", args: { path: "README.md", content: "overwrite attempt" } },
      },
      {
        expect: { toolsSubset: ["write"], conversationContains: ["write-existing-file-guard"] },
        reply: { kind: "tool", name: "write", args: { path: "notes.txt", content: "fresh content" } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "observability-block",
    description: "EVAL-026/029: bloqueio F24 observado pelo F28 (guard:blocked) em sessão real",
  },
} satisfies HarnessScenario;
