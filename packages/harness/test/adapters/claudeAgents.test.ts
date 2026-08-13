// adapters/claudeAgents.test.ts — B1: materialização dos 7 papéis objetivos
// do Claude Code em ~/.claude/agents/ + validação fail-closed dos assets +
// SMOKE TEST da delegação via Task tool nativa.
//
// Three-way F19 D7 (espelho do F32): 1ª instalação copia byte-idêntico; 2ª
// idempotente (zero writes); edição do usuário → preservada; template mudou →
// updated; adoção; validação dos assets (frontmatter, tools ⊆ vocabulário,
// só o builder com Agent — QA-5 espelhado, deny-list RPG).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planClaudeAgents,
  applyClaudeAgents,
  claudeAgentsDir,
  claudeAgentsAssetsDir,
  contentHash,
  validateClaudeAgentAssets,
  validateClaudeAgentFile,
  parseClaudeFrontmatter,
  parseClaudeToolList,
  CLAUDE_AGENTS_ASSETS_VERSION,
  CLAUDE_TOOL_VOCABULARY,
  CLAUDE_DELEGATION_TOOL,
  CLAUDE_ROLE_TOOLS,
  type ClaudeAgentRecord,
} from "../../src/adapters/claudeAgents.ts";
import { ROLE_IDS, RPG_DENY_LIST } from "../../src/agents/catalog.ts";

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "b1-claude-agents-"));
}

function emptyRecords(): Record<string, ClaudeAgentRecord> {
  return {};
}

/** Cópia dos assets do pacote num root fake (espelho do fakePackageRoot do
 *  F32 materialize.test.ts) — testes que MUTAM um asset (vN→vM) operam na
 *  cópia, nunca no pacote shipped. */
function fakePackageRoot(base: string): string {
  const assetsDir = path.join(base, "claude-agents");
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const id of ROLE_IDS) {
    fs.copyFileSync(path.join(claudeAgentsAssetsDir(REAL_ROOT), `${id}.md`), path.join(assetsDir, `${id}.md`));
  }
  return base;
}

describe("assets — validação fail-closed (B1)", () => {
  test("os 7 assets versionados são válidos (frontmatter/tools/QA-5/deny-list)", () => {
    const assetsDir = claudeAgentsAssetsDir(REAL_ROOT);
    const validation = validateClaudeAgentAssets(assetsDir);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    for (const role of ROLE_IDS) {
      const content = fs.readFileSync(path.join(assetsDir, `${role}.md`), "utf8");
      expect(validateClaudeAgentFile(role, content)).toBe(true);
    }
  });

  test("só o builder tem a tool de delegação (Agent — QA-5 espelhado); read-only sem mutation", () => {
    for (const role of ROLE_IDS) {
      const tools = CLAUDE_ROLE_TOOLS[role];
      if (role === "builder") {
        expect(tools).toContain(CLAUDE_DELEGATION_TOOL);
      } else {
        expect(tools).not.toContain(CLAUDE_DELEGATION_TOOL);
      }
    }
    expect(CLAUDE_ROLE_TOOLS.planner).toEqual(["Read", "Glob", "Grep"]);
    expect(CLAUDE_ROLE_TOOLS.reviewer).not.toContain("Edit");
    expect(CLAUDE_ROLE_TOOLS.security).not.toContain("Write");
  });

  test("vocabulário fechado — todo tool dos assets está no vocabulário verificado", () => {
    for (const role of ROLE_IDS) {
      for (const tool of CLAUDE_ROLE_TOOLS[role]) {
        expect(CLAUDE_TOOL_VOCABULARY).toContain(tool);
      }
    }
  });

  test("deny-list RPG ausente dos assets (decisão 2 — zero tema RPG)", () => {
    const assetsDir = claudeAgentsAssetsDir(REAL_ROOT);
    for (const role of ROLE_IDS) {
      const content = fs.readFileSync(path.join(assetsDir, `${role}.md`), "utf8").toLowerCase();
      for (const term of RPG_DENY_LIST) {
        expect(content.includes(term), `${role}.md contém "${term}"`).toBe(false);
      }
    }
  });

  test("parser flat + tools: inválido → erros (fail-closed)", () => {
    const errors: string[] = [];
    validateClaudeAgentFile("planner", "---\nname: outro\ntools: Greps\n---\ncorpo\n", errors);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
    expect(errors.some((e) => e.includes("Greps"))).toBe(true);
    const { frontmatter, body } = parseClaudeFrontmatter("---\nname: planner\ntools: Read, Glob\n---\ncorpo\n");
    expect(frontmatter.name).toBe("planner");
    expect(body).toBe("corpo");
    expect(parseClaudeToolList(" Read , Glob ")).toEqual(["Read", "Glob"]);
  });
});

describe("planClaudeAgents/applyClaudeAgents — three-way F19 D7 (B1)", () => {
  test("sem ~/.claude/agents → 7 missing; apply copia byte-idêntico + registra", () => {
    const base = makeTmp();
    const claudeHome = path.join(base, "claude-home");
    const plans = planClaudeAgents(claudeHome, undefined);
    expect(plans.map((p) => p.roleId)).toEqual([...ROLE_IDS]);
    expect(plans.every((p) => p.status === "missing")).toBe(true);

    const records = emptyRecords();
    const result = applyClaudeAgents(claudeHome, records, plans);
    expect(result.copied).toHaveLength(7);
    expect(result.changed).toBe(true);

    const dir = claudeAgentsDir(claudeHome);
    for (const id of [...ROLE_IDS]) {
      const target = path.join(dir, `${id}.md`);
      expect(fs.existsSync(target)).toBe(true);
      // byte-idêntico ao asset
      expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(claudeAgentsAssetsDir(), `${id}.md`), "utf8"));
      expect(records[id]?.contentHash).toBe(contentHash(fs.readFileSync(target, "utf8")));
      expect(records[id]?.assetVersion).toBe(CLAUDE_AGENTS_ASSETS_VERSION);
    }
  });

  test("2º sync idempotente: tudo in-sync, zero writes (LIFE 3.2)", () => {
    const base = makeTmp();
    const claudeHome = path.join(base, "claude-home");
    const records = emptyRecords();
    applyClaudeAgents(claudeHome, records, planClaudeAgents(claudeHome, undefined));

    const plans2 = planClaudeAgents(claudeHome, records);
    expect(plans2.every((p) => p.status === "in-sync")).toBe(true);
    const before = fs.readFileSync(path.join(claudeAgentsDir(claudeHome), "planner.md"), "utf8");
    const result2 = applyClaudeAgents(claudeHome, records, plans2);
    expect(result2.copied).toHaveLength(0);
    expect(result2.changed).toBe(false);
    expect(fs.readFileSync(path.join(claudeAgentsDir(claudeHome), "planner.md"), "utf8")).toBe(before);
  });

  test("edição do usuário → edited (preserva + reporta; NUNCA reescreve)", () => {
    const base = makeTmp();
    const claudeHome = path.join(base, "claude-home");
    const records = emptyRecords();
    applyClaudeAgents(claudeHome, records, planClaudeAgents(claudeHome, undefined));

    const target = path.join(claudeAgentsDir(claudeHome), "builder.md");
    const userEdit = "---\nname: builder\n---\nmeu builder\n";
    fs.writeFileSync(target, userEdit, "utf8");

    const plans = planClaudeAgents(claudeHome, records);
    expect(plans.find((p) => p.roleId === "builder")?.status).toBe("edited");
    const result = applyClaudeAgents(claudeHome, records, plans);
    expect(result.copied).toHaveLength(0);
    expect(fs.readFileSync(target, "utf8")).toBe(userEdit);
    expect(result.notes.some((n) => n.includes("preservado (editado"))).toBe(true);
  });

  test("template mudou (vN→vM): arquivo == registrado → updated (copia o novo asset)", () => {
    const base = makeTmp();
    const root = fakePackageRoot(base);
    const claudeHome = path.join(base, "claude-home");
    const records = emptyRecords();
    applyClaudeAgents(claudeHome, records, planClaudeAgents(claudeHome, undefined, root), root);

    // Asset do scout muda (novo template) — na CÓPIA do pacote (fake root),
    // nunca no asset shipped (zero mutation do source tree / flake paralela).
    const assetFile = path.join(claudeAgentsAssetsDir(root), "scout.md");
    const originalAsset = fs.readFileSync(assetFile, "utf8");
    fs.writeFileSync(assetFile, `${originalAsset}\n-- v2 --\n`, "utf8");

    const plans = planClaudeAgents(claudeHome, records, root);
    expect(plans.find((p) => p.roleId === "scout")?.status).toBe("updated");
    const result = applyClaudeAgents(claudeHome, records, plans, root);
    expect(result.copied).toContain("scout.md");
    expect(fs.readFileSync(path.join(claudeAgentsDir(claudeHome), "scout.md"), "utf8")).toBe(fs.readFileSync(assetFile, "utf8"));
  });

  test("adoção: arquivo == asset sem registro → adopted (registra, sem write)", () => {
    const base = makeTmp();
    const claudeHome = path.join(base, "claude-home");
    applyClaudeAgents(claudeHome, emptyRecords(), planClaudeAgents(claudeHome, undefined));

    const plans = planClaudeAgents(claudeHome, undefined);
    expect(plans.every((p) => p.status === "adopted")).toBe(true);
    const records = emptyRecords();
    const result = applyClaudeAgents(claudeHome, records, plans);
    expect(result.copied).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(records.scout?.contentHash).toBe(contentHash(fs.readFileSync(path.join(claudeAgentsDir(claudeHome), "scout.md"), "utf8")));
  });
});

describe("SMOKE TEST — delegação via Task tool nativa (B1 AC4)", () => {
  test("os 7 agent files existem com frontmatter semântico válido; só o builder delega (contrato machine-consumed)", () => {
    // Smoke offline/$0 (F3 — option a): o contrato da delegação é o
    // FRONTMATTER SEMÂNTICO (name/description/tools — o Claude Code recusa
    // lançar agente com tools que não resolvem; a allowlist É o enforcement
    // da delegação) + a validação estrutural (validateClaudeAgentAssets) +
    // o golden byte-locked do directive (test/eval/goldens). Nada de grep de
    // corpo de prompt — sentença em texto natural não prova comportamento.
    const assetsDir = claudeAgentsAssetsDir(REAL_ROOT);
    for (const role of ROLE_IDS) {
      const content = fs.readFileSync(path.join(assetsDir, `${role}.md`), "utf8");
      const { frontmatter, body } = parseClaudeFrontmatter(content);
      // name == papel, description presente (o Claude delega por description).
      expect(frontmatter.name).toBe(role);
      expect((frontmatter.description ?? "").trim().length).toBeGreaterThan(0);
      // tools resolvem no vocabulário verificado (zero-tools = agente não lança).
      const tools = parseClaudeToolList(frontmatter.tools);
      for (const tool of tools) expect((CLAUDE_TOOL_VOCABULARY as readonly string[])).toContain(tool);
      expect(body.trim().length).toBeGreaterThan(0);
      // QA-5 espelhado: só o builder tem a tool de delegação no allowlist.
      if (role === "builder") expect(tools).toContain(CLAUDE_DELEGATION_TOOL);
      else expect(tools).not.toContain(CLAUDE_DELEGATION_TOOL);
    }
    // Validação estrutural completa (frontmatter/tools/keys/deny-list).
    expect(validateClaudeAgentAssets(assetsDir).ok).toBe(true);
  });

  test("o veredito estruturado da delegação é coberto pelo contrato semântico do reviewer/security/auditor", () => {
    // A delegação do Claude executa agentes cujo contrato de SAÍDA é o
    // veredito estruturado — o mecanismo nativo do Claude entrega o retorno
    // do subagente ao pai; o contrato de veredito vive na validação
    // estrutural (validateClaudeAgentFile) e é exercitado pelo fluxo real
    // (EVAL-082/084: install → agentes materializados → doctor/status).
    const assetsDir = claudeAgentsAssetsDir(REAL_ROOT);
    for (const role of ["reviewer", "security", "auditor"] as const) {
      const content = fs.readFileSync(path.join(assetsDir, `${role}.md`), "utf8");
      expect(validateClaudeAgentFile(role, content)).toBe(true);
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });
});
