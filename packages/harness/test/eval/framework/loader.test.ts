// framework/loader.test.ts — EVAL-012: loader de módulos TS via dynamic
// import (QA-1 — validado no Execute: bun importa TS em runtime; os dados
// são objetos puros, sem top-level await/side effects).
//
// Port adaptado do loader.test.ts do arcanum (JSONC → TS modules):
// suite/case/cenário carregam e validam; referência quebrada → EvalConfigError
// com arquivo + motivo; schema inválido → motivo + hint de kinds.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EvalConfigError, loadCasesForSuite, loadScenario, loadSuite, resolveSuitePath } from "../../../src/eval/loader.ts";

const TEST_EVAL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eval-loader-"));
}

describe("EVAL-012 — loader: dados TS (dynamic import)", () => {
  test("resolveSuitePath mapeia id → <dir>/suites/<id>.ts", () => {
    expect(resolveSuitePath("/data", "constraint-adherence")).toBe("/data/suites/constraint-adherence.ts");
    expect(resolveSuitePath("/data", "x.ts")).toBe("/data/suites/x.ts");
  });

  test("carrega a suite real do harness (constraint-adherence) e valida schema", async () => {
    const suite = await loadSuite(TEST_EVAL_DIR, "constraint-adherence");
    expect(suite.id).toBe("constraint-adherence");
    expect(suite.phase).toBe("trajectory");
    expect(suite.caseFiles.length).toBe(2);
    expect(fs.existsSync(suite.filePath)).toBe(true);
  });

  test("carrega os cases da suite e resolve os refs relativos", async () => {
    const suite = await loadSuite(TEST_EVAL_DIR, "constraint-adherence");
    const cases = await loadCasesForSuite(suite, path.join(TEST_EVAL_DIR, "cases"));
    expect(cases.map((c) => c.id).sort()).toEqual(["ranger-md-only", "write-guard-block"]);
    for (const c of cases) {
      expect(c.executor.kind).toBe("trajectory-run");
      expect(fs.existsSync(c.filePath)).toBe(true);
    }
  });

  test("carrega um cenário do harness (script do fixture F21)", async () => {
    const scenario = await loadScenario(path.join(TEST_EVAL_DIR, "scenarios"), "write-guard-block");
    expect(scenario.id).toBe("write-guard-block");
    expect(scenario.scenario.steps.length).toBe(3);
    expect(typeof scenario.scenario.stepFor).toBe("function");
  });

  test("referência de cenário inexistente → EvalConfigError com arquivo + motivo", async () => {
    await expect(loadScenario(path.join(TEST_EVAL_DIR, "scenarios"), "no-such-scenario")).rejects.toThrow(EvalConfigError);
    try {
      await loadScenario(path.join(TEST_EVAL_DIR, "scenarios"), "no-such-scenario");
    } catch (error) {
      expect(error).toBeInstanceOf(EvalConfigError);
      expect((error as Error).message).toContain("no-such-scenario");
    }
  });

  test("suite inexistente → EvalConfigError", async () => {
    await expect(loadSuite(TEST_EVAL_DIR, "no-such-suite")).rejects.toThrow(EvalConfigError);
  });
});

describe("EVAL-012 — loader: módulos TS em temp dir (dynamic import de arquivos novos)", () => {
  test("suite/case/cenário TS gravados em runtime carregam e validam", async () => {
    const dir = makeTmp();
    try {
      fs.mkdirSync(path.join(dir, "suites"), { recursive: true });
      fs.mkdirSync(path.join(dir, "cases"), { recursive: true });
      fs.mkdirSync(path.join(dir, "scenarios"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "cases", "temp-case.ts"),
        `export default { id: "temp-case", title: "Temp", phase: "prompt", target: { kind: "prompt-render" }, executor: { kind: "prompt-render" }, evaluators: [{ kind: "contains-all", patterns: ["x"] }] }`,
      );
      fs.writeFileSync(
        path.join(dir, "suites", "temp-suite.ts"),
        `export default { id: "temp-suite", title: "Temp", phase: "prompt", caseFiles: ["../cases/temp-case.ts"] }`,
      );

      const suite = await loadSuite(dir, "temp-suite");
      expect(suite.id).toBe("temp-suite");
      const cases = await loadCasesForSuite(suite, path.join(dir, "cases"));
      expect(cases).toHaveLength(1);
      expect(cases[0]!.id).toBe("temp-case");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("módulo com schema inválido → EvalConfigError com motivo", async () => {
    const dir = makeTmp();
    try {
      fs.mkdirSync(path.join(dir, "suites"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "suites", "bad.ts"),
        `export default { id: "bad", title: "Bad", phase: "bogus", caseFiles: [] }`,
      );
      await expect(loadSuite(dir, "bad")).rejects.toThrow(EvalConfigError);
      try {
        await loadSuite(dir, "bad");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("phase");
        expect(message).toContain("caseFiles");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("módulo sem default export → EvalConfigError com convenção F26", async () => {
    const dir = makeTmp();
    try {
      fs.mkdirSync(path.join(dir, "suites"), { recursive: true });
      fs.writeFileSync(path.join(dir, "suites", "no-default.ts"), `export const x = 1`);
      await expect(loadSuite(dir, "no-default")).rejects.toThrow(/default export/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
