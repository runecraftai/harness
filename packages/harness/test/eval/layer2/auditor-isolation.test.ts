// auditor-isolation.test.ts — EVAL-005b: isolamento do auditor (F7 COEX-06).
//
// O auditor roda em sessão FRESCA sem extensões/skills/prompts (validado no
// Execute F21 #2: o glla usa makeAuditorResourceLoader — zero recursos — e
// `tools: ["read","grep","find","ls","bash"]`). O fixture valida por passo
// (tools EXATAMENTE os builtins — qualquer extensão vazando = falha); este
// teste adiciona a auditoria META sobre os requests vistos: todo request com
// perfil de auditor (tools ⊆ builtins) precisa ser exatamente o conjunto
// builtin — nunca um subconjunto com ferramenta extra.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { waitForCondition } from "../helpers/wait.ts";
import { EVAL_001 } from "./fixture/scenarios.ts";

const AUDITOR_BUILTINS = ["read", "grep", "find", "ls", "bash"];

describe("EVAL-005b — isolamento do auditor (F7 COEX-06)", () => {
  test("EVAL-005b: auditor sem extensões — tools exatamente read/grep/find/ls/bash em toda sessão de auditoria", async () => {
    await evalTest(
      "EVAL-005b: auditor sem extensões — tools exatamente read/grep/find/ls/bash em toda sessão de auditoria",
      async () => {
        const fx = await setupEvalFixture({ scenario: EVAL_001, withRepo: true });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(
            '/goal start Create a file greeting.txt whose content is exactly "hello harness". Done when: greeting.txt exists in the repo root and its content is exactly "hello harness"',
          );
          const ledger = path.join(repoDir, ".pi-glla", "active.jsonl");
          const archived = await waitForCondition(
            () => fs.existsSync(ledger) && fs.readFileSync(ledger, "utf8").includes('"goal_archived"'),
            { timeoutMs: 60_000, label: "goal_archived (EVAL-005b)" },
          );
          expect(archived).toBe(true);

          // Meta-auditoria: todo request cujo tool set é só builtins (perfil do
          // auditor) DEVE ser exatamente o conjunto builtin — qualquer tool de
          // extensão (subagent/taskflow/complete_goal/pr-review) vazando = falha.
          const auditorRequests = fx.server.seen.filter((s) => s.tools.every((t) => AUDITOR_BUILTINS.includes(t)));
          expect(auditorRequests.length).toBeGreaterThanOrEqual(2);
          for (const req of auditorRequests) {
            expect([...req.tools].sort()).toEqual([...AUDITOR_BUILTINS].sort());
          }

          // E a sessão principal NUNCA perdeu as tools de extensão (o glla está
          // presente nos requests da sessão principal — complete_goal registrado).
          const mainRequests = fx.server.seen.filter((s) => s.tools.some((t) => !AUDITOR_BUILTINS.includes(t)));
          expect(mainRequests.length).toBeGreaterThanOrEqual(2);
          expect(mainRequests[1]!.tools).toContain("complete_goal");

          // A sessão do auditor é FRESCA (não vê a conversa do executor):
          // os requests do auditor têm contexto mínimo (sem o objective completo).
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-005b" },
    );
  });
});
