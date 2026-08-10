// f17-matrix.test.ts — F17: matriz de componentes por agente (MATR-01..05).
//
// Sandbox F21: fake bins (claude/opencode/codex) no PATH + homes fake
// (RUNECRAFT_*_HOME) + RUNECRAFT_TASKFLOW_*_BIN para o bin MCP. Nada toca o
// ambiente real. Cobre: matriz declarativa (unit), fail-closed por célula no
// install, status cruzando 3 fontes (configs × state × matriz), doctor checks
// 7–13 e sync por conteúdo com órfãs de matriz.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandboxCleanPath, readJson, runHarness, stateFile, writeSettings, type Sandbox } from "./helpers.ts";
import { AGENTS, MATRIX, columnComponents, firstUnsupported, type ComponentId } from "../src/matrix.ts";
import { isUpstreamMcpEntry } from "../src/adapters/mcpConfig.ts";

/**
 * Sandbox com fake bins de agentes (PATH = fakebin + cleanbin com sh/node;
 * os bins REAIS do ambiente ficam de fora — determinismo).
 */
function sandboxWithAgents(fakeBins: string[] = ["claude"]): Sandbox & { binDir: string } {
  const sb = makeSandboxCleanPath() as Sandbox & { binDir: string };
  const binDir = path.join(sb.dir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const bin of fakeBins) {
    const file = path.join(binDir, bin);
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n");
    fs.chmodSync(file, 0o755);
  }
  sb.env.PATH = `${binDir}:${sb.env.PATH}`;
  sb.env.RUNECRAFT_TASKFLOW_CLAUDE_BIN = path.join(binDir, "mcp-fake.js");
  sb.env.RUNECRAFT_CLAUDE_HOME = path.join(sb.dir, "claude-home");
  // settings.json do Pi presente (check 2/5 do doctor exigem); install de
  // agente não-Pi não cria — pré-criado vazio.
  writeSettings(sb, []);
  sb.binDir = binDir;
  return sb;
}

describe("matrix — declarativa (F17 D1)", () => {
  test("Pi = coluna completa: 4 grupos pi-packages + rules/guards native", () => {
    expect(MATRIX.pi.subagents?.kind).toBe("pi-packages");
    expect(MATRIX.pi.taskflow?.kind).toBe("pi-packages");
    expect(MATRIX.pi["goal-loop-audit"]?.kind).toBe("pi-packages");
    expect(MATRIX.pi["pr-review"]?.kind).toBe("pi-packages");
    expect(MATRIX.pi.rules?.kind).toBe("native");
    expect(MATRIX.pi.guards?.kind).toBe("native"); // F24 D9: guards Pi-only
    expect(AGENTS.pi.display).toBe("Pi");
  });

  test("não-Pi = taskflow mcp + rules + 4 células unsupported com motivo", () => {
    // F31: copilot entra no loop (coluna aditiva — D8).
    for (const agent of ["claude-code", "opencode", "codex", "copilot"] as const) {
      const column = MATRIX[agent];
      expect(column.taskflow?.kind).toBe("mcp");
      expect(column.rules?.kind).toBe("rules");
      expect((column.rules as { section: string }).section).toBe("runecraft:workflow");
      for (const component of ["subagents", "goal-loop-audit", "pr-review", "guards"] as const) {
        const cell = column[component];
        expect(cell?.kind).toBe("unsupported");
        expect((cell as { reason: string }).reason).toContain("é extensão Pi; use --agent pi");
        // Phase A: toda célula unsupported carrega o plano nativo (roadmap).
        expect((cell as { reason: string }).reason).toContain("planned:");
      }
    }
    // F31 D8: AGENTS.copilot declarado (display + nota honesta).
    expect(AGENTS.copilot.display).toBe("Copilot (VS Code)");
    expect(AGENTS.copilot.binary).toBe("code");
    expect(AGENTS.copilot.note).toContain("repo-scoped");
  });

  test("columnComponents = coluna inteira (sem native); fora da matriz não tem célula", () => {
    // unsupported são células da coluna — incluídas; `native` (rules/guards no Pi) é no-op
    expect(columnComponents("claude-code")).toEqual(["taskflow", "rules", "subagents", "goal-loop-audit", "pr-review", "guards"]);
    expect(columnComponents("copilot")).toEqual(["taskflow", "rules", "subagents", "goal-loop-audit", "pr-review", "guards"]);
    expect(columnComponents("pi")).toEqual(["subagents", "taskflow", "goal-loop-audit", "pr-review"]);
    // detect-only (fora da matriz): sem célula → firstUnsupported nunca recusa
    expect((MATRIX as Record<string, unknown>).cursor).toBeUndefined();
  });

  test("células unsupported carregam o plano nativo por agente (Phase A)", () => {
    // O refusal lê "v1", não "nunca" — fonte do plano: docs/PARITY.md.
    expect((MATRIX["claude-code"].subagents as { reason: string }).reason).toContain("planned: agent files");
    expect((MATRIX["claude-code"].guards as { reason: string }).reason).toContain("planned: PreToolUse hooks");
    expect((MATRIX["codex"].guards as { reason: string }).reason).toContain("planned: PreToolUse hooks");
    expect((MATRIX["codex"].subagents as { reason: string }).reason).toContain("planned: codex exec");
    expect((MATRIX["opencode"].subagents as { reason: string }).reason).toContain("planned: overlay agents");
    expect((MATRIX["copilot"].subagents as { reason: string }).reason).toContain("planned: runSubagent");
    // Copilot guards honestos: sem superfície de hooks — v1 detect-only.
    expect((MATRIX["copilot"].guards as { reason: string }).reason).toContain("detect-only");
  });

  test("firstUnsupported: par agente×componente com motivo; pares ok → undefined", () => {
    const blocked = firstUnsupported(["claude-code"], ["subagents"]);
    expect(blocked?.reason).toBe("subagents é extensão Pi; use --agent pi; planned: agent files (~/.claude/agents/) + Task tool (B1)");
    // F31: copilot bloqueia os mesmos componentes Pi-only (D8).
    const copilotBlocked = firstUnsupported(["copilot"], ["guards"]);
    expect(copilotBlocked?.agent).toBe("copilot");
    expect(copilotBlocked?.reason).toContain("guards é extensão Pi");
    // taskflow é suportado no claude-code → sem bloqueio
    expect(firstUnsupported(["claude-code"], ["taskflow"])).toBeUndefined();
    expect(firstUnsupported(["copilot"], ["taskflow"])).toBeUndefined();
    // misto: subagents é ok para o Pi, mas o par não-Pi bloqueia
    expect(firstUnsupported(["pi", "claude-code"], ["subagents"])).not.toBeUndefined();
    // componente fora da coluna (sem célula) → sem bloqueio (detect-only cobre)
    expect(firstUnsupported(["claude-code"], ["rules"])).toBeUndefined();
  });

  test("isUpstreamMcpEntry: JSON e TOML detectam referência upstream", () => {
    expect(
      isUpstreamMcpEntry({ type: "stdio", command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] }),
    ).toBe(true);
    expect(
      isUpstreamMcpEntry({ type: "local", command: ["node", "/abs/dist/mcp/bin.js"], enabled: true }),
    ).toBe(false);
    expect(
      isUpstreamMcpEntry('command = "npx"\nargs = ["-y", "-p", "codex-taskflow@0.2.6", "codex-taskflow-mcp"]'),
    ).toBe(true);
    expect(isUpstreamMcpEntry('command = "node"\nargs = ["/abs/bin.js"]')).toBe(false);
    expect(isUpstreamMcpEntry(null)).toBe(false);
  });
});

describe("install — fail-closed por célula via matriz (MATR-03)", () => {
  test("--agent claude-code --component subagents → recusa com o motivo da célula", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--component", "subagents", "--yes"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("subagents é extensão Pi; use --agent pi");
      // nada escrito
      expect(fs.existsSync(path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md"))).toBe(false);
      expect(fs.existsSync(stateFile(sb))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("misto pi + claude-code com --component subagents → recusa (par não-Pi bloqueia)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "pi,claude-code", "--component", "subagents", "--yes"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("extensão Pi");
    } finally {
      sb.cleanup();
    }
  });

  test("--component taskflow com --agent claude-code → coluna completa aplicada (2 células)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--component", "taskflow", "--yes"]);
      expect(result.code).toBe(0);
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      expect(fs.readFileSync(path.join(claudeHome, "CLAUDE.md"), "utf8")).toContain("runecraft:workflow");
      expect((readJson(path.join(claudeHome, ".mcp.json")).mcpServers as Record<string, unknown>).taskflow).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });

  test("mesmo componente em 2 agentes → registrado por agente (sem dedup); uninstall de 1 não toca o outro", async () => {
    const sb = sandboxWithAgents(["claude", "opencode"]);
    try {
      sb.env.RUNECRAFT_OPENCODE_HOME = path.join(sb.dir, "opencode-home");
      sb.env.RUNECRAFT_TASKFLOW_OPENCODE_BIN = path.join(sb.binDir, "mcp-fake.js");
      const install = await runHarness(sb, ["install", "--agent", "claude-code,opencode", "--yes"]);
      expect(install.code).toBe(0);
      const state = readJson(stateFile(sb));
      const agents = state.agents as Record<string, { targets: Array<{ kind: string; file: string }> }>;
      // registros independentes: cada agente com rules+mcp nos SEUS arquivos
      const claudeRec = agents["claude-code"];
      const opencodeRec = agents["opencode"];
      if (!claudeRec || !opencodeRec) throw new Error("agentes não registrados no state");
      expect(claudeRec.targets.some((t) => t.kind === "mcp")).toBe(true);
      expect(opencodeRec.targets.some((t) => t.kind === "mcp")).toBe(true);
      expect(claudeRec.targets.find((t) => t.kind === "mcp")?.file).not.toBe(
        opencodeRec.targets.find((t) => t.kind === "mcp")?.file,
      );
      // uninstall só do claude → opencode intacto (config + state)
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      expect(fs.existsSync(path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md"))).toBe(false);
      expect(fs.existsSync(path.join(sb.env.RUNECRAFT_OPENCODE_HOME as string, "AGENTS.md"))).toBe(true);
      const after = readJson(stateFile(sb));
      const agentsAfter = after.agents as Record<string, unknown>;
      expect(agentsAfter["claude-code"]).toBeUndefined();
      expect(agentsAfter["opencode"]).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — 3 fontes por agente (MATR-02)", () => {
  test("agente gerenciado: células rules/taskflow ok; unsupported com reason no JSON", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        agents: Array<{ agent: string; detected: boolean; managed: boolean; components: Array<{ component: string; supported: boolean; state?: string; reason?: string }> }>;
      };
      const claude = json.agents.find((a) => a.agent === "claude-code");
      expect(claude?.detected).toBe(true);
      expect(claude?.managed).toBe(true);
      const rules = claude?.components.find((c) => c.component === "rules");
      expect(rules?.state).toBe("ok");
      const taskflow = claude?.components.find((c) => c.component === "taskflow");
      expect(taskflow?.state).toBe("ok");
      const subagents = claude?.components.find((c) => c.component === "subagents");
      expect(subagents?.supported).toBe(false);
      expect(subagents?.reason).toContain("extensão Pi; use --agent pi");
    } finally {
      sb.cleanup();
    }
  });

  test("detectado sem instalar → 'não gerenciado'; não detectado → '—'", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as {
        agents: Array<{ agent: string; detected: boolean; managed: boolean; components: Array<{ component: string; state?: string }> }>;
      };
      const claude = json.agents.find((a) => a.agent === "claude-code");
      expect(claude?.detected).toBe(true);
      expect(claude?.managed).toBe(false);
      expect(claude?.components.find((c) => c.component === "rules")?.state).toBe("não gerenciado");
      // opencode sem bin → célula não avaliada
      const opencode = json.agents.find((a) => a.agent === "opencode");
      expect(opencode?.detected).toBe(false);
      expect(opencode?.components.find((c) => c.component === "taskflow")?.state).toBe("—");
    } finally {
      sb.cleanup();
    }
  });

  test("entry upstream manual → célula taskflow 'colisão' (não sobrescrita)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      fs.mkdirSync(claudeHome, { recursive: true });
      fs.writeFileSync(
        path.join(claudeHome, ".mcp.json"),
        JSON.stringify({ mcpServers: { taskflow: { type: "stdio", command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] } } }, null, 2),
      );
      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as {
        agents: Array<{ agent: string; components: Array<{ component: string; state?: string }> }>;
      };
      const claude = json.agents.find((a) => a.agent === "claude-code");
      expect(claude?.components.find((c) => c.component === "taskflow")?.state).toBe("colisão");
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — checks 7–13 por agente (F17 D3)", () => {
  test("check 9: seção registrada removida do arquivo → fail com remedy sync", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const rulesFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md");
      fs.writeFileSync(rulesFile, "# só conteúdo do usuário\n", "utf8");
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[9] Agentes (configs)");
      expect(result.stdout).toContain("ausente");
      expect(result.stdout).toContain("harness sync");
    } finally {
      sb.cleanup();
    }
  });

  test("check 10: entry MCP upstream → warn (exit 0), remédio sem sobrescrever", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const mcpFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, ".mcp.json");
      fs.writeFileSync(
        mcpFile,
        JSON.stringify({ mcpServers: { taskflow: { type: "stdio", command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] } } }, null, 2),
      );
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0); // warn
      expect(result.stdout).toContain("[10] Agentes (colisão MCP)");
      expect(result.stdout).toContain("upstream");
    } finally {
      sb.cleanup();
    }
  });

  test("check 11: .mcp.json com JSON inválido → fail apontando arquivo", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const mcpFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, ".mcp.json");
      fs.writeFileSync(mcpFile, "{ broken", "utf8");
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[11] Agentes (config parseável)");
      expect(result.stdout).toContain("JSON inválido");
      expect(result.stdout).toContain(mcpFile);
    } finally {
      sb.cleanup();
    }
  });

  test("check 13: target órfão no state (matriz mudou) → warn, arquivo preservado", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const state = readJson(stateFile(sb));
      const rec = (state.agents as Record<string, { targets: unknown[] }>)["claude-code"];
      if (!rec) throw new Error("claude-code sem registro no state");
      rec.targets.push({ kind: "rules", component: "ghost", file: "/x/ghost.md", section: "runecraft:workflow", contentHash: "h" });
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0); // warn
      expect(result.stdout).toContain("[13] Agentes (órfãs de matriz)");
      expect(result.stdout).toContain("órfão");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — reconciliação por conteúdo + órfãs (MATR-05/D6)", () => {
  test("seção removida do arquivo (arquivo existe) → re-injeta, preserva usuário", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const rulesFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md");
      fs.writeFileSync(rulesFile, "# só conteúdo do usuário\n", "utf8");
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("re-injetado");
      const content = fs.readFileSync(rulesFile, "utf8");
      expect(content).toContain("runecraft:workflow");
      expect(content).toContain("# só conteúdo do usuário");
    } finally {
      sb.cleanup();
    }
  });

  test("entry MCP removida (arquivo existe) → re-injeta", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const mcpFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, ".mcp.json");
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("re-injetado");
      expect((readJson(mcpFile).mcpServers as Record<string, unknown>).taskflow).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });

  test("só agente pendente (sem packages) → sync roda (não in-sync) e registra targets", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      // remove entry + target mcp do state (simula coluna nova / registro perdido)
      const mcpFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, ".mcp.json");
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
      const state = readJson(stateFile(sb));
      const rec = (state.agents as Record<string, { targets: Array<{ kind: string }> }>)["claude-code"];
      if (!rec) throw new Error("claude-code sem registro no state");
      rec.targets = rec.targets.filter((t) => t.kind !== "mcp");
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));
      // sem packages no state → antes do F17 o sync retornava in-sync sem agir
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("re-injetado");
      expect((readJson(mcpFile).mcpServers as Record<string, unknown>).taskflow).toBeDefined();
      // target registrado de novo → uninstall remove o arquivo inteiro
      const after = readJson(stateFile(sb));
      const targets = ((after.agents as Record<string, { targets: Array<{ kind: string }> }>)["claude-code"])?.targets ?? [];
      expect(targets.some((t) => t.kind === "mcp")).toBe(true);
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      expect(fs.existsSync(mcpFile)).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("target órfão → reportado, nunca removido; demais células em sync", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const state = readJson(stateFile(sb));
      const rec = (state.agents as Record<string, { targets: unknown[] }>)["claude-code"];
      if (!rec) throw new Error("claude-code sem registro no state");
      rec.targets.push({ kind: "rules", component: "ghost", file: "/x/ghost.md", section: "runecraft:workflow", contentHash: "h" });
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("órfão");
      const after = readJson(stateFile(sb));
      const targets = ((after.agents as Record<string, { targets: Array<{ component: string }> }>)["claude-code"])?.targets ?? [];
      expect(targets.some((t) => t.component === "ghost")).toBe(true); // nunca removido
    } finally {
      sb.cleanup();
    }
  });

  test("órfã + seção faltante: re-injeta a seção E preserva o órfão no state (fix review)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const rulesFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md");
      fs.writeFileSync(rulesFile, "# só usuário\n", "utf8"); // seção removida
      const state = readJson(stateFile(sb));
      const rec = (state.agents as Record<string, { targets: Array<{ kind: string; component: string; file: string; section: string; contentHash: string }> }>)["claude-code"];
      if (!rec) throw new Error("claude-code sem registro no state");
      rec.targets.push({ kind: "rules", component: "ghost", file: "/x/ghost.md", section: "runecraft:workflow", contentHash: "h" });
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("re-injetado");
      expect(result.stdout).toContain("órfão");
      // seção re-injetada + conteúdo do usuário preservado
      const content = fs.readFileSync(rulesFile, "utf8");
      expect(content).toContain("runecraft:workflow");
      expect(content).toContain("# só usuário");
      // órfão AINDA no state após a reescrita dos targets (fix review)
      const after = readJson(stateFile(sb));
      const targets = ((after.agents as Record<string, { targets: Array<{ component: string }> }>)["claude-code"])?.targets ?? [];
      expect(targets.some((t) => t.component === "ghost")).toBe(true);
      // uninstall ainda remove as seções NOSSAS (órfão não atrapalha)
      const uninstall = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(uninstall.code).toBe(0);
      expect(fs.readFileSync(rulesFile, "utf8")).not.toContain("runecraft:workflow");
    } finally {
      sb.cleanup();
    }
  });

  test("rules ausente + mcp ilegível: rules re-injetada, MCP preservado, reporte honesto (fix review 2)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      const rulesFile = path.join(claudeHome, "CLAUDE.md");
      const mcpFile = path.join(claudeHome, ".mcp.json");
      fs.writeFileSync(rulesFile, "# só usuário\n", "utf8"); // seção removida
      fs.writeFileSync(mcpFile, "{ broken", "utf8"); // config ilegível
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      // reporte honesto: rules foi restaurada, MCP não (etapa falhou)
      expect(result.stdout).toContain("rules re-injetada");
      expect(result.stdout).toContain("etapa MCP falhou");
      expect(fs.readFileSync(rulesFile, "utf8")).toContain("runecraft:workflow");
      expect(fs.readFileSync(mcpFile, "utf8")).toBe("{ broken"); // MCP intacto
      // sync seguinte converge (rules ok → só a nota de ilegível permanece)
      const rerun = await runHarness(sb, ["sync"]);
      expect(rerun.stdout).not.toContain("re-injetada");
      expect(rerun.stdout).toContain("ilegível");
    } finally {
      sb.cleanup();
    }
  });

  test("config MCP ilegível → sync NÃO crasha, reporta, preserva o arquivo (fix review)", async () => {
    const sb = sandboxWithAgents(["claude"]);
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const mcpFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, ".mcp.json");
      fs.writeFileSync(mcpFile, "{ broken", "utf8");
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0); // sem crash; nada pendente além do ilegível
      expect(result.stdout).toContain("ilegível");
      expect(result.stdout).not.toContain("re-injetado"); // não sobrescreve config quebrada
      expect(fs.readFileSync(mcpFile, "utf8")).toBe("{ broken"); // arquivo intacto
    } finally {
      sb.cleanup();
    }
  });
});
