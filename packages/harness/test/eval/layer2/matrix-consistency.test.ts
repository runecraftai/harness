// matrix-consistency.test.ts — D9: EVAL-MATRIX.md aditivo ↔ testes da camada 2.
//
// Regra: todo EVAL-<n> na matriz tem um teste de fluxo na camada 2 que o
// referencia; todo teste de fluxo referencia um EVAL-<n> presente na matriz.
// EVAL-003 é FORA da camada 2 (revisão 2026-08-05, I1) — não pode aparecer
// nem na matriz nem como evalId de teste. Uma entrada órfã quebra este teste
// (a política aditiva — nada sai sem AD — é o espelho reverso: entrada nova
// SEM teste = matriz mente; teste novo SEM entrada = cobertura invisível).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MATRIX_PATH = path.join(TEST_ROOT, "EVAL-MATRIX.md");
const LAYER2_DIR = path.join(TEST_ROOT, "eval", "layer2");

function layer2TestFiles(): string[] {
  return fs
    .readdirSync(LAYER2_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => path.join(LAYER2_DIR, f));
}

describe("EVAL-MATRIX — consistência matriz ↔ testes (D9)", () => {
  test("matriz existe e declara MATRIX_VERSION + os EVAL-IDs da camada 2", () => {
    expect(fs.existsSync(MATRIX_PATH)).toBe(true);
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    expect(matrix).toMatch(/MATRIX_VERSION:\s*\d+/);
    for (const id of ["EVAL-001", "EVAL-002", "EVAL-004", "EVAL-005", "EVAL-005b"]) {
      expect(matrix).toContain(id);
    }
  });

  test("todo EVAL-<n> da matriz tem teste de fluxo na camada 2 que o referencia", () => {
    const matrix = fs.readFileSync(MATRIX_PATH, "utf8");
    const matrixIds = new Set([...matrix.matchAll(/EVAL-(\d{3}[a-z]?)/gi)].map((m) => m[0].toUpperCase()));
    expect(matrixIds.size).toBeGreaterThanOrEqual(5);
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
        // e hermetic-env (guard D3) não são fluxos da matriz; os demais arquivos
        // DEVM referenciar um EVAL-<n>.
        const basename = path.basename(file);
        if (
          basename.startsWith("adversarial") ||
          basename.startsWith("matrix-consistency") ||
          basename.startsWith("hermetic-env")
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
