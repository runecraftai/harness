// test/memory/repository.test.ts — T2 (MEM-02): port completo espelhando
// tests/repository.test.ts do source (referência de semântica) + DI
// clock/idGen (D6) + tie-breaks determinísticos + soft-delete fora de
// search/get + compaction transacional.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseLike, type StatementLike } from "../../src/memory/client.ts";
import { deriveSlugFromRemote } from "../../src/memory/project.ts";
import {
	Repository,
	ValidationError,
	SIGNAL_CANDIDATE_LIMIT,
} from "../../src/memory/repository.ts";
import type { CompactionSignal } from "../../src/memory/types.ts";

let sandbox = "";
let db: DatabaseLike;
let repo: Repository;
let projectId: number;

/** Envolve o DB para inserir uma linha "concorrente" imediatamente antes do
 *  INSERT de projects — modela o SELECT-then-INSERT de outra sessão/worktree
 *  no mesmo DB compartilhado. */
function racingDb(inner: DatabaseLike, beforeInsert: () => void): DatabaseLike {
	let raced = false;
	return {
		exec: (sql) => inner.exec(sql),
		close: () => inner.close(),
		prepare(sql: string): StatementLike {
			const stmt = inner.prepare(sql);
			if (raced || !sql.includes("INSERT INTO projects")) return stmt;
			return {
				get: (...params: unknown[]) => stmt.get(...params),
				all: (...params: unknown[]) => stmt.all(...params),
				run: (...params: unknown[]) => {
					raced = true;
					beforeInsert();
					return stmt.run(...params);
				},
			};
		},
	};
}

beforeEach(() => {
	sandbox = join(tmpdir(), `f29-repo-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(sandbox, { recursive: true });
	db = openDatabase(sandbox);
	repo = new Repository(db);
	const project = repo.getOrCreateProject("test-slug", "/tmp/test", "https://github.com/foo/bar.git");
	projectId = project.id;
});

afterEach(() => {
	try {
		db.close();
	} catch {
		// já fechado
	}
	rmSync(sandbox, { recursive: true, force: true });
});

describe("getOrCreateProject", () => {
	test("cria quando ausente; retorna o mesmo em slug duplicado", () => {
		const created = repo.getOrCreateProject("new", "/tmp/new", null);
		expect(created.id).toBeGreaterThan(0);
		expect(repo.getOrCreateProject("new", "/tmp/new", null).id).toBe(created.id);
	});

	test("getProjectBySlug encontra", () => {
		expect(repo.getProjectBySlug("test-slug")?.id).toBe(projectId);
		expect(repo.getProjectBySlug("missing")).toBeNull();
	});

	test("remotes distintos com o mesmo último segmento → identidades distintas", () => {
		const remoteA = "https://one.example/team/shared.git";
		const remoteB = "https://two.example/other/shared.git";
		const a = repo.getOrCreateProject("shared", "/tmp/a", remoteA);
		const b = repo.getOrCreateProject("shared", "/tmp/b", remoteB);
		expect(a.slug).toBe("shared");
		expect(b.slug).not.toBe("shared");
		expect(b.slug.startsWith("shared-")).toBe(true);
		expect(b.id).not.toBe(a.id);
		expect(b.remote_url).toBe(remoteB);
		// Idempotente: o mesmo remote volta ao mesmo projeto (nunca ao de outro).
		expect(repo.getOrCreateProject("shared", "/tmp/b", remoteB).id).toBe(b.id);
		expect(repo.getOrCreateProject("shared", "/tmp/a", remoteA).id).toBe(a.id);
	});

	test("memórias de remotes colidentes ficam separadas", () => {
		const a = repo.getOrCreateProject("shared", "/tmp/a", "https://one.example/team/shared.git");
		const b = repo.getOrCreateProject("shared", "/tmp/b", "https://two.example/other/shared.git");
		repo.saveMemory({ projectId: a.id, category: "decisions", title: "from A", what: "A only" });
		expect(repo.searchMemories({ projectId: b.id, query: "from" }).results).toHaveLength(0);
		expect(repo.searchMemories({ projectId: a.id, query: "from" }).results).toHaveLength(1);
	});

	test("projeto existente de remote único mantém a identidade (sem migração)", () => {
		// Linha legada: slug = último segmento, criada antes da desambiguação.
		const legacy = repo.getOrCreateProject("shared", "/tmp/legacy", "git@one.example:team/shared.git");
		expect(legacy.slug).toBe("shared");
		expect(repo.getOrCreateProject("shared", "/tmp/legacy", "git@one.example:team/shared.git").id).toBe(legacy.id);
		expect(repo.getProjectBySlug("shared")?.id).toBe(legacy.id);
	});

	test("mesmo repo via SSH e HTTPS → um projeto (remote normalizado)", () => {
		const ssh = repo.getOrCreateProject("harness", "/tmp/h", "git@github.com:runecraft-ai/harness.git");
		const https = repo.getOrCreateProject("harness", "/tmp/h", "https://github.com/runecraft-ai/harness.git");
		expect(https.id).toBe(ssh.id);
	});

	test("remote colidente via SSH e HTTPS → uma identidade desambiguada só", () => {
		repo.getOrCreateProject("shared", "/tmp/a", "https://one.example/team/shared.git");
		const https = repo.getOrCreateProject("shared", "/tmp/b", "https://two.example/other/shared.git");
		const ssh = repo.getOrCreateProject("shared", "/tmp/b", "git@two.example:other/shared.git");
		expect(https.slug.startsWith("shared-")).toBe(true);
		expect(ssh.id).toBe(https.id);
		expect(ssh.slug).toBe(https.slug);
	});

	test("spellings equivalentes do mesmo remote não orfanam as memórias", () => {
		const first = repo.getOrCreateProject("r", "/tmp/r", "git@host:o/r.git");
		repo.saveMemory({ projectId: first.id, category: "decisions", title: "kept", what: "same repo" });
		for (const remote of [
			"host:o/r.git",
			"git@host:/o/r.git",
			"ssh://git@host/o/r.git",
			"ssh://git@host:2222/o/r.git",
			"https://host/o/r/",
		]) {
			const again = repo.getOrCreateProject("r", "/tmp/r", remote);
			expect(again.id).toBe(first.id);
			expect(repo.searchMemories({ projectId: again.id, query: "kept" }).results).toHaveLength(1);
		}
	});

	test("corrida pelo mesmo slug: INSERT concorrente devolve a linha vencedora", () => {
		// Duas sessões/worktrees no MESMO DB: a segunda faz o SELECT antes da
		// primeira inserir; o INSERT conflita e não pode falhar fechado.
		const winnerDb = openDatabase(sandbox);
		const winner = new Repository(winnerDb);
		try {
			const racing = new Repository(
				racingDb(db, () => {
					winner.getOrCreateProject("raced", "/tmp/main", "https://one.example/team/raced.git");
				}),
			);
			const project = racing.getOrCreateProject("raced", "/tmp/main", "https://one.example/team/raced.git");
			expect(project.id).toBe(winner.getOrCreateProject("raced", "/tmp/main", "https://one.example/team/raced.git").id);
			expect(repo.getOrCreateProject("raced", "/tmp/main", "https://one.example/team/raced.git").id).toBe(project.id);
		} finally {
			winnerDb.close();
		}
	});

	test("corrida no mesmo slug com OUTRO remote não adota a linha alheia", () => {
		const winnerDb = openDatabase(sandbox);
		const winner = new Repository(winnerDb);
		try {
			const racing = new Repository(
				racingDb(db, () => {
					winner.getOrCreateProject("raced", "/tmp/other", "https://two.example/other/raced.git");
				}),
			);
			const mine = racing.getOrCreateProject("raced", "/tmp/mine", "https://one.example/team/raced.git");
			const theirs = winner.getOrCreateProject("raced", "/tmp/other", "https://two.example/other/raced.git");
			expect(theirs.slug).toBe("raced");
			expect(mine.id).not.toBe(theirs.id);
			expect(mine.slug.startsWith("raced-")).toBe(true);
			expect(mine.remote_url).toBe("https://one.example/team/raced.git");
		} finally {
			winnerDb.close();
		}
	});

	test("slug legado de remote `.git/` mantém a identidade (nenhum projeto renomeado)", () => {
		// O spelling `https://host/o/r.git/` sempre derivou o slug `r.git`; a
		// normalização usada para COMPARAR remotes não pode renomear esse
		// projeto (senão as memórias dele somem da vista).
		const legacy = repo.getOrCreateProject("r.git", "/tmp/r", "https://host/o/r.git/");
		repo.saveMemory({ projectId: legacy.id, category: "decisions", title: "legacy", what: "still visible" });
		expect(deriveSlugFromRemote("https://host/o/r.git/")).toBe("r.git");
		const again = repo.getOrCreateProject("r.git", "/tmp/r", "https://host/o/r.git/");
		expect(again.id).toBe(legacy.id);
		expect(repo.getProjectBySlug("r.git")?.id).toBe(legacy.id);
		expect(repo.getProjectBySlug("r")).toBeNull();
		expect(repo.searchMemories({ projectId: again.id, query: "visible" }).results).toHaveLength(1);
	});

	test("linha sem remote (legado/override) nunca é deslocada por um remote", () => {
		const pinned = repo.getOrCreateProject("pinned", "/tmp/pinned", null);
		const same = repo.getOrCreateProject("pinned", "/tmp/pinned", "https://one.example/team/pinned.git");
		expect(same.id).toBe(pinned.id);
		expect(same.slug).toBe("pinned");
	});
});

describe("saveMemory", () => {
	test("cria com campos mínimos (importance default 5)", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "Use DDD", what: "We chose DDD" });
		expect(m.id).toBeTruthy();
		expect(m.category).toBe("decisions");
		expect(m.importance).toBe(5);
		expect(m.soft_deleted).toBe(0);
	});

	test("rejeita título vazio / what vazio / categoria inválida (códigos do source)", () => {
		expect(() => repo.saveMemory({ projectId, category: "decisions", title: "", what: "x" })).toThrow(ValidationError);
		expect(() => repo.saveMemory({ projectId, category: "decisions", title: "t", what: "" })).toThrow(ValidationError);
		expect(() =>
			repo.saveMemory({
				projectId,
				category: "bogus" as never,
				title: "t",
				what: "w",
			}),
		).toThrow(ValidationError);
	});

	test("clamp importance [1,10]", () => {
		expect(repo.saveMemory({ projectId, category: "decisions", title: "lo", what: "x", importance: 0 }).importance).toBe(1);
		expect(repo.saveMemory({ projectId, category: "decisions", title: "hi", what: "x", importance: 11 }).importance).toBe(10);
	});

	test("anexa session_id quando fornecido", () => {
		const s = repo.startSession(projectId, "pi");
		const m = repo.saveMemory({ projectId, sessionId: s.id, category: "learnings", title: "t", what: "w" });
		expect(m.session_id).toBe(s.id);
	});

	test("rejeita session_id de outro projeto (SESSION_NOT_FOUND)", () => {
		const other = repo.getOrCreateProject("other-save", "/tmp/other-save", null);
		const foreignSession = repo.startSession(other.id, "pi");
		const code = (fn: () => unknown): string => {
			try {
				fn();
			} catch (err) {
				return (err as ValidationError).code;
			}
			throw new Error("esperava ValidationError");
		};
		expect(
			code(() =>
				repo.saveMemory({ projectId, sessionId: foreignSession.id, category: "learnings", title: "t", what: "w" }),
			),
		).toBe("SESSION_NOT_FOUND");
	});
});

describe("project binding — cross-project ID access is refused (defect fix)", () => {
	test("endSession can end a same-project session started under another agent", () => {
		const session = repo.startSession(projectId, "other-agent");
		expect(repo.endSession(session.id, projectId, "done")).toBe(true);
		expect(repo.getSession(session.id, projectId)?.ended_at).not.toBeNull();
	});

	test("getMemory/updateMemory/softDeleteMemory refuse a known id from another project", () => {
		const other = repo.getOrCreateProject("south", "/tmp/south", null);
		const foreign = repo.saveMemory({ projectId: other.id, category: "decisions", title: "private", what: "south secret" });

		expect(repo.getMemory(foreign.id, projectId)).toBeNull();
		expect(repo.getMemory(foreign.id, other.id)?.id).toBe(foreign.id);

		expect(repo.updateMemory(foreign.id, projectId, { title: "hijacked" })).toBeNull();
		expect(repo.getMemory(foreign.id, other.id)?.title).toBe("private");

		expect(repo.softDeleteMemory(foreign.id, projectId).ok).toBe(false);
		expect(repo.getMemory(foreign.id, other.id)).not.toBeNull();
	});

	test("endSession refuses a session started by another project", () => {
		const other = repo.getOrCreateProject("south-session", "/tmp/south-session", null);
		const foreignSession = repo.startSession(other.id, "pi");

		expect(repo.endSession(foreignSession.id, projectId, "hijacked")).toBe(false);
		expect(repo.findActiveSession(other.id, "pi")?.id).toBe(foreignSession.id);

		expect(repo.endSession(foreignSession.id, other.id, "legit")).toBe(true);
	});
});

describe("searchMemories (FTS5 + categoria + soft-delete)", () => {
	beforeEach(() => {
		repo.saveMemory({ projectId, category: "decisions", title: "Use DDD for payments", what: "We chose Domain-Driven Design for the payments service" });
		repo.saveMemory({ projectId, category: "corrections", title: "Never use any", what: "Avoid the any type in TypeScript code" });
		repo.saveMemory({ projectId, category: "architecture", title: "Hexagonal layers", what: "Domain layer at the center" });
	});

	test("match em título e em what; ordena por rank", () => {
		const { results, total } = repo.searchMemories({ projectId, query: "payments" });
		expect(results.length).toBeGreaterThan(0);
		expect(total).toBeGreaterThan(0);
		const ts = repo.searchMemories({ projectId, query: "TypeScript" });
		expect(ts.results.some((r) => r.title === "Never use any")).toBe(true);
	});

	test("diacríticos: 'cafe' acha 'café'", () => {
		repo.saveMemory({ projectId, category: "learnings", title: "café rule", what: "espresso served at café" });
		const { results } = repo.searchMemories({ projectId, query: "cafe" });
		expect(results.some((r) => r.title === "café rule")).toBe(true);
	});

	test("filtra por categoria", () => {
		const { results } = repo.searchMemories({ projectId, query: "use", category: "corrections" });
		expect(results.every((r) => r.category === "corrections")).toBe(true);
	});

	test("respeita limit; query vazia → vazio; sem match → vazio", () => {
		expect(repo.searchMemories({ projectId, query: "the", limit: 1 }).results.length).toBeLessThanOrEqual(1);
		expect(repo.searchMemories({ projectId, query: "   " })).toEqual({ results: [], total: 0 });
		const none = repo.searchMemories({ projectId, query: "nonsensicalxyz123" });
		expect(none.results).toEqual([]);
		expect(none.total).toBe(0);
	});

	test("soft-deleted excluído de search", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "Unique Keyword Phrase AlphaBeta", what: "unique" });
		repo.softDeleteMemory(m.id, projectId);
		const { results, total } = repo.searchMemories({ projectId, query: "AlphaBeta" });
		expect(results).toEqual([]);
		expect(total).toBe(0);
	});
});

describe("getMemory / updateMemory / softDeleteMemory", () => {
	test("get por id; null quando ausente ou soft-deleted", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		expect(repo.getMemory(m.id, projectId)?.id).toBe(m.id);
		expect(repo.getMemory("missing", projectId)).toBeNull();
		repo.softDeleteMemory(m.id, projectId);
		expect(repo.getMemory(m.id, projectId)).toBeNull();
	});

	test("update patch com clamps; NOT_FOUND → null", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "old", what: "w" });
		const updated = repo.updateMemory(m.id, projectId, { title: "new", importance: 99 });
		expect(updated?.title).toBe("new");
		expect(updated?.importance).toBe(10);
		expect(repo.updateMemory("missing", projectId, { title: "x" })).toBeNull();
	});

	test("update valida título/what (INVALID_TITLE/INVALID_WHAT)", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		const code = (fn: () => unknown): string => {
			try {
				fn();
			} catch (err) {
				return (err as ValidationError).code;
			}
			throw new Error("esperava ValidationError");
		};
		expect(code(() => repo.updateMemory(m.id, projectId, { title: "" }))).toBe("INVALID_TITLE");
		expect(code(() => repo.updateMemory(m.id, projectId, { what: "" }))).toBe("INVALID_WHAT");
	});

	test("soft-delete: ok + soft_deleted_at; missing → ok=false", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		const r = repo.softDeleteMemory(m.id, projectId);
		expect(r.ok).toBe(true);
		expect(r.soft_deleted_at).not.toBeNull();
		expect(repo.softDeleteMemory("missing", projectId).ok).toBe(false);
	});
});

describe("sessions", () => {
	test("start/end com summary; findActiveSession; idempotência do session_start", () => {
		const a = repo.startSession(projectId, "pi");
		const b = repo.startSession(projectId, "pi");
		repo.endSession(a.id, projectId, "did things");
		expect(repo.findActiveSession(projectId, "pi")?.id).toBe(b.id);
		const sessions = repo.listSessions("test-slug");
		expect(sessions.find((s) => s.id === a.id)?.summary).toBe("did things");
		expect(repo.endSession("missing", projectId)).toBe(false);
	});

	test("tie-break determinístico: listSessions ORDER BY started_at DESC, id DESC", () => {
		// Mesmo started_at (relógio fixo) → id DESC decide (D6).
		const fixed = new Repository(db, { clock: () => 1000, idGen: (() => { let n = 0; return () => `s${++n}`; })() });
		fixed.startSession(projectId, "pi");
		fixed.startSession(projectId, "pi");
		fixed.startSession(projectId, "pi");
		const list = fixed.listSessions("test-slug", 3);
		expect(list.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
	});
});

describe("stats", () => {
	test("zeros em projeto vazio; contagem por categoria exclui soft-deleted", () => {
		expect(repo.getStats("test-slug").total).toBe(0);
		repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		const c = repo.saveMemory({ projectId, category: "corrections", title: "c", what: "z" });
		repo.softDeleteMemory(c.id, projectId);
		const stats = repo.getStats("test-slug");
		expect(stats.total).toBe(2);
		expect(stats.by_category.decisions).toBe(2);
		expect(stats.by_category.corrections).toBe(0);
		expect(stats.last_activity_at).not.toBeNull();
	});
});

describe("searchAllProjects", () => {
	test("busca em todos os projetos com project_slug", () => {
		const other = repo.getOrCreateProject("other-slug", "/tmp/other", null);
		repo.saveMemory({ projectId, category: "decisions", title: "Shared Keyword Zed", what: "x" });
		repo.saveMemory({ projectId: other.id, category: "learnings", title: "Shared Keyword Zed", what: "y" });
		const rows = repo.searchAllProjects("Zed");
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.project_slug).sort()).toEqual(["other-slug", "test-slug"]);
	});
});

describe("purge e rebuild", () => {
	test("purgeSoftDeleted remove só soft-deleted; rebuildFts restaura o índice", () => {
		const a = repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		const b = repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		repo.softDeleteMemory(a.id, projectId);
		expect(repo.purgeSoftDeleted()).toBe(1);
		expect(repo.getMemory(a.id, projectId)).toBeNull();
		expect(repo.getMemory(b.id, projectId)).not.toBeNull();
		// Drift induzido (delete direto do índice) → rebuild corrige.
		db.prepare("DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)").run(b.id);
		expect(repo.ftsRowCount()).toBe(0);
		repo.rebuildFts();
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
	});
});

describe("purge receipt and index content check", () => {
	test("purgeSoftDeleted returns the rows actually removed; softDeletedCount drops to 0", () => {
		const a = repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		const b = repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		repo.softDeleteMemory(a.id, projectId);
		repo.softDeleteMemory(b.id, projectId);
		expect(repo.softDeletedCount()).toBe(2);
		expect(repo.purgeSoftDeleted()).toBe(2);
		expect(repo.softDeletedCount()).toBe(0);
		expect(repo.purgeSoftDeleted()).toBe(0);
	});

	test("rebuildFts re-indexes live rows only: soft-deleted rows leave no orphan index row", () => {
		const a = repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		repo.softDeleteMemory(a.id, projectId);
		repo.rebuildFts();
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
		expect(repo.ftsContentMismatchCount()).toBe(0);
	});

	test("purgeAndRebuild measures the receipt and leaves no drift", () => {
		const a = repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		const b = repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y" });
		repo.softDeleteMemory(a.id, projectId);
		db.prepare("DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)").run(b.id);
		expect(repo.purgeAndRebuild()).toEqual({
			purged: 1,
			notRemoved: 0,
			liveRetained: 1,
			ftsAfter: 1,
			mismatchesAfter: 0,
		});
	});

	test("ftsContentMismatchCount: 0 when in sync (incl. NULL columns); counts altered, missing and orphan rows", () => {
		const a = repo.saveMemory({ projectId, category: "decisions", title: "a", what: "x" });
		const b = repo.saveMemory({ projectId, category: "decisions", title: "b", what: "y", why: "because" });
		expect(repo.ftsContentMismatchCount()).toBe(0);
		db.prepare("UPDATE memories_fts SET what = 'other' WHERE id = ?").run(a.id);
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
		expect(repo.ftsContentMismatchCount()).toBe(1);
		db.prepare("DELETE FROM memories_fts WHERE id = ?").run(b.id);
		expect(repo.ftsContentMismatchCount()).toBe(2);
		db.prepare("INSERT INTO memories_fts (rowid, id, project_id, title, what) VALUES (9999, 'ghost', 1, 't', 'w')").run();
		expect(repo.ftsContentMismatchCount()).toBe(3);
		repo.rebuildFts();
		expect(repo.ftsContentMismatchCount()).toBe(0);
	});
});

describe("compaction (D6 — poda transacional + tie-break)", () => {
	const softCap = 3;
	const hardCap = 6;

	function makeMemories(count: number): void {
		for (let i = 0; i < count; i++) {
			repo.saveMemory({ projectId, category: "decisions", title: `t${i}`, what: "w", importance: (i % 10) + 1 });
		}
	}

	test("null quando na/abaixo do softCap", () => {
		makeMemories(softCap);
		expect(repo.checkAndEnforceCompaction(projectId, "decisions", { softCap, hardCap })).toBeNull();
	});

	test("sinal sem poda entre softCap e hardCap (candidatos ≤ SIGNAL_CANDIDATE_LIMIT)", () => {
		makeMemories(softCap + 3);
		const signal = repo.checkAndEnforceCompaction(projectId, "decisions", { softCap, hardCap: 10 });
		expect(signal).not.toBeNull();
		expect((signal as CompactionSignal).pruned_count).toBe(0);
		expect((signal as CompactionSignal).candidates.length).toBe(Math.min(3, SIGNAL_CANDIDATE_LIMIT));
	});

	test("poda acima do hardCap (importance ASC, created_at ASC, rowid ASC — D6)", () => {
		// clock fixo → created_at igual; tie-break rowid decide.
		const fixed = new Repository(db, { clock: () => 1000 });
		for (let i = 0; i < hardCap + 5; i++) {
			fixed.saveMemory({ projectId, category: "decisions", title: `t${i}`, what: "w" });
		}
		const signal = fixed.checkAndEnforceCompaction(projectId, "decisions", { softCap, hardCap });
		expect(signal).not.toBeNull();
		expect((signal as CompactionSignal).pruned_count).toBeGreaterThan(0);
		expect(fixed.countMemoriesByCategory(projectId, "decisions")).toBe(hardCap);
		// Candidatos ordenados por (importance, created_at) — tie-break documentado.
		const candidates = (signal as CompactionSignal).candidates;
		for (let i = 1; i < candidates.length; i++) {
			const prev = candidates[i - 1]!;
			const curr = candidates[i]!;
			expect(prev.importance).toBeLessThanOrEqual(curr.importance);
			if (prev.importance === curr.importance) {
				expect(prev.created_at).toBeLessThanOrEqual(curr.created_at);
			}
		}
	});

	test("exclui soft-deleted de contagem e candidatos", () => {
		makeMemories(softCap + 3);
		const recent = repo.recentMemories(projectId, 2);
		for (const m of recent) repo.softDeleteMemory(m.id, projectId);
		const signal = repo.checkAndEnforceCompaction(projectId, "decisions", { softCap, hardCap: 10 });
		const activeCount = repo.countMemoriesByCategory(projectId, "decisions");
		expect(activeCount).toBe(softCap + 3 - recent.length);
		if (signal) {
			const ids = (signal as CompactionSignal).candidates.map((c) => c.id);
			for (const m of recent) expect(ids).not.toContain(m.id);
		}
	});
});

describe("determinismo (D6/F21 D10)", () => {
	function scriptedOps(): Array<Record<string, unknown>> {
		const dir = join(tmpdir(), `f29-det-${process.pid}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		try {
			const d = openDatabase(dir);
			try {
				let seq = 0;
				const clock = () => 1000 + seq++;
				let idSeq = 0;
				const idGen = () => `id-${++idSeq}`;
				const r = new Repository(d, { clock, idGen });
				const p = r.getOrCreateProject("det-slug", "/tmp/det", null);
				const m1 = r.saveMemory({ projectId: p.id, category: "decisions", title: "alpha", what: "first decision", importance: 8 });
				const m2 = r.saveMemory({ projectId: p.id, category: "learnings", title: "beta", what: "café lesson", importance: 3 });
				r.updateMemory(m1.id, p.id, { title: "alpha-updated" });
				r.startSession(p.id, "pi");
				r.softDeleteMemory(m2.id, p.id);
				return [
					{ step: "recent", value: r.recentMemories(p.id, 10) },
					{ step: "search", value: r.searchMemories({ projectId: p.id, query: "cafe" }) },
					{ step: "stats", value: r.getStats("det-slug") },
					{ step: "sessions", value: r.listSessions("det-slug") },
				];
			} finally {
				d.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	test("mesma sequência de ops com clock/idGen injetados → JSON idêntico (2 runs)", () => {
		expect(JSON.stringify(scriptedOps())).toBe(JSON.stringify(scriptedOps()));
	});

	test("sem relógio injetado, identidades continuam estáveis (id ≠ timestamp)", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		expect(m.id).not.toBe(String(m.created_at));
		expect(m.id.length).toBeGreaterThan(8);
	});
});
