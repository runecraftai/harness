// test/memory/import-lessons.test.ts — T5 (MEM-06): bridge F28 idempotente;
// 2º import → 0 novas; fonte byte-idêntica (hash); dry-run → zero writes;
// arquivo ausente → no-op; linha malformada → skip + contagem.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Database } from "../../src/memory/client.ts";
import { importLessons, lessonWhereRef, parseLessonLine } from "../../src/memory/import-lessons.ts";
import { Repository } from "../../src/memory/repository.ts";

let sandbox = "";
let db: Database;
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
		expect(report).toEqual({ imported: 0, skipped: 0, total: 0, malformed: 0 });
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
