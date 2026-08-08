// eval/layer2/fixture/chatServer.ts — servidor OpenAI-wire (D5).
//
// node:http, zero deps, loopback, porta efêmera (port 0). Única rota:
// POST /v1/chat/completions (resto → 404). Resposta SEMPRE SSE: o provider
// openai-completions do pi envia `stream: true` incondicionalmente
// (buildParams do pi-ai — validado no Execute F21 #3), então resposta
// não-streaming é recusada pelo SDK do openai.
//
// Determinismo: created: 0, id fixo, usage contador por step, sem Date.
// Adversarial (D7): cada request é validado contra o ScriptedScenario —
// modelo desconhecido, tools fora do esperado, evidência fora de ordem e
// call além do script falham com diagnóstico (call esperada vs recebida).
import * as http from "node:http";
import type { ScriptedScenario, ScriptedStep } from "./scenarios.ts";

export interface SeenRequest {
  n: number;
  model: string;
  tools: string[];
  /** texto completo da conversa (truncado) — para validação de evidência (D7c). */
  conversationText: string;
  /** mensagem do usuário mais recente (truncada) — para diagnóstico. */
  lastUserText: string;
}

const AUDITOR_BUILTINS = ["read", "grep", "find", "ls", "bash"];

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** Valida um request contra o passo esperado do script; devolve erro ou null. */
export function validateStep(step: ScriptedStep, req: SeenRequest, expectedModel: string): string | null {
  // D7a: modelo conhecido é invariante do FIXTURE (todo request), não só do passo.
  if (req.model !== expectedModel) {
    return `call ${req.n}: modelo inesperado — esperado=${expectedModel} recebido=${req.model}`;
  }
  if (step.expect?.auditor === true) {
    if (!setEquals(req.tools, AUDITOR_BUILTINS)) {
      return (
        `call ${req.n} (auditor): tools extra/ausentes — esperadas=[${AUDITOR_BUILTINS.join(" ")}] ` +
        `recebidas=[${req.tools.join(" ")}] (isolamento F7 COEX-06 violado)`
      );
    }
  } else if (step.expect?.tools !== undefined) {
    if (!setEquals(req.tools, step.expect.tools)) {
      return `call ${req.n}: tools divergem — esperadas=[${step.expect.tools.join(" ")}] recebidas=[${req.tools.join(" ")}]`;
    }
  } else if (step.expect?.toolsSubset !== undefined) {
    for (const tool of step.expect.toolsSubset) {
      if (!req.tools.includes(tool)) {
        return `call ${req.n}: tool esperada ausente no request — esperava conter [${step.expect.toolsSubset.join(" ")}] recebidas=[${req.tools.join(" ")}]`;
      }
    }
  }
  if (step.expect?.conversationContains !== undefined) {
    // A evidência é validada na CONVERSA (mensagens do request): um passo que
    // depende de um marcador (ex.: o contrato já implementado) falha quando o
    // marcador não aparece na história — D7c (evidência fora de ordem).
    for (const marker of step.expect.conversationContains) {
      if (!req.conversationText.includes(marker)) {
        return `call ${req.n}: evidência fora de ordem — marcador ausente na conversa: "${marker}" (última msg do usuário: "${req.lastUserText.slice(0, 80)}")`;
      }
    }
  }
  return null;
}

export class ChatServer {
  private server: http.Server;
  port = 0;
  readonly seen: SeenRequest[] = [];
  /** Diagnósticos adversarial acumulados (vazio = fixture não falhou). */
  readonly diagnosis: string[] = [];
  private scenario: ScriptedScenario;
  private expectedModel: string;
  private callCount = 0;

  constructor(scenario: ScriptedScenario, expectedModel = "eval-model") {
    this.scenario = scenario;
    this.expectedModel = expectedModel;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  /** Sobe o servidor em 127.0.0.1 com porta efêmera (D5 — paralelismo). */
  async listen(): Promise<number> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("fixture: falha ao obter a porta efêmera");
    }
    this.port = address.port;
    return this.port;
  }

  close(): void {
    this.server.close();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `fixture: rota desconhecida ${req.method} ${req.url}` } }));
      return;
    }
    const body = await readBody(req);
    let parsed: {
      model?: unknown;
      tools?: Array<{ function?: { name?: unknown } }>;
      messages?: Array<{ role?: unknown; content?: unknown }>;
      stream?: unknown;
    };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture: body não é JSON" } }));
      return;
    }
    this.callCount += 1;
    const conversationText = conversationTextOf(parsed.messages);
    const seen: SeenRequest = {
      n: this.callCount,
      model: typeof parsed.model === "string" ? parsed.model : "?",
      tools: Array.isArray(parsed.tools)
        ? parsed.tools.map((t) => (typeof t?.function?.name === "string" ? t.function.name : "?")).filter((n) => n !== "?")
        : [],
      conversationText,
      lastUserText: lastUserText(parsed.messages),
    };
    this.seen.push(seen);

    const step = this.scenario.stepFor(this.callCount);
    if (!step) {
      this.fail(res, `call ${seen.n}: nenhuma call esperada restante (script consumido; esperadas: ${this.scenario.summary()})`);
      return;
    }
    const validationError = validateStep(step, seen, this.expectedModel);
    if (validationError) {
      this.fail(res, validationError);
      return;
    }

    // Resposta SSE com a tool call / texto scriptada (D5/D6).
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    if (step.reply.kind === "tool") {
      const argsJson = JSON.stringify(step.reply.args);
      sendChunk(res, toolCallDelta(step.reply.name, "", this.callCount));
      sendChunk(res, toolCallDelta(step.reply.name, argsJson, this.callCount));
      sendChunk(res, finishChunk("tool_calls"));
    } else {
      sendChunk(res, textDelta(step.reply.text));
      sendChunk(res, finishChunk("stop"));
    }
    sendChunk(res, usageChunk(seen.n));
    res.write("data: [DONE]\n\n");
    res.end();
  }

  private fail(res: http.ServerResponse, diagnosis: string): void {
    this.diagnosis.push(diagnosis);
    // 500 com o diagnóstico: o cliente pi reporta o erro e o teste falha
    // com a mensagem do fixture (o agente não fabrica resposta).
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `fixture adversarial: ${diagnosis}` } }));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

// O limite da janela de conversa é um guard de memória do fixture; F25 (cascata
// de verificação) exige o reason do block (complete_goal) visível NA conversa
// do passo seguinte (D7c — evidência na ordem) — o system prompt com skills
// domina a janela em máquinas com muitos skills, então 100k cobre o fluxo
// completo (sessão curta da camada 2) sem comprometer o determinismo.
function conversationTextOf(messages: Array<{ role?: unknown; content?: unknown }> | undefined): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content as Array<{ type?: string; text?: unknown }>) {
        if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n").slice(0, 100_000);
}

function lastUserText(messages: Array<{ role?: unknown; content?: unknown }> | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "user" && typeof msg.content === "string") return msg.content.slice(0, 200);
    if (msg?.role === "user" && Array.isArray(msg.content)) {
      const text = (msg.content as Array<{ type?: string; text?: unknown }>)
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join(" ")
        .slice(0, 200);
      if (text) return text;
    }
  }
  return "";
}

function sendChunk(res: http.ServerResponse, chunk: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function baseChunk(choice: Record<string, unknown>, withUsage = false): Record<string, unknown> {
  return {
    id: "chatcmpl-eval",
    object: "chat.completion.chunk",
    created: 0,
    model: "eval-model",
    choices: [choice],
    ...(withUsage
      ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
      : {}),
  };
}

function toolCallDelta(name: string, argsJson: string, callN: number): Record<string, unknown> {
  return baseChunk({
    index: 0,
    delta: {
      tool_calls: [
        {
          index: 0,
          id: `call_${callN}`,
          type: "function",
          function: { name, arguments: argsJson },
        },
      ],
    },
    finish_reason: null,
  });
}

function textDelta(text: string): Record<string, unknown> {
  return baseChunk({ index: 0, delta: { role: "assistant", content: text }, finish_reason: null });
}

function finishChunk(reason: string): Record<string, unknown> {
  return baseChunk({ index: 0, delta: {}, finish_reason: reason });
}

function usageChunk(callN: number): Record<string, unknown> {
  return {
    id: "chatcmpl-eval",
    object: "chat.completion.chunk",
    created: 0,
    model: "eval-model",
    choices: [],
    usage: { prompt_tokens: 10 + callN, completion_tokens: 5, total_tokens: 15 + callN },
  };
}
