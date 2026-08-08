// memory/repository.ts — port completo do Repository do runes
// (db/repository.ts — org própria, MIT; AD-002) para bun:sqlite, com as
// adaptações decididas no design:
//
//   D6 (determinismo): DI de relógio/id — `clock: () => number` (default
//     Date.now) e `idGen: () => string` (default randomUUID); evals injetam
//     sequências fixas (F21 D10 — timestamps são payload informacional,
//     nunca identidade). Tie-breaks explícitos em ordenações sem chave total
//     (aditivo determinístico — corrige o bug latente do source):
//       recentMemories            → ORDER BY created_at DESC, rowid DESC
//       selectOldestLowestPriority → ... importance ASC, created_at ASC, rowid ASC
//       listSessions              → ... started_at DESC, id DESC
//   D3 (zero deps): zod → validação manual em validate.ts (MESMOS códigos de
//     erro do source).
//   Compaction: checkAndEnforceCompaction + pruneOldestLowestPriority
//     transacional (BEGIN/COMMIT/ROLLBACK — port fiel).
//
// Semantics do source preservadas: save/search/get/update/soft-delete/
// sessions/stats/recent/rebuild/purge — evals comparam contra fixtures do
// source (EVAL-030/033/034/037).
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { clampImportance, validateSave, validateUpdate, ValidationError } from "./validate.ts";
import {
	type CompactionCandidate,
	type CompactionSignal,
	type Memory,
	type MemoryCategory,
	type Project,
	type Session,
	type Stats,
	MEMORY_CATEGORIES,
} from "./types.ts";

export { ValidationError };

export const DEFAULT_CATEGORY_CAP = 10;
export const HARD_CAP_MULTIPLIER = 2;
export const SIGNAL_CANDIDATE_LIMIT = 5;

export interface RepositoryDeps {
	/** relógio injetável (epoch ms) — determinismo (D6); default Date.now. */
	clock?: () => number;
	/** idGen injetável — determinismo (D6); default randomUUID. */
	idGen?: () => string;
}

export interface SaveMemoryInput {
	projectId: number;
	sessionId?: string | null;
	category: MemoryCategory;
	title: string;
	what: string;
	why?: string | null;
	whereRef?: string | null;
	learned?: string | null;
	importance?: number;
}

export interface SearchMemoryInput {
	projectId: number;
	query: string;
	category?: MemoryCategory;
	limit?: number;
}

export interface UpdateMemoryInput {
	title?: string;
	what?: string;
	why?: string | null;
	whereRef?: string | null;
	learned?: string | null;
	importance?: number;
}

function rowToMemory(row: Record<string, unknown>): Memory {
	return {
		id: row.id as string,
		project_id: row.project_id as number,
		session_id: (row.session_id as string | null) ?? null,
		category: row.category as MemoryCategory,
		title: row.title as string,
		what: row.what as string,
		why: (row.why as string | null) ?? null,
		where_ref: (row.where_ref as string | null) ?? null,
		learned: (row.learned as string | null) ?? null,
		importance: row.importance as number,
		soft_deleted: (row.soft_deleted as 0 | 1) ?? 0,
		created_at: row.created_at as number,
		updated_at: row.updated_at as number,
	};
}

function rowToSession(row: Record<string, unknown>): Session {
	return {
		id: row.id as string,
		project_id: row.project_id as number,
		agent: row.agent as string,
		started_at: row.started_at as number,
		ended_at: (row.ended_at as number | null) ?? null,
		summary: (row.summary as string | null) ?? null,
	};
}

function rowToProject(row: Record<string, unknown>): Project {
	return {
		id: row.id as number,
		slug: row.slug as string,
		root_path: row.root_path as string,
		remote_url: (row.remote_url as string | null) ?? null,
		created_at: row.created_at as number,
	};
}

export class Repository {
	private readonly db: Database;
	private readonly clock: () => number;
	private readonly idGen: () => string;

	constructor(
		db: Database,
		deps: RepositoryDeps = {},
	) {
		this.db = db;
		this.clock = deps.clock ?? Date.now;
		this.idGen = deps.idGen ?? (() => randomUUID());
	}

	getOrCreateProject(slug: string, rootPath: string, remoteUrl: string | null = null): Project {
		const existing = this.db
			.prepare("SELECT * FROM projects WHERE slug = ?")
			.get(slug) as Record<string, unknown> | undefined;
		if (existing) return rowToProject(existing);
		const createdAt = this.clock();
		const result = this.db
			.prepare(
				"INSERT INTO projects (slug, root_path, remote_url, created_at) VALUES (?, ?, ?, ?)",
			)
			.run(slug, rootPath, remoteUrl, createdAt);
		const id = Number(result.lastInsertRowid);
		return { id, slug, root_path: rootPath, remote_url: remoteUrl, created_at: createdAt };
	}

	getProjectBySlug(slug: string): Project | null {
		const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
			| Record<string, unknown>
			| undefined;
		return row ? rowToProject(row) : null;
	}

	startSession(projectId: number, agent: string): Session {
		const id = this.idGen();
		const startedAt = this.clock();
		this.db
			.prepare(
				"INSERT INTO sessions (id, project_id, agent, started_at) VALUES (?, ?, ?, ?)",
			)
			.run(id, projectId, agent, startedAt);
		return { id, project_id: projectId, agent, started_at: startedAt, ended_at: null, summary: null };
	}

	endSession(sessionId: string, summary?: string | null): boolean {
		const endedAt = this.clock();
		const result = this.db
			.prepare("UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?")
			.run(endedAt, summary ?? null, sessionId);
		return Number(result.changes) > 0;
	}

	saveMemory(input: SaveMemoryInput): Memory {
		// Validação manual (D3 — mesmos códigos do source).
		validateSave({ category: input.category, title: input.title, what: input.what, importance: input.importance });
		const id = this.idGen();
		const now = this.clock();
		const importance = clampImportance(input.importance);
		this.db
			.prepare(
				`INSERT INTO memories
				(id, project_id, session_id, category, title, what, why, where_ref, learned, importance, soft_deleted, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
			)
			.run(
				id,
				input.projectId,
				input.sessionId ?? null,
				input.category,
				input.title,
				input.what,
				input.why ?? null,
				input.whereRef ?? null,
				input.learned ?? null,
				importance,
				now,
				now,
			);
		return this.getMemory(id) as Memory;
	}

	searchMemories(input: SearchMemoryInput): { results: Memory[]; total: number } {
		const limit = Math.min(100, Math.max(1, input.limit ?? 20));
		const query = input.query.trim();
		if (query.length === 0) {
			return { results: [], total: 0 };
		}

		const ftsQuery = query.replace(/"/g, '""');
		const categoryFilter = input.category ? "AND m.category = ?" : "";
		const params: Array<string | number> = [`"${ftsQuery}"`, input.projectId];
		if (input.category) {
			params.push(input.category);
		}
		params.push(limit);

		const rows = this.db
			.prepare(
				`SELECT m.* FROM memories m
				 INNER JOIN memories_fts f ON f.rowid = m.rowid
				 WHERE memories_fts MATCH ? AND m.project_id = ? AND m.soft_deleted = 0 ${categoryFilter}
				 ORDER BY rank
				 LIMIT ?`,
			)
			.all(...params) as Record<string, unknown>[];

		const totalRow = this.db
			.prepare(
				`SELECT COUNT(*) AS c FROM memories_fts f
				 INNER JOIN memories m ON m.rowid = f.rowid
				 WHERE memories_fts MATCH ? AND m.project_id = ? AND m.soft_deleted = 0 ${categoryFilter}`,
			)
			.get(
				...(input.category
					? [`"${ftsQuery}"`, input.projectId, input.category]
					: [`"${ftsQuery}"`, input.projectId]),
			) as { c: number };

		return {
			results: rows.map(rowToMemory),
			total: totalRow.c,
		};
	}

	getMemory(id: string): Memory | null {
		const row = this.db
			.prepare("SELECT * FROM memories WHERE id = ? AND soft_deleted = 0")
			.get(id) as Record<string, unknown> | undefined;
		return row ? rowToMemory(row) : null;
	}

	/** Busca por where_ref (chave de idempotência da bridge F28 — D7). */
	getMemoryByWhereRef(projectId: number, whereRef: string): Memory | null {
		const row = this.db
			.prepare(
				"SELECT * FROM memories WHERE project_id = ? AND where_ref = ? AND soft_deleted = 0",
			)
			.get(projectId, whereRef) as Record<string, unknown> | undefined;
		return row ? rowToMemory(row) : null;
	}

	updateMemory(id: string, fields: UpdateMemoryInput): Memory | null {
		const existing = this.db
			.prepare("SELECT id FROM memories WHERE id = ? AND soft_deleted = 0")
			.get(id) as { id: string } | undefined;
		if (!existing) return null;

		validateUpdate({ title: fields.title, what: fields.what });

		const updates: string[] = [];
		const params: Array<string | number | null> = [];

		if (fields.title !== undefined) {
			updates.push("title = ?");
			params.push(fields.title);
		}
		if (fields.what !== undefined) {
			updates.push("what = ?");
			params.push(fields.what);
		}
		if (fields.why !== undefined) {
			updates.push("why = ?");
			params.push(fields.why);
		}
		if (fields.whereRef !== undefined) {
			updates.push("where_ref = ?");
			params.push(fields.whereRef);
		}
		if (fields.learned !== undefined) {
			updates.push("learned = ?");
			params.push(fields.learned);
		}
		if (fields.importance !== undefined) {
			updates.push("importance = ?");
			params.push(clampImportance(fields.importance));
		}

		if (updates.length === 0) return this.getMemory(id);

		updates.push("updated_at = ?");
		params.push(this.clock());
		params.push(id);

		this.db.prepare(`UPDATE memories SET ${updates.join(", ")} WHERE id = ?`).run(...params);
		return this.getMemory(id);
	}

	softDeleteMemory(id: string): { ok: boolean; soft_deleted_at: number | null } {
		const now = this.clock();
		const result = this.db
			.prepare(
				"UPDATE memories SET soft_deleted = 1, updated_at = ? WHERE id = ? AND soft_deleted = 0",
			)
			.run(now, id);
		if (Number(result.changes) === 0) {
			return { ok: false, soft_deleted_at: null };
		}
		return { ok: true, soft_deleted_at: now };
	}

	listSessions(projectSlug: string, limit = 20): Session[] {
		// Tie-break determinístico (D6): started_at DESC, id DESC.
		const rows = this.db
			.prepare(
				`SELECT s.* FROM sessions s
				 INNER JOIN projects p ON p.id = s.project_id
				 WHERE p.slug = ?
				 ORDER BY s.started_at DESC, s.id DESC
				 LIMIT ?`,
			)
			.all(projectSlug, limit) as Record<string, unknown>[];
		return rows.map(rowToSession);
	}

	listProjects(): Project[] {
		const rows = this.db
			.prepare("SELECT * FROM projects ORDER BY created_at DESC, id DESC")
			.all() as Record<string, unknown>[];
		return rows.map(rowToProject);
	}

	searchAllProjects(
		query: string,
		limit = 20,
	): Array<Memory & { project_slug: string }> {
		const ftsQuery = query.replace(/"/g, '""');
		const rows = this.db
			.prepare(
				`SELECT m.*, p.slug AS project_slug FROM memories m
				 INNER JOIN projects p ON p.id = m.project_id
				 INNER JOIN memories_fts f ON f.rowid = m.rowid
				 WHERE memories_fts MATCH ? AND m.soft_deleted = 0
				 ORDER BY rank
				 LIMIT ?`,
			)
			.all(`"${ftsQuery}"`, limit) as Record<string, unknown>[];
		return rows.map((r) => ({
			...rowToMemory(r),
			project_slug: r.project_slug as string,
		}));
	}

	findActiveSession(projectId: number, agent: string): Session | null {
		const row = this.db
			.prepare(
				"SELECT * FROM sessions WHERE project_id = ? AND agent = ? AND ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1",
			)
			.get(projectId, agent) as Record<string, unknown> | undefined;
		return row ? rowToSession(row) : null;
	}

	getStats(projectSlug: string): Stats {
		const rows = this.db
			.prepare(
				`SELECT m.category, COUNT(*) AS c, MAX(m.created_at) AS last
				 FROM memories m
				 INNER JOIN projects p ON p.id = m.project_id
				 WHERE p.slug = ? AND m.soft_deleted = 0
				 GROUP BY m.category`,
			)
			.all(projectSlug) as { category: string; c: number; last: number | null }[];

		const by_category: Record<MemoryCategory, number> = {
			project_rules: 0,
			architecture: 0,
			constraints: 0,
			config_values: 0,
			naming: 0,
			decisions: 0,
			corrections: 0,
			learnings: 0,
		};

		let total = 0;
		let lastActivity: number | null = null;
		for (const r of rows) {
			if (MEMORY_CATEGORIES.includes(r.category as MemoryCategory)) {
				by_category[r.category as MemoryCategory] = r.c;
				total += r.c;
				if (r.last && (lastActivity === null || r.last > lastActivity)) {
					lastActivity = r.last;
				}
			}
		}

		return { total, by_category, last_activity_at: lastActivity };
	}

	recentMemories(projectId: number, limit = 10): Memory[] {
		// Tie-break determinístico (D6): created_at DESC, rowid DESC.
		const rows = this.db
			.prepare(
				"SELECT * FROM memories WHERE project_id = ? AND soft_deleted = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?",
			)
			.all(projectId, limit) as Record<string, unknown>[];
		return rows.map(rowToMemory);
	}

	countMemoriesByCategory(projectId: number, category: MemoryCategory): number {
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS c FROM memories WHERE project_id = ? AND category = ? AND soft_deleted = 0",
			)
			.get(projectId, category) as { c: number };
		return row.c;
	}

	private selectOldestLowestPriority(
		projectId: number,
		category: MemoryCategory,
		limit: number,
	): CompactionCandidate[] {
		// Tie-break determinístico (D6): importance ASC, created_at ASC, rowid ASC.
		const rows = this.db
			.prepare(
				"SELECT id, title, importance, created_at FROM memories WHERE project_id = ? AND category = ? AND soft_deleted = 0 ORDER BY importance ASC, created_at ASC, rowid ASC LIMIT ?",
			)
			.all(projectId, category, limit) as Record<string, unknown>[];
		return rows.map((r) => ({
			id: r.id as string,
			title: r.title as string,
			importance: r.importance as number,
			created_at: r.created_at as number,
		}));
	}

	private pruneOldestLowestPriority(
		projectId: number,
		category: MemoryCategory,
		count: number,
	): number {
		const candidates = this.selectOldestLowestPriority(projectId, category, count);
		if (candidates.length === 0) return 0;

		const now = this.clock();
		const updateStmt = this.db.prepare(
			"UPDATE memories SET soft_deleted = 1, updated_at = ? WHERE id = ? AND soft_deleted = 0",
		);
		const deleteFtsStmt = this.db.prepare(
			"DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)",
		);

		this.db.exec("BEGIN");
		try {
			let updated = 0;
			for (const cand of candidates) {
				const result = updateStmt.run(now, cand.id);
				if (Number(result.changes) > 0) {
					deleteFtsStmt.run(cand.id);
					updated++;
				}
			}
			this.db.exec("COMMIT");
			return updated;
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}

	checkAndEnforceCompaction(
		projectId: number,
		category: MemoryCategory,
		options: { softCap: number; hardCap: number },
	): CompactionSignal | null {
		let count = this.countMemoriesByCategory(projectId, category);

		let prunedCount = 0;
		if (count > options.hardCap) {
			const overflow = count - options.hardCap;
			prunedCount = this.pruneOldestLowestPriority(projectId, category, overflow);
			count = options.hardCap;
		}

		if (count <= options.softCap && prunedCount === 0) {
			return null;
		}

		const candidateCount = Math.min(count - options.softCap, SIGNAL_CANDIDATE_LIMIT);
		const candidates = this.selectOldestLowestPriority(projectId, category, candidateCount);

		return {
			category,
			cap: options.softCap,
			count,
			pruned_count: prunedCount,
			candidates,
		};
	}

	rebuildFts(): void {
		this.db.exec("BEGIN");
		try {
			this.db.exec("DELETE FROM memories_fts");
			const rows = this.db
				.prepare(
					"SELECT rowid, id, project_id, title, what, why, where_ref, learned FROM memories",
				)
				.all() as {
				rowid: number;
				id: string;
				project_id: number;
				title: string;
				what: string;
				why: string | null;
				where_ref: string | null;
				learned: string | null;
			}[];
			const insert = this.db.prepare(
				"INSERT INTO memories_fts (rowid, id, project_id, title, what, why, where_ref, learned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			);
			for (const r of rows) {
				insert.run(r.rowid, r.id, r.project_id, r.title, r.what, r.why, r.where_ref, r.learned);
			}
			this.db.exec("COMMIT");
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}

	purgeSoftDeleted(): number {
		const before = this.db
			.prepare("SELECT COUNT(*) AS c FROM memories WHERE soft_deleted = 1")
			.get() as { c: number };
		this.db.prepare("DELETE FROM memories WHERE soft_deleted = 1").run();
		return before.c;
	}

	ftsRowCount(): number {
		const row = this.db.prepare("SELECT COUNT(*) AS c FROM memories_fts").get() as { c: number };
		return row.c;
	}

	memoriesRowCount(): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS c FROM memories WHERE soft_deleted = 0")
			.get() as { c: number };
		return row.c;
	}
}
