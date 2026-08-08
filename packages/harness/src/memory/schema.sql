-- Runes schema v1. Idempotent (use IF NOT EXISTS everywhere).
--
-- Port AS-IS do schema v1 do pacote runes do arcanum (org própria, MIT —
-- AD-002; fonte: /home/rehem/Projects/arcanum/packages/runes/src/db/schema.sql).
-- F29 (harness memory) não altera o schema: FTS5 + triggers + índices são o
-- contrato verificado empiricamente em bun:sqlite (D12). Migrações futuras
-- são ADITIVAS (novas tabelas/colunas + bump de SCHEMA_VERSION — política F13).

CREATE TABLE IF NOT EXISTS projects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	slug TEXT NOT NULL UNIQUE,
	root_path TEXT NOT NULL,
	remote_url TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	agent TEXT NOT NULL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	summary TEXT
);

CREATE INDEX IF NOT EXISTS sessions_project_started_idx
	ON sessions (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS memories (
	rowid INTEGER PRIMARY KEY AUTOINCREMENT,
	id TEXT NOT NULL UNIQUE,
	project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	category TEXT NOT NULL,
	title TEXT NOT NULL,
	what TEXT NOT NULL,
	why TEXT,
	where_ref TEXT,
	learned TEXT,
	importance INTEGER NOT NULL DEFAULT 5,
	soft_deleted INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_id_idx ON memories (id);
CREATE INDEX IF NOT EXISTS memories_project_idx
	ON memories (project_id, soft_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS memories_category_idx
	ON memories (project_id, category, soft_deleted, importance DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
	id UNINDEXED,
	project_id UNINDEXED,
	title,
	what,
	why,
	where_ref,
	learned,
	tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
	INSERT INTO memories_fts (rowid, id, project_id, title, what, why, where_ref, learned)
	VALUES (new.rowid, new.id, new.project_id, new.title, new.what, new.why, new.where_ref, new.learned);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
	DELETE FROM memories_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories
WHEN new.soft_deleted = 0
BEGIN
	DELETE FROM memories_fts WHERE rowid = old.rowid;
	INSERT INTO memories_fts (rowid, id, project_id, title, what, why, where_ref, learned)
	VALUES (new.rowid, new.id, new.project_id, new.title, new.what, new.why, new.where_ref, new.learned);
END;

CREATE TRIGGER IF NOT EXISTS memories_soft_delete_au AFTER UPDATE ON memories
WHEN new.soft_deleted = 1 AND old.soft_deleted = 0
BEGIN
	DELETE FROM memories_fts WHERE rowid = old.rowid;
END;
