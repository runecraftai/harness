// observability/extension.test.ts — wiring Pi do F28 (T6, D1/D4/D6/D7).
//
// Integração via handler exportado (padrão QA-5 do F27 — eventos scriptados
// reais do SDK dirigem o installObservability com um fake pi):
//   - session_start → session:started (header bundle) + bridge token-budget;
//   - tool_call → tool:call (argsHash) + context:usage (getContextUsage);
//   - tool_execution_end com reason F24 → guard:blocked + lesson capturada +
//     adendo execution pendente;
//   - before_agent_start → adendo anexado ao systemPrompt ENCADEADO (marker;
//     NÃO sobrescreve — outra extensão continua funcionando);
//   - session_shutdown → session:ended com agregados;
//   - kill switch RUNECRAFT_OBSERVABILITY=0 → inerte (zero arquivos);
//   - escrita falha → a sessão continua (sem throw).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installObservability } from "../../src/extensions/observability.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-extension-"));
}

interface FakePi {
  api: ExtensionAPI;
  handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>;
}

function makeFakePi(): FakePi {
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const api = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(): void {},
    sendUserMessage(): void {},
    getSessionName(): string | undefined {
      return undefined;
    },
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

function makeCtx(cwd: string, sessionId: string, opts: { contextUsage?: unknown } = {}): ExtensionContext {
  return {
    cwd,
    mode: "rpc",
    hasUI: false,
    ui: { notify: () => {} } as unknown as ExtensionContext["ui"],
    sessionManager: { getSessionId: () => sessionId } as unknown as ExtensionContext["sessionManager"],
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    model: { id: "eval-model" } as unknown as ExtensionContext["model"],
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => opts.contextUsage,
    compact: () => {},
    getSystemPrompt: () => "",
  } as ExtensionContext;
}

async function emit(pi: FakePi, eventType: string, event: unknown, ctx: ExtensionContext): Promise<unknown> {
  let result: unknown;
  for (const handler of pi.handlers.get(eventType) ?? []) {
    result = await handler(event, ctx);
  }
  return result;
}

function eventsLog(cwd: string, sessionId: string): string {
  const file = path.join(cwd, ".runecraft", "events", `${sessionId}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function parsedEvents(cwd: string, sessionId: string): Array<{ kind: string; seq: number; bundle?: string; payload: Record<string, unknown> }> {
  return eventsLog(cwd, sessionId)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Instala o observability com env determinístico (sem kill switch). */
function install(pi: FakePi, cwd: string, deps: Record<string, unknown> = {}): void {
  installObservability(pi.api, {
    env: { ...process.env },
    now: () => 1000,
    isoNow: () => "2026-08-08T00:00:00.000Z",
    collectBundle: () => ({
      harnessVersion: "0.1.0",
      sdkVersion: "0.81.0",
      forks: {},
      config: {},
      settings: {},
      rules: "rules",
      routingVersion: "1",
    }),
    gitHead: () => "abc1234",
    ...deps,
  });
}

describe("wiring — session_start → header + bundle (F1/D3)", () => {
  test("session_start grava session:started com bundleHash full, gitHead e versões", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      const events = parsedEvents(repo, "sess-1");
      expect(events[0]!.kind).toBe("session:started");
      expect(events[0]!.seq).toBe(0);
      expect((events[0]!.payload.bundleHash as string).length).toBe(64);
      expect(events[0]!.bundle).toHaveLength(12);
      expect(events[0]!.payload.gitHead).toBe("abc1234");
      expect((events[0]!.payload.versions as Record<string, string>).harness).toBe("0.1.0");
      // .gitignore escopo fino (T9): events/ + lessons.jsonl gitignored;
      // promoted.jsonl NÃO.
      const ignore = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
      expect(ignore).toContain(".runecraft/events/");
      expect(ignore).toContain(".runecraft/lessons.jsonl");
      expect(ignore).not.toContain("promoted.jsonl");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("kill switch RUNECRAFT_OBSERVABILITY=0 → inerte, zero arquivos (AC 1.4)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const pi = makeFakePi();
      install(pi, repo, { env: { ...process.env, RUNECRAFT_OBSERVABILITY: "0" } });
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      await emit(pi, "tool_call", { type: "tool_call", toolCallId: "c1", toolName: "read", input: {} }, ctx);
      expect(fs.existsSync(path.join(repo, ".runecraft"))).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("falha de escrita induzida → a sessão CONTINUA (sem throw — AC 1.3)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      // Path inválido: arquivo no lugar do diretório .runecraft/events.
      fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
      fs.writeFileSync(path.join(repo, ".runecraft", "events"), "not-a-dir");
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await expect(emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx)).resolves.toBeUndefined();
      // O handler de tool_call também não quebra.
      await expect(emit(pi, "tool_call", { type: "tool_call", toolCallId: "c1", toolName: "read", input: {} }, ctx)).resolves.toBeUndefined();
      await expect(emit(pi, "agent_end", { type: "agent_end", messages: [] }, ctx)).resolves.toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — observação do bloqueio F24 via tool_execution_end (D7a)", () => {
  test("tool_call → tool:call com argsHash; tool_execution_end com reason F24 → guard:blocked + lesson", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1", { contextUsage: { tokens: 500, contextWindow: 1000, percent: 0.5 } });
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      await emit(pi, "tool_call", { type: "tool_call", toolCallId: "c1", toolName: "write", input: { path: "README.md", content: "x" } }, ctx);
      await emit(
        pi,
        "tool_execution_end",
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "write",
          // Shape real do agent-loop.js createErrorToolResult(reason): o reason
          // F24 `<guardId>: msg` chega no content[0].text com isError:true.
          result: { content: [{ type: "text", text: "write-existing-file-guard: write blocked — target already exists: README.md" }], details: {} },
          isError: true,
        },
        ctx,
      );

      const events = parsedEvents(repo, "sess-1");
      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain("tool:call");
      expect(kinds).toContain("guard:blocked");
      const toolCall = events.find((e) => e.kind === "tool:call")!;
      expect(toolCall.payload.argsHash).toMatch(/^[0-9a-f]{16}$/);
      expect(toolCall.payload).not.toHaveProperty("args"); // argsHash, nunca args crus
      const blocked = events.find((e) => e.kind === "guard:blocked")!;
      expect(blocked.payload.guardId).toBe("writeExistingFile");
      expect(blocked.payload.reason).toContain("write-existing-file-guard:");
      // Lesson capturada (OBS-06 — 4 campos + gate).
      const captured = events.find((e) => e.kind === "lesson:captured")!;
      expect(captured.payload.gate).toBe("writeExistingFile");
      expect(captured.payload.trigger).toBe("write blocked by writeExistingFile");
      expect(typeof captured.payload.triggerSignature).toBe("string");
      // context:usage do getContextUsage (fonte SDK — QA-5).
      const ctxUsage = events.find((e) => e.kind === "context:usage")!;
      expect(ctxUsage.payload.source).toBe("sdk");
      expect(ctxUsage.payload.action).toBe("none");
      // session:ended com agregados (agent_end).
      await emit(pi, "agent_end", { type: "agent_end", messages: [] }, ctx);
      const ended = parsedEvents(repo, "sess-1").find((e) => e.kind === "session:ended")!;
      expect(ended.payload.totalToolCalls).toBe(1);
      expect(ended.payload.toolUsage).toEqual([{ tool: "write", count: 1 }]);
      expect((ended.payload.tokenTotals as { totalMessages: number }).totalMessages).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("erro de tool SEM prefixo de guard → NÃO é guard:blocked (sem invenção)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      await emit(
        pi,
        "tool_execution_end",
        { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "command not found" }], details: {} }, isError: true },
        ctx,
      );
      const kinds = parsedEvents(repo, "sess-1").map((e) => e.kind);
      expect(kinds).not.toContain("guard:blocked");
      expect(kinds).toContain("tool:result");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — adendo (D6): planning e execution via before_agent_start", () => {
  test("adendo execution: bloqueio → lição do gate injetada no turno seguinte com marker; chaining preservado", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      // Sem lessons → before_agent_start devolve undefined (sem rewrite — D6 edge).
      const none = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, ctx);
      expect(none).toBeUndefined();

      // Bloqueio F24 → lesson do gate → adendo pendente.
      await emit(
        pi,
        "tool_execution_end",
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "write",
          result: { content: [{ type: "text", text: "write-existing-file-guard: write blocked — target already exists: README.md" }], details: {} },
          isError: true,
        },
        ctx,
      );
      const result = (await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} }, ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeDefined();
      expect(result!.systemPrompt!.startsWith("BASE_PROMPT\n\n")).toBe(true); // encadeado, não sobrescreve
      expect(result!.systemPrompt!).toContain("<!-- runecraft:lessons -->");
      expect(result!.systemPrompt!).toContain("Gatilho: write blocked by writeExistingFile");
      // Evento adendo:injected com lessonIds + textHash.
      const events = parsedEvents(repo, "sess-1");
      const injected = events.find((e) => e.kind === "adendo:injected")!;
      expect(injected.payload.track).toBe("execution");
      expect(injected.payload.gate).toBe("writeExistingFile");
      expect((injected.payload.lessonIds as string[]).length).toBe(1);
      expect(injected.payload.textHash).toMatch(/^[0-9a-f]{16}$/);
      // Adendo consumido → próximo before_agent_start sem rewrite.
      const after = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, ctx);
      expect(after).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("adendo planning: lessons promovidas injetadas no início da sessão", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      // Seed de promoted.jsonl (memória de time — versionado).
      const promotedDir = path.join(repo, ".runecraft", "lessons");
      fs.mkdirSync(promotedDir, { recursive: true });
      const { applyCapture, writePromotedFile, triggerSignatureOf } = await import("../../src/observability/lessons.ts");
      const captured = applyCapture(
        [],
        { trigger: "never repeat the same failure", antiPattern: "repeating it", preferred: "learn from it", priority: "high", gate: "planning-gate", track: "execution" },
        0,
        { promotionThreshold: 3, highPriorityThreshold: 2 },
      ).record;
      writePromotedFile(path.join(promotedDir, "promoted.jsonl"), [{ ...captured, status: "promoted" }]);

      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      const result = (await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeDefined();
      expect(result!.systemPrompt!).toContain("<!-- runecraft:lessons -->");
      expect(result!.systemPrompt!).toContain("never repeat the same failure");
      const injected = parsedEvents(repo, "sess-1").find((e) => e.kind === "adendo:injected")!;
      expect(injected.payload.track).toBe("planning");
      // lessonIds vêm do promoted.jsonl (memória de time — D6).
      expect((injected.payload.lessonIds as string[]).length).toBe(1);
      void triggerSignatureOf;
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — bridge token-budget (D4 — leitura read-only de .pi/)", () => {
  test("session_start com token-budget seedado → context:usage com source bridge", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const budgetDir = path.join(repo, ".pi", "taskflows", "runs", "token-budget");
      fs.mkdirSync(budgetDir, { recursive: true });
      fs.writeFileSync(
        path.join(budgetDir, "token-budget-run1.json"),
        JSON.stringify({ runId: "token-budget-run1", def: { budget: { maxTokens: 1000 } }, status: "completed", phases: { run: { usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 850 } } } }),
      );
      const pi = makeFakePi();
      install(pi, repo);
      const ctx = makeCtx(repo, "sess-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      const events = parsedEvents(repo, "sess-1");
      const usage = events.find((e) => e.kind === "context:usage" && e.payload.source === "bridge")!;
      expect(usage.payload.usedTokens).toBe(850);
      expect(usage.payload.maxTokens).toBe(1000);
      expect(usage.payload.action).toBe("warn"); // 85% ≥ 0.8
      // NUNCA escreve em .pi/ (read-only — D4).
      expect(fs.readdirSync(budgetDir).length).toBe(1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
