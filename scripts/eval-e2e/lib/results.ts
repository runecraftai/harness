// eval-e2e/lib/results.ts — resultados versionados + datados (E2EV-02/E2EV-05, D4).
//
// Local fixo (spec — não muda): .specs/features/f22-e2e-benchmark/results/
// <harnessVersion>/<roundId>.json — mesma versão, 2 rodadas → 2 arquivos;
// bump de versão → dir novo. Escrita atômica por cenário (tmp + rename no
// mesmo dir): rodada interrompida preserva os cenários completos com
// `partial: true` + `interruptedAt` — nunca existe arquivo "pela metade".
//
// Serialização determinística: ordem fixa de campos + indent 2 + newline
// final — dado o mesmo input, bytes idênticos (testado offline).
import * as fs from "node:fs";
import * as path from "node:path";
import type { RoundResult } from "../types.ts";

/** roundId = timestamp ISO UTC do início da rodada, `:` → `-` (nome do arquivo). */
export function roundIdFromDate(date: Date): string {
	return date
		.toISOString()
		.replace(/\.\d{3}Z$/, "Z")
		.replace(/:/g, "-");
}

/** Caminho do arquivo da rodada: results/<harnessVersion>/<roundId>.json. */
export function roundPath(resultsRoot: string, harnessVersion: string, roundId: string): string {
	return path.join(resultsRoot, harnessVersion, `${roundId}.json`);
}

/** Serialização determinística do round (ordem fixa — D4). */
export function serializeRound(round: RoundResult): string {
	const out: Record<string, unknown> = {
		harnessVersion: round.harnessVersion,
		piVersion: round.piVersion,
		model: round.model,
		provider: round.provider,
		date: round.date,
		roundId: round.roundId,
		partial: round.partial,
		sanityFailed: round.sanityFailed,
		interruptedAt: round.interruptedAt,
		environment: round.environment,
		confounders: round.confounders,
		probe: round.probe,
		vendorHash: round.vendorHash,
		scenarios: round.scenarios.map((s) => ({
			id: s.id,
			name: s.name,
			status: s.status,
			durationMs: s.durationMs,
			tokensApprox: s.tokensApprox,
			verdict: s.verdict,
			notes: s.notes,
			confounders: s.confounders,
		})),
	};
	return `${JSON.stringify(out, null, 2)}\n`;
}

/** Escrita atômica (tmp + rename no mesmo dir — D4). */
export function writeRoundAtomic(resultsPath: string, round: RoundResult): void {
	const dir = path.dirname(resultsPath);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.${path.basename(resultsPath)}.tmp`);
	fs.writeFileSync(tmp, serializeRound(round), "utf8");
	fs.renameSync(tmp, resultsPath);
}

/** Lê uma rodada (para o runner/relatórios). null quando o arquivo não existe. */
export function readRound(resultsPath: string): RoundResult | null {
	if (!fs.existsSync(resultsPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(resultsPath, "utf8")) as RoundResult;
	} catch {
		return null;
	}
}
