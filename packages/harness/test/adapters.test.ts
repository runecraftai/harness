// adapters.test.ts — F15: detecção, injecção, remoção por agente (fixtures).
//
// Mecanismos F21: RUNECRAFT_*_HOME (config dirs fake), XDG_CONFIG_HOME,
// PATH prefix com bins fake (claude/opencode/codex), RUNECRAFT_TASKFLOW_*_BIN
// (bin MCP fake). Nunca toca o ~ real.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { resolveRuntime, type Runtime } from "../src/config.ts";
import { claudeAdapter } from "../src/adapters/claude.ts";
import { opencodeAdapter } from "../src/adapters/opencode.ts";
import { codexAdapter } from "../src/adapters/codex.ts";
import { resolveMcpBin, UpstreamReferenceError } from "../src/adapters/mcpConfig.ts";
import { upsertSection, removeSection, RULES_SECTION } from "../src/adapters/rules.ts";
import { upsertTomlSection, readTomlSection, renderMcpServerBlock } from "../src/toml.ts";
import type { AgentContext } from "../src/adapters/types.ts";

let root: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "harness-adpt-"));
  binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create a fake binary on the PATH prefix. */
function fakeBin(name: string): string {
  const file = path.join(binDir, name);
  writeFileSync(file, "#!/bin/sh\necho fake\n");
  chmodSync(file, 0o755);
  return file;
}

/** Runtime with HOME/PATH/env isolated to the fixture. */
function rt(home: string, extra: Record<string, string> = {}): Runtime {
  return resolveRuntime(root, {
    HOME: home,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    ...extra,
  });
}

/** Runtime with a CLEAN PATH (no real binaries visible — fail-closed tests). */
function cleanRt(home: string, extra: Record<string, string> = {}): Runtime {
  return resolveRuntime(root, {
    HOME: home,
    PATH: binDir,
    ...extra,
  });
}

function ctxFor(rt: Runtime, rulesContent = "regras de teste"): AgentContext {
  return {
    rt,
    mcpBin: "/fake/mcp/bin.js",
    mcpBinCommand: ["node", "/fake/mcp/bin.js"],
    rulesContent,
    mcpArgs: [],
  };
}

describe("detecção (ADPT-01/02)", () => {
  test("bin ausente → fail-closed com installHint (display-only)", async () => {
    const home = path.join(root, "home");
    const r = cleanRt(home);
    const detect = await claudeAdapter.detect(r);
    expect(detect.installed).toBe(false);
    expect(claudeAdapter.installHint.length).toBeGreaterThan(0);
    expect(claudeAdapter.installHint).toContain("claude.ai");
  });

  test("bin fake no PATH → instalado (dir de config é informativo)", async () => {
    fakeBin("claude");
    const home = path.join(root, "home");
    const detect = await claudeAdapter.detect(rt(home));
    expect(detect.installed).toBe(true);
    expect(detect.binPath).toBe(path.join(binDir, "claude"));
  });

  test("opencode respeita XDG_CONFIG_HOME absoluto; codex usa RUNECRAFT_CODEX_HOME", async () => {
    fakeBin("opencode");
    fakeBin("codex");
    const xdg = path.join(root, "xdg");
    const home = path.join(root, "home");
    const o = await opencodeAdapter.detect(rt(home, { XDG_CONFIG_HOME: xdg }));
    expect(opencodeAdapter.paths(rt(home, { XDG_CONFIG_HOME: xdg })).rulesFile).toBe(path.join(xdg, "opencode", "AGENTS.md"));
    expect(o.installed).toBe(true);
    const custom = path.join(root, "custom-codex");
    const c = await codexAdapter.detect(rt(home, { RUNECRAFT_CODEX_HOME: custom }));
    expect(codexAdapter.paths(rt(home, { RUNECRAFT_CODEX_HOME: custom })).rulesFile).toBe(path.join(custom, "AGENTS.md"));
    expect(c.installed).toBe(true);
  });
});

describe("rules.ts (D3/G1): seção com marcadores", () => {
  test("arquivo ausente → criado com a seção", () => {
    const file = path.join(root, "CLAUDE.md");
    const r = upsertSection(file, RULES_SECTION, "conteudo");
    expect(r.created).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain(`<!-- ${RULES_SECTION} -->`);
    expect(text).toContain("<!-- /runecraft:workflow -->");
  });

  test("arquivo com conteúdo do usuário → append, preservado intacto", () => {
    const file = path.join(root, "AGENTS.md");
    writeFileSync(file, "# Meu agente\n\nregras minhas\n", "utf8");
    upsertSection(file, RULES_SECTION, "runecraft");
    const text = fs.readFileSync(file, "utf8");
    expect(text.startsWith("# Meu agente\n\nregras minhas\n")).toBe(true);
    expect(text).toContain("<!-- runecraft:workflow -->");
  });

  test("rerun → upsert no lugar, sem duplicar (idempotência)", () => {
    const file = path.join(root, "CLAUDE.md");
    upsertSection(file, RULES_SECTION, "v1");
    const first = fs.readFileSync(file, "utf8");
    const r2 = upsertSection(file, RULES_SECTION, "v2");
    const second = fs.readFileSync(file, "utf8");
    expect(second.split("<!-- runecraft:workflow -->").length - 1).toBe(1);
    expect(second).toContain("v2");
    expect(second).not.toContain("v1");
    expect(first.length).toBeGreaterThan(0);
    const r3 = upsertSection(file, RULES_SECTION, "v2");
    expect(r3.changed).toBe(false);
  });

  test("BOM preservado; CRLF detectado", () => {
    const file = path.join(root, "CRLF.md");
    writeFileSync(file, "\ufeff# titulo\r\nlinha\r\n", "utf8");
    upsertSection(file, RULES_SECTION, "x");
    const buf = fs.readFileSync(file);
    expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const text = buf.toString("utf8");
    expect(text).toContain("<!-- runecraft:workflow -->\r\n");
  });

  test("coexistência com gentle-ai: seções de outro owner intactas", () => {
    const file = path.join(root, "CLAUDE.md");
    writeFileSync(file, "<!-- gentle-ai:workflow -->\ngentle\n<!-- /gentle-ai:workflow -->\n", "utf8");
    upsertSection(file, RULES_SECTION, "runecraft");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("gentle-ai:workflow");
    expect(text).toContain("runecraft:workflow");
    // remoção remove só a nossa
    const after = removeSection(file, RULES_SECTION);
    expect(after).not.toBeNull();
    expect(after).not.toContain("runecraft:workflow");
    expect(after).toContain("gentle-ai:workflow");
  });
});

describe("mcpConfig.ts (D4): resolveMcpBin + guard anti-upstream", () => {
  test("env override vence", () => {
    const r = rt(path.join(root, "home"), { RUNECRAFT_TASKFLOW_CLAUDE_BIN: "/custom/bin" });
    const res = resolveMcpBin("claude", r);
    expect(res.command).toEqual(["/custom/bin"]);
    expect(res.source).toBe("env");
  });

  test("dev path: resolve o fork local (require.resolve)", () => {
    const r = rt(path.join(root, "home"));
    const res = resolveMcpBin("claude", r);
    expect(res.source).toBe("dev");
    expect(res.command[0]).toBe("node");
    expect(res.command[1]).toContain("packages/taskflow/claude/dist/mcp/bin.js");
  });

  test("guard rejeita upstream no env override (spec npm não-@runecraft)", () => {
    const r = rt(path.join(root, "home"), { RUNECRAFT_TASKFLOW_CLAUDE_BIN: "npx -y -p claude-taskflow@0.2.6 claude-taskflow-mcp" });
    expect(() => resolveMcpBin("claude", r)).toThrow(UpstreamReferenceError);
  });

  test("guard aceita o bin do nosso fork (nome preservado por design, D4)", () => {
    const r = rt(path.join(root, "home"), { RUNECRAFT_TASKFLOW_CLAUDE_BIN: "claude-taskflow-mcp" });
    const res = resolveMcpBin("claude", r);
    expect(res.command[0]).toBe("claude-taskflow-mcp");
  });
});

describe("toml.ts: upsert [mcp_servers.taskflow]", () => {
  test("cria bloco; preserva seções existentes byte a byte", () => {
    const file = path.join(root, "config.toml");
    writeFileSync(file, "# comentario\n[model]\nmodel = \"gpt\"\n", "utf8");
    const block = renderMcpServerBlock("taskflow", ["node", "/x/bin.js"], { tool_timeout_sec: 1800 });
    upsertTomlSection(file, "taskflow", block, true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("# comentario");
    expect(text).toContain("[model]\nmodel = \"gpt\"");
    expect(readTomlSection(file, "taskflow")).toContain("tool_timeout_sec = 1800");
  });

  test("rerun substitui no lugar (idempotente)", () => {
    const file = path.join(root, "config.toml");
    const block = renderMcpServerBlock("taskflow", ["node", "/x/bin.js"]);
    upsertTomlSection(file, "taskflow", block, true);
    const first = fs.readFileSync(file, "utf8");
    upsertTomlSection(file, "taskflow", renderMcpServerBlock("taskflow", ["node", "/y/bin.js"]), true);
    const second = fs.readFileSync(file, "utf8");
    expect(second).toContain("/y/bin.js");
    expect(second.split("[mcp_servers.taskflow]").length - 1).toBe(1);
    expect(first).not.toEqual(second);
  });
});

describe("claudeAdapter.inject/remove (ADPT-05/06/07)", () => {
  test("inject cria CLAUDE.md + .mcp.json com entry taskflow; remove só o nosso", async () => {
    fakeBin("claude");
    const home = path.join(root, "home");
    const r = rt(home);
    const inject = await claudeAdapter.inject(ctxFor(r));
    expect(inject.written.length).toBe(2);
    const rules = fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
    expect(rules).toContain("runecraft:workflow");
    const mcp = JSON.parse(fs.readFileSync(path.join(home, ".claude", ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.taskflow.command).toBe("node");
    expect(mcp.mcpServers.taskflow.args[0]).toContain("bin.js");

    // rerun → idempotente (zero mudanças)
    const before = fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
    await claudeAdapter.inject(ctxFor(r));
    expect(fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8")).toBe(before);

    // usuário adiciona conteúdo + seção gentle-ai
    fs.appendFileSync(path.join(home, ".claude", "CLAUDE.md"), "<!-- gentle-ai:x -->\ng\n<!-- /gentle-ai:x -->\n");

    const remove = await claudeAdapter.remove({
      ...ctxFor(r),
      targets: [{ kind: "rules", file: path.join(home, ".claude", "CLAUDE.md"), section: RULES_SECTION, contentHash: "x" }],
    });
    const afterRules = fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
    expect(afterRules).not.toContain("runecraft:workflow");
    expect(afterRules).toContain("gentle-ai:x");
    expect(remove.removed.length).toBeGreaterThan(0);
  });

  test("entry MCP editada pelo usuário → preserva + reporta (D7)", async () => {
    fakeBin("claude");
    const home = path.join(root, "home");
    const r = rt(home);
    await claudeAdapter.inject(ctxFor(r));
    const mcpFile = path.join(home, ".claude", ".mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
    mcp.mcpServers.taskflow.args = ["/user/edited"];
    writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");
    const remove = await claudeAdapter.remove({
      ...ctxFor(r),
      targets: [{ kind: "mcp", file: mcpFile, entry: "taskflow", contentHash: "hash-diferente" }],
    });
    expect(remove.edited.length).toBe(1);
    expect(fs.existsSync(mcpFile)).toBe(true);
  });

  test("config JSON inválida → erro isolado (D2), arquivo intocado", async () => {
    fakeBin("claude");
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude", ".mcp.json"), "{ invalido", "utf8");
    const r = rt(home);
    expect(claudeAdapter.inject(ctxFor(r))).rejects.toThrow();
  });

  test("~/.claude.json nunca é tocado (D8)", async () => {
    fakeBin("claude");
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude.json"), '{"oauth": true}', "utf8");
    const r = rt(home);
    await claudeAdapter.inject(ctxFor(r));
    await claudeAdapter.remove(ctxFor(r));
    expect(fs.readFileSync(path.join(home, ".claude.json"), "utf8")).toBe('{"oauth": true}');
  });
});

describe("opencode/codex inject", () => {
  test("opencode: AGENTS.md + opencode.json mcp.taskflow", async () => {
    fakeBin("opencode");
    const home = path.join(root, "home");
    const r = rt(home, { XDG_CONFIG_HOME: path.join(root, "xdg") });
    const inject = await opencodeAdapter.inject(ctxFor(r));
    expect(inject.written.length).toBe(2);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "xdg", "opencode", "opencode.json"), "utf8"));
    expect(cfg.mcp.taskflow.type).toBe("local");
    expect(cfg.mcp.taskflow.enabled).toBe(true);
  });

  test("codex: AGENTS.md + config.toml [mcp_servers.taskflow] com tool_timeout_sec", async () => {
    fakeBin("codex");
    const home = path.join(root, "home");
    const r = rt(home);
    const inject = await codexAdapter.inject(ctxFor(r));
    expect(inject.written.length).toBe(2);
    const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    expect(toml).toContain("[mcp_servers.taskflow]");
    expect(toml).toContain("tool_timeout_sec = 1800");
  });
});
