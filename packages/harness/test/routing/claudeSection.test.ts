// routing/claudeSection.test.ts — B1: coded-routing directive como seção de
// CLAUDE.md (motor F18). Render PURO determinístico (F21 D10) a partir do
// MESMO catálogo do F33 (ROUTE_CATALOG) + papéis do F32: rotas × papéis ×
// keywords × threshold, segurança OBRIGATÓRIA, fail-closed direct, delegação
// via a tool nativa Agent (Task tool) — só o builder delegador.
import { describe, expect, test } from "bun:test";
import { renderClaudeRoutingSection, ROUTING_SECTION, CLAUDE_ROUTING_SECTION_VERSION, claudeRouteRole } from "../../src/routing/claudeSection.ts";
import { ROUTE_CATALOG, DELEGATABLE_ROUTE_IDS } from "../../src/routing/routes.ts";
import { ROUTE_THRESHOLD } from "../../src/routing/classifier.ts";
import { roleList, ROLE_IDS } from "../../src/agents/catalog.ts";
import { CLAUDE_DELEGATION_TOOL } from "../../src/adapters/claudeAgents.ts";

describe("renderClaudeRoutingSection — directive codificada (B1)", () => {
  const rendered = renderClaudeRoutingSection();

  test("determinismo: 2 runs byte-idênticos (F21 D10)", () => {
    expect(rendered).toBe(renderClaudeRoutingSection());
    for (let i = 0; i < rendered.length; i++) {
      expect(rendered.charCodeAt(i)).toBe(renderClaudeRoutingSection().charCodeAt(i));
    }
  });

  test("threshold explícito + fail-closed (abaixo → direct)", () => {
    expect(rendered).toContain(`threshold ${ROUTE_THRESHOLD}`);
    expect(rendered).toContain("below threshold or no signal → direct");
  });

  test("tabela de rotas: TODAS as rotas delegáveis do catálogo com o papel alvo", () => {
    const roles = roleList();
    for (const route of DELEGATABLE_ROUTE_IDS) {
      const definition = ROUTE_CATALOG[route];
      const role = claudeRouteRole(route, roles);
      expect(rendered).toContain(`| ${route} | ${role?.id ?? "—"} |`);
      // keywords high do catálogo presentes no directive (o agente aplica os
      // mesmos sinais do classificador do F33).
      for (const keyword of definition.keywords.high.slice(0, 2)) {
        expect(rendered).toContain(`\`${keyword}\``);
      }
    }
  });

  test("segurança OBRIGATÓRIA (paladin — NOT optional)", () => {
    expect(rendered).toContain("Security is MANDATORY");
    expect(rendered).toContain("NOT optional");
    expect(rendered).toContain("`auth`");
    expect(rendered).toContain("`crypto`");
    expect(rendered).toContain("`.env`");
  });

  test("delegação via a tool nativa (Task tool / Agent) — só o builder", () => {
    expect(rendered).toContain(CLAUDE_DELEGATION_TOOL);
    expect(rendered).toContain("the Task tool");
    expect(rendered).toContain("Only the `builder` role has the");
    expect(rendered).toContain("never spawn other agents");
  });

  test("lista os 7 papéis do F32 (alvos válidos da delegação)", () => {
    for (const role of ROLE_IDS) {
      expect(rendered).toContain(`**${role}**`);
    }
  });

  test("id da seção estável + versão de template", () => {
    expect(ROUTING_SECTION).toBe("runecraft:routing");
    expect(CLAUDE_ROUTING_SECTION_VERSION).toBe("1");
  });
});
