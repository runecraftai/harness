// memory/index.ts — exports públicos da camada de memória (F29).
export { openDatabase } from "./client.ts";
export { runMigrations, SCHEMA_VERSION, readSchemaVersion } from "./migrations.ts";
export { Repository, DEFAULT_CATEGORY_CAP, HARD_CAP_MULTIPLIER, SIGNAL_CANDIDATE_LIMIT, ValidationError } from "./repository.ts";
export { resolveProjectSlug, resolveProjectSlugSync, deriveSlugFromRemote, normalizeRemoteUrl, findGitRoot } from "./project.ts";
export { resolveMemoryDir, ensureMemoryDir, memoryDbPath } from "./paths.ts";
export { createToolsRecord, filterToolsByDisabled } from "./tools.ts";
export {
	defaultMemoryConfig,
	validateMemoryConfig,
	effectiveMemory,
	loadSessionMemory,
	memoryKillSwitch,
	SessionMemoryConfig,
	promotedLessonsPath,
} from "./config.ts";
export { importLessons, importLessonsFromLines, parseLessonLine, lessonWhereRef, LESSON_PRIORITY_IMPORTANCE } from "./import-lessons.ts";
export { probeSqlite, dispatchMemoryCli, renderSearchTable, renderStats, renderDoctor, runDoctor, buildStatsView } from "./cli.ts";
export { MEMORY_CATEGORIES } from "./types.ts";
export type { Memory, Session, Project, Stats, CompactionCandidate, CompactionSignal, MemoryCategory } from "./types.ts";
export type { MemoryConfig, SessionMemoryRuntime, ConfigValidation } from "./config.ts";
export type { ImportReport, LessonContract } from "./import-lessons.ts";
