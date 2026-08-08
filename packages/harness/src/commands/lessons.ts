// commands/lessons.ts — CLI `harness lessons list|promote|archive` (D5, OBS-07).
//
//   list             → lessons.jsonl (estado) + promoted.jsonl (memória de time),
//                      com status/count/gate/prioridade — --json shape estável.
//   promote <id>     → FORÇA a promoção (grava promoted.jsonl versionado).
//   archive <id>     → status=archived (lições obsoletas saem do adendo).
//
// O estado vive em `.runecraft/lessons.jsonl` (gitignored); a promoção grava
// `.runecraft/lessons/promoted.jsonl` (VERSIONADO — QA-4a, revisão via PR).
// Escrita atômica (tmp+rename — padrão F20) e best-effort (nunca quebra).
import type { Runtime, TextSink } from "../config.ts";
import { lessonsFile, promotedFile } from "../observability/config.ts";
import { applyPromote, readLessonsFile, writeLessonsFile, writePromotedFile } from "../observability/lessons.ts";
import { observabilityKillSwitch } from "../observability/config.ts";
import type { LessonRecord } from "../observability/lessons-types.ts";

export interface LessonsCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  subcommand: string;
  args: string[];
}

function renderList(records: LessonRecord[], json: boolean): string {
  if (json) return `${JSON.stringify({ lessons: records }, null, 2)}\n`;
  if (records.length === 0) return "@runecraft/companion lessons: nenhuma lição capturada ainda\n";
  const lines = ["@runecraft/companion lessons:"];
  for (const r of records) {
    lines.push(
      `  ${r.status === "promoted" ? "[P]" : r.status === "archived" ? "[A]" : "[ ]"} ${r.lessonId} · gate=${r.gate} · count=${r.count} · ${r.priority} · ${r.trigger}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runLessonsCommand(opts: LessonsCommandOptions): Promise<number> {
  const cwd = opts.rt.cwd;

  if (observabilityKillSwitch(opts.rt.env).active) {
    opts.out.write("@runecraft/companion lessons: observability inativa — kill switch RUNECRAFT_OBSERVABILITY=0 (F20)\n");
    return 0;
  }

  const stateFile = lessonsFile(cwd);
  const promoted = promotedFile(cwd);

  switch (opts.subcommand) {
    case "list": {
      const records = readLessonsFile(stateFile);
      const promotedRecords = readLessonsFile(promoted);
      if (opts.json) {
        opts.out.write(
          `${JSON.stringify({ lessons: records, promoted: promotedRecords }, null, 2)}\n`,
        );
      } else {
        opts.out.write(renderList(records, false));
        if (promotedRecords.length > 0) {
          opts.out.write(`@runecraft/companion lessons: memória de time (promoted.jsonl — ${promotedRecords.length} lição(ões) versionada(s))\n`);
        }
      }
      return 0;
    }
    case "promote": {
      const id = opts.args[0];
      if (id === undefined) {
        opts.err.write("@runecraft/companion: `harness lessons promote <id>` — id da lição ausente\n");
        return 1;
      }
      const records = readLessonsFile(stateFile);
      const { records: updated, record } = applyPromote(records, id);
      if (record === null) {
        opts.err.write(`@runecraft/companion: lição não encontrada: ${id}\n`);
        return 1;
      }
      writeLessonsFile(stateFile, updated);
      writePromotedFile(promoted, updated);
      opts.out.write(`@runecraft/companion lessons: promovida ${id} (count=${record.count}, priority=${record.priority})\n`);
      return 0;
    }
    case "archive": {
      const id = opts.args[0];
      if (id === undefined) {
        opts.err.write("@runecraft/companion: `harness lessons archive <id>` — id da lição ausente\n");
        return 1;
      }
      const records = readLessonsFile(stateFile);
      const existing = records.find((r) => r.lessonId === id);
      if (existing === undefined) {
        opts.err.write(`@runecraft/companion: lição não encontrada: ${id}\n`);
        return 1;
      }
      const updated = records.map((r) => (r.lessonId === id ? { ...r, status: "archived" as const } : r));
      writeLessonsFile(stateFile, updated);
      writePromotedFile(promoted, updated);
      opts.out.write(`@runecraft/companion lessons: arquivada ${id} (sai do adendo)\n`);
      return 0;
    }
    default:
      opts.err.write(`@runecraft/companion: subcomando desconhecido de lessons: ${opts.subcommand || "(vazio)"} (esperado: list|promote|archive)\n`);
      return 1;
  }
}
