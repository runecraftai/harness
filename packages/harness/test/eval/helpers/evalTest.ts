// eval/helpers/evalTest.ts — wrapper de evidência para o F23 (D10).
//
// Contrato (alinhado 2026-08-05): por test file, o wrapper grava JSONL
// parcial em test/eval/evidence/partial/<testFile>.jsonl (append — workers
// do bun escrevem arquivos distintos, sem escrita concorrente). Cada linha:
//   {testFile, testName, status: pass|fail|fail-infra, message: CRUA,
//    durationMs, evalId, runId}
// A normalização da message é responsabilidade ÚNICA do F23 (normalize.ts) —
// aqui ela é gravada crua, sem paths/portas/timestamps substituídos.
//
// `runId` identifica o run do processo (worker): o merge agrupa por runId e
// usa o grupo MAIS RECENTE — runs locais acumulados no partial/ não poluem o
// last-run.json (o CI regenera a cada run; local, o último run vence).
//
// fail-infra é classificado pelo setup.ts (env de bun/node, git ausente,
// rede fora de 127.0.0.1) — não é regressão da suite.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFailure } from "../setup.ts";

export const EVAL_EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../evidence");
export const EVAL_PARTIAL_DIR = path.join(EVAL_EVIDENCE_DIR, "partial");

export interface EvalEvidenceLine {
  testFile: string;
  testName: string;
  status: "pass" | "fail" | "fail-infra";
  message: string;
  durationMs: number;
  evalId?: string;
  runId: string;
}

export interface EvalTestOptions {
  /** ID da matriz (EVAL-00N) quando o teste é um fluxo da camada 2 (D9). */
  evalId?: string;
  /** comando/flag cobertos (D10 — coverage[] do merge). */
  coverage?: Array<{ command: string; flags: string[] }>;
}

/** runId do worker: timestamp YYYYMMDD-HHmmss (o merge pega o grupo mais recente). */
const RUN_ID = (() => {
  const now = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
})();

/** Nome do arquivo de teste CHAMADOR (primeiro frame .test.ts fora dos helpers). */
function callerTestFile(): string {
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  for (const frame of stack) {
    // bun: "/abs/path/file.test.ts:12:3"; node: "file:///abs/path/file.test.ts:12:3".
    const match = frame.match(/(?:file:\/\/)?([^()\s]+\.test\.ts):\d+:\d+/);
    if (match && match[1]) {
      const p = match[1].replace(/^\//, "");
      if (p.includes("test/")) return p.slice(p.indexOf("test/"));
      return p;
    }
  }
  return "test/eval/unknown.test.ts";
}

/**
 * Roda fn com evidência: falha → status fail (ou fail-infra se o setup
 * classificar o ambiente como quebrado); sucesso → pass. A linha JSONL é
 * sempre gravada (a evidência parcial nunca mascara crash — o exit != 0 do
 * bun test já torna o run vermelho no CI).
 */
export async function evalTest(
  name: string,
  fn: () => Promise<void>,
  opts: EvalTestOptions = {},
): Promise<void> {
  const started = Date.now();
  const line: EvalEvidenceLine = {
    testFile: callerTestFile(),
    testName: name,
    status: "pass",
    message: "",
    durationMs: 0,
    runId: RUN_ID,
    ...(opts.evalId ? { evalId: opts.evalId } : {}),
  };
  for (const cov of opts.coverage ?? []) {
    recordCoverage(cov.command, cov.flags);
  }
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    line.status = classifyFailure(error, message);
    line.message = message;
  } finally {
    line.durationMs = Date.now() - started;
    appendEvidence(line);
  }
  // A evidência é gravada mesmo em falha, mas a falha NUNCA é engolida:
  // o teste precisa ficar vermelho no bun test (exit != 0 = PR bloqueada).
  if (line.status !== "pass") {
    throw new Error(line.message || "eval test falhou");
  }
}

function appendEvidence(line: EvalEvidenceLine): void {
  fs.mkdirSync(EVAL_PARTIAL_DIR, { recursive: true });
  const file = path.join(EVAL_PARTIAL_DIR, `${path.basename(line.testFile)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
}

const coverageSeen = new Set<string>();

/** D10 — coverage[] do last-run.json: acumula (command, flags) no processo. */
export function recordCoverage(command: string, flags: string[] = []): void {
  const key = JSON.stringify({ command, flags });
  if (coverageSeen.has(key)) return;
  coverageSeen.add(key);
  fs.mkdirSync(EVAL_PARTIAL_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(EVAL_PARTIAL_DIR, "coverage.jsonl"),
    `${JSON.stringify({ command, flags, runId: RUN_ID })}\n`,
    "utf8",
  );
}
