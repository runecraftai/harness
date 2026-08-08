// verify/config.test.ts — T1 (D9/VER-12): validação fail-closed, defaults,
// kill switch, freeze por sessão, merge workspace > global e o schema aditivo
// do state (F13 — schemaVersion 1 preserva `guards` do F24).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SessionVerifyConfig,
  defaultVerificationConfig,
  effectiveVerification,
  loadSessionVerification,
  validateVerificationConfig,
  verifyKillSwitch,
} from "../../src/verify/config.ts";
import { defaultGuardsConfig } from "../../src/guards/guardKit.ts";
import { emptyState } from "../../src/state.ts";
import { makeSandbox, runHarness, writeSettings, stateFile } from "../helpers.ts";

describe("validateVerificationConfig — determinística e fail-closed (D9)", () => {
  test("ausente → defaults (cascade ligada, QA-1/Q-3 recomendados)", () => {
    const v = validateVerificationConfig(undefined);
    expect(v.ok).toBe(true);
    const cfg = v.config!;
    expect(cfg.enabled).toBe(true);
    expect(cfg.thresholds.embedding.min).toBeLessThan(cfg.thresholds.embedding.max);
    expect(cfg.thresholds.sufficiency.minRatio).toBeLessThan(cfg.thresholds.sufficiency.maxRatio);
    // QA-1: integrity/sufficiency = halt; structural/embedding/judge = skip.
    expect(cfg.policy.onFail.integrity).toBe("halt");
    expect(cfg.policy.onFail.sufficiency).toBe("halt");
    expect(cfg.policy.onFail.structural).toBe("skip");
    expect(cfg.policy.onFail.embedding).toBe("skip");
    expect(cfg.policy.onFail.judge).toBe("skip");
    // QA-3: embeddingUnavailable skip; grayZoneNoJudge fail (fail-closed).
    expect(cfg.degrade.embeddingUnavailable).toBe("skip");
    expect(cfg.degrade.grayZoneNoJudge).toBe("fail");
  });

  test("min >= max rejeitado com motivo (edge da spec — exit 3 no CLI)", () => {
    const v = validateVerificationConfig({ thresholds: { embedding: { min: 0.8, max: 0.2 } } });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("embedding") && e.includes("deve ser < max"))).toBe(true);
  });

  test("limiares negativos / não-numéricos rejeitados", () => {
    expect(validateVerificationConfig({ thresholds: { embedding: { min: -0.1, max: 0.9 } } }).ok).toBe(false);
    expect(validateVerificationConfig({ thresholds: { embedding: { min: "0.3", max: 0.9 } } }).ok).toBe(false);
    expect(validateVerificationConfig({ thresholds: { sufficiency: { minRatio: 0.5, maxRatio: 0.4 } } }).ok).toBe(false);
  });

  test("política desconhecida / layer desconhecida rejeitadas", () => {
    const unknownPolicy = validateVerificationConfig({ policy: { onFail: { structural: "nuke" } } });
    expect(unknownPolicy.ok).toBe(false);
    expect(unknownPolicy.errors.some((e) => e.includes("política desconhecida"))).toBe(true);
    const unknownLayer = validateVerificationConfig({ policy: { onFail: { security: "halt" } } });
    expect(unknownLayer.ok).toBe(false);
    expect(unknownLayer.errors.some((e) => e.includes("layer desconhecida"))).toBe(true);
  });

  test("costCaps inválidos rejeitados (não-inteiro / negativo)", () => {
    expect(validateVerificationConfig({ costCaps: { maxCascadeRuns: 1.5 } }).ok).toBe(false);
    expect(validateVerificationConfig({ costCaps: { maxJudgeCalls: -1 } }).ok).toBe(false);
  });

  test("campos desconhecidos são tolerados (additivo — F13)", () => {
    const v = validateVerificationConfig({ enabled: false, futureField: { x: 1 } });
    expect(v.ok).toBe(true);
    expect(v.config!.enabled).toBe(false);
  });

  test("config válida → valores aplicados (overlay por campo)", () => {
    const v = validateVerificationConfig({
      thresholds: { embedding: { min: 0.2, max: 0.9 }, sufficiency: { scopePaths: ["src"] } },
      costCaps: { maxJudgeCalls: 5 },
      degrade: { grayZoneNoJudge: "halt" },
    });
    expect(v.ok).toBe(true);
    const cfg = v.config!;
    expect(cfg.thresholds.embedding.min).toBe(0.2);
    expect(cfg.thresholds.embedding.max).toBe(0.9);
    expect(cfg.thresholds.sufficiency.scopePaths).toEqual(["src"]);
    expect(cfg.costCaps.maxJudgeCalls).toBe(5);
    expect(cfg.degrade.grayZoneNoJudge).toBe("halt");
    // campos não tocados permanecem defaults
    expect(cfg.thresholds.sufficiency.minRatio).toBe(0.03);
  });
});

describe("kill switch e merge (F20/D12/D9)", () => {
  test("RUNECRAFT_VERIFY=0|false|off desliga a cascata (sessão e CLI)", () => {
    expect(verifyKillSwitch({ RUNECRAFT_VERIFY: "0" }).active).toBe(true);
    expect(verifyKillSwitch({ RUNECRAFT_VERIFY: "OFF" }).active).toBe(true);
    expect(verifyKillSwitch({ RUNECRAFT_VERIFY: "1" }).active).toBe(false);
    expect(verifyKillSwitch({}).active).toBe(false);
  });

  test("merge workspace > global > default (F14 overlay)", () => {
    const merged = effectiveVerification(
      { enabled: false, thresholds: { embedding: { min: 0.1, max: 0.9 } } },
      { enabled: true },
      {},
    );
    expect(merged.source).toBe("workspace");
    expect(merged.config!.enabled).toBe(false); // workspace vence o global
    expect(merged.config!.thresholds.embedding.min).toBe(0.1);
    expect(merged.problems).toEqual([]);
  });

  test("config inválida no workspace → fail-closed (config undefined + problems)", () => {
    const merged = effectiveVerification({ thresholds: { embedding: { min: 0.9, max: 0.1 } } }, undefined, {});
    expect(merged.config).toBeUndefined();
    expect(merged.problems.length).toBeGreaterThan(0);
  });

  test("congelamento por sessão (D12): config do session_start vale durante a sessão", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-freeze-"));
    try {
      const stateDir = path.join(dir, ".runecraft");
      fs.mkdirSync(stateDir, { recursive: true });
      const file = path.join(stateDir, "state.json");
      const writeConfig = (verification: unknown): void => {
        fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, verification }, null, 2));
      };

      writeConfig({ thresholds: { embedding: { min: 0.1, max: 0.9 } } });
      const session = new SessionVerifyConfig({});
      session.capture(dir);
      expect(session.frozen(dir).config!.thresholds.embedding.min).toBe(0.1);

      // Mudança de config NO MEIO da sessão → ignorada (sem drift mid-turn).
      writeConfig({ thresholds: { embedding: { min: 0.2, max: 0.8 } } });
      expect(session.frozen(dir).config!.thresholds.embedding.min).toBe(0.1);

      // Novo session_start → recaptura.
      session.capture(dir);
      expect(session.frozen(dir).config!.thresholds.embedding.min).toBe(0.2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("state schema aditivo (F13/VER-12)", () => {
  test("emptyState declara verification (fail-closed) ao lado de guards", () => {
    const state = emptyState("global");
    expect(state.guards).toEqual(defaultGuardsConfig());
    expect(state.verification).toEqual(defaultVerificationConfig());
    expect(state.schemaVersion).toBe(1);
  });

  test("loadSessionVerification: sem state → defaults; com state corrompido → fail-closed com problema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-load-"));
    try {
      const loaded = loadSessionVerification(dir, {});
      expect(loaded.config).toBeDefined();
      expect(loaded.killSwitch).toBe(false);

      const stateDir = path.join(dir, ".runecraft");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "state.json"), "{ corrupt", "utf8");
      const corrupt = loadSessionVerification(dir, {});
      expect(corrupt.config).toBeDefined(); // defaults
      expect(corrupt.problems.some((p) => p.includes("corrompido"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctor check 19 + status seção verification (T1, VER-12)", () => {
  test("doctor check 19: defaults → pass informativo (thresholds + judge env off)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[19] Verification");
      expect(result.stdout).toContain("cascade enabled");
      expect(result.stdout).toContain("embedding min 0.35/max 0.75");
      expect(result.stdout).toContain("judge LLM off");
      expect(result.stdout).toContain("kill switch RUNECRAFT_VERIFY off");
    } finally {
      sb.cleanup();
    }
  });

  test("doctor check 19: config inválida → fail apontando os campos (fail-closed)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      fs.mkdirSync(path.dirname(stateFile(sb)), { recursive: true });
      fs.writeFileSync(
        stateFile(sb),
        JSON.stringify({ schemaVersion: 1, scope: "global", components: {}, verification: { thresholds: { embedding: { min: 0.9, max: 0.1 } } } }, null, 2),
      );
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[19] Verification");
      expect(result.stdout).toContain("config de verificação inválida");
      expect(result.stdout).toContain("deve ser < max");
    } finally {
      sb.cleanup();
    }
  });

  test("status --json inclui a seção verification (estado + thresholds + kill switch + judge)", async () => {
    const sb = makeSandbox();
    try {
      writeSettings(sb, []);
      const result = await runHarness(sb, ["status", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        verification: {
          killSwitch: boolean;
          judgeEnabled: boolean;
          enabled: boolean;
          valid: boolean;
          source: string;
          thresholds: { embedding: { min: number; max: number } };
        };
      };
      expect(json.verification.enabled).toBe(true);
      expect(json.verification.valid).toBe(true);
      expect(json.verification.killSwitch).toBe(false);
      expect(json.verification.judgeEnabled).toBe(false);
      expect(json.verification.thresholds.embedding.min).toBe(0.35);
    } finally {
      sb.cleanup();
    }
  });
});
