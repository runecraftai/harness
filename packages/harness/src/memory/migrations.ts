// memory/migrations.ts — migração idempotente do schema v1 (port de
// db/migrations.ts do runes). SCHEMA_VERSION=1.
//
// O schema.sql é executado AS-IS (IF NOT EXISTS → idempotente) e a versão é
// upsertada em schema_meta (mesma tabela do source). A resolução do schema
// usa caminho relativo ao módulo com fallback para a árvore src/ (mesma
// estratégia do loadSchema do source).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseLike } from "./client.ts";

// SCHEMA_VERSION=2: adds `memories.imported_from` (lesson-revocation fix —
// distinguishes bridge-owned rows from user memories that collide on
// `where_ref`, see import-lessons.ts). schema.sql already declares the
// column for fresh databases; the ALTER TABLE below is only needed to
// backfill a database created under v1 (CREATE TABLE IF NOT EXISTS does not
// retrofit existing tables).
export const SCHEMA_VERSION = 2;

function hasImportedFromColumn(db: DatabaseLike): boolean {
	const columns = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
	return columns.some((c) => c.name === "imported_from");
}

function readIfExists(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

/** Localiza o schema.sql relativo ao módulo (dev: src/memory/schema.sql). */
export function loadSchema(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "schema.sql"),
		join(here, "..", "..", "src", "memory", "schema.sql"),
	];
	for (const path of candidates) {
		const content = readIfExists(path);
		if (content !== null) return content;
	}
	throw new Error("memory: could not locate schema.sql");
}

/** Executa o schema + upsert da versão — idempotente (2× → mesmo resultado). */
export function runMigrations(db: DatabaseLike): void {
	db.exec(loadSchema());
	if (!hasImportedFromColumn(db)) {
		db.exec("ALTER TABLE memories ADD COLUMN imported_from TEXT");
	}
	db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
	db.prepare(
		"INSERT INTO schema_meta (key, value) VALUES ('version', ?) " +
			"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(String(SCHEMA_VERSION));
}

/** Lê a versão do schema_meta (null quando ausente — DB não migrado). */
export function readSchemaVersion(db: DatabaseLike): string | null {
	try {
		const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as
			| { value: string }
			| undefined;
		return row?.value ?? null;
	} catch {
		return null;
	}
}
