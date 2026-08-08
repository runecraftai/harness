// sdd/scope.ts — classificação determinística de escopo (D8, PFC-08).
//
// Limiares em CÓDIGO (decisão 3 — determinismo): espelho da auto-sizing do
// tlc-spec-driven (F29 casa). Classificação pura — mesma entrada → mesmo
// escopo (F21 D10; sem LLM, sem relógio).
//
// Limiares v1 (calibrados no Execute contra os specs F1..F33):
//   quick   ≤ 3 arquivos afetados E ≤ 1 frase de objetivo E < 10 tasks
//   medium  < 10 arquivos E < 10 tasks (e não quick)
//   large   multi-componente (≥ 10 arquivos OU ≥ 10 tasks OU flag explícita)
export type SddScope = "quick" | "medium" | "large";

export const SCOPE_LABELS: Record<SddScope, string> = {
	quick: "quick",
	medium: "medium",
	large: "large",
};

export interface ScopeInput {
	/** nº de arquivos afetados (estimativa). */
	fileCount: number;
	/** nº de frases do objetivo (estimativa de complexidade do enunciado). */
	sentenceCount: number;
	/** nº estimado de tasks de implementação. */
	taskCount: number;
	/** flag explícita de multi-componente (ex.: feature toca >1 pacote). */
	multiComponent?: boolean;
}

const QUICK_MAX_FILES = 3;
const QUICK_MAX_SENTENCES = 1;
const MEDIUM_MAX_FILES = 10;
const MEDIUM_MAX_TASKS = 10;
const LARGE_MIN_TASKS = 10;
const LARGE_MIN_FILES = 10;

/** Classifica o escopo (puro — limiares em código, decisão 3). */
export function classifyScope(input: ScopeInput): SddScope {
	const files = Math.max(0, input.fileCount);
	const sentences = Math.max(0, input.sentenceCount);
	const tasks = Math.max(0, input.taskCount);
	const multi = input.multiComponent === true;

	if (multi || files >= LARGE_MIN_FILES || tasks >= LARGE_MIN_TASKS) return "large";
	if (files <= QUICK_MAX_FILES && sentences <= QUICK_MAX_SENTENCES && tasks < MEDIUM_MAX_TASKS) return "quick";
	return "medium";
}

/** Escopo válido para --scope (parse determinístico). */
export function parseScope(value: string | undefined): SddScope | null {
	if (value === undefined || value === "") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "quick" || normalized === "medium" || normalized === "large") return normalized;
	return null;
}
