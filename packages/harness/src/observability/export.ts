// observability/export.ts — export jsonl determinístico + bridges (D7/D8, OBS-09/10).
//
// `harness events export --format jsonl [--session <id>] [--include-external]`:
// merge determinístico — eventos do store ordenados por (sessionId
// lexicográfico, seq asc) + bridges externos com `source:"bridge"` (D7):
//   - verify-verdicts.jsonl (F25 — dono) → `verification:verdict`;
//   - ledger glla `.pi-glla/active.jsonl` (F24/F27 — dono) + `.runecraft/
//     continuation.json` + `.runecraft/resilience-events.jsonl` (F27 — dono)
//     → `resilience:signal` (sinais pending_latch_stuck/wedge_alert/
//     heartbeat_refire + stall:*/fallback/continuation).
// Cada sink continua DONO (F28 lê/observa, nunca reescreve). Verificação do
// prevHash (D1) → violações no stderr (exit 0 com aviso). Linhas malformadas
// puladas (fail-soft — padrão ledger glla v0.28.6). Zero deps.
//
// Atribuição de sessão dos bridges (documentado em docs/EVENTS.md):
//   - `--session <id>`: bridges anexam à sessão <id> SOMENTE se a sessão tem
//     eventos no store (seq virtual = último seq do store + 1 + i);
//   - sem `--session`: bridges anexam à sessão sintética `__bridge__`
//     (seq virtual 1..n por fonte, ordem determinística) — os sinks externos
//     são do cwd, sem atribuição de sessão nos arquivos.
// 2 runs → byte-output IDÊNTICO (sem wall-clock na ordenação; `at` dos
// bridges é o do SINK, já gravado).
import * as fs from "node:fs";
import * as path from "node:path";
import { continuationMetaPath } from "../resilience/config.ts";
import { readEvents, verifyHashChain, type ReadEventsResult } from "./store.ts";
import { eventsDir, lessonsFile, promotedFile } from "./config.ts";
import type { EventRecord } from "./types.ts";

/** Sessão sintética dos bridges sem `--session` (documentado em EVENTS.md). */
export const BRIDGE_SESSION_ID = "__bridge__" as const;

export interface ExportOptions {
  cwd: string;
  /** filtro por sessão (--session). */
  session?: string;
  /** inclui bridges externos (--include-external). */
  includeExternal: boolean;
  /** diretório de eventos override (testes). */
  eventsDirOverride?: string;
  /** paths de sinks externos override (testes). */
  sinks?: BridgeSinkPaths;
}

export interface BridgeSinkPaths {
  verifyVerdicts?: string;
  ledger?: string;
  continuation?: string;
  resilienceEvents?: string;
}

export interface ExportResult {
  lines: string[];
  /** contagem de linhas malformadas puladas (fail-soft). */
  skipped: number;
  /** violações do prevHash chain (D1 — stderr, exit 0 com aviso). */
  hashViolations: string[];
}

export interface BridgeSourceRead {
  /** sessão alvo dos eventos bridge (D8 — ver atribuição acima). */
  sessionId: string;
  /** seq inicial dos eventos bridge (virtual). */
  startSeq: number;
  events: EventRecord[];
}

/** Default paths dos sinks (fronteiras D7 — cada sink continua dono). */
export function defaultSinkPaths(cwd: string): BridgeSinkPaths {
  return {
    verifyVerdicts: path.join(cwd, ".runecraft", "verify-verdicts.jsonl"),
    ledger: path.join(cwd, ".pi-glla", "active.jsonl"),
    continuation: continuationMetaPath(cwd),
    resilienceEvents: path.join(cwd, ".runecraft", "resilience-events.jsonl"),
  };
}

/** Lê linhas JSONL fail-soft de um arquivo (malformadas puladas e contadas). */
export function readJsonLines(file: string): { lines: Array<Record<string, unknown>>; skipped: number } {
  if (!fs.existsSync(file)) return { lines: [], skipped: 0 };
  const out: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1; // pula (fail-soft)
    }
  }
  return { lines: out, skipped };
}

/** Sessão alvo dos bridges (D8 — ver atribuição no header do módulo):
 *  `--session <id>` → a sessão pedida QUANDO existe no store (senão sem
 *  bridges — nada a anexar); sem `--session` → sessão sintética `__bridge__`. */
export function bridgeTargetSession(storeSessions: string[], requested: string | undefined): string | null {
  if (requested !== undefined) {
    return storeSessions.includes(requested) ? requested : null;
  }
  return BRIDGE_SESSION_ID;
}

/** seq virtual inicial dos bridges para a sessão alvo. */
export function virtualStartSeq(storeEvents: EventRecord[]): number {
  let last = -1;
  for (const event of storeEvents) {
    if (event.seq > last) last = event.seq;
  }
  return last + 1;
}

function bridgeEvent(sessionId: string, seq: number, kind: "verification:verdict" | "resilience:signal", payload: Record<string, unknown>, bundle: string): EventRecord {
  return {
    seq,
    kind,
    sessionId,
    bundle,
    prevHash: "",
    source: "bridge",
    payload: payload as unknown as EventRecord["payload"],
  };
}

/** Bridge verify-verdicts.jsonl (F25 — dono) → verification:verdict (D7b).
 *  Retorna {events, skipped} — fail-soft com contagem. */
export function bridgeVerifyVerdicts(file: string, sessionId: string, startSeq: number, bundle: string): { events: EventRecord[]; skipped: number } {
  const out: EventRecord[] = [];
  let seq = startSeq;
  let skipped = 0;
  const read = readJsonLines(file);
  skipped += read.skipped;
  for (const line of read.lines) {
    if (typeof line.verifyId !== "string") continue;
    out.push(
      bridgeEvent(sessionId, seq, "verification:verdict", {
        verifyId: line.verifyId,
        status: line.status ?? "unknown",
        layer: line.layer ?? null,
        reason: line.reason ?? null,
        suggestion: line.suggestion ?? null,
        cost: line.cost ?? null,
      }, bundle),
    );
    seq += 1;
  }
  return { events: out, skipped };
}

/** Sinais de stall do ledger glla (D7c — shapes verificados no fork goal.ts:
 *  appendLedger(cwd, "pending_latch_stuck"|"wedge_alert"|"heartbeat_refire", value)). */
export const LEDGER_SIGNAL_TYPES = ["pending_latch_stuck", "wedge_alert", "heartbeat_refire"] as const;

/** Bridge ledger glla (F24/F27 — dono) → resilience:signal (D7c). */
export function bridgeLedger(file: string, sessionId: string, startSeq: number, bundle: string): { events: EventRecord[]; skipped: number } {
  const out: EventRecord[] = [];
  let seq = startSeq;
  let skipped = 0;
  const read = readJsonLines(file);
  skipped += read.skipped;
  for (const line of read.lines) {
    const type = line.type;
    if (typeof type !== "string") continue;
    if (!(LEDGER_SIGNAL_TYPES as readonly string[]).includes(type)) continue;
    out.push(
      bridgeEvent(sessionId, seq, "resilience:signal", {
        signal: type,
        detail: (line.value ?? {}) as Record<string, unknown>,
      }, bundle),
    );
    seq += 1;
  }
  return { events: out, skipped };
}

/** Bridge continuation.json (F27 — dono) → resilience:signal (D7c). */
export function bridgeContinuation(file: string, sessionId: string, startSeq: number, bundle: string): { events: EventRecord[]; skipped: number } {
  if (!fs.existsSync(file)) return { events: [], skipped: 0 };
  let meta: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return { events: [], skipped: 0 };
    meta = parsed as Record<string, unknown>;
  } catch {
    return { events: [], skipped: 0 };
  }
  if (meta.schemaVersion !== 1) return { events: [], skipped: 0 };
  return {
    events: [
      bridgeEvent(sessionId, startSeq, "resilience:signal", {
        signal: "continuation",
        detail: {
          continuationCount: meta.continuationCount ?? 0,
          stallCount: meta.stallCount ?? 0,
          lastSessionId: meta.lastSessionId ?? null,
          compactedAt: meta.compactedAt ?? null,
        },
      }, bundle),
    ],
    skipped: 0,
  };
}

/** Bridge resilience-events.jsonl (F27 — dono) → resilience:signal (D7c). */
export function bridgeResilienceEvents(file: string, sessionId: string, startSeq: number, bundle: string): { events: EventRecord[]; skipped: number } {
  const out: EventRecord[] = [];
  let seq = startSeq;
  let skipped = 0;
  const read = readJsonLines(file);
  skipped += read.skipped;
  for (const line of read.lines) {
    const type = line.type;
    if (typeof type !== "string") continue;
    out.push(
      bridgeEvent(sessionId, seq, "resilience:signal", {
        signal: type,
        detail: (line.value ?? {}) as Record<string, unknown>,
      }, bundle),
    );
    seq += 1;
  }
  return { events: out, skipped };
}

/** Sessões com eventos no store (arquivos `<sessionId>.jsonl`), sorted. */
export function listStoreSessions(eventsDirPath: string): string[] {
  if (!fs.existsSync(eventsDirPath)) return [];
  return fs
    .readdirSync(eventsDirPath)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -".jsonl".length))
    .sort();
}

/** bundle (prefixo curto) de uma sessão: o do header session:started (seq 0);
 *  sem header → "000000000000" (sessão bridge — documento). */
export function sessionBundleOf(events: EventRecord[]): string {
  const header = events.find((e) => e.kind === "session:started");
  return header?.bundle ?? "000000000000";
}

/**
 * Export determinístico (D8): store (sessionId lexicográfico, seq asc) +
 * bridges com source:"bridge" (quando includeExternal). 2 runs → byte-idêntico.
 */
export function exportEvents(opts: ExportOptions): ExportResult {
  const dir = opts.eventsDirOverride ?? eventsDir(opts.cwd);
  const sessions = listStoreSessions(dir).filter((s) => opts.session === undefined || s === opts.session);

  const storeBySession = new Map<string, ReadEventsResult>();
  for (const sessionId of sessions) {
    const file = path.join(dir, `${sessionId}.jsonl`);
    storeBySession.set(sessionId, readEvents(file));
  }

  const lines: string[] = [];
  let skipped = 0;
  const hashViolations: string[] = [];

  const allStoreEvents: EventRecord[] = [];
  for (const sessionId of sessions) {
    const read = storeBySession.get(sessionId)!;
    skipped += read.skipped;
    hashViolations.push(...verifyHashChain(read.events, read.rawLines).map((v) => `[${sessionId}] ${v}`));
    for (const event of read.events) {
      lines.push(JSON.stringify(event));
      allStoreEvents.push(event);
    }
  }

  if (opts.includeExternal) {
    const sinks = opts.sinks ?? defaultSinkPaths(opts.cwd);
    const target = bridgeTargetSession(sessions, opts.session);
    if (target !== null) {
      const storeEvents = target === BRIDGE_SESSION_ID ? [] : (storeBySession.get(target)?.events ?? []);
      const bundle = target === BRIDGE_SESSION_ID ? "000000000000" : sessionBundleOf(storeEvents);
      // Seq VIRTUAL global na sessão-alvo (D8 — N+1 após o store; monotônico
      // per sessão — mesmo contrato do store). Ordem determinística das fontes.
      let seq = virtualStartSeq(storeEvents);
      const bridges: EventRecord[] = [];
      const bridgeSources: Array<{ events: EventRecord[]; skipped: number }> = [
        bridgeVerifyVerdicts(sinks.verifyVerdicts ?? path.join(opts.cwd, ".runecraft", "verify-verdicts.jsonl"), target, 0, bundle),
        bridgeLedger(sinks.ledger ?? path.join(opts.cwd, ".pi-glla", "active.jsonl"), target, 0, bundle),
        bridgeContinuation(sinks.continuation ?? continuationMetaPath(opts.cwd), target, 0, bundle),
        bridgeResilienceEvents(sinks.resilienceEvents ?? path.join(opts.cwd, ".runecraft", "resilience-events.jsonl"), target, 0, bundle),
      ];
      for (const source of bridgeSources) {
        skipped += source.skipped;
        for (const event of source.events) {
          bridges.push({ ...event, seq });
          seq += 1;
        }
      }
      for (const event of bridges) lines.push(JSON.stringify(event));
    }
  }

  return { lines, skipped, hashViolations };
}

/** Render do export para stdout (um evento por linha + resumo no stderr). */
export function renderExport(result: ExportResult): string {
  return result.lines.length > 0 ? `${result.lines.join("\n")}\n` : "";
}

/** Paths de interesse do F28 (status/docs). */
export { eventsDir, lessonsFile, promotedFile };
