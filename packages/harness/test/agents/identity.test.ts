// agents/identity.test.ts — F32 T6 (ROLE-07): ponte de identidade do agente.
//
// Validado no Execute F32: o fork subagents NÃO seta RUNECRAFT_AGENT_ID por
// dispatch (seta PI_SUBAGENT_CHILD_AGENT no child — pi-args.ts:26/354). A
// bridge (adendo before_agent_start do F28 — design D7/fallback) traduz a
// identidade do child para o env que o harness lê (guard F24 currentAgentId).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  FORK_CHILD_AGENT_ENV,
  forkChildAgentId,
  propagateForkAgentIdentity,
} from "../../src/agents/identity.ts";
import { currentAgentId } from "../../src/guards/ranger-md-only.ts";

describe("ponte de identidade (D7 — fork child → RUNECRAFT_AGENT_ID)", () => {
  test("forkChildAgentId lê PI_SUBAGENT_CHILD_AGENT (trim; vazio → undefined)", () => {
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "auditor" })).toBe("auditor");
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "  scout  " })).toBe("scout");
    expect(forkChildAgentId({})).toBeUndefined();
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "" })).toBeUndefined();
  });

  test("propagateForkAgentIdentity: child do fork vence o env herdado do pai", () => {
    const env: NodeJS.ProcessEnv = { RUNECRAFT_AGENT_ID: "main", [FORK_CHILD_AGENT_ENV]: "auditor" };
    const propagated = propagateForkAgentIdentity(env);
    expect(propagated).toBe("auditor");
    // O guard F24 lê exatamente esse env (currentAgentId — ranger-md-only.ts).
    expect(currentAgentId(env)).toBe("auditor");
  });

  test("sem child do fork → nada a propagar (env intocado)", () => {
    const env: NodeJS.ProcessEnv = { RUNECRAFT_AGENT_ID: "main" };
    expect(propagateForkAgentIdentity(env)).toBeUndefined();
    expect(env.RUNECRAFT_AGENT_ID).toBe("main");
  });

  test("child sem identidade explícita do pai → auditor resolve no guard", () => {
    const env: NodeJS.ProcessEnv = { [FORK_CHILD_AGENT_ENV]: "auditor" };
    propagateForkAgentIdentity(env);
    expect(currentAgentId(env)).toBe("auditor");
  });
});

describe("ponte end-to-end (fix cleric F32 — child do fork → guard F24)", () => {
  // Fake pi mínimo (mesmo padrão do test/observability/extension.test.ts).
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

  function makeCtx(cwd: string): ExtensionContext {
    return {
      cwd,
      mode: "rpc",
      hasUI: false,
      ui: { notify: () => {} } as unknown as ExtensionContext["ui"],
      sessionManager: { getSessionId: () => "child-1" } as unknown as ExtensionContext["sessionManager"],
      modelRegistry: {} as ExtensionContext["modelRegistry"],
      model: undefined,
      isIdle: () => true,
      isProjectTrusted: () => true,
      signal: undefined,
      abort: () => {},
      hasPendingMessages: () => false,
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
      // Short-circuit igual ao runner real do SDK: o PRIMEIRO { block: true }
      // interrompe a cadeia de handlers (runner.js emitToolCall).
      const maybe = result as { block?: boolean } | undefined;
      if (maybe !== null && typeof maybe === "object" && maybe.block === true) return result;
    }
    return result;
  }

  test("child auditor: env do fork → bridge → guard bloqueia .ts e deixa .md passar", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "identity-bridge-"));
    const repo = path.join(base, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const prevChild = process.env[FORK_CHILD_AGENT_ENV];
    const prevAgent = process.env.RUNECRAFT_AGENT_ID;
    try {
      // Cena real: child do fork (env do fork) — o env é a MESMA referência
      // que os guards leem (a bridge escreve em process.env in-place).
      process.env[FORK_CHILD_AGENT_ENV] = "auditor";
      delete process.env.RUNECRAFT_AGENT_ID;

      const pi = makeFakePi();
      const { installGuards } = await import("../../src/guards/index.ts");
      const { installObservability } = await import("../../src/extensions/observability.ts");
      // Env compartilhado (deps.env = process.env — a bridge muta o mesmo objeto).
      installGuards(pi.api, { env: process.env });
      installObservability(pi.api, { env: process.env });
      const ctx = makeCtx(repo);

      await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
      // A ponte roda no before_agent_start do child (adendo F28 — F32 D7).
      await emit(pi, "before_agent_start", { type: "before_agent_start", prompt: "x", systemPrompt: "BASE", systemPromptOptions: {} }, ctx);
      expect(process.env.RUNECRAFT_AGENT_ID as string | undefined).toBe("auditor"); // ponte propagou

      // Write .ts → ranger-md-only BLOQUEIA (auditor na lista default F32).
      const blocked = await emit(pi, "tool_call", { type: "tool_call", toolCallId: "c1", toolName: "write", input: { path: "src/feature.ts", content: "x" } }, ctx);
      expect(blocked).toBeDefined();
      expect((blocked as { block: boolean }).block).toBe(true);
      expect((blocked as { reason: string }).reason.startsWith("ranger-md-only: ")).toBe(true);

      // Write .md → passa (sem block).
      const ok = await emit(pi, "tool_call", { type: "tool_call", toolCallId: "c2", toolName: "write", input: { path: "docs/note.md", content: "x" } }, ctx);
      expect(ok).toBeUndefined();
    } finally {
      if (prevChild === undefined) delete process.env[FORK_CHILD_AGENT_ENV];
      else process.env[FORK_CHILD_AGENT_ENV] = prevChild;
      if (prevAgent === undefined) delete process.env.RUNECRAFT_AGENT_ID;
      else process.env.RUNECRAFT_AGENT_ID = prevAgent;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
