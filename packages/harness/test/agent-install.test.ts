// agent-install.test.ts — F15 E2E: install/uninstall --agent via dispatch.
//
// Sandbox F21: RUNECRAFT_*_HOME (config dirs fake), PATH prefix com bins fake
// (claude/opencode/codex), RUNECRAFT_TASKFLOW_*_BIN (bin MCP fake). Nada toca
// o ~ real — o config.ts resolve HOME do env (correção 2026-08-07).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, stateFile, type Sandbox } from "./helpers.ts";

function sandboxWithAgents(fakeBins: string[] = ["claude"]): Sandbox & { binDir: string; claudeHome: string } {
  const sb = makeSandbox() as Sandbox & { binDir: string; claudeHome: string };
  const binDir = path.join(sb.dir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const bin of fakeBins) {
    const file = path.join(binDir, bin);
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n");
    fs.chmodSync(file, 0o755);
  }
  sb.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  sb.env.RUNECRAFT_TASKFLOW_CLAUDE_BIN = path.join(binDir, "mcp-fake.js");
  sb.env.RUNECRAFT_CLAUDE_HOME = path.join(sb.dir, "claude-home");
  sb.binDir = binDir;
  sb.claudeHome = path.join(sb.dir, "claude-home");
  return sb;
}

describe("install --agent (F15 ADPT-01..06)", () => {
  test("claude-code: injeta CLAUDE.md + .mcp.json, registra state.agents, exit 0", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(result.code).toBe(0);
      const claudeHome = sb.claudeHome;

      const rules = fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8");
      expect(rules).toContain("runecraft:workflow");
      const mcp = readJson(path.join(claudeHome, ".mcp.json"));
      expect((mcp.mcpServers as Record<string, unknown>).taskflow).toBeDefined();

      const state = readJson(stateFile(sb));
      const agents = state.agents as Record<string, unknown>;
      expect(agents["claude-code"]).toBeDefined();
      const targets = (agents["claude-code"] as { targets: unknown[] }).targets;
      expect(targets.length).toBe(2);
      expect((targets[0] as { kind: string }).kind).toBe("rules");
      expect((targets[1] as { kind: string }).kind).toBe("mcp");
    } finally {
      sb.cleanup();
    }
  });

  test("fail-closed: bin ausente → exit ≠ 0 + comando display-only, nada escrito", async () => {
    const sb = makeSandbox();
    // PATH limpo: sem bins reais (o ambiente de dev pode ter claude instalado).
    sb.env.PATH = path.join(sb.dir, "emptybin");
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("claude.ai/install.sh");
      expect(result.stderr).toContain("display-only");
      // sem state de agentes
      const state = readJson(stateFile(sb));
      expect((state.agents as Record<string, unknown>)["claude-code"]).toBeUndefined();
    } finally {
      sb.cleanup();
    }
  });

  test("detect-only: --agent cursor → reporta guia, exit 0, não falha", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["install", "--agent", "cursor", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("detect-only");
    } finally {
      sb.cleanup();
    }
  });

  test("misto suportado+não suportado: suportado prossegue, detect-only reportado", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code,cursor", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("detect-only");
    } finally {
      sb.cleanup();
    }
  });

  test("dry-run: plano por agente, zero writes", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("claude-code");
      expect(fs.existsSync(path.join(sb.claudeHome, "CLAUDE.md"))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("--component goal-loop-audit com --agent claude-code → recusa com motivo (F17 fail-closed)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--component", "goal-loop-audit", "--yes"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("extensão Pi");
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall --agent (F15 ADPT-07)", () => {
  test("remove seções runecraft: e entry MCP; preserva conteúdo do usuário", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const claudeHome = sb.claudeHome;
      // instala
      const install = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(install.code).toBe(0);
      // usuário adiciona conteúdo próprio + seção de outro owner
      fs.appendFileSync(path.join(claudeHome, "CLAUDE.md"), "\n<!-- gentle-ai:x -->\ng\n<!-- /gentle-ai:x -->\n");
      // uninstall
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      const rules = fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8");
      expect(rules).not.toContain("runecraft:workflow");
      expect(rules).toContain("gentle-ai:x");
      // state limpo
      const state = readJson(stateFile(sb));
      expect((state.agents as Record<string, unknown>)["claude-code"]).toBeUndefined();
    } finally {
      sb.cleanup();
    }
  });

  test("whitespace do usuário preservado fora do ponto de remoção (fix review)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const claudeHome = sb.claudeHome;
      fs.mkdirSync(claudeHome, { recursive: true });
      // usuário com MUITAS linhas vazias no meio (não na seção)
      const userContent = "# Minhas regras\n\n\n\nlinha importante\n";
      fs.writeFileSync(path.join(claudeHome, "CLAUDE.md"), userContent, "utf8");
      const install = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(install.code).toBe(0);
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      const rules = fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8");
      // as 4 linhas vazias do usuário permanecem intactas (só o ponto de remoção colapsa)
      expect(rules).toContain("# Minhas regras\n\n\n\nlinha importante");
    } finally {
      sb.cleanup();
    }
  });

  test("entry estrangeira → conflito no install, uninstall NÃO a remove (fix review)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const claudeHome = sb.claudeHome;
      fs.mkdirSync(claudeHome, { recursive: true });
      // entry manual estrangeira (upstream) já presente
      fs.writeFileSync(
        path.join(claudeHome, ".mcp.json"),
        JSON.stringify({ mcpServers: { taskflow: { command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] } } }, null, 2) + "\n",
        "utf8",
      );
      const install = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(install.code).toBe(0);
      expect(install.stdout).toContain("conflito");
      // entry estrangeira NÃO foi registrada como nossa (state sem target mcp nosso)
      const state = readJson(stateFile(sb));
      const targets = ((state.agents as Record<string, unknown>)["claude-code"] as { targets: Array<{ kind: string }> }).targets;
      expect(targets.some((t) => t.kind === "mcp")).toBe(false);
      // uninstall → a entry estrangeira permanece
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      const mcp = readJson(path.join(claudeHome, ".mcp.json"));
      expect((mcp.mcpServers as Record<string, unknown>).taskflow).toBeDefined();
      expect(JSON.stringify(mcp)).toContain("claude-taskflow@0.2.6");
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall --agent pi (F15 D6: fluxo F12)", () => {
  test("--agent pi remove packages Pi como --all", async () => {
    const sb = makeSandbox();
    try {
      const install = await runHarness(sb, ["install", "--yes"]);
      expect(install.code).toBe(0);
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "pi", "--yes"]);
      expect(uninstall.code).toBe(0);
      const state = readJson(stateFile(sb));
      expect(Object.keys((state.components as Record<string, unknown>) ?? {})).toHaveLength(0);
    } finally {
      sb.cleanup();
    }
  });
});
