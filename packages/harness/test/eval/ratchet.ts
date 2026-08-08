// eval/ratchet.ts — núcleo de comparação (F23 D3): métricas a/b/c.
//
// Regras (fail-only-on-worse; aviso nunca muda exit code):
//   known-failures : entrada NOVA = FAIL (regressão real) · congelada = verde
//                    (listada) · sumida = aviso ("rode --update")
//   command-coverage: atual ⊇ baseline; FALTANDO = FAIL · extra = aviso
//   goldens        : render ≠ golden = FAIL com unified diff (byte a byte)
// fail-infra (classificação do F21 setup.ts) é EXCLUÍDO do ratchet (D3 —
// mesmo contrato do fail (infra) do F22).
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeMessage } from "../../src/eval/normalize.ts";
import { sortLines } from "../../src/eval/sort.ts";
import { parseBaselineLines } from "../../src/eval/baselines.ts";
import { unifiedDiff } from "./diff.ts";
import { countLines, goldenDefs, readGolden, type GoldenDef } from "./goldens.ts";

export interface RatchetResult {
  testFile: string;
  testName: string;
  status: string;
  message: string;
}

export interface RatchetCoverage {
  command: string;
  flags: string[];
}

export interface RatchetEvidence {
  results: RatchetResult[];
  coverage: RatchetCoverage[];
  harnessVersion?: string;
  runId?: string;
  meta?: { total?: number; pass?: number; fail?: number; failInfra?: number };
}

export interface SetComparison {
  /** presente nos dois lados (falha congelada / comando coberto). */
  matched: string[];
  /** só no atual (falha nova / cobertura extra). */
  added: string[];
  /** só no baseline (falha sumida / comando que deixou de ser coberto). */
  removed: string[];
}

/** Identidade estável de falha (D2): testFile<TAB>testName<TAB>mensagem
 *  normalizada — nunca linha crua; sem tabs/newlines dentro dos campos. */
export function failureIdentity(testFile: string, testName: string, normalizedMessage: string): string {
  const file = testFile.replace(/[\t\n\r]/g, " ");
  const name = testName.replace(/[\t\n\r]/g, " ");
  return `${file}\t${name}\t${normalizedMessage}`;
}

/** Nome canônico de flag: sem os traços iniciais, sem o valor (`--preset=x`
 *  → `preset`); argv sem traço inicial é valor → null (removido, D1). */
export function canonicalFlagName(flag: string): string | null {
  if (!flag.startsWith("-")) return null;
  const name = flag.replace(/^-+/, "").split("=")[0] ?? "";
  return name === "" ? null : name;
}

/** Cobertura canônica: comando limpo + nomes de flags ordenados e dedupados. */
/** Número de arquivos de teste DISTINTOS com evidência (piso de completude —
 *  fix cleric F23: evidência parcial de uma sub-suite não prova que a suite
 *  inteira rodou; comparar contra baselines com evidência incompleta daria
 *  verde falso). */
export function distinctEvidenceFiles(results: RatchetEvidence["results"]): number {
  return new Set(results.map((r) => r.testFile)).size;
}

/** Checa o piso: retorna mensagem de erro ou null (completa). */
export function assertEvidenceComplete(results: RatchetEvidence["results"], minFiles: number): string | null {
  const files = distinctEvidenceFiles(results);
  if (files < minFiles) {
    return `evidência INCOMPLETA — ${files}/${minFiles} arquivos de teste com evidência; rode a SUITE COMPLETA (evidência parcial não compara)`;
  }
  return null;
}

export function canonicalCoverage(command: string, flags: string[]): { command: string; flags: string[] } {
  const names = new Set<string>();
  for (const flag of flags) {
    const name = canonicalFlagName(flag);
    if (name !== null) names.add(name);
  }
  return { command: command.replace(/[\t\n\r]/g, " "), flags: sortLines(names) };
}

/** Identidade de cobertura: `comando<TAB>flags (espaço-separadas)`. */
export function coverageIdentity(command: string, flags: string[]): string {
  const canonical = canonicalCoverage(command, flags);
  return `${canonical.command}\t${canonical.flags.join(" ")}`;
}

export { KNOWN_FAILURES_HEADER, COVERAGE_HEADER, parseBaselineLines, serializeBaseline } from "../../src/eval/baselines.ts";

/** Comparação de conjuntos ordenada (colação pinada — D2). */
export function compareSets(current: Set<string>, baseline: Set<string>): SetComparison {
  const matched: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of current) {
    if (baseline.has(id)) matched.push(id);
    else added.push(id);
  }
  for (const id of baseline) {
    if (!current.has(id)) removed.push(id);
  }
  return { matched: sortLines(matched), added: sortLines(added), removed: sortLines(removed) };
}

export interface GoldenCheck {
  name: string;
  ok: boolean;
  maxLines: number;
  actualLines: number;
  /** diff unificado quando o CONTEÚDO diverge; "" quando byte-igual. */
  diff: string;
  /** true quando a divergência é só de tamanho (byte-igual acima do limite). */
  sizeOnly: boolean;
}

/** Compara o render atual contra o golden (byte a byte, diff revisável). */
export function checkGolden(def: GoldenDef, goldenDir: string): GoldenCheck {
  const actual = def.render();
  const actualLines = countLines(actual);
  let golden: string;
  try {
    golden = readGolden(def.name, goldenDir);
  } catch {
    // golden ausente = drift total (FAIL) — o diff mostra o render inteiro.
    golden = "";
  }
  const equal = actual === golden;
  const sizeOk = actualLines <= def.maxLines;
  const diff = equal ? "" : unifiedDiff(`golden/${def.name}`, `atual (${def.name})`, golden, actual);
  return { name: def.name, ok: equal && sizeOk, maxLines: def.maxLines, actualLines, diff, sizeOnly: equal && !sizeOk };
}

export interface RatchetOptions {
  baselineDir: string;
  goldenDir: string;
}

export interface RatchetReport {
  ok: boolean;
  failureComp: SetComparison;
  coverageComp: SetComparison;
  goldenChecks: GoldenCheck[];
  failInfraCount: number;
  evidenceRunId: string;
  evidenceHarnessVersion: string;
  /** linhas do relatório (impressas pelo runner). */
  lines: string[];
}

/** Roda a comparação completa (métricas a/b/c) contra a evidência. */
export function runRatchet(evidence: RatchetEvidence, opts: RatchetOptions): RatchetReport {
  const failures = new Set<string>();
  let failInfraCount = 0;
  for (const result of evidence.results ?? []) {
    if (result.status === "fail-infra") {
      failInfraCount++;
      continue;
    }
    if (result.status === "fail") {
      failures.add(failureIdentity(result.testFile, result.testName, normalizeMessage(result.message)));
    }
  }

  const coverage = new Set<string>();
  for (const entry of evidence.coverage ?? []) {
    coverage.add(coverageIdentity(entry.command, entry.flags ?? []));
  }

  const failureComp = compareSets(failures, parseBaselineLines(readFileSafe(path.join(opts.baselineDir, "known-failures.txt"))));
  const coverageComp = compareSets(coverage, parseBaselineLines(readFileSafe(path.join(opts.baselineDir, "command-coverage.txt"))));
  const goldenChecks = goldenDefs().map((def) => checkGolden(def, opts.goldenDir));

  const ok =
    failureComp.added.length === 0 && coverageComp.removed.length === 0 && goldenChecks.every((g) => g.ok);

  const lines = buildReportLines(evidence, { ok, failureComp, coverageComp, goldenChecks, failInfraCount });
  return {
    ok,
    failureComp,
    coverageComp,
    goldenChecks,
    failInfraCount,
    evidenceRunId: evidence.runId ?? "?",
    evidenceHarnessVersion: evidence.harnessVersion ?? "?",
    lines,
  };
}

function buildReportLines(
  evidence: RatchetEvidence,
  r: { ok: boolean; failureComp: SetComparison; coverageComp: SetComparison; goldenChecks: GoldenCheck[]; failInfraCount: number },
): string[] {
  const out: string[] = [];
  const total = evidence.results?.length ?? 0;
  const pass = evidence.results?.filter((x) => x.status === "pass").length ?? 0;
  const fail = evidence.results?.filter((x) => x.status === "fail").length ?? 0;
  out.push("runecraft harness — ratchet de não-regressão (métricas a/b/c, F23 P1)");
  out.push(`evidência: runId ${evidence.runId ?? "?"} · harness ${evidence.harnessVersion ?? "?"} · ${total} resultados (${pass} pass, ${fail} fail, ${r.failInfraCount} fail-infra excluídas)`);

  out.push(
    `known-failures: ${r.failureComp.matched.length} congeladas · ${r.failureComp.added.length} novas (FAIL) · ${r.failureComp.removed.length} saíram (aviso)`,
  );
  for (const id of r.failureComp.added) out.push(`  FALHA NOVA: ${id}`);
  for (const id of r.failureComp.matched) out.push(`  congelada: ${id}`);
  for (const id of r.failureComp.removed) out.push(`  ⓘ aviso: ${id} saiu do baseline — rode bun run eval:ratchet --update`);

  out.push(
    `command-coverage: ${r.coverageComp.matched.length}/${r.coverageComp.matched.length + r.coverageComp.removed.length} cobertos · ${r.coverageComp.removed.length} faltando (FAIL) · ${r.coverageComp.added.length} extras (aviso)`,
  );
  for (const id of r.coverageComp.removed) out.push(`  FALTANDO: ${id}`);
  for (const id of r.coverageComp.added) out.push(`  ⓘ aviso: ${id} extra — rode bun run eval:ratchet --update`);

  const goldenOk = r.goldenChecks.filter((g) => g.ok).length;
  out.push(`goldens: ${goldenOk}/${r.goldenChecks.length} idênticos`);
  for (const g of r.goldenChecks) {
    if (g.ok) continue;
    if (g.sizeOnly) {
      out.push(`  GOLDEN ACIMA DO LIMITE: ${g.name} (${g.actualLines} linhas; limite ${g.maxLines})`);
      continue;
    }
    out.push(`  GOLDEN DIVERGE: ${g.name} (${g.actualLines} linhas atual; limite ${g.maxLines})`);
    for (const diffLine of g.diff.split("\n").filter(Boolean)) out.push(`    ${diffLine}`);
  }
  out.push(r.ok ? "→ VERDE (exit 0)" : "→ VERMELHO (exit 1) — regressão; se conhecida, rode bun run eval:ratchet --update (nunca em CI)");
  return out;
}

function readFileSafe(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
