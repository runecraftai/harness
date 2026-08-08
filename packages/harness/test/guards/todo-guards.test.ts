// guards/todo-guards.test.ts — EVAL-007: todo guards (GUARD-04/05).
//
// (a) unit: override (descrição livre → input canônico "Done when"; idempotente)
//     e enforcer (ledger fake: pendência bloqueia com reason listando itens;
//     tudo done passa; disabled passa; ledger ausente passa);
// (b) integração EVAL-007: sessão Pi REAL com o fixture — `propose_task_list`
//     com input reescrito (ledger guarda os títulos canônicos → a reescrita é
//     REAL, o tool executou com o input reescrito), `complete_goal` com
//     pendências BLOQUEADO (reason no transcript), tudo done → conclui.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setupEvalFixture, type EvalFixture } from "../eval/helpers/evalFixture.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";
import { waitForCondition } from "../eval/helpers/wait.ts";
import { EVAL_007 } from "../eval/layer2/fixture/scenarios.ts";
import { canonicalizeTodoTitle, collectPendingTasks, readGllaTaskList, type GllaTodoTask } from "../../src/guards/todo-writer.ts";
import { rewriteTodoInput } from "../../src/guards/todo-description-override.ts";
import { decideTodoEnforcer } from "../../src/guards/todo-continuation-enforcer.ts";
import type { GuardRuntime } from "../../src/guards/guardKit.ts";

function enforcerRuntime(partial: Partial<GuardRuntime> = {}): GuardRuntime {
  return { id: "todoContinuationEnforcer", enabled: true, valid: true, options: {}, source: "default", ...partial };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guards-todo-"));
}

/** Escreve um ledger fake no formato validado do glla (.pi-glla/active.jsonl). */
function writeLedger(cwd: string, tasks: GllaTodoTask[] | null, status = "active"): void {
  const dir = path.join(cwd, ".pi-glla");
  fs.mkdirSync(dir, { recursive: true });
  const goal: Record<string, unknown> = { status, id: "g1", objective: "obj" };
  if (tasks !== null) goal.taskList = { version: 1, tasks };
  const line = JSON.stringify({ type: "state", value: { goal, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "active.jsonl"), `${line}\n`, "utf8");
}

function task(id: string, title: string, status: string, subtasks?: GllaTodoTask[]): GllaTodoTask {
  return { id, title, status, ...(subtasks ? { subtasks } : {}) };
}

describe("todo-description-override — unit (T4)", () => {
  test("descrição livre → input reescrito para o formato canônico (AC 3.1)", () => {
    expect(canonicalizeTodoTitle("Implement the write guard")).toBe(
      "Implement the write guard — Done when: Implement the write guard is complete and verified",
    );
  });

  test("input já canônico → inalterado (idempotente)", () => {
    const canonical = "Implement X — Done when: tests pass";
    expect(canonicalizeTodoTitle(canonical)).toBe(canonical);
    expect(canonicalizeTodoTitle("done WHEN: x")).toBe("done WHEN: x"); // case-insensitive
  });

  test("rewriteTodoInput reescreve titles e subtasks in-place", () => {
    const input = { tasks: [{ title: "Create notes.txt", subtasks: ["Write content", "Verify content"] }, { title: "Update README — Done when: README updated" }] };
    rewriteTodoInput(input);
    expect(input.tasks[0]!.title).toContain("— Done when:");
    expect(input.tasks[0]!.subtasks![0]).toContain("— Done when:");
    expect(input.tasks[0]!.subtasks![1]).toContain("— Done when:");
    expect(input.tasks[1]!.title).toBe("Update README — Done when: README updated");
  });

  test("rewriteTodoInput tolera input malformado (sem crash)", () => {
    for (const bad of [{}, { tasks: "nope" }, { tasks: [null, 42, { title: 7 }] }]) {
      const input = bad as { tasks?: unknown };
      rewriteTodoInput(input);
    }
    // Nada foi lançado — e um input válido continua sendo reescrito depois.
    const input = { tasks: [{ title: "Do it" }] };
    rewriteTodoInput(input);
    expect(input.tasks[0]!.title).toContain("Done when");
  });
});

describe("todo-continuation-enforcer — unit com ledger fake (T5)", () => {
  test("pendência → block com reason listando os itens (AC 3.2)", () => {
    const dir = makeTmp();
    try {
      writeLedger(dir, [task("1", "Create notes.txt", "pending"), task("2", "Update README", "in_progress")]);
      const decision = decideTodoEnforcer(enforcerRuntime(), dir);
      expect(decision).toBeDefined();
      expect(decision!.reason.startsWith("todo-continuation-enforcer: ")).toBe(true);
      expect(decision!.reason).toContain("Create notes.txt");
      expect(decision!.reason).toContain("Update README");
      // D3: sem path absoluto, sem timestamp.
      expect(decision!.reason).not.toContain(dir);
      expect(decision!.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("subtasks pendentes contam (id hierárquico no reason — complete_task usa id)", () => {
    const dir = makeTmp();
    try {
      writeLedger(dir, [task("1", "Parent done", "complete", [task("1.1", "Sub pending", "pending")]), task("2", "Other", "complete")]);
      const decision = decideTodoEnforcer(enforcerRuntime(), dir);
      expect(decision).toBeDefined();
      expect(decision!.reason).toContain("1.1 (Sub pending)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tudo done → passa (AC 3.3)", () => {
    const dir = makeTmp();
    try {
      writeLedger(dir, [task("1", "A", "complete"), task("2", "B", "complete")]);
      expect(decideTodoEnforcer(enforcerRuntime(), dir)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sem taskList / ledger ausente / linhas malformadas → passa (nada a cobrar)", () => {
    const dir = makeTmp();
    try {
      writeLedger(dir, null); // goal sem taskList
      expect(decideTodoEnforcer(enforcerRuntime(), dir)).toBeUndefined();

      const empty = makeTmp();
      try {
        expect(decideTodoEnforcer(enforcerRuntime(), empty)).toBeUndefined(); // ledger ausente
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }

      // Linhas malformadas (truncamento mid-write) não derrubam a dobra.
      writeLedger(dir, [task("1", "A", "pending")]);
      const ledger = path.join(dir, ".pi-glla", "active.jsonl");
      fs.appendFileSync(ledger, "{ truncated\n", "utf8");
      const read = readGllaTaskList(dir);
      expect(read.ok).toBe(true);
      if (read.ok && read.tasks) expect(collectPendingTasks(read.tasks)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("goal sem taskList após goal com pendências → não cobra lista obsoleta (fix cleric F24)", () => {
    const dir = makeTmp();
    try {
      const dirGlla = path.join(dir, ".pi-glla");
      fs.mkdirSync(dirGlla, { recursive: true });
      // Goal A (aborted/archived — o fork arquiva a lista junto) mantém
      // taskList com pendências no ledger; goal B (atual — createGoal do
      // fork NÃO inclui taskList) vem depois sem ela.
      const goalA = {
        status: "archived",
        id: "gA",
        objective: "old",
        taskList: { version: 1, tasks: [task("1", "Phantom pending", "pending")] },
      };
      const goalB = { status: "active", id: "gB", objective: "new" };
      const lines = [
        JSON.stringify({ type: "state", value: { goal: goalA, list: [], loop: null }, at: "2026-08-07T00:00:00.000Z" }),
        JSON.stringify({ type: "state", value: { goal: goalB, list: [], loop: null }, at: "2026-08-07T00:00:01.000Z" }),
      ];
      fs.writeFileSync(path.join(dirGlla, "active.jsonl"), `${lines.join("\n")}\n`, "utf8");

      const read = readGllaTaskList(dir);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.tasks).toBeNull(); // reset — nada a cobrar do goal anterior
      expect(decideTodoEnforcer(enforcerRuntime(), dir)).toBeUndefined(); // sem deadlock
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("guard disabled → não intervém (AC 3.4)", () => {
    const dir = makeTmp();
    try {
      writeLedger(dir, [task("1", "A", "pending")]);
      expect(decideTodoEnforcer(enforcerRuntime({ enabled: false }), dir)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EVAL-007 — todo guards no loop do Pi (camada 2)", () => {
  test("EVAL-007: override reescreve input; enforcer bloqueia conclusão com pendências; tudo done → conclui", async () => {
    await evalTest("EVAL-007: override reescreve input; enforcer bloqueia conclusão com pendências; tudo done → conclui", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_007,
        withRepo: true,
        beforeSession: ({ repoDir }) => {
          // O propose_task_list do glla abre Confirm; autoAcceptDrafts pula o diálogo
          // (settings do fork — formato validado no Execute: .pi-glla/settings.json).
          fs.mkdirSync(path.join(repoDir, ".pi-glla"), { recursive: true });
          fs.writeFileSync(path.join(repoDir, ".pi-glla", "settings.json"), JSON.stringify({ autoAcceptDrafts: true }));
        },
      });
      try {
        const repoDir = fx.repo!.dir;
        const ledger = path.join(repoDir, ".pi-glla", "active.jsonl");

        await fx.session.session.prompt(
          '/goal start Create a file notes.txt whose content is exactly "hello todo". Done when: notes.txt exists in the repo root with the exact content',
        );

        // O fluxo completou (auditor aprovou → goal_archived no ledger).
        const archived = await waitForCondition(
          () => fs.existsSync(ledger) && fs.readFileSync(ledger, "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived (EVAL-007)" },
        );
        expect(archived).toBe(true);

        // (1) Override REAL: o tool executou com o input reescrito — o ledger
        // guarda os títulos canônicos "Done when" (a reescrita não é sugestão).
        const ledgerText = fs.readFileSync(ledger, "utf8");
        expect(ledgerText).toContain("Create notes.txt — Done when: Create notes.txt is complete and verified");
        expect(ledgerText).toContain("Update README — Done when: Update README is complete and verified");

        // (2) Enforcer REAL: o complete_goal com pendências foi BLOQUEADO — o
        // reason apareceu no transcript (validação do fixture no passo 4 +
        // prova explícita aqui).
        const conversations = fx.server.seen.map((s) => s.conversationText).join("\n");
        expect(conversations).toContain("todo-continuation-enforcer:");
        expect(conversations).toContain("Create notes.txt — Done when");

        // (3) Efeito real: o write do fluxo executou e o goal concluiu depois
        // de completar todas as tarefas.
        expect(fs.readFileSync(path.join(repoDir, "notes.txt"), "utf8")).toBe("hello todo");
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-007" });
  });
});
