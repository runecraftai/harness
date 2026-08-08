// scenarios/roles-builder-write.ts — cenário EVAL-060 (tool-use: builder).
//
// Script do fixture F21 (escolha fakeada, execução REAL): o builder lê o
// contexto, escreve um arquivo novo, verifica via bash e reporta. A sessão
// é criada com a allowlist do papel (target.tools — EVAL-060): write/edit/
// bash/subagent estão PRESENTES e legítimos (o builder é o papel escritor —
// D3); o tool-policy prova que a allowlist contém exatamente as tools do
// papel.
//
// Delta vs EVAL-014 (D6): mesmo mecanismo de tool-policy, SUJEITO novo
// (papel builder) — categoria tool-use correctness desbloqueada.
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "roles-builder-write",
  title: "Builder writer: read → write → bash verify → report",
  description:
    "EVAL-060: sessão com allowlist do builder (read,grep,find,ls,bash,edit,write,intercom,contact_supervisor,subagent) → read → write → bash → done; tool-policy com write/edit/bash presentes",
  prompt: "Execute: read the readme, create a build-ok.txt marker, then verify it with bash.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "tool", name: "read", args: { path: "README.md" } },
      },
      {
        expect: { toolsSubset: ["write"] },
        reply: { kind: "tool", name: "write", args: { path: "build-ok.txt", content: "built" } },
      },
      {
        expect: { toolsSubset: ["bash"] },
        reply: { kind: "tool", name: "bash", args: { command: "test -f build-ok.txt" } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "roles-builder-write",
    description: "EVAL-060: builder executa com write/edit/bash legítimos (allowlist do papel)",
  },
} satisfies HarnessScenario;
