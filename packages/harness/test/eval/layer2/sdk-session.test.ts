// sdk-session.test.ts — EVAL-001: goal trivial com auditor isolado.
//
// DETR-03/DETR-04/DETR-05: sequência scriptada (contador+switch), adversário
// por construção, isolamento do auditor (tools ⊆ read/grep/find/ls/bash),
// offline/$0 (loopback + apiKey literal "fixture").
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupEvalFixture, type EvalFixture } from "../helpers/evalFixture.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { waitForCondition } from "../helpers/wait.ts";
import { EVAL_001 } from "./fixture/scenarios.ts";

const GOAL_OBJECTIVE =
  'Create a file greeting.txt whose content is exactly "hello harness". Done when: greeting.txt exists in the repo root and its content is exactly "hello harness"';

describe("EVAL-001 — goal trivial (P1 camada 2)", () => {
  test("EVAL-001: goal → write real → complete_goal → auditor aprova (sequência scriptada)", async () => {
    await evalTest("EVAL-001: goal → write real → complete_goal → auditor aprova (sequência scriptada)", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_001,
        withRepo: true,
      });
      try {
        const repoDir = fx.repo!.dir;

        // 1. goal com "Done when" — comando /goal start (sem turno de modelo).
        await fx.session.session.prompt(`/goal start ${GOAL_OBJECTIVE}`);
        const ledger = path.join(repoDir, ".pi-glla", "active.jsonl");
        expect(fs.existsSync(ledger)).toBe(true);

        // 2-5. A continuação do glla dirige os turnos; o fixture escolhe cada
        // tool call; o agente EXECUTA de verdade (write/bash reais).
        const archived = await waitForCondition(
          () => fs.existsSync(ledger) && fs.readFileSync(ledger, "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived" },
        );
        expect(archived).toBe(true);

        // Efeito real no repo descartável (D4): o arquivo existe com o conteúdo exato.
        const greeting = path.join(repoDir, "greeting.txt");
        expect(fs.existsSync(greeting)).toBe(true);
        expect(fs.readFileSync(greeting, "utf8")).toBe("hello harness");

        // O ledger registra complete com o auditor aprovando (regression_shield).
        const ledgerText = fs.readFileSync(ledger, "utf8");
        expect(ledgerText).toContain('"goal_archived"');
        expect(ledgerText).toContain('"status":"complete"');
        expect(ledgerText).toContain('"regressionShieldPassed":true');
        expect(ledgerText).toContain('"stopReason":"auditor eval-model approved"');

        // Sequência: write, complete_goal, read (auditor), approved — sem falha
        // adversarial (a continuação pós-aprovação é tolerada no script).
        expect(fx.server.diagnosis).toEqual([]);
        expect(fx.server.seen.length).toBeGreaterThanOrEqual(4);
        expect(fx.server.seen[0]!.tools).toContain("write");
        expect(fx.server.seen[1]!.tools).toContain("complete_goal");
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-001" });
  });
});
