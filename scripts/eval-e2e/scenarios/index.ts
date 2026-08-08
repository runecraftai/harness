// eval-e2e/scenarios/index.ts — registro dos cenários (ordem fixa: 00 primeiro).
//
// Extensível por arquivo (D1): adicionar um cenário = criar
// scripts/eval-e2e/scenarios/NN-nome.ts com `export default ScenarioModule` —
// o loader abaixo o inclui automaticamente (fs + dynamic import, ordem
// lexicográfica do nome). O runner valida que o cenário 0 está marcado como
// sanity (E2EV-03) e aborta caso contrário.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScenarioModule } from "../types.ts";

const SCENARIO_RE = /^\d{2}-[a-z0-9-]+\.ts$/;

/** Carrega os cenários em ordem fixa (00 primeiro). Nunca lança em vazio. */
export async function loadScenarios(): Promise<ScenarioModule[]> {
	const dir = import.meta.dir;
	const files = fs
		.readdirSync(dir)
		.filter((f) => SCENARIO_RE.test(f))
		.sort();
	const scenarios: ScenarioModule[] = [];
	for (const file of files) {
		const mod = (await import(path.join(dir, file))) as { default?: ScenarioModule };
		if (typeof mod.default?.run !== "function") {
			throw new Error(`cenário inválido em ${file} — exporte um ScenarioModule como default`);
		}
		scenarios.push(mod.default);
	}
	return scenarios;
}
