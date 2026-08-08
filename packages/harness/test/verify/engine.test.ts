// verify/engine.test.ts — T2/T8 (D1/D2/D5/D7/D9, VER-01/05/09): a engine pura.
//
// Cobre: ordem 1→2→3→4→(5) com short-circuit (spy por camada), boundaries
// inclusivos (== min fail, == max pass), determinismo (mesmo input → mesmo
// Verdict), política RETRY/SKIP/HALT (QA-1), cost caps (F3 — cap → HALT sem
// judge), zona cinza (D5 — escalada = código), degrade (QA-3) e paridade do
// wrapper de sessão com a engine (D11 — mesmo runVerificationCascade).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultVerificationConfig, type VerificationConfig } from "../../src/verify/config.ts";
import { runSessionVerification, runVerificationCascade, sessionPayloadText } from "../../src/verify/engine.ts";
import { collectRepoState } from "../../src/verify/repo.ts";
import type { JudgeAdapter, RunCommand } from "../../src/verify/types.ts";
import { git, initEvalRepo } from "../eval/helpers/gitRepo.ts";

const SPEC = "Create a file notes.txt whose content is exactly hello verify";
const OUTPUT_PASS = "Create a file notes.txt whose content is exactly hello verify. The file notes.txt content is exactly hello verify and it exists in the repository root. <evidence>notes.txt content is exactly hello verify</evidence>";
const OUTPUT_GRAY = "The file notes.txt was created.\nIts content is hello verify, matching the requested content in the repository.";
const OUTPUT_FAIL = "Fixed the authentication flow and updated the CI pipeline configuration for the release.";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, RUNECRAFT_VERIFY_LLM_JUDGE: "0", ...extra };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verify-engine-"));
}

/** Repo de teste com um commit base (README.md rastreado). */
function makeRepo(): string {
  const dir = makeTmp();
  const repo = initEvalRepo(dir, env());
  return repo.dir;
}

function writePackage(repoDir: string, scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ scripts }, null, 2));
}

function writeFile(repoDir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, rel), content, "utf8");
}

function runCommandWith(results: Array<{ exitCode: number; timedOut?: boolean }>): { fn: RunCommand; calls: () => number } {
  let calls = 0;
  const fn: RunCommand = async () => {
    const r = results[Math.min(calls, results.length - 1)]!;
    calls += 1;
    return { exitCode: r.exitCode, stdout: "", stderr: "", timedOut: r.timedOut ?? false };
  };
  return { fn, calls: () => calls };
}

function judgeSpy(responses: Array<{ raw?: string; error?: string }>): { adapter: JudgeAdapter; calls: Array<{ prompt: string }> } {
  const calls: Array<{ prompt: string }> = [];
  const adapter: JudgeAdapter = async (request) => {
    calls.push({ prompt: request.prompt });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (r.error !== undefined) return { ok: false, error: r.error };
    return { ok: true, raw: r.raw ?? "" };
  };
  return { adapter, calls };
}

describe("engine — ordem e short-circuit (D2, VER-01)", () => {
  test("falha na camada 1 (lint) → camadas 2–4 NÃO rodam (verdict skip por default)", async () => {
    const repoDir = makeRepo();
    try {
      // Repo com arquivo protegido DELETADO — se a camada 2 rodasse, falharia.
      writeFile(repoDir, "other.txt", "x");
      git(repoDir, env(), "add", "other.txt");
      git(repoDir, env(), "commit", "-q", "-m", "chore: other");
      fs.rmSync(path.join(repoDir, "other.txt"));

      writePackage(repoDir, { lint: "biome check .", test: "bun test" });
      const config = defaultVerificationConfig();
      const repo = collectRepoState(repoDir, env());
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo, env: env() },
        { runCommand: runCommandWith([{ exitCode: 1 }]).fn },
      );
      expect(verdict.status).toBe("skip"); // structural = skip (QA-1)
      expect(verdict.ok).toBe(false);
      expect(verdict.stages.map((s) => s.layer)).toEqual(["structural"]); // short-circuit REAL
      expect(verdict.reason).toContain("verification-cascade: structural");
      expect(verdict.suggestion).toContain("bun run");
      // Reason estável: sem path absoluto, sem timestamp (F21 D10).
      expect(verdict.reason).not.toContain(repoDir);
      expect(verdict.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("ordem respeitada no fluxo completo (structural → integrity → sufficiency → embedding)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const repo = collectRepoState(repoDir, env());
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_PASS, repo, env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("pass");
      expect(verdict.stages.map((s) => s.layer)).toEqual(["structural", "integrity", "sufficiency", "embedding"]);
      expect(verdict.ok).toBe(true);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("determinismo: mesmo input → mesmo Verdict (mesmo score, mesmas stages)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const repo = collectRepoState(repoDir, env());
      const input = { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_PASS, repo, env: env() };
      const a = await runVerificationCascade(input, { runCommand: runCommandWith([{ exitCode: 0 }]).fn });
      const b = await runVerificationCascade(input, { runCommand: runCommandWith([{ exitCode: 0 }]).fn });
      expect(a).toEqual(b);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("engine — política RETRY/SKIP/HALT + cost caps (D7/D8, VER-05)", () => {
  test("retry: structural onFail retry → re-roda até passar (cap contabilizado)", async () => {
    const repoDir = makeRepo();
    try {
      const config = defaultVerificationConfig();
      config.policy.onFail.structural = "retry";
      config.policy.retry.maxRuns = 1;
      writePackage(repoDir, { lint: "biome check ." });
      const runner = runCommandWith([{ exitCode: 1 }, { exitCode: 0 }]);
      const repo = collectRepoState(repoDir, env());
      const verdict = await runVerificationCascade({ config, spec: SPEC, output: OUTPUT_PASS, repo, env: env() }, { runCommand: runner.fn });
      expect(verdict.status).toBe("pass");
      expect(verdict.cost.cascadeRuns).toBe(2); // 1ª falhou + retry
      expect(runner.calls()).toBe(2);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("retry sem orçamento (maxRuns esgotado) → HALT com contabilidade", async () => {
    const repoDir = makeRepo();
    try {
      const config = defaultVerificationConfig();
      config.policy.onFail.structural = "retry";
      config.policy.retry.maxRuns = 1;
      writePackage(repoDir, { lint: "biome check ." });
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 1 }, { exitCode: 1 }]).fn },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("cap de custo esgotado");
      expect(verdict.reason).toContain("cascadeRuns 2/3");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("maxCascadeRuns duro (1) com retry → HALT sem re-rodar além do cap", async () => {
    const repoDir = makeRepo();
    try {
      const config = defaultVerificationConfig();
      config.policy.onFail.structural = "retry";
      config.policy.retry.maxRuns = 5;
      config.costCaps.maxCascadeRuns = 1;
      writePackage(repoDir, { lint: "biome check ." });
      const runner = runCommandWith([{ exitCode: 1 }]);
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runner.fn },
      );
      expect(verdict.status).toBe("halt");
      expect(runner.calls()).toBe(1); // judge/cascade nunca além do cap
      expect(verdict.reason).toContain("cascadeRuns 1/1");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("halt (default integridade): arquivo protegido deletado → block com reason F24", async () => {
    const repoDir = makeRepo();
    try {
      fs.rmSync(path.join(repoDir, "README.md")); // protegido (rastreado no HEAD)
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("write-existing-file-guard: integrity");
      expect(verdict.reason).toContain("README.md");
      expect(verdict.reason).not.toContain(repoDir); // sem path absoluto
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("halt (default suficiência): diff vazio com spec → block 'mudança ausente'", async () => {
    const repoDir = makeRepo();
    try {
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("sufficiency");
      expect(verdict.reason).toContain("mudança ausente");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("skip registra sem bloqueio (verdict skip + sugestão)", async () => {
    const repoDir = makeRepo();
    try {
      const config = defaultVerificationConfig();
      config.policy.onFail.structural = "skip";
      writePackage(repoDir, { lint: "biome check ." });
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 1 }]).fn },
      );
      expect(verdict.status).toBe("skip");
      expect(verdict.ok).toBe(false);
      expect(verdict.suggestion).toContain("bun run lint");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("engine — embedding e zona cinza (D4/D5, VER-07/09)", () => {
  test("score >= max → pass sem judge (fake LLM NUNCA chamado)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const { adapter, calls } = judgeSpy([{ raw: "ignored" }]);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_PASS, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("pass");
      expect(calls).toHaveLength(0); // fora da zona cinza → zero invocação
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("zona cinza sem env → grayZoneNoJudge fail (default fail-closed — QA-3)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const { adapter, calls } = judgeSpy([{ raw: "ignored" }]);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("fail");
      expect(verdict.reason).toContain("zona cinza");
      expect(calls).toHaveLength(0); // env off → zero invocação (spy)
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("zona cinza + env=1 → judge chamado com a spec e critérios de faithfulness; pass → veredito pass", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const { adapter, calls } = judgeSpy([{ raw: JSON.stringify({ verdict: "pass", confidence: 0.8, reasons: ["coherent"] }) }]);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env({ RUNECRAFT_VERIFY_LLM_JUDGE: "1" }) },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("pass");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.prompt).toContain(SPEC); // a spec está no prompt (VER-10)
      expect(calls[0]!.prompt).toContain("Faithfulness"); // critérios da spec, nunca auto-avaliação
      expect(calls[0]!.prompt).not.toContain("self-eval");
      expect(verdict.judge.enabled).toBe(true);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("judge responde JSON inválido → fail-closed + contabilizado no cap", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const { adapter } = judgeSpy([{ raw: "not json" }]);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env({ RUNECRAFT_VERIFY_LLM_JUDGE: "1" }) },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("skip"); // judge onFail default skip (QA-1) — veredito + sugestão
      expect(verdict.reason).toContain("judge");
      expect(verdict.cost.judgeCalls).toBe(1); // contabilizada
      expect(verdict.cost.judgeTokens).toBeGreaterThan(0);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("cap de judge esgotado → HALT sem nova chamada (spy)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const config = defaultVerificationConfig();
      config.policy.onFail.judge = "retry";
      config.policy.retry.maxRuns = 2;
      config.costCaps.maxJudgeCalls = 1;
      const { adapter, calls } = judgeSpy([{ raw: "invalid" }]);
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env({ RUNECRAFT_VERIFY_LLM_JUDGE: "1" }) },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("cap de custo esgotado");
      expect(verdict.reason).toContain("judgeCalls 1/1");
      expect(calls).toHaveLength(1); // o judge NUNCA roda depois do cap
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("score <= min → fail sem judge (output infiel)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const { adapter, calls } = judgeSpy([{ raw: "ignored" }]);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: SPEC, output: OUTPUT_FAIL, repo: collectRepoState(repoDir, env()), env: env({ RUNECRAFT_VERIFY_LLM_JUDGE: "1" }) },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn, judgeAdapter: adapter },
      );
      expect(verdict.status).toBe("skip"); // embedding onFail skip (QA-1)
      expect(verdict.reason).toContain("embedding");
      expect(calls).toHaveLength(0);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("engine — degrade (QA-3, VER-08)", () => {
  test("sem spec → sufficiency e embedding degradam → veredito degraded (default skip)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: null, output: null, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("degraded");
      expect(verdict.ok).toBe(true); // sem essa evidência não é violação
      expect(verdict.stages.some((s) => s.status === "degraded")).toBe(true);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("degrade.embeddingUnavailable: fail → veredito fail", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const config = defaultVerificationConfig();
      config.degrade.embeddingUnavailable = "fail";
      const verdict = await runVerificationCascade(
        { config, spec: null, output: null, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("fail");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("sem scripts no repo → camada 1 degrada (T3)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const repo = collectRepoState(repoDir, env());
      expect(Object.keys(repo.scripts)).toHaveLength(0); // fixture sem package.json
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: null, output: null, repo, env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.stages[0]!.layer).toBe("structural");
      expect(verdict.stages[0]!.status).toBe("degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("engine — sufficiency (QA-2, VER-04) via repo real", () => {
  test("arquivo fora do scopePaths → scope-violation (fail → halt)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "outside.txt", "x");
      const config = defaultVerificationConfig();
      config.thresholds.sufficiency.scopePaths = ["src"];
      const verdict = await runVerificationCascade(
        { config, spec: SPEC, output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("scope-violation".replace("scope-violation", "fora do escopo"));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("diff gigante → oversized (halt)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "big.txt", `${Array.from({ length: 500 }, (_, i) => i + 1).join("\n")}\n`);
      const verdict = await runVerificationCascade(
        { config: defaultVerificationConfig(), spec: "Add a small note", output: OUTPUT_GRAY, repo: collectRepoState(repoDir, env()), env: env() },
        { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      );
      expect(verdict.status).toBe("halt");
      expect(verdict.reason).toContain("mudança desproporcional");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("wrapper de sessão — paridade e payload (D11/F1)", () => {
  test("sessionPayloadText extrai completionSummary + verificationSummary", () => {
    expect(sessionPayloadText({ completionSummary: "done", verificationSummary: "<evidence>x</evidence>" })).toBe(
      "done\n<evidence>x</evidence>",
    );
    expect(sessionPayloadText({ newObjective: "shift" })).toBeNull(); // fallback diff
    expect(sessionPayloadText({})).toBeNull();
  });

  test("runSessionVerification: sem goal (ledger vazio) → spec null → degrada sem bloquear", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "hello verify");
      const result = await runSessionVerification({
        cwd: repoDir,
        env: env(),
        config: defaultVerificationConfig(),
        input: { completionSummary: "done" },
        deps: { runCommand: runCommandWith([{ exitCode: 0 }]).fn },
      });
      expect(result.block).toBe(false);
      expect(result.verdict!.status).toBe("degraded");
      // O veredito é registrado no log da sessão (D8 — precedente do ledger).
      const logFile = path.join(repoDir, ".runecraft", "verify-verdicts.jsonl");
      expect(fs.existsSync(logFile)).toBe(true);
      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain("degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
