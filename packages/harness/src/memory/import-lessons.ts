// memory/import-lessons.ts — bridge F28 (D7, MEM-06).
//
// Importa de `.runecraft/lessons/promoted.jsonl` (memória de time VERSIONADA
// do F28) para memórias categoria `learnings` do repo:
//   - title     = trigger
//   - what      = "Anti-padrão: <antiPattern>\nPadrão preferido: <preferred>"
//     (sliced to WHAT_MAX=4000 chars — validate.ts; see TRUNCATION below)
//   - where_ref = "lesson:<lessonId>" (chave de idempotência — coluna
//     existente do schema v1)
//   - imported_from = LESSON_IMPORT_MARKER (schema v2 — identifica linhas
//     escritas por esta bridge; uma memória do usuário com o MESMO where_ref
//     não tem esse marcador e nunca é tocada)
//   - importance = priority mapeado (low=3 / med=5 / high=8 — tabela
//     documentada em docs/MEMORY.md)
//
// Fronteira (D7): o F28 é dono do arquivo — F29 abre SÓ para leitura (nunca
// reescreve; o teste asserta hash byte-a-byte antes/depois). Linha
// malformada → skip (fail-soft) com contagem. Arquivo ausente/vazio → no-op
// (imported=0, skipped=0, total=0 — exit 0, sem ruído).
//
// REVOCATION RULES (two, deterministic — fixes the stale-import/resurrection
// bug found in data/runes-vs-optmem-memory-recon/report.md §4/§7 item 2):
//
// 1. Source lesson CHANGED (same lessonId, different antiPattern/preferred/
//    trigger/priority): the existing bridge-owned row is UPDATED in place to
//    match the current source. Previously this case hit the where_ref
//    collision and was silently skipped, leaving the stored copy stale.
// 2. Source lesson DISAPPEARED (lessonId no longer present in this import's
//    lines, but a bridge-owned row for it is still active): the row is
//    soft-deleted (revoked) by the import itself. This re-runs on every
//    import — as long as the lesson stays out of the source, the row stays
//    revoked, so this is the durable tombstone: fix/remove the lesson in
//    `promoted.jsonl`, not in the memory store.
//
// Deleting ONLY the imported copy (`rune_delete` / CLI `memory delete`) is
// explicitly NOT a revocation mechanism: if the source still lists the
// lessonId, the next import recreates the row from the CURRENT source
// content (never from whatever the deleted row used to contain). The one
// real way to revoke a lesson is to fix or remove it at the source the F28
// layer owns; this bridge only mirrors that source.
//
// A row saved before this fix shipped (schema v1, no `imported_from`) is
// indistinguishable from a user memory that collides on `where_ref`, so it
// is treated as user-owned (never refreshed/revoked) until it is deleted
// once; the next import then recreates it as a bridge-owned row and the
// rules above apply going forward.
//
// TRUNCATION: `what` is capped at WHAT_MAX (4000 chars, validate.ts — same
// limit `rune_save`/`rune_update` enforce) applied to the COMBINED
// "Anti-padrão: …\nPadrão preferido: …" string. A long antiPattern can push
// the preferred remedy past the cut; `ImportReport.truncated` counts how
// many lesson lines this happened to in this run, instead of importing
// silently truncated guidance.
//
// Contrato mínimo (D7 — campos já definidos no F28 D5): lessonId, trigger,
// antiPattern, preferred, priority. A leitura é autônoma (não importa o
// módulo do F28 — a fronteira F28/F29 fica limpa e aditiva).
import { existsSync, readFileSync } from "node:fs";
import { type Repository } from "./repository.ts";
import { type MemoryCategory } from "./types.ts";
import { MEMORY_CATEGORIES } from "./types.ts";
import { IMPORTANCE_DEFAULT, TITLE_MAX, WHAT_MAX, ValidationError } from "./validate.ts";

/** Precedência do priority do F28 → importance (1..10) da memória. */
export const LESSON_PRIORITY_IMPORTANCE: Record<string, number> = {
	low: 3,
	med: 5,
	high: 8,
};

/** Prefixo da chave de idempotência (where_ref) — ver lessonWhereRef. */
export const LESSON_WHERE_REF_PREFIX = "lesson:";

/** Marcador de origem da memória importada (schema v2 — ownership). */
export const LESSON_IMPORT_MARKER = "lesson-import:v1";

/** Marcador de origem da memória importada (chave de idempotência — D7). */
export function lessonWhereRef(lessonId: string): string {
	return `${LESSON_WHERE_REF_PREFIX}${lessonId}`;
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
	/** Bridge-owned row refreshed because the source lesson changed (rule 1). */
	updated: number;
	/** Bridge-owned row soft-deleted because the lesson left the source (rule 2). */
	revoked: number;
	total: number;
	malformed: number;
	/** Lesson lines whose combined antiPattern+preferred text exceeded
	 * WHAT_MAX and was cut — see the TRUNCATION note above. */
	truncated: number;
}

function buildMemoryFields(lesson: LessonContract): {
	title: string;
	what: string;
	importance: number;
	truncated: boolean;
} {
	const importance =
		LESSON_PRIORITY_IMPORTANCE[lesson.priority ?? "med"] ?? LESSON_PRIORITY_IMPORTANCE.med ?? IMPORTANCE_DEFAULT;
	const combined = `Anti-padrão: ${lesson.antiPattern}\nPadrão preferido: ${lesson.preferred}`;
	return {
		title: lesson.trigger.slice(0, TITLE_MAX),
		what: combined.slice(0, WHAT_MAX),
		importance,
		truncated: combined.length > WHAT_MAX,
	};
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
	let updated = 0;
	let malformed = 0;
	let truncated = 0;
	const seenLessonIds = new Set<string>();

	for (const line of lines) {
		const parsed = parseLessonLine(line);
		if (parsed === null) continue; // linha vazia
		if (parsed.error !== undefined || parsed.lesson === undefined) {
			malformed++;
			continue;
		}
		const lesson = parsed.lesson;
		seenLessonIds.add(lesson.lessonId);
		const whereRef = lessonWhereRef(lesson.lessonId);
		const fields = buildMemoryFields(lesson);
		if (fields.truncated) truncated++;

		const existing = repo.getMemoryByWhereRef(projectId, whereRef);
		if (existing !== null) {
			if (existing.imported_from !== LESSON_IMPORT_MARKER) {
				// Colisão com memória do usuário (sem o marcador de ownership)
				// → skip fail-soft, NUNCA sobrescreve (D7).
				skipped++;
				continue;
			}
			const changed =
				existing.title !== fields.title ||
				existing.what !== fields.what ||
				existing.importance !== fields.importance;
			if (!changed) {
				skipped++;
				continue;
			}
			// Rule 1 — source lesson changed: refresh the stored copy in place.
			if (opts.dryRun) {
				updated++;
				continue;
			}
			try {
				repo.updateMemory(existing.id, projectId, {
				title: fields.title,
				what: fields.what,
				importance: fields.importance,
			});
				updated++;
			} catch (err) {
				if (err instanceof ValidationError) {
					malformed++;
					continue;
				}
				throw err;
			}
			continue;
		}

		if (opts.dryRun) {
			imported++;
			continue;
		}
		try {
			repo.saveMemory({
				projectId,
				category: "learnings",
				title: fields.title,
				what: fields.what,
				whereRef,
				importance: fields.importance,
				importedFrom: LESSON_IMPORT_MARKER,
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

	// Rule 2 — source lesson disappeared: revoke bridge-owned rows whose
	// lessonId was not seen in this batch. Guarded on seenLessonIds.size > 0
	// so a transiently empty/unreadable read never mass-revokes everything
	// (missing/empty file stays the documented no-op above this function).
	let revoked = 0;
	if (seenLessonIds.size > 0) {
		const active = repo.listActiveImportedMemories(projectId, LESSON_IMPORT_MARKER);
		for (const row of active) {
			if (!row.where_ref?.startsWith(LESSON_WHERE_REF_PREFIX)) continue;
			const lessonId = row.where_ref.slice(LESSON_WHERE_REF_PREFIX.length);
			if (seenLessonIds.has(lessonId)) continue;
			if (!opts.dryRun) repo.softDeleteMemory(row.id, projectId);
			revoked++;
		}
	}

	return { imported, skipped, updated, revoked, total: imported + skipped + updated, malformed, truncated };
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
		return { imported: 0, skipped: 0, updated: 0, revoked: 0, total: 0, malformed: 0, truncated: 0 };
	}
	const text = readFileSync(lessonsFile, "utf-8");
	const lines = text.split(/\r?\n/);
	return importLessonsFromLines(repo, projectId, lines, opts);
}

/** Categorias válidas para import (learnings — D7). */
export const IMPORT_CATEGORY: MemoryCategory = "learnings";
export { MEMORY_CATEGORIES };
