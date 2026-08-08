// cases/memory-roundtrip.ts — EVAL-031 (F29): round-trip real dos tools
// rune_* numa sessão do Pi via framework (F26).
//
// Case framework-driven: sessão SDK in-process (single-turn-agent) com a
// extensão de memória materializada (beforeSession do cenário) → cenário
// scriptado (trajectory-run) → trajectory-assertion (sequência rune_save →
// rune_search) + tool-policy (registry com as rune_*). A prova do round-trip
// REAL no runes.db (WAL — leitura direta após a sessão) vive no teste de
// framework (EVAL-031).
//
// Delta vs EVAL-006/007/014 (D6 — sem double-test): o sujeito é a memória
// (tools + DB do F29); o mecanismo de guards/vereditos já é coberto pelos
// EVALs existentes.
import type { EvalCase } from "../../../src/eval/types.ts";

export default {
  id: "memory-roundtrip",
  title: "rune_save → rune_search round-trip (tools F29 no loop do Pi) — framework-driven",
  description:
    "sessão real (extensão memory): rune_save → rune_search → done; trace assegura sequência + registry com as rune_*",
  phase: "trajectory",
  target: { kind: "single-turn-agent", agent: "main" },
  executor: { kind: "trajectory-run", scenarioRef: "memory-roundtrip" },
  evaluators: [
    {
      kind: "trajectory-assertion",
      expectedSequence: ["rune_save", "rune_search"],
      minTurns: 3,
      maxTurns: 3,
    },
    { kind: "tool-policy", expectations: { rune_save: true, rune_search: true, rune_get: true, rune_context: true } },
  ],
  tags: ["memory"],
  notes:
    "EVAL-031: delta vs EVAL-006/007/014 — sujeito F29 (tools rune_* + runes.db real); reason/markers de guards não re-assertados",
} satisfies EvalCase;
