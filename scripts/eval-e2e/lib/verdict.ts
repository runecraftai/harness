// eval-e2e/lib/verdict.ts — framework de checks determinísticos (D3).
//
// Vereditos são do HARNESS, nunca do modelo: pass/fail vem de checks
// objetivos (fs/git/estado/transcript); conteúdo de findings/review do LLM
// vai para `notes` sem julgamento.
import type { Check } from "../types.ts";

/** Constrói um check (veredito binário + evidência curta). */
export function check(id: string, ok: boolean, detail?: string): Check {
	return { id, ok, detail };
}

export function allPass(checks: Check[]): boolean {
	return checks.every((c) => c.ok);
}

/** Lista os checks que falharam (ids) — para a nota/status. */
export function failedChecks(checks: Check[]): Check[] {
	return checks.filter((c) => !c.ok);
}
