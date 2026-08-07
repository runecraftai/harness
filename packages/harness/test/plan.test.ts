// plan.test.ts — presets/components e consistência com vendor.manifest.json.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, COMPONENTS, helpText } from "../src/plan.ts";
import { HARNESS_VERSIONS } from "../src/versions.ts";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

describe("HARNESS_VERSIONS vs vendor.manifest.json (fonte única)", () => {
  test("versões batem com o manifest da raiz", () => {
    const manifestPath = path.resolve(PKG_ROOT, "..", "..", "vendor.manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      upstreams: Record<string, { npmVersion?: string }>;
    };
    const renamed: Record<string, string> = {
      subagents: "@runecraft/subagents",
      "taskflow-core": "@runecraft/taskflow-core",
      "taskflow-pi": "@runecraft/taskflow",
      "taskflow-dsl": "@runecraft/taskflow-dsl",
      "taskflow-mcp-core": "@runecraft/taskflow-mcp-core",
      "taskflow-hosts": "@runecraft/taskflow-hosts",
      "taskflow-codex": "@runecraft/taskflow-codex",
      "taskflow-claude": "@runecraft/taskflow-claude",
      "taskflow-opencode": "@runecraft/taskflow-opencode",
      "taskflow-grok": "@runecraft/taskflow-grok",
      "goal-loop-audit": "@runecraft/goal-loop-audit",
      "pr-review": "@runecraft/pr-review",
    };
    for (const [vendorKey, pkgName] of Object.entries(renamed)) {
      expect(HARNESS_VERSIONS[pkgName], `${pkgName} vs vendor ${vendorKey}`).toBe(
        manifest.upstreams[vendorKey]?.npmVersion,
      );
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
