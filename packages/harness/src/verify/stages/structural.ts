// verify/stages/structural.ts — camada 1: scripts do repo (F25, D12/VER-02).
//
// Port do `verify-gate` do arcanum (D12): exec com timeout + `{exitCode,
// stdout, stderr, timedOut}`; defaults = scripts detectados no package.json
// do repo (lint/typecheck/test — validado no Execute: a raiz git do harness
// tem lint/test; o cwd do package tem test/typecheck), override
// `verification.structural.commands`. Sem nenhum script → degraded (T3 —
// "comando ausente → degraded"; a sugestão carrega o conteúdo dos checks do
// verification-reminder: rode os checks e valide o comportamento).
import type { VerificationConfig } from "../config.ts";
import type { RunCommand } from "../types.ts";
import type { StageResult } from "../verdict.ts";
import { structuralDegradedReason, structuralFailReason, structuralTimeoutReason, sanitizeExcerpt } from "../suggestions.ts";

export const STRUCTURAL_TIMEOUT_MS = 120_000;

export interface StructuralStageInput {
  cwd: string;
  scripts: Record<string, string>;
  commands: string[];
  env: NodeJS.ProcessEnv;
  runCommand?: RunCommand;
}

/**
 * Camada 1 (D2 — a mais barata): roda os scripts de checks do repo em ordem
 * (lint, typecheck, test) com timeout por comando. A PRIMEIRA falha
 * short-circuita (camadas 2+ não rodam — "o que cai no lint não chega ao
 * judge"). Sem scripts → degraded (a cascata segue; não é falha).
 */
export async function structuralStage(input: StructuralStageInput): Promise<StageResult> {
  const run = input.runCommand ?? defaultRunCommand;
  const commands = input.commands.length > 0 ? input.commands : ["lint", "typecheck", "test"];
  const present = commands.filter((name) => input.scripts[name] !== undefined);

  if (present.length === 0) {
    return {
      layer: "structural",
      status: "degraded",
      reasonId: "verification-cascade",
      reason: structuralDegradedReason(),
      suggestion: "adicione scripts lint/typecheck/test (ou configure verification.structural.commands) para habilitar os checks",
      detail: { scripts: [] },
    };
  }

  for (const name of present) {
    const result = await run(["bun", "run", name], input.cwd, STRUCTURAL_TIMEOUT_MS, input.env);
    if (result.timedOut) {
      const reason = structuralTimeoutReason(name, STRUCTURAL_TIMEOUT_MS);
      return {
        layer: "structural",
        status: "fail",
        reasonId: "verification-cascade",
        reason,
        suggestion: `rode "bun run ${name}" localmente e verifique se o check conclui dentro do limite`,
        detail: { command: name, timedOut: true },
      };
    }
    if (result.exitCode !== 0) {
      const excerpt = sanitizeExcerpt(`${result.stdout}\n${result.stderr}`, input.cwd);
      const reason = structuralFailReason(name, result.exitCode, excerpt);
      return {
        layer: "structural",
        status: "fail",
        reasonId: "verification-cascade",
        reason,
        suggestion: `rode "bun run ${name}" e corrija os erros reportados (checks do repo)`,
        detail: { command: name, exitCode: result.exitCode },
      };
    }
  }

  return {
    layer: "structural",
    status: "pass",
    reasonId: "verification-cascade",
    reason: `comandos ok: ${present.join(", ")}`,
    suggestion: "",
    detail: { commands: present },
  };
}

/** Executor padrão (verify-gate do arcanum — exec + timeout + shape estável).
 *  Timeout real (fix cleric F25): o timer marca `timedOut`, envia SIGTERM e
 *  escala para SIGKILL após 5s — um check que ignore SIGTERM não pode
 *  pendurar o gate do complete_goal (fail-closed em vez de hang). */
export const defaultRunCommand: RunCommand = async (cmd, cwd, timeoutMs, env): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // processo já encerrado
    }
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // já encerrado pelo SIGTERM — ok
      }
    }, 5_000);
  }, timeoutMs);
  try {
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { exitCode, stdout, stderr, timedOut };
  } catch {
    return { exitCode: -1, stdout: "", stderr: "", timedOut };
  } finally {
    clearTimeout(timer);
  }
};

/** Guard de tipos (a camada recebe a config validada — o engine resolve antes). */
export function structuralCommands(config: VerificationConfig): string[] {
  return config.structural.commands;
}
