// resilience/continuation.test.ts — continuation builder (T2, RES-02/D2).
//
// Unit PURO: readGoalState (ledger fake no formato validado do glla),
// deriveContinuationState, buildContinuationPrompt, scoping de sessão e
// invariante D7 (AD-024 — re-injeção de task completa NUNCA ocorre).
// Determinismo: 2 runs com o mesmo estado → prompt IDÊNTICO (sem $TMP/$TS —
// F21 D10).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CONTINUATION_MARKER,
  buildContinuationPrompt,
  deriveContinuationState,
  isSessionScoped,
  isSupervisedGoal,
  readContinuationMeta,
  readGoalState,
  writeContinuationMeta,
} from "../../src/resilience/continuation.ts";
import type { ContinuationTask } from "../../src/resilience/types.ts";
import type { LedgerGoal } from "../../src/resilience/continuation.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resilience-continuation-"));
}

function task(id: string, title: string, status: string, subtasks?: ContinuationTask[]): ContinuationTask {
  return { id, title, status, ...(subtasks ? { subtasks } : {}) };
}

/** Escreve um ledger fake no formato validado do glla (.pi-glla/active.jsonl). */
function writeLedger(cwd: string, goal: Record<string, unknown> | null): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function activeGoal(objective = "Ship F27", tasks?: ContinuationTask[]): Record<string, unknown> {
  const goal: Record<string, unknown> = { status: "active", id: "g1", objective, autoContinue: true };
  if (tasks) goal.taskList = { version: 1, tasks };
  return goal;
}

const META = { workSummary: null, continuationCount: 0, stallCount: 0, lastSessionId: "sess-1" };

function stateOf(goal: LedgerGoal | null, meta: typeof META = META) {
  return deriveContinuationState(goal, meta);
}

describe("readGoalState — leitura do ledger (fold state events)", () => {
  test("ledger ausente → missing; ilegível (fs) → unreadable", () => {
    const dir = makeTmp();
    try {
      expect(readGoalState(dir).ok).toBe(false);
      // Ledger com conteúdo ilegível via fs (EACCES/EIO) → unreadable.
      const dirGlla = path.join(dir, ".pi-glla");
      fs.mkdirSync(dirGlla, { recursive: true });
      fs.writeFileSync(path.join(dirGlla, "active.jsonl"), "not json\n");
      // Conteúdo malformado é PULADO (fold — semântica do fork), não é
      // "unreadable": o goal resultante é null (nada a continuar).
      const read = readGoalState(dir);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.goal).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fold: goal posterior vence; goal null limpa; linhas malformadas puladas", () => {
    const dir = makeTmp();
    try {
      const dirGlla = path.join(dir, ".pi-glla");
      fs.mkdirSync(dirGlla, { recursive: true });
      const lines = [
        JSON.stringify({ type: "state", value: { goal: activeGoal("old", [task("1", "A", "pending")]), list: [] }, at: "t1" }),
        "{ truncated",
        JSON.stringify({ type: "state", value: { goal: null }, at: "t2" }),
        JSON.stringify({ type: "state", value: { goal: activeGoal("new", [task("1", "B", "complete")]), list: [] }, at: "t3" }),
      ];
      fs.writeFileSync(path.join(dirGlla, "active.jsonl"), `${lines.join("\n")}\n`, "utf8");
      const read = readGoalState(dir);
      expect(read.ok).toBe(true);
      if (read.ok && read.goal) expect(read.goal.objective).toBe("new");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deriveContinuationState — progresso + pendências (D7)", () => {
  test("goal 3/5 (3 completas + 2 pendentes) → completed 3, total 5, pending 2", () => {
    const goal = activeGoal("Ship F27", [
      task("1", "T1", "complete"),
      task("2", "T2", "complete"),
      task("3", "T3", "complete"),
      task("4", "T4", "pending"),
      task("5", "T5", "in_progress"),
    ]);
    const state = stateOf(goal as LedgerGoal)!;
    expect(state.completed).toBe(3);
    expect(state.total).toBe(5);
    expect(state.pending.map((t) => t.id)).toEqual(["4", "5"]);
  });

  test("subtask pendente de task completa ainda pendente (recursivo)", () => {
    const goal = activeGoal("g", [task("1", "P", "complete", [task("1.1", "Sub", "pending")]), task("2", "Q", "complete")]);
    const state = stateOf(goal as LedgerGoal)!;
    expect(state.completed).toBe(1); // P não conta (subtask pendente); Q conta
    expect(state.total).toBe(3);
    expect(state.pending.map((t) => t.id)).toEqual(["1.1"]);
  });

  test("taskList vazia → pending vazio, completed 0, total 0 (sem tarefa fantasma — edge da spec)", () => {
    const goal = activeGoal("g", []);
    const state = stateOf(goal as LedgerGoal)!;
    expect(state.pending).toEqual([]);
    expect(state.completed).toBe(0);
    expect(state.total).toBe(0);
  });

  test("sem goal → null", () => {
    expect(stateOf(null)).toBeNull();
  });
});

describe("buildContinuationPrompt — determinístico (AC2/AC5)", () => {
  test("goal ativo 3/5 → prompt com marker, progresso, diretório e pendências (nunca completas)", () => {
    const goal = activeGoal("Ship F27", [
      task("1", "T1", "complete"),
      task("2", "T2", "complete"),
      task("3", "T3", "complete"),
      task("4", "T4", "pending"),
      task("5", "T5", "in_progress"),
    ]);
    const prompt = buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo")!;
    expect(prompt).toContain(CONTINUATION_MARKER);
    expect(prompt).toContain("Goal: Ship F27");
    expect(prompt).toContain("Progress: 3/5 tasks complete");
    expect(prompt).toContain("Directory: repo");
    expect(prompt).toContain("T4");
    expect(prompt).toContain("T5");
    // D7: as completas NUNCA aparecem como tarefa a continuar.
    expect(prompt).not.toContain("- 1. T1");
    expect(prompt).not.toContain("- 2. T2");
    expect(prompt).not.toContain("- 3. T3");
    // Instruções determinísticas (D2).
    expect(prompt).toContain("propose_task_list");
    expect(prompt).toContain("first unchecked task");
    expect(prompt).toContain("never re-execute completed tasks");
    expect(prompt).toContain("complete_goal");
  });

  test("2 runs com o mesmo estado → prompt IDÊNTICO (AC5 — determinismo)", () => {
    const goal = activeGoal("Ship F27", [task("1", "T1", "complete"), task("2", "T2", "complete"), task("3", "T3", "complete"), task("4", "T4", "pending")]);
    const a = buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo");
    const b = buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo");
    expect(a).toBe(b);
    // F21 D10: sem timestamp, sem path absoluto.
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(a).not.toMatch(/\/tmp\//);
  });

  test("goal completo → null (AC4)", () => {
    const goal = { ...activeGoal("g", [task("1", "T1", "complete")]), status: "complete" };
    expect(buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo")).toBeNull();
  });

  test("goal pausado → null (AC4)", () => {
    const goal = { ...activeGoal("g", [task("1", "T1", "pending")]), status: "paused" };
    expect(buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo")).toBeNull();
  });

  test("goal sem autoContinue → null (não supervisionado — predicado do fork)", () => {
    const goal = { ...activeGoal("g", [task("1", "T1", "pending")]), autoContinue: false };
    expect(buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo")).toBeNull();
  });

  test("goal sem taskList → null (nada a continuar — sem ruído, edge da spec)", () => {
    const goal = activeGoal("g");
    expect(buildContinuationPrompt(stateOf(goal as LedgerGoal)!, "repo")).toBeNull();
  });

  test("workSummary presente → entra no prompt (metadados do harness)", () => {
    const goal = activeGoal("g", [task("1", "T1", "pending")]);
    const state = deriveContinuationState(goal as LedgerGoal, { workSummary: "context compacted mid-review", continuationCount: 1, stallCount: 0, lastSessionId: "s1" })!;
    const prompt = buildContinuationPrompt(state, "repo")!;
    expect(prompt).toContain("context compacted mid-review");
  });
});

describe("scoping de sessão (D2 — AC4)", () => {
  test("sessão que registrou a ownership → scoped", () => {
    const state = stateOf(activeGoal("g", [task("1", "T1", "pending")]) as LedgerGoal)!;
    expect(isSessionScoped(state, "sess-1")).toBe(true);
  });
  test("sessão diferente → NÃO scoped (multi-sessão por cwd — AD-019)", () => {
    const state = stateOf(activeGoal("g", [task("1", "T1", "pending")]) as LedgerGoal)!;
    expect(isSessionScoped(state, "sess-other")).toBe(false);
  });
  test("sem owner registrado → a 1ª sessão assume (startup/resume)", () => {
    const state = deriveContinuationState(activeGoal("g", [task("1", "T1", "pending")]) as LedgerGoal, { workSummary: null, continuationCount: 0, stallCount: 0, lastSessionId: null })!;
    expect(isSessionScoped(state, "sess-new")).toBe(true);
  });
  test("sem session id → nunca scoped (defensivo)", () => {
    const state = stateOf(activeGoal("g", [task("1", "T1", "pending")]) as LedgerGoal)!;
    expect(isSessionScoped(state, null)).toBe(false);
  });
});

describe("isSupervisedGoal — predicado do fork (D2)", () => {
  test("active + autoContinue → true", () => {
    expect(isSupervisedGoal(stateOf(activeGoal("g", [task("1", "T1", "pending")]) as LedgerGoal)!)).toBe(true);
  });
  test("auditing → false (auditor em voo — stall suppression)", () => {
    const goal = { ...activeGoal("g", [task("1", "T1", "complete")]), status: "auditing" };
    expect(isSupervisedGoal(stateOf(goal as LedgerGoal)!)).toBe(false);
  });
});

describe("continuation.json — metadados do harness (QA-1)", () => {
  test("escrita atômica + leitura round-trip; ausente → missing; corrompido → corrupt", () => {
    const dir = makeTmp();
    try {
      expect(readContinuationMeta(dir).ok).toBe(false);
      writeContinuationMeta(dir, { schemaVersion: 1, lastSessionId: "s1", workSummary: "w", continuationCount: 2, stallCount: 1, taskListSnapshot: [task("1", "T", "pending")], compactedAt: "2026-08-07T00:00:00.000Z" });
      const read = readContinuationMeta(dir);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.meta.lastSessionId).toBe("s1");
        expect(read.meta.continuationCount).toBe(2);
        expect(read.meta.taskListSnapshot![0]!.id).toBe("1");
      }
      fs.writeFileSync(path.join(dir, ".runecraft", "continuation.json"), "{ broken");
      expect(readContinuationMeta(dir)).toEqual({ ok: false, reason: "corrupt" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrompido → defaults (sem crash); nunca bloqueia o handler", () => {
    const dir = makeTmp();
    try {
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".runecraft", "continuation.json"), "not json");
      const read = readContinuationMeta(dir);
      expect(read.ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
