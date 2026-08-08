// routing/sync-install.test.ts — F33 T4 (RTE-04): alvo chains no install/sync.
//
// CLI integration (dispatch in-process + fake pi — padrão F21 camada 1):
// 1ª instalação workspace materializa as 5 pilot chains em <cwd>/.pi/chains/
// (byte-idênticas aos assets do pacote — alvo REUSADO do F30, QA-3a) e
// registra `piChains` no state com contentHash (F13); 2º sync idempotente
// (zero writes — LIFE 3.2); edição do usuário → "preservado (editado)" e
// NUNCA reescrita (F19 D7); dir ausente → criado (mkdir recursivo); escopo
// global → repo-scoped (sem alvos no cwd); sem regressão nos alvos
// existentes (papéis F32 intocados); chains SDD do F30 coexistem.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, makeSandboxCleanPath, readJson, runHarness, writeSettings, type Sandbox } from "../helpers.ts";
import { PILOT_CHAIN_NAMES, pilotChainsAssetsDir, pilotChainsDir } from "../../src/routing/materialize.ts";

const ASSETS = pilotChainsAssetsDir();

function readWorkspaceState(sb: Sandbox, cwd: string): Record<string, unknown> {
  const file = path.join(cwd, ".runecraft", "state.json");
  return fs.existsSync(file) ? (readJson(file) as Record<string, unknown>) : {};
}

describe("install — alvo chains (F33 T4)", () => {
  test("install workspace: 5 pilot chains byte-idênticas em .pi/chains/ + registros no state", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      const result = await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);

      const dir = pilotChainsDir(project);
      expect(fs.existsSync(dir)).toBe(true); // dir ausente → criado (mkdir recursivo)
      for (const name of PILOT_CHAIN_NAMES) {
        const target = path.join(dir, `${name}.chain.md`);
        expect(fs.existsSync(target), `${name}.chain.md ausente`).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(ASSETS, `${name}.chain.md`), "utf8"));
      }
      // registros no state com contentHash (F13).
      const state = readWorkspaceState(sb, project);
      const piChains = (state.piChains ?? {}) as Record<string, { contentHash: string; assetVersion: string }>;
      expect(Object.keys(piChains).sort()).toEqual([...PILOT_CHAIN_NAMES].sort());
      for (const name of PILOT_CHAIN_NAMES) {
        expect(piChains[name]?.contentHash.length).toBe(64);
        expect(piChains[name]?.assetVersion).toBe("1");
      }
      expect(result.stdout).toContain("pilot chains materializadas");
    } finally {
      sb.cleanup();
    }
  });

  test("install global: repo-scoped — sem alvos no cwd", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install"]);
      expect(result.code).toBe(0);
      expect(fs.existsSync(pilotChainsDir(sb.dir))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("install não regride alvos existentes (papéis F32 + chains SDD do F30 coexistem)", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      const chainsDir = pilotChainsDir(project);
      const roleDir = path.join(project, ".pi", "agents");
      expect(fs.existsSync(path.join(roleDir, "builder.md"))).toBe(true); // F32 intocado
      // Chains SDD do F30 presentes no MESMO alvo.
      expect(fs.existsSync(path.join(chainsDir, "sdd-tasks.chain.md"))).toBe(true);
      // Pilot chains não duplicadas em dir separado.
      expect(fs.existsSync(path.join(project, "chains"))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — three-way por conteúdo (F33 T4 / F19 D7)", () => {
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
      expect(first.stdout).not.toContain("pilot chains materializadas");
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

      // Usuário edita implement.chain.md.
      const target = path.join(pilotChainsDir(project), "implement.chain.md");
      const userEdit = "---\nname: implement\ndescription: \"minha chain\"\n---\n## builder\nlocal\n";
      fs.writeFileSync(target, userEdit, "utf8");

      const result = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("implement: preservado (editado");
      expect(fs.readFileSync(target, "utf8")).toBe(userEdit); // nunca auto-cura

      const again = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(again.code).toBe(0);
      expect(fs.readFileSync(target, "utf8")).toBe(userEdit);
    } finally {
      sb.cleanup();
    }
  });

  test("chain deletada à mão → sync re-injeta (missing → copia)", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      fs.rmSync(path.join(pilotChainsDir(project), "explore.chain.md"));

      const result = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("explore: re-injetado");
      expect(fs.readFileSync(path.join(pilotChainsDir(project), "explore.chain.md"), "utf8")).toBe(
        fs.readFileSync(path.join(ASSETS, "explore.chain.md"), "utf8"),
      );
    } finally {
      sb.cleanup();
    }
  });

  test("status --json: seção routing (kill switch/rotas/pilot chains) + status TTY", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      // Edita uma chain → preservada.
      fs.writeFileSync(path.join(pilotChainsDir(project), "plan.chain.md"), "---\nname: plan\ndescription: \"x\"\n---\n## planner\nlocal\n", "utf8");

      const result = await runHarness(sb, ["status", "--json", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        routing: { killSwitch: boolean; enabled: boolean; threshold: number; enabledRoutes: string[]; mandatoryRoutes: string[]; pilotChains: { installed: string[]; preserved: string[]; missing: string[]; total: number } };
      };
      expect(json.routing.killSwitch).toBe(false);
      expect(json.routing.enabled).toBe(true);
      expect(json.routing.threshold).toBe(2);
      expect(json.routing.enabledRoutes).toContain("implement");
      expect(json.routing.mandatoryRoutes).toEqual(["security"]);
      expect(json.routing.pilotChains.installed).toHaveLength(4);
      expect(json.routing.pilotChains.preserved).toEqual(["plan.chain.md"]);
      expect(json.routing.pilotChains.missing).toEqual([]);
      expect(json.routing.pilotChains.total).toBe(5);

      // TTY mostra a seção.
      const tty = await runHarness(sb, ["status", "--scope", "workspace"], { cwd: project });
      expect(tty.stdout).toContain("Routing (F33):");
      expect(tty.stdout).toContain("threshold 2");
    } finally {
      sb.cleanup();
    }
  });

  test("doctor check 23: routing (kill switch off · chains materializadas → pass; RUNECRAFT_ROUTING=0 → informativo)", async () => {
    const sb = makeSandboxCleanPath();
    try {
      writeSettings(sb, []);
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      const result = await runHarness(sb, ["doctor"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[23] Coded Routing");
      expect(result.stdout).toContain("kill switch RUNECRAFT_ROUTING off");

      sb.env.RUNECRAFT_ROUTING = "0";
      const kill = await runHarness(sb, ["doctor"], { cwd: project });
      expect(kill.stdout).toContain("RUNECRAFT_ROUTING=0 ATIVO (roteamento inativo)");
      delete sb.env.RUNECRAFT_ROUTING;    } finally {
      sb.cleanup();
    }
  });
});
