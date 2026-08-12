// eval/ratchet.test.ts — núcleo de comparação (F23 D3): sort/diff/regras
// a/b/c + roundtrips de baseline + e2e com fixtures em temp dir.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { compareCodePoints, sortLines } from "../../src/eval/sort.ts";
import { diffLines, unifiedDiff } from "./diff.ts";
import {
  assertEvidenceComplete,
  canonicalCoverage,
  canonicalFlagName,
  compareSets,
  COVERAGE_HEADER,
  coverageIdentity,
  distinctEvidenceFiles,
  failureIdentity,
  KNOWN_FAILURES_HEADER,
  parseBaselineLines,
  runRatchet,
  serializeBaseline,
  type RatchetEvidence,
} from "./ratchet.ts";
import { currentCoverage, currentFailures, updateAll } from "./update.ts";
import { goldenDefs, GOLDEN_DIR } from "./goldens.ts";

function evidence(over: Partial<RatchetEvidence> = {}): RatchetEvidence {
  return {
    results: [],
    coverage: [],
    harnessVersion: "0.1.0",
    runId: "20260808-000000-test",
    ...over,
  };
}

function tmpBaselineDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "f23-baseline-"));
}

function writeBaselineFiles(dir: string, known: string[], coverage: string[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "known-failures.txt"), serializeBaseline(KNOWN_FAILURES_HEADER, known), "utf8");
  fs.writeFileSync(path.join(dir, "command-coverage.txt"), serializeBaseline(COVERAGE_HEADER, coverage), "utf8");
}

function goldenDirFixture(): { dir: string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f23-goldens-"));
  fs.mkdirSync(dir, { recursive: true });
  for (const def of goldenDefs()) {
    fs.writeFileSync(path.join(dir, def.name), def.render(), "utf8");
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe("sort — colação pinada (D2)", () => {
  test("ordena por code points, nunca localeCompare", () => {
    expect(sortLines(["b", "a", "c"])).toEqual(["a", "b", "c"]);
    // UTF-16: maiúsculas antes de minúsculas; acentos DEPOIS de ASCII.
    expect(sortLines(["Z", "a", "A", "b"])).toEqual(["A", "Z", "a", "b"]);
    expect(sortLines(["é", "z", "á"])).toEqual(["z", "á", "é"]);
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("a", "b")).toBeLessThan(0);
    expect(compareCodePoints("b", "a")).toBeGreaterThan(0);
  });

  test("determinístico: mesma entrada → mesma ordem em runs distintos", () => {
    const input = ["install", "status", "doctor", "sync"];
    expect(sortLines(input)).toEqual(sortLines([...input].reverse()));
  });
});

describe("diff — unified diff mínimo (D4)", () => {
  test("byte-iguais → diff vazio", () => {
    expect(unifiedDiff("a", "b", "x\ny\n", "x\ny\n")).toBe("");
    expect(diffLines(["x"], ["x"])).toEqual([{ kind: " ", text: "x" }]);
  });

  test("uma linha mudada → hunk @@ com contexto", () => {
    const diff = unifiedDiff("a.golden", "atual", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
    expect(diff).toContain("--- a.golden");
    expect(diff).toContain("+++ atual");
    expect(diff).toContain("@@ -1,4 +1,4 @@");
    expect(diff).toContain("-two");
    expect(diff).toContain("+TWO");
    expect(diff).toContain(" three");
  });

  test("inserção/remoção com contagens corretas no header", () => {
    const diff = unifiedDiff("a", "b", "a\nb\n", "a\nx\ny\nb\n");
    expect(diff).toMatch(/@@ -1,3 \+1,5 @@/);
    expect(diff).toContain("+x");
    expect(diff).toContain("+y");
  });

  test("diff completo (todas as linhas mudaram)", () => {
    const diff = unifiedDiff("a", "b", "1\n2\n3\n", "A\nB\n");
    expect(diff).toContain("-1");
    expect(diff).toContain("+A");
    expect(diff).toContain("-3");
    expect(diff).toContain("+B");
  });
});

describe("ratchet — identidades e baselines (D1/D2)", () => {
  test("failureIdentity: TSV estável, sem tabs/newlines nos campos", () => {
    const id = failureIdentity("test/a.test.ts", "nome com\ttab", "msg\ncom\nquebras");
    expect(id).toBe("test/a.test.ts\tnome com tab\tmsg\ncom\nquebras");
  });

  test("canonicalFlagName: valores removidos, nomes limpos", () => {
    expect(canonicalFlagName("--json")).toBe("json");
    expect(canonicalFlagName("--dry-run")).toBe("dry-run");
    expect(canonicalFlagName("--preset=minimal")).toBe("preset");
    expect(canonicalFlagName("minimal")).toBeNull(); // valor sem dash — removido
    expect(canonicalFlagName("--")).toBeNull();
  });

  test("canonicalCoverage: nomes ordenados e dedupados; valores fora", () => {
    expect(canonicalCoverage("install", ["--preset", "minimal", "--dry-run"])).toEqual({
      command: "install",
      flags: ["dry-run", "preset"],
    });
    expect(canonicalCoverage("status", ["--json", "--json"])).toEqual({ command: "status", flags: ["json"] });
    expect(coverageIdentity("install", ["--dry-run", "--preset", "minimal"])).toBe("install\tdry-run preset");
  });

  test("parseBaselineLines: ignora comentários/linhas vazias; preserva a linha", () => {
    const text = `${KNOWN_FAILURES_HEADER}\na/b.test.ts\tnome\tmsg com espaco  duplo\n\n# comentário\n`;
    const set = parseBaselineLines(text);
    expect([...set]).toEqual(["a/b.test.ts\tnome\tmsg com espaco  duplo"]);
  });

  test("serializeBaseline: header + ordenação pinada; roundtrip estável", () => {
    const ids = ["status\tjson", "install\t"];
    const text = serializeBaseline(COVERAGE_HEADER, ids);
    expect(text).toBe(`${COVERAGE_HEADER}\ninstall\t\nstatus\tjson\n`);
    expect([...parseBaselineLines(text)]).toEqual(["install\t", "status\tjson"]);
    // re-serializar o parseado = byte a byte idêntico (determinismo D2)
    expect(serializeBaseline(COVERAGE_HEADER, parseBaselineLines(text))).toBe(text);
  });

  test("compareSets: matched/added/removed com ordenação pinada", () => {
    const c = compareSets(new Set(["b", "a", "c"]), new Set(["a", "x"]));
    expect(c.matched).toEqual(["a"]);
    expect(c.added).toEqual(["b", "c"]);
    expect(c.removed).toEqual(["x"]);
  });
});

describe("ratchet — runRatchet (D3: fail-only-on-worse)", () => {
  test("verde: sem falhas, cobertura ⊇ baseline, goldens idênticos", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], ["install\t", "status\tjson"]);
      const report = runRatchet(
        evidence({
          results: [
            { testFile: "test/eval/layer1/smoke.test.ts", testName: "status json", status: "pass", message: "" },
          ],
          coverage: [
            { command: "status", flags: ["--json"] },
            { command: "install", flags: [] },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(true);
      expect(report.failureComp.added).toEqual([]);
      expect(report.coverageComp.removed).toEqual([]);
      expect(report.goldenChecks.every((g) => g.ok)).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("falha NOVA → vermelho listando a entrada (AC 1.2)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], []);
      const report = runRatchet(
        evidence({
          results: [
            {
              testFile: "test/eval/layer1/install.test.ts",
              testName: "dry-run zero writes",
              status: "fail",
              message: "expected 0 writes, got 2",
            },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(false);
      expect(report.failureComp.added).toEqual(["test/eval/layer1/install.test.ts\tdry-run zero writes\texpected 0 writes, got 2"]);
      expect(report.lines.some((l) => l.includes("FALHA NOVA"))).toBe(true);
      expect(report.lines.some((l) => l.includes("VERMELHO"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("falha CONGELADA → verde com a entrada listada (AC 1.3)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      const frozen = "test/eval/layer1/install.test.ts\tdry-run zero writes\texpected 0 writes, got 2";
      writeBaselineFiles(base, [frozen], []);
      const report = runRatchet(
        evidence({
          results: [
            {
              testFile: "test/eval/layer1/install.test.ts",
              testName: "dry-run zero writes",
              status: "fail",
              message: "expected 0 writes, got 2",
            },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(true);
      expect(report.failureComp.matched).toEqual([frozen]);
      expect(report.failureComp.added).toEqual([]);
      expect(report.lines.some((l) => l.includes("congelada:"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("falha do baseline que SOME → verde com aviso (AC 1.4)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      const gone = "test/eval/layer1/status.test.ts\tstatus json\tstate file unreadable";
      writeBaselineFiles(base, [gone], []);
      const report = runRatchet(evidence({ results: [{ testFile: "x", testName: "y", status: "pass", message: "" }] }), {
        baselineDir: base,
        goldenDir: goldens.dir,
      });
      expect(report.ok).toBe(true);
      expect(report.failureComp.removed).toEqual([gone]);
      expect(report.lines.some((l) => l.includes("ⓘ aviso") && l.includes("--update"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("cobertura FALTANDO → vermelho (comando deixou de ser exercitado)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], ["install\t", "status\tjson"]);
      const report = runRatchet(
        evidence({ coverage: [{ command: "install", flags: [] }] }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(false);
      expect(report.coverageComp.removed).toEqual(["status\tjson"]);
      expect(report.lines.some((l) => l.includes("FALTANDO"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("cobertura EXTRA → verde com aviso (só cresce — D1)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], ["install\t"]);
      const report = runRatchet(
        evidence({
          coverage: [
            { command: "install", flags: [] },
            { command: "doctor", flags: ["--json"] },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(true);
      expect(report.coverageComp.added).toEqual(["doctor\tjson"]);
      expect(report.lines.some((l) => l.includes("ⓘ aviso") && l.includes("extra"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("golden mutado → vermelho com unified diff (AC 2.2)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], []);
      const target = path.join(goldens.dir, "mcp-codex.golden");
      fs.writeFileSync(target, "[mcp_servers.taskflow]\ncommand = \"/evil/bin\"\n", "utf8");
      const report = runRatchet(evidence(), { baselineDir: base, goldenDir: goldens.dir });
      expect(report.ok).toBe(false);
      const check = report.goldenChecks.find((g) => g.name === "mcp-codex.golden");
      expect(check?.ok).toBe(false);
      expect(check?.diff).toContain("--- golden/mcp-codex.golden");
      expect(check?.diff).toContain("-command = \"/evil/bin\"");
      expect(check?.diff).toContain("+command = \"/test/fixtures/bin/codex-taskflow-mcp\"");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("fail-infra é excluído do ratchet (D3 — mesmo contrato do F22)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], []);
      const report = runRatchet(
        evidence({
          results: [
            { testFile: "a.test.ts", testName: "infra", status: "fail-infra", message: "git ausente no ambiente" },
            { testFile: "b.test.ts", testName: "ok", status: "pass", message: "" },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(true);
      expect(report.failureComp.added).toEqual([]);
      expect(report.failInfraCount).toBe(1);
      expect(report.lines.some((l) => l.includes("fail-infra excluídas"))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("dedup canônico: duas falhas com a mesma identidade = uma entrada", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, [], []);
      const report = runRatchet(
        evidence({
          results: [
            { testFile: "a.test.ts", testName: "x", status: "fail", message: "expected 0 writes, got 2" },
            { testFile: "a.test.ts", testName: "x", status: "fail", message: "expected 0 writes, got 2" },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.failureComp.added).toHaveLength(1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("normalização na comparação: mensagem varia entre runs → mesma identidade (edge spec)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      const frozen = `test/eval/layer2/sdlc.test.ts\tfluxo\t<ts> timeout <dur> em http://<ip>:<port> com bun@<ver>`;
      writeBaselineFiles(base, [frozen], []);
      const report = runRatchet(
        evidence({
          results: [
            {
              testFile: "test/eval/layer2/sdlc.test.ts",
              testName: "fluxo",
              status: "fail",
              message: "2026-08-05T10:00:00Z timeout 123ms em http://127.0.0.1:54321 com bun@1.3.14\nstack",
            },
          ],
        }),
        { baselineDir: base, goldenDir: goldens.dir },
      );
      expect(report.ok).toBe(true);
      expect(report.failureComp.matched).toEqual([frozen]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });
});

describe("update — --update (D6/RCTH-02)", () => {
  test("currentFailures/currentCoverage: só fail; fail-infra fora; flags canônicas", () => {
    const ev = evidence({
      results: [
        { testFile: "a.test.ts", testName: "x", status: "fail", message: "expected 0 writes, got 2" },
        { testFile: "b.test.ts", testName: "y", status: "fail-infra", message: "rede fora de loopback" },
        { testFile: "c.test.ts", testName: "z", status: "pass", message: "" },
      ],
      coverage: [{ command: "install", flags: ["--preset", "minimal", "--dry-run"] }],
    });
    expect([...currentFailures(ev)]).toEqual(["a.test.ts\tx\texpected 0 writes, got 2"]);
    expect([...currentCoverage(ev)]).toEqual(["install\tdry-run preset"]);
  });

  test("updateAll: relatório added/removed/unchanged por baseline; goldens regravados", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, ["velho\tx\tfalha antiga"], ["install\t"]);
      const report = updateAll(
        evidence({
          results: [
            { testFile: "velho", testName: "x", status: "fail", message: "falha antiga" },
            { testFile: "novo", testName: "y", status: "fail", message: "falha nova" },
          ],
          coverage: [
            { command: "install", flags: [] },
            { command: "doctor", flags: ["--json"] },
          ],
        }),
        base,
        goldens.dir,
      );
      const known = report.baselines.find((b) => b.baseline === "known-failures.txt");
      const cov = report.baselines.find((b) => b.baseline === "command-coverage.txt");
      expect(known).toMatchObject({ added: 1, removed: 0, unchanged: 1 });
      expect(cov).toMatchObject({ added: 1, removed: 0, unchanged: 1 });
      // B1: 12 goldens (5 pilot chains F33 + section-routing-claude B1 — D4).
      expect(report.goldens).toHaveLength(12);
      // arquivo gravado reflete o estado atual + ordenação pinada
      const written = fs.readFileSync(path.join(base, "known-failures.txt"), "utf8");
      expect(written).toContain("novo\ty\tfalha nova");
      expect(written.indexOf("novo\ty\tfalha nova")).toBeLessThan(written.indexOf("velho\tx\tfalha antiga"));
      for (const def of goldenDefs()) {
        expect(fs.readFileSync(path.join(goldens.dir, def.name), "utf8")).toBe(def.render());
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("falha que some → removida do baseline no --update (aviso vira remoção, F3)", () => {
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, ["a\tx\tfalha que não ocorre mais"], []);
      updateAll(evidence(), base, goldens.dir);
      const written = fs.readFileSync(path.join(base, "known-failures.txt"), "utf8");
      expect(written).not.toContain("falha que não ocorre mais");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });

  test("--update recusa com CI=true (nunca autocorreção em PR)", async () => {
    const { assertUpdateAllowed, UpdateRefusedError } = await import("./update.ts");
    const previous = process.env.CI;
    try {
      process.env.CI = "true";
      expect(() => assertUpdateAllowed()).toThrow(UpdateRefusedError);
      process.env.CI = "1";
      expect(() => assertUpdateAllowed()).toThrow(UpdateRefusedError);
      process.env.CI = "false";
      expect(() => assertUpdateAllowed()).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  });

  test("evidência ausente (results vazio) NUNCA é comparada em silêncio", () => {
    // ratchet-run.ts falha antes; aqui garantimos que updateAll grava vazio
    // apenas com evidência real (contrato de --update, não de compare).
    const base = tmpBaselineDir();
    const goldens = goldenDirFixture();
    try {
      writeBaselineFiles(base, ["a\tx\tfalha antiga"], ["install\t"]);
      updateAll(evidence({ results: [], coverage: [] }), base, goldens.dir);
      const written = fs.readFileSync(path.join(base, "known-failures.txt"), "utf8");
      expect(written).not.toContain("falha antiga");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      goldens.cleanup();
    }
  });
});

describe("ratchet — piso de completude da evidência (fix cleric F23)", () => {
  test("evidência parcial (menos arquivos que o piso) → incompleta com mensagem", () => {
    const results: RatchetEvidence["results"] = [
      { testFile: "test/eval/layer1/smoke-subprocess.test.ts", testName: "a", status: "pass", message: "" },
      { testFile: "test/eval/layer1/smoke-subprocess.test.ts", testName: "b", status: "pass", message: "" },
      { testFile: "test/eval/layer2/sdk-session.test.ts", testName: "c", status: "pass", message: "" },
    ];
    expect(distinctEvidenceFiles(results)).toBe(2);
    const err = assertEvidenceComplete(results, 13);
    expect(err).not.toBeNull();
    expect(err).toContain("2/13");
  });

  test("evidência completa (>= piso) → null", () => {
    const results: RatchetEvidence["results"] = Array.from({ length: 13 }, (_, i) => ({
      testFile: `test/eval/f${i}.test.ts`,
      testName: "x",
      status: "pass",
      message: "",
    }));
    expect(assertEvidenceComplete(results, 13)).toBeNull();
  });
});

describe("ratchet — integração com goldens reais (GOLDEN_DIR)", () => {
  test("goldens commitados == render atual (verde no repo)", () => {
    const base = tmpBaselineDir();
    try {
      writeBaselineFiles(base, [], []);
      const report = runRatchet(evidence(), { baselineDir: base, goldenDir: GOLDEN_DIR });
      expect(report.goldenChecks.every((g) => g.ok)).toBe(true);
      for (const g of report.goldenChecks) expect(g.diff).toBe("");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
