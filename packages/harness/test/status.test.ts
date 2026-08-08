// status.test.ts — F12 LIFE-07: cross-state table (pi list × state × manifest).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendPackages,
  makeSandbox,
  readJson,
  runHarness,
  settingsFile,
  type Sandbox,
} from "./helpers.ts";

interface StatusJsonRow {
  package: string;
  component: string;
  installed: string | null;
  expected: string;
  state: string;
  managed: boolean;
}

interface StatusJson {
  scope: string;
  packages: StatusJsonRow[];
  suggestion: string | null;
}

const CATALOG = [
  "npm:@runecraft/subagents",
  "npm:@runecraft/taskflow-core",
  "npm:@runecraft/taskflow",
  "npm:@runecraft/taskflow-dsl",
  "npm:@runecraft/goal-loop-audit",
  "npm:@runecraft/pr-review",
];

describe("status — estado vazio (LIFE 4.3)", () => {
  test("tabela com 6 linhas ausente + sugestão de install", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("companion status");
      for (const pkg of CATALOG) expect(result.stdout).toContain(pkg);
      expect(result.stdout.match(/ausente/g)).toHaveLength(6);
      expect(result.stdout).toContain("npx @runecraft/companion install");
    } finally {
      sb.cleanup();
    }
  });

  test("--json: 6 packages com state ausente e suggestion", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as StatusJson;
      expect(json.scope).toBe("global");
      expect(json.packages).toHaveLength(6);
      for (const row of json.packages) {
        expect(row.state).toBe("ausente");
        expect(row.installed).toBeNull();
      }
      expect(json.suggestion).toContain("install");
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — instalado (LIFE 4.1)", () => {
  test("6 ok com versões instalada/esperada", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as StatusJson;
      expect(json.packages.filter((r) => r.state === "ok")).toHaveLength(6);
      for (const row of json.packages) {
        expect(row.managed).toBe(true);
        expect(row.installed).toBe(row.expected);
      }
      // subagents e taskflow-core com pins do manifest
      const subagents = json.packages.find((r) => r.package === "npm:@runecraft/subagents");
      expect(subagents?.installed).toBe("0.37.2");
      const taskflowCore = json.packages.find((r) => r.package === "npm:@runecraft/taskflow-core");
      expect(taskflowCore?.component).toBe("taskflow");
      expect(taskflowCore?.installed).toBe("0.2.6");
    } finally {
      sb.cleanup();
    }
  });

  test("tabela TTY mostra estado ok", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["status"]);
      expect(result.stdout).toContain("ok");
      expect(result.stdout).not.toContain("nada instalado pelo harness");
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — remoção parcial (independent test: uninstall 1 → ausente)", () => {
  test("após uninstall --component pr-review a linha dele fica ausente, demais ok", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      const uninstall = await runHarness(sb, ["uninstall", "--component", "pr-review", "--yes"]);
      expect(uninstall.code).toBe(0);

      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as StatusJson;
      const prReview = json.packages.find((r) => r.package === "npm:@runecraft/pr-review");
      expect(prReview?.state).toBe("ausente");
      expect(json.packages.filter((r) => r.state === "ok")).toHaveLength(5);
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — órfão e colisão (G3)", () => {
  test("package instalado à mão (fora do state) → órfão, não gerenciado", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install", "--component", "taskflow"]);
      // usuário instala subagents à mão (presente no pi list, fora do state)
      appendPackages(sb, ["npm:@runecraft/subagents"]);

      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as StatusJson;
      const subagents = json.packages.find((r) => r.package === "npm:@runecraft/subagents");
      expect(subagents?.state).toBe("órfão");
      expect(subagents?.managed).toBe(false);
      // taskflow continua gerenciado e ok
      const taskflow = json.packages.find((r) => r.package === "npm:@runecraft/taskflow");
      expect(taskflow?.state).toBe("ok");
    } finally {
      sb.cleanup();
    }
  });

  test("upstream instalado → collisions listado na saída e no JSON", async () => {
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["install"]);
      appendPackages(sb, ["npm:pi-subagents"]);

      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as StatusJson & { collisions: Array<{ package: string }> };
      expect(json.collisions.some((c) => c.package === "npm:pi-subagents")).toBe(true);

      const tty = await runHarness(sb, ["status"]);
      expect(tty.stdout).toContain("colisão com upstream");
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — scope (default workspace quando state do projeto existe)", () => {
  test("install --scope workspace → status no projeto usa o scope workspace", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      const result = await runHarness(sb, ["status", "--json"], { cwd: project });
      const json = JSON.parse(result.stdout) as StatusJson;
      expect(json.scope).toBe("workspace");
      expect(json.packages.filter((r) => r.state === "ok")).toHaveLength(6);

      // global segue sem state próprio: packages do projeto aparecem como órfãos
      // (presentes no `pi list` real, que é cross-scope, mas fora do state global)
      const global = await runHarness(sb, ["status", "--json", "--scope", "global"], { cwd: project });
      const globalJson = JSON.parse(global.stdout) as StatusJson;
      expect(globalJson.scope).toBe("global");
      expect(globalJson.packages.every((r) => r.state === "órfão" || r.state === "ausente")).toBe(true);
      expect(globalJson.packages.every((r) => !r.managed)).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("sem pi (bin ausente) → status não crasha, reporta ausente + warn", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status"], { piBin: path.join(sb.dir, "no-such-pi") });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pi` não detectado");
      expect(result.stdout.match(/ausente/g)).toHaveLength(6);
    } finally {
      sb.cleanup();
    }
  });

  test("pi list falha → warn com erro bruto, fallback de settings, sem crash", async () => {
    const sb = makeSandbox({ piListFail: true });
    try {
      // install funciona (o scan de conflitos usa o fallback de settings); o
      // knob só quebra o `pi list` que o status consulta.
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["status"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pi list` falhou");
      expect(result.stdout).toContain("FAKE_PI_LIST_FAIL");
      // fallback: packages lidos de settings.json → estado ok
      expect(result.stdout).toContain("ok");
    } finally {
      sb.cleanup();
    }
  });
});
