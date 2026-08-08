// agents/materialize.test.ts — F32 T5 (ROLE-01): materialização dos papéis
// objetivos (three-way F19 D7 + contentHash F13) em .pi/agents/.
//
// Unit com root de pacote FAKE (assets copiados p/ tmp — injetável): 1ª
// instalação copia byte-idêntico; 2ª idempotente (zero writes); edição do
// usuário → preservada (nunca reescrita); template mudou (vN→vM) → updated
// (arquivo == registrado); adoção (arquivo == asset sem registro); estado
// final registrado com contentHash (F13).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planRoleAgents,
  applyRoleAgents,
  roleAgentsDir,
  roleAssetsDir,
  contentHash,
  ROLE_ASSETS_VERSION,
  type RoleAgentRecord,
} from "../../src/agents/materialize.ts";
import { ROLE_IDS } from "../../src/agents/catalog.ts";

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "f32-materialize-"));
}

/** Root de pacote fake com os 7 assets reais (byte-idênticos). */
function fakePackageRoot(base: string): string {
  const agentsDir = path.join(base, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const id of ROLE_IDS) {
    fs.copyFileSync(path.join(roleAssetsDir(REAL_ROOT), `${id}.md`), path.join(agentsDir, `${id}.md`));
  }
  return base;
}

function emptyRecords(): Record<string, RoleAgentRecord> {
  return {};
}

describe("planRoleAgents — three-way por conteúdo (F19 D7)", () => {
  test("sem .pi/agents → 7 missing (re-inject); apply copia byte-idêntico", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    fs.mkdirSync(cwd, { recursive: true });

    const plans = planRoleAgents(cwd, undefined, root);
    expect(plans.map((p) => p.roleId)).toEqual([...ROLE_IDS]);
    expect(plans.every((p) => p.status === "missing")).toBe(true);

    const records = emptyRecords();
    const result = applyRoleAgents(cwd, records, plans, root);
    expect(result.copied).toHaveLength(7);
    expect(result.changed).toBe(true);

    const dir = roleAgentsDir(cwd);
    for (const id of [...ROLE_IDS]) {
      const target = path.join(dir, `${id}.md`);
      expect(fs.existsSync(target)).toBe(true);
      // byte-idêntico ao asset (AC 1.1)
      expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(roleAssetsDir(root), `${id}.md`), "utf8"));
      expect(records[id]?.contentHash).toBe(contentHash(fs.readFileSync(target, "utf8")));
      expect(records[id]?.assetVersion).toBe(ROLE_ASSETS_VERSION);
    }
  });

  test("2º sync idempotente: tudo in-sync, zero writes (LIFE 3.2)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    fs.mkdirSync(cwd, { recursive: true });
    const records = emptyRecords();
    applyRoleAgents(cwd, records, planRoleAgents(cwd, undefined, root), root);

    const plans2 = planRoleAgents(cwd, records, root);
    expect(plans2.every((p) => p.status === "in-sync")).toBe(true);
    const before = fs.readFileSync(path.join(roleAgentsDir(cwd), "planner.md"), "utf8");
    const result2 = applyRoleAgents(cwd, records, plans2, root);
    expect(result2.copied).toHaveLength(0);
    expect(result2.changed).toBe(false);
    expect(fs.readFileSync(path.join(roleAgentsDir(cwd), "planner.md"), "utf8")).toBe(before);
  });

  test("edição do usuário → edited (preserva + reporta; NUNCA reescreve)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    fs.mkdirSync(cwd, { recursive: true });
    const records = emptyRecords();
    applyRoleAgents(cwd, records, planRoleAgents(cwd, undefined, root), root);

    // Usuário edita planner.md.
    const target = path.join(roleAgentsDir(cwd), "planner.md");
    const userEdit = "---\nname: planner\n---\nmeu plano\n";
    fs.writeFileSync(target, userEdit, "utf8");

    const plans = planRoleAgents(cwd, records, root);
    expect(plans.find((p) => p.roleId === "planner")?.status).toBe("edited");
    expect(plans.filter((p) => p.status === "edited")).toHaveLength(1);

    const result = applyRoleAgents(cwd, records, plans, root);
    expect(result.copied).toHaveLength(0);
    expect(result.changed).toBe(false); // registro preservado
    expect(fs.readFileSync(target, "utf8")).toBe(userEdit); // nunca auto-cura
    expect(result.notes.some((n) => n.includes("preservado (editado"))).toBe(true);
  });

  test("template mudou (vN→vM): arquivo == registrado → updated (copia o novo asset)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    fs.mkdirSync(cwd, { recursive: true });
    const records = emptyRecords();
    applyRoleAgents(cwd, records, planRoleAgents(cwd, undefined, root), root);

    // Asset do builder muda (novo template — v2).
    const assetFile = path.join(roleAssetsDir(root), "builder.md");
    fs.writeFileSync(assetFile, `${fs.readFileSync(assetFile, "utf8")}\n-- v2 --\n`, "utf8");

    const plans = planRoleAgents(cwd, records, root);
    expect(plans.find((p) => p.roleId === "builder")?.status).toBe("updated");

    const result = applyRoleAgents(cwd, records, plans, root);
    expect(result.copied).toContain("builder.md");
    const target = path.join(roleAgentsDir(cwd), "builder.md");
    expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(assetFile, "utf8"));
    expect(records.builder?.assetVersion).toBe(ROLE_ASSETS_VERSION);
  });

  test("usuário editou E template mudou → edited (nunca auto-cura — edge F19 D7)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    fs.mkdirSync(cwd, { recursive: true });
    const records = emptyRecords();
    applyRoleAgents(cwd, records, planRoleAgents(cwd, undefined, root), root);

    const target = path.join(roleAgentsDir(cwd), "security.md");
    fs.writeFileSync(target, "---\nname: security\n---\neditado\n", "utf8");
    const assetFile = path.join(roleAssetsDir(root), "security.md");
    fs.writeFileSync(assetFile, `${fs.readFileSync(assetFile, "utf8")}\n-- v2 --\n`, "utf8");

    const plans = planRoleAgents(cwd, records, root);
    expect(plans.find((p) => p.roleId === "security")?.status).toBe("edited");
    const result = applyRoleAgents(cwd, records, plans, root);
    expect(fs.readFileSync(target, "utf8")).toBe("---\nname: security\n---\neditado\n");
    expect(result.copied).toHaveLength(0);
  });

  test("adoção: arquivo == asset sem registro → adopted (registra, sem write)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    const dir = roleAgentsDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    // Materializa os 7, depois SIMULA um state sem registros (ex.: state
    // recriado) — todos os arquivos == asset sem registro → adopted.
    const first = emptyRecords();
    applyRoleAgents(cwd, first, planRoleAgents(cwd, undefined, root), root);

    const plans = planRoleAgents(cwd, undefined, root);
    expect(plans.every((p) => p.status === "adopted")).toBe(true);
    const records = emptyRecords();
    const result = applyRoleAgents(cwd, records, plans, root);
    expect(result.copied).toHaveLength(0);
    expect(result.changed).toBe(true); // registros novos
    expect(records.scout?.contentHash).toBe(contentHash(fs.readFileSync(path.join(dir, "scout.md"), "utf8")));
  });

  test("conteúdo pré-existente ≠ asset sem registro → edited (nunca sobrescreve)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const cwd = path.join(base, "repo");
    const dir = roleAgentsDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    // 6 arquivos byte-idênticos aos assets; planner.md é do usuário.
    for (const id of [...ROLE_IDS]) {
      if (id === "planner") continue;
      fs.copyFileSync(path.join(roleAssetsDir(root), `${id}.md`), path.join(dir, `${id}.md`));
    }
    fs.writeFileSync(path.join(dir, "planner.md"), "---\nname: planner\n---\npré-existente\n", "utf8");

    const plans = planRoleAgents(cwd, undefined, root);
    expect(plans.find((p) => p.roleId === "planner")?.status).toBe("edited");
    expect(plans.filter((p) => p.status === "adopted")).toHaveLength(6);
    const result = applyRoleAgents(cwd, emptyRecords(), plans, root);
    expect(result.copied).toHaveLength(0);
    expect(fs.readFileSync(path.join(dir, "planner.md"), "utf8")).toBe("---\nname: planner\n---\npré-existente\n");
  });
});
