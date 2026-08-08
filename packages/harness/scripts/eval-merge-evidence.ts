// scripts/eval-merge-evidence.ts — partial/*.jsonl → last-run.json (D10).
//
// Contrato para o F23 (ratchets): test/eval/evidence/last-run.json com
// {schema, schemaVersion, suite, suiteVersion, runner, runId, results[],
//  coverage[], harnessVersion}. A identidade é a mesma dos dois lados — este
// script grava EXATAMENTE o que o F23 compara (mensagem crua; a normalização
// é responsabilidade ÚNICA do normalize.ts do F23).
//
// Uso: bun scripts/eval-merge-evidence.ts [--stdout]
//   --stdout  imprime o JSON em vez de gravar (debug).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_DIR = path.join(PACKAGE_ROOT, "test", "eval", "evidence");
const PARTIAL_DIR = path.join(EVIDENCE_DIR, "partial");
const LAST_RUN = path.join(EVIDENCE_DIR, "last-run.json");
const MATRIX_PATH = path.join(PACKAGE_ROOT, "test", "EVAL-MATRIX.md");
const PACKAGE_JSON = path.join(PACKAGE_ROOT, "package.json");

interface PartialLine {
  testFile: string;
  testName: string;
  status: "pass" | "fail" | "fail-infra";
  message: string;
  durationMs: number;
  evalId?: string;
  runId?: string;
}

function matrixSuiteVersion(): string {
  try {
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    const match = matrix.match(/MATRIX_VERSION:\s*(\d+)/);
    return match ? (match[1] ?? "0") : "0";
  } catch {
    return "0";
  }
}

function harnessVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

function headSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return "nogit";
  }
}

function runId(): string {
  const now = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${headSha()}`;
}

function runner(): { bun: string; node: string } {
  return {
    bun: typeof Bun !== "undefined" ? Bun.version : "unknown",
    node: process.versions.node,
  };
}

function readPartialLines(): PartialLine[] {
  if (!fs.existsSync(PARTIAL_DIR)) return [];
  const lines: PartialLine[] = [];
  for (const file of fs.readdirSync(PARTIAL_DIR).filter((f) => f.endsWith(".jsonl") && f !== "coverage.jsonl").sort()) {
    const text = fs.readFileSync(path.join(PARTIAL_DIR, file), "utf8");
    for (const raw of text.split("\n").filter(Boolean)) {
      try {
        lines.push(JSON.parse(raw) as PartialLine);
      } catch {
        // linha corrompida (crash no meio do write) — o run fica vermelho no CI
        // de qualquer forma; a evidência parcial não mascara (D10).
        lines.push({
          testFile: file,
          testName: "(jsonl corrompido)",
          status: "fail-infra",
          message: `linha JSONL inválida em partial/${file}`,
          durationMs: 0,
          runId: `corrupt-${Date.now()}`,
        });
      }
    }
  }
  return lines;
}

/** Maioria dos runs do processo atual (runId numérico = ms + pid). */
function latestRunId(lines: PartialLine[]): string {
  if (lines.length === 0) return runId();
  const groups = new Map<string, number>();
  for (const line of lines) {
    const id = line.runId ?? "";
    groups.set(id, (groups.get(id) ?? 0) + 1);
  }
  // O run mais recente é o com maior prefixo-timestamp (YYYYMMDD-HHmmss) e
  // mais linhas (o run atual do processo é o grupo dominante do partial/).
  const sorted = [...groups.entries()].sort((a, b) => {
    const tsA = Number(a[0].replace(/[-:]/g, "") ?? 0);
    const tsB = Number(b[0].replace(/[-:]/g, "") ?? 0);
    return tsB - tsA || b[1] - a[1];
  });
  return sorted[0]?.[0] ?? runId();
}

function readCoverage(runIdFilter: string): Array<{ command: string; flags: string[] }> {
  const file = path.join(PARTIAL_DIR, "coverage.jsonl");
  if (!fs.existsSync(file)) return [];
  const out: Array<{ command: string; flags: string[] }> = [];
  const seen = new Set<string>();
  for (const raw of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    try {
      const parsed = JSON.parse(raw) as { command: string; flags: string[]; runId?: string };
      if ((parsed.runId ?? "") !== runIdFilter) continue;
      const key = JSON.stringify({ command: parsed.command, flags: parsed.flags ?? [] });
      if (seen.has(key) || typeof parsed.command !== "string") continue;
      seen.add(key);
      out.push({ command: parsed.command, flags: parsed.flags ?? [] });
    } catch {
      // linha corrompida — ignora (coverage é informativo)
    }
  }
  return out;
}

function buildLastRun(): Record<string, unknown> {
  const allLines = readPartialLines();
  const resultsRunId = latestRunId(allLines);
  const results = allLines.filter((l) => (l.runId ?? "") === resultsRunId);
  const coverage = readCoverage(resultsRunId);
  return {
    schema: "runecraft-eval-evidence",
    schemaVersion: 1,
    suite: "eval-deterministic",
    suiteVersion: matrixSuiteVersion(),
    runner: runner(),
    // Contrato do design: <YYYYMMDD-HHmmss>-<sha curto do head>.
    runId: `${resultsRunId}-${headSha()}`,
    harnessVersion: harnessVersion(),
    coverage,
    results,
    meta: {
      total: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      failInfra: results.filter((r) => r.status === "fail-infra").length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Merge das evidências parciais → last-run.json (contrato AD-015, F23).
 * Exportado para o runner do ratchet (F23) re-mergear sempre antes de
 * comparar; o CLI abaixo preserva o comportamento original byte a byte.
 */
export function writeLastRun(): string {
  const payload = JSON.stringify(buildLastRun(), null, 2);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(LAST_RUN, `${payload}\n`);
  return LAST_RUN;
}

/** Payload do merge (sem gravar) — usado pelo ratchet na comparação. */
export function mergeEvidence(): Record<string, unknown> {
  return buildLastRun();
}

if (import.meta.main) {
  const stdoutOnly = process.argv.includes("--stdout");
  if (stdoutOnly) {
    process.stdout.write(`${JSON.stringify(buildLastRun(), null, 2)}\n`);
  } else {
    writeLastRun();
    process.stdout.write(`last-run.json: ${LAST_RUN}\n`);
  }
}
