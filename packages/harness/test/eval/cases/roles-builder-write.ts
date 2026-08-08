// cases/roles-builder-write.ts — EVAL-060: tool-use correctness (builder).
//
// Case framework-driven: sessão SDK in-process com a ALLOWLIST do papel
// builder (D3 — read,grep,find,ls,bash,edit,write,intercom,
// contact_supervisor,subagent) → cenário scriptado (trajectory-run) →
// tool-policy sobre o registry REAL (write/edit/bash presentes e
// legítimos) + trajectory-assertion (read → write → bash). O builder é o
// ÚNICO papel com a tool subagent (QA-5a) — a allowlist prova a presença.
//
// Delta vs EVAL-014/059 (D6 — sem double-test): EVAL-014 prova o mecanismo;
// EVAL-059 prova a allowlist read-only do scout; ESTE case prova a
// ADIÇÃO simétrica (allowlist do escritor com mutation tools).
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "roles-builder-write",
  title: "tool-use: builder com allowlist de escritor (EVAL-060)",
  description:
    "sessão real com allowlist do builder (read,grep,find,ls,bash,edit,write,intercom,contact_supervisor,subagent): read→write→bash→done; tool-policy com write/edit/bash presentes",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "contact_supervisor", "subagent"],
  },
  executor: { kind: "trajectory-run", scenarioRef: "roles-builder-write" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["read", "write", "bash"],
      minTurns: 4,
      maxTurns: 4,
    },
    {
      kind: "tool-policy",
      expectations: {
        read: true,
        grep: true,
        find: true,
        ls: true,
        bash: true,
        edit: true,
        write: true,
        intercom: true,
        subagent: true,
        web_search: false,
        fetch_content: false,
        get_search_content: false,
      },
    },
  ],
  tags: ["roles", "tool-use"],
  notes:
    "EVAL-060: delta vs EVAL-014/059 — a ADIÇÃO é a allowlist de escritor do papel builder (categoria tool-use correctness; QA-5a: único papel com subagent). contact_supervisor é bridge-gated (registrado só com canal de supervisor ativo — validado no Execute) → fora do tool-policy",} satisfies EvalCase;
