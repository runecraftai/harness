// memory/client.ts — abertura do SQLite com driver duplo (F35, SQL-01):
// bun:sqlite no runtime Bun (testes/eval), node:sqlite (DatabaseSync) no
// runtime Node — o runtime de produção do pi. A superfície usada pelo
// harness é idêntica nos dois drivers (exec + prepare().get/all/run), então
// o adaptador é uma interface mínima. FTS5 verificado nos dois (node v26.5).
//
// Pragmas do source: journal_mode = WAL (leitores concorrentes + escritor
// serializado — D4), foreign_keys = ON, busy_timeout = 5000; retry de
// abertura 1×/100ms (semântica db/client.ts). Falha persistente → throw com
// hint de doctor (fail-closed: o caller decide não registrar tools).
import { createRequire } from "node:module";
import { join } from "node:path";
import { runMigrations } from "./migrations.ts";

const require = createRequire(import.meta.url);

// Type-only re-export (erasure total — sem runtime import): tipa o driver bun
// onde o código SABE que roda em bun (testes). O runtime nunca carrega o módulo.
export type { Database } from "bun:sqlite";

/** Statement comum aos dois drivers (bun Statement / node StatementSync). */
export interface StatementLike {
	get(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
	run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/** Superfície usada pelo harness nos dois drivers (F35, SQL-02). */
export interface DatabaseLike {
	exec(sql: string): void;
	prepare(sql: string): StatementLike;
	close(): void;
}

export interface SqliteDriver {
	name: "bun" | "node";
	open(path: string): DatabaseLike;
}

/**
 * Seleciona o driver SQLite (injetável para testes — SQL-04). Ordem:
 * bun:sqlite (Bun) → node:sqlite (Node — produção). Ambos ausentes → throw
 * com hint (o caller decide: fail-closed, nunca registra tools).
 */
export function selectDriver(load: (id: string) => unknown): SqliteDriver {
	try {
		const mod = load("bun:sqlite") as {
			Database: new (path: string) => DatabaseLike;
		};
		return { name: "bun", open: (path) => new mod.Database(path) };
	} catch {
		try {
			const mod = load("node:sqlite") as {
				DatabaseSync: new (path: string) => DatabaseLike;
			};
			return { name: "node", open: (path) => new mod.DatabaseSync(path) };
		} catch (error) {
			throw new Error(
				"memory: no SQLite driver available (bun:sqlite and node:sqlite both failed). " +
					"Run `harness memory doctor` for diagnostics.",
				{ cause: error },
			);
		}
	}
}

let cachedDriver: SqliteDriver | null = null;

/** Driver ativo, resolvido lazy (import do módulo nunca throwa — SQL-01). */
export function getDriver(): SqliteDriver {
	return (cachedDriver ??= selectDriver((id) => require(id)));
}

export interface OpenDatabaseOptions {
	retryCount?: number;
	retryDelayMs?: number;
}

/** Sleep síncrono curto entre retries (spin — mesma abordagem do source). */
function spinUntil(deadline: number): void {
	while (Date.now() < deadline) {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
	}
}

/**
 * Abre (ou cria) runes.db em dataDir com WAL + FK + busy_timeout e roda as
 * migrações. Retry 1×/100ms por default (port). Nunca cria o dir — o caller
 * garante (ensureMemoryDir).
 */
export function openDatabase(dataDir: string, options: OpenDatabaseOptions = {}): DatabaseLike {
	const { retryCount = 1, retryDelayMs = 100 } = options;
	const dbPath = join(dataDir, "runes.db");

	let lastError: unknown = null;
	for (let attempt = 0; attempt <= retryCount; attempt++) {
		try {
			const db = getDriver().open(dbPath);
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA foreign_keys = ON");
			db.exec("PRAGMA busy_timeout = 5000");
			runMigrations(db);
			return db;
		} catch (error) {
			lastError = error;
			if (attempt < retryCount) spinUntil(Date.now() + retryDelayMs);
		}
	}
	throw new Error(
		`memory: could not open database at ${dbPath}. ` +
			"Run `harness memory doctor` for diagnostics. " +
			`Underlying error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
}
