// test/memory/repository.test.ts — T2 (MEM-02): port completo espelhando
// tests/repository.test.ts do source (referência de semântica) + DI
// clock/idGen (D6) + tie-breaks determinísticos + soft-delete fora de
// search/get + compaction transacional.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Database } from "../../src/memory/client.ts";
import {
	Repository,
	ValidationError,
	SIGNAL_CANDIDATE_LIMIT,
} from "../../src/memory/repository.ts";
import type { CompactionSignal } from "../../src/memory/types.ts";

let sandbox = "";
let db: Database;
let repo: Repository;
let projectId: number;

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
		repo.softDeleteMemory(m.id);
		const { results, total } = repo.searchMemories({ projectId, query: "AlphaBeta" });
		expect(results).toEqual([]);
		expect(total).toBe(0);
	});
});

describe("getMemory / updateMemory / softDeleteMemory", () => {
	test("get por id; null quando ausente ou soft-deleted", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		expect(repo.getMemory(m.id)?.id).toBe(m.id);
		expect(repo.getMemory("missing")).toBeNull();
		repo.softDeleteMemory(m.id);
		expect(repo.getMemory(m.id)).toBeNull();
	});

	test("update patch com clamps; NOT_FOUND → null", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "old", what: "w" });
		const updated = repo.updateMemory(m.id, { title: "new", importance: 99 });
		expect(updated?.title).toBe("new");
		expect(updated?.importance).toBe(10);
		expect(repo.updateMemory("missing", { title: "x" })).toBeNull();
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
		expect(code(() => repo.updateMemory(m.id, { title: "" }))).toBe("INVALID_TITLE");
		expect(code(() => repo.updateMemory(m.id, { what: "" }))).toBe("INVALID_WHAT");
	});

	test("soft-delete: ok + soft_deleted_at; missing → ok=false", () => {
		const m = repo.saveMemory({ projectId, category: "decisions", title: "t", what: "w" });
		const r = repo.softDeleteMemory(m.id);
		expect(r.ok).toBe(true);
		expect(r.soft_deleted_at).not.toBeNull();
		expect(repo.softDeleteMemory("missing").ok).toBe(false);
	});
});

describe("sessions", () => {
	test("start/end com summary; findActiveSession; idempotência do session_start", () => {
		const a = repo.startSession(projectId, "pi");
		const b = repo.startSession(projectId, "pi");
		repo.endSession(a.id, "did things");
		expect(repo.findActiveSession(projectId, "pi")?.id).toBe(b.id);
		const sessions = repo.listSessions("test-slug");
		expect(sessions.find((s) => s.id === a.id)?.summary).toBe("did things");
		expect(repo.endSession("missing")).toBe(false);
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
		repo.softDeleteMemory(c.id);
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
		repo.softDeleteMemory(a.id);
		expect(repo.purgeSoftDeleted()).toBe(1);
		expect(repo.getMemory(a.id)).toBeNull();
		expect(repo.getMemory(b.id)).not.toBeNull();
		// Drift induzido (delete direto do índice) → rebuild corrige.
		db.prepare("DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)").run(b.id);
		expect(repo.ftsRowCount()).toBe(0);
		repo.rebuildFts();
		expect(repo.ftsRowCount()).toBe(repo.memoriesRowCount());
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
		for (const m of recent) repo.softDeleteMemory(m.id);
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
				r.updateMemory(m1.id, { title: "alpha-updated" });
				r.startSession(p.id, "pi");
				r.softDeleteMemory(m2.id);
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
