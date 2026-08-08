// eval/ratchet-run.ts — entry do `bun run eval:ratchet` (F23 D6/D7).
//
// Comparação (default, estritamente read-only) ou atualização (`--update`,
// humano e explícito — recusa com CI=true). O runner SEMPRE re-mergea a
// evidência parcial do F21 antes de comparar (contrato AD-015: last-run.json
// é efêmero/gitignored; o runner não confia em arquivo velho). Evidência
// ausente = FAIL com mensagem clara — nunca compara contra vazio em silêncio.
//
// Entry escolhido no Execute (D6): script TS próprio (não *.test.ts) —
// (1) `bun test` roda os arquivos de teste EM PARALELO; um runner .test.ts
// leria a evidência parcial ANTES da suite terminar (raça); (2) o script
// roda DEPOIS da suite no script `test` do package (chain com preservação de
// exit code) — sequenciamento determinístico integrado ao turbo test.
import { writeLastRun, mergeEvidence } from "../../scripts/eval-merge-evidence.ts";
import { runRatchet, assertEvidenceComplete, type RatchetEvidence } from "./ratchet.ts";
import { updateAll, assertUpdateAllowed, UpdateRefusedError } from "./update.ts";
import { GOLDEN_DIR } from "./goldens.ts";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const BASELINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "baselines");
const EVIDENCE_MISSING_MSG = "evidência não encontrada — suite F21 não rodou? (rode `bun test` ou `bun run test:eval` antes do ratchet)";
// Piso de completude (fix cleric F23): nº de arquivos de teste com evalTest()
// na suite completa (16 hoje — contagem em test/eval/evidence/partial/).
// Bump explícito quando um arquivo novo entra na evidência (revisão como golden).
// F26 (v4): +1 arquivo — test/eval/framework/constraint-adherence.test.ts (EVAL-014).
// F27 (v5): +1 arquivo — test/eval/framework/compaction-recovery.test.ts (EVAL-017..021).
// F28 (v6): +1 arquivo — test/eval/framework/observability.test.ts (EVAL-022..029).
// F29 (v7): +1 arquivo — test/eval/framework/memory.test.ts (EVAL-030..038).
// F30 (v8): +1 arquivo — test/eval/framework/pi.test.ts (EVAL-039..048).
const MIN_EVIDENCE_FILES = 18;

function print(lines: string[]): void {
  for (const line of lines) process.stdout.write(`${line}\n`);
}

function parseEvidence(payload: Record<string, unknown>): RatchetEvidence {
  const results = Array.isArray(payload.results) ? (payload.results as RatchetEvidence["results"]) : null;
  const coverage = Array.isArray(payload.coverage) ? (payload.coverage as RatchetEvidence["coverage"]) : null;
  if (results === null || coverage === null) {
    throw new Error(`evidência com schema inválido (results/coverage ausentes ou não-array): ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return {
    results,
    coverage,
    harnessVersion: typeof payload.harnessVersion === "string" ? payload.harnessVersion : undefined,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    meta: (payload.meta as RatchetEvidence["meta"]) ?? undefined,
  };
}

function main(): void {
  const wantUpdate = process.argv.includes("--update");

  // O merge sempre roda (grava last-run.json — contrato AD-015 efêmero).
  writeLastRun();
  const evidence = parseEvidence(mergeEvidence());

  if (wantUpdate) {
    try {
      assertUpdateAllowed();
    } catch (error) {
      if (error instanceof UpdateRefusedError) {
        process.stderr.write(`refusado: ${error.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    print(updateAll(evidence, BASELINE_DIR, GOLDEN_DIR).lines);
    process.exitCode = 0;
    return;
  }

  if (evidence.results.length === 0) {
    print(["runecraft harness — ratchet de não-regressão (métricas a/b/c, F23 P1)"]);
    print([`FAIL: ${EVIDENCE_MISSING_MSG}`]);
    print(["→ VERMELHO (exit 1)"]);
    process.exitCode = 1;
    return;
  }

  // Piso de completude: suite parcial (ex.: só layer1) tem resultados mas não
  // prova que tudo rodou — comparar com baselines nesse estado daria verde
  // falso (fix cleric F23).
  const incomplete = assertEvidenceComplete(evidence.results, MIN_EVIDENCE_FILES);
  if (incomplete !== null) {
    print(["runecraft harness — ratchet de não-regressão (métricas a/b/c, F23 P1)"]);
    print([`FAIL: ${incomplete}`]);
    print(["→ VERMELHO (exit 1)"]);
    process.exitCode = 1;
    return;
  }

  const report = runRatchet(evidence, { baselineDir: BASELINE_DIR, goldenDir: GOLDEN_DIR });
  print(report.lines);
  process.exitCode = report.ok ? 0 : 1;
}

main();
