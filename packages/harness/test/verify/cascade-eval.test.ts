// verify/cascade-eval.test.ts — T9/T12 (D11/D13, VER-01/05/06/10/13): EVAL-008..011
// na infra F21 (sessão Pi real com fixture OpenAI-wire) + adversarial (desvio
// induzido → diagnóstico). A cascata roda no branch complete_goal do enforcer
// F24 (D11); os vereditos ficam no log da sessão (.runecraft/verify-verdicts.jsonl).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { setupEvalFixture, type EvalFixture } from "../eval/helpers/evalFixture.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";
import { waitForCondition } from "../eval/helpers/wait.ts";
import { harnessExtensionPaths } from "../eval/helpers/fixtureHome.ts";
import { embeddingScore } from "../../src/verify/stages/embedding.ts";
import { dispatch } from "../../src/cli.ts";
import { EVAL_008, EVAL_009_INTEGRITY, EVAL_009_EMPTY, EVAL_009_OVERSIZED, EVAL_010_GOAL } from "../eval/layer2/fixture/scenarios.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SPEC = "Create a file notes.txt whose content is exactly hello verify";
const GOAL_PROMPT =
  "Create a file notes.txt whose content is exactly hello verify. Done when: notes.txt exists in the repo root and its content is exactly hello verify";

function verdictLog(repoDir: string): string {
  return path.join(repoDir, ".runecraft", "verify-verdicts.jsonl");
}

function readVerdicts(repoDir: string): Array<{ status: string; layer: string | null; reason: string | null }> {
  const file = verdictLog(repoDir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { status: string; layer: string | null; reason: string | null });
}

/** package.json do fixture: `lint` falha até existir LINT_OK (EVAL-008). */
function writeBrokenLintPackage(repoDir: string): void {
  fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ scripts: { lint: "test -f LINT_OK || exit 1" } }, null, 2));
}

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(String(chunk));
  }
  get text(): string {
    return this.chunks.join("");
  }
}

describe("EVAL-008 — cascata na sessão: lint quebrado → veredito estrutural (skip, sem block)", () => {
  test("EVAL-008: complete_goal com lint quebrado → veredito estrutural no log; goal conclui; CLI pós-correção passa", async () => {
    await evalTest(
      "EVAL-008: complete_goal com lint quebrado → veredito estrutural no log; goal conclui; CLI pós-correção passa",
      async () => {
        const fx: EvalFixture = await setupEvalFixture({
          scenario: EVAL_008,
          withRepo: true,
          beforeSession: ({ repoDir }) => {
            writeBrokenLintPackage(repoDir);
          },
        });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(`/goal start ${GOAL_PROMPT}`);

          const archived = await waitForCondition(
            () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
            { timeoutMs: 60_000, label: "goal_archived (EVAL-008)" },
          );
          expect(archived).toBe(true);
          expect(fx.server.diagnosis).toEqual([]); // o fluxo NÃO foi bloqueado (skip — SOFT, QA-1)

          // Veredito estrutural registrado no log da sessão (D8) com sugestão.
          const verdicts = readVerdicts(repoDir);
          const structural = verdicts.find((v) => v.layer === "structural");
          expect(structural).toBeDefined();
          expect(structural!.status).toBe("skip");
          expect(structural!.reason).toContain("bun run lint");

          // Correção → CLI verify (MESMA engine): structural passa → exit 0.
          fs.writeFileSync(path.join(repoDir, "LINT_OK"), "");
          const out = new StringSink();
          const err = new StringSink();
          const code = await dispatch(["verify", "--json"], {
            cwd: repoDir,
            env: fx.env,
            stdout: out,
            stderr: err,
          });
          expect(code).toBe(0);
          const report = JSON.parse(out.text) as { checks: Array<{ name: string; passed: boolean }>; verdict: { status: string } };
          expect(report.verdict.status).toBe("degraded"); // goal arquivado → sem spec → degrada (sem violação)
          const structuralCheck = report.checks.find((c) => c.name === "structural");
          expect(structuralCheck!.passed).toBe(true); // lint corrigido → passa
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-008" },
    );
  });
});

describe("EVAL-009 — integridade + suficiência (block HARD)", () => {
  test("EVAL-009 (integridade): delete de arquivo protegido → block com reason F24; restaura → conclui", async () => {
    await evalTest(
      "EVAL-009 (integridade): delete de arquivo protegido → block com reason F24; restaura → conclui",
      async () => {
        const fx: EvalFixture = await setupEvalFixture({
          scenario: EVAL_009_INTEGRITY,
          withRepo: true,
        });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(
            "/goal start Create done.txt and restore README.md to its committed content. Done when: done.txt exists and README.md is unchanged",
          );

          const archived = await waitForCondition(
            () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
            { timeoutMs: 60_000, label: "goal_archived (EVAL-009-int)" },
          );
          expect(archived).toBe(true);
          // O fluxo exigiu o reason F24 na conversa (fixture validou — D7c);
          // o log registra o block (halt) com o layer integrity.
          const verdicts = readVerdicts(repoDir);
          expect(verdicts.some((v) => v.layer === "integrity" && v.status === "halt")).toBe(true);
          expect(verdicts.some((v) => v.reason?.includes("write-existing-file-guard: integrity"))).toBe(true);
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-009" },
    );
  });

  test("EVAL-009 (diff vazio): complete_goal sem mudança → block (mudança ausente)", async () => {
    await evalTest("EVAL-009 (diff vazio): complete_goal sem mudança → block (mudança ausente)", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_009_EMPTY,
        withRepo: true,
      });
      try {
        const repoDir = fx.repo!.dir;
        await fx.session.session.prompt("/goal start Create a file result.txt whose content is exactly ok. Done when: result.txt exists with content ok");

        const archived = await waitForCondition(
          () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived (EVAL-009-empty)" },
        );
        expect(archived).toBe(true);
        const verdicts = readVerdicts(repoDir);
        expect(verdicts.some((v) => v.layer === "sufficiency" && v.status === "halt" && v.reason?.includes("mudança ausente"))).toBe(true);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-009" });
  });

  test("EVAL-009 (diff gigante): complete_goal com diff desproporcional → block (mudança desproporcional)", async () => {
    await evalTest("EVAL-009 (diff gigante): complete_goal com diff desproporcional → block (mudança desproporcional)", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_009_OVERSIZED,
        withRepo: true,
      });
      try {
        const repoDir = fx.repo!.dir;
        await fx.session.session.prompt("/goal start Add a small note to the repository. Done when: note.txt exists with a small content");

        const archived = await waitForCondition(
          () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived (EVAL-009-big)" },
        );
        expect(archived).toBe(true);
        const verdicts = readVerdicts(repoDir);
        expect(verdicts.some((v) => v.layer === "sufficiency" && v.status === "halt" && v.reason?.includes("mudança desproporcional"))).toBe(true);
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-009" });
  });
});

describe("EVAL-010 — zona cinza + degrade + kill switch", () => {
  test("EVAL-010 (kill switch): RUNECRAFT_VERIFY=0 → cascata inerte (goal conclui, log ausente)", async () => {
    await evalTest("EVAL-010 (kill switch): RUNECRAFT_VERIFY=0 → cascata inerte (goal conclui, log ausente)", async () => {
      const previous = process.env.RUNECRAFT_VERIFY;
      process.env.RUNECRAFT_VERIFY = "0";
      try {
        const fx: EvalFixture = await setupEvalFixture({
          scenario: EVAL_010_GOAL,
          withRepo: true,
        });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(`/goal start ${GOAL_PROMPT}`);
          const archived = await waitForCondition(
            () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
            { timeoutMs: 60_000, label: "goal_archived (EVAL-010-kill)" },
          );
          expect(archived).toBe(true);
          expect(fs.existsSync(verdictLog(repoDir))).toBe(false); // cascata inerte
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (previous === undefined) delete process.env.RUNECRAFT_VERIFY;
        else process.env.RUNECRAFT_VERIFY = previous;
      }
    }, { evalId: "EVAL-010" });
  });

  test("EVAL-010 (zona cinza sem env): veredito fail registrado (grayZoneNoJudge default), goal conclui sem block", async () => {
    await evalTest("EVAL-010 (zona cinza sem env): veredito fail registrado (grayZoneNoJudge default)", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_010_GOAL,
        withRepo: true,
      });
      try {
        const repoDir = fx.repo!.dir;
        // O payload do cenário deve cair NA zona cinza (0.35 < score < 0.75) —
        // calibrado no Execute; a prova é o score calculado com o MESMO texto.
        const spec = SPEC;
        const output = "The file notes.txt was created.\nIts content is hello verify, matching the requested content in the repository. <evidence>notes.txt exists with the exact content</evidence>";
        const score = embeddingScore(spec, output);
        expect(score).toBeGreaterThan(0.35);
        expect(score).toBeLessThan(0.75);

        await fx.session.session.prompt(`/goal start ${GOAL_PROMPT}`);
        const archived = await waitForCondition(
          () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived (EVAL-010-gray)" },
        );
        expect(archived).toBe(true);
        const verdicts = readVerdicts(repoDir);
        const gray = verdicts.find((v) => v.layer === "embedding");
        expect(gray).toBeDefined();
        expect(gray!.status).toBe("fail"); // grayZoneNoJudge fail — registrado, sem block
        expect(gray!.reason).toContain("zona cinza");
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-010" });
  });

  test("EVAL-010 (judge env-gated): RUNECRAFT_VERIFY_LLM_JUDGE=1 + fake LLM → judge chamado com a spec (spy); pass", async () => {
    await evalTest("EVAL-010 (judge env-gated): env=1 + fake LLM → judge chamado com a spec; pass", async () => {
      const previous = process.env.RUNECRAFT_VERIFY_LLM_JUDGE;
      process.env.RUNECRAFT_VERIFY_LLM_JUDGE = "1";
      try {
        const fx: EvalFixture = await setupEvalFixture({
          scenario: EVAL_010_GOAL,
          withRepo: true,
          homeOptions: {
            extensions: CUSTOM_EXTENSIONS_WITH_JUDGE,
          },
        });
        try {
          const repoDir = fx.repo!.dir;
          const spyFile = path.join(fx.base, "judge-spy.jsonl");
          process.env.RUNECRAFT_VERIFY_JUDGE_SPY = spyFile;

          await fx.session.session.prompt(`/goal start ${GOAL_PROMPT}`);
          const archived = await waitForCondition(
            () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
            { timeoutMs: 60_000, label: "goal_archived (EVAL-010-judge)" },
          );
          expect(archived).toBe(true);

          // O judge foi chamado UMA vez (env ativo + gray) com a spec no prompt
          // e os critérios de faithfulness (spy de arquivo — sem rede).
          const spyLines = fs.existsSync(spyFile) ? fs.readFileSync(spyFile, "utf8").trim().split("\n").filter((l) => l.length > 0) : [];
          expect(spyLines.length).toBeGreaterThan(0);
          const prompt = JSON.parse(spyLines[0]!) as { prompt: string };
          expect(prompt.prompt).toContain("=== SPEC ===");
          expect(prompt.prompt).toContain("notes.txt");
          expect(prompt.prompt).toContain("Faithfulness");
          expect(prompt.prompt).toContain("Coverage");

          const verdicts = readVerdicts(repoDir);
          expect(verdicts.some((v) => v.status === "pass")).toBe(true); // judge aprovou → pass
          expect(fx.server.diagnosis).toEqual([]);
        } finally {
          fx.cleanup();
        }
      } finally {
        if (previous === undefined) delete process.env.RUNECRAFT_VERIFY_LLM_JUDGE;
        else process.env.RUNECRAFT_VERIFY_LLM_JUDGE = previous;
        delete process.env.RUNECRAFT_VERIFY_JUDGE_SPY;
      }
    }, { evalId: "EVAL-010" });
  });

  test("EVAL-010 (adversarial): sem env o judge NUNCA é chamado (spy ausente) — sessão completa com fail registrado", async () => {
    await evalTest("EVAL-010 (adversarial): sem env o judge NUNCA é chamado (spy ausente)", async () => {
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_010_GOAL,
        withRepo: true,
        homeOptions: {
          extensions: CUSTOM_EXTENSIONS_WITH_JUDGE,
        },
      });
      try {
        const repoDir = fx.repo!.dir;
        const spyFile = path.join(fx.base, "judge-spy.jsonl");
        process.env.RUNECRAFT_VERIFY_JUDGE_SPY = spyFile; // spy pronto — mas o env do judge fica OFF
        await fx.session.session.prompt(`/goal start ${GOAL_PROMPT}`);
        const archived = await waitForCondition(
          () => fs.existsSync(path.join(repoDir, ".pi-glla", "active.jsonl")) && fs.readFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), "utf8").includes('"goal_archived"'),
          { timeoutMs: 60_000, label: "goal_archived (EVAL-010-nojudge)" },
        );
        expect(archived).toBe(true);
        expect(fs.existsSync(spyFile)).toBe(false); // env off → zero invocação (spy)
        const verdicts = readVerdicts(repoDir);
        expect(verdicts.some((v) => v.status === "fail")).toBe(true); // grayZoneNoJudge
        expect(fx.server.diagnosis).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }, { evalId: "EVAL-010" });
  });
});

describe("adversarial — o mecanismo não regride em silêncio (F21 D7 / F24 T7)", () => {
  test("política integrity: skip no config → o block do EVAL-009 não acontece e o fixture falha com diagnóstico", async () => {
    await evalTest("política integrity: skip no config → o fluxo EVAL-009 falha com diagnóstico", async () => {
      // Desvio induzido: config workspace com `policy.onFail.integrity: "skip"`
      // → o delete do README.md NÃO bloqueia → o marcador do reason some da
      // conversa → o fixture acusa a divergência (evidência fora de ordem).
      const fx: EvalFixture = await setupEvalFixture({
        scenario: EVAL_009_INTEGRITY,
        withRepo: true,
        beforeSession: ({ repoDir }) => {
          fs.mkdirSync(path.join(repoDir, ".runecraft"), { recursive: true });
          fs.writeFileSync(
            path.join(repoDir, ".runecraft", "state.json"),
            JSON.stringify({
              schemaVersion: 1,
              scope: "workspace",
              components: {},
              verification: { policy: { onFail: { integrity: "skip" } } },
            }),
          );
        },
      });
      try {
        await fx.session.session.prompt(
          "/goal start Create done.txt and restore README.md to its committed content. Done when: done.txt exists and README.md is unchanged",
        );
        // O desvio (skip) deixa o complete_goal executar → o auditor encontra a
        // divergência de fluxo; o diagnóstico chega assíncrono (audit em sessão
        // isolada) — espera condicional, nunca sleep mágico (D11).
        const diagnosed = await waitForCondition(() => fx.server.diagnosis.length > 0, { timeoutMs: 20_000, label: "diagnóstico adversarial" });
        expect(diagnosed).toBe(true);
        const diagnosis = fx.server.diagnosis.join("\n");
        expect(diagnosis).toContain("evidência fora de ordem");
        expect(diagnosis).toContain("write-existing-file-guard: integrity");
      } finally {
        fx.cleanup();
      }
    });
  });
});

/** Extensões do fixture com a guards substituída por um adaptador fake de judge
 *  (spy de arquivo apontado por RUNECRAFT_VERIFY_JUDGE_SPY — env test-only;
 *  resposta pass fixa). O arquivo da extensão vive num tmp (nunca no source tree). */
const CUSTOM_EXTENSIONS_WITH_JUDGE: string[] = (() => {
  const extensions = harnessExtensionPaths();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-judge-ext-"));
  const customGuards = path.join(tmpDir, "guards-judge.ts");
  fs.writeFileSync(
    customGuards,
    [
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      'import * as fs from "node:fs";',
      `import { installGuards } from "${PACKAGE_ROOT.replace(/\\/g, "/")}/src/guards/index.ts";`,
      "export default function registerGuards(pi: ExtensionAPI): void {",
      "  installGuards(pi, {",
      "    verify: {",
      "      judgeAdapter: async (request) => {",
      "        const spy = process.env.RUNECRAFT_VERIFY_JUDGE_SPY;",
      "        if (spy) fs.appendFileSync(spy, JSON.stringify({ prompt: request.prompt }) + \"\\n\");",
      '        return { ok: true, raw: JSON.stringify({ verdict: "pass", confidence: 0.8, reasons: ["output is faithful to the spec"] }) };',
      "      },",
      "    },",
      "  });",
      "}",
      "",
    ].join("\n"),
  );
  return extensions.map((ext) => (ext.endsWith("guards.ts") ? customGuards : ext));
})();
