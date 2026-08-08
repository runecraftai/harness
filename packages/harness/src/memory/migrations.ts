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

export const SCHEMA_VERSION = 1;

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
