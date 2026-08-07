// f18-coexistence.test.ts — F18: coexistência multi-agente (MXST-01..05).
//
// Cobre: motor de seções com família shell (F20), detecção de donos
// (gentle-ai, upstreams Pi, MCP upstream com QUALQUER nome de entry, conteúdo
// do usuário), doctor consolidado 7–15 (14 gentle-ai, 15 upstreams, check 10
// estendido), status two-driver (estado upstream/colisão + Owners), gate de
// install (MXST-04) e lock de escrita. Sandbox F21 com PATH mínimo + HOME
// fake (o detectOwners resolve ~/.gentle-ai via env.HOME).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendPackages, makeSandbox, makeSandboxCleanPath, readJson, runHarness, settingsFile, stateFile, writeSettings, type Sandbox } from "./helpers.ts";
import { hasSectionFamily, listSectionIds, removeSectionFamily, upsertSectionFamily } from "../src/sections.ts";
import { detectOwners, scanMcpUpstreams } from "../src/owners.ts";
import { createPiInterop } from "../src/pi.ts";
import { resolveRuntime } from "../src/config.ts";

/** Sandbox com HOME fake (detecção gentle-ai) + PATH mínimo + fake claude. */
function sandboxOwners(): Sandbox & { home: string; binDir: string } {
  const sb = makeSandboxCleanPath() as Sandbox & { home: string; binDir: string };
  sb.home = path.join(sb.dir, "home");
  sb.env.HOME = sb.home;
  const binDir = path.join(sb.dir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "claude");
  fs.writeFileSync(fake, "#!/bin/sh\necho fake\n");
  fs.chmodSync(fake, 0o755);
  sb.env.PATH = `${binDir}:${sb.env.PATH}`;
  sb.env.RUNECRAFT_TASKFLOW_CLAUDE_BIN = path.join(binDir, "mcp-fake.js");
  sb.env.RUNECRAFT_CLAUDE_HOME = path.join(sb.dir, "claude-home");
  writeSettings(sb, []);
  sb.binDir = binDir;
  return sb;
}

describe("sections — motor com família shell (F18, F20 consumidor)", () => {
  test("upsert/has/remove com marcadores # BEGIN/# END; idempotente", () => {
    const file = "/tmp/harness-f18-shell-test.sh";
    try {
      const created = upsertSectionFamily(file, "runecraft:workflow", "echo hi", "shell");
      expect(created.changed).toBe(true);
      expect(created.created).toBe(true);
      const content = fs.readFileSync(file, "utf8");
      expect(content).toContain("# BEGIN runecraft:workflow");
      expect(content).toContain("# END runecraft:workflow");
      expect(hasSectionFamily(file, "runecraft:workflow", "shell")).toBe(true);

      // update in-place (mesmo id, conteúdo novo)
      const updated = upsertSectionFamily(file, "runecraft:workflow", "echo hi2", "shell");
      expect(updated.replaced).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toContain("echo hi2");
      expect(fs.readFileSync(file, "utf8")).not.toContain("echo hi\n");

      // idempotência
      const rerun = upsertSectionFamily(file, "runecraft:workflow", "echo hi2", "shell");
      expect(rerun.changed).toBe(false);

      // remoção de OUTRO id não toca a nossa
      expect(removeSectionFamily(file, "runecraft:other", "shell")).toBeNull();
      expect(hasSectionFamily(file, "runecraft:workflow", "shell")).toBe(true);

      // listSectionIds (família shell) e remoção da nossa (o motor retorna o
      // conteúdo novo — quem grava é o caller, mesmo contrato do rules.ts)
      expect(listSectionIds(file, "shell")).toEqual(["runecraft:workflow"]);
      const removed = removeSectionFamily(file, "runecraft:workflow", "shell");
      expect(removed).not.toBeNull();
      if (removed !== null) fs.writeFileSync(file, removed, "utf8");
      expect(hasSectionFamily(file, "runecraft:workflow", "shell")).toBe(false);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test("conteúdo do usuário + seção de outro owner não são tocados pelo update in-place", () => {
    const file = "/tmp/harness-f18-coexist.txt";
    try {
      fs.writeFileSync(file, "# meu\n<!-- gentle-ai:x -->\ng\n<!-- /gentle-ai:x -->\n", "utf8");
      upsertSectionFamily(file, "runecraft:workflow", "r1", "html");
      upsertSectionFamily(file, "runecraft:workflow", "r2", "html"); // update
      const content = fs.readFileSync(file, "utf8");
      expect(content).toContain("# meu");
      expect(content).toContain("<!-- gentle-ai:x -->\ng\n<!-- /gentle-ai:x -->");
      expect(content).toContain("r2");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("owners — detecção de donos (MXST-03)", () => {
  test("gentle-ai: state file presente → owner installer warn", () => {
    const sb = sandboxOwners();
    try {
      fs.mkdirSync(path.join(sb.home, ".gentle-ai"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, ".gentle-ai", "state.json"), "{}");
      const rt = resolveRuntime(sb.dir, sb.env);
      const report = detectOwners(rt, createPiInterop(rt));
      const gentleAi = report.owners.filter((o) => o.name === "gentle-ai");
      expect(gentleAi.length).toBe(1);
      expect(gentleAi[0]?.severity).toBe("warn");
      expect(gentleAi[0]?.kind).toBe("installer");
    } finally {
      sb.cleanup();
    }
  });

  test("gentle-ai: marcadores gentle-ai: no CLAUDE.md → owner warn por arquivo", () => {
    const sb = sandboxOwners();
    try {
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      fs.mkdirSync(claudeHome, { recursive: true });
      fs.writeFileSync(path.join(claudeHome, "CLAUDE.md"), "<!-- gentle-ai:workflow -->\nx\n<!-- /gentle-ai:workflow -->\n", "utf8");
      const rt = resolveRuntime(sb.dir, sb.env);
      const report = detectOwners(rt, createPiInterop(rt));
      const gentleAi = report.owners.filter((o) => o.name === "gentle-ai");
      expect(gentleAi.length).toBe(1);
      expect(gentleAi[0]?.file).toContain("CLAUDE.md");
      expect(report.byFile[path.join(claudeHome, "CLAUDE.md")]?.length).toBeGreaterThan(0);
    } finally {
      sb.cleanup();
    }
  });

  test("upstreams Pi (settings) → owner package warn (two-driver)", () => {
    const sb = sandboxOwners();
    try {
      writeSettings(sb, ["npm:pi-subagents"]);
      const rt = resolveRuntime(sb.dir, sb.env);
      const report = detectOwners(rt, createPiInterop(rt));
      expect(report.owners.some((o) => o.kind === "package" && o.severity === "warn")).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("scanMcpUpstreams: entry com QUALQUER nome (codex-taskflow) é detectada", () => {
    const sb = sandboxOwners();
    try {
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      fs.mkdirSync(claudeHome, { recursive: true });
      fs.writeFileSync(
        path.join(claudeHome, ".mcp.json"),
        JSON.stringify({ mcpServers: { "codex-taskflow": { type: "stdio", command: "npx", args: ["-y", "-p", "codex-taskflow@0.2.6", "codex-taskflow-mcp"] } } }, null, 2),
      );
      const rt = resolveRuntime(sb.dir, sb.env);
      const found = scanMcpUpstreams(rt);
      expect(found).toHaveLength(1);
      expect(found[0]?.entry).toBe("codex-taskflow");
      // e o detectOwners agrega como owner mcp warn
      const report = detectOwners(rt, createPiInterop(rt));
      expect(report.owners.some((o) => o.kind === "mcp" && o.name === "codex-taskflow")).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("conteúdo do usuário sem marcadores → info, nunca bloqueia", () => {
    const sb = sandboxOwners();
    try {
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      fs.mkdirSync(claudeHome, { recursive: true });
      fs.writeFileSync(path.join(claudeHome, "CLAUDE.md"), "# regras do usuário\n", "utf8");
      const rt = resolveRuntime(sb.dir, sb.env);
      const report = detectOwners(rt, createPiInterop(rt));
      const user = report.owners.find((o) => o.name === "usuário");
      expect(user?.severity).toBe("info");
      expect(user?.kind).toBe("content");
    } finally {
      sb.cleanup();
    }
  });

  test("codex: seção [mcp_servers.X] DUPLICADA — upstream no segundo bloco é detectado (fix review)", () => {
    const sb = sandboxOwners();
    try {
      const codexHome = path.join(sb.dir, "codex-home");
      sb.env.RUNECRAFT_CODEX_HOME = codexHome;
      fs.mkdirSync(codexHome, { recursive: true });
      // réplica do achado F17 (config.toml real): seção taskflow 2x — a
      // primeira vazia, a segunda com comando upstream. readTomlSection só
      // vê a primeira → scan por blocos cobre.
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        "[mcp_servers.taskflow]\n[mcp_servers.taskflow]\ncommand = \"npx\"\nargs = [\"-y\", \"-p\", \"codex-taskflow@0.2.6\", \"codex-taskflow-mcp\"]\n",
        "utf8",
      );
      const rt = resolveRuntime(sb.dir, sb.env);
      const found = scanMcpUpstreams(rt);
      expect(found).toHaveLength(1);
      expect(found[0]?.agent).toBe("codex");
      expect(found[0]?.entry).toBe("taskflow");
    } finally {
      sb.cleanup();
    }
  });

  test("codex: args multiline não trunca a detecção de upstream (fix review)", () => {
    const sb = sandboxOwners();
    try {
      const codexHome = path.join(sb.dir, "codex-home");
      sb.env.RUNECRAFT_CODEX_HOME = codexHome;
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        "[mcp_servers.taskflow]\ncommand = \"npx\"\nargs = [\n  \"-y\",\n  \"-p\",\n  \"codex-taskflow@0.2.6\",\n  \"codex-taskflow-mcp\",\n]\n",
        "utf8",
      );
      const rt = resolveRuntime(sb.dir, sb.env);
      const found = scanMcpUpstreams(rt);
      expect(found).toHaveLength(1);
      expect(found[0]?.agent).toBe("codex");
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — checks 14/15 + check 10 estendido (MXST-03)", () => {
  test("gentle-ai presente → check 14 warn com remedy de coexistência", async () => {
    const sb = sandboxOwners();
    try {
      fs.mkdirSync(path.join(sb.home, ".gentle-ai"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, ".gentle-ai", "state.json"), "{}");
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0); // warn
      expect(result.stdout).toContain("[14] gentle-ai");
      expect(result.stdout).toContain("coexistência suportada");
    } finally {
      sb.cleanup();
    }
  });

  test("upstream Pi instalado → check 15 warn (absorve check 4 do F12)", async () => {
    const sb = sandboxOwners();
    try {
      writeSettings(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[15] Upstreams Pi");
      expect(result.stdout).toContain("pi remove npm:pi-subagents");
    } finally {
      sb.cleanup();
    }
  });

  test("entry MCP upstream com outro nome (codex-taskflow) → check 10 warn", async () => {
    const sb = sandboxOwners();
    try {
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      fs.mkdirSync(claudeHome, { recursive: true });
      fs.writeFileSync(
        path.join(claudeHome, ".mcp.json"),
        JSON.stringify({ mcpServers: { "codex-taskflow": { type: "stdio", command: "npx", args: ["-y", "-p", "codex-taskflow@0.2.6", "codex-taskflow-mcp"] } } }, null, 2),
      );
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[10] Agentes (colisão MCP)");
      expect(result.stdout).toContain("codex-taskflow");
    } finally {
      sb.cleanup();
    }
  });
});

describe("status — two-driver + Owners (F18)", () => {
  test("upstream do domínio presente + nosso ausente → estado 'upstream'", async () => {
    const sb = sandboxOwners();
    try {
      appendPackages(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as {
        packages: Array<{ component: string; state: string }>;
        owners: Array<{ name: string; kind: string }>;
      };
      const subagents = json.packages.find((p) => p.component === "subagents");
      expect(subagents?.state).toBe("upstream");
      expect(json.owners.some((o) => o.name === "pi-subagents" || o.name === "npm:pi-subagents")).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("upstream + nosso instalado → estado 'colisão' (two-driver)", async () => {
    const sb = sandboxOwners();
    try {
      await runHarness(sb, ["install", "--yes"]);
      appendPackages(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["status", "--json"]);
      const json = JSON.parse(result.stdout) as { packages: Array<{ component: string; state: string }> };
      const subagents = json.packages.find((p) => p.component === "subagents");
      expect(subagents?.state).toBe("colisão");
      // demais domínios sem upstream permanecem ok
      const prReview = json.packages.find((p) => p.component === "pr-review");
      expect(prReview?.state).toBe("ok");
    } finally {
      sb.cleanup();
    }
  });

  test("TTY ganha seção Owners com donos detectados", async () => {
    const sb = sandboxOwners();
    try {
      fs.mkdirSync(path.join(sb.home, ".gentle-ai"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, ".gentle-ai", "state.json"), "{}");
      const result = await runHarness(sb, ["status"]);
      expect(result.stdout).toContain("Owners (detecção F18)");
      expect(result.stdout).toContain("gentle-ai");
    } finally {
      sb.cleanup();
    }
  });
});

describe("install — gate MXST-04", () => {
  test("gentle-ai presente, sem TTY e sem --yes → aborta apontando --yes", async () => {
    const sb = sandboxOwners();
    try {
      fs.mkdirSync(path.join(sb.home, ".gentle-ai"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, ".gentle-ai", "state.json"), "{}");
      const result = await runHarness(sb, ["install"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("gentle-ai");
      expect(result.stderr).toContain("--yes");
      expect(fs.existsSync(stateFile(sb))).toBe(false); // nada escrito
    } finally {
      sb.cleanup();
    }
  });

  test("--yes prossegue e registra os warnings no relatório", async () => {
    const sb = sandboxOwners();
    try {
      fs.mkdirSync(path.join(sb.home, ".gentle-ai"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, ".gentle-ai", "state.json"), "{}");
      const result = await runHarness(sb, ["install", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Colisões detectadas");
      expect(result.stdout).toContain("gentle-ai");
      // instalou mesmo assim
      const state = readJson(stateFile(sb));
      expect(Object.keys(state.components as Record<string, unknown>).length).toBeGreaterThan(0);
    } finally {
      sb.cleanup();
    }
  });
});

describe("uninstall — marcador sem registro é preservado (MXST-02)", () => {
  test("seção runecraft: manual (sem registro) → preservada + reportada", async () => {
    const sb = sandboxOwners();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const rulesFile = path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md");
      // seção manual com id diferente do registrado (runecraft:workflow)
      fs.appendFileSync(rulesFile, "\n<!-- runecraft:manual -->\nminha seção manual\n<!-- /runecraft:manual -->\n");
      const result = await runHarness(sb, ["uninstall", "--agent", "claude-code", "--yes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("preservado (sem registro)");
      const content = fs.readFileSync(rulesFile, "utf8");
      expect(content).toContain("runecraft:manual"); // manual preservada
      expect(content).not.toContain("runecraft:workflow"); // nossa removida
    } finally {
      sb.cleanup();
    }
  });
});

describe("lock — serialização de escrita (F18 Riscos)", () => {
  test("lock ativo → operação aborta com mensagem; stale (> 5 min) é recuperado", async () => {
    const sb = makeSandbox();
    try {
      const lockDir = path.join(sb.runecraftHome, ".lock", "install");
      fs.mkdirSync(lockDir, { recursive: true });
      const blocked = await runHarness(sb, ["install", "--yes"]);
      expect(blocked.code).toBe(1);
      expect(blocked.stderr).toContain("em andamento");

      // stale: mtime antigo → lock recuperado → install prossegue
      const old = new Date(Date.now() - 6 * 60 * 1000);
      fs.utimesSync(lockDir, old, old);
      const recovered = await runHarness(sb, ["install", "--yes"]);
      expect(recovered.code).toBe(0);
      // lock liberado ao final
      expect(fs.existsSync(lockDir)).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});
