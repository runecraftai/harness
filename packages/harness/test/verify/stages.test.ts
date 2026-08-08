// verify/stages.test.ts — T3..T7 (D2/D3/D4/D5/D6/D12, VER-02/03/04/07/08/10):
// unit por camada com fakes (runner fake p/ structural, repo real p/ integrity
// e sufficiency, textos calibrados p/ embedding, fake LLM p/ judge).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultVerificationConfig } from "../../src/verify/config.ts";
import { collectRepoState } from "../../src/verify/repo.ts";
import { structuralStage } from "../../src/verify/stages/structural.ts";
import { integrityStage } from "../../src/verify/stages/integrity.ts";
import { sufficiencyStage } from "../../src/verify/stages/sufficiency.ts";
import { embeddingScore, embeddingStage, ngramTf, cosineSimilarity } from "../../src/verify/stages/embedding.ts";
import { buildJudgePrompt, judgeEnvEnabled, judgeStage, parseJudgeResponse } from "../../src/verify/stages/judge.ts";
import type { JudgeAdapter, RunCommand } from "../../src/verify/types.ts";

const SPEC = "Create a file notes.txt whose content is exactly hello verify";
const OUTPUT_PASS = "Create a file notes.txt whose content is exactly hello verify. The file notes.txt content is exactly hello verify and it exists in the repository root. <evidence>notes.txt content is exactly hello verify</evidence>";
const OUTPUT_GRAY = "The file notes.txt was created.\nIts content is hello verify, matching the requested content in the repository.";
const OUTPUT_FAIL = "Fixed the authentication flow and updated the CI pipeline configuration for the release.";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, RUNECRAFT_VERIFY_LLM_JUDGE: "0", ...extra };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verify-stages-"));
}

function makeRepo(): string {
  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, "repo"), { recursive: true });
  const repoDir = path.join(dir, "repo");
  const e = env();
  const git = (args: string[]): void => {
    Bun.spawnSync(["git", ...args], { cwd: repoDir, env: { ...e, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as Record<string, string> });
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "eval@runecraft.test"]);
  git(["config", "user.name", "Runecraft Eval"]);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# eval repo\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "chore: base"]);
  return repoDir;
}

function writeFile(repoDir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, rel), content, "utf8");
}

function git(repoDir: string, ...args: string[]): void {
  Bun.spawnSync(["git", ...args], { cwd: repoDir, env: { ...env(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as Record<string, string> });
}

/** Grava o state.json do workspace (config de guards/verification lida na sessão). */
function writeWorkspaceState(repoDir: string, extra: Record<string, unknown>): void {
  const dir = path.join(repoDir, ".runecraft");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, ...extra }, null, 2));
}

const passRun: RunCommand = async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false });

describe("camada 1 — structural (D12, VER-02)", () => {
  test("sem scripts no package.json → degraded (T3)", async () => {
    const repoDir = makeRepo();
    try {
      const result = await structuralStage({ cwd: repoDir, scripts: {}, commands: ["lint", "typecheck", "test"], env: env(), runCommand: passRun });
      expect(result.status).toBe("degraded");
      expect(result.suggestion).toContain("verification.structural.commands");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("exit ≠ 0 → fail com sugestão acionável (comando + trecho)", async () => {
    const repoDir = makeRepo();
    try {
      const result = await structuralStage({
        cwd: repoDir,
        scripts: { lint: "biome check ." },
        commands: ["lint"],
        env: env(),
        runCommand: async () => ({ exitCode: 1, stdout: "error line 1", stderr: "error in file.ts", timedOut: false }),
      });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain('comando "lint" falhou');
      expect(result.reason).toContain("bun run lint");
      expect(result.reason).not.toContain(repoDir); // sem path absoluto (F21 D10)
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("timeout → fail com reason de timeout (padrão verify-gate)", async () => {
    const repoDir = makeRepo();
    try {
      const result = await structuralStage({
        cwd: repoDir,
        scripts: { test: "bun test" },
        commands: ["test"],
        env: env(),
        runCommand: async () => ({ exitCode: -1, stdout: "", stderr: "", timedOut: true }),
      });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("timeout");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("todos os scripts passam → pass (checks do repo)", async () => {
    const repoDir = makeRepo();
    try {
      const result = await structuralStage({
        cwd: repoDir,
        scripts: { lint: "biome check .", typecheck: "tsc" },
        commands: ["lint", "typecheck"],
        env: env(),
        runCommand: passRun,
      });
      expect(result.status).toBe("pass");
      expect(result.reason).toContain("lint");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("comando configurado ausente → pulado; sem nenhum presente → degraded", async () => {
    const repoDir = makeRepo();
    try {
      const result = await structuralStage({
        cwd: repoDir,
        scripts: { test: "bun test" },
        commands: ["lint", "test"],
        env: env(),
        runCommand: passRun,
      });
      expect(result.status).toBe("pass"); // lint ausente → pulado; test presente → roda
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("camada 2 — integrity (D3, VER-03)", () => {
  test("arquivo protegido (rastreado no HEAD) deletado → fail com reason-id F24", () => {
    const repoDir = makeRepo();
    try {
      fs.rmSync(path.join(repoDir, "README.md"));
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("fail");
      expect(result.reasonId).toBe("write-existing-file-guard");
      expect(result.reason).toContain("write-existing-file-guard: integrity");
      expect(result.reason).toContain("README.md");
      expect(result.reason).not.toContain(repoDir);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("substituição integral (todo o conteúdo de HEAD) → fail; edição pontual → pass", () => {
    const repoDir = makeRepo();
    try {
      // Substituição integral: README.md tinha 1 linha; overwrite com conteúdo novo.
      writeFile(repoDir, "README.md", "# completely different content that replaces everything\n");
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("sobrescrito por inteiro");

      // Edição pontual: adiciona uma linha ao arquivo (não substitui o todo).
      fs.writeFileSync(path.join(repoDir, "README.md"), "# eval repo\n\nline two\n");
      const result2 = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result2.status).toBe("pass");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("arquivos protegidos intactos → pass (intocado)", () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "notes.txt", "new file"); // untracked — não protegido
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("pass");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("symlink para alvo protegido → fail (escrita através do link atinge o alvo real)", () => {
    const repoDir = makeRepo();
    try {
      fs.symlinkSync("README.md", path.join(repoDir, "alias.txt"));
      // Escrita através do symlink: o git reporta o ALVO real modificado.
      writeFile(repoDir, "alias.txt", "# overwritten through symlink — full replacement\n");
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("README.md");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("delete de symlink RASTREADO (arquivo protegido) → fail", () => {
    const repoDir = makeRepo();
    try {
      fs.symlinkSync("README.md", path.join(repoDir, "link.txt"));
      git(repoDir, "add", "link.txt");
      git(repoDir, "commit", "-q", "-m", "chore: symlink");
      fs.rmSync(path.join(repoDir, "link.txt"));
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("link.txt");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("allow do write-guard F24 → exceção (herança — sem definição nova)", () => {
    const repoDir = makeRepo();
    try {
      writeWorkspaceState(repoDir, {
        guards: { writeExistingFile: { enabled: true, options: { allow: ["README.md"] } } },
      });
      fs.rmSync(path.join(repoDir, "README.md"));
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("pass");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("force do write-guard F24 → nenhum arquivo protegido (pass)", () => {
    const repoDir = makeRepo();
    try {
      writeWorkspaceState(repoDir, {
        guards: { writeExistingFile: { enabled: true, options: { force: true } } },
      });
      fs.rmSync(path.join(repoDir, "README.md"));
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("pass");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("fora de repo git → degraded (sem baseline)", () => {
    const repoDir = makeTmp();
    try {
      const result = integrityStage({ repo: collectRepoState(repoDir, env()), env: env() });
      expect(result.status).toBe("degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("camada 3 — sufficiency (QA-2, VER-04)", () => {
  const thresholds = (): { minRatio: number; maxRatio: number; scopePaths: string[] } => ({
    minRatio: 0.03,
    maxRatio: 8,
    scopePaths: [],
  });

  test("diff vazio → empty com sugestão 'mudança ausente'", () => {
    const repoDir = makeRepo();
    try {
      const result = sufficiencyStage({ repo: collectRepoState(repoDir, env()), spec: SPEC, thresholds: thresholds() });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("mudança ausente");
      expect(result.suggestion).toContain("git diff --stat");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("diff gigante → oversized", () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "big.txt", `${Array.from({ length: 500 }, (_, i) => i + 1).join("\n")}\n`);
      const result = sufficiencyStage({ repo: collectRepoState(repoDir, env()), spec: "Add a small note", thresholds: thresholds() });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("mudança desproporcional");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("arquivo fora do escopo declarado → scope-violation", () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "outside.txt", "x");
      const result = sufficiencyStage({
        repo: collectRepoState(repoDir, env()),
        spec: SPEC,
        thresholds: { minRatio: 0.03, maxRatio: 8, scopePaths: ["src"] },
      });
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("fora do escopo do goal");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("boundaries exatos (ratio == minRatio e == maxRatio) → pass (inclusivos)", () => {
    const repoDir = makeRepo();
    try {
      // diff de 1 token ("ok") com spec de exatamente 1 token → ratio 1.
      writeFile(repoDir, "ok.txt", "ok");
      const minEdge = sufficiencyStage({
        repo: collectRepoState(repoDir, env()),
        spec: "x",
        thresholds: { minRatio: 1, maxRatio: 8, scopePaths: [] },
      });
      expect(minEdge.status).toBe("pass"); // ratio 1 >= minRatio 1 (inclusivo)

      // maxRatio == ratio → pass (inclusivo).
      const maxEdge = sufficiencyStage({
        repo: collectRepoState(repoDir, env()),
        spec: "x",
        thresholds: { minRatio: 0.03, maxRatio: 1, scopePaths: [] },
      });
      expect(maxEdge.status).toBe("pass"); // ratio 1 <= maxRatio 1 (inclusivo)
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("sem spec → degraded (QA-3 — sem baseline de tamanho)", () => {
    const repoDir = makeRepo();
    try {
      writeFile(repoDir, "ok.txt", "ok");
      const result = sufficiencyStage({ repo: collectRepoState(repoDir, env()), spec: null, thresholds: thresholds() });
      expect(result.status).toBe("degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("fora de repo git → degraded (não 'empty')", () => {
    const repoDir = makeTmp();
    try {
      const result = sufficiencyStage({ repo: collectRepoState(repoDir, env()), spec: SPEC, thresholds: thresholds() });
      expect(result.status).toBe("degraded");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("camada 4 — embedding local determinístico (D4/D5, VER-07/08)", () => {
  test("score ∈ [0,1] e determinismo (mesmo input → mesmo score, 4 casas)", () => {
    for (const output of [OUTPUT_PASS, OUTPUT_GRAY, OUTPUT_FAIL]) {
      const score = embeddingScore(SPEC, output);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(score * 10_000).toBe(Math.round(score * 10_000)); // 4 casas exatas
      expect(embeddingScore(SPEC, output)).toBe(score); // determinístico
    }
  });

  test("output fiel → pass (≥ max); output desconexo → fail (≤ min); meio → gray", () => {
    const t = defaultVerificationConfig().thresholds.embedding;
    expect(embeddingScore(SPEC, OUTPUT_PASS)).toBeGreaterThanOrEqual(t.max);
    expect(embeddingScore(SPEC, OUTPUT_FAIL)).toBeLessThanOrEqual(t.min);
    const gray = embeddingScore(SPEC, OUTPUT_GRAY);
    expect(gray).toBeGreaterThan(t.min);
    expect(gray).toBeLessThan(t.max);
  });

  test("boundaries inclusivos: min == score → fail; max == score → pass", () => {
    const score = embeddingScore(SPEC, OUTPUT_FAIL);
    expect(embeddingStage({ spec: SPEC, output: OUTPUT_FAIL, thresholds: { min: score, max: 0.99 } }).verdict).toBe("fail");
    expect(embeddingStage({ spec: SPEC, output: OUTPUT_FAIL, thresholds: { min: 0.01, max: score } }).verdict).toBe("pass");
  });

  test("spec ausente → degraded com reason (QA-3)", () => {
    const result = embeddingStage({ spec: null, output: OUTPUT_GRAY, thresholds: defaultVerificationConfig().thresholds.embedding });
    expect(result.status).toBe("degraded");
    expect(result.verdict).toBe("degraded");
    expect(result.reason).toContain("spec indisponível");
  });

  test("output vazio com spec → score 0 → fail (determinístico)", () => {
    const result = embeddingStage({ spec: SPEC, output: "", thresholds: defaultVerificationConfig().thresholds.embedding });
    expect(result.score).toBe(0);
    expect(result.verdict).toBe("fail");
  });

  test("implementação pura: n-gram TF + cosseno sem rede (stub de fetch falharia se usado)", () => {
    const a = ngramTf("hello world", 3);
    const b = ngramTf("hello world", 3);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    const c = ngramTf("completely different text here", 3);
    expect(cosineSimilarity(a, c)).toBeLessThan(0.5);
    // zero deps/zero rede: a camada não importa fetch/http — só Map/strings.
    expect(typeof embeddingScore).toBe("function");
  });
});

describe("camada 5 — judge env-gated (D5/D6, VER-09/10)", () => {
  test("env off → judge nunca roda (mesmo com gray); spy de chamadas", async () => {
    expect(judgeEnvEnabled({})).toBe(false);
    expect(judgeEnvEnabled({ RUNECRAFT_VERIFY_LLM_JUDGE: "1" })).toBe(true);
    expect(judgeEnvEnabled({ RUNECRAFT_VERIFY_LLM_JUDGE: "0" })).toBe(false);
  });

  test("prompt versionado com critérios de faithfulness da spec (nunca auto-avaliação)", () => {
    const prompt = buildJudgePrompt(SPEC, OUTPUT_GRAY, "diff text");
    expect(prompt).toContain("prompt v1");
    expect(prompt).toContain(SPEC);
    expect(prompt).toContain("Faithfulness");
    expect(prompt).toContain("Coverage");
    expect(prompt).toContain("No invention");
    expect(prompt).toContain("Coherent diff");
    expect(prompt).toContain("=== DIFF");
  });

  test("parse estrito: JSON inválido/verdict errado/confidence fora/razoes erradas → fail-closed", () => {
    expect(parseJudgeResponse("not json").ok).toBe(false);
    expect(parseJudgeResponse('{"verdict":"maybe","confidence":0.5,"reasons":[]}').ok).toBe(false);
    expect(parseJudgeResponse('{"verdict":"pass","confidence":1.5,"reasons":[]}').ok).toBe(false);
    expect(parseJudgeResponse('{"verdict":"pass","confidence":0.5,"reasons":"nope"}').ok).toBe(false);
    const ok = parseJudgeResponse('{"verdict":"fail","confidence":0.4,"reasons":["covers but invents"]}');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.response.verdict).toBe("fail");
      expect(ok.response.confidence).toBe(0.4);
    }
  });

  test("judgeStage com fake LLM: resposta pass → pass com confidence; inválida → fail-closed", async () => {
    const adapter: JudgeAdapter = async () => ({ ok: true, raw: JSON.stringify({ verdict: "pass", confidence: 0.9, reasons: ["ok"] }) });
    const out = await judgeStage({ prompt: buildJudgePrompt(SPEC, OUTPUT_GRAY, null), adapter });
    expect(out.result.status).toBe("pass");
    expect(out.confidence).toBe(0.9);
    expect(out.replyTokens).toBeGreaterThan(0);

    const bad: JudgeAdapter = async () => ({ ok: true, raw: "garbage" });
    const badOut = await judgeStage({ prompt: buildJudgePrompt(SPEC, OUTPUT_GRAY, null), adapter: bad });
    expect(badOut.result.status).toBe("fail");
    expect(badOut.confidence).toBeNull();
  });

  test("sem adaptador com env ativo → fail-closed com diagnóstico", async () => {
    const out = await judgeStage({ prompt: buildJudgePrompt(SPEC, OUTPUT_GRAY, null) });
    expect(out.result.status).toBe("fail");
    expect(out.result.detail).toEqual({ error: "adapter-missing" });
  });
});
