// resilience/config.test.ts — config do F27 (T1, RES-09/D9).
//
// (a) schema v1 aditivo `resilience` válido/inválido (fail-closed por módulo —
//     F24 D10); (b) kill switch RUNECRAFT_RESILIENCE=0; (c) freeze por sessão
//     (D12); (d) defaults = valores do fork glla (atribuição verificada contra
//     packages/goal-loop-audit — goal-loop-backoff.ts / loops/goal.ts /
//     goal-loop-repetition.ts / goal-loop-core.ts).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_BACKOFF_HARD_CAP_MS,
  DEFAULT_COMPACTION_GRACE_MS,
  DEFAULT_HEARTBEAT_STALL_MS,
  DEFAULT_IDENTICAL_OUTPUT_SIMILARITY,
  DEFAULT_PENDING_LATCH_STUCK_MS,
  DEFAULT_REPETITION_THRESHOLD,
  DEFAULT_STALL_ESCALATION_REFIRES,
  DEFAULT_WEDGE_ALERT_MINUTES,
  SessionResilienceConfig,
  defaultResilienceConfig,
  resilienceKillSwitch,
  validateResilienceConfig,
} from "../../src/resilience/config.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resilience-config-"));
}

describe("resilience config — defaults do fork glla (atribuição D4)", () => {
  test("thresholds = constantes do fork (verificadas no source)", () => {
    const cfg = defaultResilienceConfig();
    expect(cfg.stall.heartbeatStallMs).toBe(DEFAULT_HEARTBEAT_STALL_MS); // HEARTBEAT_STALL_MS = 60s
    expect(DEFAULT_HEARTBEAT_STALL_MS).toBe(60_000);
    expect(cfg.stall.wedgeAlertMinutes).toBe(DEFAULT_WEDGE_ALERT_MINUTES); // WEDGE_ALERT_DEFAULT_MINUTES = 30
    expect(DEFAULT_WEDGE_ALERT_MINUTES).toBe(30);
    expect(cfg.stall.pendingLatchStuckMs).toBe(DEFAULT_PENDING_LATCH_STUCK_MS); // PENDING_LATCH_STUCK_MS = 3min
    expect(DEFAULT_PENDING_LATCH_STUCK_MS).toBe(3 * 60_000);
    expect(cfg.stall.postCompactionGraceMs).toBe(DEFAULT_COMPACTION_GRACE_MS); // COMPACTION_GRACE_MS = 3min
    expect(DEFAULT_COMPACTION_GRACE_MS).toBe(3 * 60_000);
    expect(cfg.stall.stallEscalationRefires).toBe(DEFAULT_STALL_ESCALATION_REFIRES); // DEFAULT_STALL_ESCALATION_REFIRES = 5
    expect(DEFAULT_STALL_ESCALATION_REFIRES).toBe(5);
    expect(cfg.stall.repetitionThreshold).toBe(DEFAULT_REPETITION_THRESHOLD); // REPETITION.toolResultRepeat = 3
    expect(DEFAULT_REPETITION_THRESHOLD).toBe(3);
    expect(cfg.stall.identicalOutputSimilarity).toBe(DEFAULT_IDENTICAL_OUTPUT_SIMILARITY); // REPETITION.similarityThreshold = 0.8
    expect(DEFAULT_IDENTICAL_OUTPUT_SIMILARITY).toBe(0.8);
    expect(cfg.backoff.hardCapMs).toBe(DEFAULT_BACKOFF_HARD_CAP_MS); // BACKOFF_HARD_CAP_MS = 5min
    expect(DEFAULT_BACKOFF_HARD_CAP_MS).toBe(5 * 60_000);
    expect(cfg.backoff.errorRetryLadderMs).toEqual([5_000, 15_000, 45_000, 90_000, 180_000]); // ERROR_RETRY_LADDER_MS
    // Política de escalação fail-closed: default stop-all (parar é o lado seguro).
    expect(cfg.escalation.policy).toBe("stop-all");
    expect(cfg.escalation.maxEscalations).toBe(3);
  });

  test("config ausente/undefined → defaults válidos (sem problemas)", () => {
    const v = validateResilienceConfig(undefined);
    expect(v.ok).toBe(true);
    expect(v.config).toEqual(defaultResilienceConfig());
  });

  test("config inválida → fail-closed por módulo: defaults seguros + problema nomeando o campo", () => {
    const v = validateResilienceConfig({ stall: { repetitionThreshold: 0 }, escalation: { policy: "nuke-everything" } });
    expect(v.ok).toBe(false);
    expect(v.config!.stall.repetitionThreshold).toBe(3); // campo inválido cai no default seguro
    expect(v.config!.escalation.policy).toBe("stop-all"); // política desconhecida → stop-all (fail-closed)
    expect(v.errors.some((e) => e.includes("repetitionThreshold"))).toBe(true);
    expect(v.errors.some((e) => e.includes("nuke-everything"))).toBe(true);
  });

  test("config inválida (tipo errado) → problems + defaults; sem crash", () => {
    const v = validateResilienceConfig({ enabled: "yes", backoff: { hardCapMs: -5 }, stall: "nope" });
    expect(v.ok).toBe(false);
    expect(v.config!.enabled).toBe(true);
    expect(v.config!.backoff.hardCapMs).toBe(300_000);
  });

  test("config válida com overrides → preserva os valores", () => {
    const v = validateResilienceConfig({ stall: { repetitionThreshold: 4, wedgeAlertMinutes: 15 }, escalation: { policy: "skip-and-continue", maxEscalations: 5 } });
    expect(v.ok).toBe(true);
    expect(v.config!.stall.repetitionThreshold).toBe(4);
    expect(v.config!.stall.wedgeAlertMinutes).toBe(15);
    expect(v.config!.escalation.policy).toBe("skip-and-continue");
    expect(v.config!.escalation.maxEscalations).toBe(5);
  });
});

describe("resilience config — kill switch (F20)", () => {
  test("RUNECRAFT_RESILIENCE=0|false|off → kill switch ativo", () => {
    for (const value of ["0", "false", "off", "OFF"]) {
      expect(resilienceKillSwitch({ RUNECRAFT_RESILIENCE: value }).active).toBe(true);
    }
  });
  test("ausente/vazio/outro valor → inativo", () => {
    expect(resilienceKillSwitch({}).active).toBe(false);
    expect(resilienceKillSwitch({ RUNECRAFT_RESILIENCE: "" }).active).toBe(false);
    expect(resilienceKillSwitch({ RUNECRAFT_RESILIENCE: "1" }).active).toBe(false);
  });
});

describe("resilience config — freeze por sessão (D12)", () => {
  test("config lida no capture e congelada; env override muda entre instâncias", () => {
    const base = makeTmp();
    try {
      const ws = path.join(base, "repo");
      fs.mkdirSync(path.join(ws, ".runecraft"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, ".runecraft", "state.json"),
        JSON.stringify({ schemaVersion: 1, scope: "workspace", components: {}, resilience: { escalation: { policy: "skip-and-continue" } } }),
      );

      const session = new SessionResilienceConfig(process.env);
      session.capture(ws);
      const frozen = session.frozen(ws);
      expect(frozen.config.escalation.policy).toBe("skip-and-continue");

      // Segunda chamada → mesmo snapshot (sem re-leitura).
      expect(session.frozen(ws).config.escalation.policy).toBe("skip-and-continue");

      // Kill switch do env é respeitado no snapshot.
      const killed = new SessionResilienceConfig({ RUNECRAFT_RESILIENCE: "0" });
      killed.capture(ws);
      expect(killed.frozen(ws).killSwitch).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("state.json corrompido → config tratada como ausente (fail-closed) + problem reportado", () => {
    const base = makeTmp();
    try {
      const ws = path.join(base, "repo");
      fs.mkdirSync(path.join(ws, ".runecraft"), { recursive: true });
      fs.writeFileSync(path.join(ws, ".runecraft", "state.json"), "{ not json");

      const session = new SessionResilienceConfig(process.env);
      session.capture(ws);
      const frozen = session.frozen(ws);
      expect(frozen.problems.some((p) => p.includes("corrompido"))).toBe(true);
      expect(frozen.config).toEqual(defaultResilienceConfig());
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
