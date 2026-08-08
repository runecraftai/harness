// observability/store.ts — event store append-only por sessão (D1, OBS-01).
//
// QA-1a: `.runecraft/events/<sessionId>.jsonl` por sessão (append-only, uma
// linha = um evento). O primeiro evento é o header `session:started` (bundle
// full); `seq` int ≥ 0 monotônico por sessão (identidade + ordem — F21 D10,
// nunca timestamps); `prevHash` = sha256 da linha anterior (tamper-evident,
// determinístico — verificado no export); `at` ISO wall-clock SÓ no payload.
//
// Escrita best-effort (precedente recordSessionVerdict F25 — "nunca derruba o
// handler do complete_goal"): mkdir recursive + appendFileSync + try/catch +
// guardLog warn — NUNCA throw. Kill switch RUNECRAFT_OBSERVABILITY=0 →
// inerte (zero arquivos). Leitura fail-soft (padrão ledger glla v0.28.6 —
// linhas malformadas puladas e reportadas no stderr).
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { guardLog } from "../guards/guardKit.ts";
import { eventsFileFor, observabilityKillSwitch } from "./config.ts";
import type { EventKind, EventPayload, EventRecord, EventSource } from "./types.ts";

export const BUNDLE_PREFIX_LENGTH = 12 as const;

export interface AppendEventOptions {
  env?: NodeJS.ProcessEnv;
  /** prefixo curto do bundle (12 hex) da sessão. */
  bundle: string;
  source?: EventSource;
  runId?: string;
  /** clock injetável para `at` (determinismo em teste) — default ISO now. */
  now?: () => string;
  /** override do arquivo de eventos (testes) — default eventsFileFor(cwd, sessionId). */
  file?: string;
}

export type AppendResult =
  | { ok: true; seq: number; file: string }
  | { ok: false; reason: "kill-switch" | "write-failed" };

/** sha256 de uma linha (prevHash chain — D1). */
export function sha256Line(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/** hash da "linha anterior" da primeira linha (seq 0) — constante determinística. */
export const GENESIS_PREV_HASH = sha256Line("");

/** Último seq válido do arquivo (recovery pós-crash — D1 edge): lê a última
 *  linha parseável; arquivo ausente/vazio → -1 (o próximo append é seq 0). */
export function lastSeqOf(file: string): number {
  if (!fs.existsSync(file)) return -1;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && typeof (parsed as { seq?: unknown }).seq === "number") {
        return (parsed as { seq: number }).seq;
      }
    } catch {
      // linha malformada — pula (fail-soft)
    }
  }
  return -1;
}

/** Linha raw da última linha válida (para o prevHash chain). */
export function lastRawLineOf(file: string): string {
  if (!fs.existsSync(file)) return "";
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && typeof (parsed as { seq?: unknown }).seq === "number") {
        return raw;
      }
    } catch {
      // pula
    }
  }
  return "";
}

/**
 * Append de um evento (D1): seq auto (lê o último seq do arquivo — recovery),
 * prevHash da linha anterior (genesis = sha256("")), escrita best-effort.
 * NUNCA throw: falha de escrita → guardLog warn + {ok:false} — a sessão segue.
 */
export function appendEvent(cwd: string, sessionId: string, kind: EventKind, payload: EventPayload, opts: AppendEventOptions): AppendResult {
  const env = opts.env ?? process.env;
  if (observabilityKillSwitch(env).active) return { ok: false, reason: "kill-switch" };
  const file = opts.file ?? eventsFileFor(cwd, sessionId);
  const at = (opts.now ?? (() => new Date().toISOString()))();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lastSeq = lastSeqOf(file);
    const seq = lastSeq + 1;
    const prevHash = seq === 0 ? GENESIS_PREV_HASH : sha256Line(lastRawLineOf(file));
    const line = JSON.stringify({
      seq,
      kind,
      sessionId,
      bundle: opts.bundle,
      prevHash,
      ...(opts.source !== undefined ? { source: opts.source } : {}),
      ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      payload: { ...payload, at },
    });
    fs.appendFileSync(file, `${line}\n`, "utf8");
    return { ok: true, seq, file };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    guardLog.warn(`obs store: falha ao gravar evento ${kind} (${sessionId}): ${message}`);
    return { ok: false, reason: "write-failed" };
  }
}

export interface ReadEventsResult {
  events: EventRecord[];
  /** linhas malformadas puladas (fail-soft — padrão ledger glla). */
  skipped: number;
  /** arquivo ausente. */
  missing: boolean;
  /** linhas RAW alinhadas a events[i] (prevHash chain — D1/D8). */
  rawLines: string[];
}

/**
 * Leitura fail-soft dos eventos de UMA sessão (D1/edge): linhas malformadas
 * são puladas e contadas (stderr reporta no export). Ordem = seq do arquivo.
 */
export function readEvents(file: string): ReadEventsResult {
  if (!fs.existsSync(file)) return { events: [], skipped: 0, missing: true, rawLines: [] };
  const events: EventRecord[] = [];
  const rawLines: string[] = [];
  let skipped = 0;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const parsed = parseEventLine(line);
    if (parsed === null) skipped++;
    else {
      events.push(parsed);
      rawLines.push(line);
    }
  }
  return { events, skipped, missing: false, rawLines };
}

/** Parse de UMA linha com shape check por kind (D2 — zero parser). */
export function parseEventLine(raw: string): EventRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.seq !== "number" ||
    typeof p.kind !== "string" ||
    typeof p.sessionId !== "string" ||
    typeof p.bundle !== "string" ||
    typeof p.prevHash !== "string" ||
    p.payload === null ||
    typeof p.payload !== "object"
  ) {
    return null;
  }
  return {
    seq: p.seq,
    kind: p.kind as EventKind,
    sessionId: p.sessionId,
    bundle: p.bundle,
    prevHash: p.prevHash,
    ...(typeof p.source === "string" ? { source: p.source as EventSource } : {}),
    ...(typeof p.runId === "string" ? { runId: p.runId } : {}),
    payload: p.payload as EventRecord["payload"],
  };
}

/** Verificação do prevHash chain (D1/D8): violações → lista (export reporta no stderr). */
export function verifyHashChain(events: EventRecord[], rawLines: string[]): string[] {
  const violations: string[] = [];
  let expected = GENESIS_PREV_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.prevHash !== expected) {
      violations.push(`seq ${event.seq} (${event.kind}): prevHash esperado ${expected.slice(0, 12)}…, encontrado ${event.prevHash.slice(0, 12)}…`);
    }
    expected = sha256Line(rawLines[i] ?? "");
  }
  return violations;
}
