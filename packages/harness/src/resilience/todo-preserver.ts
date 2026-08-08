// resilience/todo-preserver.ts — todo preserver (D3, RES-03).
//
// Port do `compaction-todo-preserver` do arcanum (guild/OpenCode) para o Pi.
// O arcanum lia `client.session.todo` (API OpenCode — INEXISTENTE no Pi,
// provado no Execute F24); o equivalente Pi é o par ledger glla + tools
// reais `propose_task_list`/`update_task_status` (F24 — NÃO há todowrite/
// todoresolve no glla).
//
// Snapshot do `goal.taskList` no `session_before_compact` (lido do LEDGER —
// fonte única; nunca API); restauração derivada SOMENTE do ledger ATUAL
// (invariante D7/AD-024): o preserver nunca re-injeta uma task completa e
// nunca restaura de um snapshot obsoleto — se o ledger mudou desde o
// snapshot, o restore deriva do estado ATUAL (a taskList sobreviveu à
// compactação por construção — o ledger é disco, não sessão).
//
// Idempotente e não-competitivo com o enforcer F24: o payload de restore tem
// o formato v1 (títulos — `propose_task_list` do glla) e as pendências são
// exatamente as que o enforcer cobraria (sem tarefa fantasma → sem deadlock).
import type { ContinuationState, ContinuationTask } from "./types.ts";
import { collectUncheckedTasks, type LedgerGoal } from "./continuation.ts";

/** Decisão do preserver (D3): restore ou no-op (idempotente, sem falha). */
export type RestoreDecision =
  | { action: "restore"; reason: string }
  | { action: "no-op"; reason: string };

/**
 * Snapshot do taskList no session_before_compact (D3): deriva do goal ATUAL
 * do ledger no momento da compactação. `null` quando o goal não tem taskList
 * (nada a snapshotar).
 */
export function captureTaskListSnapshot(goal: LedgerGoal | null): ContinuationTask[] | null {
  if (goal === null) return null;
  const tl = goal.taskList;
  if (tl === null || tl === undefined || typeof tl !== "object") return null;
  const tasks = (tl as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  const out: ContinuationTask[] = [];
  for (const t of tasks) {
    if (t !== null && typeof t === "object") {
      const parsed = parseSnapshotTask(t);
      if (parsed) out.push(parsed);
    }
  }
  return out.length > 0 ? out : null;
}

function parseSnapshotTask(raw: unknown): ContinuationTask | null {
  if (raw === null || typeof raw !== "object") return null;
  const t = raw as { id?: unknown; title?: unknown; status?: unknown; subtasks?: unknown };
  if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.status !== "string") return null;
  const task: ContinuationTask = { id: t.id, title: t.title, status: t.status };
  if (Array.isArray(t.subtasks)) {
    const subs: ContinuationTask[] = [];
    for (const s of t.subtasks) {
      const parsed = parseSnapshotTask(s);
      if (parsed) subs.push(parsed);
    }
    task.subtasks = subs;
  }
  return task;
}

/** Igualdade estrutural de taskLists (determinística — sem path/timestamp). */
export function taskListsEqual(a: ContinuationTask[], b: ContinuationTask[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Decisão pura do preserver (D3/D7):
 *  - taskList ATUAL ausente → no-op ("sem taskList atual — nada a restaurar").
 *    INVARIANTE D7: snapshot obsoleto NUNCA vira tarefa re-injetada (o goal
 *    sem taskList não tem pendência no enforcer → complete_goal não bloqueia;
 *    restaurar do snapshot recriaria o phantom-block do AD-024).
 *  - taskList atual === snapshot → no-op ("todos survived compaction" —
 *    semântica do arcanum).
 *  - taskList atual ≠ snapshot → restore derivando do ATUAL (o ledger mudou
 *    desde a compactação — o snapshot é só diagnóstico).
 *  - sem snapshot → no-op (debug — a compactação não aconteceu ou não viu goal).
 */
export function decideRestore(currentTaskList: ContinuationTask[] | null, snapshot: ContinuationTask[] | null): RestoreDecision {
  if (currentTaskList === null) {
    return { action: "no-op", reason: "no current task list in ledger — nothing to restore (snapshot never re-injected; invariant D7)" };
  }
  if (snapshot === null) {
    return { action: "no-op", reason: "no snapshot captured — compaction did not observe this goal (debug)" };
  }
  if (taskListsEqual(currentTaskList, snapshot)) {
    return { action: "no-op", reason: "todos survived compaction — skipping restore (identical to snapshot)" };
  }
  return { action: "restore", reason: "ledger task list changed since compaction — restore derives from the CURRENT ledger (never the stale snapshot)" };
}

/**
 * Payload de restore (D3/D7): as pendências ATUAIS do ledger no formato do
 * `propose_task_list` do glla (`{ tasks: [{ title }] }` — o tool valida e
 * renumera ids; a restauração é REAL via tool do fork, nunca API OpenCode).
 *
 * INVARIANTE D7 (AD-024 — teste adversarial dedicado): o payload deriva SÓ do
 * taskList ATUAL — uma task completa do snapshot que não existe (ou já está
 * completa) no ledger NUNCA aparece; re-injetar completa = phantom-block.
 */
export function restorePayload(state: ContinuationState): { tasks: Array<{ title: string }> } {
  const tasks = collectUncheckedTasks(state.taskList ?? []).map((t) => ({ title: t.title }));
  return { tasks };
}

/** O taskList sobreviveu à compactação? (informacional — D3 no-op). */
export function todosSurvived(currentTaskList: ContinuationTask[] | null): boolean {
  return currentTaskList !== null && currentTaskList.length > 0;
}
