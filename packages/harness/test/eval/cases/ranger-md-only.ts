// cases/ranger-md-only.ts — EVAL-014: ranger-md-only (F24 GUARD-03) via framework.
//
// Case framework-driven sobre o ranger com a lista `mdOnlyAgents` PREENCHIDA
// (o guard é inerte por default — lista vazia, D5): o beforeSession escreve
// o state.json do repo com `rangerMdOnly.options.mdOnlyAgents: ["main"]` (o
// agente da sessão sem RUNECRAFT_AGENT_ID é "main" — F24 D5); o script
// tenta write de non-.md → BLOQUEADO (reason ranger-md-only) → write de .md
// passa. Assertions: trajectory-assertion (sequência + bloqueio) +
// tool-policy (registry real da sessão).
//
// Delta vs EVAL-006/007 (D6 — sem double-test): nenhum fluxo da matriz
// exercita o ranger com a lista preenchida (EVAL-006 cobre o write guard,
// EVAL-007 os todo guards); este case é a primeira cobertura do ranger com
// bloqueio REAL, expressa como dado do framework (combinação nova — não
// re-asserta EVAL-006/007).
import { writeGuardsState } from "../helpers/guardsState.ts";
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "ranger-md-only",
  title: "ranger-md-only restringe write a .md para o agente listado (framework-driven)",
  description:
    "sessão real com rangerMdOnly.mdOnlyAgents=[main] + script: write notes.txt (não-.md) → BLOQUEADO → write notes.md passa → read; trace assegura sequência + bloqueio + registry",
  phase: "trajectory",
  target: {
    kind: "single-turn-agent",
    agent: "main",
    beforeSession: ({ repoDir }) => {
      writeGuardsState(repoDir, {
        rangerMdOnly: { enabled: true, options: { mdOnlyAgents: ["main"] } },
      });
    },
  },
  executor: { kind: "trajectory-run", scenarioRef: "ranger-md-only" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["write", "write"],
      expectedDelegationTargets: ["write"],
      minTurns: 3,
      maxTurns: 3,
    },
    { kind: "tool-policy", expectations: { write: true, read: true } },
  ],
  tags: ["constraint-adherence", "guards"],
  notes:
    "EVAL-014: delta vs EVAL-006/007 — ranger com lista preenchida é combinação NOVA (nenhum fluxo da matriz o exercita); o reason não é re-assertado (marcador do fixture cobre)",
} satisfies EvalCase;
