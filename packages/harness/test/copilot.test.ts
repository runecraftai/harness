// copilot.test.ts — F31: detecção, injecção, remoção do adapter Copilot (VS Code).
//
// Fixtures F21: workspace temp como cwd (QA-4 — alvos repo-level) + fake
// `code` bin no PATH mínimo (AD-017) + fake dirs de extensão github.copilot*
// sob HOME fake + RUNECRAFT_TASKFLOW_CLAUDE_BIN (bin MCP fake — o host do
// copilot REUSA o claude, QA-2). Nunca toca o ~ real. Cobre: detect (bin /
// extensão / ausente com reasons), paths repo-scoped, inject idempotente
// (2 runs byte-idênticos) + conteúdo do usuário preservado, remove por
// fingerprint (edited/preservado/deletado/marcadores não registrados),
// fail-closed do install (sem detecção → recusa + zero writes), BOM/CRLF e
// não-UTF8 (F18).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { resolveRuntime, type Runtime } from "../src/config.ts";
import { copilotAdapter, copilotPaths, detectCopilotSync, findCopilotExtension, vsCodeExtensionRoots } from "../src/adapters/copilot.ts";
import { renderMcpEntry, renderMcpConfig, UpstreamReferenceError, resolveMcpBin } from "../src/adapters/mcpConfig.ts";
import { renderRules } from "../src/adapters/rulesContent.ts";
import { RULES_SECTION } from "../src/adapters/rules.ts";
import { resolveAgentId, isSupportedAgentId } from "../src/adapters/registry.ts";
import { upsertSectionFamily } from "../src/sections.ts";
import type { AgentContext } from "../src/adapters/types.ts";

let root: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "harness-copilot-"));
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

/** Workspace temp + HOME fake + PATH mínimo (bin fake + sh/node do ambiente). */
function rt(workspace: string, extra: Record<string, string> = {}): Runtime {
  return resolveRuntime(workspace, {
    HOME: path.join(root, "home"),
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    ...extra,
  });
}

/** Runtime com PATH limpo (sem bins reais — fail-closed). */
function cleanRt(workspace: string, extra: Record<string, string> = {}): Runtime {
  return resolveRuntime(workspace, {
    HOME: path.join(root, "home"),
    PATH: binDir,
    ...extra,
  });
}

function ctxFor(r: Runtime, rulesContent = "regras de teste"): AgentContext {
  return {
    rt: r,
    mcpBin: "/fake/mcp/bin.js",
    mcpBinCommand: ["node", "/fake/mcp/bin.js"],
    rulesContent,
    mcpArgs: [],
  };
}

describe("detecção (F31 D6 — bin OU extensão; fail-closed com hint)", () => {
  test("bin 'code' fake no PATH → instalado com binPath", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const detect = await copilotAdapter.detect(rt(ws));
    expect(detect.installed).toBe(true);
    expect(detect.binPath).toBe(path.join(binDir, "code"));
    expect(detect.reasons).toEqual([]);
  });

  test("bin 'code-insiders' fake no PATH → instalado (fallback do bin)", async () => {
    fakeBin("code-insiders");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const detect = await copilotAdapter.detect(rt(ws));
    expect(detect.installed).toBe(true);
    expect(detect.binPath).toBe(path.join(binDir, "code-insiders"));
  });

  test("extensão github.copilot-* em ~/.vscode/extensions → instalado (sem bin no PATH)", async () => {
    const home = path.join(root, "home");
    const ext = path.join(home, ".vscode", "extensions", "github.copilot-1.244.0");
    mkdirSync(ext, { recursive: true });
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    // PATH limpo — o bin code NÃO está presente; a extensão decide.
    const detect = await copilotAdapter.detect(cleanRt(ws));
    expect(detect.installed).toBe(true);
    expect(findCopilotExtension({ HOME: home })).toBe(ext);
  });

  test("extensão github.copilot-chat-* em ~/.vscode-insiders → instalado", () => {
    const home = path.join(root, "home");
    const ext = path.join(home, ".vscode-insiders", "extensions", "github.copilot-chat-0.25.2");
    mkdirSync(ext, { recursive: true });
    expect(findCopilotExtension({ HOME: home })).toBe(ext);
  });

  test("nenhum dos dois → not installed + reasons com hint (display-only, nunca executado)", async () => {
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const detect = await copilotAdapter.detect(cleanRt(ws));
    expect(detect.installed).toBe(false);
    expect(detect.reasons.length).toBeGreaterThan(0);
    expect(detect.reasons.join(" ")).toContain("code");
    expect(detect.reasons.join(" ")).toContain("display-only");
    expect(copilotAdapter.installHint.length).toBeGreaterThan(0);
    expect(copilotAdapter.installHint).toContain("GitHub Copilot");
  });

  test("detectCopilotSync (doctor/status): bin OU extensão, síncrono, com reasons", () => {
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const missing = detectCopilotSync(cleanRt(ws).env);
    expect(missing.installed).toBe(false);
    expect(missing.reasons.length).toBeGreaterThan(0);
    fakeBin("code");
    const byBin = detectCopilotSync(rt(ws).env);
    expect(byBin.installed).toBe(true);
    expect(byBin.binPath).toBe(path.join(binDir, "code"));
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".vscode", "extensions", "github.copilot-1.0.0"), { recursive: true });
    const byExt = detectCopilotSync(cleanRt(ws).env);
    expect(byExt.installed).toBe(true);
    expect(byExt.extensionDir).toContain("github.copilot-1.0.0");
  });
});

describe("paths — repo-scoped (D2/D3/D7)", () => {
  test("rulesFile = <cwd>/.github/copilot-instructions.md; mcpFile = <cwd>/.vscode/mcp.json; mcpKey = taskflow", () => {
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const p = copilotAdapter.paths(rt(ws));
    expect(p.rulesFile).toBe(path.join(ws, ".github", "copilot-instructions.md"));
    expect(p.mcpFile).toBe(path.join(ws, ".vscode", "mcp.json"));
    expect(p.mcpKey).toBe("taskflow");
    expect(p.configHome).toBe(path.join(ws, ".vscode"));
    expect(copilotPaths(rt(ws))).toEqual(p);
    expect(vsCodeExtensionRoots(rt(ws).env)).toContain(path.join(root, "home", ".vscode", "extensions"));
  });
});

describe("registry — id copilot + aliases (D1)", () => {
  test("resolveAgentId: copilot/vscode/vscode-copilot/github-copilot → copilot", () => {
    expect(isSupportedAgentId("copilot")).toBe(true);
    expect(resolveAgentId("copilot")).toBe("copilot");
    expect(resolveAgentId("vscode")).toBe("copilot");
    expect(resolveAgentId("vscode-copilot")).toBe("copilot");
    expect(resolveAgentId("github-copilot")).toBe("copilot");
    expect(resolveAgentId("cursor")).toBeUndefined();
  });

  test("renderMcpEntry('copilot'): shape VS Code {type stdio, command}; env opcional", () => {
    const entry = renderMcpEntry("copilot", { mcpBin: "/x/bin.js", mcpBinCommand: ["node", "/x/bin.js"] }) as Record<string, unknown>;
    expect(entry.type).toBe("stdio");
    expect(entry.command).toBe("node");
    expect(entry.args).toEqual(["/x/bin.js"]);
    expect(entry.env).toBeUndefined();
    // env quando presente (mcpEnvironment)
    const withEnv = renderMcpEntry("copilot", { mcpBin: "/x", mcpBinCommand: ["/x"], mcpEnvironment: { A: "1" } }) as Record<string, unknown>;
    expect(withEnv.env).toEqual({ A: "1" });
    // SEM ${input:...} (o Agent Host repassa o resto — D3)
    expect(JSON.stringify(entry)).not.toContain("${input:");
  });

  test("renderMcpConfig('copilot') == arquivo mcp.json completo (2 níveis)", () => {
    const cfg = renderMcpConfig("copilot", { mcpBin: "/x/bin.js", mcpBinCommand: ["node", "/x/bin.js"] });
    const parsed = JSON.parse(cfg) as { servers: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(["servers"]);
    expect(parsed.servers.taskflow).toBeDefined();
    expect(cfg.endsWith("\n")).toBe(true);
    expect(cfg).toBe(`${JSON.stringify({ servers: { taskflow: { type: "stdio", command: "node", args: ["/x/bin.js"] } } }, null, 2)}\n`);
  });

  test("guard anti-upstream: resolveMcpBin do host claude rejeita upstream; nunca taskflow-copilot", () => {
    const r = cleanRt(path.join(root, "ws"), { RUNECRAFT_TASKFLOW_CLAUDE_BIN: "npx -y -p claude-taskflow@0.2.6 claude-taskflow-mcp" });
    expect(() => resolveMcpBin("claude", r)).toThrow(UpstreamReferenceError);
    // O fork do próprio nome é preservado (F16 D4).
    const ok = cleanRt(path.join(root, "ws"), { RUNECRAFT_TASKFLOW_CLAUDE_BIN: "claude-taskflow-mcp" });
    expect(resolveMcpBin("claude", ok).command[0]).toBe("claude-taskflow-mcp");
  });
});

describe("inject/remove round-trip (D2/D3/D9/D10)", () => {
  test("inject cria .github/copilot-instructions.md + .vscode/mcp.json; rerun byte-idêntico", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const r = rt(ws);
    const inject = await copilotAdapter.inject(ctxFor(r, renderRules("copilot")));
    expect(inject.written.length).toBe(2);
    expect(inject.conflicts).toEqual([]);
    const rules = fs.readFileSync(copilotPaths(r).rulesFile, "utf8");
    expect(rules).toContain(`<!-- ${RULES_SECTION} -->`);
    expect(rules).toContain(renderRules("copilot"));
    const mcp = JSON.parse(fs.readFileSync(copilotPaths(r).mcpFile, "utf8")) as { servers: Record<string, unknown> };
    expect(mcp.servers.taskflow).toBeDefined();
    // D5 "validar no Execute": os bytes reais do upsert em arquivo NOVO == o
    // render do golden (fonte única renderMcpConfig — 2-space, nesting 2 níveis).
    const mcpBytes = fs.readFileSync(copilotPaths(r).mcpFile, "utf8");
    expect(mcpBytes).toBe(renderMcpConfig("copilot", { mcpBin: "/fake/mcp/bin.js", mcpBinCommand: ["node", "/fake/mcp/bin.js"] }));

    // rerun → idempotente (byte-idêntico)
    const rulesBefore = fs.readFileSync(copilotPaths(r).rulesFile, "utf8");
    const mcpBefore = fs.readFileSync(copilotPaths(r).mcpFile, "utf8");
    const rerun = await copilotAdapter.inject(ctxFor(r, renderRules("copilot")));
    expect(rerun.written.length).toBe(0);
    expect(fs.readFileSync(copilotPaths(r).rulesFile, "utf8")).toBe(rulesBefore);
    expect(fs.readFileSync(copilotPaths(r).mcpFile, "utf8")).toBe(mcpBefore);
  });

  test("conteúdo do usuário fora do marcador preservado (upsert nunca clobber)", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(path.join(ws, ".github"), { recursive: true });
    writeFileSync(path.join(ws, ".github", "copilot-instructions.md"), "# Minhas instruções\n\n- regra minha\n", "utf8");
    const r = rt(ws);
    await copilotAdapter.inject(ctxFor(r, renderRules("copilot")));
    const text = fs.readFileSync(copilotPaths(r).rulesFile, "utf8");
    expect(text.startsWith("# Minhas instruções\n\n- regra minha\n")).toBe(true);
    expect(text).toContain("runecraft:workflow");
  });

  test("BOM preservado; CRLF detectado (F18)", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(path.join(ws, ".github"), { recursive: true });
    const file = path.join(ws, ".github", "copilot-instructions.md");
    writeFileSync(file, "\ufeff# titulo\r\nlinha\r\n", "utf8");
    const r = rt(ws);
    await copilotAdapter.inject(ctxFor(r));
    const buf = fs.readFileSync(file);
    expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const text = buf.toString("utf8");
    expect(text).toContain(`<!-- ${RULES_SECTION} -->\r\n`);
  });

  test("não-UTF8 → NonUtf8FileError (fail-closed, nunca crash)", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(path.join(ws, ".github"), { recursive: true });
    writeFileSync(path.join(ws, ".github", "copilot-instructions.md"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    const r = rt(ws);
    expect(copilotAdapter.inject(ctxFor(r))).rejects.toThrow();
  });

  test("entry MCP estrangeira (sem registro) → conflict, nunca sobrescrita", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(path.join(ws, ".vscode"), { recursive: true });
    writeFileSync(
      path.join(ws, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { taskflow: { type: "stdio", command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] } } }, null, 2),
    );
    const r = rt(ws);
    const inject = await copilotAdapter.inject(ctxFor(r));
    expect(inject.conflicts.length).toBe(1);
    expect(inject.conflicts[0]?.entry).toBe("taskflow");
    const mcp = fs.readFileSync(copilotPaths(r).mcpFile, "utf8");
    expect(mcp).toContain("claude-taskflow@0.2.6"); // intacta
  });

  test("remove por fingerprint: entry nossa removida; arquivo vazio deletado", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const r = rt(ws);
    await copilotAdapter.inject(ctxFor(r));
    const rulesFile = copilotPaths(r).rulesFile;
    const mcpFile = copilotPaths(r).mcpFile;
    const fingerprint = copilotAdapter.readMcpFingerprint(r);
    expect(fingerprint).not.toBeNull();

    const remove = await copilotAdapter.remove({
      ...ctxFor(r),
      targets: [
        { kind: "rules", file: rulesFile, section: RULES_SECTION, contentHash: "x" },
        { kind: "mcp", file: mcpFile, entry: "taskflow", contentHash: fingerprint ?? "" },
      ],
    });
    expect(remove.removed).toContain(mcpFile);
    // rules: o arquivo tinha só a seção → removida → deletado (D6)
    expect(fs.existsSync(rulesFile)).toBe(false);
    expect(fs.existsSync(mcpFile)).toBe(false);
    expect(remove.deleted).toContain(rulesFile);
    expect(remove.deleted).toContain(mcpFile);
  });

  test("entry MCP editada pelo usuário → preserva + reporta edited (D7)", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const r = rt(ws);
    await copilotAdapter.inject(ctxFor(r));
    const mcpFile = copilotPaths(r).mcpFile;
    const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8")) as { servers: { taskflow: { args?: string[] } } };
    mcp.servers.taskflow.args = ["/user/edited"];
    writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");
    const remove = await copilotAdapter.remove({
      ...ctxFor(r),
      targets: [{ kind: "mcp", file: mcpFile, entry: "taskflow", contentHash: "hash-diferente" }],
    });
    expect(remove.edited.length).toBe(1);
    expect(fs.existsSync(mcpFile)).toBe(true);
  });

  test("marcadores runecraft: de OUTROS ids → preservados (F18); conteúdo do usuário intacto", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(path.join(ws, ".github"), { recursive: true });
    const rulesFile = path.join(ws, ".github", "copilot-instructions.md");
    writeFileSync(rulesFile, "# user\n", "utf8");
    upsertSectionFamily(rulesFile, RULES_SECTION, "seção não registrada", "html");
    upsertSectionFamily(rulesFile, "runecraft:outro", "bloco alheio", "html");
    const r = rt(ws);
    const remove = await copilotAdapter.remove(ctxFor(r)); // sem targets registrados
    // O contrato F15: remove o bloco runecraft:workflow; seções de OUTROS
    // ids (runecraft:outro) e conteúdo do usuário ficam intactos (F18
    // MXST-02 — o uninstall reporta os marcadores sem registro, nunca os
    // remove; ver agentOps.uninstallAgent).
    expect(remove.removed).toEqual([rulesFile]);
    const after = fs.readFileSync(rulesFile, "utf8");
    expect(after).toContain("# user");
    expect(after).not.toContain("runecraft:workflow");
    expect(after).toContain("runecraft:outro");
  });

  test("readMcpFingerprint/readMcpEntry: mesmas funções no registro e remoção", async () => {
    fakeBin("code");
    const ws = path.join(root, "ws");
    mkdirSync(ws, { recursive: true });
    const r = rt(ws);
    expect(copilotAdapter.readMcpFingerprint(r)).toBeNull();
    expect(copilotAdapter.readMcpEntry(r)).toBeNull();
    await copilotAdapter.inject(ctxFor(r));
    const entry = copilotAdapter.readMcpEntry(r) as { type: string };
    expect(entry.type).toBe("stdio");
    const fp = copilotAdapter.readMcpFingerprint(r);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
