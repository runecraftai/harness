// commands/verify.ts — CLI `harness verify` (F25, D10/VER-06).
//
// Uso manual/CI da MESMA engine da sessão (D1 — `runVerificationCascade`):
// escopo default = repo atual (working tree; goal ativo via ledger F19 quando
// presente — validado no Execute), output = diff do working tree (D10 — o
// CLI não tem mensagem de goal), judge nunca sem env (CI/merge gate F20 são
// offline por construção).
//
// Exit codes (D10): 0 pass (incl. skip/degraded com warning) · 1 fail ·
// 2 halt (cap/zona cinza com grayZoneNoJudge: halt) · 3 config/infra inválida
// (config de verificação inválida, fora de repo git). `--json` = shape do
// verify-gate do arcanum: `{ok, checks[], warnings[]}` + `verdict`.
// Kill switch `RUNECRAFT_VERIFY=0` → reporta inativo e sai 0 (AC kill switch).
import type { Runtime, TextSink } from "../config.ts";
import { loadSessionVerification } from "../verify/config.ts";
import { runVerificationCascade } from "../verify/engine.ts";
import { collectRepoState, readGllaGoalContext, repoRootOf, sessionSpec } from "../verify/repo.ts";
import type { Verdict } from "../verify/verdict.ts";
import { VERIFY_REASON_ID, type StageResult } from "../verify/verdict.ts";

export interface VerifyCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  /** override do cwd do repo (--cwd) — default rt.cwd. */
  cwd?: string;
}

/** Shape de check do verify-gate (arcanum) — espelho do report do CLI. */
export interface VerifyCheck {
  name: string;
  passed: boolean;
  exitCode?: number;
  outputExcerpt?: string;
  command?: string;
  error?: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
  warnings: string[];
  verdict: Verdict | { status: "inactive" | "config-invalid"; reason: string | null };
}

export async function runVerifyCommand(opts: VerifyCommandOptions): Promise<number> {
  const cwd = opts.cwd ?? opts.rt.cwd;
  const rt: Runtime = { cwd, env: opts.rt.env };
  const kill = loadSessionVerification(cwd, rt.env);

  // Kill switch (F20): RUNECRAFT_VERIFY=0 → inativo, exit 0 (AC 4).
  if (kill.killSwitch) {
    const report: VerifyReport = {
      ok: true,
      checks: [],
      warnings: [`verification inactive — kill switch RUNECRAFT_VERIFY=${kill.killSwitchValue ?? "0"} (F20)`],
      verdict: { status: "inactive", reason: null },
    };
    writeReport(opts, report, 0);
    return 0;
  }

  // Config inválida → fail-closed (D9): exit 3 com o motivo nomeando os campos.
  if (kill.config === undefined) {
    const report: VerifyReport = {
      ok: false,
      checks: [],
      warnings: [],
      verdict: { status: "config-invalid", reason: `verification config inválida — ${kill.problems.join("; ")}` },
    };
    writeReport(opts, report, 3);
    return 3;
  }

  // Config desabilitada → inativo (mesmo contrato do kill switch), exit 0.
  if (!kill.config.enabled) {
    const report: VerifyReport = {
      ok: true,
      checks: [],
      warnings: ["verification disabled — verification.enabled: false (config)"],
      verdict: { status: "inactive", reason: null },
    };
    writeReport(opts, report, 0);
    return 0;
  }

  // Infra: fora de repo git → não há diff do working tree (D10 — exit 3).
  if (repoRootOf(cwd, rt.env) === null) {
    const report: VerifyReport = {
      ok: false,
      checks: [],
      warnings: [],
      verdict: { status: "config-invalid", reason: "fora de repositório git — o diff do working tree é o escopo do verify (infra indisponível)" },
    };
    writeReport(opts, report, 3);
    return 3;
  }

  // Input da engine (D1/D10): spec = goal ativo do ledger (F19) quando
  // presente; output = diff do working tree; repo = estado do repo.
  const goal = readGllaGoalContext(cwd);
  const spec = goal.ok ? sessionSpec(goal.goal) : null;
  const repo = collectRepoState(cwd, rt.env);
  const output = repo.diff?.text ?? null;

  const verdict = await runVerificationCascade({ config: kill.config, spec, output, repo, env: rt.env });

  const report = buildReport(verdict);
  const exitCode = exitCodeFor(verdict);
  writeReport(opts, report, exitCode);
  return exitCode;
}

/** Monta o report no shape do verify-gate (D10): checks + warnings + verdict. */
export function buildReport(verdict: Verdict): VerifyReport {
  const checks: VerifyCheck[] = [];
  const warnings: string[] = [];
  for (const stage of verdict.stages) {
    checks.push(checkFor(stage));
    if (stage.status === "degraded") {
      warnings.push(`camada ${stage.layer} degradada — ${stage.reason}`);
    }
  }
  if (verdict.status === "skip") warnings.push(`veredito skip — ${verdict.reason ?? ""}`);
  return { ok: verdict.ok, checks, warnings, verdict };
}

/** Estágio → check do verify-gate (D12 — o runner da camada 1 vira o shape do CLI). */
export function checkFor(stage: StageResult): VerifyCheck {
  const command = typeof stage.detail?.command === "string" ? `bun run ${stage.detail.command}` : undefined;
  const exitCode = typeof stage.detail?.exitCode === "number" ? (stage.detail.exitCode as number) : undefined;
  return {
    name: stage.layer,
    passed: stage.status === "pass",
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(stage.status === "fail" ? { outputExcerpt: stage.reason, error: stage.reason } : {}),
    ...(command !== undefined ? { command } : {}),
  };
}

/** Exit codes determinísticos (D10): 0 pass/skip/degraded · 1 fail · 2 halt. */
export function exitCodeFor(verdict: Verdict): number {
  switch (verdict.status) {
    case "halt":
      return 2;
    case "fail":
      return 1;
    default:
      return 0;
  }
}

function writeReport(opts: VerifyCommandOptions, report: VerifyReport, exitCode: number): void {
  if (opts.json) {
    opts.out.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    opts.out.write(renderVerify(report, exitCode));
  }
}

function renderVerify(report: VerifyReport, exitCode: number): string {
  const verdict = report.verdict;
  const lines = ["@runecraft/companion verify (verification-cascade)"];
  if (verdict.status === "inactive") {
    lines.push(`verification INATIVA — ${report.warnings.join("; ")}`);
    lines.push(`exit ${exitCode}`);
    return `${lines.join("\n")}\n`;
  }
  if (verdict.status === "config-invalid") {
    lines.push(`config/infra INVÁLIDA — ${verdict.reason ?? "?"}`);
    lines.push(`exit ${exitCode} (corrija a seção "verification" do state.json ou rode dentro de um repo git)`);
    return `${lines.join("\n")}\n`;
  }
  const v = verdict as Verdict;
  lines.push(`verdict: ${v.status} (verifyId ${VERIFY_REASON_ID})`);
  for (const check of report.checks) {
    lines.push(`  [${check.name}] ${check.passed ? "pass" : "FAIL"}${check.command ? ` — ${check.command}` : ""}`);
    if (!check.passed && check.outputExcerpt) lines.push(`    ${check.outputExcerpt}`);
  }
  for (const warning of report.warnings) lines.push(`  warn: ${warning}`);
  const cost = v.cost;
  lines.push(`cost: cascadeRuns ${cost.cascadeRuns}/${cost.caps.maxCascadeRuns} · judgeCalls ${cost.judgeCalls}/${cost.caps.maxJudgeCalls} · judgeTokens ${cost.judgeTokens}/${cost.caps.maxJudgeTokens}`);
  lines.push(`exit ${exitCode}`);
  return `${lines.join("\n")}\n`;
}
