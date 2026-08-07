// uninstall.test.ts — F12 LIFE-03/04/05: managed removal (only what the harness manages).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import {
  appendPackages,
  makeSandbox,
  readJson,
  runHarness,
  settingsFile,
  stateFile,
  writeSettings,
  type Sandbox,
} from "./helpers.ts";

const ALL_IDENTITIES = [
  "npm:@runecraft/subagents",
  "npm:@runecraft/taskflow-core",
  "npm:@runecraft/taskflow",
  "npm:@runecraft/taskflow-dsl",
  "npm:@runecraft/goal-loop-audit",
  "npm:@runecraft/pr-review",
];

function settingsPackages(sb: Sandbox): string[] {
  const settings = readJson(settingsFile(sb));
  return (settings.packages as string[]) ?? [];
}

function stateKeys(sb: Sandbox): string[] {
  return Object.keys((readJson(stateFile(sb)).components as Record<string, unknown>) ?? {}).sort();
}

function backupCount(sb: Sandbox): number {
  const dir = path.join(sb.runecraftHome, "backups");
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

function stdinWith(answer: string): NodeJS.ReadableStream {
  return new Readable({
    read() {
      this.push(answer);
      this.push(null);
    },
  }) as NodeJS.ReadableStream;
}

describe("uninstall --all (LIFE 2.2/2.3/2.5)", () => {
  test("remove os 6 gerenciados, preserva packages à mão e config do usuário", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      // usuário instala um upstream à mão e tem chave própria no settings
      appendPackages(sb, ["npm:pi-subagents"]);
      const settings = readJson(settingsFile(sb));
      settings.myCustomKey = { keep: "me" };
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Removido (6)");
      expect(result.stdout).toContain("npm:pi-subagents"); // reportado como preservado

      // só o que o usuário instalou à mão permanece
      expect(settingsPackages(sb).sort()).toEqual(["npm:pi-subagents"]);
      // chave custom do usuário intacta e settings válido
      const after = readJson(settingsFile(sb));
      expect((after.myCustomKey as { keep: string }).keep).toBe("me");
      // state reflete a remoção (LIFE 2.5)
      expect(stateKeys(sb)).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("package runecraft instalado à mão (órfão) não é removido", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--component", "taskflow"]);
      appendPackages(sb, ["npm:@runecraft/subagents"]); // à mão, fora do state

      const result = await runHarness(sb, ["uninstall", "--all", "--yes", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { removed: string[]; preserved: string[] };
      expect(json.removed).toHaveLength(3); // só taskflow core+pi+dsl
      expect(json.removed).toEqual(["npm:@runecraft/taskflow-core", "npm:@runecraft/taskflow", "npm:@runecraft/taskflow-dsl"]);
      expect(json.preserved).toContain("npm:@runecraft/subagents");
      expect(settingsPackages(sb)).toEqual(["npm:@runecraft/subagents"]);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall --component (LIFE 2.1)", () => {
  test("goal-loop-audit é removido; demais permanecem", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["uninstall", "--component", "goal-loop-audit", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Removido (1)");
      expect(result.stdout).toContain("npm:@runecraft/goal-loop-audit");

      const packages = settingsPackages(sb);
      expect(packages).toHaveLength(5);
      expect(packages).not.toContain("npm:@runecraft/goal-loop-audit");
      expect(stateKeys(sb)).toHaveLength(5);
      expect(stateKeys(sb)).not.toContain("@runecraft/goal-loop-audit");
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — seleção explícita", () => {
  test("sem --all nem --component → erro exit ≠ 0 (nada removido)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["uninstall"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--all");
      expect(settingsPackages(sb)).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });

  test("--all com --component juntos → erro", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["uninstall", "--all", "--component", "taskflow", "--yes"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("não ambos");
    } finally {
      sb.cleanup();
    }
  });

  test("component sem nada registrado no state → aviso, nada removido", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--component", "taskflow"]);
      const result = await runHarness(sb, ["uninstall", "--component", "pr-review", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nenhum package registrado");
      expect(settingsPackages(sb)).toHaveLength(3);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — confirmação", () => {
  test("TTY sem --yes pergunta; resposta 'n' aborta sem modificar nada", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const backupsBefore = backupCount(sb);
      const result = await runHarness(sb, ["uninstall", "--all"], {
        isTTY: true,
        stdin: stdinWith("n\n"),
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Abortado");
      expect(settingsPackages(sb)).toHaveLength(6);
      expect(backupCount(sb)).toBe(backupsBefore); // backup só é criado após confirmação
    } finally {
      sb.cleanup();
    }
  });

  test("TTY com resposta 'y' remove normalmente", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["uninstall", "--all"], {
        isTTY: true,
        stdin: stdinWith("y\n"),
      });
      expect(result.code).toBe(0);
      expect(settingsPackages(sb)).toHaveLength(0);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — backup pré-write (LIFE 2.4)", () => {
  test("snapshot criado antes da remoção e reportado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      expect(backupCount(sb)).toBe(1); // backup do install

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(backupCount(sb)).toBe(2);
      expect(result.stdout).toContain("Backup pré-remoção");
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — scope workspace", () => {
  test("remove do projeto (.pi/.runecraft) sem tocar o global", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      const result = await runHarness(sb, ["uninstall", "--scope", "workspace", "--all", "--yes"], { cwd: project });
      expect(result.code).toBe(0);

      const projectSettings = path.join(project, ".pi", "settings.json");
      const projectState = path.join(project, ".runecraft", "state.json");
      expect(JSON.parse(fs.readFileSync(projectSettings, "utf8")).packages).toEqual([]);
      expect(Object.keys(JSON.parse(fs.readFileSync(projectState, "utf8")).components ?? {})).toEqual([]);
      // global intocado
      expect(fs.existsSync(settingsFile(sb))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("default do scope: workspace quando existe state.json no projeto", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      // sem --scope: usa o workspace do projeto
      const result = await runHarness(sb, ["uninstall", "--all", "--yes", "--json"], { cwd: project });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { scope: string; removed: string[] };
      expect(json.scope).toBe("workspace");
      expect(json.removed).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — modo conservador (edge F12)", () => {
  test("state corrompido → nada removido, exit ≠ 0", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      fs.writeFileSync(stateFile(sb), "{ corrupt", "utf8");

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("modo conservador");
      expect(settingsPackages(sb)).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });

  test("sem state → informa que nada é gerenciado", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nada gerenciado pelo harness");
    } finally {
      sb.cleanup();
    }
  });

  test("pi list falha → warn + remoção segue pelo state (edge F12)", async () => {
    const sb = makeSandbox({ piListFail: true });
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("pi list` falhou");
      expect(result.stderr).toContain("fallback de settings.json");
      // a remoção é dirigida pelo state — funciona mesmo com o list quebrado
      expect(settingsPackages(sb)).toHaveLength(0);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — settingsChanges do F14 (SETM-05)", () => {
  function settingsChanges(sb: Sandbox): Array<{ path: string[] }> {
    const state = readJson(stateFile(sb));
    return (state.settingsChanges as Array<{ path: string[] }>) ?? [];
  }

  test("install full → uninstall --all remove as chaves adicionadas e atualiza o state", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--preset", "full"]);
      expect(settingsChanges(sb)).toHaveLength(3);

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Settings removidos (defaults do harness");
      expect(result.stdout).toContain("subagents.modelScope.enforce");
      expect(result.stdout).toContain("modelRoles");

      // settings.json sem os defaults; packages removidos
      const settings = readJson(settingsFile(sb));
      expect(settings.subagents).toBeUndefined();
      expect(settings.taskflow).toBeUndefined();
      expect(settings.modelRoles).toBeUndefined();
      expect(settingsPackages(sb)).toHaveLength(0);

      // state reflete: settingsChanges vazio
      expect(settingsChanges(sb)).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });

  test("chave editada pelo usuário após o install → preservada e reportada (SETM 2.2)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--preset", "full"]);
      // usuário edita uma chave registrada
      const settings = readJson(settingsFile(sb));
      settings.taskflow = { piChild: { resourceProfile: "allowlist" } };
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Settings preservados — valor editado pelo usuário");
      expect(result.stdout).toContain("taskflow.piChild.resourceProfile");
      expect(result.stdout).toContain('"allowlist"');
      // as outras chaves foram removidas
      expect(result.stdout).toContain("subagents.modelScope.enforce");

      const after = readJson(settingsFile(sb));
      // chave editada permanece com o valor do usuário
      expect((after.taskflow as { piChild: { resourceProfile: string } }).piChild.resourceProfile).toBe("allowlist");
      // defaults não editados não ficaram
      expect(after.subagents).toBeUndefined();
      expect(after.modelRoles).toBeUndefined();

      // state mantém só a entry preservada (remoção limpa não perde rastro)
      const remaining = settingsChanges(sb);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.path.join(".")).toBe("taskflow.piChild.resourceProfile");
    } finally {
      sb.cleanup();
    }
  });

  test("--component remove só os settingsChanges do componente selecionado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--preset", "full"]);
      const result = await runHarness(sb, ["uninstall", "--component", "subagents", "--yes"]);
      expect(result.code).toBe(0);

      const settings = readJson(settingsFile(sb));
      expect(settings.subagents).toBeUndefined();
      // taskflow/modelRoles intactos
      expect((settings.taskflow as { piChild: { resourceProfile: string } }).piChild.resourceProfile).toBe("isolated");
      expect(settings.modelRoles).toBeDefined();

      const remaining = settingsChanges(sb).map((c) => c.path.join(".")).sort();
      expect(remaining).toEqual(["modelRoles", "taskflow.piChild.resourceProfile"]);
      // packages do subagents removidos (1), demais ficam (5)
      expect(settingsPackages(sb)).toHaveLength(5);
    } finally {
      sb.cleanup();
    }
  });

  test("--component taskflow remove também os modelRoles parciais (leaves do deep merge)", async () => {
    const sb = makeSandbox();
    try {
      // usuário tem um modelRoles parcial → deep merge registra leaves por role
      // (["modelRoles","steward"], …) no state; dono = taskflow por prefixo.
      const settings = { packages: [], modelRoles: { expert: "meu/modelo" } };
      fs.mkdirSync(path.dirname(settingsFile(sb)), { recursive: true });
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));
      await runHarness(sb, ["install", "--preset", "full"]);
      const registered = settingsChanges(sb).map((c) => c.path.join(".")).sort();
      expect(registered).toEqual([
        "modelRoles.builder",
        "modelRoles.scout",
        "modelRoles.steward",
        "subagents.modelScope.enforce",
        "taskflow.piChild.resourceProfile",
      ]);

      const result = await runHarness(sb, ["uninstall", "--component", "taskflow", "--yes"]);
      expect(result.code).toBe(0);

      const after = readJson(settingsFile(sb));
      // leaves do modelRoles removidos; o parcial do usuário permanece intacto
      expect(after.modelRoles).toEqual({ expert: "meu/modelo" });
      expect(after.taskflow).toBeUndefined();
      // subagents (outro componente) intacto
      expect((after.subagents as { modelScope: { enforce: boolean } }).modelScope.enforce).toBe(false);

      // state sem órfãos: só o que é do subagents permanece
      const remaining = settingsChanges(sb).map((c) => c.path.join("."));
      expect(remaining).toEqual(["subagents.modelScope.enforce"]);
      // packages do taskflow removidos (3), demais ficam (3)
      expect(settingsPackages(sb)).toHaveLength(3);
    } finally {
      sb.cleanup();
    }
  });

  test("backup pré-existente → output indica restore como alternativa (SETM 2.3)", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--preset", "full"]);
      const result = await runHarness(sb, ["uninstall", "--all", "--yes", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { notes: string[] };
      const restoreNote = json.notes.find((n) => n.includes("harness restore"));
      expect(restoreNote).toBeDefined();
      expect(restoreNote).toContain("runecraft-");
    } finally {
      sb.cleanup();
    }
  });
});
