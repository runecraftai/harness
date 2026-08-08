// scenarios/write-guard-block.ts — cenário EVAL-014 (write-existing-file-guard).
//
// Script do fixture F21 (counter+switch — a escolha do tool call é fakeada,
// a EXECUÇÃO é real): write sobre README.md (existe) → BLOQUEADO pelo guard
// F24 → write em path novo passa → read. O marcador do passo 2
// (conversationContains: "write-existing-file-guard") é a evidência do
// bloqueio NA ORDEM (D7c — o reason real aparece na conversa do request
// seguinte; sem o guard, o marcador some e o FIXTURE falha com diagnóstico).
//
// Delta vs EVAL-006 (D6 — sem double-test): EVAL-006 valida o MECANISMO do
// guard na camada 2 (arquivo intacto + reason na conversa, teste scriptado);
// este cenário é o DADO do framework (declarativo — o case EVAL-014 roda via
// runner/executors/evaluators e assegura a sequência REAL do transcript
// (trajectory-assertion) + o registry da sessão (tool-policy)). O reason em
// si NÃO é re-assertado aqui — o marcador do fixture cobre a evidência.
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "write-guard-block",
  title: "Write sobre arquivo existente bloqueado; write novo passa",
  description: "EVAL-014: write em README.md (existe) → block com reason F24 → write em notes.txt (novo) passa → read",
  prompt: "Update the repository: overwrite README.md, then create notes.txt.",
  withRepo: true,
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
    id: "write-guard-block",
    description: "EVAL-014: write sobre existente bloqueado (F24); write novo passa",
  },
} satisfies HarnessScenario;
