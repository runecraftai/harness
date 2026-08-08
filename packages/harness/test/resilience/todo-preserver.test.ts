// resilience/todo-preserver.test.ts — todo preserver (T4, RES-03/D3).
//
// Unit PURO: snapshot no session_before_compact (fonte: ledger), decisão de
// restore vs no-op (idempotente), payload de restore no formato v1 do
// propose_task_list do glla e invariante D7 (AD-024): o restore deriva SÓ do
// ledger ATUAL — snapshot obsoleto NUNCA vira tarefa re-injetada.
import { describe, expect, test } from "bun:test";
import {
  captureTaskListSnapshot,
  decideRestore,
  restorePayload,
  taskListsEqual,
  todosSurvived,
} from "../../src/resilience/todo-preserver.ts";
import { deriveContinuationState } from "../../src/resilience/continuation.ts";
import type { ContinuationTask } from "../../src/resilience/types.ts";
import type { LedgerGoal } from "../../src/resilience/continuation.ts";

function task(id: string, title: string, status: string, subtasks?: ContinuationTask[]): ContinuationTask {
  return { id, title, status, ...(subtasks ? { subtasks } : {}) };
}

function goalWith(tasks: ContinuationTask[] | null): LedgerGoal {
  const goal: Record<string, unknown> = { status: "active", id: "g1", objective: "obj", autoContinue: true };
  if (tasks !== null) goal.taskList = { version: 1, tasks };
  return goal as LedgerGoal;
}

const META = { workSummary: null, continuationCount: 0, stallCount: 0, lastSessionId: "s1" };

describe("captureTaskListSnapshot (D3)", () => {
  test("goal com taskList → snapshot derivado do ledger (fonte única)", () => {
    const snapshot = captureTaskListSnapshot(goalWith([task("1", "A", "pending"), task("2", "B", "complete")]));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.map((t) => t.id)).toEqual(["1", "2"]);
  });

  test("goal sem taskList → null (nada a snapshotar — sem falha)", () => {
    expect(captureTaskListSnapshot(goalWith(null))).toBeNull();
    expect(captureTaskListSnapshot(null)).toBeNull();
  });
});

describe("decideRestore (D3 — idempotente, nunca compete com o enforcer F24)", () => {
  test("taskList atual === snapshot → no-op (todos survived compaction)", () => {
    const tasks = [task("1", "A", "pending"), task("2", "B", "complete")];
    const decision = decideRestore(tasks, tasks);
    expect(decision.action).toBe("no-op");
    expect(decision.reason).toContain("survived compaction");
  });

  test("sem snapshot → no-op (debug — compactação não observou o goal)", () => {
    const decision = decideRestore([task("1", "A", "pending")], null);
    expect(decision.action).toBe("no-op");
    expect(decision.reason).toContain("no snapshot captured");
  });

  test("taskList atual ausente → no-op SEMPRE (invariante D7: snapshot nunca é re-injetado)", () => {
    const stale = [task("1", "Phantom", "pending")]; // snapshot de goal anterior
    const decision = decideRestore(null, stale);
    expect(decision.action).toBe("no-op");
    expect(decision.reason).toContain("never re-injected");
  });

  test("ledger mudou desde o snapshot → restore derivando do ATUAL (o snapshot vira diagnóstico)", () => {
    const current = [task("1", "A", "complete"), task("2", "B", "pending")];
    const stale = [task("1", "A", "pending"), task("2", "B", "pending")];
    const decision = decideRestore(current, stale);
    expect(decision.action).toBe("restore");
    expect(decision.reason).toContain("CURRENT ledger");
  });

  test("taskListsEqual — igualdade estrutural determinística", () => {
    expect(taskListsEqual([task("1", "A", "pending")], [task("1", "A", "pending")])).toBe(true);
    expect(taskListsEqual([task("1", "A", "pending")], [task("1", "A", "complete")])).toBe(false);
  });
});

describe("restorePayload (D7 — invariante AD-024)", () => {
  test("payload = pendências ATUAIS do ledger no formato v1 do propose_task_list", () => {
    const goal = goalWith([task("1", "A", "complete"), task("2", "B", "pending"), task("3", "C", "in_progress")]);
    const state = deriveContinuationState(goal, META)!;
    expect(restorePayload(state)).toEqual({ tasks: [{ title: "B" }, { title: "C" }] });
  });

  test("ADVERSARIAL: snapshot contém task que NÃO existe no ledger atual → payload deriva SÓ do atual", () => {
    // Goal anterior arquivado com task fantasma; goal atual sem ela (cenário
    // do phantom-block AD-024 — fix F24: re-injeção deriva apenas do ledger).
    const current = goalWith([task("1", "A", "complete"), task("4", "D", "pending")]);
    const staleSnapshot = [task("1", "A", "pending"), task("9", "Phantom from old goal", "pending")];
    const state = deriveContinuationState(current, META)!;
    const payload = restorePayload(state);
    expect(payload.tasks.map((t) => t.title)).toEqual(["D"]); // Phantom NUNCA aparece
    expect(payload.tasks.some((t) => t.title.includes("Phantom"))).toBe(false);
    // A invariante vale mesmo com o snapshot em mãos — o payload ignora.
    void staleSnapshot;
  });

  test("taskList vazia → payload vazio (sem tarefa fantasma)", () => {
    const state = deriveContinuationState(goalWith([]), META)!;
    expect(restorePayload(state)).toEqual({ tasks: [] });
  });
});

describe("todosSurvived (informacional — D3)", () => {
  test("taskList presente → survived", () => {
    expect(todosSurvived([task("1", "A", "pending")])).toBe(true);
  });
  test("ausente/vazia → não survived", () => {
    expect(todosSurvived(null)).toBe(false);
    expect(todosSurvived([])).toBe(false);
  });
});
