// memory/validate.ts — validação MANUAL dos inputs de memória (substitui o
// zod 4.1.8 do source — zero deps novas, D3). Mesmos códigos de erro do
// source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG, EMPTY_WHAT,
// WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT) e mesmas regras:
//   - categoria ∈ MEMORY_CATEGORIES (8)
//   - título 1..200 · what 1..4000 · why ≤2000 · where_ref ≤500 · learned ≤2000
//   - importância int, clamp [1,10] (default 5)
import { MEMORY_CATEGORIES, type MemoryCategory } from "./types.ts";

export const TITLE_MAX = 200;
export const WHAT_MAX = 4000;
export const WHY_MAX = 2000;
export const WHERE_REF_MAX = 500;
export const LEARNED_MAX = 2000;
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 10;
export const IMPORTANCE_DEFAULT = 5;

export class ValidationError extends Error {
	readonly code: string;

	constructor(
		code: string,
		message: string,
	) {
		super(message);
		this.name = "ValidationError";
		this.code = code;
	}
}

/** Categoria válida? (enum das 8 categorias — INVALID_CATEGORY). */
export function isMemoryCategory(value: unknown): value is MemoryCategory {
	return typeof value === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

/** Clamp de importância para [1,10]; não-número/NaN → 5 (same source). */
export function clampImportance(value: number | undefined): number {
	if (typeof value !== "number" || Number.isNaN(value)) return IMPORTANCE_DEFAULT;
	return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, Math.floor(value)));
}

/** Validação de save (mesmas checagens/ordem do source — códigos iguais). */
export function validateSave(input: {
	category: unknown;
	title: unknown;
	what: unknown;
	importance?: unknown;
}): void {
	if (!isMemoryCategory(input.category)) {
		throw new ValidationError(
			"INVALID_CATEGORY",
			`category must be one of: ${MEMORY_CATEGORIES.join(", ")}`,
		);
	}
	if (typeof input.title !== "string" || input.title.trim().length === 0) {
		throw new ValidationError("EMPTY_TITLE", "title is required and cannot be empty");
	}
	if (input.title.length > TITLE_MAX) {
		throw new ValidationError("TITLE_TOO_LONG", `title must be at most ${TITLE_MAX} characters`);
	}
	if (typeof input.what !== "string" || input.what.trim().length === 0) {
		throw new ValidationError("EMPTY_WHAT", "what is required and cannot be empty");
	}
	if (input.what.length > WHAT_MAX) {
		throw new ValidationError("WHAT_TOO_LONG", `what must be at most ${WHAT_MAX} characters`);
	}
	if (input.importance !== undefined && (typeof input.importance !== "number" || !Number.isInteger(input.importance))) {
		throw new ValidationError("INVALID_IMPORTANCE", "importance must be an integer");
	}
}

/** Validação de update (campos opcionais — INVALID_TITLE/INVALID_WHAT). */
export function validateUpdate(fields: { title?: unknown; what?: unknown }): void {
	if (fields.title !== undefined) {
		if (typeof fields.title !== "string" || fields.title.length === 0 || fields.title.length > TITLE_MAX) {
			throw new ValidationError("INVALID_TITLE", `title must be 1-${TITLE_MAX} characters`);
		}
	}
	if (fields.what !== undefined) {
		if (typeof fields.what !== "string" || fields.what.length === 0 || fields.what.length > WHAT_MAX) {
			throw new ValidationError("INVALID_WHAT", `what must be 1-${WHAT_MAX} characters`);
		}
	}
}
