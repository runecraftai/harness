// scenarios/roles-scout-readonly.ts — cenário EVAL-059 (tool-use: scout).
//
// Script do fixture F21 (counter+switch — escolha fakeada, execução REAL):
// o scout faz recon com tools read-only da allowlist (read/grep/find/ls).
// A sessão é criada com a allowlist do papel (target.tools — EVAL-059) —
// o registry real contém exatamente as tools do scout; o tool-policy do
// case prova que write/edit/bash/subagent NÃO existem (fail-closed D3).
//
// Delta vs EVAL-014 (D6): EVAL-014 prova o mecanismo de tool-policy sobre
// os guards; ESTE cenário aplica o MESMO mecanismo ao SUJEITO novo (papel
// scout com allowlist read-only) — categoria tool-use correctness
// desbloqueada (F26 → F32).
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

export default {
  id: "roles-scout-readonly",
  title: "Scout read-only: recon com tools da allowlist (read/grep/find/ls)",
  description:
    "EVAL-059: sessão com allowlist do scout (read,grep,find,ls,intercom) → read → grep → find → ls → done; tool-policy sem write/edit/bash/subagent",
  prompt: "Survey the repository: read the readme, search for TODOs, find source files, and list the root.",
  withRepo: true,
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "tool", name: "read", args: { path: "README.md" } },
      },
      {
        expect: { toolsSubset: ["grep"] },
        reply: { kind: "tool", name: "grep", args: { pattern: "TODO", path: "." } },
      },
      {
        expect: { toolsSubset: ["find"] },
        reply: { kind: "tool", name: "find", args: { pattern: "*.ts" } },
      },
      {
        expect: { toolsSubset: ["ls"] },
        reply: { kind: "tool", name: "ls", args: { path: "." } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "done" },
      },
    ]),
    id: "roles-scout-readonly",
    description: "EVAL-059: scout usa apenas tools read-only (allowlist do papel)",
  },
} satisfies HarnessScenario;
