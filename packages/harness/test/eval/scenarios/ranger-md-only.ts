// scenarios/ranger-md-only.ts — cenário EVAL-014 (ranger-md-only).
//
// Guard ranger F24 com a lista `mdOnlyAgents` configurada (o agente da
// sessão é "main" — RUNECRAFT_AGENT_ID ausente → default; a config vai no
// beforeSession do CASE, não aqui): write de non-.md (notes.txt) →
// BLOQUEADO com reason `ranger-md-only: ...`; write de .md (notes.md) passa.
// O marcador do passo 2 (conversationContains: "ranger-md-only") é a
// evidência do bloqueio na ordem (D7c).
//
// Delta vs EVAL-006/007 (D6): EVAL-006 cobre o write-existing-file-guard e
// EVAL-007 os todo guards; o ranger (GUARD-03) é INERTO por default (lista
// vazia — D5) e NENHUM fluxo da matriz o exercita com a lista preenchida —
// este cenário é a primeira cobertura do ranger com bloqueio real, expressa
// como dado do framework (EVAL-014).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "ranger-md-only",
  title: "Ranger md-only: write de non-.md bloqueado; write de .md passa",
  description:
    "EVAL-014: agente 'main' na mdOnlyAgents → write notes.txt (não-.md) bloqueado com reason ranger-md-only; write notes.md passa",
  prompt: "Update the repository: write notes.txt, then write notes.md.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["write"] },
        reply: { kind: "tool", name: "write", args: { path: "notes.txt", content: "code change attempt" } },
      },
      {
        expect: { toolsSubset: ["write"], conversationContains: ["ranger-md-only"] },
        reply: { kind: "tool", name: "write", args: { path: "notes.md", content: "# Notes" } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "ranger-md-only",
    description: "EVAL-014: ranger md-only bloqueia write de non-.md (agente main)",
  },
} satisfies HarnessScenario;
