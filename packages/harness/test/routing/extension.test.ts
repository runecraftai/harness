// routing/extension.test.ts — wiring da extensão routing (F33, T3; D1/D6).
//
// Cobre (espelho dos EVAL-076/077): before_agent_start injeta o directive
// (marker `<!-- runecraft:routing -->`) com a classificação determinística
// da PRIMEIRA MENSAGEM (event.prompt — validado no Execute: types.d.ts:518
// "The raw user prompt text (after expansion)"), freeze por sessão (2ª
// chamada = mesmo directive — sem re-classificação por spawn), kill switch
// RUNECRAFT_ROUTING=0 → inerte, two-driver (ledger glla supervisionando →
// routing skip), chain ausente → direct + warn (fail-closed), erro → sem
// rewrite (fail-closed). Handlers exportados com eventos sintéticos (padrão
// AD-027 QA-5 — EVAL-021/039).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installRouting } from "../../src/extensions/routing.ts";
import { ROUTING_MARKER as DIRECTIVE_MARKER } from "../../src/routing/directive.ts";

const ROUTING_MARKER_VALUE = DIRECTIVE_MARKER;

/** Fake pi que captura handlers por evento (padrão AD-027 QA-5). */
interface FakePi {
  handlers: Map<string, Array<(e: unknown, c: unknown) => unknown>>;
  on(event: string, h: (e: unknown, c: unknown) => unknown): void;
  emit(t: string, e: unknown, ctx: unknown): Promise<unknown>;
}

function makeFakePi(): FakePi {
  const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
  return {
    handlers,
    on(event: string, h: (e: unknown, c: unknown) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
    },
    emit: async (t: string, e: unknown, ctx: unknown) => {
      // Chaining REAL (runner.js emitBeforeAgentStart): o systemPrompt de cada
      // extensão é re-passado para a próxima (append).
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
  return {
    cwd,
    sessionManager: { getSessionId: () => sessionId },
  };
}

function beforeAgentStartEvent(prompt: string): { type: string; prompt: string; systemPrompt: string; systemPromptOptions: Record<string, unknown> } {
  return { type: "before_agent_start", prompt, systemPrompt: "BASE_PROMPT", systemPromptOptions: {} };
}

function writeGllaLedger(cwd: string, goal: Record<string, unknown>): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function activeGoal(): Record<string, unknown> {
  return { status: "active", id: "g1", objective: "Ship F33", autoContinue: true };
}

/** Sobe um repo temp com .pi/chains/ contendo a chain dada (e .specs vazio). */
function makeRepo(base: string, chains: string[] = []): string {
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo, { recursive: true });
  if (chains.length > 0) {
    const dir = path.join(repo, ".pi", "chains");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of chains) fs.writeFileSync(path.join(dir, name), `# ${name}\n`, "utf8");
  }
  return repo;
}

describe("EVAL-076 — extensão routing: directive, freeze, kill switch", () => {
  test("before_agent_start injeta o directive (marker) com classificação do event.prompt", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit(
        "before_agent_start",
        beforeAgentStartEvent("implement the feature"),
        ctx,
      )) as { systemPrompt?: string } | undefined;
      expect(result).toBeDefined();
      const injected = result!.systemPrompt!;
      // Encadeado: base preservada + adendo com marker.
      expect(injected.startsWith("BASE_PROMPT\n\n")).toBe(true);
      expect(injected).toContain(ROUTING_MARKER_VALUE);
      expect(injected).toContain("Route: implement");
      expect(injected).toContain("Pilot chain: implement.chain.md");
      // Alvos válidos do catalog F32 presentes (read-only).
      expect(injected).toContain("### builder");
      expect(injected).toContain("### reviewer");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("freeze por sessão: 2ª chamada (subagente/passo) → MESMO directive (sem re-classificação)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const first = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string };
      const second = (await fake.emit("before_agent_start", beforeAgentStartEvent("review the code now"), ctx)) as { systemPrompt?: string };
      // O segundo evento tem sinal de review, mas o freeze mantém a decisão da
      // sessão (implement — sem re-classificação por spawn).
      expect(second.systemPrompt).toContain("Route: implement");
      expect(second.systemPrompt).not.toContain("Route: review");
      // Bloco idêntico (mesma decisão congelada).
      const blockOf = (s: string): string => s.slice(s.indexOf(ROUTING_MARKER_VALUE));
      expect(blockOf(second.systemPrompt!)).toBe(blockOf(first.systemPrompt!));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("nova sessão (session_start de novo) → nova decisão (freeze por SESSÃO)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md", "plan.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctxA = makeCtx(repo, "sess-a");
      const ctxB = makeCtx(repo, "sess-b");
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctxA);
      const first = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctxA)) as { systemPrompt?: string };
      expect(first.systemPrompt).toContain("Route: implement");
      // Nova sessão: session_start reseta o freeze → nova classificação.
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctxB);
      const second = (await fake.emit("before_agent_start", beforeAgentStartEvent("plan the feature and break down the work"), ctxB)) as { systemPrompt?: string };
      expect(second.systemPrompt).toContain("Route: planning");
      expect(second.systemPrompt).toContain("Pilot chain: plan.chain.md");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("kill switch RUNECRAFT_ROUTING=0 → inerte (nenhum rewrite, nenhuma decisão)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: { ...process.env, RUNECRAFT_ROUTING: "0" } });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the auth flow"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("rota direct → nenhum rewrite (fail-closed silencioso)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("hello world"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("chain ausente no .pi/chains/ → fail-closed direct + warn (nunca inventa)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, []); // .pi/chains/ sem a chain implement
      const warnings: string[] = [];
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env, warn: (m) => warnings.push(m) });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeUndefined();
      expect(warnings.some((w) => w.includes("chain ausente") && w.includes("implement"))).toBe(true);
      // Freeze mantém o direct fail-closed para a sessão.
      const again = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement another feature"), ctx)) as { systemPrompt?: string } | undefined;
      expect(again).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("erro na classificação → nenhum rewrite + warn (fail-closed D1)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const warnings: string[] = [];
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, {
        env: process.env,
        warn: (m) => warnings.push(m),
        resolveSpecPath: () => {
          throw new Error("spec scan boom");
        },
      });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeUndefined();
      expect(warnings.some((w) => w.includes("fail-closed"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("EVAL-077 — two-driver: sessão supervisionada (goal-loop) → routing inerte", () => {
  test("ledger glla com goal ativo + autoContinue → nenhum directive (o loop é o piloto)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      writeGllaLedger(repo, activeGoal());
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("sem ledger (sessão direta) → directive injetado normalmente", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = makeRepo(base, ["implement.chain.md"]);
      const fake = makeFakePi();
      installRouting(fake as unknown as ExtensionAPI, { env: process.env });
      const ctx = makeCtx(repo);
      await fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await fake.emit("before_agent_start", beforeAgentStartEvent("implement the feature"), ctx)) as { systemPrompt?: string } | undefined;
      expect(result!.systemPrompt).toContain(ROUTING_MARKER_VALUE);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("resolveSpecPath — .specs/<...>/spec.md (D3)", () => {
  test("encontra o spec em .specs/features/<slug>/spec.md (determinístico)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "routing-ext-"));
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(path.join(repo, ".specs", "features", "f1"), { recursive: true });
      fs.writeFileSync(path.join(repo, ".specs", "features", "f1", "spec.md"), "# spec");
      fs.mkdirSync(path.join(repo, ".specs", "features", "f2"), { recursive: true });
      fs.writeFileSync(path.join(repo, ".specs", "features", "f2", "spec.md"), "# spec 2");
      const { resolveSpecPath } = await import("../../src/extensions/routing.ts");
      // Ordenação estável → f1 primeiro.
      expect(resolveSpecPath(repo)).toContain("f1");
      // Sem .specs → null.
      const empty = path.join(base, "empty");
      fs.mkdirSync(empty, { recursive: true });
      expect(resolveSpecPath(empty)).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
