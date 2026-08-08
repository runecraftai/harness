// test/memory/extension.test.ts — T3 (MEM-03/05): installMemory com fake pi —
// kill switch → zero tools + zero arquivos; init normal → 10 rune_* no
// session_start; disabledTools filtra; importLessonsOnStart roda no init;
// freeze (config mid-session não afeta o snapshot já capturado).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installMemory, type MemoryDeps } from "../../src/extensions/memory.ts";
import { openDatabase } from "../../src/memory/client.ts";
import { Repository } from "../../src/memory/repository.ts";

interface FakePi {
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	registered: string[];
	on(event: string, h: (e: unknown, c: unknown) => unknown): void;
	registerTool(tool: { name: string }): void;
	registerCommand(): void;
	sendUserMessage(): void;
	getSessionName(): string | undefined;
}

function makeFakePi(): FakePi {
	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	return {
		handlers,
		registered: [],
		on(event: string, h: (e: unknown, c: unknown) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(h);
			handlers.set(event, list);
		},
		registerTool(tool: { name: string }) {
			this.registered.push(tool.name);
		},
		registerCommand() {},
		sendUserMessage() {},
		getSessionName() {
			return undefined;
		},
	};
}

function makeCtx(cwd: string): Record<string, unknown> {
	return {
		cwd,
		mode: "rpc",
		hasUI: false,
		ui: {},
		sessionManager: { getSessionId: () => "sess-1" },
		modelRegistry: {},
		model: { id: "m" },
		isIdle: () => true,
		isProjectTrusted: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

async function emitSessionStart(pi: FakePi, cwd: string): Promise<void> {
	const ctx = makeCtx(cwd);
	for (const h of pi.handlers.get("session_start") ?? []) {
		await h({ type: "session_start", reason: "startup" }, ctx);
	}
}

describe("installMemory (D3/D5/D7)", () => {
	test("kill switch RUNECRAFT_MEMORY=0 → zero tools + zero arquivos", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(repo, { recursive: true });
			const pi = makeFakePi();
			installMemory(pi as never, { env: { ...process.env, RUNECRAFT_MEMORY: "0" } });
			await emitSessionStart(pi, repo);
			expect(pi.registered).toEqual([]);
			expect(fs.existsSync(path.join(repo, ".runecraft"))).toBe(false);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("init normal → 10 rune_* registrados no session_start (ctx.cwd)", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(repo, { recursive: true });
			const pi = makeFakePi();
			let observed: string[] = [];
			installMemory(pi as never, { onRegistered: (names) => (observed = names) });
			await emitSessionStart(pi, repo);
			expect(observed.sort()).toEqual(
				["rune_save", "rune_search", "rune_get", "rune_context", "rune_timeline", "rune_update", "rune_delete", "rune_session_start", "rune_session_end", "rune_stats"].sort(),
			);
			// DB criado sob <gitRoot|cwd>/.runecraft/memory/runes.db (D1).
			expect(fs.existsSync(path.join(repo, ".runecraft", "memory", "runes.db"))).toBe(true);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("disabledTools do config → filtro no registro", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(repo, { recursive: true });
			const stateDir = path.join(repo, ".runecraft");
			fs.mkdirSync(stateDir, { recursive: true });
			fs.writeFileSync(
				path.join(stateDir, "state.json"),
				JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { disabledTools: ["rune_delete", "rune_stats"] } }),
			);
			const pi = makeFakePi();
			installMemory(pi as never, { env: process.env });
			await emitSessionStart(pi, repo);
			expect(pi.registered).toContain("rune_save");
			expect(pi.registered).not.toContain("rune_delete");
			expect(pi.registered).not.toContain("rune_stats");
			expect(pi.registered).toHaveLength(8);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("importLessonsOnStart=true → import roda no init (idempotente)", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(path.join(repo, ".runecraft", "lessons"), { recursive: true });
			fs.writeFileSync(
				path.join(repo, ".runecraft", "lessons", "promoted.jsonl"),
				`${JSON.stringify({ lessonId: "l1", trigger: "t", antiPattern: "a", preferred: "p", priority: "med", gate: "g", track: "execution", count: 1, status: "promoted", firstSeenSeq: 0, lastSeenSeq: 0 })}\n`,
			);
			fs.writeFileSync(
				path.join(repo, ".runecraft", "state.json"),
				JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { importLessonsOnStart: true } }),
			);
			const pi = makeFakePi();
			installMemory(pi as never, { env: process.env });
			await emitSessionStart(pi, repo);
			// O import roda no init (mesmo processo) → memória já existe no DB.
			const db = openDatabase(path.join(repo, ".runecraft", "memory"));
			try {
				const r = new Repository(db);
				// cwd sem git → slug = path absoluto do cwd (resolveProjectSlugSync).
				const memories = r.recentMemories(r.getOrCreateProject(repo, repo, null).id, 10);
				expect(memories.some((m) => m.where_ref === "lesson:l1")).toBe(true);
			} finally {
				db.close();
			}
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("freeze: config capturada no init; mudança mid-session não afeta", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
			const stateFile = path.join(repo, ".runecraft", "state.json");
			fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 3 } }));
			const pi = makeFakePi();
			let observed: string[] = [];
			installMemory(pi as never, { onRegistered: (names) => (observed = names) });
			await emitSessionStart(pi, repo);
			// Sessão 2: config mudou no disco, mas o snapshot da sessão 1 vale.
			fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, memory: { categoryCap: 99 } }));
			await emitSessionStart(pi, repo);
			expect(observed).toHaveLength(10); // registro único (initialized)
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});

	test("falha de abertura → tools ausentes + warn (fail-closed; sessão segue)", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "f29-ext-"));
		try {
			const repo = path.join(base, "repo");
			fs.mkdirSync(repo, { recursive: true });
			const pi = makeFakePi();
			const deps: MemoryDeps = {
				env: process.env,
				memoryDir: () => path.join(repo, ".runecraft", "memory", "blocked-by-file"),
			};
			// Cria um ARQUIVO no lugar do dir → openDatabase falha (fail-closed).
			fs.mkdirSync(path.join(repo, ".runecraft"), { recursive: true });
			fs.writeFileSync(path.join(repo, ".runecraft", "memory"), "not a dir");
			installMemory(pi as never, deps);
			await emitSessionStart(pi, repo);
			expect(pi.registered).toEqual([]);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});
});
