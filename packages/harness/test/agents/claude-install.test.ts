// agents/claude-install.test.ts — B1: alvo claudeAgents no install/sync +
// seção runecraft:routing no CLAUDE.md (directive codificada).
//
// CLI integration (dispatch in-process + fake pi + fake claude bin — padrão
// F21 camada 1): install --agent claude-code materializa os 7 papéis em
// ~/.claude/agents/ (byte-idênticos aos assets) e registra `claudeAgents` no
// state com contentHash (F13); a seção runecraft:routing é injetada no
// CLAUDE.md pelo motor F18 (F19 D7 — 2ª seção após o workflow); 2º sync
// idempotente (zero writes — LIFE 3.2); edição do usuário → preservada;
// uninstall remove as seções gerenciadas.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, writeSettings, type Sandbox } from "../helpers.ts";
import { claudeAgentsAssetsDir } from "../../src/adapters/claudeAgents.ts";
import { roleAgentsDir } from "../../src/agents/materialize.ts";
import { listSnapshots } from "../../src/backup.ts";
import { ROLE_IDS } from "../../src/agents/catalog.ts";

const ASSETS = claudeAgentsAssetsDir();

function sandboxWithClaude(): Sandbox & { claudeHome: string; binDir: string } {
  const sb = makeSandbox() as Sandbox & { claudeHome: string; binDir: string };
  // fake bin `claude` no PATH + HOME do Claude isolado (env override D9).
  sb.binDir = path.join(sb.dir, "bin");
  fs.mkdirSync(sb.binDir, { recursive: true });
  const fake = path.join(sb.binDir, "claude");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(fake, 0o755);
  sb.claudeHome = path.join(sb.dir, "claude-home");
  sb.env.PATH = `${sb.binDir}:${sb.env.PATH ?? ""}`;
  sb.env.RUNECRAFT_CLAUDE_HOME = sb.claudeHome;
  return sb;
}

function readState(sb: Sandbox, file: string): Record<string, unknown> {
  return fs.existsSync(file) ? (readJson(file) as Record<string, unknown>) : {};
}

describe("install --agent claude-code (B1)", () => {
  test("materializa 7 papéis em ~/.claude/agents/ + seção runecraft:routing + registros", async () => {
    const sb = sandboxWithClaude();
    try {
      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("papéis objetivos do Claude Code materializados");

      const agentsDir = path.join(sb.claudeHome, "agents");
      for (const id of ROLE_IDS) {
        const target = path.join(agentsDir, `${id}.md`);
        expect(fs.existsSync(target), `${id}.md ausente`).toBe(true);
        // byte-idêntico ao asset do pacote
        expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(ASSETS, `${id}.md`), "utf8"));
      }

      // CLAUDE.md com as duas seções gerenciadas (workflow + routing B1).
      const rules = fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8");
      expect(rules).toContain("runecraft:workflow");
      expect(rules).toContain("runecraft:routing");

      // registros claudeAgents com contentHash + targets (rules/routing/mcp).
      const stateFile = path.join(sb.runecraftHome, "state.json");
      const state = readState(sb, stateFile);
      const claudeAgents = (state.claudeAgents ?? {}) as Record<string, { contentHash: string; assetVersion: string }>;
      expect(Object.keys(claudeAgents).sort()).toEqual([...ROLE_IDS].sort());
      for (const id of ROLE_IDS) {
        expect(claudeAgents[id]?.contentHash.length).toBe(64);
        expect(claudeAgents[id]?.assetVersion).toBe("1");
      }
      const agent = (state.agents as Record<string, { targets: Array<{ section?: string; kind: string }> }>)["claude-code"];
      expect(agent?.targets.map((t) => t.section).filter(Boolean).sort()).toEqual(["runecraft:routing", "runecraft:workflow"]);
    } finally {
      sb.cleanup();
    }
  });

  test("rerun idempotente: CLAUDE.md byte-idêntico + registros claudeAgents/agents estáveis", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const before = fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8");
      const stateFile = path.join(sb.runecraftHome, "state.json");
      const stateBefore = readState(sb, stateFile);
      const claudeAgentsBefore = JSON.stringify(stateBefore.claudeAgents);
      const agentsBefore = JSON.stringify(stateBefore.agents);

      const result = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      expect(result.code).toBe(0);
      expect(fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8")).toBe(before);
      // O state muda apenas no preInstall (snapshot novo por run — contrato
      // F13); os registros gerenciados (claudeAgents + agents) ficam estáveis.
      const stateAfter = readState(sb, stateFile);
      expect(JSON.stringify(stateAfter.claudeAgents)).toBe(claudeAgentsBefore);
      expect(JSON.stringify(stateAfter.agents)).toBe(agentsBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("edição do usuário no agent file → sync preserva (F19 D7 — nunca auto-cura)", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const target = path.join(sb.claudeHome, "agents", "builder.md");
      const userEdit = "---\nname: builder\n---\nmeu builder\n";
      fs.writeFileSync(target, userEdit, "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("preservado (editado");
      expect(fs.readFileSync(target, "utf8")).toBe(userEdit);
    } finally {
      sb.cleanup();
    }
  });

  test("agent file deletado à mão → sync re-injeta (missing → copia)", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      fs.rmSync(path.join(sb.claudeHome, "agents", "planner.md"));

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(fs.existsSync(path.join(sb.claudeHome, "agents", "planner.md"))).toBe(true);
      expect(fs.readFileSync(path.join(sb.claudeHome, "agents", "planner.md"), "utf8")).toBe(
        fs.readFileSync(path.join(ASSETS, "planner.md"), "utf8"),
      );
    } finally {
      sb.cleanup();
    }
  });

  test("uninstall remove as seções gerenciadas; agent files permanecem (dados do usuário — não removidos)", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const result = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(result.code).toBe(0);
      // CLAUDE.md ficou vazio (só as 2 seções gerenciadas) → arquivo removido
      // (D6 — arquivo vazio após remoção é deletado).
      const rulesFile = path.join(sb.claudeHome, "CLAUDE.md");
      if (fs.existsSync(rulesFile)) {
        const rules = fs.readFileSync(rulesFile, "utf8");
        expect(rules).not.toContain("runecraft:workflow");
        expect(rules).not.toContain("runecraft:routing");
      }
      // Agent files NÃO são removidos pelo uninstall (materialização é
      // re-injectável via sync; dados = assets versionados — não orfanam).
      expect(fs.existsSync(path.join(sb.claudeHome, "agents", "builder.md"))).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("status --json: seção claudeRoleAgents + claudeRouting + capabilities (B0/B1)", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        claudeRoleAgents: { claudeDetected: boolean; managed: boolean; installed: string[]; total: number };
        routing: { claudeSection: { managed: boolean; present: boolean; registered: boolean } };
        capabilities: { valid: boolean; digest: string; agents: Array<{ agent: string }> };
      };
      expect(json.claudeRoleAgents.claudeDetected).toBe(true);
      expect(json.claudeRoleAgents.managed).toBe(true);
      expect(json.claudeRoleAgents.installed).toHaveLength(7);
      expect(json.claudeRoleAgents.total).toBe(7);
      expect(json.routing.claudeSection.present).toBe(true);
      expect(json.routing.claudeSection.registered).toBe(true);
      expect(json.capabilities.valid).toBe(true);
      expect(json.capabilities.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(json.capabilities.agents.map((a) => a.agent)).toContain("claude-code");
    } finally {
      sb.cleanup();
    }
  });

  test("doctor check 24 (claude role agents) + check 25 (capability manifest)", async () => {
    const sb = sandboxWithClaude();
    try {
      writeSettings(sb, []); // o doctor exige settings.json global válido (F12)
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const result = await runHarness(sb, ["doctor", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { checks: Array<{ id: number; status: string; name: string; detail: string }> };
      const check24 = json.checks.find((c) => c.id === 24);
      const check25 = json.checks.find((c) => c.id === 25);
      expect(check24?.status).toBe("pass");
      expect(check25?.status).toBe("pass");
      expect(check24?.detail).toContain("7 papéis materializados");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — snapshot pré-write cobre os role files (F32 + B1)", () => {
  test("manifest do snapshot contém .pi/agents/*.md E ~/.claude/agents/*.md", async () => {
    const sb = sandboxWithClaude();
    try {
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--agent", "pi,claude-code", "--scope", "workspace", "--yes"], { cwd: project });
      // ambos os conjuntos de role files materializados
      expect(fs.existsSync(path.join(project, ".pi", "agents"))).toBe(true);
      expect(fs.existsSync(path.join(sb.claudeHome, "agents"))).toBe(true);

      // força mudança no sync (package removido → reinstala) para o snapshot
      // pré-write ser criado com os dois conjuntos presentes no disco.
      const wsSettings = path.join(project, ".pi", "settings.json");
      const settings = readJson(wsSettings);
      settings.packages = (settings.packages as string[]).filter((p) => !p.includes("@runecraft/subagents"));
      fs.writeFileSync(wsSettings, JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["sync", "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Reinstalado (1)");

      const syncSnap = listSnapshots(path.join(project, ".runecraft", "backups")).find((s) => s.reason === "sync");
      expect(syncSnap).toBeDefined();
      const files = syncSnap!.files;
      const piAgentsDir = roleAgentsDir(project);
      const claudeDir = path.join(sb.claudeHome, "agents");
      for (const id of ROLE_IDS) {
        expect(files, `${id}.md: .pi/agents ausente do snapshot`).toContain(path.join(piAgentsDir, `${id}.md`));
        expect(files, `${id}.md: ~/.claude/agents ausente do snapshot`).toContain(path.join(claudeDir, `${id}.md`));
      }
    } finally {
      sb.cleanup();
    }
  });
});
