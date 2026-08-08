// framework/evaluators/llm-judge.test.ts — EVAL-016: llm-judge em dois tiers
// (port adaptado do llm-judge.test.ts do arcanum — SEM normalizeAliases).
//
// Tier substring: sempre, offline, RPG-free (o arcanum normalizava aliases
// thread→rogue etc. — aqui "thread" NÃO casa com "rogue"; não há aliases).
// Tier real: SÓ com RUNECRAFT_VERIFY_LLM_JUDGE=1 (padrão F25) via
// VerifyDeps.judgeAdapter; parse estrito; inválido/timeout → fail-closed;
// output vazio → fail determinístico SEM invocar o adaptador. CI nunca tem o
// env (spy nos testes — zero chamadas).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildEvalJudgePrompt,
  EVAL_JUDGE_PROMPT_VERSION,
  runLlmJudgeEvaluator,
  type LlmJudgeAdapter,
} from "../../../../src/eval/evaluators/llm-judge.ts";

const JUDGE_ENV = "RUNECRAFT_VERIFY_LLM_JUDGE";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[JUDGE_ENV];
  delete process.env[JUDGE_ENV];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[JUDGE_ENV];
  else process.env[JUDGE_ENV] = savedEnv;
});

function makeSpyAdapter(reply: { ok: true; raw: string } | { ok: false; error: string }): { adapter: LlmJudgeAdapter; calls: Array<{ prompt: string; timeoutMs: number }> } {
  const calls: Array<{ prompt: string; timeoutMs: number }> = [];
  return {
    adapter: async (request) => {
      calls.push(request);
      return reply;
    },
    calls,
  };
}

describe("EVAL-016 — tier substring (offline, RPG-free, sem normalizeAliases)", () => {
  test("expectedContains presente e forbidden ausente → pass", async () => {
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"], forbiddenContains: ["implement directly"] },
      { modelOutput: "I will delegate the planning work." },
    );
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("expectedContains ausente → fail", async () => {
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate to wizard"] },
      { modelOutput: "I will do this directly." },
    );
    expect(results.some((r) => !r.passed)).toBe(true);
    expect(results[0]!.message).toContain("missing 'delegate to wizard'");
  });

  test("sem normalizeAliases: 'thread' NÃO casa com 'rogue' (RPG-free — D8)", async () => {
    // O arcanum normalizava thread→rogue; F26 NÃO tem aliases.
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["rogue"] },
      { modelOutput: "I will delegate to thread for exploration." },
    );
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain("missing 'rogue'");
  });

  test("case-insensitive", async () => {
    const pass = await runLlmJudgeEvaluator({ kind: "llm-judge", expectedContains: ["ROGUE"] }, { modelOutput: "delegate to Rogue" });
    expect(pass[0]!.passed).toBe(true);
    const fail = await runLlmJudgeEvaluator({ kind: "llm-judge", forbiddenContains: ["implement"] }, { modelOutput: "I IMPLEMENT this" });
    expect(fail[0]!.passed).toBe(false);
  });

  test("expectedAnyOf: um dos patterns basta; nenhum → fail", async () => {
    const pass = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedAnyOf: ["delegate", "ask"] },
      { modelOutput: "I will ask for help." },
    );
    expect(pass[0]!.passed).toBe(true);
    const fail = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedAnyOf: ["delegate", "ask"] },
      { modelOutput: "I will implement this directly." },
    );
    expect(fail[0]!.passed).toBe(false);
  });

  test("sem listas explícitas → presence check (vazio → fail determinístico)", async () => {
    const present = await runLlmJudgeEvaluator({ kind: "llm-judge", rubricRef: "x" }, { modelOutput: "non-empty" });
    expect(present).toHaveLength(1);
    expect(present[0]!.passed).toBe(true);
    const empty = await runLlmJudgeEvaluator({ kind: "llm-judge", rubricRef: "x" }, { modelOutput: "" });
    expect(empty[0]!.passed).toBe(false);
    expect(empty[0]!.message).toContain("empty model output");
  });

  test("weight distribuído entre checks", async () => {
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", weight: 3, expectedContains: ["delegate"], expectedAnyOf: ["wizard", "rogue"], forbiddenContains: ["implement directly"] },
      { modelOutput: "I will delegate to wizard." },
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.maxScore === 1)).toBe(true);
  });
});

describe("EVAL-016 — tier real env-gated (F25): RUNECRAFT_VERIFY_LLM_JUDGE", () => {
  test("env off → ZERO chamadas do adaptador (spy); CI simulado offline", async () => {
    delete process.env[JUDGE_ENV];
    const { adapter, calls } = makeSpyAdapter({ ok: true, raw: JSON.stringify({ verdict: "pass", confidence: 0.9, reasons: ["ok"] }) });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "delegate" },
      { judgeAdapter: adapter },
    );
    expect(calls).toHaveLength(0);
    expect(results.every((r) => r.passed)).toBe(true); // só o substring
  });

  test("env on → adaptador chamado com critérios do spec e prompt versionado", async () => {
    process.env[JUDGE_ENV] = "1";
    const { adapter, calls } = makeSpyAdapter({ ok: true, raw: JSON.stringify({ verdict: "pass", confidence: 0.95, reasons: ["criteria met"] }) });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"], forbiddenContains: ["implement"] },
      { modelOutput: "I will delegate the planning." },
      { judgeAdapter: adapter },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain(`prompt v${EVAL_JUDGE_PROMPT_VERSION}`);
    expect(calls[0]!.prompt).toContain("delegate");
    expect(calls[0]!.prompt).toContain("implement");
    expect(calls[0]!.timeoutMs).toBeGreaterThan(0);
    // substring + tier real
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("env on + verdict fail → assertion fail com reasons", async () => {
    process.env[JUDGE_ENV] = "1";
    const { adapter } = makeSpyAdapter({ ok: true, raw: JSON.stringify({ verdict: "fail", confidence: 0.8, reasons: ["coverage incomplete"] }) });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "delegate" },
      { judgeAdapter: adapter },
    );
    const real = results[results.length - 1]!;
    expect(real.passed).toBe(false);
    expect(real.message).toContain("coverage incomplete");
  });

  test("env on + resposta JSON inválida → fail-closed", async () => {
    process.env[JUDGE_ENV] = "1";
    const { adapter } = makeSpyAdapter({ ok: true, raw: "not json" });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "delegate" },
      { judgeAdapter: adapter },
    );
    const real = results[results.length - 1]!;
    expect(real.passed).toBe(false);
    expect(real.message).toContain("fail-closed");
    expect(real.message).toContain("JSON inválido");
  });

  test("env on + adaptador devolve erro → fail-closed", async () => {
    process.env[JUDGE_ENV] = "1";
    const { adapter } = makeSpyAdapter({ ok: false, error: "timeout" });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "delegate" },
      { judgeAdapter: adapter },
    );
    expect(results[results.length - 1]!.passed).toBe(false);
    expect(results[results.length - 1]!.message).toContain("timeout");
  });

  test("env on + SEM adaptador → fail-closed com diagnóstico (wiring é o contrato)", async () => {
    process.env[JUDGE_ENV] = "1";
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "delegate" },
    );
    expect(results[results.length - 1]!.passed).toBe(false);
    expect(results[results.length - 1]!.message).toContain("nenhum adaptador de judge disponível");
  });

  test("env on + output vazio → fail determinístico SEM invocar o adaptador (spy)", async () => {
    process.env[JUDGE_ENV] = "1";
    const { adapter, calls } = makeSpyAdapter({ ok: true, raw: JSON.stringify({ verdict: "pass", confidence: 1, reasons: [] }) });
    const results = await runLlmJudgeEvaluator(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      { modelOutput: "" },
      { judgeAdapter: adapter },
    );
    expect(calls).toHaveLength(0);
    expect(results.some((r) => !r.passed)).toBe(true);
    expect(results.some((r) => r.message.includes("empty model output"))).toBe(true);
  });

  test("buildEvalJudgePrompt: prompt estável (sem timestamp/path) e versionado", () => {
    const prompt = buildEvalJudgePrompt(
      { kind: "llm-judge", expectedContains: ["delegate"] },
      "output text",
    );
    expect(prompt).toContain("prompt v1");
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
