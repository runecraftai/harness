// resilience/continuation.ts — continuação pós-compactação (D2, RES-02).
//
// Port do `work-continuation`/`compaction-recovery` do arcanum (guild/OpenCode
// — supersedido, AD-001) para MECANISMOS REAIS do Pi:
//   - fonte de verdade de goal/taskList = ledger do glla (F19/F24), NUNCA
//     snapshot de goal anterior (invariante D7 — regressão AD-024);
//   - metadados do harness em `.runecraft/continuation.json` (QA-1 — schema
//     v1, escrita atômica padrão F20);
//   - injeção via `before_agent_start` → `BeforeAgentStartEventResult.
//     systemPrompt` (encadeável — verificado no SDK types.d.ts linha ~790:
//     "If multiple extensions return this, they are chained").
//
// PURO por construção: `deriveContinuationState` e `buildContinuationPrompt`
// são funções puras (determinismo — 2 runs com o mesmo estado produzem o
// mesmo prompt; sem timestamp/path absoluto — F21 D10). O marker é
// `<!-- runecraft:continuation -->` (CONTINUATION_MARKER do port).
import * as fs from "node:fs";
import * as path from "node:path";
import { continuationMetaPath } from "./config.ts";
import type { ContinuationMetaFile, ContinuationState, ContinuationTask, GoalStatus } from "./types.ts";

/** Marker do prompt de continuação (port do CONTINUATION_MARKER do arcanum). */
export const CONTINUATION_MARKER = "<!-- runecraft:continuation -->" as const;

/** Goal lido do ledger (folding dos eventos `type:"state"` — mesma semântica
 *  do readState do fork e do sessionDriver do harness, F19 D8). */
export interface LedgerGoal {
  id?: unknown;
  objective?: unknown;
  status?: unknown;
  autoContinue?: unknown;
  taskList?: unknown;
}

export type GoalStateRead =
  | { ok: true; goal: LedgerGoal | null }
  | { ok: false; reason: "missing" | "unreadable" };

/**
 * Lê o goal ATUAL do ledger (`.pi-glla/active.jsonl`). Fold dos eventos
 * `type:"state"` exatamente como o fork (`{...state, ...value}`; `goal: null`
 * limpa; linhas malformadas puladas — truncamento mid-write). `goal: null`
 * quando o ledger existe mas não há goal ativo/objeto.
 */
export function readGoalState(cwd: string): GoalStateRead {
  const file = path.join(cwd, ".pi-glla", "active.jsonl");
  if (!fs.existsSync(file)) return { ok: false, reason: "missing" };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let goal: LedgerGoal | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt: { type?: unknown; value?: unknown };
    try {
      evt = JSON.parse(line) as { type?: unknown; value?: unknown };
    } catch {
      continue;
    }
    if (evt.type !== "state") continue;
    const value = evt.value;
    if (value === null || typeof value !== "object") continue;
    const v = value as { goal?: unknown };
    if (v.goal === null) goal = null;
    else if (typeof v.goal === "object") goal = v.goal as LedgerGoal;
  }
  return { ok: true, goal };
}

/** taskList do goal (formato v1 validado — F24 todo-writer.ts), ou null. */
export function goalTaskList(goal: LedgerGoal): ContinuationTask[] | null {
  const tl = goal.taskList;
  if (tl === null || tl === undefined || typeof tl !== "object") return null;
  const tasks = (tl as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  const out: ContinuationTask[] = [];
  for (const t of tasks) {
    const parsed = parseTask(t);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseTask(raw: unknown): ContinuationTask | null {
  if (raw === null || typeof raw !== "object") return null;
  const t = raw as { id?: unknown; title?: unknown; status?: unknown; subtasks?: unknown };
  if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.status !== "string") return null;
  const task: ContinuationTask = { id: t.id, title: t.title, status: t.status };
  if (Array.isArray(t.subtasks)) {
    const subs: ContinuationTask[] = [];
    for (const s of t.subtasks) {
      const parsed = parseTask(s);
      if (parsed) subs.push(parsed);
    }
    task.subtasks = subs;
  }
  return task;
}

/** Pendências recursivas (status !== "complete") — MESMA semântica do
 *  collectPendingTasks do F24 (todo-writer.ts): subtasks de uma task completa
 *  ainda pendem. Invariante D7: derivado do taskList ATUAL, nunca snapshot. */
export function collectUncheckedTasks(tasks: ContinuationTask[]): ContinuationTask[] {
  const pending: ContinuationTask[] = [];
  const walk = (items: ContinuationTask[]): void => {
    for (const t of items) {
      if (t.status !== "complete") {
        pending.push(t);
        if (t.subtasks) walk(t.subtasks);
      } else if (t.subtasks) {
        walk(t.subtasks);
      }
    }
  };
  walk(tasks);
  return pending;
}

/** Conta completas (recursivo — uma task completa com subtask pendente conta
 *  como NÃO completa para o progresso). */
export function countCompleted(tasks: ContinuationTask[]): number {
  let done = 0;
  const walk = (items: ContinuationTask[]): void => {
    for (const t of items) {
      const selfDone = t.status === "complete";
      if (selfDone && (!t.subtasks || t.subtasks.length === 0 || t.subtasks.every((s) => s.status === "complete"))) {
        done += 1;
      }
      if (t.subtasks) walk(t.subtasks);
    }
  };
  walk(tasks);
  return done;
}

export function countTotal(tasks: ContinuationTask[]): number {
  let total = 0;
  const walk = (items: ContinuationTask[]): void => {
    for (const t of items) {
      total += 1;
      if (t.subtasks) walk(t.subtasks);
    }
  };
  walk(tasks);
  return total;
}

/**
 * Deriva o ContinuationState do goal ATUAL do ledger + metadados do harness
 * (função pura — determinismo). Invariante D7: `pending` vem do taskList
 * ATUAL (nunca do snapshot de goal anterior); taskList vazia/só completas →
 * pending vazio (sem tarefa fantasma).
 */
export function deriveContinuationState(
  goal: LedgerGoal | null,
  meta: Pick<ContinuationMetaFile, "workSummary" | "continuationCount" | "stallCount" | "lastSessionId">,
): ContinuationState | null {
  if (goal === null) return null;
  const taskList = goalTaskList(goal);
  const tasks = taskList ?? [];
  return {
    goalId: typeof goal.id === "string" ? goal.id : "",
    objective: typeof goal.objective === "string" ? goal.objective : "",
    status: (typeof goal.status === "string" ? goal.status : "active") as GoalStatus,
    autoContinue: goal.autoContinue === true,
    taskList,
    completed: countCompleted(tasks),
    total: countTotal(tasks),
    pending: collectUncheckedTasks(tasks),
    workSummary: meta.workSummary ?? null,
    continuationCount: meta.continuationCount ?? 0,
    stallCount: meta.stallCount ?? 0,
    lastSessionId: meta.lastSessionId ?? null,
  };
}

/**
 * Scoping de sessão (D2 — semântica do work-continuation do arcanum): a
 * injeção só acontece na sessão que supervisiona o goal. `lastSessionId`
 * registra a última sessão que viu o goal ativo; uma sessão diferente (ex.:
 * subagent child que compartilha o agentDir) NUNCA injeta.
 */
export function isSessionScoped(state: ContinuationState, currentSessionId: string | null): boolean {
  if (currentSessionId === null || currentSessionId === "") return false;
  if (state.lastSessionId === null) return true; // sem dono registrado — a 1ª sessão assume
  return state.lastSessionId === currentSessionId;
}

/** O goal está supervisionável? (predicado do fork — isSupervising). */
export function isSupervisedGoal(state: ContinuationState): boolean {
  return state.status === "active" && state.autoContinue;
}

/** Título curto de uma task (id + título — sem path). */
function taskLine(t: ContinuationTask): string {
  return `${t.id}. ${t.title}`;
}

/**
 * Constrói o prompt de continuação (PURO — D2/F2). `null` quando não deve
 * injetar (sem goal / goal não ativo / não supervisionado / sem taskList —
 * nada a continuar). Determinístico: marker + goal + progresso
 * `completed/total` + diretório (basename — nunca path absoluto) + instruções
 * fixas (restaurar todos via propose_task_list com as pendências ATUAIS do
 * ledger — D7; continuar da primeira tarefa não checada; nunca re-executar
 * completas; complete_goal só com tudo checado).
 *
 * Invariante D7 (AD-024): as tarefas listadas são SÓ as pendências do taskList
 * ATUAL — nunca uma task completa, nunca uma task de snapshot obsoleto (o
 * teste adversarial re-injeta uma completa → o prompt NÃO a contém).
 *
 * @param directoryName nome do diretório de trabalho (basename do cwd — nunca
 *   path absoluto; determinismo F21 D10).
 */
export function buildContinuationPrompt(state: ContinuationState, directoryName: string): string | null {
  if (!isSupervisedGoal(state)) return null; // completo/pausado/abortado/sem autoContinue → null
  const taskList = state.taskList;
  if (taskList === null || taskList.length === 0) return null; // sem taskList → nada a continuar (sem ruído)
  const lines: string[] = [];
  lines.push(CONTINUATION_MARKER);
  lines.push("The session context was compacted (or resumed). Continue the active goal exactly from where it stopped.");
  lines.push("");
  lines.push(`Goal: ${state.objective}`);
  lines.push(`Progress: ${state.completed}/${state.total} tasks complete`);
  lines.push(`Directory: ${directoryName}`);
  lines.push("");
  lines.push("Instructions:");
  lines.push("- Restore the todo list by calling propose_task_list with EXACTLY the pending tasks below (the completed tasks stay complete — never re-propose them).");
  lines.push("- Continue from the first unchecked task; never re-execute completed tasks.");
  lines.push("- Call complete_goal only after every task in the ledger is checked.");
  if (state.workSummary !== null && state.workSummary.length > 0) {
    lines.push("");
    lines.push(`Work summary: ${state.workSummary}`);
  }
  if (state.pending.length > 0) {
    lines.push("");
    lines.push("Pending tasks (restore via propose_task_list):");
    for (const t of state.pending) lines.push(`- ${taskLine(t)}`);
  }
  lines.push("");
  lines.push("Do not restart the goal; do not create a new goal; do not repeat completed work.");
  return lines.join("\n");
}

// =================================================================
// `.runecraft/continuation.json` — metadados do harness (QA-1/D2, padrão F20)
// =================================================================

/** Meta vazia (schema v1). */
export function emptyContinuationMeta(): ContinuationMetaFile {
  return {
    schemaVersion: 1,
    lastSessionId: null,
    workSummary: null,
    continuationCount: 0,
    stallCount: 0,
    taskListSnapshot: null,
    compactedAt: null,
  };
}

export type ContinuationMetaRead =
  | { ok: true; meta: ContinuationMetaFile }
  | { ok: false; reason: "missing" | "corrupt" };

/** Leitura read-only da meta (ausente/corrompida → defaults, nunca falha). */
export function readContinuationMeta(cwd: string): ContinuationMetaRead {
  const file = continuationMetaPath(cwd);
  if (!fs.existsSync(file)) return { ok: false, reason: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (parsed === null || typeof parsed !== "object") return { ok: false, reason: "corrupt" };
  const p = parsed as Partial<ContinuationMetaFile>;
  if (p.schemaVersion !== 1) return { ok: false, reason: "corrupt" };
  return {
    ok: true,
    meta: {
      schemaVersion: 1,
      lastSessionId: typeof p.lastSessionId === "string" ? p.lastSessionId : null,
      workSummary: typeof p.workSummary === "string" ? p.workSummary : null,
      continuationCount: typeof p.continuationCount === "number" ? p.continuationCount : 0,
      stallCount: typeof p.stallCount === "number" ? p.stallCount : 0,
      taskListSnapshot: Array.isArray(p.taskListSnapshot) ? (p.taskListSnapshot as ContinuationTask[]) : null,
      compactedAt: typeof p.compactedAt === "string" ? p.compactedAt : null,
    },
  };
}

/** Escrita atômica (tmp + rename — STBK-03/F20): cria o dir `.runecraft/`. */
export function writeContinuationMeta(cwd: string, meta: ContinuationMetaFile): void {
  const file = continuationMetaPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
