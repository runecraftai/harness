// guards/config-status.test.ts — GUARD-06: config, status, doctor, sync, kill
// switch e o guardKit (T1/T6).
//
// CLI in-process (mesma lane dos testes F11/F12 — dispatch + fake pi):
//   - doctor check 18 (guards): defaults pass; config inválida → fail apontando
//     o guard; kill switch informativo
//   - status --json seção `guards` (estado por guard + kill switch) — AC 4.1/4.2
//   - sync re-aplica defaults ao state quando a seção `guards` está ausente
//     (AC 4.4, idempotente — rerun = in-sync)
// GuardKit unit (T1): shape do block, kill switch, isolamento por guard (D10),
// congelamento por sessão (D12), logger sem stdout.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, stateFile, writeSettings, type Sandbox } from "../helpers.ts";
import { block, effectiveGuards, guardLog, loadSessionGuards, SessionGuardConfig } from "../../src/guards/guardKit.ts";

function summaryLine(stdout: string): string {
  const line = stdout.split("\n").find((l) => l.startsWith("Resumo:"));
  return line ?? "";
}

function writeState(sb: Sandbox, state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(stateFile(sb)), { recursive: true });
  fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));
}

/** State global mínimo (schema F13) com a seção guards opcional. */
function minimalState(guards?: unknown): Record<string, unknown> {
  return { schemaVersion: 1, scope: "global", components: {}, ...(guards !== undefined ? { guards } : {}) };
}

describe("guardKit — unit (T1)", () => {
  test("block() devolve o shape exato do Pi com reason `<guardId>: <mensagem>` (D3)", () => {
    // D3: o prefixo é o nome kebab do guard (o que a LLM vê e o F23 normaliza),
    // não o id camelCase da config (D2).
    expect(block("writeExistingFile", "mensagem")).toEqual({ block: true, reason: "write-existing-file-guard: mensagem" });
    expect(block("rangerMdOnly", "x").reason).toMatch(/^ranger-md-only: x$/);
    expect(block("todoDescriptionOverride", "x").reason).toMatch(/^todo-description-override: x$/);
    expect(block("todoContinuationEnforcer", "x").reason).toMatch(/^todo-continuation-enforcer: x$/);
  });

  test("kill switch RUNECRAFT_GUARDS=0|false|off desliga a config da sessão (F20)", () => {
    const off = loadSessionGuards(fs.mkdtempSync(path.join(process.env.HOME ?? "/tmp", "gs-")), { RUNECRAFT_GUARDS: "0" });
    expect(off.killSwitch).toBe(true);
    for (const id of ["writeExistingFile", "rangerMdOnly", "todoDescriptionOverride", "todoContinuationEnforcer"] as const) {
      expect(off.guards[id]!.enabled).toBe(true); // enabled no state — quem desliga é o kill switch no registry
    }
    expect(loadSessionGuards("/tmp", { RUNECRAFT_GUARDS: "false" }).killSwitch).toBe(true);
    expect(loadSessionGuards("/tmp", { RUNECRAFT_GUARDS: "OFF" }).killSwitch).toBe(true);
    expect(loadSessionGuards("/tmp", { RUNECRAFT_GUARDS: "1" }).killSwitch).toBe(false);
    expect(loadSessionGuards("/tmp", {}).killSwitch).toBe(false);
  });

  test("isolamento por guard (D10): config inválida de UM guard não desliga os outros", () => {
    const merged = effectiveGuards(
      {
        rangerMdOnly: { enabled: "nao-boolean" }, // inválida
        todoContinuationEnforcer: { enabled: false }, // válida e desligada
      },
      undefined,
      {},
    );
    const ranger = merged.guards.rangerMdOnly;
    expect(ranger.valid).toBe(false);
    expect(ranger.enabled).toBe(true); // fail-closed: continua LIGADO (bloqueia)
    expect(merged.problems.some((p) => p.includes("rangerMdOnly"))).toBe(true);
    expect(merged.guards.todoContinuationEnforcer!.valid).toBe(true);
    expect(merged.guards.todoContinuationEnforcer!.enabled).toBe(false);
    expect(merged.guards.writeExistingFile!.valid).toBe(true);
    expect(merged.guards.writeExistingFile!.enabled).toBe(true);
  });

  test("config inválida do write guard → fail-closed sem allow/force", () => {
    const merged = effectiveGuards({ writeExistingFile: { enabled: true, options: { force: "sim" } } }, undefined, {});
    const w = merged.guards.writeExistingFile;
    expect(w.valid).toBe(false);
    expect((w.options as { allow: string[]; force: boolean }).force).toBe(false);
  });

  test("congelamento por sessão (D12): config do session_start vale durante a sessão", () => {
    const dir = fs.mkdtempSync(path.join(process.env.HOME ?? "/tmp", "freeze-"));
    try {
      const stateDir = path.join(dir, ".runecraft");
      fs.mkdirSync(stateDir, { recursive: true });
      const file = path.join(stateDir, "state.json");
      const writeGuards = (guards: unknown): void => {
        fs.writeFileSync(file, JSON.stringify(minimalState(guards), null, 2));
      };

      writeGuards({ writeExistingFile: { enabled: false } });
      const session = new SessionGuardConfig({});
      session.capture(dir);
      expect(session.frozen(dir).guards.writeExistingFile!.enabled).toBe(false);

      // Mudança de config NO MEIO da sessão → ignorada (sem drift mid-turn).
      writeGuards({ writeExistingFile: { enabled: true } });
      expect(session.frozen(dir).guards.writeExistingFile!.enabled).toBe(false);

      // Novo session_start → recaptura.
      session.capture(dir);
      expect(session.frozen(dir).guards.writeExistingFile!.enabled).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("logger dedicado: escreve em stderr, nunca em stdout (regra do guild)", () => {
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const fakeOut = (chunk: string | Uint8Array): boolean => {
      outChunks.push(String(chunk));
      return true;
    };
    const fakeErr = (chunk: string | Uint8Array): boolean => {
      errChunks.push(String(chunk));
      return true;
    };
    (process.stdout as unknown as { write: typeof originalOut }).write = fakeOut as typeof originalOut;
    (process.stderr as unknown as { write: typeof originalErr }).write = fakeErr as typeof originalErr;
    try {
      guardLog.warn("config problem");
      guardLog.debug("silent by default");
      expect(errChunks.some((c) => c.includes("[runecraft:guards]"))).toBe(true);
      expect(errChunks.some((c) => c.includes("config problem"))).toBe(true);
      expect(outChunks.length).toBe(0); // nada vaza para stdout da sessão
    } finally {
      (process.stdout as unknown as { write: typeof originalOut }).write = originalOut;
      (process.stderr as unknown as { write: typeof originalErr }).write = originalErr;
    }
  });
});

describe("doctor — check 18 Guards (GUARD-06 AC 4.1/4.3)", () => {
  test("defaults (sem config) → pass listando os guards ligados e o ranger inerte", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []); // check 2 exige settings.json global válido
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[18] Guards");
      expect(result.stdout).toContain("writeExistingFile (enabled");
      expect(result.stdout).toContain("rangerMdOnly (enabled");
      expect(result.stdout).toContain("mdOnlyAgents: []");
      expect(result.stdout).toContain("kill switch RUNECRAFT_GUARDS off");
    } finally {
      sb.cleanup();
    }
  });

  test("config inválida de um guard → fail apontando o guard (D10; os demais seguem)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      writeState(sb, minimalState({ rangerMdOnly: { enabled: "sim" } }));
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[18] Guards");
      expect(result.stdout).toContain("rangerMdOnly");
      expect(result.stdout).toContain("esperado boolean");
      expect(result.stdout).toContain("fail-closed");
      expect(summaryLine(result.stdout)).toContain("fail 1");
    } finally {
      sb.cleanup();
    }
  });

  test("kill switch ativo → pass informativo", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      sb.env.RUNECRAFT_GUARDS = "0";
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("kill switch RUNECRAFT_GUARDS=0 ATIVO");
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — seção guards (GUARD-06 AC 4.2)", () => {
  test("status --json inclui `guards` (estado por guard + kill switch)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      writeState(sb, minimalState({
        writeExistingFile: { enabled: false },
        rangerMdOnly: { enabled: true, options: { mdOnlyAgents: ["auditor"] } },
      }));
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        guards: {
          killSwitch: boolean;
          killSwitchValue: string | null;
          guards: Array<{ id: string; enabled: boolean; valid: boolean; mdOnlyAgents?: string[]; source: string }>;
        };
      };
      expect(json.guards.killSwitch).toBe(false);
      const byId = new Map(json.guards.guards.map((g) => [g.id, g]));
      expect(byId.get("writeExistingFile")!.enabled).toBe(false);
      expect(byId.get("writeExistingFile")!.valid).toBe(true);
      expect(byId.get("rangerMdOnly")!.mdOnlyAgents).toEqual(["auditor"]);
      expect(byId.get("todoContinuationEnforcer")!.enabled).toBe(true); // default
      expect(byId.get("writeExistingFile")!.source).toBe("global"); // sandbox global
    } finally {
      sb.cleanup();
    }
  });

  test("status TTY mostra a seção Guards (F24)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Guards (F24):");
      expect(result.stdout).toContain("writeExistingFile");
      expect(result.stdout).toContain("kill switch: RUNECRAFT_GUARDS off");
      expect(result.stdout).toContain("extensão Pi");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — re-aplica o config de guards ao state (GUARD-06 AC 4.4)", () => {
  test("install cria a seção guards (defaults fail-closed) e sync fica in-sync", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const state = readJson(stateFile(sb));
      expect((state.guards as Record<string, unknown>).writeExistingFile).toBeDefined();
      expect((state.guards as Record<string, unknown>).rangerMdOnly).toBeDefined();

      const stateBefore = fs.readFileSync(stateFile(sb), "utf8");
      const sync = await runHarness(sb, ["sync"]);
      expect(sync.code).toBe(0);
      expect(sync.stdout).toContain("already in sync");
      expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore); // zero diff
    } finally {
      sb.cleanup();
    }
  });

  test("state da era pré-F24 (sem guards) → sync re-aplica defaults; rerun in-sync (idempotente)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      // Simula um state antigo: remove a seção guards.
      const state = readJson(stateFile(sb));
      delete (state as Record<string, unknown>).guards;
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const first = await runHarness(sb, ["sync", "--json"]);
      expect(first.code).toBe(0);
      const firstJson = JSON.parse(first.stdout) as { status: string; notes: string[] };
      expect(firstJson.status).toBe("synced");
      expect(firstJson.notes.some((n) => n.includes("guards: defaults fail-closed re-aplicados"))).toBe(true);
      expect((readJson(stateFile(sb)).guards as Record<string, unknown>).writeExistingFile).toBeDefined();

      const second = await runHarness(sb, ["sync", "--json"]);
      const secondJson = JSON.parse(second.stdout) as { status: string };
      expect(secondJson.status).toBe("in-sync"); // rerun = zero mudanças
    } finally {
      sb.cleanup();
    }
  });

  test("config presente (mesmo inválida) NUNCA é reescrita pelo sync (D10 — doctor reporta)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      writeState(sb, minimalState({ writeExistingFile: { enabled: "sim" } }));

      const sync = await runHarness(sb, ["sync", "--json"]);
      expect(sync.code).toBe(0);
      const json = JSON.parse(sync.stdout) as { status: string };
      expect(json.status).toBe("in-sync"); // sync não toca config inválida
      const after = readJson(stateFile(sb));
      expect((after.guards as Record<string, unknown>).writeExistingFile).toEqual({ enabled: "sim" });

      const doctor = await runHarness(sb, ["doctor"]);
      expect(doctor.code).toBe(1); // o doctor reporta a invalidade
      expect(doctor.stdout).toContain("writeExistingFile");
    } finally {
      sb.cleanup();
    }
  });
});
