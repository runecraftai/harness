// test/memory/tools.test.ts — T3 (MEM-03): 10 tools rune_* com MESMOS nomes
// e semântica; retorno JSON do source; agent = RUNECRAFT_AGENT_ID ?? "pi"
// (rune_context/rune_session_start); disabledTools filtra; erros de
// validação → {ok:false, error:{code}} sem crash.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseLike } from "../../src/memory/client.ts";
import { Repository } from "../../src/memory/repository.ts";
import { createToolsRecord, filterToolsByDisabled, type ToolDeps } from "../../src/memory/tools.ts";

const TOOL_NAMES = [
	"rune_save",
	"rune_search",
	"rune_get",
	"rune_context",
	"rune_timeline",
	"rune_update",
	"rune_delete",
	"rune_session_start",
	"rune_session_end",
	"rune_stats",
];

let sandbox = "";
let db: DatabaseLike;
let repo: Repository;
let deps: ToolDeps;
let projectId: number;

beforeEach(() => {
	sandbox = join(tmpdir(), `f29-tools-${process.pid}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(sandbox, { recursive: true });
	db = openDatabase(sandbox);
	repo = new Repository(db);
	const project = repo.getOrCreateProject("tools-slug", sandbox, null);
	projectId = project.id;
	deps = { repository: repo, projectSlug: "tools-slug", projectId, categoryCap: 10, agentId: "test-agent" };
});

afterEach(() => {
	try {
		db.close();
	} catch {
		// já fechado
	}
	rmSync(sandbox, { recursive: true, force: true });
});

async function run(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tools = createToolsRecord(deps);
	const t = tools[tool];
	if (!t) throw new Error(`tool ausente: ${tool}`);
	const result = await t.execute(args);
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("registry (D3)", () => {
	test("10 tools com os MESMOS nomes do source", () => {
		const tools = createToolsRecord(deps);
		expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
	});

	test("nomes únicos + descriptions presentes (semântica de prompt do source)", () => {
		const tools = createToolsRecord(deps);
		for (const name of TOOL_NAMES) {
			expect(tools[name]?.description.length).toBeGreaterThan(20);
			expect(tools[name]?.parameters).toBeDefined();
		}
	});

	test("filterToolsByDisabled remove apenas os listados", () => {
		const tools = createToolsRecord(deps);
		const filtered = filterToolsByDisabled(tools, ["rune_delete", "rune_stats"]);
		expect(Object.keys(filtered)).toHaveLength(8);
		expect(filtered.rune_delete).toBeUndefined();
		expect(filtered.rune_save).toBeDefined();
		expect(filterToolsByDisabled(tools, undefined)).toEqual(tools);
	});
});

describe("rune_save → rune_search round-trip (EVAL-031 espelho)", () => {
	test("save devolve {ok:true, memory, compaction:null}; search acha", async () => {
		const saved = await run("rune_save", {
			category: "decisions",
			title: "Use DDD",
			what: "We chose Domain-Driven Design",
			importance: 9,
		});
		expect(saved.ok).toBe(true);
		expect((saved.memory as { title: string }).title).toBe("Use DDD");
		expect(saved.compaction).toBeNull();

		const search = await run("rune_search", { query: "Domain-Driven" });
		expect((search.results as unknown[]).length).toBe(1);
	});

	test("categoria inválida → {ok:false, error:{code:'INVALID_CATEGORY'}} (sem crash)", async () => {
		const result = await run("rune_save", { category: "bogus", title: "t", what: "w" });
		expect(result.ok).toBe(false);
		expect((result.error as { code: string }).code).toBe("INVALID_CATEGORY");
	});

	test("get/update/delete round-trip com NOT_FOUND", async () => {
		const saved = await run("rune_save", { category: "learnings", title: "t", what: "w" });
		const id = (saved.memory as { id: string }).id;
		const got = await run("rune_get", { id });
		expect((got.memory as { id: string }).id).toBe(id);
		const notFound = await run("rune_get", { id: "missing" });
		expect((notFound.error as { code: string }).code).toBe("NOT_FOUND");

		const updated = await run("rune_update", { id, title: "t2" });
		expect((updated.memory as { title: string }).title).toBe("t2");

		const deleted = await run("rune_delete", { id });
		expect(deleted.ok).toBe(true);
		expect((await run("rune_get", { id })).error).toBeDefined();
	});
});

describe("rune_context / sessions (agent adaptado — D3)", () => {
	test("rune_context usa agentId (findActiveSession) e devolve recentes", async () => {
		const started = await run("rune_session_start", {});
		expect(started.reused).toBe(false);
		const again = await run("rune_session_start", {});
		expect(again.reused).toBe(true);
		expect(again.session_id).toBe(started.session_id);

		await run("rune_save", { category: "decisions", title: "mem1", what: "w1" });
		const ctx = await run("rune_context", {});
		expect((ctx.current_session as { agent: string }).agent).toBe("test-agent");
		expect((ctx.recent_memories as unknown[]).length).toBe(1);

		const ctxQuery = await run("rune_context", { query: "w1" });
		expect((ctxQuery.relevant_memories as unknown[]).length).toBe(1);
	});

	test("rune_session_end NOT_FOUND para id inválido", async () => {
		const ended = await run("rune_session_end", { session_id: "nope" });
		expect((ended.error as { code: string }).code).toBe("NOT_FOUND");
	});

	test("rune_timeline lista sessões; rune_stats conta", async () => {
		await run("rune_session_start", {});
		await run("rune_save", { category: "naming", title: "PascalCase", what: "components" });
		const timeline = await run("rune_timeline", {});
		expect((timeline.sessions as unknown[]).length).toBe(1);
		const stats = await run("rune_stats", {});
		expect((stats.by_category as Record<string, number>).naming).toBe(1);
	});
});

describe("agent default (adaptação documentada)", () => {
	test("rune_session_start sem agent usa agentId do deps, não 'opencode'", async () => {
		const started = await run("rune_session_start", {});
		const sessions = repo.listSessions("tools-slug");
		expect(sessions[0]?.agent).toBe("test-agent");
	});
});
