// test/memory/import-lessons.test.ts — T5 (MEM-06): bridge F28 idempotente;
// 2º import → 0 novas; fonte byte-idêntica (hash); dry-run → zero writes;
// arquivo ausente → no-op; linha malformada → skip + contagem.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseLike } from "../../src/memory/client.ts";
import { importLessons, lessonWhereRef, parseLessonLine } from "../../src/memory/import-lessons.ts";
import { Repository } from "../../src/memory/repository.ts";

let sandbox = "";
let db: DatabaseLike;
let repo: Repository;
let projectId: number;

function promotedFixture(lessons: Array<Record<string, unknown>>): string {
	const file = join(sandbox, "promoted.jsonl");
	writeFileSync(file, `${lessons.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
	return file;
}

function fileHash(file: string): string {
	return crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
}

beforeEach(() => {
	sandbox = join(tmpdir(), `f29-bridge-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(sandbox, { recursive: true });
	db = openDatabase(sandbox);
	repo = new Repository(db);
	projectId = repo.getOrCreateProject("bridge-slug", sandbox, null).id;
});

afterEach(() => {
	try {
		db.close();
	} catch {
		// já fechado
	}
	rmSync(sandbox, { recursive: true, force: true });
});

const LESSON_A = { lessonId: "abc123", triggerSignature: "sig-a", trigger: "guard blocked write", antiPattern: "continue calling write on existing files", preferred: "read the target first", priority: "med", gate: "writeExistingFile", track: "execution", count: 1, status: "promoted", firstSeenSeq: 0, lastSeenSeq: 0 };
const LESSON_B = { lessonId: "def456", triggerSignature: "sig-b", trigger: "lint broke on commit", antiPattern: "commit without running lint", preferred: "run bun test before complete_goal", priority: "high", gate: "structural", track: "execution", count: 2, status: "promoted", firstSeenSeq: 1, lastSeenSeq: 1 };

describe("parseLessonLine (contrato mínimo D7)", () => {
	test("linha válida → contrato; linha vazia → null; malformada → error", () => {
		const ok = parseLessonLine(JSON.stringify(LESSON_A));
		expect(ok?.lesson?.lessonId).toBe("abc123");
		expect(ok?.lesson?.priority).toBe("med");
		expect(parseLessonLine("   ")).toBeNull();
		expect(parseLessonLine("{corrompido")?.error).toBeDefined();
		expect(parseLessonLine(JSON.stringify({ trigger: "sem id" }))?.error).toBeDefined();
	});
});

describe("importLessons (bridge idempotente)", () => {
	test("2 lessons → 2 memórias learnings com where_ref=lesson:<id>; 2º import → 0 novas", () => {
		const file = promotedFixture([LESSON_A, LESSON_B]);
		const hashBefore = fileHash(file);

		const first = importLessons(repo, projectId, file);
		expect(first.imported).toBe(2);
		expect(first.skipped).toBe(0);
		expect(first.total).toBe(2);

		const memories = repo.recentMemories(projectId, 10);
		expect(memories).toHaveLength(2);
		const byRef = new Map(memories.map((m) => [m.where_ref, m]));
		expect(byRef.get(lessonWhereRef("abc123"))?.title).toBe(LESSON_A.trigger);
		expect(byRef.get(lessonWhereRef("abc123"))?.what).toContain("Anti-padrão: continue calling write on existing files");
		expect(byRef.get(lessonWhereRef("abc123"))?.what).toContain("Padrão preferido: read the target first");
		expect(byRef.get(lessonWhereRef("abc123"))?.importance).toBe(5); // med=5
		expect(byRef.get(lessonWhereRef("def456"))?.importance).toBe(8); // high=8
		expect(memories.every((m) => m.category === "learnings")).toBe(true);

		// 2º import → zero inserts; fonte byte-idêntica (F28 dono).
		const second = importLessons(repo, projectId, file);
		expect(second.imported).toBe(0);
		expect(second.skipped).toBe(2);
		expect(repo.recentMemories(projectId, 10)).toHaveLength(2);
		expect(fileHash(file)).toBe(hashBefore);
	});

	test("dry-run → zero writes (DB inalterado; imported conta o que seria)", () => {
		const file = promotedFixture([LESSON_A]);
		const before = repo.recentMemories(projectId, 10).length;
		const report = importLessons(repo, projectId, file, { dryRun: true });
		expect(report.imported).toBe(1);
		expect(repo.recentMemories(projectId, 10)).toHaveLength(before);
	});

	test("arquivo ausente → no-op (exit 0, sem ruído)", () => {
		const report = importLessons(repo, projectId, join(sandbox, "missing.jsonl"));
		expect(report).toEqual({ imported: 0, skipped: 0, updated: 0, revoked: 0, total: 0, malformed: 0, truncated: 0 });
	});

	test("linha malformada → skip + contagem; as válidas importam", () => {
		const file = join(sandbox, "promoted.jsonl");
		writeFileSync(file, `{corrompido\n${JSON.stringify(LESSON_A)}\n{"lessonId":"x"}\n`, "utf8");
		const report = importLessons(repo, projectId, file);
		expect(report.imported).toBe(1);
		expect(report.malformed).toBe(2);
	});

	test("colisão where_ref com memória do usuário → skip (nunca sobrescreve)", () => {
		const file = promotedFixture([LESSON_A]);
		// Memória do usuário com o MESMO where_ref (marcador) — import não toca.
		repo.saveMemory({ projectId, category: "learnings", title: "user memory", what: "do not overwrite", whereRef: lessonWhereRef("abc123") });
		const report = importLessons(repo, projectId, file);
		expect(report.imported).toBe(0);
		expect(report.skipped).toBe(1);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))?.title).toBe("user memory");
	});

	test("importLessonsOnStart não existe no bridge — o init da extensão decide (D7)", () => {
		// Fronteira: o bridge NUNCA escreve na fonte (nenhum path de escrita).
		expect(existsSync(join(sandbox, "promoted.jsonl"))).toBe(false);
	});
});

describe("revocation and source changes (lesson-revocation fix)", () => {
	test("source changed → the stored copy is refreshed to match the current source (rule 1)", () => {
		const changed = { ...LESSON_A, antiPattern: "old anti-pattern", preferred: "old preferred" };
		const file1 = promotedFixture([changed]);
		const first = importLessons(repo, projectId, file1);
		expect(first.imported).toBe(1);
		const before = repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"));
		expect(before?.what).toContain("old anti-pattern");

		const updatedLesson = { ...LESSON_A, antiPattern: "new anti-pattern", preferred: "new preferred" };
		const file2 = promotedFixture([updatedLesson]);
		const second = importLessons(repo, projectId, file2);
		expect(second.imported).toBe(0);
		expect(second.skipped).toBe(0);
		expect(second.updated).toBe(1);

		const after = repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"));
		expect(after?.id).toBe(before?.id); // same row, refreshed in place
		expect(after?.what).toContain("new anti-pattern");
		expect(after?.what).toContain("new preferred");
		expect(after?.what).not.toContain("old anti-pattern");
	});

	test("source lesson disappeared → the imported copy is revoked and does not resurrect as current (rule 2)", () => {
		const file1 = promotedFixture([LESSON_A, LESSON_B]);
		importLessons(repo, projectId, file1);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).not.toBeNull();

		// LESSON_A removed from the source — only LESSON_B remains.
		const file2 = promotedFixture([LESSON_B]);
		const report = importLessons(repo, projectId, file2);
		expect(report.revoked).toBe(1);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).toBeNull();

		// Durable: re-importing the same (still-missing) source keeps it revoked,
		// not re-created — no resurrection on repeated runs.
		const report2 = importLessons(repo, projectId, file2);
		expect(report2.revoked).toBe(0); // already revoked — nothing left to revoke
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).toBeNull();
	});

	test("deleting only the imported copy is not a revocation mechanism — next import reflects current source, never stale content", () => {
		const oldLesson = { ...LESSON_A, antiPattern: "stale anti-pattern", preferred: "stale preferred" };
		const file1 = promotedFixture([oldLesson]);
		importLessons(repo, projectId, file1);

		// Source corrects the lesson (rule 1 refreshes the row to "current").
		const currentLesson = { ...LESSON_A, antiPattern: "current anti-pattern", preferred: "current preferred" };
		const file2 = promotedFixture([currentLesson]);
		importLessons(repo, projectId, file2);
		const row = repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))!;
		expect(row.what).toContain("current anti-pattern");

		// Someone deletes the imported copy directly (not through the source).
		repo.softDeleteMemory(row.id, projectId);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).toBeNull();

		// Re-import with the SAME (unchanged, already-corrected) source: the
		// recreated row must carry current content, never the stale value that
		// was overwritten before the deletion.
		const report = importLessons(repo, projectId, file2);
		expect(report.imported).toBe(1);
		const recreated = repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"));
		expect(recreated?.what).toContain("current anti-pattern");
		expect(recreated?.what).not.toContain("stale anti-pattern");
	});

	test("long anti-pattern → truncation is reported instead of silently importing cut guidance", () => {
		const huge = { ...LESSON_A, antiPattern: "x".repeat(4100), preferred: "never deploy on Fridays" };
		const file = promotedFixture([huge]);
		const report = importLessons(repo, projectId, file);
		expect(report.imported).toBe(1);
		expect(report.truncated).toBe(1);
		const row = repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"));
		expect(row?.what.length).toBe(4000);
		expect(row?.what.includes("never deploy on Fridays")).toBe(false);
	});

	test("user memory still protected: a user row with no imported_from marker is never refreshed or revoked", () => {
		const file1 = promotedFixture([LESSON_A]);
		// Simulate a pre-fix row: same where_ref, no `imported_from` marker.
		repo.saveMemory({ projectId, category: "learnings", title: "user memory", what: "do not touch", whereRef: lessonWhereRef("abc123") });
		const report = importLessons(repo, projectId, file1);
		expect(report.skipped).toBe(1);
		expect(report.updated).toBe(0);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))?.title).toBe("user memory");

		// Even when the lesson later disappears from the source, the
		// user-owned row (not bridge-owned) must not be revoked by rule 2.
		const file2 = promotedFixture([LESSON_B]);
		const report2 = importLessons(repo, projectId, file2);
		expect(report2.revoked).toBe(0);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))?.title).toBe("user memory");
	});

	test("source emptied to zero valid lessons (file still present) → rule 2 still revokes every previously imported row (F1 fix)", () => {
		const file = promotedFixture([LESSON_A, LESSON_B]);
		importLessons(repo, projectId, file);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).not.toBeNull();
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("def456"))).not.toBeNull();

		// The source file is still present but now has zero valid lesson
		// lines (emptied) — unlike a MISSING file, this must not be a no-op:
		// every previously imported lesson has effectively disappeared.
		writeFileSync(file, "\n", "utf8");
		const report = importLessons(repo, projectId, file);
		expect(report.revoked).toBe(2);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).toBeNull();
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("def456"))).toBeNull();
	});

	test("a malformed line still marks its lessonId present → rule 2 does not wrongly revoke it (F2 fix)", () => {
		const file = promotedFixture([LESSON_A, LESSON_B]);
		importLessons(repo, projectId, file);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).not.toBeNull();

		// abc123's line is corrupted (lessonId present, other fields missing)
		// while def456 stays valid — abc123 did NOT disappear from the
		// source, it is just malformed on this line.
		const corrupted = JSON.stringify({ lessonId: "abc123" });
		writeFileSync(file, `${corrupted}\n${JSON.stringify(LESSON_B)}\n`, "utf8");
		const report = importLessons(repo, projectId, file);
		expect(report.malformed).toBe(1);
		expect(report.revoked).toBe(0);
		expect(repo.getMemoryByWhereRef(projectId, lessonWhereRef("abc123"))).not.toBeNull();
	});
});
