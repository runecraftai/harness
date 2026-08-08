// memory/tools.ts — 10 agent tools `rune_*` como Pi tools (D3, MEM-03).
//
// Port 1:1 dos tools do runes (src/tools/*.ts) com as adaptações decididas:
//   - `tool()` de @opencode-ai/plugin → `defineTool` do SDK 0.81.0 + 
//     `pi.registerTool` (padrão verificado no fork glla, goal.ts:2621+)
//   - zod → TypeBox `parameters` (shape REAL do defineTool — validado no
//     Execute: types.d.ts `parameters: TParams extends TSchema`; TypeBox já
//     é peerDep do harness e usado pelo glla — zero deps novas) + validação
//     semântica manual no repository (validate.ts — MESMOS códigos)
//   - agent hardcoded "opencode" (rune_context/rune_session_start) →
//     `agentId` do deps (RUNECRAFT_AGENT_ID ?? "pi" — F24, resolvido no
//     installMemory)
//   - retorno = MESMAS strings JSON do source (content text + details {})
//
// Nenhum tool dropado — todos são host-agnósticos (só usam repository +
// projectId). `disabledTools` do config filtra (port filterToolsByDisabled).
import { Type, type TSchema } from "typebox";
import { DEFAULT_CATEGORY_CAP, HARD_CAP_MULTIPLIER, ValidationError, type Repository } from "./repository.ts";
import type { MemoryCategory, Memory } from "./types.ts";
import { MEMORY_CATEGORIES } from "./types.ts";

export interface ToolDeps {
	repository: Repository;
	projectSlug: string;
	projectId: number;
	categoryCap?: number;
	/** identidade do agente (RUNECRAFT_AGENT_ID ?? "pi" — F24); substitui o
	 *  "opencode" hardcoded do source (adaptação documentada). */
	agentId: string;
}

/** Array de tools registradas (10 — mesma ordem do registry do source). */
export interface RuneTool {
	name: string;
	label: string;
	description: string;
	parameters: TSchema;
	execute: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, never> }>;
}

export type ToolsRecord = Record<string, RuneTool>;

/** Retorno padrão do execute (shape do SDK — content text + details {}). */
function textResult(json: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
	return { content: [{ type: "text", text: json }], details: {} };
}

/** enum das 8 categorias (TypeBox — mesmo domínio do zod do source). */
const CATEGORY_SCHEMA = Type.Union(
	MEMORY_CATEGORIES.map((c: MemoryCategory) => Type.Literal(c)),
);

function createSaveTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_save",
		label: "Save memory",
		description:
			"Save a memory to the project's persistent memory store. Use this when you make or learn something durable — a decision, a correction, a convention, a config value, a name rule, an architecture note, a constraint, or a learning. The `category` field controls how the memory is grouped. Memories persist across sessions and are recalled on demand via rune_context or rune_search. When the category exceeds its configured cap, the response includes a `compaction` field with candidates to summarize or prune.",
		parameters: Type.Object({
			category: CATEGORY_SCHEMA,
			title: Type.String({ minLength: 1, maxLength: 200 }),
			what: Type.String({ minLength: 1, maxLength: 4000 }),
			why: Type.Optional(Type.String({ maxLength: 2000 })),
			where_ref: Type.Optional(Type.String({ maxLength: 500 })),
			learned: Type.Optional(Type.String({ maxLength: 2000 })),
			importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
			session_id: Type.Optional(Type.String()),
		}),
		async execute(args) {
			try {
				const input = args as {
					category: MemoryCategory;
					title: string;
					what: string;
					why?: string;
					where_ref?: string;
					learned?: string;
					importance?: number;
					session_id?: string;
				};
				const memory = deps.repository.saveMemory({
					projectId: deps.projectId,
					sessionId: input.session_id ?? null,
					category: input.category,
					title: input.title,
					what: input.what,
					why: input.why ?? null,
					whereRef: input.where_ref ?? null,
					learned: input.learned ?? null,
					importance: input.importance,
				});
				const softCap = deps.categoryCap ?? DEFAULT_CATEGORY_CAP;
				const compaction = deps.repository.checkAndEnforceCompaction(
					deps.projectId,
					input.category,
					{ softCap, hardCap: softCap * HARD_CAP_MULTIPLIER },
				);
				return textResult(JSON.stringify({ ok: true, memory, compaction }));
			} catch (err) {
				if (err instanceof ValidationError) {
					const e = err as ValidationError;
					return textResult(
						JSON.stringify({ ok: false, error: { code: e.code, message: e.message } }),
					);
				}
				throw err;
			}
		},
	};
}

function createSearchTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_search",
		label: "Search memory",
		description:
			"Search the project's memory store using full-text search over titles and content. Returns matching memories, ordered by FTS5 rank. Soft-deleted memories are excluded. Use this when the user references past work or you need to recall what was decided/learned/corrected before.",
		parameters: Type.Object({
			query: Type.String({ minLength: 1, maxLength: 500 }),
			category: Type.Optional(CATEGORY_SCHEMA),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(args) {
			const input = args as { query: string; category?: MemoryCategory; limit?: number };
			const result = deps.repository.searchMemories({
				projectId: deps.projectId,
				query: input.query,
				category: input.category,
				limit: input.limit ?? 20,
			});
			return textResult(JSON.stringify(result));
		},
	};
}

function createGetTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_get",
		label: "Get memory",
		description:
			"Fetch a single memory by its id. Returns the full memory record, or a NOT_FOUND error if the id does not exist or the memory was soft-deleted.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1 }),
		}),
		async execute(args) {
			const input = args as { id: string };
			const memory = deps.repository.getMemory(input.id);
			if (!memory) {
				return textResult(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
			}
			return textResult(JSON.stringify({ ok: true, memory }));
		},
	};
}

function createUpdateTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_update",
		label: "Update memory",
		description:
			"Update fields of an existing memory by id. Only the fields you provide are changed. Returns the updated memory or a NOT_FOUND error. Importance is clamped to [1,10]. Soft-deleted memories cannot be updated.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1 }),
			title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
			what: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
			why: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
			where_ref: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
			learned: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
			importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
		}),
		async execute(args) {
			const input = args as {
				id: string;
				title?: string;
				what?: string;
				why?: string | null;
				where_ref?: string | null;
				learned?: string | null;
				importance?: number;
			};
			try {
				const memory = deps.repository.updateMemory(input.id, {
					title: input.title,
					what: input.what,
					why: input.why,
					whereRef: input.where_ref,
					learned: input.learned,
					importance: input.importance,
				});
				if (!memory) {
					return textResult(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
				}
				return textResult(JSON.stringify({ ok: true, memory }));
			} catch (err) {
				if (err instanceof ValidationError) {
					return textResult(
						JSON.stringify({ ok: false, error: { code: err.code, message: err.message } }),
					);
				}
				throw err;
			}
		},
	};
}

function createDeleteTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_delete",
		label: "Delete memory",
		description:
			"Soft-delete a memory by id. The memory is hidden from search and get, but remains in storage for audit. Use `harness memory doctor --purge` to hard-delete soft-deleted rows. Returns NOT_FOUND if the id does not exist or is already deleted.",
		parameters: Type.Object({
			id: Type.String({ minLength: 1 }),
		}),
		async execute(args) {
			const input = args as { id: string };
			const result = deps.repository.softDeleteMemory(input.id);
			if (!result.ok) {
				return textResult(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
			}
			return textResult(JSON.stringify({ ok: true, soft_deleted_at: result.soft_deleted_at }));
		},
	};
}

function byImportanceThenRecency(a: Memory, b: Memory): number {
	if (b.importance !== a.importance) return b.importance - a.importance;
	return b.created_at - a.created_at;
}

function createContextTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_context",
		label: "Memory context",
		description:
			"Get a snapshot of the project's memory: project identity, the most recent active session (if any), the 10 most recent memories, and (when `query` is provided) up to 10 memories matching the query ordered by importance. Use this at the start of a task to recall what has been decided/learned in prior sessions.",
		parameters: Type.Object({
			project_slug: Type.Optional(Type.String({ minLength: 1 })),
			query: Type.Optional(Type.String({ maxLength: 500 })),
		}),
		async execute(args) {
			const input = args as { project_slug?: string; query?: string };
			const project = deps.repository.getProjectBySlug(deps.projectSlug);
			// Adaptação documentada: agent "opencode" do source → agentId (D3).
			const activeSession = deps.repository.findActiveSession(deps.projectId, deps.agentId);
			const recent = deps.repository.recentMemories(deps.projectId, 10);

			const relevant_memories: Memory[] =
				input.query && input.query.trim().length > 0
					? deps.repository
							.searchMemories({ projectId: deps.projectId, query: input.query, limit: 10 })
							.results.sort(byImportanceThenRecency)
							.slice(0, 10)
					: [];

			return textResult(
				JSON.stringify({
					project: project
						? {
								slug: project.slug,
								root_path: project.root_path,
								remote_url: project.remote_url,
							}
						: null,
					current_session: activeSession,
					recent_memories: recent,
					relevant_memories,
				}),
			);
		},
	};
}

function createTimelineTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_timeline",
		label: "Session timeline",
		description:
			"List the most recent sessions for this project, ordered by started_at DESC. Each session includes its id, agent, start/end timestamps, optional summary, and memory count.",
		parameters: Type.Object({
			project_slug: Type.Optional(Type.String({ minLength: 1 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(args) {
			const input = args as { project_slug?: string; limit?: number };
			const limit = input.limit ?? 20;
			const sessions = deps.repository.listSessions(deps.projectSlug, limit);
			return textResult(JSON.stringify({ sessions }));
		},
	};
}

function createStatsTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_stats",
		label: "Memory stats",
		description:
			"Get memory statistics for the project: total count, per-category counts, and the timestamp of the most recent memory. Soft-deleted memories are excluded.",
		parameters: Type.Object({
			project_slug: Type.Optional(Type.String({ minLength: 1 })),
		}),
		async execute(args) {
			const input = args as { project_slug?: string };
			void input;
			const stats = deps.repository.getStats(deps.projectSlug);
			return textResult(JSON.stringify(stats));
		},
	};
}

function createSessionStartTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_session_start",
		label: "Start session",
		description:
			"Start a new session for this project. Returns the session id and start timestamp. If a session for the same agent is already active, it is reused (idempotent).",
		parameters: Type.Object({
			project_slug: Type.Optional(Type.String({ minLength: 1 })),
			agent: Type.Optional(Type.String({ minLength: 1 })),
		}),
		async execute(args) {
			const input = args as { project_slug?: string; agent?: string };
			// Adaptação documentada: default "opencode" do source → agentId (D3).
			const agent = input.agent ?? deps.agentId;
			const existing = deps.repository.findActiveSession(deps.projectId, agent);
			if (existing) {
				return textResult(
					JSON.stringify({
						session_id: existing.id,
						started_at: existing.started_at,
						project: { slug: deps.projectSlug },
						reused: true,
					}),
				);
			}
			const session = deps.repository.startSession(deps.projectId, agent);
			return textResult(
				JSON.stringify({
					session_id: session.id,
					started_at: session.started_at,
					project: { slug: deps.projectSlug },
					reused: false,
				}),
			);
		},
	};
}

function createSessionEndTool(deps: ToolDeps): RuneTool {
	return {
		name: "rune_session_end",
		label: "End session",
		description:
			"Mark a session as ended. Optionally attach a summary describing what was done. The session then appears in `rune_timeline` with the summary attached.",
		parameters: Type.Object({
			session_id: Type.String({ minLength: 1 }),
			summary: Type.Optional(Type.String({ maxLength: 2000 })),
		}),
		async execute(args) {
			const input = args as { session_id: string; summary?: string };
			const ok = deps.repository.endSession(input.session_id, input.summary ?? null);
			if (!ok) {
				return textResult(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }));
			}
			return textResult(JSON.stringify({ ok: true }));
		},
	};
}

/** Cria as 10 tools rune_* (mesma ordem do registry do source). */
export function createToolsRecord(deps: ToolDeps): ToolsRecord {
	return {
		rune_save: createSaveTool(deps),
		rune_search: createSearchTool(deps),
		rune_get: createGetTool(deps),
		rune_context: createContextTool(deps),
		rune_timeline: createTimelineTool(deps),
		rune_update: createUpdateTool(deps),
		rune_delete: createDeleteTool(deps),
		rune_session_start: createSessionStartTool(deps),
		rune_session_end: createSessionEndTool(deps),
		rune_stats: createStatsTool(deps),
	};
}

/** Filtra tools desabilitadas (port do filterToolsByDisabled do source). */
export function filterToolsByDisabled(tools: ToolsRecord, disabled: string[] | undefined): ToolsRecord {
	if (!disabled || disabled.length === 0) return tools;
	const set = new Set(disabled);
	const filtered: ToolsRecord = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (!set.has(name)) filtered[name] = tool;
	}
	return filtered;
}
