// verify/cli.test.ts — T10 (D10, VER-06): CLI `harness verify` com a MESMA
// engine — exit codes determinísticos 0/1/2/3, --json shape (verify-gate do
// arcanum), kill switch e paridade com o veredito da engine (mesma
// runVerificationCascade no mesmo repo/spec).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dispatch } from "../../src/cli.ts";
import { defaultVerificationConfig } from "../../src/verify/config.ts";
import { runVerificationCascade } from "../../src/verify/engine.ts";
import { collectRepoState, sessionSpec, readGllaGoalContext } from "../../src/verify/repo.ts";
import { evalTest } from "../eval/helpers/evalTest.ts";

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(String(chunk));
  }
  get text(): string {
    return this.chunks.join("");
  }
}

const SPEC = "Create a file notes.txt whose content is exactly hello verify";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verify-cli-"));
}

/** Repo git com commit base (README.md) + state.json opcional. */
function makeRepo(extra: Record<string, unknown> = {}): string {
  const dir = makeTmp();
  const repoDir = path.join(dir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });
  const e = process.env;
  const git = (args: string[]): void => {
    Bun.spawnSync(["git", ...args], { cwd: repoDir, env: { ...e, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as Record<string, string> });
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "eval@runecraft.test"]);
  git(["config", "user.name", "Runecraft Eval"]);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# eval repo\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "chore: base"]);
  if (Object.keys(extra).length > 0) {
    fs.mkdirSync(path.join(repoDir, ".runecraft"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".runecraft", "state.json"), JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, ...extra }, null, 2));
  }
  return repoDir;
}

/** Ledger do glla com goal ATIVO (spec da cascata). */
function writeActiveGoal(repoDir: string, objective: string): void {
  fs.mkdirSync(path.join(repoDir, ".pi-glla"), { recursive: true });
  const line = JSON.stringify({ type: "state", value: { goal: { status: "active", id: "g1", objective }, list: [], loop: null }, at: "2026-08-08T00:00:00.000Z" });
  fs.writeFileSync(path.join(repoDir, ".pi-glla", "active.jsonl"), `${line}\n`, "utf8");
}

function writeFile(repoDir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, rel), content, "utf8");
}

async function runVerify(cwd: string, json = false): Promise<{ code: number; stdout: string }> {
  const out = new StringSink();
  const err = new StringSink();
  const code = await dispatch(json ? ["verify", "--json"] : ["verify"], { cwd, env: process.env, stdout: out, stderr: err });
  return { code, stdout: out.text };
}

describe("CLI verify — exit codes determinísticos (D10, VER-06)", () => {
  test("repo limpo sem goal → 0 (camadas degradam sem spec — sem essa evidência não é violação)", async () => {
    const repoDir = makeRepo();
    try {
      const { code, stdout } = await runVerify(repoDir);
      expect(code).toBe(0);
      expect(stdout).toContain("verdict: degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("lint quebrado (política default skip) → 0 com warning (veredito + sugestão)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "package.json", JSON.stringify({ scripts: { lint: "exit 1" } }));
      const { code, stdout } = await runVerify(repoDir, true);
      expect(code).toBe(0); // skip → 0 com warning (D10)
      const report = JSON.parse(stdout) as {
        ok: boolean;
        checks: Array<{ name: string; passed: boolean }>;
        warnings: string[];
        verdict: { status: string };
      };
      expect(report.verdict.status).toBe("skip");
      expect(report.ok).toBe(false);
      const structural = report.checks.find((c) => c.name === "structural");
      expect(structural).toBeDefined();
      expect(structural!.passed).toBe(false);
      expect(report.warnings.some((w) => w.includes("skip"))).toBe(true);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("zona cinza sem judge → 1 (grayZoneNoJudge fail — fail-closed)", async () => {
    const repoDir = makeRepo();
    try {
      writeActiveGoal(repoDir, SPEC);
      writeFile(repoDir, "notes.txt", "hello verify");
      const { code, stdout } = await runVerify(repoDir);
      expect(code).toBe(1);
      expect(stdout).toContain("verdict: fail");
      expect(stdout).toContain("zona cinza");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("halt (goal ativo + diff vazio → sufficiency halt) → 2", async () => {
    const repoDir = makeRepo();
    try {
      writeActiveGoal(repoDir, SPEC);
      const { code, stdout } = await runVerify(repoDir);
      expect(code).toBe(2);
      expect(stdout).toContain("verdict: halt");
      expect(stdout).toContain("mudança ausente");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("config inválida (min >= max) → 3 com motivo", async () => {
    const repoDir = makeRepo({
      verification: { thresholds: { embedding: { min: 0.9, max: 0.1 } } },
    });
    try {
      const { code, stdout } = await runVerify(repoDir);
      expect(code).toBe(3);
      expect(stdout).toContain("config/infra INVÁLIDA");
      expect(stdout).toContain("deve ser < max");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("fora de repo git → 3 (infra)", async () => {
    const dir = makeTmp();
    try {
      const { code, stdout } = await runVerify(dir);
      expect(code).toBe(3);
      expect(stdout).toContain("fora de repositório git");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kill switch RUNECRAFT_VERIFY=0 → inativo, exit 0", async () => {
    const repoDir = makeRepo();
    try {
      const out = new StringSink();
      const err = new StringSink();
      const code = await dispatch(["verify"], {
        cwd: repoDir,
        env: { ...process.env, RUNECRAFT_VERIFY: "0" },
        stdout: out,
        stderr: err,
      });
      expect(code).toBe(0);
      expect(out.text).toContain("verification INATIVA");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("--json shape {ok, checks[], warnings[], verdict} estável (golden)", async () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "package.json", JSON.stringify({ scripts: { lint: "exit 1" } }));
      const { code, stdout } = await runVerify(repoDir, true);
      expect(code).toBe(0);
      const report = JSON.parse(stdout) as Record<string, unknown>;
      expect(Object.keys(report).sort()).toEqual(["checks", "ok", "verdict", "warnings"]);
      const verdict = report.verdict as Record<string, unknown>;
      expect(typeof verdict.verifyId).toBe("string");
      expect(Array.isArray(verdict.stages)).toBe(true);
      const cost = verdict.cost as Record<string, unknown>;
      expect(typeof cost.cascadeRuns).toBe("number");
      expect(typeof cost.judgeCalls).toBe("number");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("--cwd aponta para outro repo (escopo do verify)", async () => {
    const repoDir = makeRepo();
    try {
      const other = makeTmp();
      try {
        const out = new StringSink();
        const err = new StringSink();
        const code = await dispatch(["verify", "--cwd", repoDir], {
          cwd: other,
          env: process.env,
          stdout: out,
          stderr: err,
        });
        expect(code).toBe(0); // repoDir limpo (sem goal) → 0
        expect(out.text).toContain("verdict: degraded");
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("CLI verify — paridade com a engine (D1)", () => {
  test("EVAL-011: o veredito do CLI == runVerificationCascade no mesmo repo/spec (mesma engine)", async () => {
    await evalTest("EVAL-011: o veredito do CLI == runVerificationCascade no mesmo repo/spec (mesma engine)", async () => {
      const repoDir = makeRepo();
      try {
        writeActiveGoal(repoDir, SPEC);
        writeFile(repoDir, "notes.txt", "hello verify");
        const repo = collectRepoState(repoDir, process.env);
        const goal = readGllaGoalContext(repoDir);
        const spec = goal.ok ? sessionSpec(goal.goal) : null;

        const engineVerdict = await runVerificationCascade({
          config: defaultVerificationConfig(),
          spec,
          output: repo.diff?.text ?? null, // CLI usa o diff como output (D10)
          repo,
          env: process.env,
        });

        const { code, stdout } = await runVerify(repoDir, true);
        const report = JSON.parse(stdout) as { verdict: { status: string; cost: { cascadeRuns: number } } };
        // Paridade: mesmo status e mesma contabilidade de execuções (1 corrida).
        expect(report.verdict.status).toBe(engineVerdict.status);
        expect(report.verdict.cost.cascadeRuns).toBe(engineVerdict.cost.cascadeRuns);
        expect(code).toBe(exitCodeForStatus(engineVerdict.status));
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
      }
    }, { evalId: "EVAL-011" });
  });
});

/** Espelho do mapping de exit codes do commands/verify.ts (D10). */
function exitCodeForStatus(status: string): number {
  switch (status) {
    case "halt":
      return 2;
    case "fail":
      return 1;
    default:
      return 0;
  }
}
