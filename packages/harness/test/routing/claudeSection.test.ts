// routing/claudeSection.test.ts — B1: coded-routing directive como seção de
// CLAUDE.md (motor F18). Render PURO determinístico (F21 D10) a partir do
// MESMO catálogo do F33 (ROUTE_CATALOG) + papéis do F32.
//
// Contrato de teste (F3 — option a): o directive é um artefato gerado e
// injetado (interface intencional entregue ao agente) — o contrato é o
// GOLDEN byte-locked (test/golden/section-routing-claude.golden) + o
// determinismo do render (2 runs byte-idênticos) + as constantes de
// contrato (id da seção, versão do template, threshold do catálogo). Nada
// de grep de substring do corpo — texto natural não prova comportamento.
import { describe, expect, test } from "bun:test";
import { renderClaudeRoutingSection, ROUTING_SECTION, CLAUDE_ROUTING_SECTION_VERSION } from "../../src/routing/claudeSection.ts";
import { ROUTE_THRESHOLD } from "../../src/routing/classifier.ts";
import { renderSectionClaudeRouting, readGolden } from "../eval/goldens.ts";

describe("renderClaudeRoutingSection — directive codificada (B1)", () => {
  test("determinismo: 2 runs byte-idênticos (F21 D10)", () => {
    const a = renderClaudeRoutingSection();
    const b = renderClaudeRoutingSection();
    expect(a).toBe(b);
    for (let i = 0; i < a.length; i++) {
      expect(a.charCodeAt(i)).toBe(b.charCodeAt(i));
    }
  });

  test("contrato do artefato injetado: a seção completa == golden byte-locked", () => {
    // O directive É o que o adapter do claude injeta no CLAUDE.md (motor F18);
    // o golden é o contrato de bytes versionado (mesmo padrão dos goldens do
    // workflow F19/F23 — drift de conteúdo = diff revisável no teste).
    expect(renderSectionClaudeRouting()).toBe(readGolden("section-routing-claude.golden"));
  });

  test("constantes de contrato estáveis (id da seção, versão do template, threshold)", () => {
    expect(ROUTING_SECTION).toBe("runecraft:routing");
    expect(CLAUDE_ROUTING_SECTION_VERSION).toBe("1");
    // O threshold é a MESMA constante do classificador do F33 (fonte única).
    expect(ROUTE_THRESHOLD).toBe(2);
  });
});
