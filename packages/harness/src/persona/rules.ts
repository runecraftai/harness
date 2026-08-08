// persona/rules.ts — injeção das regras de workflow do Pi (D2, PFC-02).
//
// Port do rules-injector do guild (guild/src/hooks/rules-injector.ts — lido
// na íntegra) adaptado ao mecanismo do harness: o source injeta em
// TOOL-CALL-LEVEL (rules-tool-policy: `<rules source="dir">` em read/write/
// edit); o F30 injeta em before_agent_start (QA-3 — wording do roadmap;
// chaining F27/F28 verificado; determinístico; zero overhead por tool call).
// O tool-call-level fica como flag P2 (persona.rulesInjector.toolCallLevel:
// false — D2) e NÃO é portado em v1.
//
// Conteúdo = renderRules("pi") (PI_RULES do F19 — REUSO read-only; F19 é o
// dono do texto; zero duplicação de template). Marker na convenção F27/F28
// (`<!-- runecraft:* -->` — continuation.ts CONTINUATION_MARKER /
// lessons.ts LESSONS_MARKER).
import { renderRules } from "../adapters/rulesContent.ts";

/** Marker da seção de regras injetada (convenção F27/F28). */
export const RULES_MARKER = "<!-- runecraft:rules -->" as const;

/**
 * Constrói a injeção de regras: marker + conteúdo renderRules("pi").
 * PURO — determinístico (mesmo input → mesmos bytes).
 */
export function buildRulesInjection(piRules: string): string {
  return `${RULES_MARKER}\n${piRules}`;
}

/** Injeção completa usando o render real do F19 (reuso read-only). */
export function buildPiRulesInjection(): string {
  return buildRulesInjection(renderRules("pi"));
}
