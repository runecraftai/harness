// memory/paths.ts — resolução do diretório da memória (D1, MEM-04).
//
// `RUNECRAFT_MEMORY_DATA_DIR` (env — override usado pelos evals/CLI) ??
// `<sharedGitRoot | cwd>/.runecraft/memory` (QA-1a: DB por repo). O shared git
// root é o checkout PRINCIPAL: uma linked worktree resolve para o
// `.runecraft/memory` do checkout principal (resolveSharedGitRootSync — o
// `.git` de um worktree é um arquivo e não deve receber o DB, que sumiria com
// `git worktree remove`). `.runecraft/memory/` é gitignored (padrão dos demais
// sinks de runtime: events/ F28, continuation F27, verify-verdicts F25).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveSharedGitRootSync } from "./project.ts";

/** Dir da memória para um cwd (override por env vence — evals). */
export function resolveMemoryDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const override = env.RUNECRAFT_MEMORY_DATA_DIR;
	if (override && override.length > 0) {
		return override;
	}
	const gitRoot = resolveSharedGitRootSync(cwd);
	const base = gitRoot ?? cwd;
	return join(base, ".runecraft", "memory");
}

/** Garante o dir (mkdir recursive — precedente recordSessionVerdict F25). */
export function ensureMemoryDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const dir = resolveMemoryDir(cwd, env);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Caminho do arquivo DB (always `<memoryDir>/runes.db` — D1). */
export function memoryDbPath(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveMemoryDir(cwd, env), "runes.db");
}
