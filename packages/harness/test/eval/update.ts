// eval/update.ts — `--update`: grava baselines + regenera goldens (F23 D6).
//
// Explícito e humano (padrão gentle-ai): NUNCA roda em CI (recusa com
// CI=true) e nunca autocorrige em PR — o fluxo canônico é
// `bun run eval:ratchet` (vermelho com instrução) → decisão humana →
// `bun run eval:ratchet --update` → PR com código + baseline (diff revisado).
//
// O que atualiza (D6): (1) known-failures.txt — estado ATUAL das falhas
// (entradas que sumiram são removidas — o aviso vira remoção explícita;
// falha que ainda ocorre nunca é removida), (2) command-coverage.txt —
// cobertura atual (congela extras), (3) os 5 goldens — regravados do render
// atual. Serialização e ordenação são as MESMAS da comparação (sort.ts/
// normalize.ts/ratchet.ts) — o baseline gravado é exatamente o que o
// ratchet compara.
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeMessage } from "../../src/eval/normalize.ts";
import { goldenDefs } from "./goldens.ts";
import {
  COVERAGE_HEADER,
  KNOWN_FAILURES_HEADER,
  coverageIdentity,
  failureIdentity,
  parseBaselineLines,
  serializeBaseline,
  type RatchetEvidence,
} from "./ratchet.ts";

export class UpdateRefusedError extends Error {}

/** Recusa explícita do --update em CI (D6 — nunca autocorreção em PR). */
export function assertUpdateAllowed(): void {
  const ci = process.env.CI;
  if (ci === "true" || ci === "1") {
    throw new UpdateRefusedError(
      "--update é humano e explícito; CI=true detectado — recusado (nunca autocorreção em PR). Rode localmente e revise o diff.",
    );
  }
}

export interface BaselineDiff {
  baseline: string;
  added: number;
  removed: number;
  unchanged: number;
}

/** Identidades atuais de falha (fail apenas; fail-infra excluído — D3). */
export function currentFailures(evidence: RatchetEvidence): Set<string> {
  const set = new Set<string>();
  for (const result of evidence.results ?? []) {
    if (result.status !== "fail") continue;
    set.add(failureIdentity(result.testFile, result.testName, normalizeMessage(result.message)));
  }
  return set;
}

/** Identidades atuais de cobertura (canônicas — D1). */
export function currentCoverage(evidence: RatchetEvidence): Set<string> {
  const set = new Set<string>();
  for (const entry of evidence.coverage ?? []) {
    set.add(coverageIdentity(entry.command, entry.flags ?? []));
  }
  return set;
}

function writeBaseline(file: string, header: string, current: Set<string>): BaselineDiff {
  const previous = parseBaselineLines(readFileSafe(file));
  const next = serializeBaseline(header, current);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, "utf8");
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const id of current) {
    if (previous.has(id)) unchanged++;
    else added++;
  }
  for (const id of previous) {
    if (!current.has(id)) removed++;
  }
  return { baseline: path.basename(file), added, removed, unchanged };
}

/** Regenera os 5 goldens do render atual. Retorna os nomes escritos. */
export function updateGoldens(goldenDir: string): string[] {
  const written: string[] = [];
  fs.mkdirSync(goldenDir, { recursive: true });
  for (const def of goldenDefs()) {
    fs.writeFileSync(path.join(goldenDir, def.name), def.render(), "utf8");
    written.push(def.name);
  }
  return written;
}

export interface UpdateReport {
  baselines: BaselineDiff[];
  goldens: string[];
  lines: string[];
}

/** Executa o update completo (baselines + goldens) e reporta o que mudou. */
export function updateAll(evidence: RatchetEvidence, baselineDir: string, goldenDir: string): UpdateReport {
  const failures = currentFailures(evidence);
  const coverage = currentCoverage(evidence);

  const knownDiff = writeBaseline(path.join(baselineDir, "known-failures.txt"), KNOWN_FAILURES_HEADER, failures);
  const coverageDiff = writeBaseline(path.join(baselineDir, "command-coverage.txt"), COVERAGE_HEADER, coverage);
  const goldens = updateGoldens(goldenDir);

  const lines: string[] = [];
  lines.push("runecraft harness — ratchet --update");
  lines.push(`known-failures: ${knownDiff.added} adicionadas, ${knownDiff.removed} removidas, ${knownDiff.unchanged} inalteradas`);
  lines.push(`command-coverage: ${coverageDiff.added} adicionadas, ${coverageDiff.removed} removidas, ${coverageDiff.unchanged} inalteradas`);
  lines.push(`goldens regenerados (${goldens.length}): ${goldens.join(", ")}`);
  lines.push("diff completo na PR (git) — revise antes de commitar");
  return { baselines: [knownDiff, coverageDiff], goldens, lines };
}

function readFileSafe(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
