// eval/goldens.test.ts — goldens de assets (F23 D4): byte a byte + limites de
// tamanho + determinismo do render (bins MCP pinados via env) + equivalência
// com o que o adapter injeta de verdade (anti-drift: renderMcpEntry é a mesma
// fonte usada pelos adapters F15).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { countLines, goldenDefs, GOLDEN_DIR, MCP_FIXTURE_BINS, pinnedEnv, renderMcpGolden, renderSectionWorkflow, SECTION_WORKFLOW_ID } from "./goldens.ts";
import { markersFor } from "../../src/sections.ts";
import { renderRules } from "../../src/adapters/rulesContent.ts";
import { renderMcpConfig } from "../../src/adapters/mcpConfig.ts";
import { mcpEntry } from "../../src/adapters/claude.ts";
import type { AgentContext } from "../../src/adapters/types.ts";

const AGENT_CTX = { mcpBin: MCP_FIXTURE_BINS["claude-code"], mcpBinCommand: [MCP_FIXTURE_BINS["claude-code"]] } as AgentContext;

describe("goldens — byte a byte (D4)", () => {
  const defs = goldenDefs();

  test("registro estável: 5 goldens, nomes únicos e ordem fixa", () => {
    expect(defs).toHaveLength(5);
    expect(defs.map((d) => d.name)).toEqual([
      "section-workflow-pi.golden",
      "section-workflow-nonpi.golden",
      "mcp-claude.golden",
      "mcp-opencode.golden",
      "mcp-codex.golden",
    ]);
  });

  test("cada golden existe e o render atual == arquivo (byte a byte)", () => {
    for (const def of defs) {
      const file = path.join(GOLDEN_DIR, def.name);
      expect(fs.existsSync(file), `${def.name} ausente`).toBe(true);
      const content = fs.readFileSync(file, "utf8");
      const actual = def.render();
      expect(actual, def.name).toBe(content);
      expect(actual.length, def.name).toBe(content.length);
    }
  });

  test("limites de tamanho (calibrados no Execute — regras 46/25 + 2 markers)", () => {
    for (const def of defs) {
      expect(countLines(def.render()), def.name).toBeLessThanOrEqual(def.maxLines);
    }
  });

  test("seção workflow: markers html + regras do F19 (pi vs não-pi)", () => {
    const markers = markersFor("html", SECTION_WORKFLOW_ID);
    const pi = renderSectionWorkflow("pi");
    const nonpi = renderSectionWorkflow("non-pi");
    expect(pi.startsWith(`${markers.open}\n`)).toBe(true);
    expect(pi.endsWith(`${markers.close}\n`)).toBe(true);
    expect(pi).toContain(renderRules("pi"));
    expect(nonpi).toContain(renderRules("claude-code"));
    expect(pi).not.toBe(nonpi);
  });
});

describe("goldens — determinismo (D4: env fixado no teste)", () => {
  test("bins MCP pinados via RUNECRAFT_TASKFLOW_*_BIN (env fixture, nunca executados)", () => {
    const env = pinnedEnv();
    expect(env.RUNECRAFT_TASKFLOW_CLAUDE_BIN).toBe("/test/fixtures/bin/claude-taskflow-mcp");
    expect(env.RUNECRAFT_TASKFLOW_OPENCODE_BIN).toBe("/test/fixtures/bin/opencode-taskflow-mcp");
    expect(env.RUNECRAFT_TASKFLOW_CODEX_BIN).toBe("/test/fixtures/bin/codex-taskflow-mcp");
    // O render passa por resolveMcpBin com override de env (fonte "env").
    const claude = renderMcpGolden("claude-code", env);
    expect(claude).toContain("/test/fixtures/bin/claude-taskflow-mcp");
    expect(claude).not.toContain("npx");
    expect(claude).not.toContain("node_modules");
  });

  test("renderMcpConfig(claude) == entry que o adapter F15 injeta (mcpEntry)", () => {
    const rendered = renderMcpConfig("claude-code", AGENT_CTX);
    const entry = mcpEntry(AGENT_CTX);
    expect(rendered).toBe(`${JSON.stringify(entry, null, 2)}\n`);
  });

  test("determinismo: rerun do render = byte a byte idêntico", () => {
    const env = pinnedEnv();
    for (const def of goldenDefs()) {
      const a = def.render();
      const b = def.render();
      expect(a).toBe(b);
      for (let i = 0; i < a.length; i++) expect(a.charCodeAt(i)).toBe(b.charCodeAt(i));
    }
    expect(renderMcpGolden("codex", env)).toBe(renderMcpGolden("codex", pinnedEnv()));
  });
});

describe("goldens — regeneração via --update (D6)", () => {
  test("updateGoldens num dir temp regrava bytes idênticos (roundtrip)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f23-golden-"));
    try {
      const { updateGoldens } = await import("./update.ts");
      updateGoldens(tmp);
      for (const def of goldenDefs()) {
        const regenerated = fs.readFileSync(path.join(tmp, def.name), "utf8");
        expect(regenerated).toBe(def.render());
        expect(regenerated).toBe(fs.readFileSync(path.join(GOLDEN_DIR, def.name), "utf8"));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
