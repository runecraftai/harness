// hermetic-env.test.ts — D3: nada da máquina real vaza para a suite.
//
// Edge da spec (git config global do runner + skills/settings reais):
// o preload (test/eval/setup.ts) isola HOME/XDG/GIT_CONFIG_* e o SDK resolve
// getHomeDir() = process.env.HOME || os.homedir() — skills do usuário real
// (~/.agents/skills) e o settings global do glla não podem aparecer na sessão.
import { describe, expect, test } from "bun:test";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { EVAL_001 } from "./fixture/scenarios.ts";

describe("hermeticidade do ambiente (D3)", () => {
  test("HOME isolado: skills reais do usuário não vazam; glla carrega; git global anulado", async () => {
    await evalTest("HOME isolado: skills reais do usuário não vazam; glla carrega; git global anulado", async () => {
      const fx = await setupEvalFixture({ scenario: EVAL_001, withRepo: true });
      try {
        const runner = (
          fx.session.session as unknown as { _extensionRunner: { getCommand(name: string): unknown } }
        )._extensionRunner;

        // Skills reais do runner (~/.agents/skills, vistos no experimento F21):
        // com HOME isolado eles NÃO existem na sessão.
        for (const leaked of ["skill:accessibility", "skill:caveman", "skill:omarchy"]) {
          expect(runner.getCommand(leaked)).toBeUndefined();
        }
        // O glla (extensão dos forks) carrega: comando /goal presente.
        expect(runner.getCommand("goal")).toBeDefined();
        // GIT_CONFIG_GLOBAL isolado (edge da spec): git não lê config global real.
        expect(process.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
        expect(fx.env.HOME).toContain("runecraft-eval-");
      } finally {
        fx.cleanup();
      }
    });
  });
});
