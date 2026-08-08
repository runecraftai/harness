// memory/import-lessons.ts — bridge F28 (D7, MEM-06).
//
// Importa IDEMPOTENTE de `.runecraft/lessons/promoted.jsonl` (memória de time
// VERSIONADA do F28) para memórias categoria `learnings` do repo:
//   - title     = trigger
//   - what      = "Anti-padrão: <antiPattern>\nPadrão preferido: <preferred>"
//   - where_ref = "lesson:<lessonId>" (chave de idempotência — coluna
//     existente do schema v1; colisão → skip, NUNCA sobrescreve memória do
//     usuário)
//   - importance = priority mapeado (low=3 / med=5 / high=8 — tabela
//     documentada em docs/MEMORY.md)
//
// Fronteira (D7): o F28 é dono do arquivo — F29 abre SÓ para leitura (nunca
// reescreve; o teste asserta hash byte-a-byte antes/depois). Linha
// malformada → skip (fail-soft) com contagem. Arquivo ausente/vazio → no-op
// (imported=0, skipped=0, total=0 — exit 0, sem ruído).
//
// Contrato mínimo (D7 — campos já definidos no F28 D5): lessonId, trigger,
// antiPattern, preferred, priority. A leitura é autônoma (não importa o
// módulo do F28 — a fronteira F28/F29 fica limpa e aditiva).
import { existsSync, readFileSync } from "node:fs";
import { type Repository } from "./repository.ts";
import { type MemoryCategory } from "./types.ts";
import { MEMORY_CATEGORIES } from "./types.ts";
import { ValidationError } from "./validate.ts";

/** Precedência do priority do F28 → importance (1..10) da memória. */
export const LESSON_PRIORITY_IMPORTANCE: Record<string, number> = {
	low: 3,
	med: 5,
	high: 8,
};

/** Marcador de origem da memória importada (chave de idempotência — D7). */
export function lessonWhereRef(lessonId: string): string {
	return `lesson:${lessonId}`;
}

/** Contrato mínimo de uma linha do promoted.jsonl (D7 — campos do F28 D5). */
export interface LessonContract {
	lessonId: string;
	trigger: string;
	antiPattern: string;
	preferred: string;
	priority?: string;
}

/** Parse fail-soft de UMA linha (malformada → null + motivo estável). */
export function parseLessonLine(raw: string): { lesson?: LessonContract; error?: string } | null {
	const line = raw.trim();
	if (line === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return { error: "json inválido" };
	}
	if (parsed === null || typeof parsed !== "object") return { error: "linha não-objeto" };
	const p = parsed as Record<string, unknown>;
	if (typeof p.lessonId !== "string" || p.lessonId.length === 0) return { error: "lessonId ausente" };
	if (typeof p.trigger !== "string") return { error: "trigger ausente" };
	if (typeof p.antiPattern !== "string") return { error: "antiPattern ausente" };
	if (typeof p.preferred !== "string") return { error: "preferred ausente" };
	return {
		lesson: {
			lessonId: p.lessonId,
			trigger: p.trigger,
			antiPattern: p.antiPattern,
			preferred: p.preferred,
			priority: typeof p.priority === "string" ? p.priority : undefined,
		},
	};
}

/** Relatório do import (contagens estáveis — shape do CLI --json). */
export interface ImportReport {
	imported: number;
	skipped: number;
	total: number;
	malformed: number;
}

/** Importa lessons (parse autônomo) de um arquivo — retorna contagens. */
export function importLessonsFromLines(
	repo: Repository,
	projectId: number,
	lines: string[],
	opts: { dryRun?: boolean } = {},
): ImportReport {
	let imported = 0;
	let skipped = 0;
	let malformed = 0;
	for (const line of lines) {
		const parsed = parseLessonLine(line);
		if (parsed === null) continue; // linha vazia
		if (parsed.error !== undefined || parsed.lesson === undefined) {
			malformed++;
			continue;
		}
		const lesson = parsed.lesson;
		const whereRef = lessonWhereRef(lesson.lessonId);
		const existing = repo
			.getMemoryByWhereRef(projectId, whereRef);
		if (existing !== null) {
			skipped++;
			continue;
		}
		if (opts.dryRun) {
			imported++;
			continue;
		}
		const importance = LESSON_PRIORITY_IMPORTANCE[lesson.priority ?? "med"] ?? LESSON_PRIORITY_IMPORTANCE.med;
		try {
			repo.saveMemory({
				projectId,
				category: "learnings",
				title: lesson.trigger.slice(0, 200),
				what: `Anti-padrão: ${lesson.antiPattern}\nPadrão preferido: ${lesson.preferred}`.slice(0, 4000),
				whereRef,
				importance,
			});
			imported++;
		} catch (err) {
			// Contrato de tamanho violado (título/what estourados) → skip
			// fail-soft (a linha continua existindo na fonte — F28 dono).
			if (err instanceof ValidationError) {
				malformed++;
				continue;
			}
			throw err;
		}
	}
	return { imported, skipped, total: imported + skipped, malformed };
}

/**
 * Bridge completa: lê promoted.jsonl (read-only), importa idempotente e
 * devolve o relatório. Arquivo ausente/vazio → no-op (exit 0).
 */
export function importLessons(
	repo: Repository,
	projectId: number,
	lessonsFile: string,
	opts: { dryRun?: boolean } = {},
): ImportReport {
	if (!existsSync(lessonsFile)) {
		return { imported: 0, skipped: 0, total: 0, malformed: 0 };
	}
	const text = readFileSync(lessonsFile, "utf-8");
	const lines = text.split(/\r?\n/);
	return importLessonsFromLines(repo, projectId, lines, opts);
}

/** Categorias válidas para import (learnings — D7). */
export const IMPORT_CATEGORY: MemoryCategory = "learnings";
export { MEMORY_CATEGORIES };
