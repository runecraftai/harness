// commands/memory.ts — CLI `harness memory search|stats|doctor|import-lessons`
// (D8, MEM-07).
//
// Camada fina: kill switch → recusa fail-visible (nada criado, exit 0);
// resolução do dir (RUNECRAFT_MEMORY_DATA_DIR ?? <gitRoot|cwd>/.runecraft/
// memory) → openDatabase + Repository → dispatch puro (src/memory/cli.ts) →
// sinks (out/err). `--json` devolve shape estável por subcomando (F21 D1 —
// CLI testável in-process).
import type { Runtime, TextSink } from "../config.ts";
import { openDatabase } from "../memory/client.ts";
import { ensureMemoryDir } from "../memory/paths.ts";
import { resolveProjectSlug } from "../memory/project.ts";
import { Repository } from "../memory/repository.ts";
import { importLessons } from "../memory/import-lessons.ts";
import { memoryKillSwitch, promotedLessonsPath } from "../memory/config.ts";
import {
	buildStatsView,
	dispatchMemoryCli,
	runDoctor,
	SEARCH_LIMIT,
	type DoctorView,
	type StatsView,
} from "../memory/cli.ts";

export interface MemoryCommandOptions {
	json: boolean;
	out: TextSink;
	err: TextSink;
	rt: Runtime;
	subcommand: string;
	args: string[];
	/** --purge (flag global parseArgs — doctor hard-deleta + rebuild). */
	purge?: boolean;
	/** --dry-run (flag global parseArgs — import-lessons relatório sem escrever). */
	dryRun?: boolean;
}

/** Shape JSON estável por subcomando (F21 D1 — determinístico). */
export function memoryJsonShape(subcommand: string, payload: Record<string, unknown>): string {
	return `${JSON.stringify({ command: `memory ${subcommand}`, ...payload }, null, 2)}\n`;
}

export async function runMemoryCommand(opts: MemoryCommandOptions): Promise<number> {
	const cwd = opts.rt.cwd;

	// Kill switch (F20): recusa fail-visible — NADA criado (D5).
	const kill = memoryKillSwitch(opts.rt.env);
	if (kill.active) {
		opts.out.write(`@runecraft/harness memory: memory disabled (RUNECRAFT_MEMORY=${kill.value})\n`);
		return 0;
	}

	// Abre o DB (cria o dir — CLI de inspeção cria o store sob demanda, como
	// o bin do runes). Falha de abertura → fail-closed com hint de doctor.
	let db;
	try {
		const memoryDir = ensureMemoryDir(cwd, opts.rt.env);
		db = openDatabase(memoryDir);
	} catch (error) {
		opts.err.write(
			`@runecraft/harness memory: não foi possível abrir o store — ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}
	try {
		const repo = new Repository(db);
		const identity = await resolveProjectSlug(cwd, opts.rt.env);
		const project = repo.getOrCreateProject(identity.slug, identity.rootPath, identity.remoteUrl);
		const importLessonsFile = promotedLessonsPath(cwd);

		const extraArgs: string[] = [...opts.args];
		if (opts.subcommand === "doctor" && opts.purge === true && !extraArgs.includes("--purge")) {
			extraArgs.push("--purge");
		}
		if (opts.subcommand === "import-lessons" && opts.dryRun === true && !extraArgs.includes("--dry-run")) {
			extraArgs.push("--dry-run");
		}
		const result = dispatchMemoryCli(
			repo,
			{
				projectId: project.id,
				importLessonsFile,
				importFn: importLessons,
			},
			opts.subcommand,
			extraArgs,
		);

		if (opts.json) {
			opts.out.write(memoryJsonShape(opts.subcommand, jsonPayload(opts.subcommand, repo, result, opts.args)));
		} else if (result.code === 0) {
			opts.out.write(result.text);
		} else {
			opts.err.write(result.text);
		}
		return result.code;
	} finally {
		try {
			db.close();
		} catch {
			// close best-effort
		}
	}
}

/** Payload JSON por subcomando (re-consulta o repo — shape estável). */
function jsonPayload(
	subcommand: string,
	repo: Repository,
	result: { code: number },
	args: string[],
): Record<string, unknown> {
	const base: Record<string, unknown> = { exitCode: result.code };
	switch (subcommand) {
		case "search": {
			const query = args.join(" ").trim();
			const rows = repo.searchAllProjects(query, SEARCH_LIMIT);
			return {
				...base,
				query,
				matches: rows.map((r) => ({
					id: r.id,
					project: r.project_slug,
					category: r.category,
					title: r.title,
					created_at: r.created_at,
				})),
			};
		}
		case "stats": {
			return { ...base, ...statsJson(buildStatsView(repo)) };
		}
		case "doctor": {
			const purge = args.includes("--purge");
			const view = runDoctor(repo, purge);
			return { ...base, ...doctorJson(view) };
		}
		default:
			return base;
	}
}

function statsJson(view: StatsView): Record<string, unknown> {
	return { projects: view.projects, grandTotal: view.grandTotal };
}

function doctorJson(view: DoctorView): Record<string, unknown> {
	return {
		memories: view.memories,
		memories_fts: view.fts,
		drift: view.drift,
		purged: view.rebuildResult?.purged ?? 0,
		ftsAfter: view.rebuildResult?.ftsAfter ?? view.fts,
	};
}
