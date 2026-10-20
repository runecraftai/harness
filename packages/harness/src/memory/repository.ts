// memory/repository.ts — port completo do Repository do runes
// (db/repository.ts) para bun:sqlite, com as
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
import type { DatabaseLike } from "./client.ts";
import { canonicalRemoteKey, disambiguatedSlugForRemote } from "./project.ts";
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
	/** Ownership marker for bridge-written rows (e.g. import-lessons.ts). */
	importedFrom?: string | null;
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
		imported_from: (row.imported_from as string | null) ?? null,
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

/** Mesmo repo? Compara as chaves CANÔNICAS dos remotes (`git@host:o/r.git` ≡
 *  `ssh://host/o/r.git` ≡ `https://host/o/r/`) — nunca o
 *  `normalizeRemoteUrl` congelado, cujo resultado descarta o host e alimenta o
 *  slug. `null` = desconhecido → nunca é conflito: uma linha sem remote
 *  (projeto legado, ou criada quando o checkout ainda não tinha remote — o pin
 *  de RUNECRAFT_MEMORY_PROJECT_SLUG sozinho NÃO zera o remote gravado)
 *  continua dona do seu slug. */
function sameRemote(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return true;
	return canonicalRemoteKey(a) === canonicalRemoteKey(b);
}

export interface IndexCounts {
	memories: number;
	fts: number;
	mismatches: number;
}

/** What a purge + index rebuild left in the store, measured inside the same
 * write transaction that did the work. */
export interface MaintenanceReceipt {
	/** Soft-deleted rows actually removed (DB-wide, all projects). */
	purged: number;
	/** Soft-deleted rows still present after the purge (not removed). */
	notRemoved: number;
	/** Live rows kept — a purge never touches these. */
	liveRetained: number;
	/** Index rows after the rebuild. */
	ftsAfter: number;
	/** Index/table disagreements left after the rebuild. */
	mismatchesAfter: number;
}

export class Repository {
	private readonly db: DatabaseLike;
	private readonly clock: () => number;
	private readonly idGen: () => string;

	constructor(
		db: DatabaseLike,
		deps: RepositoryDeps = {},
	) {
		this.db = db;
		this.clock = deps.clock ?? Date.now;
		this.idGen = deps.idGen ?? (() => randomUUID());
	}

	/**
	 * Idempotente por slug — EXCETO quando o slug já pertence a um remote
	 * diferente. O slug base (último segmento do remote) colide entre repos
	 * distintos (`one.example/team/shared` vs `two.example/other/shared`);
	 * reusar a linha mandaria as memórias de um repo para o outro. Nesse caso
	 * o projeto novo recebe `disambiguatedSlugForRemote` (slug base + hash do
	 * remote): a linha existente NUNCA é reescrita (sem migração, identidade
	 * preservada), e o par (slug, remote) fica estável nas próximas chamadas.
	 */
	getOrCreateProject(slug: string, rootPath: string, remoteUrl: string | null = null): Project {
		const existing = this.getProjectBySlug(slug);
		if (existing) {
			if (sameRemote(existing.remote_url, remoteUrl)) return existing;
			// `sameRemote` só é false com AMBOS os remotes não-nulos (sem remote
			// nunca é conflito), então aqui o remote existe por invariante.
			return this.getOrCreateDisambiguatedProject(slug, rootPath, remoteUrl);
		}
		// O INSERT é conflito-seguro: outra sessão/worktree pode ter criado a
		// linha entre o SELECT acima e este INSERT (um DB compartilhado).
		const inserted = this.insertProject(slug, rootPath, remoteUrl);
		if (sameRemote(inserted.remote_url, remoteUrl)) return inserted;
		return this.getOrCreateDisambiguatedProject(slug, rootPath, remoteUrl);
	}

	/** Projeto para um remote que colide no slug base: 8 hex de sha256 do remote
	 *  (~4e9 — colisão real desprezível); se AINDA assim existir com outro
	 *  remote, o digest completo. Nunca adota a linha de outro remote. */
	private getOrCreateDisambiguatedProject(
		slug: string,
		rootPath: string,
		remoteUrl: string | null,
	): Project {
		if (remoteUrl === null) {
			throw new Error(`memory: slug ${slug} está tomado por outro remote e não há remote para desambiguar`);
		}
		for (const length of [8, 64]) {
			const candidate = disambiguatedSlugForRemote(slug, remoteUrl, length);
			const existing = this.getProjectBySlug(candidate);
			if (!existing) {
				const inserted = this.insertProject(candidate, rootPath, remoteUrl);
				if (sameRemote(inserted.remote_url, remoteUrl)) return inserted;
				continue;
			}
			if (sameRemote(existing.remote_url, remoteUrl)) return existing;
		}
		// Inalcançável (dois remotes distintos com o mesmo sha256 completo).
		throw new Error(`memory: slug ${slug} e sua forma desambiguada estão tomados por outros remotes`);
	}

	private insertProject(slug: string, rootPath: string, remoteUrl: string | null): Project {
		const createdAt = this.clock();
		const result = this.db
			.prepare(
				"INSERT INTO projects (slug, root_path, remote_url, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING",
			)
			.run(slug, rootPath, remoteUrl, createdAt);
		if (Number(result.changes) === 0) {
			const existing = this.getProjectBySlug(slug);
			if (!existing) {
				throw new Error(`memory: projeto ${slug} já existia mas não pôde ser lido`);
			}
			return existing;
		}
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

	/** Scoped to the owning project — a foreign or unknown session cannot be ended. */
	endSession(sessionId: string, projectId: number, summary?: string | null): boolean {
		const endedAt = this.clock();
		const result = this.db
			.prepare("UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ? AND project_id = ?")
			.run(endedAt, summary ?? null, sessionId, projectId);
		return Number(result.changes) > 0;
	}

	/** Session scoped to a project — used to validate a session_id before
	 *  attaching a memory to it (a foreign session_id must be refused). */
	getSession(id: string, projectId: number): Session | null {
		const row = this.db
			.prepare("SELECT * FROM sessions WHERE id = ? AND project_id = ?")
			.get(id, projectId) as Record<string, unknown> | undefined;
		return row ? rowToSession(row) : null;
	}

	saveMemory(input: SaveMemoryInput): Memory {
		// Validação manual (D3 — mesmos códigos do source).
		validateSave({ category: input.category, title: input.title, what: input.what, importance: input.importance });
		if (input.sessionId && !this.getSession(input.sessionId, input.projectId)) {
			throw new ValidationError("SESSION_NOT_FOUND", "session_id not found for this project");
		}
		const id = this.idGen();
		const now = this.clock();
		const importance = clampImportance(input.importance);
		this.db
			.prepare(
				`INSERT INTO memories
				(id, project_id, session_id, category, title, what, why, where_ref, learned, importance, soft_deleted, created_at, updated_at, imported_from)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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
				input.importedFrom ?? null,
			);
		return this.getMemory(id, input.projectId) as Memory;
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

	/** Scoped to the selected project — a foreign id is treated as NOT_FOUND
	 *  (same refusal as a missing id; avoids confirming a foreign row exists). */
	getMemory(id: string, projectId: number): Memory | null {
		const row = this.db
			.prepare("SELECT * FROM memories WHERE id = ? AND project_id = ? AND soft_deleted = 0")
			.get(id, projectId) as Record<string, unknown> | undefined;
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

	/** Active rows a bridge previously wrote (ownership via `imported_from`
	 * — see import-lessons.ts disappearance/revocation pass). */
	listActiveImportedMemories(
		projectId: number,
		importedFrom: string,
	): Array<{ id: string; where_ref: string | null }> {
		const rows = this.db
			.prepare(
				"SELECT id, where_ref FROM memories WHERE project_id = ? AND imported_from = ? AND soft_deleted = 0",
			)
			.all(projectId, importedFrom) as Array<{ id: string; where_ref: string | null }>;
		return rows;
	}

	/** Scoped to the selected project — a foreign id is treated as NOT_FOUND
	 *  (same refusal as a missing id; avoids confirming a foreign row exists). */
	updateMemory(id: string, projectId: number, fields: UpdateMemoryInput): Memory | null {
		const existing = this.db
			.prepare("SELECT id FROM memories WHERE id = ? AND project_id = ? AND soft_deleted = 0")
			.get(id, projectId) as { id: string } | undefined;
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

		if (updates.length === 0) return this.getMemory(id, projectId);

		updates.push("updated_at = ?");
		params.push(this.clock());
		params.push(id);

		this.db.prepare(`UPDATE memories SET ${updates.join(", ")} WHERE id = ?`).run(...params);
		return this.getMemory(id, projectId);
	}

	/** Scoped to the selected project — a foreign id is treated as NOT_FOUND
	 *  (same refusal as a missing id; avoids confirming a foreign row exists). */
	softDeleteMemory(id: string, projectId: number): { ok: boolean; soft_deleted_at: number | null } {
		const now = this.clock();
		const result = this.db
			.prepare(
				"UPDATE memories SET soft_deleted = 1, updated_at = ? WHERE id = ? AND project_id = ? AND soft_deleted = 0",
			)
			.run(now, id, projectId);
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
		this.writeTransaction(() => this.reindexFts());
	}

	/** Re-indexes the live rows only, matching the trigger-maintained index
	 * (a soft delete removes its FTS row). */
	private reindexFts(): void {
		this.db.exec("DELETE FROM memories_fts");
		const rows = this.db
			.prepare(
				"SELECT rowid, id, project_id, title, what, why, where_ref, learned FROM memories WHERE soft_deleted = 0",
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
	}

	/** Hard-deletes every soft-deleted row (DB-wide, all projects). Returns the
	 * number of rows actually gone — measured as before − after, never assumed
	 * from the DELETE having run. */
	purgeSoftDeleted(): number {
		return this.writeTransaction(() => this.deleteSoftDeleted());
	}

	/** Purge, rebuild the index and re-measure in ONE write transaction: the
	 * store is shared (WAL), so measuring across statements lets a concurrent
	 * writer inflate/deflate the receipt and fake post-rebuild drift. */
	purgeAndRebuild(): MaintenanceReceipt {
		return this.writeTransaction(() => {
			const purged = this.deleteSoftDeleted();
			this.reindexFts();
			return {
				purged,
				notRemoved: this.softDeletedCount(),
				liveRetained: this.memoriesRowCount(),
				ftsAfter: this.ftsRowCount(),
				mismatchesAfter: this.ftsContentMismatchCount(),
			};
		});
	}

	private deleteSoftDeleted(): number {
		const before = this.softDeletedCount();
		this.db.prepare("DELETE FROM memories WHERE soft_deleted = 1").run();
		return before - this.softDeletedCount();
	}

	private writeTransaction<T>(fn: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = fn();
			this.db.exec("COMMIT");
			return result;
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}

	/** Soft-deleted rows still present in the base table (all projects). */
	softDeletedCount(): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS c FROM memories WHERE soft_deleted = 1")
			.get() as { c: number };
		return row.c;
	}

	/**
	 * Index rows that disagree with the base table, regardless of row counts:
	 * live memories whose FTS row is missing or differs in any indexed column,
	 * plus FTS rows with no live memory behind them. Compares the index against
	 * the table only — says nothing about whether the table content is right.
	 */
	ftsContentMismatchCount(): number {
		const stale = this.db
			.prepare(
				`SELECT COUNT(*) AS c FROM memories m
				 LEFT JOIN memories_fts f ON f.rowid = m.rowid
				 WHERE m.soft_deleted = 0 AND (
					f.rowid IS NULL OR f.id IS NOT m.id OR f.project_id IS NOT m.project_id
					OR f.title IS NOT m.title OR f.what IS NOT m.what OR f.why IS NOT m.why
					OR f.where_ref IS NOT m.where_ref OR f.learned IS NOT m.learned)`,
			)
			.get() as { c: number };
		const orphans = this.db
			.prepare(
				`SELECT COUNT(*) AS c FROM memories_fts f
				 LEFT JOIN memories m ON m.rowid = f.rowid AND m.soft_deleted = 0
				 WHERE m.rowid IS NULL`,
			)
			.get() as { c: number };
		return stale.c + orphans.c;
	}

	ftsRowCount(): number {
		const row = this.db.prepare("SELECT COUNT(*) AS c FROM memories_fts").get() as { c: number };
		return row.c;
	}

	/** The three counts the diagnosis compares, read in one snapshot so a
	 * concurrent writer cannot make them disagree with each other. */
	indexCounts(): IndexCounts {
		this.db.exec("BEGIN");
		try {
			const counts = {
				memories: this.memoriesRowCount(),
				fts: this.ftsRowCount(),
				mismatches: this.ftsContentMismatchCount(),
			};
			this.db.exec("COMMIT");
			return counts;
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}

	memoriesRowCount(): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS c FROM memories WHERE soft_deleted = 0")
			.get() as { c: number };
		return row.c;
	}
}
