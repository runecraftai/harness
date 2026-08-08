// test/memory/cli.test.ts — T6 (MEM-07): search/stats/doctor com DB temp
// (RUNECRAFT_MEMORY_DATA_DIR); drift induzido → doctor reporta; --purge
// corrige (counts iguais); exit codes; kill switch recusa sem criar arquivo;
// import-lessons via dispatch.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchMemoryCli, renderDoctor, renderSearchTable, renderStats, runDoctor, truncate } from "../../src/memory/cli.ts";
import { openDatabase, type DatabaseLike } from "../../src/memory/client.ts";
import { importLessons } from "../../src/memory/import-lessons.ts";
import { Repository } from "../../src/memory/repository.ts";
import { runMemoryCommand } from "../../src/commands/memory.ts";

let sandbox = "";
let db: DatabaseLike;
let repo: Repository;
let projectId: number;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	sandbox = join(tmpdir(), `f29-cli-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(sandbox, { recursive: true });
	const memoryDir = join(sandbox, "mem");
	mkdirSync(memoryDir, { recursive: true });
	env = { ...process.env, RUNECRAFT_MEMORY_DATA_DIR: memoryDir };
	db = openDatabase(memoryDir);
	repo = new Repository(db);
	projectId = repo.getOrCreateProject("cli-slug", sandbox, "https://github.com/foo/cli.git").id;
});

afterEach(() => {
	try {
		db.close();
	} catch {
		// já fechado
	}
	rmSync(sandbox, { recursive: true, force: true });
});

function memRepo(): Repository {
	return repo;
}

function opts(): Parameters<typeof dispatchMemoryCli>[1] & { projectId: number; importLessonsFile: string; importFn: typeof importLessons } {
	return {
		projectId,
		importLessonsFile: join(sandbox, "promoted.jsonl"),
		importFn: importLessons,
	};
}

describe("dispatchMemoryCli — search", () => {
	test("markdown table com matches ordenados (port cmdSearch)", () => {
		repo.saveMemory({ projectId, category: "decisions", title: "Use DDD for payments", what: "chosen DDD" });
		repo.saveMemory({ projectId, category: "learnings", title: "Never commit without tests", what: "tests first" });
		const result = dispatchMemoryCli(memRepo(), opts(), "search", ["commit"]);
		expect(result.code).toBe(0);
		expect(result.text).toContain("| # | project | category | title | created_at |");
		expect(result.text).toContain("cli-slug");
		expect(result.text).toContain("learnings");
	});

	test("sem query → exit 2; sem matches → 'no matches' exit 0", () => {
		expect(dispatchMemoryCli(memRepo(), opts(), "search", []).code).toBe(2);
		const none = dispatchMemoryCli(memRepo(), opts(), "search", ["xyzzy-nomatch"]);
		expect(none.code).toBe(0);
		expect(none.text).toBe("no matches\n");
	});
});

describe("dispatchMemoryCli — stats", () => {
	test("contagens por categoria + grand total (port cmdStats)", () => {
		repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		repo.saveMemory({ projectId, category: "corrections", title: "c", what: "z" });
		const result = dispatchMemoryCli(memRepo(), opts(), "stats", []);
		expect(result.code).toBe(0);
		expect(result.text).toContain("# cli-slug");
		expect(result.text).toContain("total: 3");
		expect(result.text).toContain("decisions: 2");
		expect(result.text).toContain("corrections: 1");
		expect(result.text).toContain("grand total: 3");
	});
});

describe("dispatchMemoryCli — doctor", () => {
	test("saudável → healthy exit 0; drift → exit 1; --purge corrige → exit 0", () => {
		repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		const healthy = dispatchMemoryCli(memRepo(), opts(), "doctor", []);
		expect(healthy.code).toBe(0);
		expect(healthy.text).toContain("memory: healthy");

		// Drift induzido: delete direto de linha do índice FTS.
		db.prepare("DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories LIMIT 1)").run();
		const drift = dispatchMemoryCli(memRepo(), opts(), "doctor", []);
		expect(drift.code).toBe(1);
		expect(drift.text).toContain("Drift detected");

		const purged = dispatchMemoryCli(memRepo(), opts(), "doctor", ["--purge"]);
		expect(purged.code).toBe(0);
		expect(purged.text).toContain("rebuilt memories_fts");
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
	});
});

describe("dispatchMemoryCli — import-lessons", () => {
	test("import idempotente via CLI (2º run → 0 novas)", () => {
		const file = join(sandbox, "promoted.jsonl");
		writeFileSync(file, `${JSON.stringify({ lessonId: "l1", trigger: "t", antiPattern: "a", preferred: "p", priority: "high", gate: "g", track: "execution", count: 1, status: "promoted", firstSeenSeq: 0, lastSeenSeq: 0 })}\n`, "utf8");
		const first = dispatchMemoryCli(memRepo(), opts(), "import-lessons", []);
		expect(first.code).toBe(0);
		expect(first.text).toContain("imported: 1");
		const second = dispatchMemoryCli(memRepo(), opts(), "import-lessons", []);
		expect(second.text).toContain("skipped: 1");
		const dry = dispatchMemoryCli(memRepo(), opts(), "import-lessons", ["--dry-run"]);
		expect(dry.text).toContain("dry-run");
	});
});

describe("render helpers (unit puro)", () => {
	test("truncate 60 chars; formatDate ISO", () => {
		expect(truncate("x".repeat(80), 60)).toBe(`${"x".repeat(57)}...`);
		expect(truncate("short", 60)).toBe("short");
	});

	test("renderDoctor com rebuildResult e drift", () => {
		expect(renderDoctor({ memories: 1, fts: 0, drift: true })).toContain("Drift detected");
		expect(renderDoctor({ memories: 1, fts: 1, drift: false, rebuildResult: { ftsAfter: 1, purged: 2 } })).toContain("purged soft-deleted rows: 2");
	});

	test("renderStats vazio → 'no projects yet'", () => {
		expect(renderStats({ projects: [], grandTotal: 0 })).toBe("no projects yet\n");
	});

	test("renderSearchTable vazio → 'no matches'", () => {
		expect(renderSearchTable([])).toBe("no matches\n");
	});

	test("runDoctor com stub (unit)", () => {
		const stub = { memoriesRowCount: () => 3, ftsRowCount: () => 1, rebuildFts: () => {}, purgeSoftDeleted: () => 1 };
		expect(runDoctor(stub, false).drift).toBe(true);
		expect(runDoctor(stub, true).rebuildResult?.purged).toBe(1);
	});
});

describe("runMemoryCommand — kill switch (F20)", () => {
	test("RUNECRAFT_MEMORY=0 → recusa fail-visible, exit 0, nada criado", async () => {
		const cwd = join(sandbox, "work");
		mkdirSync(cwd, { recursive: true });
		let out = "";
		let err = "";
		const code = await runMemoryCommand({
			json: false,
			out: { write: (s: string) => (out += s) },
			err: { write: (s: string) => (err += s) },
			rt: { cwd, env: { ...env, RUNECRAFT_MEMORY: "0" } },
			subcommand: "stats",
			args: [],
		});
		expect(code).toBe(0);
		expect(out).toContain("memory disabled (RUNECRAFT_MEMORY=0)");
		expect(existsSync(join(cwd, ".runecraft"))).toBe(false);
	});

	test("JSON shape estável (--json)", async () => {
		const cwd = join(sandbox, "work2");
		mkdirSync(cwd, { recursive: true });
		let out = "";
		const code = await runMemoryCommand({
			json: true,
			out: { write: (s: string) => (out += s) },
			err: { write: () => {} },
			rt: { cwd, env },
			subcommand: "stats",
			args: [],
		});
		expect(code).toBe(0);
		const parsed = JSON.parse(out) as { command: string; projects: unknown[] };
		expect(parsed.command).toBe("memory stats");
		expect(Array.isArray(parsed.projects)).toBe(true);
	});
});

describe("adversarial — DB corrompido (fail-closed, sem reset silencioso)", () => {
	test("doctor reporta abertura falha (exit 1) e NÃO reseta o store", async () => {
		const cwd = join(sandbox, "corrupt");
		mkdirSync(join(cwd, ".runecraft", "memory"), { recursive: true });
		// Corrompe o DB com bytes inválidos.
		writeFileSync(join(cwd, ".runecraft", "memory", "runes.db"), "not a sqlite database", "utf8");
		let out = "";
		let err = "";
		const code = await runMemoryCommand({
			json: false,
			out: { write: (s: string) => (out += s) },
			err: { write: (s: string) => (err += s) },
			rt: { cwd, env: { ...process.env, RUNECRAFT_MEMORY: undefined, RUNECRAFT_MEMORY_DATA_DIR: undefined } },
			subcommand: "doctor",
			args: [],
		});
		expect(code).toBe(1);
		expect(err).toContain("não foi possível abrir o store");
		// O arquivo corrompido NÃO foi reescrito/resetado (fail-closed — D1/D5).
		expect(readFileSync(join(cwd, ".runecraft", "memory", "runes.db"), "utf8")).toBe("not a sqlite database");
	});
});

describe("flags globais (parseArgs) — --purge/--dry-run", () => {
	test("harness memory doctor --purge (flag global) corrige drift (paridade com posicional)", async () => {
		// Usa o dispatch real (parseArgs) — o flag global --purge é traduzido
		// para o subcomando doctor no runMemoryCommand.
		const { dispatch } = await import("../../src/cli.ts");
		repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		// Drift induzido.
		db.prepare("DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories LIMIT 1)").run();
		const cwd = join(sandbox, "flagwork");
		mkdirSync(cwd, { recursive: true });
		let out = "";
		let err = "";
		const code = await dispatch(["memory", "doctor", "--purge"], { cwd, env, stdout: { write: (s: string) => (out += s) }, stderr: { write: (s: string) => (err += s) }, isTTY: false });
		expect(code).toBe(0);
		expect(out).toContain("rebuilt memories_fts");
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
	});

	test("harness memory import-lessons --dry-run (flag global) → relatório sem escrever", async () => {
		const { dispatch } = await import("../../src/cli.ts");
		const file = join(sandbox, "promoted.jsonl");
		writeFileSync(file, `${JSON.stringify({ lessonId: "l9", trigger: "t", antiPattern: "a", preferred: "p", priority: "low", gate: "g", track: "execution", count: 1, status: "promoted", firstSeenSeq: 0, lastSeenSeq: 0 })}\n`, "utf8");
		const cwd = join(sandbox, "drywork");
		mkdirSync(cwd, { recursive: true });
		let out = "";
		const code = await dispatch(["memory", "import-lessons", "--dry-run"], { cwd, env, stdout: { write: (s: string) => (out += s) }, stderr: { write: () => {} }, isTTY: false });
		expect(code).toBe(0);
		expect(out).toContain("dry-run");
		expect(repo.getMemoryByWhereRef(projectId, "lesson:l9")).toBeNull();
	});
});
