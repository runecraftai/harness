// verify/engine.ts — engine da cascata de verificação (F25, D1/D2/D5/D7/D8).
//
// `runVerificationCascade(input)` é a MESMA engine pura do gate de sessão
// (complete_goal — D11) e do CLI `harness verify` (D10): ordenada 1→2→3→4→5
// com short-circuit (falha em camada barata impede as mais caras — "o que
// cai no lint não chega ao judge"), boundaries inclusivos (D5) e escalada ao
// judge SÓ na zona cinza com `RUNECRAFT_VERIFY_LLM_JUDGE=1`. A função é
// determinística dado o input (config congelada, spec, output, diff,
// repoState, env); as únicas fronteiras de I/O entram por injeção
// (VerifyDeps — runCommand/judgeAdapter; testes usam fakes).
//
// Resolução de política (D7/D8, QA-1):
//   fail de camada → onFail[layer]: retry (re-roda até maxCascadeRuns/cap) |
//   skip (veredito + sugestão, sem bloqueio) | halt (block). Cap esgotado →
//   HALT sem judge com contabilidade (F3). degraded → degrade.
//   embeddingUnavailable (default skip); zona cinza sem judge →
//   degrade.grayZoneNoJudge (default fail — QA-3 fail-closed).
//
// `runSessionVerification` é o wrapper de sessão (F1): prepara o input a
// partir do cwd (spec do ledger do glla, output do payload do complete_goal
// com fallback no diff, diff do working tree) e grava o veredito no log da
// sessão (veredito "gravado no state" — D8; precedente do ledger do glla).
import * as fs from "node:fs";
import * as path from "node:path";
import type { VerificationConfig } from "./config.ts";
import { verdictLogPath } from "./config.ts";
import { CostLedger, estimateTokens } from "./cost.ts";
import type { RepoState } from "./repo.ts";
import { collectRepoState, readGllaGoalContext, sessionSpec } from "./repo.ts";
import { costCapReason, embeddingGrayNoJudgeReason, formatReason } from "./suggestions.ts";
import type { VerifyDeps } from "./types.ts";
import { VERIFY_REASON_ID, type StageResult, type Verdict } from "./verdict.ts";
import { structuralStage } from "./stages/structural.ts";
import { integrityStage, writeGuardExemptions } from "./stages/integrity.ts";
import { loadSessionGuards } from "../guards/guardKit.ts";
import { sufficiencyStage } from "./stages/sufficiency.ts";
import { embeddingStage, type EmbeddingStageResult } from "./stages/embedding.ts";
import { buildJudgePrompt, judgeEnvEnabled, judgeStage } from "./stages/judge.ts";

/** Input da engine (D1): config congelada + spec + output + diff + repoState + env. */
export interface VerificationInput {
  config: VerificationConfig;
  /** spec do goal (objective + taskList); null = sem baseline (camadas degradam). */
  spec: string | null;
  /** output do trabalho (payload do complete_goal; diff no CLI — D10). */
  output: string | null;
  repo: RepoState;
  env: NodeJS.ProcessEnv;
}

/** Monta um veredito de resolução (skip/degraded/fail/halt) preservando as
 *  stages que RODARAM (a stage que resolveu já está em `stages` — camadas de
 *  falha são pushadas antes do check; a da zona cinza entra por `[...stages, stage]`). */
function resolvedVerdict(
  status: Verdict["status"],
  stage: StageResult,
  stages: StageResult[],
  cost: CostLedger,
  judgeEnabled: boolean,
  extra?: Partial<Verdict>,
): Verdict {
  return {
    ok: false,
    status,
    verifyId: VERIFY_REASON_ID,
    stages,
    reason: stage.reason,
    suggestion: stage.suggestion,
    cost: cost.summary(),
    judge: { enabled: judgeEnabled },
    ...extra,
  };
}

/** Veredito de pass (todas as camadas). */
function passVerdict(stages: StageResult[], cost: CostLedger, judgeEnabled: boolean): Verdict {
  return {
    ok: true,
    status: "pass",
    verifyId: VERIFY_REASON_ID,
    stages,
    reason: null,
    suggestion: null,
    cost: cost.summary(),
    judge: { enabled: judgeEnabled },
  };
}

/** Veredito de halt por cap esgotado (F3 — reason com contabilidade). */
function costHaltVerdict(cost: CostLedger, judgeEnabled: boolean, stages: StageResult[] = []): Verdict {
  const reason = costCapReason(cost.accountingText());
  return {
    ok: false,
    status: "halt",
    verifyId: VERIFY_REASON_ID,
    stages,
    reason,
    suggestion: "HALT sem judge — aumente os costCaps ou reduza o escopo do goal; o judge nunca roda depois do cap",
    cost: cost.summary(),
    judge: { enabled: judgeEnabled },
  };
}

/**
 * A engine (D1/D2/D5/D7): pipeline ordenado com short-circuit + política +
 * cost caps. Determinística dado o input e as deps injetadas.
 */
export async function runVerificationCascade(input: VerificationInput, deps: VerifyDeps = {}): Promise<Verdict> {
  const { config } = input;
  const judgeEnabled = judgeEnvEnabled(input.env);
  const cost = new CostLedger(config.costCaps);
  const maxRetries = config.policy.retry.maxRuns;
  let retriesUsed = 0;
  const runCommand = deps.runCommand;
  const judgeAdapter = deps.judgeAdapter;
  // Fix cleric F25 (freeze drift): exceções do write-guard resolvidas UMA vez
  // por execução — sessão usa o snapshot congelado do F24 (D12); CLI carrega
  // no início da execução (mesma semântica: sem drift mid-run).
  const guardExemptions = deps.guardExemptions ?? writeGuardExemptions(loadSessionGuards(input.repo.cwd, input.env));

  // Loop de execuções (D7): a 1ª conta como 1; retry re-roda até o cap.
  let stages: StageResult[] = [];
  for (;;) {
    if (!cost.startCascadeRun()) {
      return costHaltVerdict(cost, judgeEnabled, stages);
    }
    stages = [];

    // Camada 1 — structural (mais barata; short-circuit em fail).
    const structural = await structuralStage({
      cwd: input.repo.cwd,
      scripts: input.repo.scripts,
      commands: config.structural.commands,
      env: input.env,
      runCommand,
    });
    stages.push(structural);
    if (structural.status === "fail") {
      const resolution = resolvePolicy(config, "structural", retriesUsed, maxRetries, cost);
      if (resolution === "retry") {
        retriesUsed += 1;
        continue;
      }
      if (resolution === "halt") return costHaltVerdict(cost, judgeEnabled, stages);
      return resolvedVerdict("skip", structural, stages, cost, judgeEnabled);
    }

    // Camada 2 — integrity (D3; política default halt — guardrail HARD).
    const integrity = integrityStage({ repo: input.repo, exemptions: guardExemptions });
    stages.push(integrity);
    if (integrity.status === "fail") {
      const resolution = resolvePolicy(config, "integrity", retriesUsed, maxRetries, cost);
      if (resolution === "retry") {
        retriesUsed += 1;
        continue;
      }
      if (resolution === "halt") return resolvedVerdict("halt", integrity, stages, cost, judgeEnabled);
      return resolvedVerdict("skip", integrity, stages, cost, judgeEnabled);
    }

    // Camada 3 — sufficiency (QA-2; política default halt).
    const sufficiency = sufficiencyStage({
      repo: input.repo,
      spec: input.spec,
      thresholds: config.thresholds.sufficiency,
    });
    stages.push(sufficiency);
    if (sufficiency.status === "fail") {
      const resolution = resolvePolicy(config, "sufficiency", retriesUsed, maxRetries, cost);
      if (resolution === "retry") {
        retriesUsed += 1;
        continue;
      }
      if (resolution === "halt") return resolvedVerdict("halt", sufficiency, stages, cost, judgeEnabled);
      return resolvedVerdict("skip", sufficiency, stages, cost, judgeEnabled);
    }

    // Camada 4 — embedding (D4/D5; gray é resolvido aqui — D5: escalada = código).
    const embedding = embeddingStage({
      spec: input.spec,
      output: input.output,
      thresholds: config.thresholds.embedding,
    });
    stages.push(embedding);
    if (embedding.status === "degraded") {
      // Degraded não é falha — a cascata segue; o veredito final resolve o
      // degrade policy (QA-3) se nenhuma camada falhar.
      break;
    }
    if (embedding.status === "fail") {
      const resolution = resolvePolicy(config, "embedding", retriesUsed, maxRetries, cost);
      if (resolution === "retry") {
        retriesUsed += 1;
        continue;
      }
      if (resolution === "halt") return resolvedVerdict("halt", embedding, stages, cost, judgeEnabled);
      return resolvedVerdict("skip", embedding, stages, cost, judgeEnabled);
    }

    // Zona cinza (D5): escalada SÓ com env ativo; senão grayZoneNoJudge (QA-3).
    if (embedding.verdict === "gray") {
      const gray = await resolveGrayZone({
        embedding,
        spec: input.spec ?? "",
        output: input.output ?? "",
        diffText: input.repo.diff?.text ?? null,
        config,
        cost,
        judgeEnabled,
        judgeAdapter,
        stages,
      });
      if (gray.kind === "verdict") return gray.verdict;
      if (gray.kind === "judge-fail") {
        const resolution = resolvePolicy(config, "judge", retriesUsed, maxRetries, cost);
        if (resolution === "retry") {
          retriesUsed += 1;
          continue;
        }
        if (resolution === "halt") return costHaltVerdict(cost, judgeEnabled, stages);
        return resolvedVerdict("skip", gray.stage, stages, cost, judgeEnabled);
      }
      // judge-pass → veredito final pass, com a stage do judge no relatório
      // (fix cleric F25: sem ela, todo pass era rotulado "structural" no log).
      return passVerdict([...stages, gray.stage], cost, judgeEnabled);
    }

    // Camada 4 passou (score >= max) — veredito final pass.
    return passVerdict(stages, cost, judgeEnabled);
  }

  // Fim com camadas degradadas (nenhuma falha): resolve o degrade policy (QA-3).
  const degraded = stages.find((s) => s.status === "degraded");
  if (degraded !== undefined) {
    const action = config.degrade.embeddingUnavailable;
    if (action === "halt") return resolvedVerdict("halt", degraded, stages, cost, judgeEnabled);
    if (action === "fail") return resolvedVerdict("fail", degraded, stages, cost, judgeEnabled);
    return { ...resolvedVerdict("degraded", degraded, stages, cost, judgeEnabled), ok: true };
  }
  return passVerdict(stages, cost, judgeEnabled);
}

/** Resolve a política de UM fail (D7/D8). `"retry"` quando ainda há orçamento. */
function resolvePolicy(
  config: VerificationConfig,
  layer: keyof VerificationConfig["policy"]["onFail"],
  retriesUsed: number,
  maxRetries: number,
  cost: CostLedger,
): "retry" | "skip" | "halt" {
  const action = config.policy.onFail[layer];
  if (action !== "retry") return action;
  if (retriesUsed >= maxRetries) return "halt"; // sem orçamento de retry → cap → HALT
  if (cost.cascadeCapped) return "halt"; // maxCascadeRuns esgotado → HALT
  return "retry";
}

interface GrayZoneContext {
  embedding: EmbeddingStageResult;
  spec: string;
  output: string;
  diffText: string | null;
  config: VerificationConfig;
  cost: CostLedger;
  judgeEnabled: boolean;
  judgeAdapter?: VerifyDeps["judgeAdapter"];
  /** stages que já rodaram na execução atual (report completo do veredito). */
  stages: StageResult[];
}

type GrayOutcome =
  | { kind: "verdict"; verdict: Verdict }
  | { kind: "judge-fail"; stage: StageResult }
  | { kind: "judge-pass"; stage: StageResult };

/** Resolve a zona cinza (D5/D6): judge com env ativo; senão grayZoneNoJudge. */
async function resolveGrayZone(ctx: GrayZoneContext): Promise<GrayOutcome> {
  if (!ctx.judgeEnabled) {
    const stage: StageResult = {
      layer: "embedding",
      status: "fail",
      reasonId: VERIFY_REASON_ID,
      reason: embeddingGrayNoJudgeReason(ctx.embedding.score ?? 0, ctx.config.thresholds.embedding.min, ctx.config.thresholds.embedding.max),
      suggestion: "confirme na conversa que cada linha do diff cumpre a spec (gate decision) ou habilite o judge (RUNECRAFT_VERIFY_LLM_JUDGE=1) — CI não certifica caso duvidoso sem judge",
      detail: { gray: true, score: ctx.embedding.score },
    };
    const action = ctx.config.degrade.grayZoneNoJudge;
    const allStages = [...ctx.stages, stage];
    if (action === "halt") return { kind: "verdict", verdict: resolvedVerdict("halt", stage, allStages, ctx.cost, ctx.judgeEnabled) };
    if (action === "fail") return { kind: "verdict", verdict: resolvedVerdict("fail", stage, allStages, ctx.cost, ctx.judgeEnabled) };
    return { kind: "verdict", verdict: resolvedVerdict("skip", stage, allStages, ctx.cost, ctx.judgeEnabled) };
  }

  // Judge: caps checados ANTES da chamada (D7/F3 — cap esgotado → HALT sem judge).
  const prompt = buildJudgePrompt(ctx.spec, ctx.output, ctx.diffText);
  const promptTokens = estimateTokens(prompt);
  if (!ctx.cost.canCallJudge(promptTokens)) {
    return { kind: "verdict", verdict: costHaltVerdict(ctx.cost, ctx.judgeEnabled, ctx.stages) };
  }
  const outcome = await judgeStage({ prompt, adapter: ctx.judgeAdapter });
  ctx.cost.recordJudgeCall(promptTokens);
  ctx.cost.recordJudgeReply(outcome.replyTokens);

  if (outcome.result.status === "fail") {
    return { kind: "judge-fail", stage: outcome.result };
  }
  return { kind: "judge-pass", stage: outcome.result };
}

// ---------------------------------------------------------------------------
// Wrapper de sessão (F1 — D11): usado pelo enforcer no branch complete_goal.
// ---------------------------------------------------------------------------

export interface SessionVerificationResult {
  /** true → o handler deve bloquear com reason. */
  block: boolean;
  verdict: Verdict | null;
  reason: string | null;
}

export interface SessionVerifyContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  config: VerificationConfig;
  /** payload do complete_goal (shape validado no Execute: completionSummary/verificationSummary). */
  input: Record<string, unknown>;
  deps?: VerifyDeps;
}

/**
 * Roda a cascata para a sessão (F1): spec = ledger do glla (objective +
 * taskList), output = payload do complete_goal (fallback: diff do working
 * tree — edge da spec "complete_goal sem mensagem", validado no Execute: o
 * handler de tool_call não tem acesso ao transcript), diff = working tree.
 * O veredito é gravado no log da sessão (D8 — precedente do ledger).
 */
export async function runSessionVerification(ctx: SessionVerifyContext): Promise<SessionVerificationResult> {
  const goal = readGllaGoalContext(ctx.cwd);
  const spec = goal.ok ? sessionSpec(goal.goal) : null;
  const repo = collectRepoState(ctx.cwd, ctx.env);

  const payloadText = sessionPayloadText(ctx.input);
  const output = payloadText !== null ? payloadText : (repo.diff?.text ?? null);

  const verdict = await runVerificationCascade(
    { config: ctx.config, spec, output, repo, env: ctx.env },
    ctx.deps ?? {},
  );

  recordSessionVerdict(ctx.cwd, verdict);

  if (verdict.status === "halt") {
    return { block: true, verdict, reason: verdict.reason };
  }
  return { block: false, verdict, reason: null };
}

/** Texto do payload do complete_goal (completionSummary + verificationSummary). */
export function sessionPayloadText(input: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const key of ["completionSummary", "verificationSummary"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) parts.push(value);
  }
  const text = parts.join("\n").trim();
  return text.length > 0 ? text : null;
}

/** Grava o veredito no log da sessão (append-only JSONL — precedente do glla).
 *  O `layer` registrado é o da stage que RESOLVEU o veredito: última não-pass
 *  (fail/skip/halt/degraded) — veredito pass → última stage executada
 *  (embedding ou judge, nunca "structural" — fix cleric F25). */
export function recordSessionVerdict(cwd: string, verdict: Verdict): void {
  const file = verdictLogPath(cwd);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let resolving: StageResult | undefined;
    for (const stage of verdict.stages) {
      if (stage.status !== "pass") resolving = stage;
    }
    if (resolving === undefined) resolving = verdict.stages[verdict.stages.length - 1];
    const line = JSON.stringify({
      verifyId: verdict.verifyId,
      status: verdict.status,
      layer: resolving?.layer ?? null,
      reason: verdict.reason,
      suggestion: verdict.suggestion,
      cost: verdict.cost,
    });
    fs.appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    // Log é best-effort — nunca derruba o handler do complete_goal.
  }
}

/** Reason fail-closed de config inválida (D9 — usado pelo enforcer). */
export function configInvalidReason(problems: string[]): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "config",
    motivo: problems.join("; "),
    suggestion: 'corrija a seção "verification" do state.json (workspace > global)',
  });
}
