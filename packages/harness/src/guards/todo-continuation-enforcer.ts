// guards/todo-continuation-enforcer.ts — GUARD-05 (F24, D6).
//
// Port do `todo-continuation-enforcer` do guild (OpenCode) para o Pi.
//
// EVENTO VALIDADO NO EXECUTE: no Pi 0.81.0 os handlers de `turn_end`/
// `agent_end`/`agent_settled` NÃO podem bloquear — o runner descarta o
// resultado de handlers de eventos não-`session_before_*` (validado no
// runner.js: `emit()` só honra `{ cancel: true }` para session_before_*; o
// tipo do handler de agent_end/turn_end é void no types.d.ts). O ÚNICO ponto
// com bloqueio real é `tool_call`. No modelo do glla a "conclusão do
// trabalho" É o tool `complete_goal` (validado no Execute — o fork não tem
// turn_end de conclusão; complete_goal é o gate de conclusão com auditor
// isolado). Portanto o enforcer bloqueia o tool_call de `complete_goal`
// quando há tarefas pendentes no ledger — bloqueio REAL, mais forte que o
// aviso do guild (que finalizava in_progress por conta própria ou injetava
// prompt).
//
// Lê o ledger `.pi-glla/active.jsonl` (formato validado — todo-writer.ts),
// lista as pendências (status ≠ "complete", recursivo com subtasks) no reason
// (D3: `<guardId>: <mensagem>`, sem paths/timestamps). Sem ledger/sem
// taskList → passa (nada a cobrar). Guard desabilitado → não intervém (AC 3.4).
import { block, type GuardRuntime } from "./guardKit.ts";
import { collectPendingTasks, readGllaTaskList } from "./todo-writer.ts";

export const TODO_ENFORCER_GUARD_ID = "todoContinuationEnforcer" as const;

/** A tool de conclusão do fork glla (validada no Execute). */
export const TODO_COMPLETE_TOOL = "complete_goal" as const;

/**
 * Decisão pura do enforcer (ledger fake → decisão). `undefined` = passa.
 * - pendências → block com reason listando id+title (AC 3.2)
 * - sem pendências / sem ledger / sem taskList → passa (AC 3.3)
 */
export function decideTodoEnforcer(cfg: GuardRuntime, cwd: string): { block: true; reason: string } | undefined {
  if (!cfg.enabled) return undefined; // AC 3.4: guard desabilitado não intervém
  const read = readGllaTaskList(cwd);
  if (!read.ok || read.tasks === null) return undefined;
  const pending = collectPendingTasks(read.tasks);
  if (pending.length === 0) return undefined;
  const list = pending.join("; ");
  return {
    block: true,
    reason: block(
      TODO_ENFORCER_GUARD_ID,
      `complete_goal blocked — pending tasks: ${list} (complete or cancel them before concluding the goal)`,
    ).reason,
  };
}
