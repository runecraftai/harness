// framework/parity.test.ts — EVAL-079..084: Phase B0+B1 (parity engineering —
// capability manifest + Claude Code roles & routing) via framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — agentes são DADOS; sem
// relógio/path absoluto em identidade — F21 D10):
//   EVAL-079 capability manifest — validateManifest ok (estrutura fechada),
//     digest byte-estável (2 runs — F21 D10), wiring matrix.ts: as células
//     unsupported consomem o capabilityReason do manifest (sem drift);
//   EVAL-080 claude agent assets — os 7 agent files do Claude Code são
//     válidos (frontmatter name/description/tools; tools ⊆ vocabulário
//     verificado; SÓ o builder com a tool de delegação Agent — QA-5
//     espelhado); deny-list RPG ausente;
//   EVAL-081 routing directive — renderClaudeRoutingSection determinístico,
//     thresholds explícitos, segurança OBRIGATÓRIA, delegação via a tool
//     nativa (Task tool / Agent), os 7 papéis listados; golden byte-igual;
//   EVAL-082 materialização three-way — install --agent claude-code →
//     ~/.claude/agents/ com os 7 arquivos byte-idênticos + registros no
//     state; 2º sync idempotente (zero writes — LIFE 3.2); edição do usuário
//     → preservada (F19 D7);
//   EVAL-083 doctor checks 24/25 — claude role agents + capability manifest
//     pass após o install (gate claude detectado + gerenciado);
//   EVAL-084 status smoke — seção capabilities (B0) + claudeRoleAgents +
//     claudeRouting (B1) no status --json.
//
// Delta vs EVAL-001..078 documentado (D6 — sem double-test): os cases novos
// cobrem a ADIÇÃO do B0/B1 (manifest como fonte única + papéis do Claude +
// directive de routing como seção) — o three-way do F32 (EVAL-057..066)
// provou o mecanismo; aqui o alvo é ~/.claude/agents/ e o render do
// directive é o do Claude.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { evalTest } from "../helpers/evalTest.ts";
import { makeSandbox, readJson, runHarness, writeSettings } from "../../helpers.ts";
import { dispatch } from "../../../src/cli.ts";
import { validateManifest, manifestDigest, capabilityReason, claimFor } from "../../../src/capabilities/manifest.ts";
import { MATRIX } from "../../../src/matrix.ts";
import { validateClaudeAgentAssets, claudeAgentsAssetsDir, CLAUDE_DELEGATION_TOOL, CLAUDE_ROLE_TOOLS } from "../../../src/adapters/claudeAgents.ts";
import { renderClaudeRoutingSection } from "../../../src/routing/claudeSection.ts";
import { readGolden, renderSectionClaudeRouting } from "../goldens.ts";
import { ROLE_IDS, RPG_DENY_LIST } from "../../../src/agents/catalog.ts";

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Sandbox com fake claude bin + HOME do Claude isolado (env override D9). */
function sandboxWithClaude(): ReturnType<typeof makeSandbox> & { claudeHome: string } {
  const sb = makeSandbox() as ReturnType<typeof makeSandbox> & { claudeHome: string };
  const binDir = path.join(sb.dir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, "claude");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(fake, 0o755);
  sb.claudeHome = path.join(sb.dir, "claude-home");
  sb.env.PATH = `${binDir}:${sb.env.PATH ?? ""}`;
  sb.env.RUNECRAFT_CLAUDE_HOME = sb.claudeHome;
  return sb;
}

function sink(): { chunks: string[]; write(c: string): void } {
  return { chunks: [], write(c: string) { this.chunks.push(c); } };
}

// ---------------------------------------------------------------------------
// EVAL-079 — capability manifest (B0)
// ---------------------------------------------------------------------------

describe("EVAL-079 — capability manifest: validação + digest + wiring matrix", () => {
  test("EVAL-079: validateManifest ok; digest determinístico; matrix consome capabilityReason", async () => {
    await evalTest("EVAL-079: manifest — validação, digest 2 runs, wiring matrix (fonte única)", async () => {
      const validation = validateManifest();
      expect(validation.ok).toBe(true);
      expect(validation.errors).toEqual([]);
      // Digest byte-estável (F21 D10) — mesmo input → mesmo output.
      expect(manifestDigest()).toBe(manifestDigest());
      expect(manifestDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Wiring: célula unsupported do claude-code subagents usa o reason do
      // manifest (nada de string duplicada em matrix.ts).
      const cell = MATRIX["claude-code"].subagents;
      expect(cell?.kind).toBe("unsupported");
      if (cell?.kind === "unsupported") {
        expect(cell.reason).toBe(capabilityReason("claude-code", "subagents", "subagents"));
        expect(cell.reason).toContain("~/.claude/agents/");
      }
      // Honestidade (recon §7): Copilot guards = none (sem superfície).
      expect(claimFor("copilot", "guards").verdict).toBe("none");
    }, { evalId: "EVAL-079" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-080 — Claude agent assets (B1)
// ---------------------------------------------------------------------------

describe("EVAL-080 — agent files do Claude: assets válidos + QA-5 espelhado", () => {
  test("EVAL-080: 7 assets válidos; só o builder com Agent; deny-list RPG ausente", async () => {
    await evalTest("EVAL-080: assets claude — validação, QA-5 (só builder delega), zero RPG", async () => {
      const assetsDir = claudeAgentsAssetsDir();
      const validation = validateClaudeAgentAssets(assetsDir);
      expect(validation.ok).toBe(true);
      for (const role of ROLE_IDS) {
        const tools = CLAUDE_ROLE_TOOLS[role];
        if (role === "builder") expect(tools).toContain(CLAUDE_DELEGATION_TOOL);
        else expect(tools).not.toContain(CLAUDE_DELEGATION_TOOL);
        const content = fs.readFileSync(path.join(assetsDir, `${role}.md`), "utf8").toLowerCase();
        for (const term of RPG_DENY_LIST) {
          expect(content.includes(term), `${role}.md contém "${term}"`).toBe(false);
        }
      }
      // O corpo do builder instrui a delegação nativa (Task tool / Agent).
      const builder = fs.readFileSync(path.join(assetsDir, "builder.md"), "utf8");
      expect(builder).toContain("spawn other agents (tool `Agent`)");
    }, { evalId: "EVAL-080" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-081 — routing directive (B1)
// ---------------------------------------------------------------------------

describe("EVAL-081 — directive de routing do Claude: determinismo + golden", () => {
  test("EVAL-081: render 2 runs idênticos; golden byte-igual; security obrigatória; Task tool", async () => {
    await evalTest("EVAL-081: directive — determinismo, golden, security MANDATORY, delegação Task", async () => {
      const a = renderClaudeRoutingSection();
      const b = renderClaudeRoutingSection();
      expect(a).toBe(b);
      // Golden (F23 D4): o render == o arquivo golden versionado (a seção
      // completa com markers — o que o adapter injeta no CLAUDE.md).
      expect(renderSectionClaudeRouting()).toBe(readGolden("section-routing-claude.golden"));
      expect(a).toContain("threshold 2");
      expect(a).toContain("Security is MANDATORY");
      expect(a).toContain("NOT optional");
      expect(a).toContain("Agent tool");
      expect(a).toContain("Only the `builder` role has the");
      for (const role of ROLE_IDS) expect(a).toContain(`**${role}**`);
    }, { evalId: "EVAL-081" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-082 — materialização three-way (B1)
// ---------------------------------------------------------------------------

describe("EVAL-082 — materialização ~/.claude/agents/ (three-way F19 D7)", () => {
  test("EVAL-082: install materializa 7 (byte-idênticos); sync idempotente; edição preservada", async () => {
    await evalTest("EVAL-082: install/sync — 7 agent files, idempotência, preservação de edição", async () => {
      const sb = sandboxWithClaude();
      try {
        writeSettings(sb, []);
        const install = await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("papéis objetivos do Claude Code materializados");
        const agentsDir = path.join(sb.claudeHome, "agents");
        for (const role of ROLE_IDS) {
          const target = path.join(agentsDir, `${role}.md`);
          expect(fs.existsSync(target)).toBe(true);
          expect(fs.readFileSync(target, "utf8")).toBe(
            fs.readFileSync(path.join(claudeAgentsAssetsDir(REAL_ROOT), `${role}.md`), "utf8"),
          );
        }
        // CLAUDE.md com as duas seções gerenciadas.
        const rules = fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8");
        expect(rules).toContain("runecraft:workflow");
        expect(rules).toContain("runecraft:routing");

        // sync idempotente (LIFE 3.2).
        const rulesBefore = fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8");
        const sync = await runHarness(sb, ["sync"]);
        expect(sync.code).toBe(0);
        expect(fs.readFileSync(path.join(sb.claudeHome, "CLAUDE.md"), "utf8")).toBe(rulesBefore);

        // edição do usuário → preservada (F19 D7 — nunca auto-cura).
        const target = path.join(agentsDir, "builder.md");
        fs.writeFileSync(target, "---\nname: builder\n---\neditado\n", "utf8");
        const sync2 = await runHarness(sb, ["sync"]);
        expect(sync2.code).toBe(0);
        expect(fs.readFileSync(target, "utf8")).toBe("---\nname: builder\n---\neditado\n");
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-082", coverage: [{ command: "install", flags: ["--agent", "--yes"] }, { command: "sync", flags: [] }] });
  });
});

// ---------------------------------------------------------------------------
// EVAL-083 — doctor checks 24/25 (B0/B1)
// ---------------------------------------------------------------------------

describe("EVAL-083 — doctor: claude role agents (24) + capability manifest (25)", () => {
  test("EVAL-083: checks 24/25 pass após install (gate claude + gerenciado)", async () => {
    await evalTest("EVAL-083: doctor — check 24 (claude roles) + check 25 (manifest) pass", async () => {
      const sb = sandboxWithClaude();
      try {
        writeSettings(sb, []);
        await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
        const out = sink();
        const err = sink();
        const code = await dispatch(["doctor", "--json"], { cwd: sb.dir, env: sb.env, stdout: out, stderr: err });
        expect(code).toBe(0);
        const json = JSON.parse(out.chunks.join("")) as { checks: Array<{ id: number; status: string }> };
        expect(json.checks.find((c) => c.id === 24)?.status).toBe("pass");
        expect(json.checks.find((c) => c.id === 25)?.status).toBe("pass");
        expect(json.checks).toHaveLength(24);
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-083", coverage: [{ command: "doctor", flags: ["--json"] }] });
  });
});

// ---------------------------------------------------------------------------
// EVAL-084 — status smoke (B0/B1)
// ---------------------------------------------------------------------------
describe("EVAL-084 — status: capabilities (B0) + claude roles/routing (B1)", () => {
  test("EVAL-084: status --json com seções B0/B1 (digest, claudeRoleAgents, claudeRouting)", async () => {
    await evalTest("EVAL-084: status — capabilities + claudeRoleAgents + claudeRouting presentes", async () => {
      const sb = sandboxWithClaude();
      try {
        writeSettings(sb, []);
        await runHarness(sb, ["install", "--agent", "claude-code", "--yes"]);
        const out = sink();
        const err = sink();
        const code = await dispatch(["status", "--json"], { cwd: sb.dir, env: sb.env, stdout: out, stderr: err });
        expect(code).toBe(0);
        const json = JSON.parse(out.chunks.join("")) as {
          capabilities: { valid: boolean; digest: string; agents: Array<{ agent: string; claims: unknown[] }> };
          claudeRoleAgents: { installed: string[]; total: number; managed: boolean };
          routing: { claudeSection: { present: boolean; registered: boolean } };
        };
        expect(json.capabilities.valid).toBe(true);
        expect(json.capabilities.digest).toBe(manifestDigest());
        expect(json.capabilities.agents.length).toBe(5);
        expect(json.capabilities.agents.find((a) => a.agent === "claude-code")?.claims.length).toBeGreaterThan(0);
        expect(json.claudeRoleAgents.managed).toBe(true);
        expect(json.claudeRoleAgents.installed).toHaveLength(7);
        expect(json.claudeRoleAgents.total).toBe(7);
        expect(json.routing.claudeSection.present).toBe(true);
        expect(json.routing.claudeSection.registered).toBe(true);
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-084", coverage: [{ command: "status", flags: ["--json"] }] });
  });
});
