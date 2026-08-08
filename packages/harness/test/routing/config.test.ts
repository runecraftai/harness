// routing/config.test.ts — unit da config `routing` (F33, T3; D6).
//
// Cobre: defaults fail-closed no código, kill switch RUNECRAFT_ROUTING=0,
// validação determinística (campos inválidos → defaults + problems), merge
// workspace > global > default, freeze por sessão (F24 D12), rotas
// habilitadas/mandatory efetivos (config aditiva).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  defaultRoutingConfig,
  validateRoutingConfig,
  routingKillSwitch,
  effectiveRouting,
  loadSessionRouting,
  SessionRoutingConfig,
  enabledRoutes,
  mandatoryOf,
} from "../../src/routing/config.ts";
import { ROUTE_THRESHOLD } from "../../src/routing/classifier.ts";
import { ROUTE_IDS } from "../../src/routing/routes.ts";

function tmpState(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "routing-config-"));
}

describe("defaultRoutingConfig — defaults no código (D6)", () => {
  test("enabled true, threshold 2, rotas vazias (defaults do catálogo)", () => {
    const cfg = defaultRoutingConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold.direct).toBe(ROUTE_THRESHOLD);
    expect(cfg.routes).toEqual({});
  });

  test("enabledRoutes default = todas as rotas delegáveis", () => {
    const enabled = enabledRoutes(defaultRoutingConfig());
    for (const id of ["explore", "research", "review", "implement", "planning", "security"] as const) {
      expect(enabled.has(id)).toBe(true);
    }
    expect(enabled.has("direct")).toBe(false);
  });

  test("mandatoryOf default: só security é mandatory", () => {
    expect(mandatoryOf(defaultRoutingConfig(), "security")).toBe(true);
    for (const id of ["explore", "research", "review", "implement", "planning"] as const) {
      expect(mandatoryOf(defaultRoutingConfig(), id)).toBe(false);
    }
  });
});

describe("validateRoutingConfig — fail-closed por módulo (D10)", () => {
  test("ausente/null → defaults", () => {
    expect(validateRoutingConfig(undefined).ok).toBe(true);
    expect(validateRoutingConfig(null).config).toEqual(defaultRoutingConfig());
  });

  test("não-objeto → erro", () => {
    const validation = validateRoutingConfig("x");
    expect(validation.ok).toBe(false);
    expect(validation.errors[0]).toContain("routing: esperado objeto");
  });

  test("campos inválidos → defaults + problems (fail-closed)", () => {
    const validation = validateRoutingConfig({
      enabled: "yes",
      threshold: { direct: 0 },
      routes: { security: { enabled: "yes" }, unknown: { enabled: true }, direct: { enabled: true } },
    });
    expect(validation.ok).toBe(false);
    const errors = validation.errors!.join("; ");
    expect(errors).toContain("routing.enabled: esperado boolean");
    expect(errors).toContain("routing.threshold.direct");
    expect(errors).toContain("routing.routes.security.enabled: esperado boolean");
    expect(errors).toContain("routing.routes.unknown: rota desconhecida");
    expect(errors).toContain("routing.routes.direct: rota direct é o fail-closed");
    // Fail-closed: a config efetiva continua com defaults seguros.
    expect(validation.config!.enabled).toBe(true);
    expect(validation.config!.threshold.direct).toBe(ROUTE_THRESHOLD);
  });

  test("config válida → overrides aplicados (aditivo)", () => {
    const validation = validateRoutingConfig({
      enabled: false,
      threshold: { direct: 3 },
      routes: { planning: { enabled: false }, security: { mandatory: false } },
    });
    expect(validation.ok).toBe(true);
    expect(validation.config!.enabled).toBe(false);
    expect(validation.config!.threshold.direct).toBe(3);
    expect(validation.config!.routes.planning).toEqual({ enabled: false });
    expect(validation.config!.routes.security).toEqual({ mandatory: false });
  });
});

describe("routingKillSwitch — RUNECRAFT_ROUTING (F20)", () => {
  test("0|false|off (case-insensitive) → ativo", () => {
    for (const value of ["0", "false", "off", "FALSE", "OFF"]) {
      expect(routingKillSwitch({ RUNECRAFT_ROUTING: value }).active).toBe(true);
    }
  });
  test("ausente/vazio/outro valor → inativo", () => {
    expect(routingKillSwitch({}).active).toBe(false);
    expect(routingKillSwitch({ RUNECRAFT_ROUTING: "" }).active).toBe(false);
    expect(routingKillSwitch({ RUNECRAFT_ROUTING: "1" }).active).toBe(false);
    expect(routingKillSwitch({ RUNECRAFT_ROUTING: "on" }).active).toBe(false);
  });
});

describe("effectiveRouting + freeze por sessão (D6/D12)", () => {
  test("workspace > global > default; kill switch propaga", () => {
    const merged = effectiveRouting(
      { threshold: { direct: 4 } },
      { enabled: false },
      { RUNECRAFT_ROUTING: "0" },
    );
    expect(merged.killSwitch).toBe(true);
    expect(merged.killSwitchValue).toBe("0");
    expect(merged.source).toBe("workspace");
    expect(merged.config.threshold.direct).toBe(4);
    expect(merged.problems).toEqual([]);
  });

  test("config inválida no state → defaults + problems reportados", () => {
    const merged = effectiveRouting({ enabled: 42 }, undefined, {});
    expect(merged.source).toBe("workspace");
    expect(merged.config.enabled).toBe(true);
    expect(merged.problems.length).toBeGreaterThan(0);
  });

  test("SessionRoutingConfig congela o snapshot (2ª chamada não recarrega)", () => {
    const base = tmpState();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      const session = new SessionRoutingConfig(process.env);
      session.capture(repo);
      const frozen = session.frozen(repo);
      expect(frozen.config.threshold.direct).toBe(ROUTE_THRESHOLD);
      expect(session.frozen(repo)).toBe(frozen); // mesmo snapshot (mesma referência)
      expect(loadSessionRouting(repo, process.env).source).toBe("default");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("state.routing do workspace é lido (F13 — config aditiva)", () => {
    const base = tmpState();
    try {
      const repo = path.join(base, "repo");
      fs.mkdirSync(repo, { recursive: true });
      // state do workspace com a seção routing.
      const stateDir = path.join(repo, ".runecraft");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, "state.json"),
        JSON.stringify({
          schemaVersion: 1,
          scope: "workspace",
          components: {},
          routing: { enabled: true, threshold: { direct: 5 }, routes: { security: { mandatory: false } } },
        }),
        "utf8",
      );
      const loaded = loadSessionRouting(repo, process.env);
      expect(loaded.source).toBe("workspace");
      expect(loaded.config.threshold.direct).toBe(5);
      expect(loaded.config.routes.security).toEqual({ mandatory: false });
      expect(ROUTE_IDS).toContain("direct");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
