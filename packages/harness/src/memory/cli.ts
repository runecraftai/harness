// memory/cli.ts — comandos de inspeção/manutenção da memória (D8, MEM-07).
//
// Port do bin/runes.ts (search/stats/doctor [--purge]) + o bridge
// import-lessons (D7). Os comandos são PUROS: recebem um
// Repository + sinks e devolvem texto/exit code — a abertura do DB vive no
// caller (commands/memory.ts), com RUNECRAFT_MEMORY_DATA_DIR como override
// de path (evals/CLI testável).
//
// Exit codes (port do bin): 0 ok · 1 erro/drift sem --purge · 2 uso errado.

/** FTS5 disponível? (probe — port do probeSqlite do bin; runtime Bun). */
export function probeSqlite(): { ok: boolean; error?: string } {
	try {
		const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
		const probe = new Database(":memory:");
		probe.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
		probe.close();
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

export const MAX_TITLE_LENGTH = 60;
export const SEARCH_LIMIT = 20;

export function formatDate(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

/** Markdown table do search (port cmdSearch do bin — searchAllProjects). */
export function renderSearchTable(
	rows: Array<{ title: string; category: string; project_slug: string; created_at: number }>,
): string {
	if (rows.length === 0) return "no matches\n";
	const lines = [
		"| # | project | category | title | created_at |",
		"| - | ------- | -------- | ----- | ---------- |",
	];
	rows.forEach((r, i) => {
		const title = truncate(r.title, MAX_TITLE_LENGTH);
		lines.push(`| ${i + 1} | ${r.project_slug} | ${r.category} | ${title} | ${formatDate(r.created_at)} |`);
	});
	return `${lines.join("\n")}\n`;
}

export interface StatsView {
	projects: Array<{
		slug: string;
		total: number;
		last_activity_at: number | null;
		by_category: Record<string, number>;
	}>;
	grandTotal: number;
}

/** Contagens por categoria + last activity por projeto (port cmdStats). */
export function buildStatsView(repo: {
	listProjects(): Array<{ slug: string }>;
	getStats(slug: string): { total: number; last_activity_at: number | null; by_category: Record<string, number> };
}): StatsView {
	const projects = repo.listProjects().map((p) => {
		const s = repo.getStats(p.slug);
		const active: Record<string, number> = {};
		for (const [cat, c] of Object.entries(s.by_category)) {
			if (c > 0) active[cat] = c;
		}
		return { slug: p.slug, total: s.total, last_activity_at: s.last_activity_at, by_category: active };
	});
	return { projects, grandTotal: projects.reduce((acc, p) => acc + p.total, 0) };
}

export function renderStats(view: StatsView): string {
	if (view.projects.length === 0) return "no projects yet\n";
	const lines: string[] = [];
	for (const p of view.projects) {
		lines.push(`\n# ${p.slug}`);
		lines.push(`  total: ${p.total}`);
		lines.push(`  last activity: ${p.last_activity_at ? formatDate(p.last_activity_at) : "—"}`);
		for (const [cat, c] of Object.entries(p.by_category)) {
			lines.push(`  ${cat}: ${c}`);
		}
	}
	lines.push(`\ngrand total: ${view.grandTotal}`);
	return `${lines.join("\n")}\n`;
}

export interface DoctorView {
	memories: number;
	fts: number;
	drift: boolean;
	rebuildResult?: { ftsAfter: number; purged: number };
}

/** Drift memories vs memories_fts (port reportDriftAndRebuild do bin). */
export function runDoctor(
	repo: {
		memoriesRowCount(): number;
		ftsRowCount(): number;
		rebuildFts(): void;
		purgeSoftDeleted(): number;
	},
	purge: boolean,
): DoctorView {
	const memories = repo.memoriesRowCount();
	const fts = repo.ftsRowCount();
	const drift = memories !== fts;
	if (purge) {
		const purged = repo.purgeSoftDeleted();
		repo.rebuildFts();
		return { memories, fts, drift: false, rebuildResult: { ftsAfter: repo.ftsRowCount(), purged } };
	}
	return { memories, fts, drift };
}

export function renderDoctor(view: DoctorView): string {
	const lines = [`memories (live): ${view.memories}`, `memories_fts:    ${view.fts}`];
	if (view.drift) {
		lines.push("", "Drift detected. Run `harness memory doctor --purge` to rebuild.");
	} else if (view.rebuildResult) {
		lines.push(`rebuilt memories_fts: ${view.rebuildResult.ftsAfter}`);
		lines.push(`purged soft-deleted rows: ${view.rebuildResult.purged}`);
		lines.push("fts index rebuilt");
	}
	if (!view.drift && !view.rebuildResult) lines.push("", "memory: healthy");
	return `${lines.join("\n")}\n`;
}

export const MEMORY_HELP = `harness memory — inspect the project's persistent memory

Usage:
  harness memory search <query>        Search memories (prints a markdown table)
  harness memory stats                 Show per-category counts
  harness memory doctor [--purge]      Check the store; with --purge, hard-delete soft-deleted rows and rebuild the FTS index
  harness memory import-lessons [--dry-run]  Import F28 promoted lessons (idempotent)
  harness memory help                  Show this help
`;

export type MemoryCliResult =
	| { code: 0; text: string }
	| { code: 1; text: string }
	| { code: 2; text: string };

/** Assinatura da bridge (importLessons do import-lessons.ts). */
export interface ImportFn {
	(
		repo: import("./repository.ts").Repository,
		projectId: number,
		lessonsFile: string,
		opts: { dryRun?: boolean },
	): { imported: number; skipped: number; total: number; malformed: number };
}

/** Dispatcher puro do `harness memory` (subcommand + args → exit code/texto). */
export function dispatchMemoryCli(
	repo: import("./repository.ts").Repository,
	opts: {
		projectId: number;
		importLessonsFile: string;
		importFn: ImportFn;
	},
	subcommand: string,
	args: string[],
): MemoryCliResult {
	if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
		return { code: 0, text: MEMORY_HELP };
	}

	if (subcommand === "search") {
		const query = args.join(" ").trim();
		if (!query) return { code: 2, text: "harness memory: search requires a query\n" };
		const rows = repo.searchAllProjects(query, SEARCH_LIMIT);
		return { code: 0, text: renderSearchTable(rows) };
	}

	if (subcommand === "stats") {
		return { code: 0, text: renderStats(buildStatsView(repo)) };
	}

	if (subcommand === "doctor") {
		const purge = args.includes("--purge");
		const probe = probeSqlite();
		if (!probe.ok) {
			return { code: 1, text: `harness memory: sqlite / FTS5 unavailable: ${probe.error}\n` };
		}
		const view = runDoctor(repo, purge);
		const text = renderDoctor(view);
		if (view.drift && !purge) return { code: 1, text };
		return { code: 0, text };
	}

	if (subcommand === "import-lessons") {
		const dryRun = args.includes("--dry-run");
		const report = opts.importFn(repo, opts.projectId, opts.importLessonsFile, { dryRun });
		const lines = [
			`imported: ${report.imported}`,
			`skipped: ${report.skipped}`,
			`total: ${report.total}`,
			`malformed: ${report.malformed}`,
		];
		if (dryRun) lines.unshift("dry-run (nada escrito):");
		return { code: 0, text: `${lines.join("\n")}\n` };
	}

	return { code: 2, text: `harness memory: unknown subcommand '${subcommand}'\n${MEMORY_HELP}` };
}
