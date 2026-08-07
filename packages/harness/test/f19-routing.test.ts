// f19-routing.test.ts — F19: routing & mental model (ROUT-01..07).
//
// Cobre: renderRules determinístico (D5), variação por coluna (D6 — teste de
// ausência para não-Pi), limites de tamanho, golden do apêndice do ROUTING.md
// (D9 — divergência = vermelho), driver ativo (D8 — leitura do ledger do glla
// com o mesmo predicado do fork), status `session.driver` (TTY + JSON),
// doctor check 16 + check 9 sub-estado "desatualizado (template novo)" e sync
// three-way (D7 — os 4 estados por target rules).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { renderRules, renderWorkflowRules, WORKFLOW_RULES_VERSION } from "../src/adapters/rulesContent.ts";
import { detectActiveDriver, readGllaLedger } from "../src/sessionDriver.ts";
import { sectionContentHash, upsertSectionFamily } from "../src/sections.ts";
import { makeSandbox, makeSandboxCleanPath, readJson, runHarness, stateFile, writeSettings, type Sandbox } from "./helpers.ts";

const ROUTING_DOC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "ROUTING.md");
const RULES_SECTION = "runecraft:workflow";

/** Extrai o bloco golden do ROUTING.md pelos delimitadores estáveis (D9). */
function goldenBlock(agentKey: "pi" | "non-pi"): string {
  const doc = fs.readFileSync(ROUTING_DOC, "utf8");
  const open = `<!-- BEGIN runecraft:golden:${agentKey} -->`;
  const close = `<!-- END runecraft:golden:${agentKey} -->`;
  const start = doc.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const contentStart = start + open.length;
  const end = doc.indexOf(close, contentStart);
  expect(end).toBeGreaterThanOrEqual(0);
  let block = doc.slice(contentStart, end);
  if (block.startsWith("\r\n")) block = block.slice(2);
  else if (block.startsWith("\n")) block = block.slice(1);
  if (block.endsWith("\r\n")) block = block.slice(0, -2);
  else if (block.endsWith("\n")) block = block.slice(0, -1);
  return block;
}

/** Ledger fixture no formato do fork (JSONL de `{type,value,at}`; estado via
 *  eventos `type:"state"` — readState do goal-loop-core.ts). */
function writeGllaLedger(cwd: string, lines: string[]): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "active.jsonl"), lines.join("\n") + "\n", "utf8");
}

function stateEvent(goal: unknown, loop: unknown): string {
  return JSON.stringify({ type: "state", value: { goal, list: [], loop }, at: "2026-08-07T00:00:00.000Z" });
}

/** Sandbox com fake bins de agentes (PATH = fakebin + cleanbin com sh/node). */
function sandboxWithClaude(): Sandbox & { binDir: string } {
  const sb = makeSandboxCleanPath() as Sandbox & { binDir: string };
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

function claudeRulesFile(sb: Sandbox): string {
  return path.join(sb.env.RUNECRAFT_CLAUDE_HOME as string, "CLAUDE.md");
}

function claudeStateRecord(sb: Sandbox): { targets: Array<{ kind: string; component: string; file: string; section: string; contentHash: string; rulesVersion?: string }> } {
  const state = readJson(stateFile(sb));
  const rec = (state.agents as Record<string, { targets: Array<{ kind: string; component: string; file: string; section: string; contentHash: string; rulesVersion?: string }> }>)["claude-code"];
  if (!rec) throw new Error("claude-code sem registro no state");
  return rec;
}

describe("renderRules — determinismo e variação por coluna (D5/D6)", () => {
  test("Pi = 4 ferramentas + two-driver + worker rule; não-Pi = um único texto", () => {
    const pi = renderRules("pi");
    const claude = renderRules("claude-code");
    const opencode = renderRules("opencode");
    const codex = renderRules("codex");

    // Pi: as 4 ferramentas + two-driver + worker rule (template completo).
    expect(pi).toContain("## One driver per session");
    expect(pi).toContain("run as WORKERS under the active driver");
    expect(pi).toContain("## goal-loop-audit");
    expect(pi).toContain("## taskflow — multi-phase DAG work");
    expect(pi).toContain("## subagents — ad-hoc delegation");
    expect(pi).toContain("## pr-review — structured review");

    // Não-Pi: só taskflow-MCP + review via gate (D6 — um texto único).
    expect(claude).toBe(opencode);
    expect(opencode).toBe(codex);
    expect(renderWorkflowRules("claude-code")).toBe(claude);
    expect(claude).toContain("taskflow-MCP");
    expect(claude).toContain("Review/verification inside a flow");
    expect(claude).not.toContain("## One driver per session");
  });

  test("ausência (AC 1.3): grep goal|loop|subagent|pr-review|auditor no não-Pi → zero matches", () => {
    const forbidden = /goal|loop|subagent|pr-review|auditor/i;
    for (const agent of ["claude-code", "opencode", "codex"] as const) {
      expect(renderRules(agent).match(forbidden)).toBeNull();
    }
  });

  test("determinismo (D5): rerun = byte a byte idêntico; header (v1) presente", () => {
    const first = renderRules("pi");
    const second = renderRules("pi");
    expect(first).toBe(second);
    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) expect(first.charCodeAt(i)).toBe(second.charCodeAt(i));
    expect(first.startsWith(`Runecraft workflow rules (v${WORKFLOW_RULES_VERSION})`)).toBe(true);
    expect(WORKFLOW_RULES_VERSION).toBe("1");
    expect(renderRules("claude-code")).toBe(renderRules("claude-code"));
  });

  test("limites de tamanho: pi ≤ 46 linhas (calibrado), não-pi ≤ 25 (D5)", () => {
    // Calibração no Execute: o template Pi do design tem 46 linhas (~2.7 KB);
    // o limite de projeto é "~45 linhas (~2 KB)" — o texto é literal da fonte
    // de verdade (design D5) e a barra foi calibrada para 46 com justificativa.
    expect(renderRules("pi").split("\n").length).toBeLessThanOrEqual(46);
    expect(renderRules("claude-code").split("\n").length).toBeLessThanOrEqual(25);
  });
});

describe("golden — apêndice do ROUTING.md (D9, anti-divergência)", () => {
  test("renderRules('pi') == bloco golden pi (byte a byte)", () => {
    expect(renderRules("pi")).toBe(goldenBlock("pi"));
  });

  test("renderRules(não-Pi) == bloco golden non-pi (os 3 agentes)", () => {
    const golden = goldenBlock("non-pi");
    for (const agent of ["claude-code", "opencode", "codex"] as const) {
      expect(renderRules(agent)).toBe(golden);
    }
  });
});

describe("driver — leitura do ledger do glla (D8, mecanismo validado no source)", () => {
  const activeGoal = { id: "g1", objective: "x", status: "active", policy: "goal", autoContinue: true };

  test("goal ativo com autoContinue → goal-loop", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      writeGllaLedger(dir, [stateEvent(activeGoal, null)]);
      expect(detectActiveDriver(dir)).toBe("goal-loop");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loop ativo → goal-loop (predicado isSupervising do fork)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      writeGllaLedger(dir, [stateEvent(null, { active: true, target: "t", iteration: 1 })]);
      expect(detectActiveDriver(dir)).toBe("goal-loop");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("goal complete/aborted/paused ou active sem autoContinue → sessão (direto)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      for (const status of ["complete", "aborted", "paused"] as const) {
        const goal = { id: "g", status, autoContinue: true };
        fs.rmSync(path.join(dir, ".pi-glla"), { recursive: true, force: true });
        writeGllaLedger(dir, [stateEvent(goal, null)]);
        expect(detectActiveDriver(dir)).toBe("direct");
      }
      // active SEM autoContinue não agenda continuação (isSupervising=false)
      fs.rmSync(path.join(dir, ".pi-glla"), { recursive: true, force: true });
      writeGllaLedger(dir, [stateEvent({ ...activeGoal, autoContinue: false }, null)]);
      expect(detectActiveDriver(dir)).toBe("direct");
      // loop parado
      fs.rmSync(path.join(dir, ".pi-glla"), { recursive: true, force: true });
      writeGllaLedger(dir, [stateEvent(null, { active: false })]);
      expect(detectActiveDriver(dir)).toBe("direct");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sem ledger (glla ausente ou nenhum goal criado) → sessão (direto), sem ruído", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      expect(detectActiveDriver(dir)).toBe("direct");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ledger ilegível → unknown (sem crash — padrão F12 edge)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      // um diretório no lugar do arquivo faz readFileSync falhar (EISDIR)
      fs.mkdirSync(path.join(dir, ".pi-glla"), { recursive: true });
      fs.mkdirSync(path.join(dir, ".pi-glla", "active.jsonl"), { recursive: true });
      expect(detectActiveDriver(dir)).toBe("unknown");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("linha final truncada (mid-write kill) não perde o estado — mesmo comportamento do fork", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f19-drv-"));
    try {
      const file = path.join(dir, ".pi-glla", "active.jsonl");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const good = stateEvent(activeGoal, null);
      fs.writeFileSync(file, good + "\n" + '{"type":"state","value":{"go', "utf8");
      const read = readGllaLedger(dir);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.snapshot.goal?.status).toBe("active");
        expect(read.snapshot.goal?.autoContinue).toBe(true);
      }
      expect(detectActiveDriver(dir)).toBe("goal-loop");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("status — session.driver (ROUT-07)", () => {
  test("goal ativo → TTY 'driver: goal-loop' e --json session.driver goal-loop", async () => {
    const sb = makeSandbox();
    try {
      writeGllaLedger(sb.dir, [
        stateEvent({ id: "g", objective: "x", status: "active", policy: "goal", autoContinue: true }, null),
      ]);
      const tty = await runHarness(sb, ["status"]);
      expect(tty.stdout).toContain("driver: goal-loop");

      const json = await runHarness(sb, ["status", "--json"]);
      const parsed = JSON.parse(json.stdout) as { session: { driver: string } };
      expect(parsed.session.driver).toBe("goal-loop");
    } finally {
      sb.cleanup();
    }
  });

  test("sem goal/loop → TTY 'driver: sessão (direto)' + lembrete de workers; --json direct", async () => {
    const sb = makeSandbox();
    try {
      const tty = await runHarness(sb, ["status"]);
      expect(tty.stdout).toContain("driver: sessão (direto)");
      expect(tty.stdout).toContain("subagents/taskflow são workers compatíveis");

      const json = await runHarness(sb, ["status", "--json"]);
      const parsed = JSON.parse(json.stdout) as { session: { driver: string } };
      expect(parsed.session.driver).toBe("direct");
    } finally {
      sb.cleanup();
    }
  });

  test("sem Pi (bin ausente) → TTY 'driver: —' (goal-loop não existe na coluna)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status"], { piBin: path.join(sb.dir, "no-such-pi") });
      expect(result.stdout).toContain("driver: —");
    } finally {
      sb.cleanup();
    }
  });

  test("ledger ilegível → TTY 'driver: não avaliado' (sem crash)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(path.join(sb.dir, ".pi-glla", "active.jsonl"), { recursive: true });
      const result = await runHarness(sb, ["status"]);
      expect(result.stdout).toContain("driver: não avaliado");
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — check 16 (D8) e check 9 estendido (D7)", () => {
  test("check 16 presente; sem goal → pass 'sessão (direto)'", async () => {
    const sb = makeSandboxCleanPath();
    try {
      writeSettings(sb, []);
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[16] Driver ativo");
      expect(result.stdout).toContain("sessão (direto)");
    } finally {
      sb.cleanup();
    }
  });

  test("goal ativo no cwd → check 16 pass 'goal-loop dirige a sessão'", async () => {
    const sb = makeSandboxCleanPath();
    try {
      writeSettings(sb, []);
      writeGllaLedger(sb.dir, [
        stateEvent({ id: "g", objective: "x", status: "active", policy: "goal", autoContinue: true }, null),
      ]);
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[16] Driver ativo");
      expect(result.stdout).toContain("goal-loop dirige a sessão");
    } finally {
      sb.cleanup();
    }
  });

  test("pi ausente → check 16 skip (dependência do check 1)", async () => {
    const sb = makeSandboxCleanPath();
    try {
      const result = await runHarness(sb, ["doctor"], { piBin: path.join(sb.dir, "no-such-pi") });
      expect(result.stdout).toContain("[16] Driver ativo");
      expect(result.stdout).toContain("skip");
      expect(result.stdout).toContain("pulado — depende do Pi");
    } finally {
      sb.cleanup();
    }
  });

  test("check 9: arquivo == registrado ≠ render → sub-estado 'desatualizado (template novo)'", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      // simula CLI antiga: seção com o texto do template antigo + hash registrado
      // desse texto (arquivo == registrado); o render atual do CLI difere.
      const OLD_TEXT = "# Runecraft Harness (claude-code)\n\nTemplate F15 antigo.";
      upsertSectionFamily(claudeRulesFile(sb), RULES_SECTION, OLD_TEXT, "html");
      const rec = claudeStateRecord(sb);
      const rulesTarget = rec.targets.find((t) => t.kind === "rules");
      if (!rulesTarget) throw new Error("rules target ausente");
      rulesTarget.contentHash = sectionContentHash(RULES_SECTION, OLD_TEXT);
      delete rulesTarget.rulesVersion;
      const state = readJson(stateFile(sb));
      (state.agents as Record<string, unknown>)["claude-code"] = rec;
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1); // check 9 fail com remedy sync
      expect(result.stdout).toContain("[9] Agentes (configs)");
      expect(result.stdout).toContain(`desatualizado (template novo v${WORKFLOW_RULES_VERSION})`);
      expect(result.stdout).toContain("harness sync");
    } finally {
      sb.cleanup();
    }
  });
});

describe("sync — three-way por target rules (D7, ROUT-06)", () => {
  test("arquivo == registrado == render → already in sync, zero writes", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const stateBefore = fs.readFileSync(stateFile(sb), "utf8");
      const rulesBefore = fs.readFileSync(claudeRulesFile(sb), "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("already in sync — zero mudanças");
      expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore);
      expect(fs.readFileSync(claudeRulesFile(sb), "utf8")).toBe(rulesBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("seção ausente do arquivo → re-injetada (F18), usuário preservado", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      fs.writeFileSync(claudeRulesFile(sb), "# só conteúdo do usuário\n", "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("re-injetado (rules ausente)");
      const content = fs.readFileSync(claudeRulesFile(sb), "utf8");
      expect(content).toContain("<!-- runecraft:workflow -->");
      expect(content).toContain("# só conteúdo do usuário");
    } finally {
      sb.cleanup();
    }
  });

  test("arquivo == registrado ≠ render → atualizada (template vN→vM), update in-place + hash novo", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      // CLI antiga: seção com o texto antigo e hash registrado desse texto.
      const OLD_TEXT = "# Runecraft Harness (claude-code)\n\nTemplate F15 antigo.";
      const rulesFile = claudeRulesFile(sb);
      fs.appendFileSync(rulesFile, "\n# conteúdo do usuário fora da seção\n");
      upsertSectionFamily(rulesFile, RULES_SECTION, OLD_TEXT, "html");
      const rec = claudeStateRecord(sb);
      const rulesTarget = rec.targets.find((t) => t.kind === "rules");
      if (!rulesTarget) throw new Error("rules target ausente");
      rulesTarget.contentHash = sectionContentHash(RULES_SECTION, OLD_TEXT);
      delete rulesTarget.rulesVersion;
      const state = readJson(stateFile(sb));
      (state.agents as Record<string, unknown>)["claude-code"] = rec;
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("atualizada (template ?→1)");

      // update in-place pelo ID estável: corpo novo, conteúdo alheio intacto.
      const content = fs.readFileSync(rulesFile, "utf8");
      expect(content).toContain(renderRules("claude-code"));
      expect(content).toContain("# conteúdo do usuário fora da seção");
      expect(content.match(/<!-- runecraft:workflow -->/g)).toHaveLength(1);

      // contentHash novo no state (== hash do render atual) + rerun em sync.
      const after = claudeStateRecord(sb);
      const newTarget = after.targets.find((t) => t.kind === "rules");
      expect(newTarget?.contentHash).toBe(sectionContentHash(RULES_SECTION, renderRules("claude-code")));
      expect(newTarget?.rulesVersion).toBe("1");
      const rerun = await runHarness(sb, ["sync"]);
      expect(rerun.stdout).toContain("already in sync");
    } finally {
      sb.cleanup();
    }
  });

  test("arquivo ≠ registrado (usuário editou) → preserva + reporta, nunca sobrescreve", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const rulesFile = claudeRulesFile(sb);
      // edição dentro dos marcadores (corpo muda; hash registrado fica o antigo)
      upsertSectionFamily(rulesFile, RULES_SECTION, renderRules("claude-code") + "\n\n# nota do usuário", "html");
      const editedContent = fs.readFileSync(rulesFile, "utf8");
      const stateBefore = fs.readFileSync(stateFile(sb), "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("preservada (editada");
      expect(result.stdout).toContain("nunca sobrescreve");
      // zero writes: arquivo e state intactos
      expect(fs.readFileSync(rulesFile, "utf8")).toBe(editedContent);
      expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("rules editada + MCP ausente → rules preservada, MCP re-injetado (preserveRules)", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const claudeHome = sb.env.RUNECRAFT_CLAUDE_HOME as string;
      const rulesFile = path.join(claudeHome, "CLAUDE.md");
      const mcpFile = path.join(claudeHome, ".mcp.json");
      upsertSectionFamily(rulesFile, RULES_SECTION, renderRules("claude-code") + "\n\n# nota do usuário", "html");
      const editedContent = fs.readFileSync(rulesFile, "utf8");
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("preservada (editada");
      expect(result.stdout).toContain("re-injetado (taskflow ausente)");
      // rules do usuário intacta; entry MCP restaurada
      expect(fs.readFileSync(rulesFile, "utf8")).toBe(editedContent);
      expect((readJson(mcpFile).mcpServers as Record<string, unknown>).taskflow).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });

  test("dry-run lista atualização de template sem escrever nada", async () => {
    const sb = sandboxWithClaude();
    try {
      await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
      const OLD_TEXT = "# Runecraft Harness (claude-code)\n\nTemplate F15 antigo.";
      upsertSectionFamily(claudeRulesFile(sb), RULES_SECTION, OLD_TEXT, "html");
      const rec = claudeStateRecord(sb);
      const rulesTarget = rec.targets.find((t) => t.kind === "rules");
      if (!rulesTarget) throw new Error("rules target ausente");
      rulesTarget.contentHash = sectionContentHash(RULES_SECTION, OLD_TEXT);
      delete rulesTarget.rulesVersion;
      const state = readJson(stateFile(sb));
      (state.agents as Record<string, unknown>)["claude-code"] = rec;
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));
      const rulesBefore = fs.readFileSync(claudeRulesFile(sb), "utf8");

      const result = await runHarness(sb, ["sync", "--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("(dry-run) claude-code: atualizar (template ?→1)");
      expect(result.stdout).toContain("DRY-RUN");
      expect(fs.readFileSync(claudeRulesFile(sb), "utf8")).toBe(rulesBefore);
    } finally {
      sb.cleanup();
    }
  });
});
