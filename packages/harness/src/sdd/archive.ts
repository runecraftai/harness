// sdd/archive.ts — port do createArchivePlanTool (D9, PFC-09).
//
// Port FIEL do guild (guild/src/tools/archive-plan.ts — lido na íntegra):
// slug regex `^[a-z0-9-]+$`; move `<plansDir>/<slug>` →
// `<plansDir>/archive/<slug>` (mkdir recursive); retorno `{ok, warnings}`
// JSON; DI `rename` para teste (semântica source). Plans dir = `.runecraft/
// plans/` (convenção de sinks do harness — D9; src/plan.ts é presets de
// install do F11, NÃO é dir de planos — documentado).
//
// Plano ausente → ok:false + warning (nunca crash); slug inválido → recusa
// ANTES de qualquer IO. Idempotente: 2º run do mesmo slug → ok:false (plano
// ausente — já arquivado).
import * as fs from "node:fs";
import * as path from "node:path";

/** Slug válido (port do source). */
export const SLUG_REGEX = /^[a-z0-9-]+$/;

/** Plans dir do harness (convenção de sinks — D9). */
export function plansDir(cwd: string): string {
	return path.join(cwd, ".runecraft", "plans");
}

export interface ArchivePlanOutput {
	ok: boolean;
	warnings: string[];
}

export interface ArchivePlanDeps {
	/** root do repo (o plans dir fica em <root>/.runecraft/plans). */
	cwd: string;
	/** DI de rename para teste (semântica source). */
	rename?: (from: string, to: string) => void;
}

/**
 * Arquiva um plano: valida o slug → move <plansDir>/<slug> →
 * <plansDir>/archive/<slug> → {ok, warnings} (port fiel). NUNCA crasha.
 */
export function archivePlan(deps: ArchivePlanDeps, slug: string): ArchivePlanOutput {
	const warnings: string[] = [];
	const rename = deps.rename ?? ((from, to) => fs.renameSync(from, to));

	if (!SLUG_REGEX.test(slug)) {
		return { ok: false, warnings: [`Invalid slug "${slug}". Must match ${SLUG_REGEX}`] };
	}

	const root = deps.cwd;
	const sourceDir = path.join(plansDir(root), slug);
	const archiveDir = path.join(plansDir(root), "archive");

	if (!fs.existsSync(sourceDir)) {
		return { ok: false, warnings: [`Plan directory not found: ${sourceDir}`] };
	}

	if (!fs.existsSync(archiveDir)) {
		try {
			fs.mkdirSync(archiveDir, { recursive: true });
		} catch (error) {
			return {
				ok: false,
				warnings: [`Failed to create archive dir: ${error instanceof Error ? error.message : String(error)}`],
			};
		}
	}

	const destDir = path.join(archiveDir, slug);
	try {
		rename(sourceDir, destDir);
		return { ok: true, warnings };
	} catch (error) {
		return {
			ok: false,
			warnings: [...warnings, `Failed to move: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
}
