// plan.test.ts — presets/components e consistência com os package.json dos forks.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, COMPONENTS, helpText } from "../src/plan.ts";
import { HARNESS_VERSIONS } from "../src/versions.ts";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");

describe("buildPlan", () => {
  test("preset minimal → 4 components / 6 packages / 6 specs", () => {
    const plan = buildPlan("minimal", undefined);
    expect(plan.components).toEqual(["subagents", "taskflow", "goal-loop-audit", "pr-review"]);
    expect(plan.entries).toHaveLength(6);
    expect(plan.specs).toHaveLength(6);
    const groups = new Set(plan.entries.map((e) => e.group));
    expect(groups).toEqual(new Set(["subagents", "taskflow", "goal-loop-audit", "pr-review"]));
  });

  test("specs com versões do HARNESS_VERSIONS", () => {
    const plan = buildPlan("minimal", undefined);
    for (const spec of plan.specs) {
      const m = /^npm:(@runecraft\/[^@]+)@(.+)$/.exec(spec);
      expect(m).not.toBeNull();
      const name = m?.[1];
      const version = m?.[2];
      expect(name).toBeDefined();
      expect(version).toBeDefined();
      expect(HARNESS_VERSIONS[name!]).toBe(version);
    }
  });

  test("--component filtra o preset", () => {
    const plan = buildPlan("minimal", ["taskflow", "subagents"]);
    expect(plan.components).toEqual(["taskflow", "subagents"]);
    expect(plan.specs).toEqual([
      "npm:@runecraft/taskflow-core@0.2.6",
      "npm:@runecraft/taskflow@0.2.6",
      "npm:@runecraft/taskflow-dsl@0.2.6",
      "npm:@runecraft/subagents@0.37.2",
    ]);
  });

  test("todos os packages declarados do COMPONENTS têm versão", () => {
    for (const def of Object.values(COMPONENTS)) {
      for (const pkg of def.packages) {
        expect(HARNESS_VERSIONS[pkg], pkg).toBeDefined();
      }
    }
  });
});

describe("HARNESS_VERSIONS vs package.json dos forks (fonte única)", () => {
  test("versões batem com os package.json commitados dos forks", () => {
    // @runecraft/* package name → committed fork package.json (rel. ao repo root).
    const forks: Record<string, string> = {
      "@runecraft/subagents": "packages/subagents/package.json",
      "@runecraft/taskflow-core": "packages/taskflow/core/package.json",
      "@runecraft/taskflow": "packages/taskflow/pi/package.json",
      "@runecraft/taskflow-dsl": "packages/taskflow/dsl/package.json",
      "@runecraft/taskflow-mcp-core": "packages/taskflow/mcp-core/package.json",
      "@runecraft/taskflow-hosts": "packages/taskflow/hosts/package.json",
      "@runecraft/taskflow-codex": "packages/taskflow/codex/package.json",
      "@runecraft/taskflow-claude": "packages/taskflow/claude/package.json",
      "@runecraft/taskflow-opencode": "packages/taskflow/opencode/package.json",
      "@runecraft/taskflow-grok": "packages/taskflow/grok/package.json",
      "@runecraft/goal-loop-audit": "packages/goal-loop-audit/package.json",
      "@runecraft/pr-review": "packages/pr-review/package.json",
    };
    for (const [pkgName, relPath] of Object.entries(forks)) {
      const forkPath = path.resolve(REPO_ROOT, relPath);
      expect(fs.existsSync(forkPath), relPath).toBe(true);
      const forkPkg = JSON.parse(fs.readFileSync(forkPath, "utf8")) as { version?: string };
      expect(HARNESS_VERSIONS[pkgName], `${pkgName} vs ${relPath}`).toBe(forkPkg.version);
    }
    expect(Object.keys(HARNESS_VERSIONS)).toHaveLength(12);
  });
});

describe("help (CLI-06)", () => {
  test("documenta presets e components com o que cada um inclui", () => {
    const help = helpText();
    expect(help).toContain("install");
    expect(help).toContain("minimal");
    expect(help).toContain("full");
    expect(help).toContain("subagents");
    expect(help).toContain("taskflow");
    expect(help).toContain("goal-loop-audit");
    expect(help).toContain("pr-review");
    expect(help).toContain("--dry-run");
    expect(help).toContain("--json");
    expect(help).toContain("--scope");
  });
});
