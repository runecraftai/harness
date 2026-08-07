// install.test.ts — F11 CLI-01..CLI-10 via in-process dispatch + fake pi.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  backupsDir,
  makeSandbox,
  readJson,
  runHarness,
  settingsFile,
  stateFile,
  writeSettings,
  type Sandbox,
} from "./helpers.ts";

const ALL_SPECS = [
  "npm:@runecraft/subagents@0.37.2",
  "npm:@runecraft/taskflow-core@0.2.6",
  "npm:@runecraft/taskflow@0.2.6",
  "npm:@runecraft/taskflow-dsl@0.2.6",
  "npm:@runecraft/goal-loop-audit@0.28.34",
  "npm:@runecraft/pr-review@1.11.4",
];

const ALL_IDENTITIES = ALL_SPECS.map((s) => s.replace(/@[^@]+$/, ""));

function componentKeys(state: Record<string, unknown>): string[] {
  return Object.keys((state.components as Record<string, unknown>) ?? {}).sort();
}

describe("install — preset minimal (CLI-01)", () => {
  test("instala os 6 packages via pi e registra state com group", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install"]);
      expect(result.code).toBe(0);

      // pi list / settings refletem a instalação
      const settings = readJson(settingsFile(sb));
      const installed = (settings.packages as string[]).sort();
      expect(installed).toEqual([...ALL_IDENTITIES].sort());

      // state.json: 6 entries por package, group correto
      const state = readJson(stateFile(sb));
      expect(state.schemaVersion).toBe(1);
      expect(state.scope).toBe("global");
      const keys = componentKeys(state);
      expect(keys).toEqual([...ALL_IDENTITIES].map((s) => s.replace("npm:", "")).sort());
      const components = state.components as Record<string, { group: string }>;
      for (const key of ["@runecraft/taskflow-core", "@runecraft/taskflow", "@runecraft/taskflow-dsl"]) {
        expect(components[key]?.group).toBe("taskflow");
      }
      expect(components["@runecraft/subagents"]?.group).toBe("subagents");

      // relatório TTY lista o instalado
      expect(result.stdout).toContain("Instalado (6)");
      for (const spec of ALL_SPECS) expect(result.stdout).toContain(spec);

      // snapshot pré-write criado e registrado
      expect(fs.existsSync(backupsDir(sb))).toBe(true);
      expect(Array.isArray(state.preInstall)).toBe(true);
      expect((state.preInstall as unknown[]).length).toBeGreaterThan(0);
    } finally {
      sb.cleanup();
    }
  });

  test("--component filtra (CLI-02): taskflow instala só core+pi+dsl", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--component", "taskflow"]);
      expect(result.code).toBe(0);
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual([
        "npm:@runecraft/taskflow",
        "npm:@runecraft/taskflow-core",
        "npm:@runecraft/taskflow-dsl",
      ]);
      const state = readJson(stateFile(sb));
      expect(componentKeys(state)).toEqual([
        "@runecraft/taskflow",
        "@runecraft/taskflow-core",
        "@runecraft/taskflow-dsl",
      ]);
      expect(result.stdout).not.toContain("@runecraft/goal-loop-audit");
    } finally {
      sb.cleanup();
    }
  });

  test("--component aceita lista separada por vírgula", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--component", "subagents,pr-review"]);
      expect(result.code).toBe(0);
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual([
        "npm:@runecraft/pr-review",
        "npm:@runecraft/subagents",
      ]);
    } finally {
      sb.cleanup();
    }
  });

  test("--preset full aplica defaults por merge (CLI-05/F14)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--preset", "full"]);
      expect(result.code).toBe(0);
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual([...ALL_IDENTITIES].sort());
      // defaults do subagents/taskflow aplicados
      expect(settings.subagents).toEqual({ modelScope: { enforce: false } });
      expect(settings.taskflow).toEqual({ piChild: { resourceProfile: "isolated" } });
      expect(settings.modelRoles).toEqual({
        steward: "openrouter/anthropic/claude-fable-5",
        expert: "openrouter/anthropic/claude-opus-5",
        builder: "openrouter/anthropic/claude-sonnet-5",
        scout: "openrouter/anthropic/claude-haiku-4.5",
      });
      // relatório TTY mostra a seção de settings aplicados
      expect(result.stdout).toContain("Settings — defaults aplicados");
      expect(result.stdout).toContain("subagents.modelScope.enforce = false");
      // settingsChanges no state (SETM-03)
      const state = readJson(stateFile(sb));
      const changes = state.settingsChanges as Array<{ file: string; path: string[]; value: unknown }>;
      expect(changes.map((c) => c.path.join(".")).sort()).toEqual([
        "modelRoles",
        "subagents.modelScope.enforce",
        "taskflow.piChild.resourceProfile",
      ]);
      expect(changes.every((c) => c.file === settingsFile(sb))).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("--preset full preserva chave do usuário e reporta conflito (SETM-01/02)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      const settings = readJson(settingsFile(sb));
      settings.subagents = { defaultModel: "meu-modelo/xyz" };
      settings.taskflow = { piChild: { resourceProfile: "allowlist" } };
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["install", "--preset", "full"]);
      expect(result.code).toBe(0);

      const after = readJson(settingsFile(sb));
      // usuário vence: defaultModel intacto, resourceProfile allowlist mantido
      expect((after.subagents as { defaultModel: string }).defaultModel).toBe("meu-modelo/xyz");
      // merge profundo: modelScope.enforce criado sem tocar defaultModel
      expect((after.subagents as { modelScope: { enforce: boolean } }).modelScope.enforce).toBe(false);
      expect((after.taskflow as { piChild: { resourceProfile: string } }).piChild.resourceProfile).toBe("allowlist");

      // conflito reportado no relatório com path + valor de cada lado
      expect(result.stdout).toContain("Settings — conflito");
      expect(result.stdout).toContain("taskflow.piChild.resourceProfile");
      expect(result.stdout).toContain('"allowlist"');
      expect(result.stdout).toContain('"isolated"');

      // só as chaves CRIADAS entram em settingsChanges (SETM-03); conflito não
      const state = readJson(stateFile(sb));
      const changes = state.settingsChanges as Array<{ path: string[] }>;
      expect(changes.map((c) => c.path.join("."))).not.toContain("taskflow.piChild.resourceProfile");
      expect(changes.map((c) => c.path.join("."))).toContain("subagents.modelScope.enforce");
    } finally {
      sb.cleanup();
    }
  });

  test("--component + --preset full → merge só dos componentes selecionados", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--preset", "full", "--component", "subagents"]);
      expect(result.code).toBe(0);
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual(["npm:@runecraft/subagents"]);
      // só subagents teve defaults aplicados
      expect(settings.subagents).toEqual({ modelScope: { enforce: false } });
      expect(settings.taskflow).toBeUndefined();
      expect(settings.modelRoles).toBeUndefined();
      const state = readJson(stateFile(sb));
      const changes = state.settingsChanges as Array<{ path: string[] }>;
      expect(changes.map((c) => c.path.join("."))).toEqual(["subagents.modelScope.enforce"]);
    } finally {
      sb.cleanup();
    }
  });

  test("--preset full --json → relatório estruturado com settings (SETM-06)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--preset", "full", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        settings: { created: Array<{ path: string; file: string }>; conflicts: unknown[]; removed: unknown[]; preserved: unknown[] };
      };
      expect(json.settings.created.map((c) => c.path).sort()).toEqual([
        "modelRoles",
        "subagents.modelScope.enforce",
        "taskflow.piChild.resourceProfile",
      ]);
      expect(json.settings.created.every((c) => c.file === settingsFile(sb))).toBe(true);
      expect(json.settings.conflicts).toEqual([]);
      expect(json.settings.removed).toEqual([]);
      expect(json.settings.preserved).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("preset full idempotente: rerun não duplica settingsChanges nem muda settings (edge SETM)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--preset", "full"]);
      const settingsBefore = fs.readFileSync(settingsFile(sb), "utf8");
      const result = await runHarness(sb, ["install", "--preset", "full"]);
      expect(result.code).toBe(0);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(settingsBefore);
      const state = readJson(stateFile(sb));
      expect((state.settingsChanges as unknown[]).length).toBe(3);
      expect(result.stdout).not.toContain("Settings — defaults aplicados");
    } finally {
      sb.cleanup();
    }
  });

  test("preset full com settings.json inválido → fail-closed, arquivo intocado (SETM-04)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), "{ inválido", "utf8");
      const result = await runHarness(sb, ["install", "--preset", "full"]);
      // pi não consegue operar com settings corrompido → packages falham e o
      // fluxo termina fail-closed: exit ≠ 0, nada modificado.
      expect(result.code).toBe(1);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe("{ inválido");
      const state = readJson(stateFile(sb));
      expect((state.settingsChanges as unknown[]).length).toBe(0);
      // o abort por JSON inválido do MERGE (SETM-04, apontando o arquivo) é
      // coberto em nível de engine em test/merge.test.ts
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — dry-run (CLI-03)", () => {
  test("imprime o plano sem nenhum efeito colateral", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("DRY-RUN");
      for (const spec of ALL_SPECS) expect(result.stdout).toContain(spec);
      // nada foi criado/alterado
      expect(fs.existsSync(settingsFile(sb))).toBe(false);
      expect(fs.existsSync(stateFile(sb))).toBe(false);
      expect(fs.existsSync(backupsDir(sb))).toBe(false);
      // pi list segue vazio (fake nunca recebeu install)
      const list = await runHarness(sb, ["install", "--dry-run"]);
      expect(list.stdout).toContain("DRY-RUN");
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — falha com continuação (edge F11, CLI-10)", () => {
  test("componente falho não entra no state, exit ≠ 0, retry sugerido", async () => {
    const sb = makeSandbox({ fail: "@runecraft/goal-loop-audit" });
    try {
      const result = await runHarness(sb, ["install"]);
      expect(result.code).toBe(1);

      const settings = readJson(settingsFile(sb));
      const installed = (settings.packages as string[]).sort();
      expect(installed).toHaveLength(5);
      expect(installed).not.toContain("npm:@runecraft/goal-loop-audit");

      const state = readJson(stateFile(sb));
      expect(componentKeys(state)).not.toContain("@runecraft/goal-loop-audit");
      expect(componentKeys(state)).toHaveLength(5);

      expect(result.stdout).toContain("Falhou (1)");
      expect(result.stdout).toContain("npm:@runecraft/goal-loop-audit@0.28.34");
      expect(result.stdout).toContain("Sugestão");

      // rollback point: snapshot pré-write existe
      expect(fs.existsSync(backupsDir(sb))).toBe(true);
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — --json (CI)", () => {
  test("shape estável {installed, kept, conflicts, failed, ...}", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(json.preset).toBe("minimal");
      expect(json.scope).toBe("global");
      expect((json.installed as string[]).sort()).toEqual([...ALL_SPECS].sort());
      expect(json.kept).toEqual([]);
      expect(json.conflicts).toEqual([]);
      expect(json.failed).toEqual([]);
      expect(typeof json.backup).toBe("string");
      expect(Array.isArray(json.filesTouched)).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("--json em falha de componente reporta failed e exit 1", async () => {
    const sb = makeSandbox({ fail: "@runecraft/pr-review" });
    try {
      const result = await runHarness(sb, ["install", "--json"]);
      expect(result.code).toBe(1);
      const json = JSON.parse(result.stdout) as { failed: Array<{ spec: string; code: number }> };
      expect(json.failed).toHaveLength(1);
      expect(json.failed[0]?.spec).toContain("@runecraft/pr-review");
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — idempotência (CLI-08)", () => {
  test("rerun não duplica entries nem clobber", async () => {
    const sb = makeSandbox();
    try {
      const first = await runHarness(sb, ["install"]);
      expect(first.code).toBe(0);
      const second = await runHarness(sb, ["install"]);
      expect(second.code).toBe(0);

      const settings = readJson(settingsFile(sb));
      const packages = settings.packages as string[];
      expect(packages).toHaveLength(6);
      expect(new Set(packages).size).toBe(6);

      const state = readJson(stateFile(sb));
      expect(componentKeys(state)).toHaveLength(6);

      // segunda execução: tudo "mantido", nada "instalado" de novo
      const json = await runHarness(sb, ["install", "--json"]);
      const report = JSON.parse(json.stdout) as { installed: string[]; kept: string[] };
      expect(report.installed).toEqual([]);
      expect(report.kept).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — colisão com upstream (CLI-09 + F18 MXST-04 gate)", () => {
  test("sem TTY e sem --yes com upstream → aborta fail-closed apontando --yes", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["install"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("pi-subagents");
      expect(result.stderr).toContain("--yes");
      // nada foi instalado
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual(["npm:pi-subagents"]);
    } finally {
      sb.cleanup();
    }
  });

  test("--yes prossegue, registra warnings no relatório; nunca remove o upstream", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["install", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Conflito com upstream");
      expect(result.stdout).toContain("pi-subagents");
      expect(result.stdout).toContain("pi remove npm:pi-subagents");
      expect(result.stdout).toContain("Colisões detectadas"); // MXST-04 AC 2.4

      // upstream continua instalado — o harness não remove
      const settings = readJson(settingsFile(sb));
      expect((settings.packages as string[]).sort()).toEqual(
        ["npm:pi-subagents", ...ALL_IDENTITIES].sort(),
      );
    } finally {
      sb.cleanup();
    }
  });

  test("--json --yes inclui conflicts e warnings", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, ["npm:pi-taskflow"]);
      const result = await runHarness(sb, ["install", "--json", "--yes"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        conflicts: Array<{ package: string }>;
        warnings: Array<{ name: string }>;
      };
      expect(json.conflicts).toHaveLength(1);
      expect(json.conflicts[0]?.package).toBe("npm:pi-taskflow");
      expect(json.warnings.some((w) => w.name === "pi-taskflow" || w.name === "npm:pi-taskflow")).toBe(true);
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — pi ausente, fail-closed (CLI-04)", () => {
  test("exit ≠ 0 e imprime o comando exato de instalação", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install"], { piBin: path.join(sb.dir, "no-such-pi") });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
      expect(result.stderr).toContain("npx @runecraft/harness install");
      // fail-closed: nada foi escrito
      expect(fs.existsSync(settingsFile(sb))).toBe(false);
      expect(fs.existsSync(stateFile(sb))).toBe(false);
      expect(fs.existsSync(backupsDir(sb))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — scope workspace", () => {
  test("instala em .pi do projeto e state em .runecraft do projeto", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      const result = await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);

      const projectSettings = path.join(project, ".pi", "settings.json");
      expect(fs.existsSync(projectSettings)).toBe(true);
      const settings = readJson(projectSettings);
      expect((settings.packages as string[]).sort()).toEqual([...ALL_IDENTITIES].sort());

      // global não foi tocado
      expect(fs.existsSync(settingsFile(sb))).toBe(false);

      const projectState = path.join(project, ".runecraft", "state.json");
      expect(fs.existsSync(projectState)).toBe(true);
      const state = readJson(projectState);
      expect(state.scope).toBe("workspace");
      expect(componentKeys(state)).toHaveLength(6);

      // backup no scope do projeto
      expect(fs.existsSync(path.join(project, ".runecraft", "backups"))).toBe(true);
    } finally {
      sb.cleanup();
    }
  });
});

describe("edge — Node abaixo do piso (warn, não bloqueia)", () => {
  test("Node 20.x emite warn e o install segue", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install"], { nodeVersion: "20.11.1" });
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("warn");
      expect(result.stderr).toContain("22.19");
      // a instalação ocorreu normalmente
      expect(fs.existsSync(settingsFile(sb))).toBe(true);
      expect((readJson(settingsFile(sb)).packages as string[])).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });

  test("Node 22.19+ não emite warn", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true }); // config dir do Pi presente → sem warn de dir
      const result = await runHarness(sb, ["install"], { nodeVersion: "22.19.0" });
      expect(result.code).toBe(0);
      expect(result.stderr).not.toContain("warn");
    } finally {
      sb.cleanup();
    }
  });
});

describe("flags inválidas", () => {
  test("comando desconhecido → exit 1", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["frobnicate"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("comando desconhecido");
    } finally {
      sb.cleanup();
    }
  });

  test("--preset inválido → exit 1", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--preset", "mega"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--preset inválido");
    } finally {
      sb.cleanup();
    }
  });

  test("--component inválido → exit 1 listando os válidos", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--component", "bogus"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--component inválido");
      expect(result.stderr).toContain("goal-loop-audit");
    } finally {
      sb.cleanup();
    }
  });
});
