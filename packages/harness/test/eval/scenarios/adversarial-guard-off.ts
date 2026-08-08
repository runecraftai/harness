// scenarios/adversarial-guard-off.ts — cenário EVAL-014 (desvio induzido).
//
// MESMO script do write-guard-block, mas o beforeSession escreve o
// state.json com o write-existing-file-guard DESLIGADO (enabled: false).
// Resultado esperado: o write sobre README.md PASSA (o desvio é real) e o
// marcador do passo 2 ("write-existing-file-guard") some da conversa → o
// FIXTURE falha com diagnóstico (padrão F24 T7 — evidência fora de ordem).
// O case adversarial NUNCA está na suite default (ele falha por contrato);
// o teste de framework roda o case isolado e assegura a falha com
// diagnóstico (EVAL-014 AC3).
import { writeGuardsState } from "../helpers/guardsState.ts";
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "adversarial-guard-off",
  title: "Guard off no config → o fluxo falha com diagnóstico (nunca passa em silêncio)",
  description:
    "EVAL-014 adversarial: write-existing-file-guard desligado → write sobre README.md passa → marcador ausente → fixture acusa o desvio",
  prompt: "Update the repository: overwrite README.md, then create notes.txt.",
  withRepo: true,
  beforeSession: ({ repoDir }) => {
    writeGuardsState(repoDir, { writeExistingFile: { enabled: false } });
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
    id: "adversarial-guard-off",
    description: "EVAL-014 adversarial: guard off → fixture falha com diagnóstico",
  },
} satisfies HarnessScenario;
