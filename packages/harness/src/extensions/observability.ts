// src/extensions/observability.ts — wiring Pi do F28 (D1/D4/D6/D7, OBS-03/04/05/08/09).
//
// Registra a camada de observabilidade como extensão Pi. Cada handler é THIN —
// a decisão vive nos módulos puros de src/observability/:
//
//   session_start          → freeze config (D9) + bundle fingerprint (D3) +
//                            session:started (header QA-1) + bridge token-
//                            budget (D4, read-only) + adendo trilha planning
//   before_agent_start     → adendo (planning/execution) anexado ao
//                            systemPrompt ENCADEADO (marker — D6; chaining
//                            verificado runner.js emitBeforeAgentStart)
//   tool_call              → tool:call (argsHash) + context:usage (getContextUsage)
//   tool_execution_end     → tool:result + observação de bloqueio F24/F25
//                            (reason `<guardId>: msg` — formato F24 D3 →
//                            guard:blocked; VALIDADO no Execute: o resultado
//                            do tool_call NÃO expõe o block (runner.js
//                            short-circuit), mas o tool_execution_end carrega
//                            o reason no result.content — observação REAL)
//   session_end            → session:ended (agregados) + sweep de vereditos
//                            F25/resilience F27 (lessons — OBS-06/07)
//   tool_result            → tokens:usage quando o tool reporta usage (SDK)
//
// Kill switch RUNECRAFT_OBSERVABILITY=0 → todos os handlers inertes (zero
// arquivos — F20). Config inválida → fail-closed por módulo (F24 D10).
// Escrita do store best-effort (nunca quebra a sessão — D1). Nada de
// console.log: guardLog (stderr — regra do guild).
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolExecutionEndEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { collectBundleInput, computeBundleHash, readGitHead, sdkPackageVersion, harnessPackageVersion } from "../observability/bundle.ts";
import { SessionObservabilityConfig, eventsFileFor, lessonsFile, promotedFile } from "../observability/config.ts";
import { checkContextWindow, parseTokenBudgetRun, type TokenBudgetRun } from "../observability/context-monitor.ts";
import { TokenState } from "../observability/token-state.ts";
import { SessionRecorder } from "../observability/session-recorder.ts";
import { appendEvent } from "../observability/store.ts";
import type { EventKind, EventPayload } from "../observability/types.ts";
import {
  applyCapture,
  buildLessonAdendo,
  buildLessonAdendoWithIds,
  adendoTextHash,
  readLessonsFile,
  readPromotedFile,
  triggerSignatureOf,
  writeLessonsFile,
  writePromotedFile,
  type CaptureLessonInput,
} from "../observability/lessons.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { propagateForkAgentIdentity } from "../agents/identity.ts";
import { guardLog } from "../guards/guardKit.ts";
import { GUARD_REASON_IDS, type GuardId } from "../guards/guardKit.ts";
import { VERIFY_REASON_ID } from "../verify/verdict.ts";
import { canonicalJson, sha256Hex } from "../observability/bundle.ts";

/** Logger dedicado (regra do guild: sem console.log; stderr, não stdout). */
const log = {
  debug(message: string): void {
    if (process.env.RUNECRAFT_OBSERVABILITY_DEBUG === "1" || process.env.RUNECRAFT_OBSERVABILITY_DEBUG === "true") {
      process.stderr.write(`[runecraft:obs] ${message}\n`);
    }
  },
  warn(message: string): void {
    process.stderr.write(`[runecraft:obs] warn: ${message}\n`);
  },
};

export interface ObservabilityDeps {
  /** env override (testes) — default process.env. */
  env?: NodeJS.ProcessEnv;
  /** relógio injetável (epoch ms — determinismo D4). */
  now?: () => number;
  /** ISO clock para `at` (default: ISO do now). */
  isoNow?: () => string;
  /** identity de sessão injetável — default ctx.sessionManager.getSessionId(). */
  sessionId?: (ctx: ExtensionContext) => string | null;
  /** identidade do agente — default RUNECRAFT_AGENT_ID ?? "pi". */
  getAgentId?: () => string | undefined;
  /** override do diretório de eventos (testes). */
  eventsDirOverride?: (cwd: string) => string;
  /** override dos arquivos de lessons (testes). */
  lessonsFileOverride?: (cwd: string) => string;
  promotedFileOverride?: (cwd: string) => string;
  /** override do diretório token-budget (testes) — default <cwd>/.pi/taskflows/runs/token-budget. */
  tokenBudgetDirOverride?: (cwd: string) => string;
  /** override do coletor de bundle (testes — determinismo). */
  collectBundle?: (cwd: string, env: NodeJS.ProcessEnv, agentId: string) => ReturnType<typeof collectBundleInput>;
  /** override do gitHead (testes). */
  gitHead?: (cwd: string, env: NodeJS.ProcessEnv) => string | null;
}

/** guardId do prefixo do reason (F24 D3 — `<guardId>: msg`). Invertido do
 *  GUARD_REASON_IDS; `verification-cascade` (F25) é gate de verificação. */
const REASON_PREFIX_TO_GATE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(GUARD_REASON_IDS).map(([id, reason]) => [reason, id])),
  [VERIFY_REASON_ID]: "verification",
};

/** Parse do bloqueio a partir do texto do tool_execution_end (agent-loop.js
 *  createErrorToolResult(reason) → content[0].text). Retorna {gate, reason}. */
export function detectBlockFromText(text: string): { gate: string; reason: string } | null {
  const trimmed = text.trim();
  for (const [prefix, gate] of Object.entries(REASON_PREFIX_TO_GATE)) {
    if (trimmed.startsWith(`${prefix}: `)) {
      return { gate, reason: trimmed };
    }
  }
  return null;
}

/** Texto de um result de tool (TextContent[] ou string). */
export function toolResultText(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result ?? "");
  const r = result as { content?: unknown };
  if (typeof r.content === "string") return r.content;
  if (Array.isArray(r.content)) {
    return r.content
      .map((c) => {
        if (c !== null && typeof c === "object" && (c as { type?: unknown }).type === "text") {
          const t = (c as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/** argsHash de tool (sha256 normalizado — chaves ordenadas F23; NUNCA args crus). */
export function toolArgsHash(args: unknown): string {
  return sha256Hex(canonicalJson(args ?? {})).slice(0, 16);
}

export interface PendingAdendo {
  track: "planning" | "execution";
  /** gate que disparou o adendo execution (ausente na trilha planning). */
  gate?: string;
  text: string;
  /** ids das lessons selecionadas (fix cleric F28 #4 — nunca re-derivar por texto). */
  lessonIds: string[];
}

/** Estado da sessão ativa do processo de extensão. */
interface SessionState {
  sessionId: string;
  recorder: SessionRecorder;
  tokenState: TokenState;
  pendingAdendo: PendingAdendo | null;
  /** vereditos F25 já capturados como lesson (dedupe por triggerSignature). */
  capturedVerdictSignatures: Set<string>;
  /** sinais F27 já capturados como lesson. */
  capturedSignalSignatures: Set<string>;
  /** contador de eventos gravados (seq do store é do arquivo; aqui só diagnóstico). */
  eventCount: number;
}

/**
 * Registra a camada de observabilidade no Pi. Carregado apenas em sessões
 * gerenciadas pelo harness (extensões da manifest do package).
 */
export function installObservability(pi: ExtensionAPI, deps: ObservabilityDeps = {}): void {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const isoNow = deps.isoNow ?? (() => new Date(now()).toISOString());
  const sessionConfig = new SessionObservabilityConfig(env);

  let session: SessionState | null = null;

  const sessionIdOf = (ctx: ExtensionContext): string | null => {
    if (deps.sessionId) return deps.sessionId(ctx);
    try {
      return ctx.sessionManager.getSessionId() ?? null;
    } catch {
      return null;
    }
  };

  const agentIdOf = (): string => deps.getAgentId?.() ?? process.env.RUNECRAFT_AGENT_ID ?? "pi";

  const eventsFile = (cwd: string, sessionId: string): string =>
    deps.eventsDirOverride ? path.join(deps.eventsDirOverride(cwd), `${sessionId}.jsonl`) : eventsFileFor(cwd, sessionId);

  const lessonsFileAt = (cwd: string): string => (deps.lessonsFileOverride ? deps.lessonsFileOverride(cwd) : lessonsFile(cwd));
  const promotedFileAt = (cwd: string): string => (deps.promotedFileOverride ? deps.promotedFileOverride(cwd) : promotedFile(cwd));

  const tokenBudgetDirAt = (cwd: string): string =>
    deps.tokenBudgetDirOverride ? deps.tokenBudgetDirOverride(cwd) : path.join(cwd, ".pi", "taskflows", "runs", "token-budget");

  const append = (ctx: ExtensionContext, sessionId: string, kind: EventKind, payload: Record<string, unknown>): void => {
    if (session === null) return;
    const result = appendEvent(ctx.cwd, sessionId, kind, payload as unknown as EventPayload, {
      env,
      bundle: session.recorder.bundleShort,
      now: isoNow,
      file: eventsFile(ctx.cwd, sessionId),
    });
    if (result.ok) session.eventCount += 1;
    void result;
  };

  /** Garante o .gitignore fino da sessão (T9 — best-effort, nunca quebra). */
  const ensureGitignore = (cwd: string): void => {
    try {
      const file = path.join(cwd, ".gitignore");
      const existed = fs.existsSync(file);
      const current = existed ? fs.readFileSync(file, "utf8") : "";
      const lines = current.split(/\r?\n/);
      const added = [".runecraft/events/", ".runecraft/lessons.jsonl"].filter((line) => !lines.includes(line));
      if (added.length === 0) return;
      const eol = current.includes("\r\n") ? "\r\n" : "\n";
      const body = current.replace(/\s+$/, "");
      const content = body === "" ? `${added.join(eol)}${eol}` : `${body}${eol}${eol}${added.join(eol)}${eol}`;
      fs.mkdirSync(cwd, { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    } catch {
      // best-effort — .gitignore nunca quebra a sessão
    }
  };

  /** Leitura READ-ONLY do token-budget do taskflow (D4 — NUNCA escreve em .pi/). */
  const readTokenBudget = (cwd: string): TokenBudgetRun[] => {
    const dir = tokenBudgetDirAt(cwd);
    if (!fs.existsSync(dir)) return [];
    const runs: TokenBudgetRun[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("token-budget-") && f.endsWith(".json") && !f.endsWith(".trace.jsonl")).sort()) {
      try {
        const parsed = parseTokenBudgetRun(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
        if (parsed !== null) runs.push(parsed);
      } catch {
        // fail-soft — arquivo malformado pulado
      }
    }
    return runs;
  };

  /** Bridge context:usage + tokens:usage do token-budget (D4 — source:"bridge"). */
  const bridgeTokenBudget = (ctx: ExtensionContext, cwd: string, sessionId: string): void => {
    const cfg = sessionConfig.frozen(cwd).config;
    for (const run of readTokenBudget(cwd)) {
      const decision = checkContextWindow(
        { usedTokens: run.usage.contextTokens, maxTokens: run.maxTokens ?? 0 },
        cfg.contextWindow,
      );
      append(ctx, sessionId, "context:usage", {
        usedTokens: run.usage.contextTokens,
        maxTokens: run.maxTokens ?? 0,
        usagePct: decision.usagePct,
        action: decision.action,
        source: "bridge",
      });
      append(ctx, sessionId, "tokens:usage", {
        input: run.usage.input,
        output: run.usage.output,
        cacheRead: run.usage.cacheRead,
        cacheWrite: run.usage.cacheWrite,
        totalMessages: 0,
        source: "bridge",
      });
    }
  };

  /** Captura de lesson em gate failure (OBS-06) + adendo execution (D6). */
  const captureGateLesson = (ctx: ExtensionContext, cwd: string, input: CaptureLessonInput): void => {
    if (session === null) return;
    const cfg = sessionConfig.frozen(cwd).config;
    const file = lessonsFileAt(cwd);
    const records = readLessonsFile(file);
    const result = applyCapture(records, input, session.eventCount, cfg.lessons);
    writeLessonsFile(file, result.records);
    // Fix cleric F28 #2: reincidência de lesson JÁ promovida também reescreve o
    // promoted.jsonl (senão o contador versionado divergia do lessons.jsonl).
    if (result.promoted !== null || result.record.status === "promoted") writePromotedFile(promotedFileAt(cwd), result.records);
    for (const event of result.events) {
      append(ctx, session.sessionId, event.kind, event.payload);
    }
    // Adendo execution (D6 — F4): lições do gate que falhou no turno seguinte.
    // Multi-gate no mesmo turno: acumula (dedupe por lessonId, corta no max).
    const adendo = buildLessonAdendoWithIds(result.records, { gate: input.gate, track: "execution", max: cfg.lessons.maxAdendoLessons });
    if (adendo !== null) {
      const existing = session.pendingAdendo;
      if (existing !== null && existing.track === "execution") {
        const merged = [...existing.lessonIds, ...adendo.lessonIds].filter((id, i, all) => all.indexOf(id) === i).slice(0, cfg.lessons.maxAdendoLessons);
        session.pendingAdendo = { track: "execution", gate: input.gate, text: `${existing.text}\n${adendo.text}`, lessonIds: merged };
      } else {
        session.pendingAdendo = { track: "execution", gate: input.gate, text: adendo.text, lessonIds: adendo.lessonIds };
      }
    }
    log.debug(`lesson captured: ${input.gate} (${result.outcome}, count=${result.record.count})`);
  };

  // ---------------------------------------------------------------
  // session_start — freeze + bundle + header + planning adendo (F1/F4)
  // ---------------------------------------------------------------
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
    sessionConfig.capture(ctx.cwd);
    const frozen = sessionConfig.frozen(ctx.cwd);
    for (const problem of frozen.problems) log.warn(`config: ${problem}`);
    if (frozen.killSwitch || !frozen.config.enabled) return;

    const sessionId = sessionIdOf(ctx);
    if (sessionId === null) return; // sem identidade — nunca inventar (edge spec)

    const agentId = agentIdOf();
    const collect = deps.collectBundle ?? collectBundleInput;
    const input = collect(ctx.cwd, env, agentId);
    const { full: bundleHash, short: bundleShort } = computeBundleHash(input);
    const gitHead = deps.gitHead ? deps.gitHead(ctx.cwd, env) : readGitHead(ctx.cwd, env);
    const model = (ctx.model as { id?: string } | undefined)?.id ?? null;

    ensureGitignore(ctx.cwd);

    const recorder = new SessionRecorder({
      sessionId,
      bundleShort,
      agentId,
      model,
      bundleHash,
      versions: { harness: harnessPackageVersion(), sdk: sdkPackageVersion(), forks: { ...HARNESS_VERSIONS } },
      gitHead,
      sink: {
        append: (kind, payload) => {
          append(ctx, sessionId, kind, payload);
        },
      },
      now,
    });

    session = {
      sessionId,
      recorder,
      tokenState: new TokenState(),
      pendingAdendo: null,
      capturedVerdictSignatures: new Set(),
      capturedSignalSignatures: new Set(),
      eventCount: 0,
    };
    recorder.startSession();

    // Bridge token-budget (D4 — fonte verificada; source:"bridge").
    bridgeTokenBudget(ctx, ctx.cwd, sessionId);

    // Adendo trilha planning (D6/F4): lições promovidas injetadas no início.
    const promoted = readPromotedFile(promotedFileAt(ctx.cwd));
    if (promoted.length > 0) {
      const adendo = buildLessonAdendoWithIds(promoted, { track: "planning", max: frozen.config.lessons.maxAdendoLessons });
      if (adendo !== null) {
        session.pendingAdendo = { track: "planning", text: adendo.text, lessonIds: adendo.lessonIds };
      }
    }

    log.debug(`session started: ${sessionId} (bundle ${bundleShort})`);
  });

  // ---------------------------------------------------------------
  // before_agent_start — adendo encadeado (D6 — marker; NÃO sobrescreve)
  // ---------------------------------------------------------------
  // F32 (D7 — ponte de identidade, adendo do F28): o fork subagents NÃO seta
  // RUNECRAFT_AGENT_ID no child (seta PI_SUBAGENT_CHILD_AGENT — pi-args.ts);
  // a bridge propaga a identidade do child para o env que o harness lê
  // (guard ranger-md-only currentAgentId; observability agentIdOf). Registrada
  // ANTES do adendo e NÃO gated pelo kill switch (a identidade serve aos
  // guards, não à observabilidade). Só atua em env de child do fork.
  pi.on("before_agent_start", () => {
    propagateForkAgentIdentity(process.env);
    return undefined;
  });

  pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: ExtensionContext): { systemPrompt?: string } | undefined => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return undefined;
    if (session === null || session.pendingAdendo === null) return undefined;

    const adendo = session.pendingAdendo;
    session.pendingAdendo = null;
    append(ctx, session.sessionId, "adendo:injected", {
      track: adendo.track,
      ...(adendo.gate !== undefined ? { gate: adendo.gate } : {}),
      lessonIds: adendo.lessonIds,
      textHash: adendoTextHash(adendo.text),
    });
    log.debug(`adendo injected (${adendo.track})`);
    // ENCADEADO (não sobrescreve outras extensões — runner.js re-passou
    // currentSystemPrompt por extensão): anexa ao systemPrompt corrente.
    return { systemPrompt: `${event.systemPrompt}\n\n${adendo.text}` };
  });

  // ---------------------------------------------------------------
  // tool_call — tool:call (argsHash) + context:usage (getContextUsage)
  // ---------------------------------------------------------------
  pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return undefined;
    if (session === null) return undefined;

    session.recorder.trackToolCall(event.toolName, toolArgsHash(event.input ?? {}));

    // Delegação (fix cleric F28 #1 — OBS-03): a tool `subagent` do F2 é a
    // delegação do harness (equivalente de task/call_guild_agent do guild).
    if (event.toolName === "subagent") {
      const input = (event.input ?? {}) as Record<string, unknown>;
      const agent =
        typeof input.agent === "string"
          ? input.agent
          : typeof input.type === "string"
            ? input.type
            : "subagent";
      session.recorder.trackDelegation({
        agent,
        toolCallId: "", // o CustomToolCallEvent do SDK não expõe id (fix cleric F28)
        durationMs: 0,
      });
    }

    // Fonte de contexto/tokens REAL do SDK (QA-5 — API tipada validada).
    try {
      const usage = ctx.getContextUsage();
      if (usage !== undefined && usage.tokens !== null && usage.contextWindow > 0) {
        session.tokenState.setContextLimit(usage.contextWindow);
        session.tokenState.updateUsage(usage.tokens);
        const decision = checkContextWindow(
          { usedTokens: usage.tokens, maxTokens: usage.contextWindow },
          frozen.config.contextWindow,
        );
        append(ctx, session.sessionId, "context:usage", {
          usedTokens: usage.tokens,
          maxTokens: usage.contextWindow,
          usagePct: decision.usagePct,
          action: decision.action,
          source: "sdk",
        });
      }
    } catch {
      // ctx.getContextUsage indisponível — sem invenção, segue a sessão
    }
    return undefined;
  });

  // ---------------------------------------------------------------
  // tool_execution_end — tool:result + observação de bloqueio (D7a)
  // ---------------------------------------------------------------
  pi.on("tool_execution_end", (event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    if (session === null) return;

    const text = toolResultText(event.result);
    const block = event.isError ? detectBlockFromText(text) : null;
    session.recorder.trackToolResult({
      tool: event.toolName,
      ok: !event.isError,
      ...(block !== null ? { blocked: true, guardId: block.gate } : {}),
      ...(block !== null ? { reason: block.reason } : {}),
      // durationMs omitido: o tool_execution_end do SDK não carrega duração
      // (fix cleric F28 #3 — sem métrica inventada).
    });
    if (block !== null) {
      append(ctx, session.sessionId, "guard:blocked", {
        guardId: block.gate,
        tool: event.toolName,
        reason: block.reason,
      });
      log.warn(`guard:blocked — ${block.gate} (${event.toolName})`);
      // Lesson (OBS-06): gate failure → captura com as 4 partes.
      captureGateLesson(ctx, ctx.cwd, {
        trigger: `${event.toolName} blocked by ${block.gate}`,
        antiPattern: `continue calling ${event.toolName} the same way after ${block.gate} blocked it`,
        preferred: `fix the condition flagged by ${block.gate} before retrying ${event.toolName}`,
        priority: block.gate === "verification" ? "high" : "med",
        gate: block.gate,
        track: "execution",
      });
    }
  });

  // ---------------------------------------------------------------
  // tool_result — tokens:usage quando o tool reporta usage (SDK)
  // ---------------------------------------------------------------
  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    if (session === null) return;
    const usage = (event as unknown as { usage?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } }).usage;
    if (usage === undefined || typeof usage.input !== "number") return;
    session.recorder.trackTokenUsage({
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      ...(typeof usage.reasoning === "number" ? { reasoning: usage.reasoning } : {}),
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
    });
  });

  // ---------------------------------------------------------------
  // agent_end / session_shutdown — session:ended (agregados + sweep de
  // vereditos F25 / sinais F27 → lessons — OBS-06/07). O SDK 0.81.0 não tem
  // `session_end`: o loop termina com agent_end; o teardown com
  // session_shutdown (reload/new/resume/fork). Ambos disparam endSession
  // (idempotente — o primeiro fecha a sessão).
  // ---------------------------------------------------------------
  const endSession = (ctx: ExtensionContext): void => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch || !frozen.config.enabled) return;
    if (session === null) return;

    // Sweep de vereditos F25 (verify-verdicts.jsonl — dono F25; F28 lê):
    // vereditos fail/halt → lesson com gate = layer (OBS-06).
    try {
      const verdictFile = path.join(ctx.cwd, ".runecraft", "verify-verdicts.jsonl");
      if (fs.existsSync(verdictFile)) {
        for (const raw of fs.readFileSync(verdictFile, "utf8").split(/\r?\n/)) {
          const line = raw.trim();
          if (line === "") continue;
          let parsed: { status?: string; layer?: string; reason?: string | null; verifyId?: string };
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.status !== "fail" && parsed.status !== "halt") continue;
          const layer = typeof parsed.layer === "string" ? parsed.layer : "verification";
          const signature = triggerSignatureOf(`verification ${parsed.status} on ${layer}`, layer);
          if (session.capturedVerdictSignatures.has(signature)) continue;
          session.capturedVerdictSignatures.add(signature);
          captureGateLesson(ctx, ctx.cwd, {
            trigger: `verification ${parsed.status} on ${layer}`,
            antiPattern: `complete the goal without satisfying the ${layer} verification layer`,
            preferred: `address the ${layer} verification reason before completing: ${parsed.reason ?? ""}`,
            priority: parsed.status === "halt" ? "high" : "med",
            gate: layer,
            track: "execution",
          });
        }
      }
    } catch {
      // best-effort
    }

    // Sweep de sinais F27 (resilience-events.jsonl — dono F27; F28 lê):
    // stall:*/fallback/continuation → lesson (OBS-06).
    try {
      const eventsFile27 = path.join(ctx.cwd, ".runecraft", "resilience-events.jsonl");
      if (fs.existsSync(eventsFile27)) {
        for (const raw of fs.readFileSync(eventsFile27, "utf8").split(/\r?\n/)) {
          const line = raw.trim();
          if (line === "") continue;
          let parsed: { type?: string };
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          const type = parsed.type ?? "";
          if (!type.startsWith("stall:") && type !== "fallback" && type !== "continuation_injected") continue;
          const signal = type;
          const signature = triggerSignatureOf(`stall signal ${signal}`, signal);
          if (session.capturedSignalSignatures.has(signature)) continue;
          session.capturedSignalSignatures.add(signature);
          captureGateLesson(ctx, ctx.cwd, {
            trigger: `stall signal ${signal}`,
            antiPattern: `let the session stall without action (${signal})`,
            preferred: `recover via the resilience fallback (${signal}) before continuing`,
            priority: "med",
            gate: signal,
            track: "execution",
          });
        }
      }
    } catch {
      // best-effort
    }

    session.recorder.endSession();
    log.debug(`session ended: ${session.sessionId}`);
  };

  pi.on("agent_end", (_event: AgentEndEvent, ctx: ExtensionContext) => {
    endSession(ctx);
  });

  pi.on("session_shutdown", (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
    endSession(ctx);
  });
}

/** Factory da extensão (convenção do SDK — default export; mesmo padrão do
 *  extensions/guards.ts e extensions/resilience.ts do F24/F27). */
export default function registerObservability(pi: ExtensionAPI): void {
  installObservability(pi);
}
