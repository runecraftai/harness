// observability/config.test.ts — config do F28 (T1, D9, OBS-11).
//
// Schema v1 aditivo `observability` no state (F13): defaults (0.8/0.95,
// promotion 3 / high 2 / maxAdendo 3), validação fail-closed por módulo
// (F24 D10), kill switch RUNECRAFT_OBSERVABILITY=0|false|off (F20) e
// freeze por sessão (padrão F24 D12/F27).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SessionObservabilityConfig,
  defaultObservabilityConfig,
  effectiveObservability,
  loadSessionObservability,
  observabilityKillSwitch,
  validateObservabilityConfig,
} from "../../src/observability/config.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "obs-config-"));
}

describe("config — defaults e validação (D9)", () => {
  test("defaults calibrados (0.8/0.95; 3/2/3)", () => {
    const cfg = defaultObservabilityConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.contextWindow).toEqual({ warningPct: 0.8, criticalPct: 0.95 });
    expect(cfg.lessons).toEqual({ promotionThreshold: 3, highPriorityThreshold: 2, maxAdendoLessons: 3 });
  });

  test("validação: inválida → fail-closed com defaults seguros + problema reportado", () => {
    const invalid = validateObservabilityConfig({ contextWindow: { warningPct: 0.99, criticalPct: 0.5 } });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.some((e) => e.includes("warningPct"))).toBe(true);
    expect(invalid.config!.contextWindow).toEqual(defaultObservabilityConfig().contextWindow);

    const badType = validateObservabilityConfig({ lessons: { promotionThreshold: "x" } });
    expect(badType.ok).toBe(false);
    expect(badType.config!.lessons.promotionThreshold).toBe(3); // default seguro

    expect(validateObservabilityConfig(undefined).ok).toBe(true);
    expect(validateObservabilityConfig({ enabled: false }).config!.enabled).toBe(false);
  });

  test("kill switch: 0|false|off (case-insensitive) — convenção F20", () => {
    expect(observabilityKillSwitch({ RUNECRAFT_OBSERVABILITY: "0" }).active).toBe(true);
    expect(observabilityKillSwitch({ RUNECRAFT_OBSERVABILITY: "false" }).active).toBe(true);
    expect(observabilityKillSwitch({ RUNECRAFT_OBSERVABILITY: "OFF" }).active).toBe(true);
    expect(observabilityKillSwitch({ RUNECRAFT_OBSERVABILITY: "1" }).active).toBe(false);
    expect(observabilityKillSwitch({}).active).toBe(false);
  });

  test("effectiveObservability: workspace > global > default; kill switch", () => {
    const ws = { enabled: true, contextWindow: { warningPct: 0.7, criticalPct: 0.9 } };
    const gl = { enabled: false };
    const eff = effectiveObservability(ws, gl, {});
    expect(eff.source).toBe("workspace");
    expect(eff.config.contextWindow.warningPct).toBe(0.7);
    expect(eff.config.enabled).toBe(true);

    const kill = effectiveObservability(undefined, undefined, { RUNECRAFT_OBSERVABILITY: "0" });
    expect(kill.killSwitch).toBe(true);
  });

  test("loadSessionObservability lê o state do workspace; freeze por sessão", () => {
    const dir = makeTmp();
    try {
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".runecraft", "state.json"),
        JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, observability: { lessons: { promotionThreshold: 5 } } }),
      );
      const session = loadSessionObservability(dir, { ...process.env, RUNECRAFT_HOME: path.join(dir, "home") });
      expect(session.config.lessons.promotionThreshold).toBe(5);
      expect(session.source).toBe("workspace");

      const frozen = new SessionObservabilityConfig({ ...process.env, RUNECRAFT_HOME: path.join(dir, "home") });
      frozen.capture(dir);
      // Config muda no meio da sessão → snapshot NÃO muda (freeze — D9).
      fs.writeFileSync(
        path.join(dir, ".runecraft", "state.json"),
        JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, observability: { lessons: { promotionThreshold: 9 } } }),
      );
      expect(frozen.frozen(dir).config.lessons.promotionThreshold).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
