// guards/todo-description-override.ts — GUARD-04 (F24, D4).
//
// Port do `todo-description-override` do guild (OpenCode). No guild o hook
// reescrevia a DESCRIÇÃO da tool todowrite (aviso no prompt — a LLM podia
// ignorar). No Pi o `event.input` do `tool_call` é mutável (validado no
// Execute contra types.d.ts do SDK 0.81.0: "Mutate it in place to patch tool
// arguments before execution") — o F24 reescreve o INPUT de verdade: cada
// item da `propose_task_list` do glla (a tool de task list do fork — o
// "todowrite" validado no Execute) ganha o critério canônico "Done when".
// O tool executa com o input reescrito (AC 3.1); input já canônico fica
// inalterado (idempotente — T4).
import { canonicalizeTodoTitle, DONE_WHEN_MARKER } from "./todo-writer.ts";

export const TODO_OVERRIDE_GUARD_ID = "todoDescriptionOverride" as const;

/** A tool de task list do fork glla (validada no Execute — ver todo-writer.ts). */
export const TODO_WRITE_TOOL = "propose_task_list" as const;

export { DONE_WHEN_MARKER };

/**
 * Reescreve `event.input` in-place para o formato canônico (mutação — o Pi
 * executa a tool com o input já reescrito; handlers posteriores veem a
 * mutação). Nunca bloqueia: a reescrita É a política (AC 3.1).
 */
export function rewriteTodoInput(input: { tasks?: unknown }): void {
  if (!Array.isArray(input.tasks)) return;
  for (const raw of input.tasks) {
    if (raw === null || typeof raw !== "object") continue;
    const task = raw as { title?: unknown; subtasks?: unknown };
    if (typeof task.title === "string") {
      task.title = canonicalizeTodoTitle(task.title);
    }
    if (Array.isArray(task.subtasks)) {
      task.subtasks = task.subtasks.map((s) => (typeof s === "string" ? canonicalizeTodoTitle(s) : s));
    }
  }
}
