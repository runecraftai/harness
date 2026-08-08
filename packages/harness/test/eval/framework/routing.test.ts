// framework/routing.test.ts — EVAL-067..078: Coded Routing & Pilot
// Coordination (F33) via framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — rota = CÓDIGO puro; loopback +
// apiKey literal; sem relógio/path absoluto em identidade — F21 D10):
//   EVAL-067 classifier determinismo — classifyRoute 2 runs byte-idênticos;
//   EVAL-068 classifier fail-closed — sem sinal → direct (nenhuma rota
//     inventada);
//   EVAL-069 classifier boundaries — score 1 (1 medium) → direct; score 2 →
//     rota; 1 high → rota (ROUTE_THRESHOLD=2);
//   EVAL-070 classifier security obrigatória — keyword security + sinal de
//     outra rota → security (bypassa threshold — paladin "not optional");
//   EVAL-071 classifier prioridade — empate implement/review → ordem
//     determinística (implement);
//   EVAL-072 routing explore→scout — sessão REAL (fixture F21): input de recon
//     → directive no systemPrompt + delegação real (tool subagent) →
//     delegation event agent=scout (routing completeness);
//   EVAL-073 routing research→researcher — input de pesquisa → agent=researcher;
//   EVAL-074 routing planning→planner — input de planejamento + `.specs/**/
//     spec.md` fake → agent=planner (SDD feature D3);
//   EVAL-075 routing implement→builder→reviewer — input de implementação →
//     subagent(builder) + subagent(reviewer) + veredito [APPROVE]/[REJECT] +
//     ≤3 blocking issues no asset da chain (gate D4);
//   EVAL-076 extensão routing — before_agent_start injeta o directive (marker);
//     freeze por sessão; RUNECRAFT_ROUTING=0 → inerte (kill switch F20/D6);
//   EVAL-077 two-driver — ledger glla supervisionando (F19 isSupervising) →
//     routing skip (nenhum directive — o loop é o piloto);
//   EVAL-078 chain selection + F30 — chain ausente → direct + warn (fail-
//     closed); render determinístico 2 runs; passo da chain → modelos via
//     models.agents.<id> (resolveAgentModel — contrato de ids F30 D5);
//     fim-de-chain → null + warn (F30 D4).
//
// Delta vs EVAL-001..071 documentado em cada case (D6 — sem double-test):
// EVAL-059/060/062..064 provaram tool-use/routing dos PAPÉIS (delegação via
// evento tipado); os cases novos cobrem a ADIÇÃO do roteador codificado
// (classificador puro + chains de piloto + extensão before_agent_start).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import type { EvalRunResult } from "../../../src/eval/types.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { script } from "../layer2/fixture/scenarios.ts";
import { classifyRoute, ROUTE_THRESHOLD } from "../../../src/routing/classifier.ts";
import { ROUTE_CATALOG, chainForRoute, type RouteId } from "../../../src/routing/routes.ts";
import { renderRoutingDirective, ROUTING_MARKER } from "../../../src/routing/directive.ts";
import { installRouting } from "../../../src/extensions/routing.ts";
import { resolveAgentModel } from "../../../src/models/resolution.ts";
import { PILOT_CHAIN_NAMES, pilotChainsAssetsDir } from "../../../src/routing/materialize.ts";
import { roleList } from "../../../src/agents/catalog.ts";
import { materializePilotChains, writeSpecFile } from "../helpers/routingChains.ts";
import type { PilotChainName } from "../../../src/routing/materialize.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CHAINS_DIR = pilotChainsAssetsDir();
const ROLES = roleList();
const OBSERVABILITY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/observability.ts",
);

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

/** Sessão real com a extensão routing + observability ativas (delegação
 *  observada via evento tipado do F28 — mesmo padrão EVAL-062..064) e as
 *  chains materializadas. */
function sessionWithRouting(repoDir: string, agentDir: string, chains: PilotChainName[], withSpec = false): void {
  materializePilotChains(repoDir, chains);
  if (withSpec) writeSpecFile(repoDir, "f1");
  // O observability registra o evento delegation (tool subagent — F28); sem
  // ele o alvo da delegação não é observável (fallback honesto do design D9).
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (!extensions.includes(OBSERVABILITY_EXTENSION)) extensions.push(OBSERVABILITY_EXTENSION);
  settings.extensions = extensions;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// EVAL-067..071 — classificador puro (D1/D3)
// ---------------------------------------------------------------------------

describe("EVAL-067 — determinismo do classificador (2 runs byte-idênticos)", () => {
  test("EVAL-067: classifyRoute 2 runs → decisão byte-idêntica (todas as chaves)", async () => {
    await evalTest("EVAL-067: determinismo — classifyRoute 2 runs byte-idênticos (F21 D10)", async () => {
      const inputs = [
        { text: "implement the auth flow" },
        { text: "plan the feature and break down the work" },
        { text: "hello world" },
        { text: "review my changes and validate the diff" },
        { text: "locate where the token is validated" },
        { text: "" },
      ];
      for (const input of inputs) {
        const a = classifyRoute(input);
        const b = classifyRoute(input);
        expect(a).toEqual(b);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
      // Constantes explícitas (decisão 3c — thresholds em CÓDIGO).
      expect(ROUTE_THRESHOLD).toBe(2);
    }, { evalId: "EVAL-067" });
  });
});

describe("EVAL-068 — fail-closed (sem sinal → direct)", () => {
  test("EVAL-068: input sem sinais de rota → direct (nenhuma rota inventada)", async () => {
    await evalTest("EVAL-068: fail-closed — sem sinal → direct; vazio → direct", async () => {
      const decision = classifyRoute({ text: "hello world, good morning" });
      expect(decision.route).toBe("direct");
      expect(decision.reason).toBe("fail-closed");
      expect(classifyRoute({ text: "" }).route).toBe("direct");
      expect(classifyRoute({ text: "" }).reason).toBe("empty");
    }, { evalId: "EVAL-068" });
  });
});

describe("EVAL-069 — boundaries de threshold (ROUTE_THRESHOLD = 2)", () => {
  test("EVAL-069: score 1 (1 medium) → direct; score 2 → rota; 1 high → rota", async () => {
    await evalTest("EVAL-069: boundaries — 1 medium → direct; 2 mediums → rota; 1 high → rota", async () => {
      // 1 medium → score 1 → direct (fail-closed conservador — o bard só
      // delegava trabalho substancial).
      const one = classifyRoute({ text: "modify the file" });
      expect(one.scores.implement).toBe(1);
      expect(one.route).toBe("direct");
      // 2 mediums → score 2 → rota.
      const two = classifyRoute({ text: "modify and update the file" });
      expect(two.scores.implement).toBe(2);
      expect(two.route).toBe("implement");
      // 1 high → score 2 → rota.
      const high = classifyRoute({ text: "fix the bug" });
      expect(high.scores.implement).toBe(2);
      expect(high.route).toBe("implement");
    }, { evalId: "EVAL-069" });
  });
});

describe("EVAL-070 — security OBRIGATÓRIA (paladin 'not optional')", () => {
  test("EVAL-070: keyword security + sinal de outra rota → security (bypassa threshold)", async () => {
    await evalTest("EVAL-070: security obrigatória — high-signal bypassa o threshold e qualquer outra rota", async () => {
      const decision = classifyRoute({ text: "implement the auth flow" });
      expect(decision.scores.implement).toBeGreaterThan(0);
      expect(decision.route).toBe("security");
      expect(decision.reason).toBe("mandatory");
      expect(decision.mandatoryHits).toContain("auth");
      // Sem high-signal de segurança, 1 medium não aciona a obrigatoriedade.
      const weak = classifyRoute({ text: "check the security posture" });
      expect(weak.scores.security).toBe(1);
      expect(weak.route).toBe("direct");
      // Fix cleric F33: CSP é superfície obrigatória — "csp"/"content security
      // policy" na lista high (tarefa de CSP nunca pode pular a rota security).
      const csp = classifyRoute({ text: "set the CSP header and content security policy" });
      expect(csp.route).toBe("security");
      expect(csp.reason).toBe("mandatory");
      expect(csp.mandatoryHits).toContain("csp");
    }, { evalId: "EVAL-070" });
  });
});

describe("EVAL-071 — prioridade determinística em empate", () => {
  test("EVAL-071: empate implement/review → ordem determinística (implement)", async () => {
    await evalTest("EVAL-071: prioridade — empate implement/review → implement (ordem security>planning>implement>review>research>explore)", async () => {
      const decision = classifyRoute({ text: "review the code and fix the bug" });
      expect(decision.scores.implement).toBe(decision.scores.review);
      expect(decision.route).toBe("implement");
      // Ordem completa verificada por construção (routes.ts priority).
      const order = ["explore", "research", "review", "implement", "planning", "security"] as const;
      for (let i = 1; i < order.length; i++) {
        expect(ROUTE_CATALOG[order[i] as RouteId].priority).toBeGreaterThan(ROUTE_CATALOG[order[i - 1] as RouteId].priority);
      }
    }, { evalId: "EVAL-071" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-072..075 — routing completeness via delegação REAL (D4/D5)
// ---------------------------------------------------------------------------

describe("EVAL-072 — routing explore→scout (sessão real)", () => {
  test("EVAL-072: input de recon → directive no systemPrompt + delegation agent=scout", async () => {
    await evalTest("EVAL-072: explore→scout — directive injetado + delegação real subagent(agent=scout)", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "scout", task: "Recon the module boundaries.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "routing-eval072",
        description: "EVAL-072: rota explore → scout via subagent",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => sessionWithRouting(repoDir, agentDir, ["explore"]),
      });
      try {
        await fx.session.session.prompt("Locate the module boundaries and map the codebase before touching anything.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        // Directive no systemPrompt (visível no transcript do primeiro request).
        const first = fx.server.seen[0];
        expect(first, "sem requests no fixture").toBeDefined();
        expect(first!.conversationText).toContain(ROUTING_MARKER);
        expect(first!.conversationText).toContain("Route: explore");
        expect(first!.conversationText).toContain("Pilot chain: explore.chain.md");
        // Delegação real → evento tipado do F28 com agent=scout.
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "scout"), `sem delegation agent=scout (vistos: ${JSON.stringify(events)})`).toBe(true);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-072" });
  });
});

describe("EVAL-073 — routing research→researcher (sessão real)", () => {
  test("EVAL-073: input de pesquisa → directive + delegation agent=researcher", async () => {
    await evalTest("EVAL-073: research→researcher — directive injetado + delegação real subagent(agent=researcher)", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "researcher", task: "Research and return a sourced brief.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "routing-eval073",
        description: "EVAL-073: rota research → researcher via subagent",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => sessionWithRouting(repoDir, agentDir, ["research"]),
      });
      try {
        await fx.session.session.prompt("Research the best practices and check the docs for the migration.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const first = fx.server.seen[0];
        expect(first, "sem requests no fixture").toBeDefined();
        expect(first!.conversationText).toContain(ROUTING_MARKER);
        expect(first!.conversationText).toContain("Route: research");
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "researcher"), `sem delegation agent=researcher (vistos: ${JSON.stringify(events)})`).toBe(true);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-073" });
  });
});

describe("EVAL-074 — routing planning→planner com SDD (sessão real)", () => {
  test("EVAL-074: input de planejamento + .specs/features/f1/spec.md → directive + delegation agent=planner", async () => {
    await evalTest("EVAL-074: planning→planner — SDD spec presente (+2 planning) → delegação real subagent(agent=planner)", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "planner", task: "Create the implementation plan.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "routing-eval074",
        description: "EVAL-074: rota planning (+ SDD) → planner via subagent",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => sessionWithRouting(repoDir, agentDir, ["plan"], true),
      });
      try {
        await fx.session.session.prompt("Plan the feature and break down the work into a task list.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const first = fx.server.seen[0];
        expect(first, "sem requests no fixture").toBeDefined();
        expect(first!.conversationText).toContain(ROUTING_MARKER);
        expect(first!.conversationText).toContain("Route: planning");
        expect(first!.conversationText).toContain("Pilot chain: plan.chain.md");
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "planner"), `sem delegation agent=planner (vistos: ${JSON.stringify(events)})`).toBe(true);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-074" });
  });
});

describe("EVAL-075 — routing implement→builder→reviewer (sessão real + gate)", () => {
  test("EVAL-075: input de implementação → subagent(builder) + subagent(reviewer) + veredito no asset da chain", async () => {
    await evalTest("EVAL-075: implement→builder→reviewer — delegações reais + veredito [APPROVE]/[REJECT] + ≤3 blocking issues", async () => {
      const scenario = {
        ...script([
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "builder", task: "Execute the plan.", async: true } },
          },
          {
            expect: { toolsSubset: ["subagent"] },
            reply: { kind: "tool", name: "subagent", args: { agent: "reviewer", task: "Return a structured verdict.", async: true } },
          },
          { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
        ]),
        id: "routing-eval075",
        description: "EVAL-075: rota implement → builder + reviewer (gate) via subagent",
      };
      const fx = await setupEvalFixture({
        scenario,
        withRepo: true,
        beforeSession: ({ repoDir, agentDir }) => sessionWithRouting(repoDir, agentDir, ["implement"]),
      });
      try {
        await fx.session.session.prompt("Implement the feature and fix the reported bug.");
        await new Promise((resolve) => setTimeout(resolve, 800));
        const first = fx.server.seen[0];
        expect(first, "sem requests no fixture").toBeDefined();
        expect(first!.conversationText).toContain(ROUTING_MARKER);
        expect(first!.conversationText).toContain("Route: implement");
        expect(first!.conversationText).toContain("Pilot chain: implement.chain.md");
        const events = delegationEvents(fx.repo!.dir);
        expect(events.some((e) => e.agent === "builder"), `sem delegation agent=builder (vistos: ${JSON.stringify(events)})`).toBe(true);
        expect(events.some((e) => e.agent === "reviewer"), `sem delegation agent=reviewer (vistos: ${JSON.stringify(events)})`).toBe(true);
        // Veredito estruturado como DADO no asset da chain (D4 — gate F32):
        // [APPROVE]/[REJECT] + ≤3 blocking issues.
        const chain = fs.readFileSync(path.join(CHAINS_DIR, "implement.chain.md"), "utf8");
        expect(chain).toContain("[APPROVE]");
        expect(chain).toContain("[REJECT]");
        expect(chain).toMatch(/3 blocking issues/);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-075" });
  });
});

// ---------------------------------------------------------------------------
// Suite routing (EVAL-072..075 — trajectory-assertion do transcript)
// ---------------------------------------------------------------------------

describe("EVAL-072..075 — suite routing verde (trajectory-assertion real)", () => {
  test("EVAL-072/073/074/075: runEvalSuite(routing) → 4 cases trajectory verdes", async () => {
    await evalTest("EVAL-072..075: suite routing — trajectory-assertion da delegação real (subagent) + tool-policy", async () => {
      const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "routing" });
      const result: EvalRunResult = output.result;
      expect(result.summary.totalCases).toBe(4);
      expect(result.summary.passedCases).toBe(4);
      expect(result.summary.failedCases).toBe(0);
      expect(result.summary.errorCases).toBe(0);
      const byId = new Map(result.caseResults.map((c) => [c.caseId, c]));
      for (const id of ["routing-explore-scout", "routing-research-researcher", "routing-planning-planner", "routing-implement-builder"]) {
        const c = byId.get(id)!;
        const trace = c.artifacts.trace as { delegationSequence: string[] };
        expect(trace.delegationSequence).toContain("subagent");
      }
    }, { evalId: "EVAL-072" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-076 — extensão routing (directive/freeze/kill switch)
// ---------------------------------------------------------------------------

/** Fake pi que captura handlers por evento (padrão AD-027 QA-5). */
function makeFakePi(): {
  handlers: Map<string, Array<(e: unknown, c: unknown) => unknown>>;
  on(event: string, h: (e: unknown, c: unknown) => unknown): void;
  emit(t: string, e: unknown, ctx: unknown): Promise<unknown>;
} {
  const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
  return {
    handlers,
    on(event: string, h: (e: unknown, c: unknown) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
    },
    emit: async (t: string, e: unknown, ctx: unknown) => {
      let currentSystemPrompt: string | undefined;
      let result: unknown;
      for (const h of handlers.get(t) ?? []) {
        const event =
          currentSystemPrompt !== undefined && (e as { systemPrompt?: string }).systemPrompt !== undefined
            ? { ...(e as object), systemPrompt: currentSystemPrompt }
            : e;
        const r = await h(event, ctx);
        if (r !== undefined) {
          result = r;
          const sp = (r as { systemPrompt?: unknown }).systemPrompt;
          if (typeof sp === "string") currentSystemPrompt = sp;
        }
      }
      return result;
    },
  };
}

function makeCtx(cwd: string, sessionId = "sess-1"): Record<string, unknown> {
  return { cwd, sessionManager: { getSessionId: () => sessionId } };
}

function beforeAgentStartEvent(prompt: string): { type: string; prompt: string; systemPrompt: string; systemPromptOptions: Record<string, unknown> } {
  return { type: "before_agent_start", prompt, systemPrompt: "BASE_PROMPT", systemPromptOptions: {} };
}

function makeRepoWithChains(base: string, chains: string[]): string {
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo, { recursive: true });
  if (chains.length > 0) {
    const dir = path.join(repo, ".pi", "chains");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of chains) fs.writeFileSync(path.join(dir, name), `# ${name}\n`, "utf8");
  }
  return repo;
}

function writeGllaLedger(cwd: string, goal: Record<string, unknown>): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

describe("EVAL-076 — extensão routing (D1/D6)", () => {
  test("EVAL-076: directive no before_agent_start; freeze por sessão; RUNECRAFT_ROUTING=0 → inerte", async () => {
    await evalTest("EVAL-076: extensão — marker injetado, freeze por sessão, kill switch inerte", async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-eval076-"));
      try {
        const repo = makeRepoWithChains(base, ["implement.chain.md"]);
        const fake = makeFakePi();
        installRouting(fake as unknown as Parameters<typeof installRouting>[0], { env: process.env });
        const ctx = makeCtx(repo);
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const first = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string };
        expect(first.systemPrompt).toContain(ROUTING_MARKER);
        expect(first.systemPrompt).toContain("Route: implement");
        // Freeze por sessão: 2ª chamada (subagente/passo) → MESMA decisão.
        const second = (await fake.emit("before_agent_start", beforeAgentStartEvent("review the code"), ctx)) as { systemPrompt?: string };
        expect(second.systemPrompt).toContain("Route: implement");
        expect(second.systemPrompt).not.toContain("Route: review");
        // Kill switch → inerte.
        const fake2 = makeFakePi();
        installRouting(fake2 as unknown as Parameters<typeof installRouting>[0], { env: { ...process.env, RUNECRAFT_ROUTING: "0" } });
        await fake2.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const inert = (await fake2.emit("before_agent_start", beforeAgentStartEvent("implement the auth flow"), ctx)) as { systemPrompt?: string } | undefined;
        expect(inert).toBeUndefined();
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-076" });
  });
});

describe("EVAL-077 — two-driver (F19 sessionDriver → routing skip)", () => {
  test("EVAL-077: ledger glla supervisionando → nenhum directive; sem ledger → directive normal", async () => {
    await evalTest("EVAL-077: two-driver — goal-loop ativo → routing inerte; sessão direta → directive", async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-eval077-"));
      try {
        const repo = makeRepoWithChains(base, ["implement.chain.md"]);
        writeGllaLedger(repo, { status: "active", id: "g1", objective: "Ship F33", autoContinue: true });
        const fake = makeFakePi();
        installRouting(fake as unknown as Parameters<typeof installRouting>[0], { env: process.env });
        const ctx = makeCtx(repo);
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const supervised = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
        expect(supervised).toBeUndefined();
        // Sessão direta (sem ledger): directive normal.
        const repo2 = makeRepoWithChains(path.join(base, "r2"), ["implement.chain.md"]);
        const fake2 = makeFakePi();
        installRouting(fake2 as unknown as Parameters<typeof installRouting>[0], { env: process.env });
        const ctx2 = makeCtx(repo2);
        await fake2.emit("session_start", { type: "session_start", reason: "startup" }, ctx2);
        const direct = (await fake2.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx2)) as { systemPrompt?: string } | undefined;
        expect(direct!.systemPrompt).toContain(ROUTING_MARKER);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-077" });
  });
});

describe("EVAL-078 — chain selection + contrato F30 (D4/D7)", () => {
  test("EVAL-078: chain ausente → direct + warn; render determinístico 2 runs; contrato F30", async () => {
    await evalTest("EVAL-078: chain ausente → direct + warn (fail-closed); render 2 runs idênticos; passo → models.agents.<id> resolve; fim-de-chain → null + warn", async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-eval078-"));
      try {
        // Chain ausente em .pi/chains/ → fail-closed direct + warn.
        const repo = makeRepoWithChains(base, []); // sem a chain implement
        const warnings: string[] = [];
        const fake = makeFakePi();
        installRouting(fake as unknown as Parameters<typeof installRouting>[0], { env: process.env, warn: (m) => warnings.push(m) });
        const ctx = makeCtx(repo);
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
        expect(result).toBeUndefined();
        expect(warnings.some((w) => w.includes("chain ausente"))).toBe(true);
        // Render determinístico: 2 runs byte-idênticos.
        const decision = classifyRoute({ text: "implement the feature" });
        expect(chainForRoute("implement")).toBe("implement.chain.md");
        const a = renderRoutingDirective(decision, "implement.chain.md", ROLES)!;
        const b = renderRoutingDirective(decision, "implement.chain.md", ROLES)!;
        expect(a).toBe(b);
        // Contrato F30: passo da chain (papel F32) → models.agents.<id> resolve;
        // fim-de-chain → null + warn (nada inventado).
        const available = new Set(["provider-a/model-x"]);
        for (const name of PILOT_CHAIN_NAMES) {
          const asset = fs.readFileSync(path.join(CHAINS_DIR, `${name}.chain.md`), "utf8");
          const steps = [...asset.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
          for (const step of steps) {
            const outcome = resolveAgentModel(step, {
              availableModels: available,
              customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
            });
            expect(outcome.model).toBe("provider-a/model-x");
          }
        }
        const exhausted = resolveAgentModel("reviewer", { availableModels: new Set(), customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }] });
        expect(exhausted.model).toBeNull();
        expect(exhausted.via).toBe("none");
        if (exhausted.via === "none") expect(exhausted.warning.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-078" });
  });
});
