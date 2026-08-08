// cases/roles-scout-readonly.ts — EVAL-059: tool-use correctness (scout).
//
// Case framework-driven: sessão SDK in-process (single-turn-agent) com a
// ALLOWLIST do papel scout (read,grep,find,ls,intercom — D3; fail-closed:
// o que não está na lista não existe) → cenário scriptado (trajectory-run)
// → tool-policy sobre o registry REAL da sessão (write/edit/bash/subagent
// ausentes) + trajectory-assertion (sequência read-only). Categoria
// **tool-use correctness** desbloqueada (F26 → F32).
//
// Delta vs EVAL-014 (D6 — sem double-test): EVAL-014 prova o MECANISMO
// tool-policy/trajectory-assertion sobre os guards F24; este case prova a
// ADIÇÃO do sujeito (allowlist read-only do papel scout) — o mecanismo não
// é re-assertado.
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "roles-scout-readonly",
  title: "tool-use: scout com allowlist read-only (EVAL-059)",
  description:
    "sessão real com allowlist do scout (read,grep,find,ls,intercom): read→grep→find→ls→done; tool-policy sem write/edit/bash/subagent; trace assegura a sequência",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "intercom"],
  },
  executor: { kind: "trajectory-run", scenarioRef: "roles-scout-readonly" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["read", "grep", "find", "ls"],
      minTurns: 5,
      maxTurns: 5,
    },
    {
      kind: "tool-policy",
      expectations: {
        read: true,
        grep: true,
        find: true,
        ls: true,
        intercom: true,
        write: false,
        edit: false,
        bash: false,
        subagent: false,
        contact_supervisor: false,
        web_search: false,
        fetch_content: false,
        get_search_content: false,
      },
    },
  ],
  tags: ["roles", "tool-use"],
  notes:
    "EVAL-059: delta vs EVAL-014 — o mecanismo tool-policy já é provado; a ADIÇÃO é a allowlist read-only do papel scout (categoria tool-use correctness desbloqueada)",
} satisfies EvalCase;
