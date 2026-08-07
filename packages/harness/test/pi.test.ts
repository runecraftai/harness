// pi.test.ts — defensive parsing + collision scan (no spawns).
import { describe, expect, test } from "bun:test";
import { npmIdentity, parsePiList } from "../src/pi.ts";
import { scanConflicts } from "../src/commands/install.ts";
import { buildPlan } from "../src/plan.ts";

describe("parsePiList — defensivo (formato varia entre versões do pi)", () => {
  test("formato real (indentação + path)", () => {
    const out = [
      "User packages:",
      "  npm:@tintinweb/pi-subagents",
      "    /home/u/.pi/agent/npm/node_modules/@tintinweb/pi-subagents",
      "  npm:pi-mcp-adapter",
      "    /home/u/.pi/agent/npm/node_modules/pi-mcp-adapter",
      "Project packages:",
      "  npm:@foo/bar",
      "    /proj/.pi/npm/node_modules/@foo/bar",
      "",
    ].join("\n");
    expect(parsePiList(out)).toEqual(["npm:@tintinweb/pi-subagents", "npm:pi-mcp-adapter", "npm:@foo/bar"]);
  });

  test("linhas vazias/headers/paths não viram entries", () => {
    expect(parsePiList("User packages:\n\n  /abs/path\n  ./rel/path\n")).toEqual([]);
  });

  test("specs git/locais preservados", () => {
    const out = ["User packages:", "  git:github.com/user/repo", "    /home/u/.pi/agent/git/github.com/user/repo"].join("\n");
    expect(parsePiList(out)).toEqual(["git:github.com/user/repo"]);
  });
});

describe("npmIdentity", () => {
  test("remove o pin de versão do npm spec", () => {
    expect(npmIdentity("npm:@runecraft/subagents@0.37.2")).toBe("npm:@runecraft/subagents");
    expect(npmIdentity("npm:pi-mcp-adapter")).toBe("npm:pi-mcp-adapter");
    expect(npmIdentity("git:github.com/user/repo@v1")).toBe("git:github.com/user/repo@v1");
  });
});

describe("scanConflicts (CLI-09)", () => {
  test("detecta upstreams e variantes scoped", () => {
    const conflicts = scanConflicts([
      "npm:pi-subagents",
      "npm:@tintinweb/pi-taskflow",
      "npm:@runecraft/subagents", // não é upstream — não deve conflitar
      "npm:pi-goal-list-loop-audit",
    ]);
    expect(conflicts.map((c) => c.package)).toEqual([
      "npm:pi-subagents",
      "npm:@tintinweb/pi-taskflow",
      "npm:pi-goal-list-loop-audit",
    ]);
    for (const c of conflicts) expect(c.suggestion).toMatch(/^pi remove /);
  });

  test("packages do próprio harness não conflitam", () => {
    const plan = buildPlan("minimal", undefined);
    expect(scanConflicts(plan.specs)).toEqual([]);
  });
});
