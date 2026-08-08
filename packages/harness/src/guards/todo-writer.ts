// guards/todo-writer.ts — helper compartilhado dos todo-* (GUARD-04/05, D1).
//
// Formato canônico de todo (critério "Done when" por item) + leitura do
// ledger de todos do fork goal-loop-audit (formato validado no Execute F24
// contra packages/goal-loop-audit/extensions/goal-loop-core.ts + loops/goal.ts):
//
//   - tools de todo do glla: `propose_task_list` (cria a task list — o
//     "todowrite" do fork; NÃO existe todowrite/todoresolve no glla),
//     `update_task_status`, `complete_task` e `complete_goal` (conclusão)
//   - estado: ledger `<cwd>/.pi-glla/active.jsonl` — JSONL de eventos
//     `{type, value, at}`; eventos `type:"state"` dobram `{...state, ...value}`
//     (mesma semântica do readState do fork); `goal.taskList = { version: 1,
//     tasks: [{ id, title, status, subtasks: [{id, title, status}] }] }`
//   - status de task: "pending" | "in_progress" | "complete"
//
// A dobra ignora linhas malformadas (truncamento mid-write) exatamente como o
// fork (v0.28.6) e o sessionDriver do harness (F19 D8).
import * as fs from "node:fs";
import * as path from "node:path";

export const DONE_WHEN_MARKER = "Done when";

/** Já canônico? Um título com "done when" (case-insensitive) não é reescrito (idempotente). */
export function hasDoneWhen(title: string): boolean {
  return /\bdone when\b/i.test(title);
}

/**
 * Reescreve um título para o formato canônico (T4): `<título> — Done when:
 * <título> é concluído e verificado`. Determinístico (identidade estável para
 * a evidência do F21 D10); idempotente para input já canônico.
 */
export function canonicalizeTodoTitle(title: string): string {
  const trimmed = title.trim();
  if (hasDoneWhen(trimmed)) return trimmed;
  const base = trimmed.replace(/[.\s]+$/, "");
  return `${base} — Done when: ${base} is complete and verified`;
}

/** Item de task do ledger do glla (shape validado no Execute). */
export interface GllaTodoTask {
  id: string;
  title: string;
  status: string;
  subtasks?: GllaTodoTask[];
}

export type TodoLedgerRead =
  | { ok: true; tasks: GllaTodoTask[] | null }
  | { ok: false; reason: "missing" | "unreadable" };

/**
 * Lê a task list ativa do ledger do glla (read-only). `tasks: null` quando o
 * goal não tem taskList (nada a cobrar); `ok:false` quando o ledger não
 * existe/é ilegível (fail-open por construção: sem estado de todos não há
 * pendência a bloquear — o guard protege a CONCLUSÃO, não o fork).
 */
export function readGllaTaskList(cwd: string): TodoLedgerRead {
  const file = path.join(cwd, ".pi-glla", "active.jsonl");
  if (!fs.existsSync(file)) return { ok: false, reason: "missing" };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let taskList: unknown = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt: { type?: unknown; value?: unknown };
    try {
      evt = JSON.parse(line) as { type?: unknown; value?: unknown };
    } catch {
      continue; // linha truncada/malformada — pulada, como no fork
    }
    if (evt.type !== "state") continue;
    const value = evt.value;
    if (value === null || typeof value !== "object") continue;
    const v = value as { goal?: unknown };
    if (v.goal === null || v.goal === undefined) continue;
    if (typeof v.goal !== "object") continue;
    const goal = v.goal as { taskList?: unknown };
    if (goal.taskList === null || goal.taskList === undefined || typeof goal.taskList !== "object") {
      // Goal atual sem taskList (ou malformada): nada a cobrar deste goal —
      // reset para não cobrar a taskList OBSOLETA de um goal anterior
      // arquivado no mesmo ledger (fix review cleric F24: goal A aborted
      // mantém a lista no ledger; goal B nasce sem taskList e seria
      // bloqueado por tarefas fantasmas que o agente não consegue limpar).
      taskList = null;
      continue;
    }
    taskList = goal.taskList;
  }
  if (taskList === null) return { ok: true, tasks: null };
  const tl = taskList as { tasks?: unknown };
  if (!Array.isArray(tl.tasks)) return { ok: true, tasks: null };
  const tasks: GllaTodoTask[] = [];
  for (const t of tl.tasks) {
    const parsed = parseTask(t);
    if (parsed) tasks.push(parsed);
  }
  return { ok: true, tasks };
}

function parseTask(raw: unknown): GllaTodoTask | null {
  if (raw === null || typeof raw !== "object") return null;
  const t = raw as { id?: unknown; title?: unknown; status?: unknown; subtasks?: unknown };
  if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.status !== "string") return null;
  const task: GllaTodoTask = { id: t.id, title: t.title, status: t.status };
  if (Array.isArray(t.subtasks)) {
    const subs: GllaTodoTask[] = [];
    for (const s of t.subtasks) {
      const parsed = parseTask(s);
      if (parsed) subs.push(parsed);
    }
    task.subtasks = subs;
  }
  return task;
}

/** Pendências (status ≠ "complete") recursivas, com id para o reason (complete_task usa id). */
export function collectPendingTasks(tasks: GllaTodoTask[]): string[] {
  const pending: string[] = [];
  const walk = (items: GllaTodoTask[]): void => {
    for (const t of items) {
      if (t.status !== "complete") {
        pending.push(`${t.id} (${t.title})`);
        if (t.subtasks) walk(t.subtasks);
      } else if (t.subtasks) {
        walk(t.subtasks); // subtasks pendentes de uma task completa ainda pendem
      }
    }
  };
  walk(tasks);
  return pending;
}
