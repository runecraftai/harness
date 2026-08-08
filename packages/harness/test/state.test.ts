// state.test.ts — F13 state schema: load/save round-trip, additive migration
// (AD-013: schemaVersion 1, seções futuras como `agents` do F17 sobrevivem),
// corrompido preservado (STBK-03) e API usada por F11/F12 intacta.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  makeSandbox,
  readJson,
  stateFile,
  type Sandbox,
} from "./helpers.ts";
import {
  emptyState,
  loadState,
  loadStateReadonly,
  saveState,
  upsertInstalled,
  type HarnessState,
  type SettingsChange,
} from "../src/state.ts";

function validState(scope: "global" | "workspace" = "global"): HarnessState {
  return {
    schemaVersion: 1,
    scope,
    installedAt: "2026-08-05T12:00:00Z",
    components: {
      "@runecraft/subagents": {
        group: "subagents",
        source: "npm:@runecraft/subagents",
        version: "0.37.2",
        installedAt: "2026-08-05T12:00:00Z",
      },
    },
    createdFiles: ["/tmp/fake/.pi/agent/pr-review.json"],
    settingsChanges: [
      { file: "/tmp/fake/.pi/agent/settings.json", path: ["subagents", "watchdog", "main", "model"], value: "claude-sonnet-4" },
    ],
    preInstall: [
      { file: "/tmp/fake/.runecraft/backups/runecraft-20260805-120000-000.tar.gz", hash: "abc123", backup: "runecraft-20260805-120000-000.tar.gz" },
    ],
    agents: {},
  };
}

function corruptFiles(sb: Sandbox): string[] {
  const dir = path.dirname(stateFile(sb));
  return fs.readdirSync(dir).filter((f) => f.startsWith("state.json.corrupt-"));
}

describe("load/save — round-trip do schema (F13)", () => {
  test("arquivo ausente → created, estado vazio com scope", () => {
    const sb = makeSandbox();
    try {
      const result = loadState(stateFile(sb), "global");
      expect(result.created).toBe(true);
      expect(result.corruptPath).toBeUndefined();
      expect(result.state.schemaVersion).toBe(1);
      expect(result.state.scope).toBe("global");
      expect(result.state.components).toEqual({});
      expect(result.state.createdFiles).toEqual([]);
      expect(result.state.settingsChanges).toEqual([]);
      expect(result.state.preInstall).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("state completo carrega com todos os campos tipados", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(validState(), null, 2)}\n`);

      const result = loadState(file, "global");
      expect(result.created).toBe(false);
      const state = result.state;
      expect(state.schemaVersion).toBe(1);
      expect(state.installedAt).toBe("2026-08-05T12:00:00Z");
      expect(state.components["@runecraft/subagents"]?.group).toBe("subagents");
      expect(state.settingsChanges).toHaveLength(1);
      const change = state.settingsChanges[0] as SettingsChange | undefined;
      expect(change?.file).toContain("settings.json");
      expect(change?.path).toEqual(["subagents", "watchdog", "main", "model"]);
      expect(state.preInstall).toHaveLength(1);
      expect(state.createdFiles).toContain("/tmp/fake/.pi/agent/pr-review.json");
    } finally {
      sb.cleanup();
    }
  });

  test("state mínimo da era F11 (sem arrays) carrega com defaults", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: 1,
          scope: "global",
          components: { "@runecraft/subagents": { group: "subagents", source: "npm:@runecraft/subagents", version: "0.37.2" } },
        }),
      );
      const result = loadState(file, "global");
      expect(result.created).toBe(false);
      expect(result.state.createdFiles).toEqual([]);
      expect(result.state.settingsChanges).toEqual([]);
      expect(result.state.preInstall).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("save é atômico e o arquivo volta íntegro", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      const state = validState();
      state.components["@runecraft/pr-review"] = {
        group: "pr-review",
        source: "npm:@runecraft/pr-review",
        version: "1.11.4",
        installedAt: "2026-08-05T12:00:00Z",
      };
      saveState(file, state);
      const onDisk = readJson(file);
      expect(onDisk.schemaVersion).toBe(1);
      expect(Object.keys(onDisk.components as Record<string, unknown>)).toHaveLength(2);
      expect(onDisk.settingsChanges).toHaveLength(1);
    } finally {
      sb.cleanup();
    }
  });
});

describe("migração aditiva (AD-013: schemaVersion 1, sem bump)", () => {
  test("seção `guards` (F24) sobrevive a load→save e o schema não bumpa", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const guards = { writeExistingFile: { enabled: false }, rangerMdOnly: { enabled: true, options: { mdOnlyAgents: ["auditor"] } } };
      fs.writeFileSync(file, `${JSON.stringify({ ...validState(), guards }, null, 2)}\n`);

      const loaded = loadState(file, "global");
      expect(loaded.state.schemaVersion).toBe(1);
      expect((loaded.state as unknown as { guards: unknown }).guards).toEqual(guards);

      // Round-trip: a seção sobrevive à escrita (aditiva — nada é dropado).
      saveState(file, loaded.state);
      const onDisk = readJson(file);
      expect(onDisk.schemaVersion).toBe(1);
      expect(onDisk.guards).toEqual(guards);
    } finally {
      sb.cleanup();
    }
  });

  test("estado vazio (F24) já declara os guards ligados (fail-closed por padrão — D10)", () => {
    const sb = makeSandbox();
    try {
      const result = loadState(stateFile(sb), "global");
      expect(result.created).toBe(true);
      const guards = (result.state as unknown as { guards: Record<string, unknown> }).guards;
      expect(guards.writeExistingFile).toEqual({ enabled: true });
      // F32 (D7): o papel auditor é registrado por default na lista md-only.
      expect(guards.rangerMdOnly).toEqual({ enabled: true, options: { mdOnlyAgents: ["auditor"] } });
      expect(guards.todoDescriptionOverride).toEqual({ enabled: true });
      expect(guards.todoContinuationEnforcer).toEqual({ enabled: true });
    } finally {
      sb.cleanup();
    }
  });

  test("seção futura `agents` (F17) sobrevive a load→save e o schema não bumpa", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const agents = {
        claude: { targets: [{ file: "AGENTS.md", contentHash: "sha256:xyz" }] },
      };
      fs.writeFileSync(file, `${JSON.stringify({ ...validState(), agents }, null, 2)}\n`);

      const loaded = loadState(file, "global");
      expect(loaded.created).toBe(false);
      expect(loaded.state.schemaVersion).toBe(1);
      // chave desconhecida preservada no objeto em memória
      expect((loaded.state as unknown as { agents: unknown }).agents).toEqual(agents);

      saveState(file, loaded.state);
      const onDisk = readJson(file);
      expect(onDisk.schemaVersion).toBe(1);
      expect(onDisk.agents).toEqual(agents);
      expect(onDisk.components).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });

  test("scope ausente no arquivo → scope do argumento", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: 1,
          components: { "@runecraft/subagents": { group: "subagents", source: "npm:@runecraft/subagents", version: "0.37.2" } },
        }),
      );
      expect(loadState(file, "workspace").state.scope).toBe("workspace");
    } finally {
      sb.cleanup();
    }
  });
});

describe("corrompido preservado (STBK-03)", () => {
  test("JSON inválido → movido para .corrupt-<ts> com o conteúdo original; state recomeça", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{ broken json", "utf8");

      const result = loadState(file, "global");
      expect(result.created).toBe(true);
      expect(result.corruptPath).toBeDefined();
      expect(result.corruptPath).not.toBe(file);

      // arquivo original preservado (nunca sobrescrito sem backup)
      const moved = result.corruptPath as string;
      expect(fs.existsSync(moved)).toBe(true);
      expect(fs.readFileSync(moved, "utf8")).toBe("{ broken json");
      expect(fs.existsSync(file)).toBe(false);
      expect(result.state.components).toEqual({});
    } finally {
      sb.cleanup();
    }
  });

  test("schemaVersion diferente → tratado como corrompido, preservado", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, components: {} }));
      const result = loadState(file, "global");
      expect(result.corruptPath).toBeDefined();
      expect(fs.existsSync(result.corruptPath as string)).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("loadStateReadonly (doctor) não move o arquivo corrompido", () => {
    const sb = makeSandbox();
    try {
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{ broken", "utf8");

      const result = loadStateReadonly(file, "global");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("corrupt");
        expect(result.file).toBe(file);
      }
      // arquivo intocado: nada foi movido/alterado (LIFE-01)
      expect(fs.readFileSync(file, "utf8")).toBe("{ broken");
      expect(corruptFiles(sb)).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });
});

describe("upsert por package (STBK-01)", () => {
  test("upsertInstalled cria e atualiza apenas a entry afetada", () => {
    const state = emptyState("global");
    upsertInstalled(state, { name: "@runecraft/subagents", group: "subagents", source: "npm:@runecraft/subagents", version: "0.37.2" });
    upsertInstalled(state, { name: "@runecraft/taskflow-core", group: "taskflow", source: "npm:@runecraft/taskflow-core", version: "0.2.6" });

    expect(Object.keys(state.components)).toHaveLength(2);
    expect(state.components["@runecraft/taskflow-core"]?.group).toBe("taskflow");

    // atualização afeta só a entry tocada
    upsertInstalled(state, { name: "@runecraft/taskflow-core", group: "taskflow", source: "npm:@runecraft/taskflow-core", version: "0.3.0" });
    expect(state.components["@runecraft/taskflow-core"]?.version).toBe("0.3.0");
    expect(state.components["@runecraft/subagents"]?.version).toBe("0.37.2");
  });
});
