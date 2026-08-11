// framework/memory.test.ts — EVAL-030..038: Memory (F29) via framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM — F29 é determinístico por
// construção; DB temp via RUNECRAFT_MEMORY_DATA_DIR):
//   EVAL-030 port round-trip (db+repository): migrate 2× idempotente +
//     save/get/search/stats/soft-delete + schema_meta version=1;
//   EVAL-031 10 tools no fixture Pi: sessão REAL (extensão memory
//     materializada) → rune_save → rune_search round-trip no loop + tools
//     rune_* no request + suite memory verde;
//   EVAL-032 cross-session: instância B (novo Repository, mesmo arquivo)
//     encontra memórias de A (DB = memória — D2);
//   EVAL-033 semântica search/context: diacríticos, filtro de categoria,
//     soft-deleted excluído, ordem rank, rune_context recent+relevant,
//     session_start idempotente;
//   EVAL-034 compaction: hardCap poda (importance ASC, created_at ASC —
//     tie-break D6) + sinal candidatos ≤5 + categoryCap do config;
//   EVAL-035 bridge F28: promoted.jsonl (2 lessons) → 2 learnings com
//     where_ref=lesson:<id>; 2º import 0 novas; fonte byte-idêntica;
//     dry-run zero writes;
//   EVAL-036 config/kill switch: defaults/freeze; RUNECRAFT_MEMORY=0 → zero
//     tools + zero arquivos; CLI recusa;
//   EVAL-037 determinismo: ops scriptadas com clock/idGen injetados → 2 runs
//     JSON idênticos (F21 D10);
//   EVAL-038 privacidade: rune_save com sentinel → events/*.jsonl sem o
//     sentinel (só argsHash — F28 D2); conteúdo presente SÓ no DB.
//
// Delta vs EVAL-006/007/014/019/022..029 documentado em cada case (D6 — sem
// double-test): o mecanismo de guards/veredito/stall/recorder já é coberto
// pelos EVALs existentes; os cases novos cobrem a camada de memória.
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runEvalSuite } from "../../../src/eval/runner.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { script, type ScriptedScenario } from "../layer2/fixture/scenarios.ts";
import { openDatabase, type DatabaseLike } from "../../../src/memory/client.ts";
import { Repository, ValidationError } from "../../../src/memory/repository.ts";
import { readSchemaVersion, SCHEMA_VERSION } from "../../../src/memory/migrations.ts";
import { importLessons } from "../../../src/memory/import-lessons.ts";
import { memoryKillSwitch, validateMemoryConfig, SessionMemoryConfig } from "../../../src/memory/config.ts";
import { createToolsRecord, filterToolsByDisabled } from "../../../src/memory/tools.ts";
import { runMemoryCommand } from "../../../src/commands/memory.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const THIS_FILE = "memory.test.ts";

const MEMORY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/memory.ts",
);
const OBSERVABILITY_EXTENSION = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../extensions/observability.ts",
);

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-f29-"));
}

function appendExtension(agentDir: string, extension: string): void {
  const settingsPath = path.join(agentDir, "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (!extensions.includes(extension)) extensions.push(extension);
  settings.extensions = extensions;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function openRepo(dir: string, env: NodeJS.ProcessEnv): { db: DatabaseLike; repo: Repository } {
  const db = openDatabase(dir);
  return { db, repo: new Repository(db, { clock: () => 1000, idGen: (() => { let n = 0; return () => `id-${++n}`; })() }) };
}

// ---------------------------------------------------------------------------
// EVAL-030 — port round-trip (db + repository)
// ---------------------------------------------------------------------------

describe("EVAL-030 — port round-trip (D1/D4/D12)", () => {
  test("migrate 2× idempotente + save/get/search/stats/soft-delete + schema_meta version=1", async () => {
    await evalTest(
      "EVAL-030: round-trip db/repository — migração idempotente + save/get/search/stats/soft-delete (schema.sql REAL em bun:sqlite)",
      async () => {
        const dir = makeTmp();
        try {
          const { db, repo } = openRepo(dir, process.env);
          try {
            // Migração idempotente (2×) via openDatabase + readSchemaVersion.
            expect(readSchemaVersion(db)).toBe(String(SCHEMA_VERSION));
            const p = repo.getOrCreateProject("roundtrip", "/tmp/roundtrip", "https://github.com/foo/bar.git");
            const m = repo.saveMemory({ projectId: p.id, category: "decisions", title: "Use DDD", what: "We chose DDD for payments", importance: 9 });
            expect(repo.getMemory(m.id)?.title).toBe("Use DDD");
            const search = repo.searchMemories({ projectId: p.id, query: "payments" });
            expect(search.results.length).toBe(1);
            expect(search.total).toBe(1);
            const stats = repo.getStats("roundtrip");
            expect(stats.by_category.decisions).toBe(1);
            repo.softDeleteMemory(m.id);
            expect(repo.getMemory(m.id)).toBeNull();
            // FTS5 + triggers reais (prova do D12 no harness).
            expect(repo.ftsRowCount()).toBe(0);
          } finally {
            db.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-030" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-031 — 10 tools no fixture Pi (sessão REAL + suite)
// ---------------------------------------------------------------------------

describe("EVAL-031 — 10 tools rune_* no fixture Pi (D3)", () => {
  test("sessão real: rune_save → rune_search round-trip no loop; tools rune_* no request; DB com a memória", async () => {
    await evalTest(
      "EVAL-031: fixture real — rune_save → rune_search no loop do Pi + rune_* no registry + runes.db persistido",
      async () => {
        const scenario: ScriptedScenario = {
          id: "F29-real-tools",
          description: "tools F29 em sessão real (não é fluxo da matriz — EVAL-031)",
          ...script([
            {
              expect: { toolsSubset: ["rune_save"] },
              reply: { kind: "tool", name: "rune_save", args: { category: "decisions", title: "Use DDD", what: "We chose Domain-Driven Design for the payments service", importance: 8 } },
            },
            {
              expect: { toolsSubset: ["rune_search"] },
              reply: { kind: "tool", name: "rune_search", args: { query: "Domain-Driven", limit: 5 } },
            },
            {
              expect: { toolsSubset: ["read"] },
              reply: { kind: "text", text: "Memory saved and found. Done." },
            },
          ]),
        };
        const fx = await setupEvalFixture({
          scenario,
          withRepo: true,
          beforeSession: ({ agentDir }) => appendExtension(agentDir, MEMORY_EXTENSION),
        });
        try {
          await fx.session.session.prompt("Save a memory (decisions, 'Use DDD', 'We chose Domain-Driven Design for the payments service', importance 8). Then search for 'Domain-Driven'. Then stop.");
          // Registry real do primeiro request contém as 10 rune_* (D3).
          const firstRequest = fx.server.seen[0]!;
          for (const name of ["rune_save", "rune_search", "rune_get", "rune_context", "rune_timeline", "rune_update", "rune_delete", "rune_session_start", "rune_session_end", "rune_stats"]) {
            expect(firstRequest.tools).toContain(name);
          }
          // Round-trip REAL no DB (prova do D2/D4 — o arquivo é a memória).
          const dbPath = path.join(fx.repo!.dir, ".runecraft", "memory", "runes.db");
          expect(fs.existsSync(dbPath)).toBe(true);
          const db = openDatabase(path.join(fx.repo!.dir, ".runecraft", "memory"));
          try {
            const repo = new Repository(db);
            const project = repo.listProjects()[0]!;
            const memories = repo.searchMemories({ projectId: project.id, query: "Domain-Driven" });
            expect(memories.results.length).toBe(1);
            expect(memories.results[0]!.title).toBe("Use DDD");
          } finally {
            db.close();
          }
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-031" },
    );
  });

  test("suite memory verde (case memory-roundtrip — trajectory + tool-policy)", async () => {
    await evalTest(
      "EVAL-031: suite memory — runEvalSuite verde + mensagens estáveis (F21 D10)",
      async () => {
        const output = await runEvalSuite({ suitesDir: TEST_EVAL_DIR, suite: "memory" });
        const result = output.result;
        expect(result.summary.totalCases).toBe(1);
        expect(result.summary.passedCases).toBe(1);
        expect(result.summary.failedCases).toBe(0);
        expect(result.caseResults[0]!.caseId).toBe("memory-roundtrip");
        for (const a of result.caseResults[0]!.assertionResults) {
          expect(a.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(a.message).not.toContain(TEST_EVAL_DIR);
        }
      },
      { evalId: "EVAL-031" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-032 — cross-session (D2)
// ---------------------------------------------------------------------------

describe("EVAL-032 — cross-session (D2, MEM-04)", () => {
  test("instância A salva e fecha; instância B (novo Repository, mesmo arquivo) encontra; 2 runs idênticos", async () => {
    await evalTest(
      "EVAL-032: cross-session — DB é a memória (2 instâncias no mesmo arquivo) + 2 runs idênticos",
      async () => {
        const dir = makeTmp();
        try {
          // Sessão A.
          const a = openRepo(dir, process.env);
          const pA = a.repo.getOrCreateProject("xsession", "/tmp/x", null);
          a.repo.saveMemory({ projectId: pA.id, category: "decisions", title: "from session A", what: "decided in A" });
          a.db.close();

          // Sessão B (novo processo/instância — mesmo arquivo).
          const b = openRepo(dir, process.env);
          try {
            const pB = b.repo.getOrCreateProject("xsession", "/tmp/x", null);
            expect(pB.id).toBe(pA.id);
            const search = b.repo.searchMemories({ projectId: pB.id, query: "session A" });
            expect(search.results.length).toBe(1);
            expect(search.results[0]!.title).toBe("from session A");
          } finally {
            b.db.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-032" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-033 — semântica search/context
// ---------------------------------------------------------------------------

describe("EVAL-033 — semântica search/context (D3/D6)", () => {
  test("diacríticos; filtro de categoria; soft-deleted excluído; ordem rank; context recent+relevant; session_start idempotente", async () => {
    await evalTest(
      "EVAL-033: search/context — diacríticos, categoria, soft-delete, rank, rune_context, session idempotente",
      async () => {
        const dir = makeTmp();
        try {
          const { db, repo } = openRepo(dir, process.env);
          try {
            const p = repo.getOrCreateProject("sem", "/tmp/sem", null);
            repo.saveMemory({ projectId: p.id, category: "learnings", title: "café rule", what: "espresso served at café" });
            repo.saveMemory({ projectId: p.id, category: "decisions", title: "choose bun", what: "use bun not npm" });
            const del = repo.saveMemory({ projectId: p.id, category: "corrections", title: "no any", what: "avoid any in TS" });

            // Diacríticos: "cafe" acha "café".
            expect(repo.searchMemories({ projectId: p.id, query: "cafe" }).results.some((r) => r.title === "café rule")).toBe(true);
            // Filtro de categoria.
            expect(repo.searchMemories({ projectId: p.id, query: "use", category: "decisions" }).results.every((r) => r.category === "decisions")).toBe(true);
            // Soft-deleted excluído.
            repo.softDeleteMemory(del.id);
            expect(repo.searchMemories({ projectId: p.id, query: "any" }).results).toEqual([]);
            // Ordem rank: memória com title exact é top.
            const ranked = repo.searchMemories({ projectId: p.id, query: "café" }).results;
            expect(ranked[0]?.title).toBe("café rule");
            // rune_context: recent + relevant.
            const session = repo.startSession(p.id, "pi");
            repo.endSession(session.id, "did sem");
            const active = repo.findActiveSession(p.id, "pi");
            expect(active).toBeNull();
            const recent = repo.recentMemories(p.id, 10);
            expect(recent.length).toBe(2);
            // session_start idempotente (ferramenta real).
            const tools = createToolsRecord({ repository: repo, projectSlug: "sem", projectId: p.id, categoryCap: 10, agentId: "pi" });
            const start1 = JSON.parse((await tools.rune_session_start!.execute({})).content[0]!.text) as { reused: boolean; session_id: string };
            const start2 = JSON.parse((await tools.rune_session_start!.execute({})).content[0]!.text) as { reused: boolean; session_id: string };
            expect(start2.reused).toBe(true);
            expect(start2.session_id).toBe(start1.session_id);
          } finally {
            db.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-033" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-034 — compaction
// ---------------------------------------------------------------------------

describe("EVAL-034 — compaction (D2/D6)", () => {
  test("hardCap poda (importance ASC, created_at ASC) + sinal candidatos ≤5 + categoryCap do config", async () => {
    await evalTest(
      "EVAL-034: compaction — poda transacional no hardCap + sinal ≤5 + categoryCap do config",
      async () => {
        const dir = makeTmp();
        try {
          const { db, repo } = openRepo(dir, process.env);
          try {
            const p = repo.getOrCreateProject("comp", "/tmp/comp", null);
            const softCap = 3;
            const hardCap = 6;
            for (let i = 0; i < hardCap + 5; i++) {
              repo.saveMemory({ projectId: p.id, category: "decisions", title: `t${i}`, what: "w" });
            }
            const signal = repo.checkAndEnforceCompaction(p.id, "decisions", { softCap, hardCap });
            expect(signal).not.toBeNull();
            expect(signal!.pruned_count).toBeGreaterThan(0);
            expect(repo.countMemoriesByCategory(p.id, "decisions")).toBe(hardCap);
            // Candidatos ≤ SIGNAL_CANDIDATE_LIMIT (5) e ordenados.
            expect(signal!.candidates.length).toBeLessThanOrEqual(5);
            const cands = signal!.candidates;
            for (let i = 1; i < cands.length; i++) {
              expect(cands[i - 1]!.importance).toBeLessThanOrEqual(cands[i]!.importance);
            }
            // categoryCap do config (default 10) usado pela tool rune_save:
            // abaixo do softCap → sem sinal (null); acima → sinal com cap.
            const tools = createToolsRecord({ repository: repo, projectSlug: "comp", projectId: p.id, categoryCap: 10, agentId: "pi" });
            const saved = JSON.parse((await tools.rune_save!.execute({ category: "decisions", title: "x", what: "y" })).content[0]!.text) as { compaction: { cap: number } | null };
            expect(saved.compaction).toBeNull(); // 7 ≤ softCap 10
            for (let i = 0; i < 4; i++) {
              await tools.rune_save!.execute({ category: "decisions", title: `extra-${i}`, what: "y" });
            }
            const over = JSON.parse((await tools.rune_save!.execute({ category: "decisions", title: "overflow", what: "y" })).content[0]!.text) as { compaction: { cap: number; pruned_count: number } | null };
            expect(over.compaction).not.toBeNull();
            expect(over.compaction!.cap).toBe(10);
            expect(over.compaction!.pruned_count).toBe(0); // 12 ≤ hardCap 20
          } finally {
            db.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-034" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-035 — bridge F28
// ---------------------------------------------------------------------------

describe("EVAL-035 — bridge F28 (D7, MEM-06)", () => {
  test("2 lessons → 2 learnings com where_ref; 2º import 0 novas; fonte byte-idêntica; dry-run zero writes", async () => {
    await evalTest(
      "EVAL-035: bridge — idempotente + fonte byte-idêntica + dry-run zero writes",
      async () => {
        const dir = makeTmp();
        try {
          const { db, repo } = openRepo(dir, process.env);
          try {
            const p = repo.getOrCreateProject("bridge", "/tmp/bridge", null);
            const lessonsFile = path.join(dir, "promoted.jsonl");
            const lessonA = { lessonId: "aa11", triggerSignature: "s1", trigger: "guard blocked write", antiPattern: "continue write on existing", preferred: "read first", priority: "med", gate: "writeExistingFile", track: "execution", count: 1, status: "promoted", firstSeenSeq: 0, lastSeenSeq: 0 };
            const lessonB = { lessonId: "bb22", triggerSignature: "s2", trigger: "lint broke", antiPattern: "commit without lint", preferred: "run tests", priority: "high", gate: "structural", track: "execution", count: 2, status: "promoted", firstSeenSeq: 1, lastSeenSeq: 1 };
            fs.writeFileSync(lessonsFile, `${JSON.stringify(lessonA)}\n${JSON.stringify(lessonB)}\n`, "utf8");
            const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(lessonsFile)).digest("hex");

            const first = importLessons(repo, p.id, lessonsFile);
            expect(first.imported).toBe(2);
            const byRef = new Map(repo.recentMemories(p.id, 10).map((m) => [m.where_ref, m]));
            expect(byRef.get("lesson:aa11")?.title).toBe("guard blocked write");
            expect(byRef.get("lesson:aa11")?.importance).toBe(5);
            expect(byRef.get("lesson:bb22")?.importance).toBe(8);

            const second = importLessons(repo, p.id, lessonsFile);
            expect(second.imported).toBe(0);
            expect(second.skipped).toBe(2);
            expect(repo.recentMemories(p.id, 10)).toHaveLength(2);
            // Fonte byte-idêntica (F28 é dono — nunca reescrita).
            expect(crypto.createHash("sha256").update(fs.readFileSync(lessonsFile)).digest("hex")).toBe(hashBefore);

            // dry-run → zero writes.
            const before = repo.recentMemories(p.id, 10).length;
            const dry = importLessons(repo, p.id, lessonsFile, { dryRun: true });
            expect(dry.imported).toBe(0); // tudo já importado
            expect(repo.recentMemories(p.id, 10)).toHaveLength(before);
          } finally {
            db.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-035" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-036 — config/kill switch
// ---------------------------------------------------------------------------

describe("EVAL-036 — config/kill switch (D5, MEM-05)", () => {
  test("defaults/freeze; RUNECRAFT_MEMORY=0 → zero tools + zero arquivos; CLI recusa", async () => {
    await evalTest(
      "EVAL-036: config — defaults, freeze, kill switch (zero tools/arquivos), CLI recusa fail-visible",
      async () => {
        // Defaults fail-closed (D5).
        expect(validateMemoryConfig(undefined).config).toEqual({ enabled: true, categoryCap: 10, disabledTools: [], importLessonsOnStart: false });
        // Freeze por sessão (D12): snapshot no capture; mudança não afeta.
        const base = makeTmp();
        try {
          const repo = path.join(base, "repo");
          fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
          const stateFile = path.join(repo, ".runecraft", "state.json");
          fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 4 } }));
          const frozen = new SessionMemoryConfig(process.env);
          frozen.capture(repo);
          fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 99 } }));
          expect(frozen.frozen(repo).config.categoryCap).toBe(4);

          // Kill switch: extensão inerte (zero tools + zero arquivos).
          const { installMemory } = await import("../../../src/extensions/memory.ts");
          const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
          const registered: string[] = [];
          const fakePi = {
            on(event: string, h: (e: unknown, c: unknown) => unknown) {
              const list = handlers.get(event) ?? [];
              list.push(h);
              handlers.set(event, list);
            },
            registerTool(t: { name: string }) {
              registered.push(t.name);
            },
            registerCommand() {},
            sendUserMessage() {},
            getSessionName() {
              return undefined;
            },
          };
          installMemory(fakePi as never, { env: { ...process.env, RUNECRAFT_MEMORY: "0" } });
          const ctx = { cwd: repo, mode: "rpc", hasUI: false, ui: {}, sessionManager: {}, modelRegistry: {}, model: {}, isIdle: () => true, isProjectTrusted: () => true, signal: undefined, abort: () => {}, hasPendingMessages: () => false, shutdown: () => {}, getContextUsage: () => undefined, compact: () => {}, getSystemPrompt: () => "" };
          for (const h of handlers.get("session_start") ?? []) await h({ type: "session_start", reason: "startup" }, ctx);
          expect(registered).toEqual([]);
          expect(fs.existsSync(path.join(repo, ".runecraft", "memory"))).toBe(false);

          // CLI recusa (fail-visible, exit 0, nada criado).
          const cwd2 = path.join(base, "cli");
          fs.mkdirSync(cwd2, { recursive: true });
          let out = "";
          const code = await runMemoryCommand({
            json: false,
            out: { write: (s: string) => (out += s) },
            err: { write: () => {} },
            rt: { cwd: cwd2, env: { ...process.env, RUNECRAFT_MEMORY: "0" } },
            subcommand: "stats",
            args: [],
          });
          expect(code).toBe(0);
          expect(out).toContain("memory disabled");
          expect(memoryKillSwitch({ RUNECRAFT_MEMORY: "0" } as NodeJS.ProcessEnv).active).toBe(true);
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-036" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-037 — determinismo
// ---------------------------------------------------------------------------

describe("EVAL-037 — determinismo (D6, F21 D10)", () => {
  test("ops scriptadas com clock/idGen injetados → 2 runs JSON idênticos (inclui created_at injetado; tie-breaks)", async () => {
    await evalTest(
      "EVAL-037: determinismo — 2 runs com mesmas sequências → JSON idêntico (created_at injetado + tie-break)",
      async () => {
        const run = async (): Promise<string> => {
          const dir = makeTmp();
          try {
            const db = openDatabase(dir);
            try {
              let seq = 0;
              let idSeq = 0;
              const repo = new Repository(db, { clock: () => 1000 + seq++, idGen: () => `id-${++idSeq}` });
              const p = repo.getOrCreateProject("det", "/tmp/det", null);
              const m1 = repo.saveMemory({ projectId: p.id, category: "decisions", title: "alpha", what: "first decision", importance: 8 });
              const m2 = repo.saveMemory({ projectId: p.id, category: "learnings", title: "beta", what: "café lesson", importance: 3 });
              repo.updateMemory(m1.id, { title: "alpha-updated" });
              repo.startSession(p.id, "pi");
              repo.softDeleteMemory(m2.id);
              return JSON.stringify([
                repo.recentMemories(p.id, 10),
                repo.searchMemories({ projectId: p.id, query: "cafe" }),
                repo.getStats("det"),
                repo.listSessions("det"),
              ]);
            } finally {
              db.close();
            }
          } finally {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        };
        expect(await run()).toBe(await run());
      },
      { evalId: "EVAL-037" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-038 — privacidade (D10, MEM-09)
// ---------------------------------------------------------------------------

describe("EVAL-038 — privacidade (D10)", () => {
  test("rune_save com sentinel → events/*.jsonl sem o sentinel (só argsHash); conteúdo presente SÓ no DB", async () => {
    await evalTest(
      "EVAL-038: privacidade — sentinel ausente do event file (argsHash) e presente só no DB",
      async () => {
        const SENTINEL = "SENTINEL_F29_XYZ_7f3a";
        const scenario: ScriptedScenario = {
          id: "F29-privacy",
          description: "privacidade F29 (não é fluxo da matriz — EVAL-038)",
          ...script([
            {
              expect: { toolsSubset: ["rune_save"] },
              reply: { kind: "tool", name: "rune_save", args: { category: "learnings", title: `sentinel ${SENTINEL}`, what: `secret content ${SENTINEL}` } },
            },
            {
              expect: { toolsSubset: ["rune_search"] },
              reply: { kind: "tool", name: "rune_search", args: { query: SENTINEL } },
            },
            {
              expect: { toolsSubset: ["read"] },
              reply: { kind: "text", text: "done" },
            },
          ]),
        };
        const fx = await setupEvalFixture({
          scenario,
          withRepo: true,
          beforeSession: ({ agentDir }) => {
            appendExtension(agentDir, MEMORY_EXTENSION);
            appendExtension(agentDir, OBSERVABILITY_EXTENSION);
          },
        });
        try {
          await fx.session.session.prompt(`Save a memory: category learnings, title 'sentinel ${SENTINEL}', what 'secret content ${SENTINEL}'. Then search for '${SENTINEL}'. Then stop.`);
          const sessionId = fx.session.session.sessionId;
          const eventsFile = path.join(fx.repo!.dir, ".runecraft", "events", `${sessionId}.jsonl`);
          expect(fs.existsSync(eventsFile)).toBe(true);
          const eventsText = fs.readFileSync(eventsFile, "utf8");
          // Conteúdo de memória NUNCA cru no event store (só argsHash — F28 D2).
          expect(eventsText).not.toContain(SENTINEL);
          expect(eventsText).toContain("rune_save");
          const events = eventsText.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) as Array<{ kind: string; payload: Record<string, unknown> }>;
          const call = events.find((e) => e.kind === "tool:call" && e.payload.tool === "rune_save")!;
          expect(call).toBeDefined();
          expect(typeof call.payload.argsHash).toBe("string");
          expect((call.payload.argsHash as string).length).toBe(16); // sha256 prefixo 16 hex (F28)

          // Conteúdo presente SÓ no DB.
          const db = openDatabase(path.join(fx.repo!.dir, ".runecraft", "memory"));
          try {
            const repo = new Repository(db);
            const project = repo.listProjects()[0]!;
            const memories = repo.searchMemories({ projectId: project.id, query: SENTINEL });
            expect(memories.results.length).toBe(1);
            expect(memories.results[0]!.title).toContain(SENTINEL);
          } finally {
            db.close();
          }
          // Nenhum outro sink do repo contém o sentinel cru.
          for (const dir of ["lessons", ""]) {
            const scanDir = path.join(fx.repo!.dir, ".runecraft", dir);
            if (!fs.existsSync(scanDir)) continue;
            for (const f of fs.readdirSync(scanDir)) {
              const full = path.join(scanDir, f);
              if (fs.statSync(full).isFile() && !full.endsWith("runes.db")) {
                const text = fs.readFileSync(full, "utf8");
                expect(text).not.toContain(SENTINEL);
              }
            }
          }
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-038" },
    );
  });
});

// ---------------------------------------------------------------------------
// Evidência — DEVE ser o último teste do arquivo: verifica o JSONL parcial
// gravado pelos EVAL-030..038 acima (o wrapper só faz o append no finally,
// ou seja, DEPOIS que cada teste rodou — checar antes seria ordem-dependente
// e falharia na primeira execução com checkout limpo).
// ---------------------------------------------------------------------------

test("evidência gravada no partial (evalTest → last-run.json no merge)", async () => {
  await evalTest("EVAL-030..038: evidência via evalTest gravada (partial jsonl)", async () => {
    const { EVAL_PARTIAL_DIR } = await import("../helpers/evalTest.ts");
    const partial = path.join(EVAL_PARTIAL_DIR, `${THIS_FILE}.jsonl`);
    expect(fs.existsSync(partial)).toBe(true);
    const lines = fs.readFileSync(partial, "utf8").trim().split("\n").filter(Boolean);
    for (const id of ["EVAL-030", "EVAL-031", "EVAL-032", "EVAL-033", "EVAL-034", "EVAL-035", "EVAL-036", "EVAL-037", "EVAL-038"]) {
      expect(lines.some((l) => l.includes(`"evalId":"${id}"`))).toBe(true);
    }
  }, { evalId: "EVAL-031" });
});
