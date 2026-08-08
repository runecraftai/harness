// guards/adversarial.test.ts — GUARD-07/08: desvio induzido → falha com
// diagnóstico (padrão F21 D7 aplicado aos guards).
//
// O cenário EVAL-006 é o contrato: passo 2 exige o reason do
// write-existing-file-guard na conversa (D7c — evidência na ordem). Se o
// guard regredir (deixar de bloquear), o marcador some e o FIXTURE falha com
// diagnóstico (call esperada vs recebida). Este teste INDUZ o desvio: o
// guard é desligado no config (a sessão abre com `enabled: false`) e o fluxo
// EVAL-006 roda — o teste prova que a suite NÃO passa em silêncio quando o
// mecanismo regride.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { setupEvalFixture, type EvalFixture } from "../eval/helpers/evalFixture.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";
import { EVAL_006 } from "../eval/layer2/fixture/scenarios.ts";

describe("adversarial — o mecanismo de guards não regride em silêncio (F21 D7)", () => {
  test("guard desligado no config → o fluxo EVAL-006 falha com diagnóstico (nunca passa em silêncio)", async () => {
    await evalTest("guard desligado no config → o fluxo EVAL-006 falha com diagnóstico", async () => {
      // Desvio induzido: a sessão abre com o write guard DESLIGADO — o
      // cenário EVAL-006 espera o reason na conversa do passo 2; sem o guard,
      // o write sobre README.md passa e o fixture acusa a divergência.
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_006,
        withRepo: true,
        beforeSession: ({ repoDir }) => {
          const stateDir = fs.mkdirSync(`${repoDir}/.runecraft`, { recursive: true });
          fs.writeFileSync(
            `${stateDir}/state.json`,
            JSON.stringify({
              schemaVersion: 1,
              scope: "workspace",
              components: {},
              guards: { writeExistingFile: { enabled: false } },
            }),
          );
        },
      });
      try {
        // O prompt roda até o fim do script (3 calls); o fixture acumula o
        // diagnóstico do desvio no passo 2 (marcador ausente na conversa).
        await fx.session.session.prompt("Update the repository: overwrite README.md, then create notes.txt.");
        expect(fx.server.diagnosis.length).toBeGreaterThan(0);
        const diagnosis = fx.server.diagnosis.join("\n");
        expect(diagnosis).toContain("evidência fora de ordem");
        expect(diagnosis).toContain("write-existing-file-guard");
        // O alvo foi de fato sobrescrito (o guard não estava lá) — a prova de
        // que o desvio é real e o diagnóstico o captura (D7c — evidência na ordem).
        expect(fs.readFileSync(`${fx.repo!.dir}/README.md`, "utf8")).toBe("overwrite attempt");
      } finally {
        fx.cleanup();
      }
    });
  });
});
