// guards/write-guard.test.ts — EVAL-006: write-existing-file-guard (GUARD-01/02).
//
// (a) unit por módulo (evento fake — decidir sobre paths reais em tmp): existe
//     bloqueia, novo passa, allow/force passam, symlink→existente bloqueia,
//     reason com prefixo do guard + path relativo (D3 — nunca absoluto);
// (b) integração na infra do F21 (camada 2): sessão Pi REAL com o fixture
//     OpenAI-wire — o script induz write sobre README.md (existe) → o tool é
//     BLOQUEADO de verdade (transcript com o reason, arquivo intacto); com
//     allow/force e com kill switch (RUNECRAFT_GUARDS=0) → passa.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setupEvalFixture, type EvalFixture } from "../eval/helpers/evalFixture.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";
import { EVAL_006 } from "../eval/layer2/fixture/scenarios.ts";
import { script, type ScriptedScenario } from "../eval/layer2/fixture/scenarios.ts";
import { decideWriteGuard, resolveWriteTarget } from "../../src/guards/write-existing-file-guard.ts";
import { loadSessionGuards, type GuardRuntime } from "../../src/guards/guardKit.ts";

function runtime(cfg: Partial<GuardRuntime> = {}): GuardRuntime {
  return {
    id: "writeExistingFile",
    enabled: true,
    valid: true,
    options: { allow: [], force: false },
    source: "default",
    ...cfg,
  };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guards-write-"));
}

/** State.json mínimo com a seção guards (para o loadSessionGuards da integração). */
function writeGuardsState(dir: string, guards: unknown): string {
  const stateDir = path.join(dir, ".runecraft");
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "state.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, guards }, null, 2));
  return file;
}

describe("write-existing-file-guard — unit (evento fake, paths reais em tmp)", () => {
  test("write sobre arquivo existente → block com reason `<guardId>: ...` e path relativo (D3)", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
      const decision = decideWriteGuard(runtime(), dir, "existing.txt");
      expect(decision).toBeDefined();
      expect(decision!.block).toBe(true);
      expect(decision!.reason.startsWith("write-existing-file-guard: ")).toBe(true);
      expect(decision!.reason).toContain("existing.txt");
      // D3: o reason nunca contém o path absoluto do runner.
      expect(decision!.reason).not.toContain(dir);
      expect(decision!.reason).not.toContain(os.tmpdir());
      expect(decision!.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/); // sem timestamp
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("write em path novo → passa (AC 1.3)", () => {
    const dir = makeTmp();
    try {
      const decision = decideWriteGuard(runtime(), dir, "new-file.txt");
      expect(decision).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("write em subdir inexistente → passa (criação recursiva é do tool)", () => {
    const dir = makeTmp();
    try {
      const decision = decideWriteGuard(runtime(), dir, "a/b/c.txt");
      expect(decision).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("allow com o path relativo → passa (AC 1.2)", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
      const decision = decideWriteGuard(runtime({ options: { allow: ["existing.txt"], force: false } }), dir, "existing.txt");
      expect(decision).toBeUndefined();
      // allow é seletivo: outro path existente continua bloqueado.
      fs.writeFileSync(path.join(dir, "other.txt"), "x");
      const blocked = decideWriteGuard(runtime({ options: { allow: ["existing.txt"], force: false } }), dir, "other.txt");
      expect(blocked).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("force → passa qualquer sobrescrita (AC 1.2)", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
      const decision = decideWriteGuard(runtime({ options: { allow: [], force: true } }), dir, "existing.txt");
      expect(decision).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("symlink para alvo existente → bloqueia (edge da spec — sem bypass)", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "real-target.txt"), "keep me");
      fs.symlinkSync(path.join(dir, "real-target.txt"), path.join(dir, "link.txt"));
      const decision = decideWriteGuard(runtime(), dir, "link.txt");
      expect(decision).toBeDefined();
      expect(decision!.reason).toContain("link.txt");
      // O alvo resolvido é o real (realpath).
      expect(resolveWriteTarget(dir, "link.txt").absolute).toBe(path.join(dir, "real-target.txt"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("symlink quebrado → passa (o write falharia no tool de qualquer forma)", () => {
    const dir = makeTmp();
    try {
      fs.symlinkSync(path.join(dir, "ghost.txt"), path.join(dir, "broken.txt"));
      const decision = decideWriteGuard(runtime(), dir, "broken.txt");
      expect(decision).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("config inválida → fail-closed: bloqueia existente sem allow/force (D10)", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
      const cfg = runtime({ valid: false, options: { allow: ["existing.txt"], force: true } });
      const decision = decideWriteGuard(cfg, dir, "existing.txt");
      expect(decision).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kill switch RUNECRAFT_GUARDS=0 → guard disabled na config da sessão (AC 1.4)", () => {
    const dir = makeTmp();
    try {
      const session = loadSessionGuards(dir, { ...process.env, RUNECRAFT_GUARDS: "0" });
      expect(session.killSwitch).toBe(true);
      expect(session.guards.writeExistingFile.enabled).toBe(true); // enabled no state
      // O registry desliga tudo via kill switch (testado no config-status); aqui
      // só a leitura da config.
      expect(session.killSwitchValue).toBe("0");
      const sessionOff = loadSessionGuards(dir, { ...process.env, RUNECRAFT_GUARDS: "false" });
      expect(sessionOff.killSwitch).toBe(true);
      const sessionOn = loadSessionGuards(dir, { ...process.env, RUNECRAFT_GUARDS: "1" });
      expect(sessionOn.killSwitch).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EVAL-006 — write bloqueado de verdade no loop do Pi (camada 2)", () => {
  test("EVAL-006: write sobre existente bloqueado com reason; write novo passa; alvo intacto", async () => {
    await evalTest("EVAL-006: write sobre existente bloqueado com reason; write novo passa; alvo intacto", async () => {
      const fx: EvalFixture = await setupEvalFixture({ scenario: EVAL_006, withRepo: true });
      try {
        const repoDir = fx.repo!.dir;
        const readme = path.join(repoDir, "README.md");
        const readmeBefore = fs.readFileSync(readme, "utf8");
        expect(readmeBefore).toBe("# eval repo\n");

        await fx.session.session.prompt("Update the repository: overwrite README.md, then create notes.txt.");

        // O transcript registra o reason do bloqueio (D7c — o próprio fixture
        // validou via conversationContains no passo 2; aqui a prova explícita).
        const conversations = fx.server.seen.map((s) => s.conversationText).join("\n");
        expect(conversations).toContain("write-existing-file-guard:");
        // D3/golden: reason com o guard + path RELATIVO (sem path absoluto do runner).
        expect(conversations).toContain("write-existing-file-guard: write blocked — target already exists: README.md");
        const markerIndex = conversations.indexOf("write-existing-file-guard:");
        const reasonSnippet = conversations.slice(markerIndex, markerIndex + 200);
        expect(reasonSnippet).not.toContain(repoDir);
        expect(reasonSnippet).not.toContain(os.tmpdir());

        // Efeito real: o arquivo existente NÃO foi tocado (bloqueio REAL).
        expect(fs.readFileSync(readme, "utf8")).toBe(readmeBefore);
        // O write novo passou e foi executado de verdade (AC 1.3).
        expect(fs.readFileSync(path.join(repoDir, "notes.txt"), "utf8")).toBe("fresh content");

        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-006" });
  });

  test("EVAL-006 (allow/force): config `force` → a sobrescrita passa (AC 1.2)", async () => {
    await evalTest("EVAL-006 (allow/force): config `force` → a sobrescrita passa (AC 1.2)", async () => {
      const passThrough: ScriptedScenario = {
        id: "F24-write-force",
        description: "write sobre existente com force → passa (não é fluxo da matriz)",
        ...script([
          { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "README.md", content: "overwrite attempt" } } },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
      };
      const fx: EvalFixture = await setupEvalFixture({
        scenario: passThrough,
        withRepo: true,
        beforeSession: ({ repoDir }) => {
          writeGuardsState(repoDir, { writeExistingFile: { enabled: true, options: { allow: [], force: true } } });
        },
      });
      try {
        await fx.session.session.prompt("Overwrite README.md, then stop.");
        // force → o write executou de verdade: o conteúdo mudou.
        expect(fs.readFileSync(path.join(fx.repo!.dir, "README.md"), "utf8")).toBe("overwrite attempt");
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });
  });

  test("EVAL-006 (kill switch): RUNECRAFT_GUARDS=0 → a sobrescrita passa (AC 1.4)", async () => {
    await evalTest("EVAL-006 (kill switch): RUNECRAFT_GUARDS=0 → a sobrescrita passa (AC 1.4)", async () => {
      const passThrough: ScriptedScenario = {
        id: "F24-write-killswitch",
        description: "write sobre existente com kill switch → passa (não é fluxo da matriz)",
        ...script([
          { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "README.md", content: "overwrite attempt" } } },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
      };
      const prev = process.env.RUNECRAFT_GUARDS;
      process.env.RUNECRAFT_GUARDS = "0";
      try {
        const fx: EvalFixture = await setupEvalFixture({ scenario: passThrough, withRepo: true });
        try {
          await fx.session.session.prompt("Overwrite README.md, then stop.");
          expect(fs.readFileSync(path.join(fx.repo!.dir, "README.md"), "utf8")).toBe("overwrite attempt");
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (prev === undefined) delete process.env.RUNECRAFT_GUARDS;
        else process.env.RUNECRAFT_GUARDS = prev;
      }
    });
  });
});
