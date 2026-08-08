// matrix-consistency.test.ts — D9: EVAL-MATRIX.md aditivo ↔ testes da camada 2.
//
// Regra: todo EVAL-<n> na matriz tem um teste de fluxo na camada 2 que o
// referencia; todo teste de fluxo referencia um EVAL-<n> presente na matriz.
// EVAL-003 é FORA da camada 2 (revisão 2026-08-05, I1) — não pode aparecer
// nem na matriz nem como evalId de teste. Uma entrada órfã quebra este teste
// (a política aditiva — nada sai sem AD — é o espelho reverso: entrada nova
// SEM teste = matriz mente; teste novo SEM entrada = cobertura invisível).
//
// v5 (F27, AD-027): a lane do F27 (test/eval/framework/compaction-recovery
// + test/eval/suites/compaction-recovery) entra na varredura — EVAL-017..021.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MATRIX_PATH = path.join(TEST_ROOT, "EVAL-MATRIX.md");
const LAYER2_DIR = path.join(TEST_ROOT, "eval", "layer2");
const GUARDS_DIR = path.join(TEST_ROOT, "guards");
const VERIFY_DIR = path.join(TEST_ROOT, "verify");
const SUITES_DIR = path.join(TEST_ROOT, "eval", "suites");
const FRAMEWORK_DIR = path.join(TEST_ROOT, "eval", "framework");

/** Camada 2 + lane dos guards (F24) + lane da cascata (F25) + lane do
 *  framework de evals (F26 — EVAL-012..016): dados TS em test/eval/suites
 *  e testes em test/eval/framework. */
function layer2TestFiles(): string[] {
  const layer2 = fs
    .readdirSync(LAYER2_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => path.join(LAYER2_DIR, f));
  const files = [...layer2];
  if (fs.existsSync(GUARDS_DIR)) {
    const guards = fs
      .readdirSync(GUARDS_DIR)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.join(GUARDS_DIR, f));
    files.push(...guards);
  }
  if (fs.existsSync(VERIFY_DIR)) {
    const verify = fs
      .readdirSync(VERIFY_DIR)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.join(VERIFY_DIR, f));
    files.push(...verify);
  }
  // F26 (v4): lane do framework — dados TS (suites) + testes (framework).
  if (fs.existsSync(SUITES_DIR)) {
    const suites = fs
      .readdirSync(SUITES_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(SUITES_DIR, f));
    files.push(...suites);
  }
  if (fs.existsSync(FRAMEWORK_DIR)) {
    const framework = (fs.readdirSync(FRAMEWORK_DIR, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.join(FRAMEWORK_DIR, f));
    files.push(...framework);
  }
  return files;
}

describe("EVAL-MATRIX — consistência matriz ↔ testes (D9)", () => {
  test("matriz existe e declara MATRIX_VERSION + os EVAL-IDs da camada 2", () => {
    expect(fs.existsSync(MATRIX_PATH)).toBe(true);
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    expect(matrix).toMatch(/MATRIX_VERSION:\s*\d+/);
    expect(matrix).toMatch(/MATRIX_VERSION:\s*5/);
    for (const id of ["EVAL-001", "EVAL-002", "EVAL-004", "EVAL-005", "EVAL-005b", "EVAL-006", "EVAL-007", "EVAL-008", "EVAL-009", "EVAL-010", "EVAL-011", "EVAL-012", "EVAL-013", "EVAL-014", "EVAL-015", "EVAL-016", "EVAL-017", "EVAL-018", "EVAL-019", "EVAL-020", "EVAL-021"]) {
      expect(matrix).toContain(id);
    }
  });

  test("todo EVAL-<n> da matriz tem teste de fluxo na camada 2 que o referencia", () => {
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    const matrixIds = new Set([...matrix.matchAll(/EVAL-(\d{3}[a-z]?)/gi)].map((m) => m[0].toUpperCase()));
    expect(matrixIds.size).toBeGreaterThanOrEqual(20); // EVAL-001..021 (EVAL-003 fora)
    const testTexts = layer2TestFiles().map((f) => ({ file: f, text: fs.readFileSync(f, "utf8") }));

    for (const id of matrixIds) {
      const referenced = testTexts.filter(({ text }) => text.toUpperCase().includes(id));
      // EVAL-003 é a exceção documentada (FORA da camada 2 — taskflow DAG fica no F22 S3).
      if (id === "EVAL-003") continue;
      expect(
        referenced.length,
        `matriz lista ${id} mas nenhum teste da camada 2 o referencia`,
      ).toBeGreaterThan(0);
    }
  });

  test("todo teste de fluxo da camada 2 referencia um EVAL-<n> presente na matriz", () => {
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    for (const file of layer2TestFiles()) {
      const text = fs.readFileSync(file, "utf8");
      const ids = [...text.matchAll(/EVAL-(\d{3}[a-z]?)/gi)].map((m) => m[0].toUpperCase());
      const unique = [...new Set(ids)];
      if (unique.length === 0) {
        // adversarial.test.ts (teste do fixture, F5), matrix-consistency (espelho)
        // e hermetic-env (guard D3) não são fluxos da matriz; config-status e
        // ranger-md-only (F24) são testes de CLI/unit sem EVAL-id — os demais
        // arquivos DEVM referenciar um EVAL-<n>.
        const basename = path.basename(file);
        if (
          basename.startsWith("adversarial") ||
          basename.startsWith("matrix-consistency") ||
          basename.startsWith("hermetic-env") ||
          basename.startsWith("config-status") ||
          basename.startsWith("ranger-md-only") ||
          // F25: os testes unit da cascata (engine/stages/config/cli) não são
          // fluxos da matriz — o fluxo EVAL vive em cascade-eval.test.ts.
          basename.startsWith("engine") ||
          basename.startsWith("stages") ||
          basename.startsWith("config") ||
          basename.startsWith("cli")
        ) {
          continue;
        }
        throw new Error(`${basename} não referencia nenhum EVAL-<n> da matriz`);
      }
      for (const id of unique) {
        expect(
          matrix.toUpperCase(),
          `${id} (referenciado por ${path.basename(file)}) não está na matriz`,
        ).toContain(id);
      }
    }
  });

  test("EVAL-003 não está na matriz (revisão 2026-08-05, I1 — fora da camada 2)", () => {
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    // A tabela da matriz é o registro de governo: EVAL-003 não pode ser linha
    // da tabela (a menção no callout abaixo é apenas a justificativa da exclusão).
    const table = matrix.split("\n").filter((l) => l.startsWith("|") && !/^\| ---/.test(l)).join("\n");
    expect(table).not.toMatch(/EVAL-003/);
  });
});
