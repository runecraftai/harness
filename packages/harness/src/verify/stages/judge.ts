// verify/stages/judge.ts — camada 5: judge LLM env-gated (F25, D5/D6/VER-09/10).
//
// A decisão de escalar é SEMPRE código (D5 — boundaries min/max); o judge
// roda SÓ quando a camada 4 devolve `gray` E `RUNECRAFT_VERIFY_LLM_JUDGE=1`
// (env off → ZERO invocação — CI e merge gate F20 são offline por
// construção; verificado por spy nos testes).
//
// Critérios de FAITHFULNESS derivados da spec (nunca auto-avaliação — D6):
// o output cobre o escopo declarado, não inventa, o diff é coerente. O
// prompt é VERSIONADO (constante estável para a evidência F21 D10).
// Saída JSON estrita `{verdict: pass|fail, confidence, reasons[]}`;
// inválida/timeout → fail-closed + contabilizada no cap (D7/F3).
//
// Mecanismo (validado no Execute): o adaptador é uma dependência injetada
// (VerifyDeps.judgeAdapter) — a engine nunca constrói chamada de rede; sem
// adapter com env ativo → fail-closed com diagnóstico (o wiring de um LLM
// real é a interface do contrato; testes usam fake LLM).
import { estimateTokens } from "../cost.ts";
import type { JudgeReply } from "../types.ts";
import { embeddingGrayNoJudgeReason, judgeFailReason, judgeInvalidReason } from "../suggestions.ts";
import type { JudgeAdapter } from "../types.ts";
import type { StageResult } from "../verdict.ts";

/** Versão do prompt de faithfulness (estável — normalização F21 D10). */
export const JUDGE_PROMPT_VERSION = 1 as const;

export const JUDGE_TIMEOUT_MS = 60_000 as const;

export interface JudgeResponse {
  verdict: "pass" | "fail";
  confidence: number;
  reasons: string[];
}

/** Env de habilitação do judge (D6 — padrão F22). */
export function judgeEnvEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.RUNECRAFT_VERIFY_LLM_JUDGE?.trim() === "1";
}

/**
 * Prompt versionado de faithfulness (D6 — derivado da SPEC, nunca
 * auto-avaliação: o judge não avalia o próprio desempenho nem decide escalar).
 */
export function buildJudgePrompt(spec: string, output: string, diffText: string | null): string {
  return [
    `You are a verification judge (harness, prompt v${JUDGE_PROMPT_VERSION}).`,
    "Judge whether the OUTPUT is faithful to the SPEC. Faithfulness criteria (derived from the spec):",
    "1. Coverage — the output covers the declared scope of the spec (every contract item is addressed).",
    "2. No invention — the output does not claim or add behavior outside the declared scope.",
    "3. Coherent diff — the change set is coherent with the claimed completion.",
    "Answer STRICTLY as JSON: {\"verdict\": \"pass\"|\"fail\", \"confidence\": <0..1>, \"reasons\": [<string>]}.",
    "",
    "=== SPEC ===",
    spec,
    "",
    "=== OUTPUT ===",
    output,
    "",
    ...(diffText !== null ? ["=== DIFF (coherence) ===", diffText.slice(0, 8000), ""] : []),
  ].join("\n");
}

/** Parse ESTRITO da resposta (D6) — fora do schema → fail-closed. */
export function parseJudgeResponse(raw: string): { ok: true; response: JudgeResponse } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "esperado objeto JSON" };
  }
  const obj = parsed as { verdict?: unknown; confidence?: unknown; reasons?: unknown };
  if (obj.verdict !== "pass" && obj.verdict !== "fail") {
    return { ok: false, error: `verdict esperado pass|fail, encontrado ${String(obj.verdict)}` };
  }
  if (typeof obj.confidence !== "number" || Number.isNaN(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) {
    return { ok: false, error: `confidence esperado number 0..1, encontrado ${String(obj.confidence)}` };
  }
  if (!Array.isArray(obj.reasons) || !obj.reasons.every((r) => typeof r === "string")) {
    return { ok: false, error: "reasons esperado string[]" };
  }
  return { ok: true, response: { verdict: obj.verdict, confidence: obj.confidence, reasons: obj.reasons } };
}

export interface JudgeStageInput {
  /** prompt versionado (construído pelo engine — estimativa de tokens pré-call). */
  prompt: string;
  adapter?: JudgeAdapter;
  timeoutMs?: number;
}

/** Resultado do estágio de judge (verdict + confidence + replyTokens p/ o ledger). */
export interface JudgeStageOutcome {
  result: StageResult;
  confidence: number | null;
  /** tokens da RESPOSTA (o engine soma o prompt pré-call no CostLedger). */
  replyTokens: number;
}

/**
 * Executa o judge (D6). O caller (engine) já garantiu: gray + env ativo +
 * caps permitem a chamada. Inválida/timeout → fail-closed; o engine soma a
 * contabilidade (calls/tokens) no CostLedger.
 */
export async function judgeStage(input: JudgeStageInput): Promise<JudgeStageOutcome> {
  const timeoutMs = input.timeoutMs ?? JUDGE_TIMEOUT_MS;
  const prompt = input.prompt;
  const adapter = input.adapter;

  if (adapter === undefined) {
    return {
      result: {
        layer: "judge",
        status: "fail",
        reasonId: "verification-cascade",
        reason: judgeInvalidReason(),
        suggestion: "RUNECRAFT_VERIFY_LLM_JUDGE=1 mas nenhum adaptador de judge disponível — fail-closed (wiring do adaptador é o contrato)",
        detail: { error: "adapter-missing" },
      },
      confidence: null,
      replyTokens: 0,
    };
  }

  let reply: JudgeReply;
  try {
    reply = await adapter({ prompt, timeoutMs });
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!reply.ok) {
    return {
      result: {
        layer: "judge",
        status: "fail",
        reasonId: "verification-cascade",
        reason: judgeInvalidReason(),
        suggestion: `resposta inválida conta como falha (fail-closed) e é contabilizada no cap — detalhe: ${reply.error}`,
        detail: { error: reply.error },
      },
      confidence: null,
      replyTokens: 0,
    };
  }

  const parsed = parseJudgeResponse(reply.raw);
  const replyTokens = estimateTokens(reply.raw);
  if (!parsed.ok) {
    return {
      result: {
        layer: "judge",
        status: "fail",
        reasonId: "verification-cascade",
        reason: judgeInvalidReason(),
        suggestion: `resposta inválida conta como falha (fail-closed) e é contabilizada no cap — detalhe: ${parsed.error}`,
        detail: { error: parsed.error },
      },
      confidence: null,
      replyTokens,
    };
  }

  if (parsed.response.verdict === "pass") {
    return {
      result: {
        layer: "judge",
        status: "pass",
        reasonId: "verification-cascade",
        reason: `veredito do judge: pass (confidence ${parsed.response.confidence.toFixed(2)})`,
        suggestion: "",
        detail: { confidence: parsed.response.confidence, reasons: parsed.response.reasons },
      },
      confidence: parsed.response.confidence,
      replyTokens,
    };
  }

  return {
    result: {
      layer: "judge",
      status: "fail",
      reasonId: "verification-cascade",
      reason: judgeFailReason(parsed.response.reasons),
      suggestion: "revise os critérios de faithfulness apontados (o output cobre o escopo declarado, não inventa, diff coerente)",
      detail: { confidence: parsed.response.confidence, reasons: parsed.response.reasons },
    },
    confidence: parsed.response.confidence,
    replyTokens,
  };
}

/** Reason da zona cinza sem judge (QA-3 — política resolvida pelo engine). */
export { embeddingGrayNoJudgeReason };
