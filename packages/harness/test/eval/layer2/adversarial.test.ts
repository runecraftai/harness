// adversarial.test.ts — F5: o fixture É adversarial (DETR-04).
//
// Testes induzidos que validam o mecanismo do próprio fixture (D7): modelo
// desconhecido, tools ausentes, evidência fora de ordem e call além do script
// falham com diagnóstico (call esperada vs recebida). Se o fixture regredir
// silenciosamente, estes testes ficam vermelhos.
import { describe, expect, test } from "bun:test";
import { ChatServer } from "./fixture/chatServer.ts";
import { script, type ScriptedScenario } from "./fixture/scenarios.ts";

async function withServer(scenario: ScriptedScenario, fn: (server: ChatServer, port: number) => Promise<void>): Promise<void> {
  const server = new ChatServer(scenario);
  const port = await server.listen();
  try {
    await fn(server, port);
  } finally {
    server.close();
  }
}

function postCompletion(port: number, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  return fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, text: await res.text() }));
}

const TWO_STEP: ScriptedScenario = {
  id: "F5-fixture",
  description: "cenário curto para os testes induzidos do fixture",
  ...script([
    { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "a.txt", content: "a" } } },
    { expect: { toolsSubset: ["read"] }, reply: { kind: "text", text: "done" } },
  ]),
};

describe("adversarial — o fixture falha em desvios (F5/D7)", () => {
  test("(a) modelo desconhecido → falha listando o esperado", async () => {
    await withServer(TWO_STEP, async (server) => {
      const res = await postCompletion(server.port, {
        model: "evil-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      });
      expect(res.status).toBe(500);
      expect(res.text).toContain("modelo inesperado");
      expect(res.text).toContain("esperado=eval-model");
      expect(res.text).toContain("recebido=evil-model");
      expect(server.diagnosis.length).toBe(1);
    });
  });

  test("(b) tools ausentes no passo 2 → falha 'tool esperada ausente'", async () => {
    await withServer(TWO_STEP, async (server) => {
      // call 1 válida (write presente) — consome o passo 1.
      const ok = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "write" } }],
      });
      expect(ok.status).toBe(200);
      // call 2: falta "read" → falha.
      const res = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "bash" } }],
      });
      expect(res.status).toBe(500);
      expect(res.text).toContain("tool esperada ausente");
      expect(res.text).toContain("read");
    });
  });

  test("(c) evidência fora de ordem → falha apontando o marcador ausente", async () => {
    const scenario: ScriptedScenario = {
      id: "F5-evidence",
      description: "passo 2 exige marcador na conversa",
      ...script([
        { expect: { toolsSubset: ["write"] }, reply: { kind: "tool", name: "write", args: { path: "a.txt", content: "a" } } },
        {
          expect: { toolsSubset: ["read"], conversationContains: ["hello harness"] },
          reply: { kind: "text", text: "done" },
        },
      ]),
    };
    await withServer(scenario, async (server) => {
      await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "write" } }],
      });
      // Conversa SEM o marcador "hello harness" → falha.
      const res = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "sem o marcador" }],
        tools: [{ type: "function", function: { name: "read" } }],
      });
      expect(res.status).toBe(500);
      expect(res.text).toContain("evidência fora de ordem");
      expect(res.text).toContain("hello harness");
    });
  });

  test("(d) call além do script → falha 'nenhuma call esperada restante'", async () => {
    await withServer(TWO_STEP, async (server) => {
      for (const tools of [
        [{ type: "function", function: { name: "write" } }],
        [{ type: "function", function: { name: "read" } }],
      ]) {
        await postCompletion(server.port, {
          model: "eval-model",
          messages: [{ role: "user", content: "hi" }],
          tools,
        });
      }
      const res = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "extra" }],
        tools: [{ type: "function", function: { name: "read" } }],
      });
      expect(res.status).toBe(500);
      expect(res.text).toContain("nenhuma call esperada restante");
      expect(res.text).toContain("1:write, 2:text");
    });
  });

  test("(e) auditor com tool de extensão vazada → falha de isolamento (F4)", async () => {
    const scenario: ScriptedScenario = {
      id: "F5-auditor-leak",
      description: "request de auditor com subagent vazado",
      ...script([{ expect: { auditor: true }, reply: { kind: "text", text: "ok" } }]),
    };
    await withServer(scenario, async (server) => {
      const res = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "audit" }],
        tools: [
          { type: "function", function: { name: "read" } },
          { type: "function", function: { name: "subagent" } },
        ],
      });
      expect(res.status).toBe(500);
      expect(res.text).toContain("tools extra/ausentes");
      expect(res.text).toContain("isolamento F7 COEX-06 violado");
    });
  });

  test("rota fora de /v1/chat/completions → 404", async () => {
    await withServer(TWO_STEP, async (server) => {
      const res = await postCompletion(server.port, {
        model: "eval-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "write" } }],
      });
      expect(res.status).toBe(200); // rota certa continua
      const res404 = await fetch(`http://127.0.0.1:${server.port}/v1/models`);
      expect(res404.status).toBe(404);
    });
  });
});
