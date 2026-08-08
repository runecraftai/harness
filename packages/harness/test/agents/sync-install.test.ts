// agents/sync-install.test.ts — F32 T5 (ROLE-01): alvo agents no install/sync.
//
// CLI integration (dispatch in-process + fake pi — padrão F21 camada 1):
// 1ª instalação workspace materializa os 7 papéis em <cwd>/.pi/agents/
// (byte-idênticos aos assets do pacote) e registra `piAgents` no state com
// contentHash (F13); 2º sync idempotente (zero writes — LIFE 3.2); edição do
// usuário → "preservado (editado)" e NUNCA reescrita (F19 D7); dir ausente →
// criado (mkdir recursivo); escopo global → repo-scoped (sem alvos no cwd);
// regressão: targets existentes (rules/mcp) intocados.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, type Sandbox } from "../helpers.ts";
import { roleAssetsDir, roleAgentsDir } from "../../src/agents/materialize.ts";
import { ROLE_IDS } from "../../src/agents/catalog.ts";

const ASSETS = roleAssetsDir();

function readWorkspaceState(sb: Sandbox, cwd: string): Record<string, unknown> {
  const file = path.join(cwd, ".runecraft", "state.json");
  return fs.existsSync(file) ? (readJson(file) as Record<string, unknown>) : {};
}

describe("install — alvo agents (F32 T5)", () => {
  test("install workspace: 7 papéis byte-idênticos em .pi/agents/ + registros no state", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      const result = await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);

      const dir = roleAgentsDir(project);
      expect(fs.existsSync(dir)).toBe(true); // dir ausente → criado (mkdir recursivo)
      for (const id of ROLE_IDS) {
        const target = path.join(dir, `${id}.md`);
        expect(fs.existsSync(target), `${id}.md ausente`).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(ASSETS, `${id}.md`), "utf8"));
      }
      // registros no state com contentHash (F13).
      const state = readWorkspaceState(sb, project);
      const piAgents = (state.piAgents ?? {}) as Record<string, { contentHash: string; assetVersion: string }>;
      expect(Object.keys(piAgents).sort()).toEqual([...ROLE_IDS].sort());
      for (const id of ROLE_IDS) {
        expect(piAgents[id]?.contentHash.length).toBe(64);
        expect(piAgents[id]?.assetVersion).toBe("1");
      }
      expect(result.stdout).toContain("papéis objetivos materializados");
    } finally {
      sb.cleanup();
    }
  });

  test("install global: repo-scoped — sem alvos no cwd", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install"]);
      expect(result.code).toBe(0);
      expect(fs.existsSync(roleAgentsDir(sb.dir))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("install não regride targets existentes (rules/mcp do estado global intactos)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const stateBefore = fs.readFileSync(path.join(sb.runecraftHome, "state.json"), "utf8");
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      // state global intocado (os papéis vivem no state do WORKSPACE).
      expect(fs.readFileSync(path.join(sb.runecraftHome, "state.json"), "utf8")).toBe(stateBefore);
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — three-way por conteúdo (F32 T5 / F19 D7)", () => {
  test("2º sync idempotente: already in sync, zero writes", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      const stateBefore = fs.readFileSync(path.join(project, ".runecraft", "state.json"), "utf8");
      const backupsBefore = fs.existsSync(path.join(sb.runecraftHome, "backups"))
        ? fs.readdirSync(path.join(sb.runecraftHome, "backups")).sort()
        : [];

      const first = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(first.code).toBe(0);
      expect(first.stdout).toContain("already in sync");
      expect(first.stdout).not.toContain("papéis objetivos materializados");
      expect(fs.readFileSync(path.join(project, ".runecraft", "state.json"), "utf8")).toBe(stateBefore);
      const backupsAfter = fs.existsSync(path.join(sb.runecraftHome, "backups"))
        ? fs.readdirSync(path.join(sb.runecraftHome, "backups")).sort()
        : [];
      expect(backupsAfter).toEqual(backupsBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("edição do usuário → preservado (editado) e NUNCA reescrita", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      // Usuário edita planner.md.
      const target = path.join(roleAgentsDir(project), "planner.md");
      const userEdit = "---\nname: planner\n---\nmeu plano local\n";
      fs.writeFileSync(target, userEdit, "utf8");

      const result = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("planner: preservado (editado");
      expect(fs.readFileSync(target, "utf8")).toBe(userEdit); // nunca auto-cura

      // Re-run continua preservando (o registro antigo permanece).
      const again = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(again.code).toBe(0);
      expect(fs.readFileSync(target, "utf8")).toBe(userEdit);
    } finally {
      sb.cleanup();
    }
  });

  test("papel deletado à mão → sync re-injeta (missing → copia)", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      fs.rmSync(path.join(roleAgentsDir(project), "scout.md"));

      const result = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("scout: re-injetado");
      expect(fs.readFileSync(path.join(roleAgentsDir(project), "scout.md"), "utf8")).toBe(
        fs.readFileSync(path.join(ASSETS, "scout.md"), "utf8"),
      );
    } finally {
      sb.cleanup();
    }
  });

  test("status --json: seção roleAgents (instalados/preservados/registrados) + fork presente", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      // Edita um papel → preservado.
      fs.writeFileSync(path.join(roleAgentsDir(project), "planner.md"), "---\nname: planner\n---\neditado\n", "utf8");

      const result = await runHarness(sb, ["status", "--json", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        roleAgents: { forkPresent: boolean; installed: string[]; preserved: string[]; missing: string[]; registered: string[]; total: number };
      };
      expect(json.roleAgents.forkPresent).toBe(true);
      expect(json.roleAgents.installed).toHaveLength(6);
      expect(json.roleAgents.preserved).toEqual(["planner"]);
      expect(json.roleAgents.missing).toEqual([]);
      expect(json.roleAgents.registered.sort()).toEqual([...ROLE_IDS].sort());
      expect(json.roleAgents.total).toBe(7);
    } finally {
      sb.cleanup();
    }
  });
});
