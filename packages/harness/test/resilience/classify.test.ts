// resilience/classify.test.ts — classificação agente-vs-infra (T6, RES-05/D5).
//
// Unit PURO: 429/Retry-After → infra + sugestão; timeout/exit de infra →
// infra; stall/repetição → agent; caso ambíguo → unknown + HALT (fail-
// closed). Reuso da semântica do fork glla (isQuotaError/parseQuotaError) e
// do formato de sugestão do F25 (suggestions.ts). ZERO LLM (F27 determinístico).
import { describe, expect, test } from "bun:test";
import {
  RESILIENCE_REASON_ID,
  classifyFailure,
  isInfraExitCode,
  isQuotaError,
  parseQuotaError,
} from "../../src/resilience/classify.ts";
import type { StallSignal } from "../../src/resilience/types.ts";

function stall(type: StallSignal["type"]): StallSignal {
  return { type, reason: `stall:${type}`, at: 0 };
}

describe("isQuotaError / parseQuotaError (port da semântica do fork glla)", () => {
  test("429/quota/rate-limit/credits/too many requests → quota error", () => {
    for (const e of [
      "Error 429: Too Many Requests",
      "quota exceeded for model",
      "rate limit reached",
      "insufficient balance",
      "key limit exceeded",
      "you do not have enough credits",
    ]) {
      expect(isQuotaError(e)).toBe(true);
    }
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError("permission denied")).toBe(false);
  });

  test("parseQuotaError: Retry-After header / prosa / default 3600s", () => {
    expect(parseQuotaError("Retry-After: 5")).toEqual({ retryAfterSec: 5, fromUpstream: true });
    expect(parseQuotaError("retry after 30 seconds")).toEqual({ retryAfterSec: 30, fromUpstream: true });
    expect(parseQuotaError("retry in 2m")).toEqual({ retryAfterSec: 120, fromUpstream: true });
    expect(parseQuotaError("some other error").fromUpstream).toBe(false);
    expect(parseQuotaError("some other error").retryAfterSec).toBe(3600);
    expect(parseQuotaError("x", 120).retryAfterSec).toBe(120);
  });
});

describe("classifyFailure — infra (AC4)", () => {
  test("429 com Retry-After → infra + sugestão de retry/backoff", () => {
    const c = classifyFailure({ error: "HTTP 429 Retry-After: 30" });
    expect(c.class).toBe("infra");
    expect(c.suggestion).toContain("retry");
    expect(c.reason.startsWith(`${RESILIENCE_REASON_ID}: classify — `)).toBe(true);
    expect(c.reason).toContain("Retry-After: 30");
  });

  test("quota → infra", () => {
    expect(classifyFailure({ error: "quota exceeded" }).class).toBe("infra");
  });

  test("timeout → infra", () => {
    expect(classifyFailure({ timedOut: true }).class).toBe("infra");
  });

  test("exit code de infra (124/137/143 — padrão AD-024 SIGTERM/SIGKILL) → infra", () => {
    expect(classifyFailure({ exitCode: 137 }).class).toBe("infra");
    expect(classifyFailure({ exitCode: 143 }).class).toBe("infra");
    expect(classifyFailure({ exitCode: 124 }).class).toBe("infra");
  });

  test("isInfraExitCode: 124/137/143 apenas", () => {
    expect(isInfraExitCode(124)).toBe(true);
    expect(isInfraExitCode(137)).toBe(true);
    expect(isInfraExitCode(143)).toBe(true);
    expect(isInfraExitCode(1)).toBe(false);
    expect(isInfraExitCode(2)).toBe(false);
  });
});

describe("classifyFailure — agent (AC4)", () => {
  test("sinais de stall → agent + sugestão re-inject/pause", () => {
    const c = classifyFailure({ stallSignals: [stall("repetition"), stall("heartbeat")] });
    expect(c.class).toBe("agent");
    expect(c.reason).toContain("stall");
    expect(c.suggestion).toContain("re-inject");
  });

  test("falha repetida (≥ 3) → agent", () => {
    expect(classifyFailure({ repeatedFailures: 3 }).class).toBe("agent");
    expect(classifyFailure({ repeatedFailures: 2 }).class).toBe("unknown"); // abaixo do limiar → sem evidência
  });

  test("exit ≠ 0 sem sinal de infra → agent (comando falhou)", () => {
    const c = classifyFailure({ exitCode: 1 });
    expect(c.class).toBe("agent");
    expect(c.suggestion).toContain("corrija");
  });
});

describe("classifyFailure — unknown (fail-closed HALT — AC4/D5)", () => {
  test("sem evidência → unknown + HALT fail-closed", () => {
    const c = classifyFailure({});
    expect(c.class).toBe("unknown");
    expect(c.suggestion).toContain("HALT");
  });

  test("determinismo: 2 runs → mesma classificação", () => {
    expect(classifyFailure({ error: "429 too many requests" })).toEqual(classifyFailure({ error: "429 too many requests" }));
  });
});
