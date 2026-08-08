// memory/client.ts — abertura do SQLite via bun:sqlite (port de db/client.ts
// do runes — org própria, MIT; AD-002). SEM fallback node:sqlite: o runtime
// do harness é Bun (D1 — documentado; bun:sqlite verificado no Execute).
//
// Pragmas do source: journal_mode = WAL (leitores concorrentes + escritor
// serializado — D4), foreign_keys = ON, busy_timeout = 5000; retry de
// abertura 1×/100ms (semântica db/client.ts). Falha persistente → throw com
// hint de doctor (fail-closed: o caller decide não registrar tools).
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { runMigrations } from "./migrations.ts";

export type { Database };

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
export function openDatabase(dataDir: string, options: OpenDatabaseOptions = {}): Database {
	const { retryCount = 1, retryDelayMs = 100 } = options;
	const dbPath = join(dataDir, "runes.db");

	let lastError: unknown = null;
	for (let attempt = 0; attempt <= retryCount; attempt++) {
		try {
			const db = new Database(dbPath);
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
