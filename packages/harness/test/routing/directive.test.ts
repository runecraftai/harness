// routing/directive.test.ts — unit do ROUTING DIRECTIVE (F33, T2; D1/D5).
//
// Cobre: render determinístico 2 runs; rota direct → null (sem bloco —
// fail-closed silencioso); conteúdo com rota/chain/alvos válidos do catalog
// F32; política QA-5 preservada (papel não-delegador não recebe instrução de
// delegação in-role; o builder recebe renderDelegationPrompt real); zero RPG.
import { describe, expect, test } from "bun:test";
import { renderRoutingDirective, ROUTING_MARKER, routeRole } from "../../src/routing/directive.ts";
import { classifyRoute } from "../../src/routing/classifier.ts";
import { roleList, RPG_DENY_LIST, ROLE_IDS } from "../../src/agents/catalog.ts";

const ROLES = roleList();

describe("renderRoutingDirective — determinismo e conteúdo (D1/D5)", () => {
  test("2 runs byte-idênticos (F21 D10)", () => {
    const decision = classifyRoute({ text: "implement the feature" });
    const a = renderRoutingDirective(decision, "implement.chain.md", ROLES);
    const b = renderRoutingDirective(decision, "implement.chain.md", ROLES);
    expect(a).toBe(b);
    expect(a!.length).toBe(b!.length);
    for (let i = 0; i < a!.length; i++) expect(a!.charCodeAt(i)).toBe(b!.charCodeAt(i));
  });

  test("rota direct → null (sem bloco — fail-closed silencioso)", () => {
    const decision = classifyRoute({ text: "hello world" });
    expect(decision.route).toBe("direct");
    expect(renderRoutingDirective(decision, null, ROLES)).toBeNull();
  });

  test("marker runecraft:routing presente + rota/chain/papel", () => {
    const decision = classifyRoute({ text: "implement the feature" });
    const directive = renderRoutingDirective(decision, "implement.chain.md", ROLES)!;
    expect(directive).toContain(ROUTING_MARKER);
    expect(directive).toContain("Route: implement");
    expect(directive).toContain("Pilot chain: implement.chain.md");
    expect(directive).toContain("Role: builder");
    expect(directive).toContain("[APPROVE]");
    expect(directive).toContain("[REJECT]");
  });

  test("lista os 7 papéis do catalog F32 (buildKeyTriggersSection — read-only)", () => {
    const decision = classifyRoute({ text: "implement the feature" });
    const directive = renderRoutingDirective(decision, "implement.chain.md", ROLES)!;
    for (const id of ROLE_IDS) expect(directive).toContain(`### ${id}`);
  });

  test("QA-5 preservada: papel não-delegador não recebe instrução de delegação in-role", () => {
    // planning → planner (sem tool subagent no allowlist) → renderDelegationPrompt null.
    const decision = classifyRoute({ text: "plan the feature and break down the work" });
    expect(decision.route).toBe("planning");
    const directive = renderRoutingDirective(decision, "plan.chain.md", ROLES)!;
    expect(directive).toContain("Role: planner");
    expect(directive).toContain("do not attempt to spawn agents yourself");
    // Só o builder recebe o bloco de delegação (renderDelegationPrompt).
    const builder = renderRoutingDirective(classifyRoute({ text: "implement the feature" }), "implement.chain.md", ROLES)!;
    expect(builder).toContain("## Delegation");
  });

  test("zero RPG (deny-list da casa — decisão 2)", () => {
    const decision = classifyRoute({ text: "implement the auth flow" });
    const directive = renderRoutingDirective(decision, "security.chain.md", ROLES)!;
    for (const term of [...RPG_DENY_LIST, "ultrawork"]) {
      expect(directive.toLowerCase(), `directive contém termo RPG "${term}"`).not.toContain(term);
    }
  });
});

describe("routeRole — rota → papel F32 (D2)", () => {
  test("mapeamento 1:1 das rotas delegáveis (catalog read-only)", () => {
    expect(routeRole("explore", ROLES)?.id).toBe("scout");
    expect(routeRole("research", ROLES)?.id).toBe("researcher");
    expect(routeRole("implement", ROLES)?.id).toBe("builder");
    expect(routeRole("review", ROLES)?.id).toBe("reviewer");
    expect(routeRole("security", ROLES)?.id).toBe("security");
    expect(routeRole("planning", ROLES)?.id).toBe("planner");
    expect(routeRole("direct", ROLES)).toBeNull();
  });
});
