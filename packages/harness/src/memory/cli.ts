// memory/cli.ts — comandos de inspeção/manutenção da memória (D8, MEM-07).
//
// Port do bin/runes.ts (search/stats/doctor [--purge]) + o bridge
// import-lessons (D7). Os comandos são PUROS: recebem um
// Repository + sinks e devolvem texto/exit code — a abertura do DB vive no
// caller (commands/memory.ts), com RUNECRAFT_MEMORY_DATA_DIR como override
// de path (evals/CLI testável).
//
// Exit codes (port do bin): 0 ok · 1 erro/drift (também drift restante após --purge) · 2 uso errado.
import { getDriver } from "./client.ts";
import type { IndexCounts, MaintenanceReceipt } from "./repository.ts";

/** FTS5 disponível? (probe — port do probeSqlite do bin; F35: driver ativo). */
export function probeSqlite(): { ok: boolean; driver?: "bun" | "node"; error?: string } {
	try {
		const driver = getDriver();
		const probe = driver.open(":memory:");
		probe.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
		probe.close();
		return { ok: true, driver: driver.name };
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
	/** Index disagrees with the table: row counts differ OR indexed content differs. */
	drift: boolean;
	/** Live rows whose FTS row is missing/different, plus FTS rows with no live row — independent of counts. */
	contentMismatches: number;
	/** Present only when --purge ran; measured from the store, not from the request. */
	rebuildResult?: MaintenanceReceipt;
}

export interface DoctorRepo {
	/** memories/fts/mismatch counts from one snapshot. */
	indexCounts(): IndexCounts;
	/** Purge + rebuild + re-measure atomically (one write transaction). */
	purgeAndRebuild(): MaintenanceReceipt;
}

/**
 * Checks the FTS index against the base table: row counts AND per-row indexed
 * content. It does NOT verify base-table content, source truth, or SQLite page
 * integrity (a flipped byte in `memories` passes) — see renderDoctor.
 */
export function runDoctor(repo: DoctorRepo, purge: boolean): DoctorView {
	const { memories, fts, mismatches: contentMismatches } = repo.indexCounts();
	const drift = memories !== fts || contentMismatches > 0;
	if (purge) {
		const receipt = repo.purgeAndRebuild();
		return {
			memories,
			fts,
			drift: receipt.liveRetained !== receipt.ftsAfter || receipt.mismatchesAfter > 0,
			contentMismatches,
			rebuildResult: receipt,
		};
	}
	return { memories, fts, drift, contentMismatches };
}

export const DOCTOR_SCOPE_NOTE =
	"checked: live row count vs index, and indexed text vs table text for each live row. " +
	"not checked: whether the stored memory text itself is correct or unaltered, SQLite page integrity (PRAGMA integrity_check), the content of soft-deleted rows (an index row left behind for one still counts as drift).";

export function renderDoctor(view: DoctorView): string {
	const lines = [`memories (live): ${view.memories}`, `memories_fts:    ${view.fts}`];
	if (view.contentMismatches > 0) lines.push(`index rows differing from table: ${view.contentMismatches}`);
	if (view.rebuildResult) {
		const r = view.rebuildResult;
		lines.push(`rebuilt memories_fts: ${r.ftsAfter}`);
		lines.push(`purged soft-deleted rows: ${r.purged} (all projects)`);
		lines.push(`soft-deleted rows not removed: ${r.notRemoved}`);
		lines.push(`live rows retained: ${r.liveRetained}`);
		lines.push("fts index rebuilt");
		if (view.drift) lines.push("", `Drift remains after rebuild (${r.mismatchesAfter} differing index row(s)).`);
	} else if (view.drift) {
		lines.push("", "Drift detected. Run `harness memory doctor --purge` to rebuild.");
	} else {
		lines.push("", "memory: healthy (index matches table)");
	}
	lines.push("", DOCTOR_SCOPE_NOTE);
	return `${lines.join("\n")}\n`;
}

export const MEMORY_HELP = `harness memory — inspect the project's persistent memory

Usage:
  harness memory search <query>        Search memories (prints a markdown table)
  harness memory stats                 Show per-category counts
  harness memory doctor [--purge]      Check the FTS index against the table (counts + indexed text; not table content or SQLite integrity);
                                        with --purge, hard-delete soft-deleted rows (all projects), rebuild the index, report removed/not removed
  harness memory import-lessons [--dry-run]  Import F28 promoted lessons (idempotent)
                                        A changed lesson refreshes its stored copy; a lesson
                                        removed from the source revokes (soft-deletes) its copy.
                                        Deleting only the imported copy is NOT revocation — if the
                                        lesson is still in the source, the next import recreates it.
                                        Long lessons are capped at 4000 chars; "truncated" in the
                                        report counts how many lines lost content to that cap.
  harness memory help                  Show this help
`;

/** Report shape returned by ImportFn — carried on the result so callers
 * (e.g. the JSON renderer) don't have to re-run the import to see it. */
export interface ImportReportView {
	imported: number;
	skipped: number;
	updated: number;
	revoked: number;
	total: number;
	malformed: number;
	truncated: number;
}

export type MemoryCliResult =
	| { code: 0; text: string; report?: ImportReportView; doctor?: DoctorView }
	| { code: 1; text: string; report?: ImportReportView; doctor?: DoctorView }
	| { code: 2; text: string; report?: ImportReportView; doctor?: DoctorView };

/** Assinatura da bridge (importLessons do import-lessons.ts). */
export interface ImportFn {
	(
		repo: import("./repository.ts").Repository,
		projectId: number,
		lessonsFile: string,
		opts: { dryRun?: boolean },
	): {
		imported: number;
		skipped: number;
		updated: number;
		revoked: number;
		total: number;
		malformed: number;
		truncated: number;
	};
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
		if (view.drift) return { code: 1, text, doctor: view };
		return { code: 0, text, doctor: view };
	}

	if (subcommand === "import-lessons") {
		const dryRun = args.includes("--dry-run");
		const report = opts.importFn(repo, opts.projectId, opts.importLessonsFile, { dryRun });
		const lines = [
			`imported: ${report.imported}`,
			`skipped: ${report.skipped}`,
			`updated: ${report.updated}`,
			`revoked: ${report.revoked}`,
			`total: ${report.total}`,
			`malformed: ${report.malformed}`,
			`truncated: ${report.truncated}`,
		];
		if (report.truncated > 0) {
			lines.push(`note: ${report.truncated} lesson(s) exceeded the 4000-char cap on antiPattern+preferred — guidance may be cut off.`);
		}
		if (dryRun) lines.unshift("dry-run (nada escrito):");
		return { code: 0, text: `${lines.join("\n")}\n`, report };
	}

	return { code: 2, text: `harness memory: unknown subcommand '${subcommand}'\n${MEMORY_HELP}` };
}
