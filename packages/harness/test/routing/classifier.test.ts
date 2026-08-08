// routing/classifier.test.ts — unit puro do classificador (F33, T1; D1/D3).
//
// Cobre (espelho dos EVAL-067..071 do framework): determinismo 2 runs
// byte-idêntico, fail-closed (sem sinal → direct), boundaries de threshold
// (score 1 → direct; score 2 → rota; 1 high → rota), security OBRIGATÓRIA
// (high-signal bypassa threshold — paladin "not optional") e prioridade
// determinística em empate. Zero I/O — inputs fixos (F21 D10).
import { describe, expect, test } from "bun:test";
import {
  classifyRoute,
  hasKeyword,
  sddPresent,
  ROUTE_THRESHOLD,
  HIGH_SIGNAL_WEIGHT,
  MEDIUM_SIGNAL_WEIGHT,
  SDD_PLANNING_BONUS,
  type RouteDecision,
} from "../../src/routing/classifier.ts";

describe("classifyRoute — determinismo (2 runs byte-idênticos — D3/F21 D10)", () => {
  test("mesmo input → decisão byte-idêntica (todas as chaves)", () => {
    const inputs = [
      { text: "implement the auth flow" },
      { text: "plan the feature and break down the work" },
      { text: "hello world" },
      { text: "review my changes and validate the diff" },
      { text: "locate where the token is validated" },
    ];
    for (const input of inputs) {
      const a = classifyRoute(input);
      const b = classifyRoute(input);
      expect(a).toEqual(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe("classifyRoute — fail-closed (D3: sem sinal → direct)", () => {
  test("input sem sinais de rota → direct (nenhuma rota inventada)", () => {
    const decision = classifyRoute({ text: "hello world, good morning" });
    expect(decision.route).toBe("direct");
    expect(decision.reason).toBe("fail-closed");
    expect(decision.score).toBe(0);
    for (const id of ["explore", "research", "review", "implement", "planning", "security"] as const) {
      expect(decision.scores[id]).toBe(0);
    }
  });

  test("input vazio/ilegível → direct (reason empty)", () => {
    expect(classifyRoute({ text: "" }).route).toBe("direct");
    expect(classifyRoute({ text: "   " }).route).toBe("direct");
    expect(classifyRoute({ text: "" }).reason).toBe("empty");
  });

  test("input nulo/undefined não quebra (fail-closed)", () => {
    const decision = classifyRoute({ text: undefined as unknown as string });
    expect(decision.route).toBe("direct");
  });
});

describe("classifyRoute — boundaries de threshold (D3: ROUTE_THRESHOLD = 2)", () => {
  test("1 keyword medium → score 1 → direct (abaixo do threshold)", () => {
    const decision = classifyRoute({ text: "modify the file" });
    expect(decision.scores.implement).toBe(MEDIUM_SIGNAL_WEIGHT);
    expect(decision.route).toBe("direct");
    expect(decision.reason).toBe("fail-closed");
  });

  test("2 keywords medium → score 2 → rota (implement)", () => {
    const decision = classifyRoute({ text: "modify and update the file" });
    expect(decision.scores.implement).toBe(2 * MEDIUM_SIGNAL_WEIGHT);
    expect(decision.route).toBe("implement");
    expect(decision.reason).toBe("threshold");
  });

  test("1 keyword high → score 2 → rota (1 high basta)", () => {
    const decision = classifyRoute({ text: "fix the bug" });
    expect(decision.scores.implement).toBe(HIGH_SIGNAL_WEIGHT);
    expect(decision.route).toBe("implement");
  });

  test("ROUTE_THRESHOLD constante explícita = 2", () => {
    expect(ROUTE_THRESHOLD).toBe(2);
  });

  test("threshold custom via config (state.routing.threshold.direct)", () => {
    // threshold 1: uma medium já roteia.
    const loose = classifyRoute({ text: "modify the file" }, { threshold: 1 });
    expect(loose.route).toBe("implement");
    // threshold 4: high+medium (3) fica abaixo → direct.
    const strict = classifyRoute({ text: "fix and modify the file" }, { threshold: 4 });
    expect(strict.scores.implement).toBe(HIGH_SIGNAL_WEIGHT + MEDIUM_SIGNAL_WEIGHT);
    expect(strict.route).toBe("direct");
  });
});

describe("classifyRoute — security OBRIGATÓRIA (D3: paladin 'not optional')", () => {
  test("keyword high de segurança + sinal de outra rota → security (bypassa threshold)", () => {
    const decision = classifyRoute({ text: "implement the auth flow" });
    expect(decision.scores.implement).toBeGreaterThan(0);
    expect(decision.route).toBe("security");
    expect(decision.reason).toBe("mandatory");
    expect(decision.mandatoryHits.length).toBeGreaterThan(0);
    expect(decision.mandatoryHits).toContain("auth");
  });

  test("qualquer high de segurança vence QUALQUER outra rota (mesmo score alto)", () => {
    const decision = classifyRoute({ text: "plan the roadmap, design the architecture, and implement the token validation" });
    expect(decision.scores.implement).toBeGreaterThanOrEqual(2);
    expect(decision.scores.planning).toBeGreaterThanOrEqual(4);
    expect(decision.route).toBe("security");
    expect(decision.reason).toBe("mandatory");
  });

  test("1 medium de segurança (score 1) → abaixo do threshold → direct (não é obrigatória sem high)", () => {
    const decision = classifyRoute({ text: "check the security posture" });
    expect(decision.scores.security).toBe(MEDIUM_SIGNAL_WEIGHT);
    expect(decision.route).toBe("direct");
  });

  test("security sem keyword → não é selecionada", () => {
    const decision = classifyRoute({ text: "hello world" });
    expect(decision.scores.security).toBe(0);
  });

  test("mandatory desabilitado via config → security vira rota normal (score ≥ threshold)", () => {
    const decision = classifyRoute(
      { text: "implement the auth flow" },
      { mandatoryOverrides: { security: false } },
    );
    expect(decision.reason).toBe("threshold");
    // implement (2) empata com security (2) → prioridade: security > implement,
    // mas com threshold normal ambas são candidatas e security ainda vence por
    // prioridade — o que muda é o reason (não-mandatory).
    expect(decision.route).toBe("security");
  });
});

describe("classifyRoute — prioridade determinística em empate (D3)", () => {
  test("empate implement/review → implement (prioridade maior)", () => {
    const decision = classifyRoute({ text: "review the code and fix the bug" });
    expect(decision.scores.implement).toBe(decision.scores.review);
    expect(decision.route).toBe("implement");
  });

  test("empate research/explore → research (prioridade maior)", () => {
    const decision = classifyRoute({ text: "research and explore the codebase" });
    // research: "research" high; explore: "explore" medium + "codebase" medium.
    // Ajustado para empate real: explore 1+1=2 vs research 2 → research vence por score.
    expect(decision.route).toBe("research");
  });

  test("ordem completa de prioridade em empate: security > planning > implement > review > research > explore", () => {
    // Constrói inputs com empate forçado de 2-2 entre pares adjacentes.
    // planning vs implement: "plan" high (2) + "implement" high (2).
    const pvsi = classifyRoute({ text: "plan and implement the feature" });
    expect(pvsi.scores.planning).toBe(pvsi.scores.implement);
    expect(pvsi.route).toBe("planning");
    // implement vs review: "review" high + "fix" high.
    const ivsr = classifyRoute({ text: "review the code and fix the bug" });
    expect(ivsr.scores.implement).toBe(ivsr.scores.review);
    expect(ivsr.route).toBe("implement");
    // review vs research: "review" high + "research" high.
    const rvsr = classifyRoute({ text: "review and research the topic" });
    expect(rvsr.scores.review).toBe(rvsr.scores.research);
    expect(rvsr.route).toBe("review");
    // research vs explore: "research" high + "trace" high.
    const rvse = classifyRoute({ text: "research and trace the flow" });
    expect(rvse.scores.research).toBe(rvse.scores.explore);
    expect(rvse.route).toBe("research");
  });
});

describe("classifyRoute — rotas habilitadas (config aditiva D6)", () => {
  test("rota desabilitada não é selecionável (fail-closed)", () => {
    const decision = classifyRoute(
      { text: "implement the feature" },
      { enabledRoutes: new Set(["explore", "research", "review", "planning", "security", "direct"] as const) },
    );
    // implement desabilitada → implement score nem entra nas candidatas.
    expect(decision.scores.implement).toBe(0);
    expect(decision.route).toBe("direct");
  });

  test("security desabilitada → implement pode vencer", () => {
    const decision = classifyRoute(
      { text: "implement the auth flow" },
      { enabledRoutes: new Set(["explore", "research", "review", "implement", "planning", "direct"] as const) },
    );
    expect(decision.route).toBe("implement");
  });
});

describe("classifyRoute — feature SDD (D3: .specs/<...>/spec.md → +2 planning)", () => {
  test("specPath presente → planning recebe o bônus SDD", () => {
    const decision = classifyRoute({ text: "implement the feature", specPath: "/repo/.specs/features/f1/spec.md" });
    expect(decision.scores.planning).toBe(SDD_PLANNING_BONUS);
    // planning 2 (SDD) empata com implement 2 → prioridade planning > implement.
    expect(decision.route).toBe("planning");
  });

  test("menção de .specs/ no texto também conta (mencionada/relacionada)", () => {
    const decision = classifyRoute({ text: "implement the feature per .specs/features/f1/" });
    expect(sddPresent({ text: "implement the feature per .specs/features/f1/" })).toBe(true);
    expect(decision.scores.planning).toBe(SDD_PLANNING_BONUS);
  });

  test("sem spec → sem bônus", () => {
    const decision = classifyRoute({ text: "implement the feature" });
    expect(decision.scores.planning).toBe(0);
  });
});

describe("hasKeyword — token-boundary e frases (D3)", () => {
  test("palavra única exige token-boundary (plan ≠ planning/explain/plant)", () => {
    expect(hasKeyword("plan the feature", "plan")).toBe(true);
    expect(hasKeyword("planning the feature", "plan")).toBe(false);
    expect(hasKeyword("explain this", "plan")).toBe(false);
    expect(hasKeyword("plant a tree", "plan")).toBe(false);
  });

  test("fix ≠ fixture/prefix/suffix", () => {
    expect(hasKeyword("fix the bug", "fix")).toBe(true);
    expect(hasKeyword("run the fixture", "fix")).toBe(false);
    expect(hasKeyword("prefix the name", "fix")).toBe(false);
  });

  test("frase casa por substring literal (case-insensitive)", () => {
    expect(hasKeyword("Check My Work now", "check my work")).toBe(true);
    expect(hasKeyword("input validation is missing", "input validation")).toBe(true);
  });

  test(".env (frase — não alfanumérica) casa por substring", () => {
    expect(hasKeyword("read the .env file", ".env")).toBe(true);
  });
});
