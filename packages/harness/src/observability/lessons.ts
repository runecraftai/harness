// observability/lessons.ts — cognition lessons (D5/D6, OBS-06/07/08).
//
// Lesson = regra compacta quando um gate falha: gatilho / anti-padrão /
// padrão preferido / prioridade + reincidência. Estado em
// `.runecraft/lessons.jsonl` (gitignored — dado derivado do runtime);
// promoção grava `.runecraft/lessons/promoted.jsonl` (VERSIONADO — memória
// de time, QA-4a; F29 consome). Adendo = texto curto filtrado por gate
// injetado via before_agent_start (D6) com marker `<!-- runecraft:lessons -->`.
//
// O núcleo é PURO (applyCapture/applyPromote/buildLessonAdendo — determinismo
// F21 D10, sem $TMP/$TS); a persistência é atômica (tmp+rename — padrão F20,
// precedente continuation.json do F27) e best-effort (nunca quebra a sessão).
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { guardLog } from "../guards/guardKit.ts";
import { canonicalJson, sha256Hex } from "./bundle.ts";
import type { Lesson, LessonPriority, LessonRecord, LessonStatus, LessonTrack } from "./lessons-types.ts";

/** Marker do adendo (D6 — chaining preservado, nunca sobrescreve outras extensões). */
export const LESSONS_MARKER = "<!-- runecraft:lessons -->" as const;

export interface CaptureLessonInput extends Lesson {}

export interface ApplyCaptureResult {
  records: LessonRecord[];
  record: LessonRecord;
  outcome: "captured" | "reincidence";
  /** record promovido nesta captura (null quando não atingiu o threshold). */
  promoted: LessonRecord | null;
  /** eventos a emitir no store (contrato OBS-06/07). */
  events: Array<
    | { kind: "lesson:captured"; payload: Record<string, unknown> }
    | { kind: "lesson:reincidence"; payload: Record<string, unknown> }
    | { kind: "lesson:promoted"; payload: Record<string, unknown> }
  >;
}

export interface PromotionThresholds {
  promotionThreshold: number;
  highPriorityThreshold: number;
}

const PRIORITY_RANK: Record<LessonPriority, number> = { high: 3, med: 2, low: 1 };

/** triggerSignature = sha256(canonicalJson({trigger, gate})) — dedupe (D5). */
export function triggerSignatureOf(trigger: string, gate: string): string {
  return sha256Hex(canonicalJson({ trigger, gate }));
}

/** lessonId determinístico: prefixo 16 hex da triggerSignature (mesma lesson
 *  = mesmo id — estável entre reincidências). */
export function lessonIdOf(signature: string): string {
  return signature.slice(0, 16);
}

export function lessonPriorityRank(priority: LessonPriority): number {
  return PRIORITY_RANK[priority];
}

/** Promoção (D5): count >= promotionThreshold OU (high E count >= highPriorityThreshold). */
export function shouldPromote(record: LessonRecord, thresholds: PromotionThresholds): boolean {
  if (record.count >= thresholds.promotionThreshold) return true;
  return record.priority === "high" && record.count >= thresholds.highPriorityThreshold;
}

/**
 * Transição PURA de captura (D5): dedupe por triggerSignature → novo record
 * (count 1) ou reincidência (count++, record reescrito — contador é ESTADO,
 * não evento; precedente continuation.json F27). Retorna os eventos do store
 * (trilho auditável) + a promoção quando o threshold é atingido.
 */
export function applyCapture(records: LessonRecord[], input: CaptureLessonInput, seq: number, thresholds: PromotionThresholds): ApplyCaptureResult {
  const signature = triggerSignatureOf(input.trigger, input.gate);
  const existing = records.find((r) => r.triggerSignature === signature);

  if (existing === undefined || existing.status === "archived") {
    const record: LessonRecord = {
      lessonId: lessonIdOf(signature),
      triggerSignature: signature,
      trigger: input.trigger,
      antiPattern: input.antiPattern,
      preferred: input.preferred,
      priority: input.priority,
      gate: input.gate,
      track: input.track,
      count: 1,
      status: "active",
      firstSeenSeq: seq,
      lastSeenSeq: seq,
    };
    let promoted: LessonRecord | null = null;
    const events: ApplyCaptureResult["events"] = [
      {
        kind: "lesson:captured",
        payload: {
          lessonId: record.lessonId,
          triggerSignature: signature,
          trigger: record.trigger,
          antiPattern: record.antiPattern,
          preferred: record.preferred,
          priority: record.priority,
          gate: record.gate,
          track: record.track,
          count: record.count,
        },
      },
    ];
    if (shouldPromote(record, thresholds)) {
      promoted = { ...record, status: "promoted" };
      events.push({
        kind: "lesson:promoted",
        payload: { lessonId: record.lessonId, triggerSignature: signature, priority: record.priority, count: record.count },
      });
    }
    return { records: [...records, record], record, outcome: "captured", promoted, events };
  }

  const updated: LessonRecord = {
    ...existing,
    count: existing.count + 1,
    lastSeenSeq: seq,
  };
  const events: ApplyCaptureResult["events"] = [
    {
      kind: "lesson:reincidence",
      payload: { lessonId: updated.lessonId, triggerSignature: signature, count: updated.count },
    },
  ];
  let promoted: LessonRecord | null = null;
  if (updated.status !== "promoted" && shouldPromote(updated, thresholds)) {
    promoted = { ...updated, status: "promoted" };
    events.push({
      kind: "lesson:promoted",
      payload: { lessonId: updated.lessonId, triggerSignature: signature, priority: updated.priority, count: updated.count },
    });
  }
  const next = records.map((r) => (r.triggerSignature === signature ? (promoted ?? updated) : r));
  return { records: next, record: promoted ?? updated, outcome: "reincidence", promoted, events };
}

/** Promoção FORÇADA (CLI `harness lessons promote <id>` — D5). */
export function applyPromote(records: LessonRecord[], lessonId: string): { records: LessonRecord[]; record: LessonRecord | null } {
  const existing = records.find((r) => r.lessonId === lessonId);
  if (existing === undefined) return { records, record: null };
  const promoted: LessonRecord = { ...existing, status: "promoted" };
  const next = records.map((r) => (r.lessonId === lessonId ? promoted : r));
  return { records: next, record: promoted };
}

/** Arquivo de estado: lessons.jsonl (append p/ novos, REWRITE p/ reincidência
 *  — escrita atômica tmp+rename, padrão F20). */

/** Leitura fail-soft (malformadas puladas — padrão ledger glla). */
export function readLessonsFile(file: string): LessonRecord[] {
  if (!fs.existsSync(file)) return [];
  const out: LessonRecord[] = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const parsed = parseLessonLine(line);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export function parseLessonLine(raw: string): LessonRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.lessonId !== "string" ||
    typeof p.triggerSignature !== "string" ||
    typeof p.trigger !== "string" ||
    typeof p.antiPattern !== "string" ||
    typeof p.preferred !== "string" ||
    typeof p.priority !== "string" ||
    typeof p.gate !== "string" ||
    typeof p.track !== "string" ||
    typeof p.count !== "number" ||
    typeof p.firstSeenSeq !== "number" ||
    typeof p.lastSeenSeq !== "number"
  ) {
    return null;
  }
  return {
    lessonId: p.lessonId,
    triggerSignature: p.triggerSignature,
    trigger: p.trigger,
    antiPattern: p.antiPattern,
    preferred: p.preferred,
    priority: p.priority as LessonPriority,
    gate: p.gate,
    track: p.track as LessonTrack,
    count: p.count,
    status: (p.status as LessonStatus) ?? "active",
    firstSeenSeq: p.firstSeenSeq,
    lastSeenSeq: p.lastSeenSeq,
  };
}

/** Escrita atômica (tmp+rename — F20). Best-effort (nunca throw). */
export function writeLessonsFile(file: string, records: LessonRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${createHash("sha256").update(file).digest("hex").slice(0, 8)}`;
    const body = records.map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(tmp, records.length > 0 ? `${body}\n` : "", "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    guardLog.warn(`obs lessons: falha ao gravar ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Memória de time: promoted.jsonl (VERSIONADO — QA-4a). Leitura fail-soft. */
export function readPromotedFile(file: string): LessonRecord[] {
  return readLessonsFile(file);
}

/** Escrita determinística do promoted.jsonl: só records promoted, sorted por lessonId
 *  (diff-friendly para revisão humana via PR — D5). Best-effort (nunca throw). */
export function writePromotedFile(file: string, records: LessonRecord[]): void {
  const promoted = records
    .filter((r) => r.status === "promoted")
    .sort((a, b) => (a.lessonId < b.lessonId ? -1 : a.lessonId > b.lessonId ? 1 : 0));
  writeLessonsFile(file, promoted);
}

// ---------------------------------------------------------------------------
// Adendo (D6) — PURO e determinístico
// ---------------------------------------------------------------------------

export interface BuildAdendoOptions {
  /** execution: filter gate == gateId; planning: filter status == promoted. */
  gate?: string;
  track: LessonTrack;
  max?: number;
}

/** Texto compacto de UMA lesson (D6 — formato estável, sem $TMP/$TS). */
export function lessonLine(record: LessonRecord): string {
  return `Gatilho: ${record.trigger} · Anti-padrão: ${record.antiPattern} · Padrão preferido: ${record.preferred} (P${record.priority})`;
}

/**
 * Adendo curto (≤ max lessons, default 3): filtro por gate (execution) ou
 * status=promoted (planning), ordena (priority, count) desc, corta em max.
 * Sem lessons → null (D6 — sem ruído no prompt). Determinístico (F21 D10).
 */
export function buildLessonAdendo(records: LessonRecord[], opts: BuildAdendoOptions): string | null {
  const max = opts.max ?? 3;
  const filtered = records.filter((r) => {
    if (opts.track === "planning") return r.status === "promoted";
    return opts.gate !== undefined && r.gate === opts.gate;
  });
  if (filtered.length === 0) return null;
  const selected = [...filtered]
    .sort((a, b) => {
      const byPriority = lessonPriorityRank(b.priority) - lessonPriorityRank(a.priority);
      if (byPriority !== 0) return byPriority;
      return b.count - a.count;
    })
    .slice(0, max);
  const lines = selected.map((r) => `- ${lessonLine(r)}`);
  return `${LESSONS_MARKER}\n${lines.join("\n")}`;
}

/** sha256 do texto do adendo (16 hex) — evento adendo:injected (D6). */
export function adendoTextHash(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

/** lessonIds do adendo (determinístico — mesma ordem do texto). */
export function adendoLessonIds(records: LessonRecord[], text: string): string[] {
  const lines = text.split("\n").slice(1);
  const ids: string[] = [];
  for (const record of records) {
    if (lines.includes(`- ${lessonLine(record)}`)) ids.push(record.lessonId);
  }
  return ids;
}
