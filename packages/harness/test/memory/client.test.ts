// test/memory/client.test.ts — T1 (MEM-01): openDatabase em arquivo temp →
// WAL; migrações 2× idempotentes (schema_meta version=1); schema.sql REAL
// executa (FTS5 + triggers + round-trip save/match/soft-delete — espelho do
// probe D12); zero deps novas (só bun:sqlite + node builtins).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, selectDriver, type DatabaseLike } from "../../src/memory/client.ts";
import { runMigrations, readSchemaVersion, SCHEMA_VERSION } from "../../src/memory/migrations.ts";
import { loadSchema } from "../../src/memory/migrations.ts";

let sandbox = "";
let db: DatabaseLike;

beforeEach(() => {
	sandbox = join(tmpdir(), `f29-client-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(sandbox, { recursive: true });
});

afterEach(() => {
	try {
		db?.close();
	} catch {
		// já fechado
	}
	rmSync(sandbox, { recursive: true, force: true });
});

describe("selectDriver (F35, SQL-04)", () => {
	test("bun:sqlite disponível → driver bun", () => {
		class FakeDb {
			exec(): void {}
			prepare(): never {
				throw new Error("unused");
			}
			close(): void {}
		}
		const load = (id: string): unknown => {
			if (id === "bun:sqlite") return { Database: FakeDb };
			throw new Error(`no such module: ${id}`);
		};
		const driver = selectDriver(load);
		expect(driver.name).toBe("bun");
		expect(driver.open(":memory:")).toBeInstanceOf(FakeDb);
	});

	test("bun:sqlite falha → fallback node:sqlite", () => {
		class FakeSync {
			exec(): void {}
			prepare(): never {
				throw new Error("unused");
			}
			close(): void {}
		}
		const load = (id: string): unknown => {
			if (id === "node:sqlite") return { DatabaseSync: FakeSync };
			throw new Error(`no such module: ${id}`);
		};
		const driver = selectDriver(load);
		expect(driver.name).toBe("node");
		expect(driver.open(":memory:")).toBeInstanceOf(FakeSync);
	});

	test("ambos falham → throw com hint de doctor", () => {
		const load = (): never => {
			throw new Error("no such built-in module");
		};
		expect(() => selectDriver(load)).toThrow(/no SQLite driver available/);
	});
});

	describe("openDatabase (MEM-01)", () => {
	test("abre em arquivo temp com WAL + foreign_keys + busy_timeout", () => {
		db = openDatabase(sandbox);
		const jm = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
		expect(jm.journal_mode).toBe("wal");
		const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
		expect(fk.foreign_keys).toBe(1);
		// bun:sqlite expõe o pragma busy_timeout na coluna `timeout`.
		const bt = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
		expect(bt.timeout).toBe(5000);
	});

	test("cria o arquivo runes.db", () => {
		db = openDatabase(sandbox);
		expect(existsSync(join(sandbox, "runes.db"))).toBe(true);
	});

	test("retry de abertura: 1×/100ms (semântica db/client.ts)", () => {
		// O retry só dispara em falha; com dir válido abre de primeira.
		db = openDatabase(sandbox, { retryCount: 1, retryDelayMs: 1 });
		expect(db).toBeDefined();
	});

	test("falha persistente → throw com hint de doctor", () => {
		const badDir = join(sandbox, "nonexistent-deep", "nested");
		// Diretório não existe → bun:sqlite falha; openDatabase não cria dirs.
		expect(() => openDatabase(badDir, { retryCount: 0 })).toThrow(/harness memory doctor/);
	});
});

describe("migrations idempotentes (D4)", () => {
	test("schema_meta version = 1 após a abertura", () => {
		db = openDatabase(sandbox);
		expect(readSchemaVersion(db)).toBe(String(SCHEMA_VERSION));
	});

	test("runMigrations 2× → mesmo resultado (IF NOT EXISTS + upsert)", () => {
		db = openDatabase(sandbox);
		runMigrations(db);
		runMigrations(db);
		expect(readSchemaVersion(db)).toBe("1");
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'memories%' ORDER BY name")
			.all() as Array<{ name: string }>;
		const names = tables.map((t) => t.name).sort();
		expect(names).toContain("memories");
		expect(names).toContain("memories_fts");
		expect(names).toContain("memories_ai");
		expect(names).toContain("memories_ad");
		expect(names).toContain("memories_au");
		expect(names).toContain("memories_soft_delete_au");
	});
});

describe("schema.sql REAL (D12 — espelho do probe)", () => {
	test("round-trip save → FTS match → soft-delete remove do índice", () => {
		db = openDatabase(sandbox);
		db.prepare(
			"INSERT INTO projects (slug, root_path, remote_url, created_at) VALUES (?, ?, ?, ?)",
		).run("probe", "/tmp/probe", null, 1);
		db.prepare(
			"INSERT INTO memories (id, project_id, category, title, what, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		).run("m1", 1, "learnings", "café test", "remember the café", 1000, 1000);
		db.prepare(
			"INSERT INTO memories (id, project_id, category, title, what, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		).run("m2", 1, "decisions", "other", "unrelated", 1001, 1001);

		// FTS5 com diacríticos: "cafe" e "café" matcheiam.
		const match = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?").all('"cafe"') as Array<{ rowid: number }>;
		expect(match.map((r) => r.rowid)).toEqual([1]);
		const matchAccent = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?").all('"café"') as Array<{ rowid: number }>;
		expect(matchAccent.map((r) => r.rowid)).toEqual([1]);

		// Soft-delete → trigger remove do índice FTS.
		db.prepare("UPDATE memories SET soft_deleted = 1, updated_at = ? WHERE id = ?").run(2000, "m1");
		const after = db.prepare("SELECT COUNT(*) AS c FROM memories_fts").get() as { c: number };
		expect(after.c).toBe(1);
	});

	test("FK enforcement: memória com project inexistente falha", () => {
		db = openDatabase(sandbox);
		expect(() =>
			db
				.prepare(
					"INSERT INTO memories (id, project_id, category, title, what, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.run("m1", 999, "decisions", "t", "w", 1, 1),
		).toThrow();
	});
});

describe("loadSchema", () => {
	test("localiza o schema.sql relativo ao módulo", () => {
		const sql = loadSchema();
		expect(sql).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5");
		expect(sql).toContain("tokenize='unicode61 remove_diacritics 2'");
		expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS memories_soft_delete_au");
	});
});
