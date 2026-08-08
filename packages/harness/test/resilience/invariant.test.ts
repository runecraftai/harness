// resilience/invariant.test.ts — invariante F24 (T8, RES-07/D7) — regressão AD-024.
//
// O bug AD-024 (phantom-block deadlock): uma taskList OBSOLETA de goal
// anterior no ledger bloqueia o complete_goal do goal atual com tarefas
// fantasma que o agente não consegue limpar. F27 é quem introduz a re-injeção
// de tarefas — a invariante vira teste adversarial:
//   1. a continuação re-injeta pendências SÓ do taskList ATUAL do ledger;
//   2. re-injetar uma task JÁ COMPLETADA → o prompt NÃO a contém (e o teste
//      falha com diagnóstico se contiver);
//   3. taskList obsoleta de goal anterior → não é re-injetada nem bloqueia;
//   4. o payload de restore respeita o formato v1 (todo-continuation-enforcer
//      do F24 roda sem drift).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContinuationPrompt, deriveContinuationState, readGoalState } from "../../src/resilience/continuation.ts";
import { restorePayload } from "../../src/resilience/todo-preserver.ts";
import { readGllaTaskList, collectPendingTasks } from "../../src/guards/todo-writer.ts";
import type { ContinuationTask } from "../../src/resilience/types.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resilience-invariant-"));
}

function task(id: string, title: string, status: string): ContinuationTask {
  return { id, title, status };
}

/** Ledger com goal A (antigo, arquivado, com pendências fantasmas) e goal B
 *  (atual, ativo, 3/5 — 3 completas + 2 pendentes). O shape é o validado no
 *  F24 (todo-guards.test.ts) e no fork (goal-loop-core.ts). */
function writePhantomLedger(cwd: string): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const goalA = {
    status: "archived",
    id: "gA",
    objective: "old goal",
    autoContinue: false,
    taskList: { version: 1, tasks: [task("1", "Phantom pending from goal A", "pending")] },
  };
  const goalB = {
    status: "active",
    id: "gB",
    objective: "Ship F27",
    autoContinue: true,
    taskList: {
      version: 1,
      tasks: [
        task("1", "T1", "complete"),
        task("2", "T2", "complete"),
        task("3", "T3", "complete"),
        task("4", "T4", "pending"),
        task("5", "T5", "in_progress"),
      ],
    },
  };
  const lines = [
    JSON.stringify({ type: "state", value: { goal: goalA, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" }),
    JSON.stringify({ type: "state", value: { goal: goalB, list: [], loop: null }, at: "2026-08-07T00:00:01.000Z" }),
  ];
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

const META = { workSummary: null, continuationCount: 0, stallCount: 0, lastSessionId: "s1" };

describe("AD-024 — phantom-block deadlock NUNCA volta (D7)", () => {
  test("continuação deriva pendências SÓ do taskList ATUAL (goal B); as do goal A não aparecem", () => {
    const dir = makeTmp();
    try {
      writePhantomLedger(dir);
      const read = readGoalState(dir);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const state = deriveContinuationState(read.goal, META)!;
      expect(state.goalId).toBe("gB");
      expect(state.pending.map((t) => t.id)).toEqual(["4", "5"]);
      const prompt = buildContinuationPrompt(state, "repo")!;
      expect(prompt).toContain("T4");
      expect(prompt).toContain("T5");
      // Diagnóstico adversarial: a task fantasma do goal A NUNCA é re-injetada.
      expect(prompt).not.toContain("Phantom pending from goal A");
      expect(prompt).not.toContain("- 1. T1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ADVERSARIAL: re-injeção de task JÁ COMPLETADA → prompt NÃO a contém (teste vermelho com diagnóstico)", () => {
    const dir = makeTmp();
    try {
      writePhantomLedger(dir);
      const read = readGoalState(dir);
      if (!read.ok) return;
      const state = deriveContinuationState(read.goal, META)!;
      const prompt = buildContinuationPrompt(state, "repo")!;

      // Invariante: nenhuma task completa (1/2/3) pode aparecer como pendente.
      for (const completed of ["T1", "T2", "T3"]) {
        const leaked = prompt.includes(`- ${completed}`) || /Pending tasks[\s\S]*-\s*\d+\.\s*T[123]/.test(prompt);
        if (leaked) {
          throw new Error(
            `DIAGNÓSTICO (AD-024): a continuação re-injetou a task completa "${completed}" — pendências devem derivar SÓ do ledger atual (unchecked). Prompt: ${prompt}`,
          );
        }
      }
      expect(prompt).toContain("Progress: 3/5 tasks complete");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("o enforcer F24 (readGllaTaskList) vê o mesmo ledger sem fantasmas — sem bloqueio fantasma", () => {
    const dir = makeTmp();
    try {
      writePhantomLedger(dir);
      // Mesma leitura do enforcer (todo-writer.ts): o folding reseta a taskList
      // quando o goal atual não a tem (fix cleric F24) — aqui o goal B TEM a
      // lista; as pendências são exatamente 4/5 (nada do goal A).
      const read = readGllaTaskList(dir);
      expect(read.ok).toBe(true);
      if (read.ok && read.tasks) {
        const pending = collectPendingTasks(read.tasks);
        expect(pending.map((p) => p.split(" ")[0])).toEqual(["4", "5"]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("restorePayload respeita o formato v1 (todo-continuation-enforcer sem drift)", () => {
    const dir = makeTmp();
    try {
      writePhantomLedger(dir);
      const read = readGoalState(dir);
      if (!read.ok) return;
      const state = deriveContinuationState(read.goal, META)!;
      const payload = restorePayload(state);
      // Formato do propose_task_list do glla: { tasks: [{ title }] } — títulos
      // apenas (o tool valida/renumera ids). Nada de id/status no payload.
      expect(Array.isArray(payload.tasks)).toBe(true);
      for (const t of payload.tasks) {
        expect(typeof t.title).toBe("string");
        expect(Object.keys(t)).toEqual(["title"]);
      }
      expect(payload.tasks.map((t) => t.title)).toEqual(["T4", "T5"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("goal atual SEM taskList após goal com pendências → continuação null (sem fantasma; enforcer passa)", () => {
    const dir = makeTmp();
    try {
      const dirGlla = path.join(dir, ".pi-glla");
      fs.mkdirSync(dirGlla, { recursive: true });
      const goalA = { status: "archived", id: "gA", objective: "old", taskList: { version: 1, tasks: [task("1", "Phantom", "pending")] } };
      const goalB = { status: "active", id: "gB", objective: "new", autoContinue: true };
      const lines = [
        JSON.stringify({ type: "state", value: { goal: goalA, list: [], loop: null }, at: "t1" }),
        JSON.stringify({ type: "state", value: { goal: goalB, list: [], loop: null }, at: "t2" }),
      ];
      fs.writeFileSync(path.join(dirGlla, "active.jsonl"), `${lines.join("\n")}\n`, "utf8");

      const read = readGoalState(dir);
      if (!read.ok) return;
      const state = deriveContinuationState(read.goal, META)!;
      expect(state.taskList).toBeNull();
      expect(buildContinuationPrompt(state, "repo")).toBeNull(); // nada a continuar
      // Enforcer: sem taskList → sem pendência → complete_goal passa (sem deadlock).
      const enforcer = readGllaTaskList(dir);
      expect(enforcer.ok).toBe(true);
      if (enforcer.ok) expect(enforcer.tasks).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
