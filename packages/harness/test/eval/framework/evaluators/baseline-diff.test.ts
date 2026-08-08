// framework/evaluators/baseline-diff.test.ts — EVAL-015: baseline-diff vs
// ratchet F23 (implementado — reservado no arcanum).
//
// Compara as falhas do case atual contra o baseline known-failures.txt do
// F23 (identidade `caseId<TAB>mensagemNormalizada` — namespace F26, reusa
// normalizeMessage/sortLines do F23 sem duplicação). Cobre: baseline
// rebaixado → regression (fail com reason caseId + métrica); falha
// congelada → pass; case passou → no-regression; baseline ausente →
// degraded informacional; determinismo.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { caseFailureIdentity, runBaselineDiffEvaluator } from "../../../../src/eval/evaluators/baseline-diff.ts";
import { normalizeMessage } from "../../../../src/eval/normalize.ts";
import type { BaselineDiffEvaluator } from "../../../../src/eval/types.ts";

const KNOWN_FAILURES_HEADER = "# runecraft harness — known failures (may only shrink)";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-baseline-diff-"));
}

function writeBaseline(dir: string, lines: string[]): string {
  const file = path.join(dir, "known-failures.txt");
  fs.writeFileSync(file, [KNOWN_FAILURES_HEADER, ...lines, ""].join("\n"));
  return file;
}

function spec(): BaselineDiffEvaluator {
  return { kind: "baseline-diff", weight: 1 };
}

describe("EVAL-015 — baseline-diff vs ratchet F23", () => {
  test("falha NOVA (não congelada) → regression (fail com reason caseId + mensagem)", () => {
    const dir = makeTmp();
    try {
      writeBaseline(dir, ["other-case\tfrozen message"]);
      const results = runBaselineDiffEvaluator(spec(), {
        baselineDir: dir,
        caseId: "write-guard-block",
        status: "failed",
        failures: ["Guard did not block the write"],
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("Regression for case write-guard-block");
      expect(results[0]!.message).toContain("Guard did not block the write");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falha CONGELADA no baseline → pass (informacional — no new regression)", () => {
    const dir = makeTmp();
    try {
      writeBaseline(dir, [caseFailureIdentity("write-guard-block", "Guard did not block the write")]);
      const results = runBaselineDiffEvaluator(spec(), {
        baselineDir: dir,
        caseId: "write-guard-block",
        status: "failed",
        failures: ["Guard did not block the write"],
      });
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("frozen in baseline");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("case que passou → no-regression (pass)", () => {
    const dir = makeTmp();
    try {
      writeBaseline(dir, []);
      const results = runBaselineDiffEvaluator(spec(), {
        baselineDir: dir,
        caseId: "write-guard-block",
        status: "passed",
        failures: [],
      });
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("No regression");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("baseline ausente → degraded informacional (pass — não falha infra)", () => {
    const dir = makeTmp();
    try {
      const results = runBaselineDiffEvaluator(spec(), {
        baselineDir: dir,
        caseId: "write-guard-block",
        status: "failed",
        failures: ["anything"],
      });
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("degraded (informational)");
      // Sem path absoluto (F21 D10).
      expect(results[0]!.message).not.toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("baselineRef custom aponta para outro arquivo do baselineDir", () => {
    const dir = makeTmp();
    try {
      fs.writeFileSync(path.join(dir, "custom.txt"), `${caseFailureIdentity("c1", "boom")}\n`);
      const frozen = runBaselineDiffEvaluator({ kind: "baseline-diff", baselineRef: "custom.txt" }, {
        baselineDir: dir,
        caseId: "c1",
        status: "failed",
        failures: ["boom"],
      });
      expect(frozen[0]!.passed).toBe(true);
      const missing = runBaselineDiffEvaluator({ kind: "baseline-diff", baselineRef: "custom.txt" }, {
        baselineDir: dir,
        caseId: "c2",
        status: "failed",
        failures: ["boom"],
      });
      expect(missing[0]!.passed).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("normalização reusa a infra F23: timestamp no reason não muda a identidade", () => {
    const dir = makeTmp();
    try {
      // A identidade gravada no baseline é SEMPRE normalizada (mesmo contrato
      // do ratchet F23 — as linhas do known-failures.txt são canônicas); a
      // comparação normaliza o reason ATUAL (normalizeMessage do F23).
      writeBaseline(dir, [caseFailureIdentity("c1", normalizeMessage("boom happened at 2026-01-01T00:00:00Z"))]);
      const results = runBaselineDiffEvaluator(spec(), {
        baselineDir: dir,
        caseId: "c1",
        status: "failed",
        failures: ["boom happened at 2026-02-02T03:04:05Z"],
      });
      expect(results[0]!.passed).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("determinismo: mesma entrada → mesmo resultado", () => {
    const dir = makeTmp();
    try {
      writeBaseline(dir, []);
      const ctx = { baselineDir: dir, caseId: "c1", status: "failed" as const, failures: ["boom"] };
      const first = runBaselineDiffEvaluator(spec(), ctx);
      const second = runBaselineDiffEvaluator(spec(), ctx);
      expect(first).toEqual(second);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
