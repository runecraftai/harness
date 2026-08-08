// framework/pi.test.ts — EVAL-039..048: Pi First-Class & SDD Assets (F30) via
// framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — F30 é determinístico por
// construção; loopback + apiKey literal; sem relógio/path absoluto em
// identidade — F21 D10):
//   EVAL-039 persona — wiring real (installPersona em fake pi) com eventos
//     scriptados (AD-027 QA-5 — padrão EVAL-021): systemPrompt contém marker
//     `<!-- runecraft:persona -->` + PERSONA_VERSION + texto objetivo;
//     determinismo 2 runs; kill switch → sem injeção;
//   EVAL-040 rules + chaining — persona + resilience (REAL, goal ledger) +
//     lessons (adendo real via promoted.jsonl): markers persona/rules/
//     continuation/lessons TODOS presentes, ordem de append preservada,
//     PI_RULES (reuso F19) presente; delta vs EVAL-021/028 documentado
//     (chaining já provado no F27/F28 — F30 prova a ADIÇÃO da persona);
//   EVAL-041 first-message — port fiel (Sets created/applied); initial →
//     variante 1× (markApplied); resume|reload → sem re-aplicação;
//     determinismo 2 runs;
//   EVAL-042 model resolution — models.json fixture com N modelos → set real
//     via ModelRuntime.getModels(); precedência override → custom chain >
//     builtin → systemDefault → null + warn; fim-de-chain → null (nada
//     inventado); determinismo; **categoria failover desbloqueada** (F26);
//   EVAL-043 modelSwitch F27 — trigger sintético → próximo modelo (leve→forte);
//     chain esgotada → halt + escalação humana; assert de não-coupling:
//     src/resilience/ não importa src/models (zero mudanças F27);
//   EVAL-044 models generate — 2 runs byte-idênticos (canonicalJson F23;
//     merge aditivo preserva providers existentes); kill switch recusa sem
//     escrever; list/doctor shapes estáveis;
//   EVAL-045 archive de planos — move + {ok,warnings}; 2º run ok:false;
//     slug inválido recusa antes de IO; DI rename;
//   EVAL-046 sdd scope + chains — limiares tabelados (quick/medium/large);
//     chains sdd-*.chain.md parseiam no parser REAL do fork subagents
//     (contrato do parseChain do fork — chain-serializer.ts:101: front-matter
//     name+description + seções `## worker`/`## reviewer`);
//   EVAL-047 templates SDD — sdd new scaffold no shape da casa; goldens dos
//     templates; deny-list de termos RPG ausente de persona/templates/chains;
//   EVAL-048 config/kill switches — defaults fail-closed; freeze por sessão;
//     `RUNECRAFT_MODELS=0`/`RUNECRAFT_PERSONA=0` → camadas inertes + CLI
//     recusa (exit 0, nada criado).
//
// Delta vs EVAL-006/007/014/017..021/022..029/030..038 documentado em cada
// case (D6 — sem double-test): o mecanismo de chaining/continuation/lessons
// já é coberto pelos EVALs existentes; os cases novos cobrem a ADIÇÃO da
// camada Pi (persona/rules/variant) e o roteamento de modelos.
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRuntime, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderModelsJson } from "../layer2/fixture/modelsTemplate.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { installPersona } from "../../../src/extensions/persona.ts";
import { installResilience } from "../../../src/extensions/resilience.ts";
import { installObservability } from "../../../src/extensions/observability.ts";
import {
  PERSONA_TEXT,
  PERSONA_VERSION,
  PERSONA_MARKER,
  buildPersonaSection,
  composeInjection,
} from "../../../src/persona/index.ts";
import { RULES_MARKER, buildPiRulesInjection } from "../../../src/persona/index.ts";
import { noteSessionStart, shouldApplyVariant, markApplied, variantForReason, clearAll } from "../../../src/persona/first-message.ts";
import {
  defaultPersonaConfig,
  validatePersonaConfig,
  personaKillSwitch,
  SessionPersonaConfig,
} from "../../../src/persona/config.ts";
import { renderRules } from "../../../src/adapters/rulesContent.ts";
import { resolveAgentModel, getNextFallbackModel, getKnownModels } from "../../../src/models/resolution.ts";
import { resolveModelSwitch } from "../../../src/models/switch.ts";
import { renderModelsJsonFromConfig } from "../../../src/models/generate.ts";
import {
  defaultModelsConfig,
  validateModelsConfig,
  modelsKillSwitch,
  modelOverrideEnv,
  SessionModelsConfig,
} from "../../../src/models/config.ts";
import { runModelsCommand } from "../../../src/commands/models.ts";
import { classifyScope, parseScope } from "../../../src/sdd/scope.ts";
import { scaffoldFeature, materializeChains, plansArchive, validFeatureName } from "../../../src/sdd/index.ts";
import { parseChainFrontmatter, readChainInfo, listChains, SDD_CHAIN_NAMES, selectChain } from "../../../src/sdd/chains.ts";
import { archivePlan } from "../../../src/sdd/archive.ts";
import { packageRoot, renderTemplate, renderTemplateContent, loadPrompt } from "../../../src/sdd/templates.ts";
import { CONTINUATION_MARKER } from "../../../src/resilience/continuation.ts";
import { LESSONS_MARKER } from "../../../src/observability/lessons.ts";
import { chainFilePath } from "../../../src/sdd/chains.ts";
import { collectBundleInput } from "../../../src/observability/bundle.ts";

const PACKAGE_ROOT = packageRoot();

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-f30-"));
}

/** Termos RPG/persona de classe (decisão 2 — deny-list do EVAL-047). */
const RPG_DENY_LIST = ["bard", "wizard", "ranger", "fighter", "warlock", "cleric", "paladin", "rogue", "thread", "saga", "lore"];

function assertNoRpgTerms(text: string, label: string): void {
  for (const term of RPG_DENY_LIST) {
    expect(text.toLowerCase(), `${label} contém termo RPG "${term}"`).not.toContain(term);
  }
}

/** Fake pi que captura handlers por evento (padrão AD-027 QA-5). */
interface FakePi {
  handlers: Map<string, Array<(e: unknown, c: unknown) => unknown>>;
  commands: Map<string, unknown>;
  emit(t: string, e: unknown, ctx: unknown): Promise<unknown>;
}

function makeFakePi(): FakePi {
  const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
  const commands = new Map<string, unknown>();
  const fakePi = {
    handlers,
    commands,
    on(event: string, h: (e: unknown, c: unknown) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
    },
    registerCommand(name: string, opts: unknown) {
      commands.set(name, opts);
    },
    sendUserMessage() {},
    getSessionName() {
      return undefined;
    },
    emit: async (t: string, e: unknown, ctx: unknown) => {
      // Chaining REAL (runner.js emitBeforeAgentStart): o systemPrompt de
      // cada extensão é re-passado para a próxima (append — nunca o event
      // original para todas).
      let currentSystemPrompt: string | undefined;
      let result: unknown;
      for (const h of handlers.get(t) ?? []) {
        const event = currentSystemPrompt !== undefined && (e as { systemPrompt?: string }).systemPrompt !== undefined
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
  return fakePi;
}

/** Ctx completo o suficiente para persona/resilience/observability. */
function makeCtx(cwd: string, sessionId = "sess-1"): Record<string, unknown> {
  return {
    cwd,
    mode: "rpc",
    hasUI: false,
    ui: {},
    sessionManager: { getSessionId: () => sessionId },
    modelRegistry: {},
    model: { id: "fixture/eval-model" },
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  };
}

/** Ledger fake no formato validado do glla (.pi-glla/active.jsonl). */
function writeLedger(cwd: string, goal: Record<string, unknown>): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function activeGoal(): Record<string, unknown> {
  return {
    status: "active",
    id: "g1",
    objective: "Ship F30",
    autoContinue: true,
    taskList: { version: 1, tasks: [{ id: "1", title: "T1", status: "in_progress" }] },
  };
}

/** promoted.jsonl com UMA lesson promovida (adendo planning do F28). */
function writePromotedLessons(cwd: string): void {
  const dir = path.join(cwd, ".runecraft", "lessons");
  fs.mkdirSync(dir, { recursive: true });
  const lessonId = crypto.createHash("sha256").update(JSON.stringify({ trigger: "gate blocked", gate: "write-existing-file-guard" })).digest("hex").slice(0, 16);
  const record = {
    lessonId,
    triggerSignature: lessonId,
    trigger: "gate blocked",
    antiPattern: "retry the same write",
    preferred: "fix the condition first",
    priority: "med",
    gate: "write-existing-file-guard",
    track: "execution",
    count: 3,
    status: "promoted",
    firstSeenSeq: 1,
    lastSeenSeq: 3,
  };
  fs.writeFileSync(path.join(dir, "promoted.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// EVAL-039 — persona (D1/PFC-01)
// ---------------------------------------------------------------------------

describe("EVAL-039 — persona do Pi (marker + versão + texto objetivo; determinismo; kill switch)", () => {
  test("wiring real: session_start initial → before_agent_start injeta persona+rules encadeado", async () => {
    await evalTest("EVAL-039: persona — wiring real (installPersona) → systemPrompt com marker persona + PERSONA_VERSION + texto objetivo; 2 runs idênticos", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const fake = makeFakePi();
        installPersona(fake as unknown as ExtensionAPI, { env: process.env });
        const ctx = makeCtx(repo);
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const result = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(result).toBeDefined();
        const injected = result!.systemPrompt!;
        // Encadeado: base preservada + adendo.
        expect(injected.startsWith("BASE_PROMPT\n\n")).toBe(true);
        // Marker persona + versão + texto objetivo.
        expect(injected).toContain(PERSONA_MARKER);
        expect(injected).toContain(`persona v${PERSONA_VERSION}`);
        expect(injected).toContain("senior software engineer");
        // Reuso F19: PI_RULES presente (marker de rules).
        expect(injected).toContain(RULES_MARKER);
        expect(injected).toContain("Runecraft workflow rules (v1)");
        // Objetiva — sem termos RPG (decisão 2).
        assertNoRpgTerms(PERSONA_TEXT, "persona");
        // Variante aplicada (sessão initial — 1×, EVAL-041 cobre a regra).
        expect(injected).toContain("First message");
        // Determinismo: 2º run com a MESMA sessão initial → a variante é 1×
        // (EVAL-041); o texto de persona+rules é byte-idêntico nos 2 runs
        // (F21 D10 — sem timestamps/paths).
        const again = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        // Persona + rules idênticos; a variante NÃO re-aplica (1× por sessão).
        expect(again!.systemPrompt!).toContain(PERSONA_MARKER);
        expect(again!.systemPrompt!).toContain(buildPersonaSection());
        expect(again!.systemPrompt!).toContain(renderRules("pi"));
        expect(again!.systemPrompt!).not.toContain("First message");
        // Determinismo puro (reason resume — sem variante): 2 runs byte-idênticos.
        const fake2 = makeFakePi();
        installPersona(fake2 as unknown as ExtensionAPI, { env: process.env });
        await fake2.emit("session_start", { type: "session_start", reason: "resume" }, ctx);
        const r1 = (await fake2.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        const r2 = (await fake2.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(r2!.systemPrompt).toBe(r1!.systemPrompt);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-039" });
  });

  test("kill switch RUNECRAFT_PERSONA=0 → sem injeção (camada inerte)", async () => {
    await evalTest("EVAL-039: kill switch — RUNECRAFT_PERSONA=0 → nenhum marker no systemPrompt", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const fake = makeFakePi();
        installPersona(fake as unknown as ExtensionAPI, { env: { ...process.env, RUNECRAFT_PERSONA: "0" } });
        const ctx = makeCtx(repo);
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const result = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(result).toBeUndefined();
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-039" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-040 — rules + chaining com continuation/lessons (D2/PFC-02)
// ---------------------------------------------------------------------------

describe("EVAL-040 — rules injection + chaining (persona + continuation + lessons — sem clobber)", () => {
  test("persona + resilience (REAL) + observability (REAL): todos os markers presentes, ordem de append", async () => {
    await evalTest(
      "EVAL-040: chaining — persona + resilience + observability → markers persona/rules/continuation/lessons todos presentes na ordem de append",
      async () => {
        const base = makeTmp();
        try {
          const repo = path.join(base, "repo");
          fs.mkdirSync(repo, { recursive: true });
          writeLedger(repo, activeGoal());
          writePromotedLessons(repo);
          const fake = makeFakePi();
          // Registro na ordem da manifest: persona, resilience, observability.
          installPersona(fake as unknown as ExtensionAPI, { env: process.env });
          installResilience(fake as unknown as ExtensionAPI, { env: process.env, sessionId: () => "sess-1" });
          installObservability(fake as unknown as ExtensionAPI, {
            env: process.env,
            sessionId: () => "sess-1",
            eventsDirOverride: (cwd) => path.join(cwd, ".runecraft", "events"),
            lessonsFileOverride: (cwd) => path.join(cwd, ".runecraft", "lessons", "promoted.jsonl"),
            promotedFileOverride: (cwd) => path.join(cwd, ".runecraft", "lessons", "promoted.jsonl"),
            collectBundle: (cwd) => collectBundleInput(cwd, process.env, "pi"),
            gitHead: () => null,
          });
          const ctx = makeCtx(repo, "sess-1");
          // session_start reason=resume → continuation pending (resilience) +
          // adendo planning (observability) + persona marca a sessão.
          await fake.emit("session_start", { type: "session_start", reason: "resume" }, ctx);
          const result = (await fake.emit(
            "before_agent_start",
            { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} },
            ctx,
          )) as { systemPrompt?: string } | undefined;
          expect(result).toBeDefined();
          const injected = result!.systemPrompt!;
          // Base preservada (append — nunca sobrescreve).
          expect(injected.startsWith("BASE_PROMPT\n\n")).toBe(true);
          // Todos os markers presentes (EVAL-040 — sem clobber).
          expect(injected).toContain(PERSONA_MARKER);
          expect(injected).toContain(RULES_MARKER);
          expect(injected).toContain(CONTINUATION_MARKER);
          expect(injected).toContain(LESSONS_MARKER);
          // Conteúdo real: PI_RULES (reuso F19) + continuacão + lesson.
          expect(injected).toContain("Runecraft workflow rules (v1)");
          expect(injected).toContain("Ship F30");
          expect(injected).toContain("gate blocked");
          // Ordem de append (persona → rules → continuation → lessons).
          const idxPersona = injected.indexOf(PERSONA_MARKER);
          const idxRules = injected.indexOf(RULES_MARKER);
          const idxCont = injected.indexOf(CONTINUATION_MARKER);
          const idxLessons = injected.indexOf(LESSONS_MARKER);
          expect(idxPersona).toBeGreaterThan(-1);
          expect(idxRules).toBeGreaterThan(idxPersona);
          expect(idxCont).toBeGreaterThan(idxRules);
          expect(idxLessons).toBeGreaterThan(idxCont);
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-040" },
    );
  });

  test("delta vs EVAL-021/028: composeInjection puro — persona → rules → variante; sem duplicação", async () => {
    await evalTest("EVAL-040: composeInjection — persona → rules → variante na ordem; PI_RULES idêntica ao renderRules('pi')", async () => {
      const result = composeInjection("BASE", {
        persona: PERSONA_TEXT,
        rules: buildPiRulesInjection(),
        variant: "first-message-variant",
      });
      const injected = result.systemPrompt;
      expect(injected.startsWith("BASE\n\n")).toBe(true);
      expect(injected).toContain(PERSONA_MARKER);
      expect(injected).toContain(RULES_MARKER);
      expect(injected.indexOf(RULES_MARKER)).toBeGreaterThan(injected.indexOf(PERSONA_MARKER));
      expect(injected.indexOf("first-message-variant")).toBeGreaterThan(injected.indexOf(RULES_MARKER));
      // Reuso F19 byte a byte: o conteúdo de rules == renderRules("pi").
      expect(buildPiRulesInjection()).toBe(`<!-- runecraft:rules -->\n${renderRules("pi")}`);
    }, { evalId: "EVAL-040" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-041 — first-message variant (D3/PFC-03)
// ---------------------------------------------------------------------------

describe("EVAL-041 — first-message variant (port fiel; 1× por sessão; resume sem re-aplicação)", () => {
  test("initial → variante 1× (markApplied); 2º before_agent_start → sem re-aplicação", async () => {
    await evalTest("EVAL-041: variante — sessão initial aplica 1×; segunda injeção negada (Sets created/applied)", async () => {
      clearAll();
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const fake = makeFakePi();
        installPersona(fake as unknown as ExtensionAPI, { env: process.env });
        const ctx = makeCtx(repo, "sess-initial");
        await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
        const first = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(first!.systemPrompt!).toContain("First message");
        // 2ª injeção na MESMA sessão → variante NÃO re-aplicada (mas persona
        // + rules seguem — D3: variante é 1×; adendo é por turno).
        const second = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "task", systemPrompt: "BASE", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(second!.systemPrompt!).not.toContain("First message");
        expect(second!.systemPrompt!).toContain(PERSONA_MARKER);
      } finally {
        clearAll();
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-041" });
  });

  test("resume|reload → variante NUNCA aplicada (F27 dono da continuação); determinismo por reason", async () => {
    await evalTest("EVAL-041: variante — reason resume/reload → sem variante; variantForReason determinístico", async () => {
      clearAll();
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        // Determinismo da seleção por reason (D3).
        expect(variantForReason("startup")).toBe(true);
        expect(variantForReason(undefined)).toBe(true);
        expect(variantForReason("resume")).toBe(false);
        expect(variantForReason("reload")).toBe(false);
        // Wiring: sessão resume → noteSessionStart não habilita a variante.
        const fake = makeFakePi();
        installPersona(fake as unknown as ExtensionAPI, { env: process.env });
        const ctx = makeCtx(repo, "sess-resume");
        await fake.emit("session_start", { type: "session_start", reason: "resume" }, ctx);
        const result = (await fake.emit(
          "before_agent_start",
          { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE", systemPromptOptions: {} },
          ctx,
        )) as { systemPrompt?: string } | undefined;
        expect(result!.systemPrompt!).not.toContain("First message");
        // Port fiel do source (Sets created/applied).
        noteSessionStart("s-a", "startup");
        expect(shouldApplyVariant("s-a")).toBe(true);
        markApplied("s-a");
        expect(shouldApplyVariant("s-a")).toBe(false);
      } finally {
        clearAll();
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-041" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-042 — model resolution (D4/PFC-04) — categoria failover desbloqueada
// ---------------------------------------------------------------------------

describe("EVAL-042 — model resolution por agente (models.json fixture real; precedência fiel)", () => {
  test("precedência: override → custom chain > builtin → systemDefault → null + warn", async () => {
    await evalTest("EVAL-042: resolução — tabela de precedência completa; fim-de-chain → null + warn (nada inventado)", async () => {
      const available = new Set(["anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.6", "claude-sonnet-4.6"]);
      const customChain = [
        { providers: ["anthropic"], model: "claude-haiku-4.5" },
        { providers: ["anthropic"], model: "claude-sonnet-4.6" },
      ];
      // 1. Override sempre vence.
      const o1 = resolveAgentModel("pi", { availableModels: available, overrideModel: "my/override", customFallbackChain: customChain });
      expect(o1).toEqual({ model: "my/override", via: "override" });
      // 2. Custom chain > builtin ({} no harness — D4): primeiro disponível.
      const o2 = resolveAgentModel("pi", { availableModels: available, customFallbackChain: customChain });
      expect(o2).toEqual({ model: "anthropic/claude-haiku-4.5", via: "custom-chain" });
      // 3. Fim da chain → systemDefault.
      const o3 = resolveAgentModel("pi", {
        availableModels: new Set(["other/x"]),
        customFallbackChain: customChain,
        systemDefaultModel: "my/default",
      });
      expect(o3).toEqual({ model: "my/default", via: "system-default" });
      // 4. Nada disponível → null + warn (NENHUM ID inventado — D4).
      const o4 = resolveAgentModel("pi", { availableModels: new Set(), customFallbackChain: customChain });
      expect(o4.model).toBeNull();
      expect(o4.via).toBe("none");
      if (o4.model === null) expect(o4.warning).toContain("No model resolved");
      // 5. Determinismo: 2 runs idênticos (F21 D10).
      expect(resolveAgentModel("pi", { availableModels: available, customFallbackChain: customChain })).toEqual(o2);
    }, { evalId: "EVAL-042" });
  });

  test("getNextFallbackModel: primeiro disponível APÓS o falho; fim → null (semântica source)", async () => {
    await evalTest("EVAL-042: getNextFallbackModel — após o falho; fim-de-chain → null; chain custom > builtin", async () => {
      const available = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-3-flash"]);
      const chain = [
        { providers: ["anthropic"], model: "claude-haiku-4.5" },
        { providers: ["anthropic"], model: "claude-sonnet-4.6" },
        { providers: ["google"], model: "gemini-3-flash" },
      ];
      // Modelo 1 falhou → próximo disponível é o 2.
      expect(getNextFallbackModel("pi", "anthropic/claude-haiku-4.5", available, chain)).toBe("anthropic/claude-sonnet-4.6");
      // Modelo 2 falhou → próximo disponível é o 3.
      expect(getNextFallbackModel("pi", "anthropic/claude-sonnet-4.6", available, chain)).toBe("google/gemini-3-flash");
      // Fim da chain → null.
      expect(getNextFallbackModel("pi", "google/gemini-3-flash", available, chain)).toBeNull();
      // Chain ausente → null.
      expect(getNextFallbackModel("pi", "x", available, null)).toBeNull();
      // 2 runs idênticos.
      expect(getNextFallbackModel("pi", "anthropic/claude-haiku-4.5", available, chain)).toBe("anthropic/claude-sonnet-4.6");
      // getKnownModels reflete as chains configuradas (sem registry próprio).
      const known = getKnownModels({ pi: chain });
      expect(known).toContain("anthropic/claude-haiku-4.5");
      expect(known).toContain("google/gemini-3-flash");
    }, { evalId: "EVAL-042" });
  });

  test("availableModels REAL via ModelRuntime (models.json fixture com N modelos)", async () => {
    await evalTest("EVAL-042: fixture — models.json com N modelos → ModelRuntime.getModels() → resolução determinística", async () => {
      const base = makeTmp();
      try {
        const agentDir = path.join(base, "agent");
        fs.mkdirSync(agentDir, { recursive: true });
        const modelsPath = path.join(agentDir, "models.json");
        // 2 providers × modelos (fixture F21 estendido — renderModelsJson).
        const modelsJson = {
          providers: {
            "fixture-light": {
              baseUrl: "http://127.0.0.1:1/v1",
              api: "openai-completions",
              apiKey: "fixture",
              models: [{ id: "light-1" }, { id: "light-2" }],
            },
            "fixture-strong": {
              baseUrl: "http://127.0.0.1:1/v1",
              api: "openai-completions",
              apiKey: "fixture",
              models: [{ id: "strong-1" }],
            },
          },
        };
        fs.writeFileSync(modelsPath, `${JSON.stringify(modelsJson, null, 2)}\n`);
        const authPath = path.join(agentDir, "auth.json");
        fs.writeFileSync(authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
        const runtime = await ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false });
        await runtime.setRuntimeApiKey("fixture-light", "fixture");
        await runtime.setRuntimeApiKey("fixture-strong", "fixture");
        // Set REAL registrado pelo SDK (getModels — F21). O getModels()
        // devolve TODOS os modelos (builtins do SDK + models.json) — filtra
        // pelos providers do fixture (2×2 + 1 = 3).
        const sdkModels = runtime.getModels().filter((m) => m.provider.startsWith("fixture-"));
        expect(sdkModels.length).toBe(3);
        const available = new Set<string>();
        for (const m of sdkModels) {
          available.add(`${m.provider}/${m.id}`);
          available.add(m.id);
        }
        const chain = [
          { providers: ["fixture-light"], model: "light-1" },
          { providers: ["fixture-strong"], model: "strong-1" },
        ];
        // Primário disponível → seleciona o primeiro da chain.
        const resolved = resolveAgentModel("pi", { availableModels: available, customFallbackChain: chain });
        expect(resolved).toEqual({ model: "fixture-light/light-1", via: "custom-chain" });
        // Determinismo 2 runs.
        expect(resolveAgentModel("pi", { availableModels: available, customFallbackChain: chain })).toEqual(resolved);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-042" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-043 — modelSwitch F27 implementado (D6/PFC-06)
// ---------------------------------------------------------------------------

describe("EVAL-043 — modelSwitch F27 (leve→forte; esgotada → halt+humano; zero mudanças F27)", () => {
  test("trigger sintético: próximo modelo; chain esgotada → halt + escalação humana", async () => {
    await evalTest("EVAL-043: modelSwitch — próximo modelo (leve→forte); esgotada → halt + human; determinismo", async () => {
      const chain = [
        { providers: ["anthropic"], model: "claude-haiku-4.5" },
        { providers: ["anthropic"], model: "claude-sonnet-4.6" },
      ];
      const available = new Set(["anthropic/claude-sonnet-4.6"]);
      // Leve (haiku) falhou → forte (sonnet) disponível → switch.
      const switched = resolveModelSwitch("pi", { failedModel: "anthropic/claude-haiku-4.5", availableModels: available, chain });
      expect(switched.kind).toBe("switch");
      if (switched.kind === "switch") {
        expect(switched.model).toBe("anthropic/claude-sonnet-4.6");
        expect(switched.from).toBe("anthropic/claude-haiku-4.5");
      }
      // Chain esgotada → halt + escalação humana (QA-2a).
      const exhausted = resolveModelSwitch("pi", { failedModel: "anthropic/claude-sonnet-4.6", availableModels: available, chain });
      expect(exhausted).toEqual({ kind: "halt", reason: "model-chain exhausted", escalation: "human" });
      // Determinismo: 2 runs idênticos.
      expect(resolveModelSwitch("pi", { failedModel: "anthropic/claude-haiku-4.5", availableModels: available, chain })).toEqual(switched);
    }, { evalId: "EVAL-043" });
  });

  test("fronteira D11: src/resilience/ NÃO importa src/models (zero mudanças F27); interface NO-OP preservada", async () => {
    await evalTest("EVAL-043: fronteira — arquivos do F27 intactos (sem coupling com src/models; modelSwitch NO-OP no F27)", async () => {
      // Nenhum arquivo de src/resilience/ referencia src/models (o F30
      // implementa a interface no ponto de consumo — src/models/switch.ts).
      const resilienceDir = path.join(PACKAGE_ROOT, "src", "resilience");
      for (const file of fs.readdirSync(resilienceDir).filter((f) => f.endsWith(".ts"))) {
        const content = fs.readFileSync(path.join(resilienceDir, file), "utf8");
        expect(content, `${file} referencia src/models`).not.toContain("../models/");
      }
      // A interface NO-OP do F27 continua no lugar (types.ts:115 + fallback.ts).
      const types = fs.readFileSync(path.join(resilienceDir, "types.ts"), "utf8");
      expect(types).toContain("modelSwitch");
      const fallback = fs.readFileSync(path.join(resilienceDir, "fallback.ts"), "utf8");
      expect(fallback).toContain("ModelSwitchInterface");
      expect(fallback).toContain("noop");
    }, { evalId: "EVAL-043" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-044 — models generate (D7/PFC-07)
// ---------------------------------------------------------------------------

describe("EVAL-044 — models generate (determinístico; merge; kill switch)", () => {
  test("renderModelsJsonFromConfig: 2 runs byte-idênticos; merge aditivo preserva providers existentes", async () => {
    await evalTest("EVAL-044: generate — 2 runs byte-idênticos (canonicalJson); merge preserva provider existente", async () => {
      const config = defaultModelsConfig();
      config.agents = {
        pi: {
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-haiku-4.5" },
            { providers: ["anthropic"], model: "claude-sonnet-4.6" },
          ],
        },
        opencode: { fallbackChain: [{ providers: ["openai"], model: "gpt-5" }] },
      };
      const existing = {
        providers: {
          anthropic: { baseUrl: "https://api.anthropic.com/v1", api: "anthropic-messages", apiKey: "sk-existing" },
        },
      };
      const run1 = renderModelsJsonFromConfig(config, { existing });
      const run2 = renderModelsJsonFromConfig(config, { existing });
      expect(run2).toBe(run1); // byte-idêntico
      // Merge aditivo: config herdada do provider preservada + models mesclados.
      const parsed = JSON.parse(run1) as { providers: Record<string, { baseUrl?: string; api?: string; apiKey?: string; models?: Array<{ id: string }> }> };
      expect(parsed.providers.anthropic!.baseUrl).toBe("https://api.anthropic.com/v1");
      expect(parsed.providers.anthropic!.models!.map((m) => m.id).sort()).toEqual(["claude-haiku-4.5", "claude-sonnet-4.6"]);
      expect(parsed.providers.openai!.models![0]!.id).toBe("gpt-5");
      // Sem timestamps/paths absolutos.
      expect(run1).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(run1).not.toContain(process.cwd());
    }, { evalId: "EVAL-044" });
  });

  test("CLI: 2 runs → arquivo idêntico; kill switch recusa sem escrever", async () => {
    await evalTest("EVAL-044: CLI — models generate 2× → arquivo byte-idêntico; RUNECRAFT_MODELS=0 recusa (exit 0, nada criado)", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        // Config via state workspace (models.agents).
        const stateDir = path.join(repo, ".runecraft");
        fs.mkdirSync(stateDir, { recursive: true });
        const state = {
          schemaVersion: 1,
          scope: "workspace",
          components: {},
          createdFiles: [],
          settingsChanges: [],
          preInstall: [],
          agents: {},
          models: {
            enabled: true,
            default: null,
            override: null,
            agents: { pi: { fallbackChain: [{ providers: ["fixture"], model: "eval-model" }] } },
            autoGenerateModelsJson: false,
          },
        };
        fs.writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
        const env = { ...process.env, RUNECRAFT_PI_HOME: path.join(base, "pi-agent"), HOME: base, RUNECRAFT_HOME: path.join(base, "home") };
        const out: string[] = [];
        const err: string[] = [];
        const rt = { cwd: repo, env };
        const run = async (args: string[]) => {
          const captured = { stdout: "", stderr: "" };
          const code = await runModelsCommand({ json: false, out: { write: (s: string) => (captured.stdout += s) }, err: { write: (s: string) => (captured.stderr += s) }, rt, subcommand: args[0] ?? "", args: args.slice(1) });
          out.push(captured.stdout);
          err.push(captured.stderr);
          return code;
        };
        void out;
        void err;
        const code1 = await run(["generate"]);
        expect(code1).toBe(0);
        const modelsPath = path.join(env.RUNECRAFT_PI_HOME, "models.json");
        expect(fs.existsSync(modelsPath)).toBe(true);
        const first = fs.readFileSync(modelsPath, "utf8");
        expect(first).toContain("eval-model");
        // 2º run → byte-idêntico (sem timestamps).
        const code2 = await run(["generate"]);
        expect(code2).toBe(0);
        expect(fs.readFileSync(modelsPath, "utf8")).toBe(first);
        // Kill switch → recusa sem escrever (nada alterado).
        const before = fs.readFileSync(modelsPath, "utf8");
        const codeKill = await runModelsCommand({
          json: false,
          out: { write: (s: string) => (out.push(s)) },
          err: { write: (s: string) => (err.push(s)) },
          rt: { cwd: repo, env: { ...env, RUNECRAFT_MODELS: "0" } },
          subcommand: "generate",
          args: [],
        });
        expect(codeKill).toBe(0);
        expect(fs.readFileSync(modelsPath, "utf8")).toBe(before);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-044" });
  });

  test("list/doctor shapes estáveis (sem crash com state sem models)", async () => {
    await evalTest("EVAL-044: list/doctor — shapes estáveis; state sem models → defaults (fail-closed)", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const env = { ...process.env, RUNECRAFT_PI_HOME: path.join(base, "pi-agent"), HOME: base, RUNECRAFT_HOME: path.join(base, "home") };
        const rt = { cwd: repo, env };
        let listOut = "";
        const codeList = await runModelsCommand({ json: false, out: { write: (s: string) => (listOut += s) }, err: { write: () => {} }, rt, subcommand: "list", args: [] });
        expect(codeList).toBe(0);
        expect(listOut).toContain("| agent | chain | resolved |");
        expect(listOut).toContain("| pi |");
        let doctorOut = "";
        const codeDoctor = await runModelsCommand({ json: false, out: { write: (s: string) => (doctorOut += s) }, err: { write: () => {} }, rt, subcommand: "doctor", args: [] });
        expect(codeDoctor).toBe(0);
        expect(doctorOut).toContain("models.json");
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-044" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-045 — archive de planos (D9/PFC-09)
// ---------------------------------------------------------------------------

describe("EVAL-045 — plans archive (port createArchivePlanTool)", () => {
  test("move + {ok,warnings}; 2º run ok:false; slug inválido recusa antes de IO", async () => {
    await evalTest("EVAL-045: archive — move + ok; 2º run ok:false (plano ausente); slug inválido → recusa antes de IO", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        const plans = path.join(repo, ".runecraft", "plans");
        fs.mkdirSync(path.join(plans, "my-plan"), { recursive: true });
        fs.writeFileSync(path.join(plans, "my-plan", "plan.md"), "plan content");
        // 1º run → move + ok.
        const first = archivePlan({ cwd: repo }, "my-plan");
        expect(first.ok).toBe(true);
        expect(first.warnings).toEqual([]);
        expect(fs.existsSync(path.join(plans, "my-plan"))).toBe(false);
        expect(fs.existsSync(path.join(plans, "archive", "my-plan", "plan.md"))).toBe(true);
        // 2º run → plano ausente (ok:false + warning — nunca move nada alheio).
        const second = archivePlan({ cwd: repo }, "my-plan");
        expect(second.ok).toBe(false);
        expect(second.warnings[0]).toContain("Plan directory not found");
        // Slug inválido → recusa ANTES de qualquer IO.
        const invalid = archivePlan({ cwd: repo }, "My_Plan!");
        expect(invalid.ok).toBe(false);
        expect(invalid.warnings[0]).toContain("Invalid slug");
        // DI rename p/ teste (semântica source) — plano NOVO (o my-plan já
        // foi arquivado no 1º run).
        fs.mkdirSync(path.join(plans, "di-plan"), { recursive: true });
        let renamed = false;
        const di = archivePlan({ cwd: repo, rename: () => (renamed = true) }, "di-plan");
        expect(di.ok).toBe(true);
        expect(renamed).toBe(true);
        // plansArchive (CLI) shape {ok, warnings}.
        const cli = plansArchive({ cwd: repo }, "missing-plan");
        expect(cli.text).toContain("\"ok\": false");
        expect(cli.text).toContain("Plan directory not found");
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-045" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-046 — sdd scope + chains (D8/PFC-08)
// ---------------------------------------------------------------------------

describe("EVAL-046 — sdd scope (limiares) + chains (formato do fork)", () => {
  test("classifyScope: casos tabelados quick/medium/large (limiares em código — decisão 3)", async () => {
    await evalTest("EVAL-046: scope — tabela de casos (quick/medium/large); determinismo", async () => {
      // quick: ≤3 arquivos, ≤1 frase, <10 tasks.
      expect(classifyScope({ fileCount: 1, sentenceCount: 1, taskCount: 1 })).toBe("quick");
      expect(classifyScope({ fileCount: 3, sentenceCount: 1, taskCount: 9 })).toBe("quick");
      // medium: entre quick e large.
      expect(classifyScope({ fileCount: 4, sentenceCount: 2, taskCount: 3 })).toBe("medium");
      expect(classifyScope({ fileCount: 9, sentenceCount: 2, taskCount: 9 })).toBe("medium");
      // large: ≥10 arquivos OU ≥10 tasks OU multi-componente.
      expect(classifyScope({ fileCount: 10, sentenceCount: 1, taskCount: 1 })).toBe("large");
      expect(classifyScope({ fileCount: 2, sentenceCount: 1, taskCount: 10 })).toBe("large");
      expect(classifyScope({ fileCount: 2, sentenceCount: 1, taskCount: 2, multiComponent: true })).toBe("large");
      // Determinismo: 2 runs idênticos.
      expect(classifyScope({ fileCount: 4, sentenceCount: 2, taskCount: 3 })).toBe("medium");
      // parseScope.
      expect(parseScope("quick")).toBe("quick");
      expect(parseScope("LARGE")).toBe("large");
      expect(parseScope("huge")).toBeNull();
    }, { evalId: "EVAL-046" });
  });

  test("chains sdd-*.chain.md no contrato do parser do fork subagents (parseChain: front-matter name+description + ## worker/reviewer)", async () => {
    await evalTest("EVAL-046: chains — assets no contrato do parseChain do fork (front-matter name+description + seções ## worker/reviewer)", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(path.join(repo, ".pi", "chains"), { recursive: true });
        // Materializa as chains do package (mesma função do sdd new).
        const materialized = materializeChains({ cwd: repo, packageRoot: PACKAGE_ROOT });
        expect(materialized.copied.length).toBe(4);
        // Contrato do parser REAL do fork (validado no Execute F30 —
        // chain-serializer.ts:101 parseChain): front-matter `name` +
        // `description` obrigatórios + seções `## <agente>` (worker/reviewer —
        // builtin do fork, sem RPG). O f3-taskflow.chain.md histórico
        // (`worker "..." -> reviewer "..."`) NÃO parseia no fork 0.37.2 —
        // os assets F30 seguem o formato que o fork parseia HOJE.
        for (const name of SDD_CHAIN_NAMES) {
          const content = fs.readFileSync(chainFilePath(name, PACKAGE_ROOT), "utf8");
          const frontmatter = parseChainFrontmatter(content);
          expect(frontmatter).not.toBeNull(); // name + description presentes
          expect(frontmatter!.name).toBe(name);
          const steps = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
          // sdd-review tem SÓ o reviewer (fase de revisão); as demais têm
          // worker → reviewer (formato do fork — f3-taskflow contract).
          const expectedSteps = name === "sdd-review" ? ["reviewer"] : ["worker", "reviewer"];
          expect(steps).toEqual(expectedSteps);
          // PASSOs presentes nas seções (worker: instruções; reviewer:
          // VERIFICAR — exceto sdd-review que é só revisão com PASSOs).
          if (name !== "sdd-review") expect(content).toContain("VERIFICAR");
        }
        // Leitura mínima do harness bate com o contrato.
        const info = readChainInfo("sdd-spec", PACKAGE_ROOT);
        expect(info.frontmatterName).toBe("sdd-spec");
        expect(info.steps).toEqual(["worker", "reviewer"]);
        expect(info.description.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-046" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-047 — templates SDD (D8/PFC-08) — deny-list RPG
// ---------------------------------------------------------------------------

describe("EVAL-047 — templates SDD (scaffold no shape da casa; goldens; deny-list RPG)", () => {
  test("sdd new → scaffold .specs/features/x/ no shape da casa; nunca sobrescreve", async () => {
    await evalTest("EVAL-047: sdd new — scaffold spec/design/tasks no shape da casa; 2º scaffold recusado (nunca sobrescreve)", async () => {
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const result = scaffoldFeature({ cwd: repo, packageRoot: PACKAGE_ROOT }, { feature: "f30-pi-first-class", scope: "large" });
        expect(result.code).toBe(0);
        expect(result.scope).toBe("large");
        for (const file of ["spec.md", "design.md", "tasks.md"]) {
          const p = path.join(repo, ".specs", "features", "f30-pi-first-class", file);
          expect(fs.existsSync(p)).toBe(true);
          const content = fs.readFileSync(p, "utf8");
          expect(content).toContain("f30-pi-first-class");
          // Shape da casa (seções-chave por template).
          if (file === "spec.md") {
            expect(content).toContain("Problem Statement");
            expect(content).toContain("User Stories");
            expect(content).toContain("Requirement Traceability");
          }
          if (file === "design.md") expect(content).toContain("## Decisões");
          if (file === "tasks.md") expect(content).toContain("## T1");
        }
        // Materialização das chains no scaffold (o CLI sdd new chama
        // materializeChains — fork subagents descobre de .pi/chains).
        const materialized = materializeChains({ cwd: repo, packageRoot: PACKAGE_ROOT });
        expect(materialized.copied.length).toBe(4);
        expect(fs.existsSync(path.join(repo, ".pi", "chains", "sdd-spec.chain.md"))).toBe(true);
        // 2º scaffold → recusado (nunca sobrescreve).
        const again = scaffoldFeature({ cwd: repo, packageRoot: PACKAGE_ROOT }, { feature: "f30-pi-first-class", scope: "large" });
        expect(again.code).toBe(1);
        expect(again.text).toContain("já existe");
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-047" });
  });

  test("deny-list RPG ausente de persona, templates e chains (decisão 2)", async () => {
    await evalTest("EVAL-047: deny-list — nenhum termo RPG em persona/templates/prompts/chains renderizados", async () => {
      // Persona.
      assertNoRpgTerms(PERSONA_TEXT, "persona");
      assertNoRpgTerms(buildPersonaSection(), "seção persona");
      // Templates (renderizados com vars).
      const vars = { feature: "x", scope: "large", prereq: "F1", objective: "test" };
      for (const name of ["spec", "design", "tasks"] as const) {
        const rendered = renderTemplate(name, vars, PACKAGE_ROOT);
        assertNoRpgTerms(rendered, `template ${name}`);
        expect(rendered).not.toMatch(/\{\{feature\}\}/); // placeholders substituídos
      }
      // Prompts.
      for (const name of ["spec", "design", "tasks", "review"] as const) {
        assertNoRpgTerms(loadPrompt(name, PACKAGE_ROOT), `prompt ${name}`);
      }
      // Chains (assets).
      for (const name of SDD_CHAIN_NAMES) {
        const info = readChainInfo(name, PACKAGE_ROOT);
        assertNoRpgTerms(`${info.description} ${info.steps.join(" ")}`, `chain ${name}`);
      }
      // renderTemplateContent determinístico.
      expect(renderTemplateContent("a {{feature}} b", vars)).toBe("a x b");
      expect(renderTemplateContent("a {{feature}} b", vars)).toBe("a x b");
    }, { evalId: "EVAL-047" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-048 — config/kill switches (D5/PFC-05)
// ---------------------------------------------------------------------------

describe("EVAL-048 — config models/persona (defaults; freeze; kill switches)", () => {
  test("defaults fail-closed; validação inválida → defaults + reporte; freeze por sessão", async () => {
    await evalTest("EVAL-048: config — defaults; inválida → defaults + errors (fail-closed); freeze (D12)", async () => {
      // Defaults.
      expect(defaultModelsConfig()).toEqual({ enabled: true, default: null, override: null, agents: {}, autoGenerateModelsJson: false });
      expect(defaultPersonaConfig()).toEqual({
        enabled: true,
        rulesInjector: { enabled: true, toolCallLevel: false },
        firstMessageVariant: { enabled: true },
      });
      // Validação: inválida → defaults seguros + errors (F24 D10).
      const badModels = validateModelsConfig({ enabled: "yes", agents: { pi: { fallbackChain: [{ providers: "x", model: 1 }] } } });
      expect(badModels.ok).toBe(false);
      expect(badModels.config!.enabled).toBe(true); // fail-closed → default
      const badPersona = validatePersonaConfig({ enabled: 42 });
      expect(badPersona.ok).toBe(false);
      expect(badPersona.config!.enabled).toBe(true);
      // Válida com chains.
      const ok = validateModelsConfig({ enabled: true, agents: { pi: { fallbackChain: [{ providers: ["anthropic"], model: "claude-sonnet-4.6" }] } } });
      expect(ok.ok).toBe(true);
      expect(ok.config!.agents.pi!.fallbackChain[0]!.model).toBe("claude-sonnet-4.6");
      // Kill switches (F20).
      expect(modelsKillSwitch({ RUNECRAFT_MODELS: "0" }).active).toBe(true);
      expect(modelsKillSwitch({ RUNECRAFT_MODELS: "false" }).active).toBe(true);
      expect(modelsKillSwitch({ RUNECRAFT_MODELS: "off" }).active).toBe(true);
      expect(modelsKillSwitch({}).active).toBe(false);
      expect(personaKillSwitch({ RUNECRAFT_PERSONA: "0" }).active).toBe(true);
      expect(personaKillSwitch({}).active).toBe(false);
      // Override env.
      expect(modelOverrideEnv({ RUNECRAFT_MODEL_OVERRIDE: "x/y" })).toBe("x/y");
      expect(modelOverrideEnv({})).toBeNull();
      // Freeze por sessão (D12): snapshot no init — mudança posterior não afeta.
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const env = { ...process.env, RUNECRAFT_PI_HOME: path.join(base, "pi-agent"), HOME: base };
        const session = new SessionModelsConfig(env);
        session.capture(repo);
        const frozen = session.frozen(repo);
        expect(frozen.config.enabled).toBe(true);
        expect(frozen.config.agents).toEqual({});
        const sessionPersona = new SessionPersonaConfig(env);
        sessionPersona.capture(repo);
        expect(sessionPersona.frozen(repo).config.enabled).toBe(true);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-048" });
  });

  test("kill switches testados na suite: extensão persona inerte + CLI models recusa (nada criado)", async () => {
    await evalTest("EVAL-048: kill switches — RUNECRAFT_PERSONA=0 → extensão inerte; RUNECRAFT_MODELS=0 → CLI recusa (exit 0)", async () => {
      // Persona inerte já coberto no EVAL-039 (2º test) — aqui o parse.
      expect(personaKillSwitch({ RUNECRAFT_PERSONA: "off" }).value).toBe("off");
      // CLI models com kill switch → recusa fail-visible, exit 0, nada criado.
      const base = makeTmp();
      try {
        const repo = path.join(base, "repo");
        fs.mkdirSync(repo, { recursive: true });
        const env = { ...process.env, RUNECRAFT_PI_HOME: path.join(base, "pi-agent"), HOME: base, RUNECRAFT_MODELS: "0" };
        let stdout = "";
        const code = await runModelsCommand({
          json: false,
          out: { write: (s: string) => (stdout += s) },
          err: { write: () => {} },
          rt: { cwd: repo, env },
          subcommand: "generate",
          args: [],
        });
        expect(code).toBe(0);
        expect(stdout).toContain("models disabled");
        expect(fs.existsSync(path.join(env.RUNECRAFT_PI_HOME, "models.json"))).toBe(false);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-048" });
  });
});
