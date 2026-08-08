// resilience/extension.test.ts — wiring Pi do F27 (T3, RES-01/02/03/04).
//
// Integração via handler exportado (QA-5 — eventos scriptados): um fake pi
// (event emitter) dirige o installResilience com eventos reais do SDK
// (session_start reason=resume|reload, session_compact sintético,
// before_agent_start, tool_call, agent_settled) e verifica:
//   - trigger fallback honesto (QA-2): session_start resume/reload → pending;
//   - before_agent_start → systemPrompt ENCADEADO (append ao prompt corrente);
//   - scoping de sessão (sessão errada → sem injeção);
//   - goal completo/pausado → sem rewrite;
//   - kill switch RUNECRAFT_RESILIENCE=0 → camada inerte;
//   - stall: chamadas idênticas repetidas → stall:repetition + fallback no
//     log de eventos (.runecraft/resilience-events.jsonl);
//   - session_compact → grace + pending (D1).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installResilience } from "../../src/extensions/resilience.ts";
import { readContinuationMeta } from "../../src/resilience/continuation.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContinuationTask } from "../../src/resilience/types.ts";

/** Meta do continuation.json (read.ok já validado pelo caller). */
function meta(cwd: string): { lastSessionId: string | null } {
  const read = readContinuationMeta(cwd);
  return read.ok ? read.meta : { lastSessionId: null };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resilience-extension-"));
}

function task(id: string, title: string, status: string): ContinuationTask {
  return { id, title, status };
}

function writeLedger(cwd: string, goal: Record<string, unknown> | null): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function activeGoal(tasks?: ContinuationTask[]): Record<string, unknown> {
  const goal: Record<string, unknown> = { status: "active", id: "g1", objective: "Ship F27", autoContinue: true };
  if (tasks) goal.taskList = { version: 1, tasks };
  return goal;
}

interface FakePi {
  api: ExtensionAPI;
  handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>;
  commands: Map<string, { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>;
  sentUserMessages: string[];
  sessionId: string;
}

function makeFakePi(sessionId: string): FakePi {
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const commands = new Map();
  const sentUserMessages: string[] = [];
  const api = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }): void {
      commands.set(name, options);
    },
    sendUserMessage(content: string): void {
      sentUserMessages.push(content);
    },
    getSessionName(): string | undefined {
      return undefined;
    },
  } as unknown as ExtensionAPI;
  return { api, handlers, commands, sentUserMessages, sessionId };
}

function makeCtx(cwd: string, sessionId: string, opts: { idle?: boolean; pending?: boolean } = {}): ExtensionContext {
  return {
    cwd,
    mode: "rpc",
    hasUI: false,
    ui: { notify: () => {} } as unknown as ExtensionContext["ui"],
    sessionManager: { getSessionId: () => sessionId } as unknown as ExtensionContext["sessionManager"],
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    model: undefined,
    isIdle: () => opts.idle ?? true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => opts.pending ?? false,
    shutdown: () => {},
    getContextUsage: () => undefined,
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

function eventsLog(cwd: string): string {
  const file = path.join(cwd, ".runecraft", "resilience-events.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

describe("wiring — trigger fallback honesto (QA-2/D1)", () => {
  test("session_start reason=resume com goal ativo → before_agent_start injeta prompt ENCADEADO", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "complete"), task("2", "T2", "complete"), task("3", "T3", "complete"), task("4", "T4", "pending")]));
      const pi = makeFakePi("sess-1");
      installResilience(pi.api, { env: process.env });
      const ctx = makeCtx(repo, "sess-1");

      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, ctx);
      const result = (await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE_PROMPT", systemPromptOptions: {} }, ctx)) as { systemPrompt?: string } | undefined;
      expect(result).toBeDefined();
      // ENCADEADO: anexa ao prompt corrente (nunca sobrescreve outras extensões).
      expect(result!.systemPrompt!.startsWith("BASE_PROMPT\n\n")).toBe(true);
      expect(result!.systemPrompt!).toContain("<!-- runecraft:continuation -->");
      expect(result!.systemPrompt!).toContain("Progress: 3/4 tasks complete");
      // Ownership registrada + contador incrementado.
      const meta = JSON.parse(fs.readFileSync(path.join(repo, ".runecraft", "continuation.json"), "utf8"));
      expect(meta.lastSessionId).toBe("sess-1");
      expect(meta.continuationCount).toBe(1);
      // Eventos no log (evidência).
      expect(eventsLog(repo)).toContain("continuation_pending");
      expect(eventsLog(repo)).toContain("continuation_injected");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("session_start reason=reload → pending (recarga pós-compactação do SDK)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_start", { type: "session_start", reason: "reload" }, makeCtx(repo, "s-1"));
      expect(eventsLog(repo)).toContain("continuation_pending");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("session_start reason=startup|new → SEM injeção automática (hold — semântica glla v0.28.21+; /start-work cobre)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, makeCtx(repo, "s-1"));
      const result = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, makeCtx(repo, "s-1"));
      expect(result).toBeUndefined();
      expect(eventsLog(repo)).not.toContain("continuation_injected");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("session_compact → pending + grace pós-compactação (D1); próximo turno injeta", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "complete"), task("2", "T2", "pending")]));
      const pi = makeFakePi("s-1");
      let now = 1_000;
      installResilience(pi.api, { env: process.env, now: () => now });
      const ctx = makeCtx(repo, "s-1");
      await emit(pi, "session_compact", { type: "session_compact", compactionEntry: {}, fromExtension: false, reason: "threshold", willRetry: false }, ctx);
      expect(eventsLog(repo)).toContain("compacted");
      const result = (await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE", systemPromptOptions: {} }, ctx)) as { systemPrompt?: string } | undefined;
      expect(result!.systemPrompt!).toContain("runecraft:continuation");
      // Grace pós-compactação: agent_settled logo após → stall quieto.
      now = 2_000;
      await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);
      expect(eventsLog(repo)).not.toContain("stall:");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("session_before_compact → snapshot do taskList na meta (D3)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "complete"), task("2", "T2", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_before_compact", { type: "session_before_compact", preparation: {}, branchEntries: [], reason: "threshold", willRetry: false, signal: new AbortController().signal }, makeCtx(repo, "s-1"));
      const meta = JSON.parse(fs.readFileSync(path.join(repo, ".runecraft", "continuation.json"), "utf8"));
      expect(meta.taskListSnapshot).toHaveLength(2);
      expect(meta.compactedAt).toBeTruthy();
      expect(eventsLog(repo)).toContain("snapshot");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — scoping de sessão (D2 — AC4)", () => {
  test("sessão DIFERENTE da ownership → sem injeção (multi-sessão por cwd — AD-019)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("sess-owner");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, makeCtx(repo, "sess-owner"));
      // Subagent child (outra sessão) nunca injeta.
      const child = makeFakePi("sess-child");
      const result = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, makeCtx(repo, "sess-child"));
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("child session_start NÃO sobrescreve o dono (first-owner-wins — fix cleric F27 B1)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("sess-owner");
      installResilience(pi.api, { env: process.env });
      // Owner registra-se primeiro.
      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, makeCtx(repo, "sess-owner"));
      expect(meta(repo).lastSessionId).toBe("sess-owner");
      // Child (subagent) dispara session_start com o MESMO agentDir — NÃO pode
      // sequestrar a ownership (senão a sessão principal perde a continuação).
      const child = makeFakePi("sess-child");
      await emit(child, "session_start", { type: "session_start", reason: "resume" }, makeCtx(repo, "sess-child"));
      expect(meta(repo).lastSessionId).toBe("sess-owner"); // inalterado
      // E a injeção continua funcionando para o dono.
      const result = (await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, makeCtx(repo, "sess-owner"))) as { systemPrompt?: string } | undefined;
      expect(result).toBeDefined();
      expect(result!.systemPrompt).toContain("runecraft:continuation");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("goal completo → nenhum prompt (AC4)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, { status: "complete", id: "g1", objective: "done", autoContinue: false, taskList: { version: 1, tasks: [task("1", "T1", "complete")] } });
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, makeCtx(repo, "s-1"));
      const result = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, makeCtx(repo, "s-1"));
      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("sem goal no ledger → sem pending (sem ruído — edge da spec)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, null);
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, makeCtx(repo, "s-1"));
      const result = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, makeCtx(repo, "s-1"));
      expect(result).toBeUndefined();
      expect(eventsLog(repo)).not.toContain("continuation_pending");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — kill switch (RUNECRAFT_RESILIENCE=0 — AC5)", () => {
  test("camada inerte: sem pending, sem injeção, sem snapshot, sem stall", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: { ...process.env, RUNECRAFT_RESILIENCE: "0" } });
      const ctx = makeCtx(repo, "s-1");

      await emit(pi, "session_start", { type: "session_start", reason: "resume" }, ctx);
      await emit(pi, "session_before_compact", { type: "session_before_compact", preparation: {}, branchEntries: [], reason: "manual", willRetry: false, signal: new AbortController().signal }, ctx);
      await emit(pi, "session_compact", { type: "session_compact", compactionEntry: {}, fromExtension: false, reason: "manual", willRetry: false }, ctx);
      const result = await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, ctx);

      expect(result).toBeUndefined();
      expect(fs.existsSync(path.join(repo, ".runecraft", "continuation.json"))).toBe(false);
      expect(eventsLog(repo)).toBe("");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — /start-work (resume explícito de restart — F1-4 seguro)", () => {
  test("comando injeta a continuação via sendUserMessage (goal ativo)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "complete"), task("2", "T2", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      const ctx = makeCtx(repo, "s-1");
      const cmd = pi.commands.get("start-work")!;
      await cmd.handler("", ctx);
      expect(pi.sentUserMessages.length).toBe(1);
      expect(pi.sentUserMessages[0]).toContain("runecraft:continuation");
      expect(pi.sentUserMessages[0]).toContain("T2");
      expect(eventsLog(repo)).toContain("start_work_injected");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("comando sem goal ativo → nenhuma injeção (sem ruído)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, null);
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      const cmd = pi.commands.get("start-work")!;
      await cmd.handler("", makeCtx(repo, "s-1"));
      expect(pi.sentUserMessages.length).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("wiring — stall detection em eventos reais (D4/F4)", () => {
  test("3 chamadas idênticas de tool → stall:repetition no log + fallback re-inject (stop-all)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      const ctx = makeCtx(repo, "s-1");

      // Session_start com goal ativo (registra ownership).
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);

      // 3 tool_calls idênticas (mesma tool + args).
      const toolEvent = (i: number) => ({ type: "tool_call", toolCallId: `c${i}`, toolName: "bash", input: { command: "echo same" } });
      await emit(pi, "tool_call", toolEvent(1), ctx);
      await emit(pi, "tool_call", toolEvent(2), ctx);
      await emit(pi, "tool_call", toolEvent(3), ctx);

      // agent_settled → avaliação (sessão idle, sem pending).
      await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);

      const log = eventsLog(repo);
      expect(log).toContain("stall:repetition");
      expect(log).toContain('"fallback"');
      expect(log).toContain('"action":"re-inject-continuation"');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("chamadas DIFERENTES → sem sinal de stall (sem falso-positivo)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, activeGoal([task("1", "T1", "pending")]));
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      const ctx = makeCtx(repo, "s-1");
      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      for (const cmd of ["echo a", "echo b", "echo c"]) {
        await emit(pi, "tool_call", { type: "tool_call", toolCallId: "c", toolName: "bash", input: { command: cmd } }, ctx);
      }
      await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);
      expect(eventsLog(repo)).not.toContain("stall:");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("sem goal supervisionado → stall machinery quieto (mesmo com chamadas idênticas)", async () => {
    const base = makeTmp();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      writeLedger(repo, null); // sem goal
      const pi = makeFakePi("s-1");
      installResilience(pi.api, { env: process.env });
      const ctx = makeCtx(repo, "s-1");
      for (let i = 0; i < 3; i++) {
        await emit(pi, "tool_call", { type: "tool_call", toolCallId: `c${i}`, toolName: "bash", input: { command: "echo same" } }, ctx);
      }
      await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);
      expect(eventsLog(repo)).not.toContain("stall:");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
