// sync.test.ts — F12 LIFE-06: idempotent reconciliation.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendPackages,
  makeSandbox,
  readJson,
  runHarness,
  settingsFile,
  stateFile,
  type Sandbox,
} from "./helpers.ts";

function backupFiles(sb: Sandbox): string[] {
  const dir = path.join(sb.runecraftHome, "backups");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function settingsPackages(sb: Sandbox): string[] {
  const settings = readJson(settingsFile(sb));
  return (settings.packages as string[]) ?? [];
}

function stateKeys(sb: Sandbox): string[] {
  return Object.keys((readJson(stateFile(sb)).components as Record<string, unknown>) ?? {}).sort();
}

describe("sync — idempotente (LIFE 3.2)", () => {
  test("harness em sync: zero mudanças, rerun idêntico", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const backupsBefore = backupFiles(sb);
      const settingsBefore = fs.readFileSync(settingsFile(sb), "utf8");
      const stateBefore = fs.readFileSync(stateFile(sb), "utf8");

      const first = await runHarness(sb, ["sync"]);
      expect(first.code).toBe(0);
      expect(first.stdout).toContain("already in sync");

      const second = await runHarness(sb, ["sync"]);
      expect(second.code).toBe(0);
      expect(second.stdout).toBe(first.stdout);

      // zero writes: settings/state intactos, nenhum backup novo
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(settingsBefore);
      expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore);
      expect(backupFiles(sb)).toEqual(backupsBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("--json em sync: status in-sync", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["sync", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { status: string; installed: string[]; kept: string[] };
      expect(json.status).toBe("in-sync");
      expect(json.installed).toEqual([]);
      expect(json.kept).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — faltante reinstalado (LIFE 3.1)", () => {
  test("package removido à mão volta ao estado esperado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      // simula `pi remove npm:@runecraft/subagents`
      const settings = readJson(settingsFile(sb));
      settings.packages = (settings.packages as string[]).filter((p) => p !== "npm:@runecraft/subagents");
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));
      expect(settingsPackages(sb)).not.toContain("npm:@runecraft/subagents");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Reinstalado (1)");
      expect(result.stdout).toContain("npm:@runecraft/subagents@0.37.2");

      // restaurado e, na segunda execução, em sync (rerun = zero mudanças)
      expect(settingsPackages(sb)).toContain("npm:@runecraft/subagents");
      const second = await runHarness(sb, ["sync"]);
      expect(second.stdout).toContain("already in sync");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — preserva o que o usuário instalou sozinho (edge F12)", () => {
  test("package à mão fora do state: nunca é removido nem adotado no state", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--component", "taskflow"]);
      const keysBefore = stateKeys(sb);
      appendPackages(sb, ["npm:@runecraft/subagents"]); // instalação manual

      const result = await runHarness(sb, ["sync", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        status: string;
        installed: string[];
        preserved: string[];
      };
      expect(json.installed).toEqual([]); // nada a reinstalar (taskflow presente)
      expect(json.preserved).toContain("npm:@runecraft/subagents");

      // não foi adotado no state (registro intacto)
      expect(stateKeys(sb)).toEqual(keysBefore);
      expect(settingsPackages(sb)).toContain("npm:@runecraft/subagents");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — versão divergente (LIFE 3.3)", () => {
  test("state com versão antiga → reinstall com o pin do manifest e state atualizado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const state = readJson(stateFile(sb));
      (state.components as Record<string, { version: string }>)["@runecraft/subagents"]!.version = "0.0.1";
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const result = await runHarness(sb, ["sync", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        status: string;
        installed: string[];
        diverged: Array<{ package: string; from: string; to: string }>;
      };
      expect(json.installed).toContain("npm:@runecraft/subagents@0.37.2");
      expect(json.diverged).toEqual([{ package: "@runecraft/subagents", from: "0.0.1", to: "0.37.2" }]);

      // state reflete a versão aplicada (revisão design 2026-08-05)
      const after = readJson(stateFile(sb));
      expect((after.components as Record<string, { version: string }>)["@runecraft/subagents"]?.version).toBe("0.37.2");

      // rerun → em sync
      const second = await runHarness(sb, ["sync", "--json"]);
      expect(JSON.parse(second.stdout).status).toBe("in-sync");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — dry-run e conservador", () => {
  test("--dry-run imprime o plano sem modificar nada", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const backupsBefore = backupFiles(sb);
      const settings = readJson(settingsFile(sb));
      settings.packages = (settings.packages as string[]).filter((p) => p !== "npm:@runecraft/subagents");
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["sync", "--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("DRY-RUN");
      expect(result.stdout).toContain("npm:@runecraft/subagents@0.37.2");

      // nada foi modificado: package segue ausente, sem backup novo
      expect(settingsPackages(sb)).not.toContain("npm:@runecraft/subagents");
      expect(backupFiles(sb)).toEqual(backupsBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("state corrompido → modo conservador: warn, exit ≠ 0, nada modificado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      fs.writeFileSync(stateFile(sb), "{ corrupt", "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("corrompido");
      expect(result.stderr).toContain("modo conservador");

      // packages intocados
      expect(settingsPackages(sb)).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });

  test("sem state registrado → informa que não há o que reconciliar", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nada para reconciliar");
    } finally {
      sb.cleanup();
    }
  });

  test("pi list falha → warn + fallback de settings.json (edge F12)", async () => {
    const sb = makeSandbox({ piListFail: true });
    try {
      await runHarness(sb, ["install"]);
      const settings = readJson(settingsFile(sb));
      settings.packages = (settings.packages as string[]).filter((p) => p !== "npm:@runecraft/subagents");
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("pi list` falhou");
      expect(result.stderr).toContain("fallback de settings.json");
      // o fallback enxerga o package ausente e reinstala mesmo assim
      expect(result.stdout).toContain("Reinstalado (1)");
      expect(settingsPackages(sb)).toContain("npm:@runecraft/subagents");
    } finally {
      sb.cleanup();
    }
  });
});
