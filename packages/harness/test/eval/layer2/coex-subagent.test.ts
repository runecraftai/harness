// coex-subagent.test.ts — EVAL-002: goal ativo + subagent chain worker (F7 COEX-02).
//
// O subagent roda como WORKER sob o driver goal-loop: o child pi (processo
// real spawnado pelo fork — bun + CLI do SDK, validado no Execute F21 #2/#4)
// executa bash de verdade no repo de teste; a sequência é scriptada por
// contador (call 1 = subagent, 2-3 = child, 4 = complete_goal, 5-6 = auditor).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { waitForCondition } from "../helpers/wait.ts";
import { EVAL_002 } from "./fixture/scenarios.ts";

describe("EVAL-002 — goal + subagent chain worker (F7 COEX-02)", () => {
  test("EVAL-002: goal → subagent worker (bash real) → complete_goal → auditor aprova", async () => {
    await evalTest(
      "EVAL-002: goal → subagent worker (bash real) → complete_goal → auditor aprova",
      async () => {
        const fx = await setupEvalFixture({ scenario: EVAL_002, withRepo: true });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(
            '/goal start Create a file worker.txt whose content is exactly "worker-ran". Done when: worker.txt exists in the repo root and its content is exactly "worker-ran"',
          );

          const ledger = path.join(repoDir, ".pi-glla", "active.jsonl");
          const archived = await waitForCondition(
            () => fs.existsSync(ledger) && fs.readFileSync(ledger, "utf8").includes('"goal_archived"'),
            { timeoutMs: 90_000, label: "goal_archived (EVAL-002)" },
          );
          expect(archived).toBe(true);

          // Efeito real do WORKER (o child pi executou bash de verdade).
          const workerFile = path.join(repoDir, "worker.txt");
          expect(fs.existsSync(workerFile)).toBe(true);
          expect(fs.readFileSync(workerFile, "utf8")).toBe("worker-ran\n");

          // Sequência scriptada completa sem falha adversarial (a continuação
          // pós-aprovação do glla é tolerada no script — passo final).
          expect(fx.server.diagnosis).toEqual([]);
          expect(fx.server.seen.length).toBeGreaterThanOrEqual(6);
          const seen = fx.server.seen;
          expect(seen[0]!.tools).toContain("subagent");
          expect(seen[3]!.tools).toContain("complete_goal");
          // Auditor: tools exatamente os builtins (isolamento).
          for (const n of [4, 5]) {
            expect([...seen[n]!.tools].sort()).toEqual(["bash", "find", "grep", "ls", "read"]);
          }
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-002" },
    );
  });
});
