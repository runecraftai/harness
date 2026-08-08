// agents/catalog.test.ts — F32 T2/T3/T4: catálogo ↔ assets, infra de prompts
// portada e template de delegação (ROLE-02/04/05).
//
// Unit puro (fs temp + assets do pacote — D3/D4/D5): validação catalog ↔ .md
// (fail-closed com diagnóstico), port do prompt-loader (sandbox), isAgentEnabled,
// buildKeyTriggersSection/categorizeTools (determinismo — F21 D10) e
// renderDelegationPrompt (política por allowlist — QA-5a: só o builder delega).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROLE_CATALOG,
  ROLE_IDS,
  TOOL_VOCABULARY,
  parseFlatFrontmatter,
  parseToolList,
  validateRoleAssets,
  validateRoleFile,
  roleList,
  type RoleDefinition,
  type Frontmatter,
} from "../../src/agents/catalog.ts";
import { loadPromptFile, isWithinBase } from "../../src/agents/prompt-loader.ts";
import { isAgentEnabled } from "../../src/agents/prompt-utils.ts";
import { categorizeTools, buildKeyTriggersSection } from "../../src/agents/dynamic-prompt-builder.ts";
import { renderDelegationPrompt, canDelegate, BUILDER_DELEGATION_TARGETS } from "../../src/agents/delegation.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AGENTS_DIR = path.join(PACKAGE_ROOT, "agents");

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "f32-catalog-"));
}

describe("ROLE_CATALOG — os 7 papéis objetivos (D3)", () => {
  test("exatamente 7 papéis, ordem determinística", () => {
    expect([...ROLE_IDS]).toEqual(["planner", "builder", "reviewer", "auditor", "scout", "researcher", "security"]);
    expect(roleList().map((r) => r.id)).toEqual([...ROLE_IDS]);
  });

  test("allowlists conforme D3 (fail-closed — só o builder tem subagent)", () => {
    expect(ROLE_CATALOG.planner.tools).toEqual(["read", "grep", "find", "ls", "intercom"]);
    expect(ROLE_CATALOG.builder.tools).toEqual([
      "read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "contact_supervisor", "subagent",
    ]);
    expect(ROLE_CATALOG.reviewer.tools).toEqual(["read", "grep", "find", "ls", "bash", "intercom"]);
    expect(ROLE_CATALOG.auditor.tools).toEqual(["read", "grep", "find", "ls", "bash", "write", "intercom"]);
    expect(ROLE_CATALOG.scout.tools).toEqual(["read", "grep", "find", "ls", "intercom"]);
    expect(ROLE_CATALOG.researcher.tools).toEqual(["read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content", "intercom"]);
    expect(ROLE_CATALOG.security.tools).toEqual(["read", "grep", "find", "ls", "bash", "intercom"]);
    for (const id of ROLE_IDS) {
      const tools = ROLE_CATALOG[id].tools;
      expect(tools.length).toBe(new Set(tools).size); // sem duplicatas
      for (const tool of tools) expect(TOOL_VOCABULARY).toContain(tool);
      if (id === "builder") expect(tools).toContain("subagent");
      else expect(tools).not.toContain("subagent"); // QA-5a: só o builder delega
    }
  });

  test("constraints coerentes (D3/D7)", () => {
    expect(ROLE_CATALOG.auditor.constraints.mdOnly).toBe(true);
    expect(ROLE_CATALOG.builder.constraints.canDelegate).toBe(true);
    for (const id of [...ROLE_IDS]) {
      if (id === "builder") continue;
      expect(ROLE_CATALOG[id].constraints.canDelegate).toBe(false);
    }
    expect(ROLE_CATALOG.planner.constraints.readOnly).toBe(true);
    expect(ROLE_CATALOG.reviewer.constraints.readOnly).toBe(true);
    expect(ROLE_CATALOG.scout.constraints.readOnly).toBe(true);
    expect(ROLE_CATALOG.researcher.constraints.readOnly).toBe(true);
    expect(ROLE_CATALOG.security.constraints.readOnly).toBe(true);
    expect(ROLE_CATALOG.builder.constraints.readOnly).toBe(false);
    expect(ROLE_CATALOG.auditor.constraints.readOnly).toBe(false); // write .md
  });
});

describe("validação catalog ↔ assets (D3 — fail-closed)", () => {
  test("os 7 .md reais do pacote passam na validação", () => {
    for (const id of [...ROLE_IDS]) {
      expect(fs.existsSync(path.join(AGENTS_DIR, `${id}.md`)), `${id}.md ausente`).toBe(true);
    }
    const result = validateRoleAssets(AGENTS_DIR);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("frontmatter parseia no formato do fork (flat keys)", () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, "builder.md"), "utf8");
    const { frontmatter, body } = parseFlatFrontmatter(content);
    expect(frontmatter.name).toBe("builder");
    expect(frontmatter.description!.length).toBeGreaterThan(10);
    expect(parseToolList(frontmatter.tools)).toEqual(ROLE_CATALOG.builder.tools);
    expect(frontmatter.systemPromptMode).toBe("replace");
    expect(body.length).toBeGreaterThan(50);
  });

  test("fail-closed: name != filename", () => {
    const def: RoleDefinition = ROLE_CATALOG.builder;
    const errors: string[] = [];
    validateRoleFile(def, { ...readFrontmatter(def), name: "buildr" }, "body", errors);
    expect(errors.some((e) => e.includes("frontmatter.name"))).toBe(true);
  });

  test("fail-closed: tool fora do vocabulário verificado", () => {
    const def: RoleDefinition = ROLE_CATALOG.scout;
    const errors: string[] = [];
    validateRoleFile(def, { ...readFrontmatter(def), tools: "read, grep, glob" }, "body", errors);
    expect(errors.some((e) => e.includes("glob"))).toBe(true);
    expect(errors.some((e) => e.includes("allowlist"))).toBe(true);
  });

  test("fail-closed: subagent em papel não-delegador", () => {
    const def: RoleDefinition = ROLE_CATALOG.reviewer;
    const errors: string[] = [];
    validateRoleFile(def, { ...readFrontmatter(def), tools: "read, grep, find, ls, bash, intercom, subagent" }, "body", errors);
    expect(errors.some((e) => e.includes("subagent"))).toBe(true);
  });

  test("fail-closed: termo RPG no corpo", () => {
    const def: RoleDefinition = ROLE_CATALOG.planner;
    const errors: string[] = [];
    validateRoleFile(def, readFrontmatter(def), "body com wizard de plantão", errors);
    expect(errors.some((e) => e.includes("wizard"))).toBe(true);
  });

  test("fail-closed: key de frontmatter desconhecida", () => {
    const def: RoleDefinition = ROLE_CATALOG.planner;
    const errors: string[] = [];
    validateRoleFile(def, { ...readFrontmatter(def), "acceptance-role": "read-only" }, "body", errors);
    expect(errors.some((e) => e.includes("acceptance-role"))).toBe(true);
  });
});

/** Frontmatter canônico de um papel (espelho do .md real — p/ casos de erro). */
function readFrontmatter(def: RoleDefinition): Frontmatter {
  const content = fs.readFileSync(path.join(AGENTS_DIR, def.file), "utf8");
  return parseFlatFrontmatter(content).frontmatter;
}

describe("prompt-loader — sandbox do port (D4)", () => {
  test("caminho absoluto → null", () => {
    expect(loadPromptFile("/etc/passwd", makeTmp())).toBeNull();
  });

  test("traversal fora do basePath → null", () => {
    const base = makeTmp();
    fs.writeFileSync(path.join(base, "prompt.md"), "ok");
    expect(loadPromptFile("../prompt.md", path.join(base, "sub"))).toBeNull();
  });

  test("extensão fora de {.md,.txt} → null; ausente → null", () => {
    const base = makeTmp();
    fs.writeFileSync(path.join(base, "prompt.ts"), "x");
    expect(loadPromptFile("prompt.ts", base)).toBeNull();
    expect(loadPromptFile("missing.md", base)).toBeNull();
  });

  test("válido → conteúdo com trim; isWithinBase correto", () => {
    const base = makeTmp();
    fs.writeFileSync(path.join(base, "prompt.md"), "  hello\nworld\n\n");
    expect(loadPromptFile("prompt.md", base)).toBe("hello\nworld");
    expect(loadPromptFile("sub/../prompt.md", base)).toBe("hello\nworld"); // dentro da base
    expect(isWithinBase(path.join(base, "x"), base)).toBe(true);
    expect(isWithinBase(path.join(base, "..", "x"), base)).toBe(false);
  });
});

describe("prompt-utils — isAgentEnabled (D4)", () => {
  test("port fiel: lista ausente → habilitado; lista → match exato", () => {
    expect(isAgentEnabled("builder")).toBe(true);
    expect(isAgentEnabled("builder", [])).toBe(true);
    expect(isAgentEnabled("builder", ["scout"])).toBe(true);
    expect(isAgentEnabled("scout", ["scout"])).toBe(false);
    expect(isAgentEnabled("Builder", ["builder"])).toBe(true); // case-sensitive
  });
});

describe("dynamic-prompt-builder — categorizeTools + buildKeyTriggersSection (D4)", () => {
  test("categorizeTools: read-only × mutation (espelho do fork)", () => {
    const { readOnly, mutation } = categorizeTools(ROLE_CATALOG.builder.tools);
    expect(readOnly).toContain("read");
    expect(readOnly).toContain("intercom");
    expect(readOnly).toContain("contact_supervisor");
    expect(mutation).toEqual(["bash", "edit", "write", "subagent"]);
    expect(categorizeTools(ROLE_CATALOG.scout.tools).mutation).toEqual([]);
  });

  test("buildKeyTriggersSection lista os 7 papéis com tools; 2 runs idênticos", () => {
    const roles = roleList();
    const a = buildKeyTriggersSection(roles);
    const b = buildKeyTriggersSection(roles);
    expect(a).toBe(b);
    for (const id of [...ROLE_IDS]) {
      expect(a).toContain(`### ${id}`);
      expect(a).toContain(ROLE_CATALOG[id].description);
    }
    expect(a).toContain("## Available roles");
    expect(a).toContain("Tools: read, grep, find, ls, intercom"); // scout/planner
    expect(a).toContain("can delegate (subagent)"); // só o builder
  });
});

describe("delegation — renderDelegationPrompt (D5 — QA-5a)", () => {
  test("papel sem subagent no allowlist → null (fail-closed: não spawna)", () => {
    for (const id of ["planner", "reviewer", "auditor", "scout", "researcher", "security"] as const) {
      expect(canDelegate(ROLE_CATALOG[id])).toBe(false);
      expect(renderDelegationPrompt(ROLE_CATALOG[id], roleList())).toBeNull();
    }
  });

  test("builder → instrução de delegação com alvos scout+reviewer e os 7 papéis", () => {
    const rendered = renderDelegationPrompt(ROLE_CATALOG.builder, roleList());
    expect(rendered).not.toBeNull();
    expect(rendered!).toContain("## Delegation");
    expect(rendered!).toContain('subagent({ agent: "scout"');
    expect(rendered!).toContain('subagent({ agent: "reviewer"');
    for (const id of [...ROLE_IDS]) expect(rendered!).toContain(`### ${id}`);
  });

  test("determinismo: 2 runs byte-idênticos (EVAL-065 — F21 D10)", () => {
    const a = renderDelegationPrompt(ROLE_CATALOG.builder, roleList());
    const b = renderDelegationPrompt(ROLE_CATALOG.builder, roleList());
    expect(a).toBe(b);
    expect(BUILDER_DELEGATION_TARGETS).toEqual(["scout", "reviewer"]);
  });
});
