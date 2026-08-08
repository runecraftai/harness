// memory/types.ts — tipos do domínio de memória (port de db/types.ts do
// pacote runes do arcanum — org própria, MIT; AD-002). Tipos puros, sem zod.
//
// 8 categorias do source (MEMORY_CATEGORIES) — o contrato de agrupamento das
// memórias (same semantics do port; evals comparam contra fixtures do source).

export type MemoryCategory =
	| "project_rules"
	| "architecture"
	| "constraints"
	| "config_values"
	| "naming"
	| "decisions"
	| "corrections"
	| "learnings";

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
	"project_rules",
	"architecture",
	"constraints",
	"config_values",
	"naming",
	"decisions",
	"corrections",
	"learnings",
] as const;

export interface Project {
	id: number;
	slug: string;
	root_path: string;
	remote_url: string | null;
	created_at: number;
}

export interface Session {
	id: string;
	project_id: number;
	agent: string;
	started_at: number;
	ended_at: number | null;
	summary: string | null;
}

export interface Memory {
	id: string;
	project_id: number;
	session_id: string | null;
	category: MemoryCategory;
	title: string;
	what: string;
	why: string | null;
	where_ref: string | null;
	learned: string | null;
	importance: number;
	soft_deleted: 0 | 1;
	created_at: number;
	updated_at: number;
}

export interface Stats {
	total: number;
	by_category: Record<MemoryCategory, number>;
	last_activity_at: number | null;
}

export interface CompactionCandidate {
	id: string;
	title: string;
	importance: number;
	created_at: number;
}

export interface CompactionSignal {
	category: MemoryCategory;
	cap: number;
	count: number;
	pruned_count: number;
	candidates: CompactionCandidate[];
}
