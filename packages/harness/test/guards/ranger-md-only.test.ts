// guards/ranger-md-only.test.ts — GUARD-03 (F24, D5).
//
// (a) unit: `.ts` bloqueia para agente da lista; `.md`/`.MD`/`.Markdown`
//     passam (case-insensitive — edge da spec); agente fora da lista passa;
//     lista vazia (default v1) → inerte (D5); config inválida → fail-closed
//     (todo agente md-only — D10); sem extensão → bloqueia (só .md é .md).
// (b) integração com fixture: agente `ranger` (RUNECRAFT_AGENT_ID) na lista
//     → write `.ts` bloqueado e `.md` passa no loop REAL do Pi.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { setupEvalFixture, type EvalFixture } from "../eval/helpers/evalFixture.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";
import { script, type ScriptedScenario } from "../eval/layer2/fixture/scenarios.ts";
import { decideRangerMdOnly, currentAgentId } from "../../src/guards/ranger-md-only.ts";
import type { GuardRuntime } from "../../src/guards/guardKit.ts";

function runtime(agents: string[], opts: Partial<GuardRuntime> = {}): GuardRuntime {
  return {
    id: "rangerMdOnly",
    enabled: true,
    valid: true,
    options: { mdOnlyAgents: agents },
    source: "default",
    ...opts,
  };
}

describe("ranger-md-only — unit (evento fake)", () => {
  test("agente da lista + extensão ≠ .md → block com reason citando a regra (AC 2.1)", () => {
    const decision = decideRangerMdOnly(runtime(["ranger"]), "ranger", "src/feature.ts");
    expect(decision).toBeDefined();
    expect(decision!.reason.startsWith("ranger-md-only: ")).toBe(true);
    expect(decision!.reason).toContain("ranger");
    expect(decision!.reason).toContain(".md");
  });

  test("agente fora da lista → passa (AC 2.2)", () => {
    expect(decideRangerMdOnly(runtime(["ranger"]), "main", "src/feature.ts")).toBeUndefined();
    expect(decideRangerMdOnly(runtime(["auditor"]), "ranger", "src/feature.ts")).toBeUndefined();
  });

  test(".md / .MD / .Markdown → passam (AC 2.3 — case-insensitive)", () => {
    for (const p of ["docs/plan.md", "docs/PLAN.MD", "docs/plan.Markdown", "docs/plan.markdown"]) {
      expect(decideRangerMdOnly(runtime(["ranger"]), "ranger", p)).toBeUndefined();
    }
  });

  test("lista vazia (default v1) → inerte mesmo com agente md-only (AC 2.4/D5)", () => {
    expect(decideRangerMdOnly(runtime([]), "ranger", "src/feature.ts")).toBeUndefined();
  });

  test("sem extensão → bloqueia (só .md é .md — original do guild)", () => {
    expect(decideRangerMdOnly(runtime(["ranger"]), "ranger", "Makefile")).toBeDefined();
    expect(decideRangerMdOnly(runtime(["ranger"]), "ranger", "docs/README")).toBeDefined();
  });

  test("config inválida → fail-closed: todo agente tratado como md-only (D10)", () => {
    const cfg = runtime([], { valid: false });
    expect(decideRangerMdOnly(cfg, "main", "src/feature.ts")).toBeDefined();
    // .md continua passando (a política permanece md-only, não bloqueio total).
    expect(decideRangerMdOnly(cfg, "main", "docs/plan.md")).toBeUndefined();
  });

  test("guard disabled → não intervém (AC 3.4 aplicado ao ranger)", () => {
    expect(decideRangerMdOnly(runtime(["ranger"], { enabled: false }), "ranger", "src/feature.ts")).toBeUndefined();
  });

  test("currentAgentId: RUNECRAFT_AGENT_ID ausente → main; presente → valor", () => {
    expect(currentAgentId({})).toBe("main");
    expect(currentAgentId({ RUNECRAFT_AGENT_ID: "ranger" })).toBe("ranger");
    expect(currentAgentId({ RUNECRAFT_AGENT_ID: "  auditor  " })).toBe("auditor");
  });
});

describe("ranger-md-only — integração com fixture (agente md-only real)", () => {
  test("agente ranger na lista: write .ts bloqueado; write .md passa", async () => {
    await evalTest("agente ranger na lista: write .ts bloqueado; write .md passa", async () => {
      const scenario: ScriptedScenario = {
        id: "F24-ranger",
        description: "agente ranger md-only: .ts bloqueado, .md passa (não é fluxo da matriz)",
        ...script([
          { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "src/feature.ts", content: "const x = 1" } } },
          {
            expect: { toolsSubset: ["write"], conversationContains: ["ranger-md-only"] },
            reply: { kind: "tool", name: "write", args: { path: "docs/plan.md", content: "# plan" } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
      };
      const prev = process.env.RUNECRAFT_AGENT_ID;
      process.env.RUNECRAFT_AGENT_ID = "ranger";
      try {
        const fx: EvalFixture = await setupEvalFixture({
          scenario,
          withRepo: true,
          beforeSession: ({ repoDir }) => {
            const stateDir = fs.mkdirSync(`${repoDir}/.runecraft`, { recursive: true });
            fs.writeFileSync(
              `${stateDir}/state.json`,
              JSON.stringify({
                schemaVersion: 1,
                scope: "workspace",
                components: {},
                guards: { rangerMdOnly: { enabled: true, options: { mdOnlyAgents: ["ranger"] } } },
              }),
            );
          },
        });
        try {
          await fx.session.session.prompt("Write src/feature.ts, then docs/plan.md.");
          // .ts bloqueado: o arquivo NÃO existe no repo.
          expect(fs.existsSync(`${fx.repo!.dir}/src/feature.ts`)).toBe(false);
          // .md passou e foi escrito de verdade.
          expect(fs.readFileSync(`${fx.repo!.dir}/docs/plan.md`, "utf8")).toBe("# plan");
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (prev === undefined) delete process.env.RUNECRAFT_AGENT_ID;
        else process.env.RUNECRAFT_AGENT_ID = prev;
      }
    });
  });

  test("lista vazia (default): agente ranger NÃO bloqueia .ts (inerte — D5)", async () => {
    await evalTest("lista vazia (default): agente ranger NÃO bloqueia .ts (inerte — D5)", async () => {
      const scenario: ScriptedScenario = {
        id: "F24-ranger-inert",
        description: "mdOnlyAgents vazio → inerte (não é fluxo da matriz)",
        ...script([
          { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "src/feature.ts", content: "const x = 1" } } },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
      };
      const prev = process.env.RUNECRAFT_AGENT_ID;
      process.env.RUNECRAFT_AGENT_ID = "ranger";
      try {
        const fx: EvalFixture = await setupEvalFixture({ scenario, withRepo: true });
        try {
          await fx.session.session.prompt("Write src/feature.ts.");
          expect(fs.readFileSync(`${fx.repo!.dir}/src/feature.ts`, "utf8")).toBe("const x = 1");
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (prev === undefined) delete process.env.RUNECRAFT_AGENT_ID;
        else process.env.RUNECRAFT_AGENT_ID = prev;
      }
    });
  });
});
