// scenarios/memory-roundtrip.ts — cenário EVAL-031 (F29 memory).
//
// Script do fixture F21 (counter+switch — escolha fakeada, execução REAL):
// rune_save → rune_search → done. A extensão de memória do F29 é
// materializada no agentDir via beforeSession (append ao settings.json —
// MESMO mecanismo do F28); a sessão real dispara session_start → 10 tools
// rune_* registradas → rune_save persiste no `.runecraft/memory/runes.db`
// (WAL) e rune_search acha via FTS5. A prova de round-trip REAL no DB vive
// no teste de framework (EVAL-031 — leitura direta do runes.db após a
// sessão); o case cobre a sequência + registry (trajectory-assertion +
// tool-policy).
//
// Delta vs EVAL-006/007/014 (D6 — sem double-test): nenhum guard/veredito é
// re-assertado — o sujeito é a camada de memória (tools + DB).
import * as fs from "node:fs";
import * as path from "node:path";
import { script } from "../layer2/fixture/scenarios.ts";
import type { HarnessScenario } from "../../../src/eval/types.ts";

const MEMORY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/memory.ts",
);

export default {
  id: "memory-roundtrip",
  title: "rune_save → rune_search round-trip real (tools F29 no loop do Pi)",
  description:
    "EVAL-031: sessão real com a extensão memory → rune_save persiste (runes.db) → rune_search acha via FTS5; registry com as 10 rune_*",
  prompt: "Save a memory: category decisions, title 'Use DDD', what 'We chose Domain-Driven Design for the payments service'. Then search for 'Domain-Driven'. Then stop.",
  withRepo: true,
  beforeSession: ({ agentDir }) => {
    const settingsPath = path.join(agentDir, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
    const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
    if (!extensions.includes(MEMORY_EXTENSION)) extensions.push(MEMORY_EXTENSION);
    settings.extensions = extensions;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
  scenario: {
    ...script([
      {
        expect: { toolsSubset: ["rune_save"] },
        reply: {
          kind: "tool",
          name: "rune_save",
          args: { category: "decisions", title: "Use DDD", what: "We chose Domain-Driven Design for the payments service", importance: 8 },
        },
      },
      {
        expect: { toolsSubset: ["rune_search"] },
        reply: { kind: "tool", name: "rune_search", args: { query: "Domain-Driven", limit: 5 } },
      },
      {
        expect: { toolsSubset: ["read"] },
        reply: { kind: "text", text: "The memory was saved and found. Done." },
      },
    ]),
    id: "memory-roundtrip",
    description: "EVAL-031: rune_save → rune_search real no loop do Pi (F29)",
  },
} satisfies HarnessScenario;
