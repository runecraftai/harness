// observability/lessons.test.ts — cognition lessons (T5, D5/D6, OBS-06/07/08).
//
// Núcleo puro: captura com 4 campos + triggerSignature, dedupe (mesmo
// trigger+gate = mesmo record, count++), reincidência 3x → promoted.jsonl +
// evento, high+2 → promove antes, adendo filtrado por gate (nunca vaza
// lesson de outro gate), ≤3, ordenado (priority, count), 2 runs idênticos,
// sem lessons → null; persistência atômica (tmp+rename — F20); promoção
// forçada/arquivamento (CLI).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyCapture,
  applyPromote,
  buildLessonAdendo,
  lessonIdOf,
  readLessonsFile,
  readPromotedFile,
  triggerSignatureOf,
  writeLessonsFile,
  writePromotedFile,
  LESSONS_MARKER,
} from "../../src/observability/lessons.ts";
import type { LessonRecord } from "../../src/observability/lessons-types.ts";

const THRESHOLDS = { promotionThreshold: 3, highPriorityThreshold: 2 };

function gateLesson(gate: string, priority: "low" | "med" | "high" = "med", trigger = `trigger ${gate}`) {
  return { trigger, antiPattern: `anti-pattern ${gate}`, preferred: `preferred ${gate}`, priority, gate, track: "execution" as const };
}

describe("lessons — captura e dedupe (D5/OBS-06)", () => {
  test("captura com 4 campos + triggerSignature; dedupe por trigger+gate (mesmo record, count++)", () => {
    const first = applyCapture([], gateLesson("write-existing-file-guard"), 0, THRESHOLDS);
    expect(first.outcome).toBe("captured");
    expect(first.record.count).toBe(1);
    expect(first.record.status).toBe("active");
    expect(first.record.triggerSignature).toBe(triggerSignatureOf("trigger write-existing-file-guard", "write-existing-file-guard"));
    expect(first.record.lessonId).toBe(lessonIdOf(first.record.triggerSignature));
    expect(first.events[0]!.kind).toBe("lesson:captured");

    const second = applyCapture(first.records, gateLesson("write-existing-file-guard"), 1, THRESHOLDS);
    expect(second.outcome).toBe("reincidence");
    expect(second.record.count).toBe(2);
    expect(second.events[0]!.kind).toBe("lesson:reincidence");
    expect(second.records).toHaveLength(1); // mesmo record, não duplicado

    // Mesmo trigger, gate DIFERENTE → record separado.
    const otherGate = applyCapture(second.records, gateLesson("ranger-md-only", "med", "trigger write-existing-file-guard"), 2, THRESHOLDS);
    expect(otherGate.records).toHaveLength(2);
  });

  test("reincidência 3x → count=3 → PROMOVIDA (promoted.jsonl + evento lesson:promoted)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-lessons-"));
    try {
      const file = path.join(dir, "lessons.jsonl");
      const promotedFile = path.join(dir, "promoted.jsonl");
      let records: LessonRecord[] = [];
      for (let seq = 0; seq < 3; seq++) {
        const result = applyCapture(records, gateLesson("guard-a"), seq, THRESHOLDS);
        records = result.records;
        writeLessonsFile(file, records);
        writePromotedFile(promotedFile, records);
        if (seq === 2) {
          expect(result.promoted).not.toBeNull();
          expect(result.promoted!.status).toBe("promoted");
          expect(result.events.some((e) => e.kind === "lesson:promoted")).toBe(true);
        } else {
          expect(result.promoted).toBeNull();
        }
      }
      expect(readLessonsFile(file)).toHaveLength(1);
      expect(readLessonsFile(file)[0]!.count).toBe(3);
      expect(readLessonsFile(file)[0]!.status).toBe("promoted");
      const promoted = readPromotedFile(promotedFile);
      expect(promoted).toHaveLength(1);
      expect(promoted[0]!.lessonId).toBe(readLessonsFile(file)[0]!.lessonId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("priority=high + count=2 → promove ANTES (threshold reduzido — D5 edge)", () => {
    let records: LessonRecord[] = [];
    const r1 = applyCapture(records, gateLesson("gate-h", "high"), 0, THRESHOLDS);
    records = r1.records;
    expect(r1.promoted).toBeNull();
    const r2 = applyCapture(records, gateLesson("gate-h", "high"), 1, THRESHOLDS);
    expect(r2.promoted).not.toBeNull();
    expect(r2.promoted!.status).toBe("promoted");
  });

  test("promote <id> força (CLI — D5); archive sai do adendo", () => {
    let records: LessonRecord[] = [];
    const r1 = applyCapture(records, gateLesson("gate-x"), 0, THRESHOLDS);
    records = r1.records;
    const id = r1.record.lessonId;
    expect(applyPromote(records, "unknown-id").record).toBeNull();
    const promoted = applyPromote(records, id);
    expect(promoted.record!.status).toBe("promoted");
    expect(promoted.records[0]!.status).toBe("promoted");
    const archived = promoted.records.map((r) => (r.lessonId === id ? { ...r, status: "archived" as const } : r));
    // Adendo planning não inclui arquivada.
    expect(buildLessonAdendo(archived, { track: "planning", max: 3 })).toBeNull();
  });

  test("persistência atômica: lessons.jsonl round-trip com escrita tmp+rename (F20)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-lessons-"));
    try {
      const file = path.join(dir, "lessons.jsonl");
      const r1 = applyCapture([], gateLesson("gate-y"), 0, THRESHOLDS);
      writeLessonsFile(file, r1.records);
      const read = readLessonsFile(file);
      expect(read).toEqual(r1.records);
      // Linha malformada → pulada (fail-soft).
      fs.appendFileSync(file, "{corrompido\n");
      expect(readLessonsFile(file)).toEqual(r1.records);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lessons — adendo (D6/OBS-08)", () => {
  function seed(): LessonRecord[] {
    const a = applyCapture([], gateLesson("gate-a", "med", "trigger-a"), 0, THRESHOLDS).record;
    const b = applyCapture([], gateLesson("gate-a", "high", "trigger-b"), 1, THRESHOLDS).record;
    const c = applyCapture([], gateLesson("gate-b", "low", "trigger-c"), 2, THRESHOLDS).record;
    const d = applyCapture([], gateLesson("gate-a", "med", "trigger-d"), 3, THRESHOLDS).record;
    return [a, b, c, d];
  }

  test("filtro por gate: NUNCA vaza lesson de outro gate; ≤3; ordenado (priority, count)", () => {
    const records = seed();
    const adendo = buildLessonAdendo(records, { gate: "gate-a", track: "execution", max: 3 })!;
    expect(adendo).toContain(LESSONS_MARKER);
    expect(adendo).not.toContain("trigger-c"); // gate-b não vaza
    const lines = adendo.split("\n").slice(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    // Ordem: high (trigger-b) primeiro; depois por count desc.
    expect(lines[0]!).toContain("trigger-b");
    // Formato compacto determinístico (D6).
    expect(lines[0]!).toMatch(/^- Gatilho: .* · Anti-padrão: .* · Padrão preferido: .* \(P(high|med|low)\)$/);
  });

  test("max=2 corta; sem lessons do gate → null (sem ruído — D6 edge)", () => {
    const records = seed();
    const adendo = buildLessonAdendo(records, { gate: "gate-a", track: "execution", max: 2 })!;
    expect(adendo.split("\n").slice(1)).toHaveLength(2);
    expect(buildLessonAdendo(records, { gate: "gate-unknown", track: "execution", max: 3 })).toBeNull();
    expect(buildLessonAdendo([], { gate: "gate-a", track: "execution", max: 3 })).toBeNull();
  });

  test("2 runs → texto IDÊNTICO (sem $TMP/$TS — F21 D10)", () => {
    const records = seed();
    const a = buildLessonAdendo(records, { gate: "gate-a", track: "execution", max: 3 })!;
    const b = buildLessonAdendo(records, { gate: "gate-a", track: "execution", max: 3 })!;
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("trilha planning: só lições PROMOVIDAS", () => {
    const records = seed();
    expect(buildLessonAdendo(records, { track: "planning", max: 3 })).toBeNull(); // nenhuma promovida
    const promoted = records.map((r) => (r.lessonId === records[0]!.lessonId ? { ...r, status: "promoted" as const } : r));
    const adendo = buildLessonAdendo(promoted, { track: "planning", max: 3 })!;
    expect(adendo).toContain("trigger-a");
    expect(adendo).not.toContain("trigger-b");
  });
});
