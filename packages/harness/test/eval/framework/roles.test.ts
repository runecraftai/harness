// framework/roles.test.ts — EVAL-057..066: Objective Role Agents (F32) via
// framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — agentes são DADOS; loopback +
// apiKey literal; sem relógio/path absoluto em identidade — F21 D10):
//   EVAL-057 render/goldens — 7 .md == assets do pacote (byte-a-byte por
//     construção — os assets SÃO a fonte), frontmatter válido (parser flat
//     espelho do fork; keys ⊆ KNOWN_FIELDS; name == filename), tools ⊆
//     vocabulário verificado, deny-list RPG ausente (precedente F30
//     EVAL-047 — substring); determinismo 2 runs;
//   EVAL-058 discovery — sessão REAL com .pi/agents/ materializado (7
//     papéis) → subagent({action:"list"}) → os 7 aparecem como `(project`
//     e o planner shadowa o builtin (projeto > builtin — mergeAgentsForScope
//     do fork; validado no Execute);
//   EVAL-059 tool-use scout — suite roles → case roles-scout-readonly:
//     allowlist read-only do scout → tool-policy sem write/edit/bash/
//     subagent (registry REAL); categoria tool-use desbloqueada;
//   EVAL-060 tool-use builder — case roles-builder-write: allowlist do
//     escritor → write/edit/bash presentes e legítimos;
//   EVAL-061 auditor md-only — sessão REAL com RUNECRAFT_AGENT_ID=auditor
//     (mecanismo do harness — F24 currentAgentId) + allowlist do auditor:
//     write de .ts → BLOQUEADO (ranger-md-only — DEFAULT da lista agora
//     contém "auditor", D7) → write de .md passa; env restaurado;
//   EVAL-062 routing planner→builder — delegação REAL (tool subagent) com o
//     observability materializado → evento `delegation` no event store com
//     agent="builder" (fallback honesto documentado no design: trajectory-
//     assertion sobre o delegation event do F28 — o trace só expõe nomes de
//     tools; o agente alvo vive no evento tipado);
//   EVAL-063 routing builder→reviewer — evento delegation agent="reviewer" +
//     o papel reviewer define o veredito estruturado ([APPROVE]/[REJECT] +
//     ≤3 blocking issues) no próprio .md (D6);
//   EVAL-064 routing builder→scout — evento delegation agent="scout" (recon
//     pré-build);
//   EVAL-065 delegation-template — renderDelegationPrompt determinístico
//     (2 runs byte-idênticos) + lista os 7 papéis (buildKeyTriggersSection);
//     papéis sem `subagent` no allowlist → null (fail-closed QA-5a);
//   EVAL-066 models interface — resolveAgentModel com ids de papel via
//     custom chain do state (F30 D5/D11): precedência override → custom
//     chain > builtin → systemDefault → null + warn; validateModelsConfig
//     aceita os 7 ids; AGENT_MODEL_REQUIREMENTS vazio (D4).
//
// Delta vs EVAL-001..056 documentado em cada case (D6 — sem double-test):
// EVAL-014 provou o mecanismo tool-policy/trajectory-assertion; EVAL-024/
// 026/029 provaram a observação do F28; os cases novos cobrem a ADIÇÃO dos
// papéis objetivos (dados + allowlists + delegação + guard default).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import type { EvalCaseResult, EvalRunResult, TrajectoryTrace } from "../../../src/eval/types.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { script } from "../layer2/fixture/scenarios.ts";
import { validateRoleAssets, ROLE_CATALOG, ROLE_IDS, roleList, RPG_DENY_LIST, TOOL_VOCABULARY } from "../../../src/agents/catalog.ts";
import { roleAssetsDir } from "../../../src/agents/materialize.ts";
import { renderDelegationPrompt } from "../../../src/agents/delegation.ts";
import { resolveAgentModel } from "../../../src/models/resolution.ts";
import { validateModelsConfig, defaultModelsConfig } from "../../../src/models/config.ts";
import { AGENT_MODEL_REQUIREMENTS } from "../../../src/models/defaults.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ASSETS_DIR = roleAssetsDir();
const OBSERVABILITY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/observability.ts",
);

/** Sessão real com os 7 papéis em .pi/agents/ + observability materializado. */
function materializeRolesAndObservability(repoDir: string, agentDir: string): void {
  const dir = path.join(repoDir, ".pi", "agents");
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ROLE_IDS) {
    fs.copyFileSync(path.join(ASSETS_DIR, `${id}.md`), path.join(dir, `${id}.md`));
  }
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (!extensions.includes(OBSERVABILITY_EXTENSION)) extensions.push(OBSERVABILITY_EXTENSION);
  settings.extensions = extensions;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/** Linhas `delegation` do event store da sessão (payload tipado do F28). */
function delegationEvents(repoDir: string): Array<{ agent: string }> {
  const eventsDir = path.join(repoDir, ".runecraft", "events");
  if (!fs.existsSync(eventsDir)) return [];
  const events: Array<{ agent: string }> = [];
  for (const file of fs.readdirSync(eventsDir)) {
    for (const line of fs.readFileSync(path.join(eventsDir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { kind?: string; payload?: { agent?: unknown } };
        if (parsed.kind === "delegation" && typeof parsed.payload?.agent === "string") {
          events.push({ agent: parsed.payload.agent });
        }
      } catch {
        // linha malformada → ignora (fail-soft — padrão F28 export)
      }
    }
  }
  return events;
}

describe("EVAL-057 — render/goldens dos 7 papéis (D3/F23)", () => {
  test("EVAL-057: assets validam (frontmatter/tools/deny-list) e o render é determinístico", async () => {
    await evalTest("EVAL-057: 7 .md — frontmatter válido, tools ⊆ vocabulário, deny-list RPG ausente, determinismo", async () => {
      for (const id of ROLE_IDS) {
        expect(fs.existsSync(path.join(ASSETS_DIR, `${id}.md`)), `${id}.md ausente`).toBe(true);
      }
      const result = validateRoleAssets(ASSETS_DIR);
      expect(result.ok, result.errors.join("; ")).toBe(true);
      // deny-list RPG ausente (substring — precedente F30 EVAL-047).
      for (const id of ROLE_IDS) {
        const content = fs.readFileSync(path.join(ASSETS_DIR, `${id}.md`), "utf8").toLowerCase();
        for (const term of RPG_DENY_LIST) {
          expect(content, `${id}.md contém termo proibido "${term}"`).not.toContain(term);
        }
      }
      // tools ⊆ vocabulário verificado + allowlist == catálogo (fonte única).
      for (const role of roleList()) {
        for (const tool of role.tools) expect(TOOL_VOCABULARY).toContain(tool);
        expect(role.tools).toEqual(ROLE_CATALOG[role.id].tools);
      }
      // determinismo: 2 validações idênticas (F21 D10).
      const again = validateRoleAssets(ASSETS_DIR);
      expect(again).toEqual(result);
    }, { evalId: "EVAL-057" });
  });
});

describe("EVAL-058 — discovery real do fork (D1/D2)", () => {
  test("EVAL-058: .pi/agents/ com os 7 → subagent list resolve project > builtin", async () => {
    await evalTest("EVAL-058: subagent list mostra os 7 papéis como project (shadowing do planner)", async () => {
      const scenario = {
        ...script([
          { expect: { toolsSubset: ["subagent"] }, reply: { kind: "tool", name: "subagent", args: { action: "list" } } },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-discovery",
        description: "EVAL-058: descoberta real dos 7 papéis no fork (project > builtin)",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir }) => {
          const dir = path.join(repoDir, ".pi", "agents");
          fs.mkdirSync(dir, { recursive: true });
          for (const id of ROLE_IDS) {
            fs.copyFileSync(path.join(ASSETS_DIR, `${id}.md`), path.join(dir, `${id}.md`));
          }
        },
      });
      try {
        await fx.session.session.prompt("List the available subagents.");
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(fx.server.diagnosis).toEqual([]);
        // O resultado do subagent list entra na conversa do request seguinte.
        const listRequest = fx.server.seen.find((req) => req.conversationText.includes("Executable agents"));
        expect(listRequest, "subagent list não retornou no transcript").toBeDefined();
        const conv = listRequest!.conversationText;
        for (const id of ROLE_IDS) {
          expect(conv, `papel ${id} não listado como project`).toContain(`- ${id} (project`);
        }
        // Shadowing: o planner NÃO aparece como builtin (projeto vence — mergeAgentsForScope).
        expect(conv).not.toContain("- planner (builtin");
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-058" });
  });
});

describe("EVAL-059/060 — tool-use correctness via suite roles", () => {
  test("EVAL-059/060: suite roles verde — scout read-only + builder writer (tool-policy real)", async () => {
    await evalTest("EVAL-059/060: tool-use — allowlists scout/builder no registry real da sessão", async () => {
      const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "roles" });
      const result: EvalRunResult = output.result;
      expect(result.summary.totalCases).toBe(2);
      expect(result.summary.passedCases).toBe(2);
      expect(result.summary.failedCases).toBe(0);
      expect(result.summary.errorCases).toBe(0);

      const byId = new Map(result.caseResults.map((c: EvalCaseResult) => [c.caseId, c]));

      // EVAL-059 — scout: registry sem write/edit/bash/subagent.
      const scout = byId.get("roles-scout-readonly")!;
      const scoutTrace = scout.artifacts.trace as TrajectoryTrace;
      expect(scoutTrace.delegationSequence).toEqual(["read", "grep", "find", "ls"]);
      expect(scout.artifacts.toolPolicy!.write ?? false).toBe(false);
      expect(scout.artifacts.toolPolicy!.bash ?? false).toBe(false);
      expect(scout.artifacts.toolPolicy!.subagent ?? false).toBe(false);
      expect(scout.artifacts.toolPolicy!.read).toBe(true);

      // EVAL-060 — builder: write/edit/bash/subagent presentes (papel escritor).
      const builder = byId.get("roles-builder-write")!;
      const builderTrace = builder.artifacts.trace as TrajectoryTrace;
      expect(builderTrace.delegationSequence).toEqual(["read", "write", "bash"]);
      expect(builder.artifacts.toolPolicy!.write).toBe(true);
      expect(builder.artifacts.toolPolicy!.bash).toBe(true);
      expect(builder.artifacts.toolPolicy!.subagent).toBe(true);

      // Mensagens estáveis (F21 D10 — sem path absoluto/timestamp).
      for (const c of result.caseResults) {
        for (const a of c.assertionResults) {
          expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(a.message).not.toContain(TEST_EVAL_DIR);
        }
      }
    }, { evalId: "EVAL-059" });
  });
});

describe("adversarial — scout com write falha alto (F21 D7)", () => {
  test("adversarial: sessão scout (allowlist read-only) com write scriptado → fixture diagnostica (nunca passa em silêncio)", async () => {
    await evalTest("adversarial F32: scout tentando write → o fixture falha com diagnóstico (allowlist enforcement)", async () => {
      const scenario = {
        ...script([
          { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "x.ts", content: "x" } } },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-adversarial-scout-write",
        description: "adversarial: write fora da allowlist do scout → diagnóstico",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        tools: ["read", "grep", "find", "ls", "intercom"], // allowlist do scout
      });
      try {
        await fx.session.session.prompt("Write a file.");
        // O fixture acumula diagnóstico (write ausente do registry — allowlist
        // fail-closed) — o teste adversarial NUNCA passa em silêncio.
        expect(fx.server.diagnosis.length).toBeGreaterThan(0);
        expect(fx.server.diagnosis.join(" ")).toContain("write");
        // E nenhum arquivo foi escrito (a tool não existe).
        expect(fs.existsSync(path.join(fx.repo!.dir, "x.ts"))).toBe(false);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-059" });
  });
});

describe("EVAL-061 — auditor md-only (D7, guard F24)", () => {
  test("EVAL-061: auditor com RUNECRAFT_AGENT_ID=auditor → write .ts bloqueado, write .md passa", async () => {
    await evalTest("EVAL-061: auditor — write de não-.md bloqueado pelo ranger (default [auditor]); .md passa", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["write"] },
            reply: { kind: "tool", name: "write", args: { path: "src/feature.ts", content: "const x = 1" } },
          },
          {
            expect: { toolsSubset: ["write"], conversationContains: ["ranger-md-only"] },
            reply: { kind: "tool", name: "write", args: { path: "docs/audit.md", content: "# Audit report" } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-auditor",
        description: "EVAL-061: auditor md-only — .ts bloqueado, .md passa (default D7)",
      };
      const prev = process.env.RUNECRAFT_AGENT_ID;
      process.env.RUNECRAFT_AGENT_ID = "auditor";
      try {
        const fx = await setupEvalFixture({
          scenario,
          withRepo: true,
          // Allowlist do papel auditor (D3) — write presente, restrito a .md
          // pelo guard rangerMdOnly (default mdOnlyAgents=["auditor"] — D7).
          tools: ["read", "grep", "find", "ls", "bash", "write", "intercom"],
        });
        try {
          await fx.session.session.prompt("Write src/feature.ts, then docs/audit.md.");
          // .ts bloqueado: o arquivo NÃO existe (prova do bloqueio real).
          expect(fs.existsSync(path.join(fx.repo!.dir, "src", "feature.ts"))).toBe(false);
          // .md passou e foi escrito de verdade.
          expect(fs.readFileSync(path.join(fx.repo!.dir, "docs", "audit.md"), "utf8")).toBe("# Audit report");
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (prev === undefined) delete process.env.RUNECRAFT_AGENT_ID;
        else process.env.RUNECRAFT_AGENT_ID = prev;
      }
    }, { evalId: "EVAL-061" });
  });
});

describe("EVAL-062/063/064 — routing completeness via delegação real (D5)", () => {
  test("EVAL-062: planner→builder — delegation event agent=builder no store", async () => {
    await evalTest("EVAL-062: delegação real subagent(agent=builder) → delegation:delegate no event store", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "builder", task: "Implement the approved plan step.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-routing-builder",
        description: "EVAL-062: planner delega ao builder (subagent agent=builder)",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => materializeRolesAndObservability(repoDir, agentDir),
      });
      try {
        await fx.session.session.prompt("Plan and delegate the implementation to the builder.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "builder"), `sem delegation agent=builder (vistos: ${JSON.stringify(events)})`).toBe(true);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-062" });
  });

  test("EVAL-063: builder→reviewer — delegation agent=reviewer + veredito estruturado no papel", async () => {
    await evalTest("EVAL-063: delegação real subagent(agent=reviewer) + reviewer.md define [APPROVE]/[REJECT]", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "reviewer", task: "Review the work and return a verdict.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-routing-reviewer",
        description: "EVAL-063: builder delega ao reviewer (subagent agent=reviewer)",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => materializeRolesAndObservability(repoDir, agentDir),
      });
      try {
        await fx.session.session.prompt("Verify the change: delegate the review to the reviewer.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "reviewer"), `sem delegation agent=reviewer (vistos: ${JSON.stringify(events)})`).toBe(true);
        // Veredito estruturado do cleric como DADO no papel (D6): o reviewer.md
        // define [APPROVE]/[REJECT] + resumo + ≤3 blocking issues.
        const reviewerMd = fs.readFileSync(path.join(ASSETS_DIR, "reviewer.md"), "utf8");
        expect(reviewerMd).toContain("[APPROVE]");
        expect(reviewerMd).toContain("[REJECT]");
        expect(reviewerMd).toMatch(/at most 3 blocking issues/i);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-063" });
  });

  test("EVAL-064: builder→scout — delegation agent=scout (recon pré-build)", async () => {
    await evalTest("EVAL-064: delegação real subagent(agent=scout) → delegation:delegate no event store", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "scout", task: "Recon the module boundaries before building.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "roles-routing-scout",
        description: "EVAL-064: builder delega recon ao scout (subagent agent=scout)",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => materializeRolesAndObservability(repoDir, agentDir),
      });
      try {
        await fx.session.session.prompt("Gather context: delegate reconnaissance to the scout.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "scout"), `sem delegation agent=scout (vistos: ${JSON.stringify(events)})`).toBe(true);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-064" });
  });
});

describe("EVAL-065 — template de delegação (D5)", () => {
  test("EVAL-065: renderDelegationPrompt determinístico, lista os 7, fail-closed para não-delegadores", async () => {
    await evalTest("EVAL-065: template de delegação — 2 runs byte-idênticos + 7 papéis listados + null p/ não-delegador", async () => {
      const roles = roleList();
      const a = renderDelegationPrompt(ROLE_CATALOG.builder, roles);
      const b = renderDelegationPrompt(ROLE_CATALOG.builder, roles);
      expect(a).toBe(b);
      expect(a).not.toBeNull();
      for (const id of ROLE_IDS) expect(a!).toContain(`### ${id}`);
      // Fail-closed (QA-5a): papéis sem subagent NÃO recebem instrução.
      for (const id of ["planner", "reviewer", "auditor", "scout", "researcher", "security"] as const) {
        expect(renderDelegationPrompt(ROLE_CATALOG[id], roles)).toBeNull();
      }
    }, { evalId: "EVAL-065" });
  });
});

describe("EVAL-066 — interface de modelos F30 (D8)", () => {
  test("EVAL-066: ids de papel resolvem via custom chain; fim-de-chain → null + warn", async () => {
    await evalTest("EVAL-066: resolveAgentModel com ids de papel (custom chain) — precedência + null + warn", async () => {
      const available = new Set(["provider-a/model-x", "provider-a/model-y"]);
      for (const id of ROLE_IDS) {
        const outcome = resolveAgentModel(id, {
          availableModels: available,
          customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
        });
        expect(outcome.model).toBe("provider-a/model-x");
        expect(outcome.via).toBe("custom-chain");
      }
      // fim-de-chain → null + warn (F30 D4 — nada inventado).
      const exhausted = resolveAgentModel("auditor", {
        availableModels: new Set(),
        customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
      });
      expect(exhausted.model).toBeNull();
      expect(exhausted.via).toBe("none");
      if (exhausted.via === "none") expect(exhausted.warning.length).toBeGreaterThan(0);
      // validateModelsConfig aceita os 7 ids de papel (state models.agents.<id>).
      const cfg: Record<string, unknown> = {
        ...defaultModelsConfig(),
        agents: Object.fromEntries(ROLE_IDS.map((id) => [id, { fallbackChain: [{ providers: ["provider-a"], model: "model-x" }] }])),
      };
      const validated = validateModelsConfig(cfg);
      expect(validated.ok, validated.errors?.join("; ")).toBe(true);
      expect(Object.keys(AGENT_MODEL_REQUIREMENTS)).toEqual([]); // zero IDs inventados
    }, { evalId: "EVAL-066" });
  });
});
