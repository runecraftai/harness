// persona/inject.ts — composição da injeção de persona + rules (+ variante)
// (D1/D2/D3, PFC-01/02/03).
//
// composeInjection monta o adendo encadeado no shape de
// BeforeAgentStartEventResult (SDK types.d.ts ~790: "If multiple extensions
// return this, they are chained" — o runner re-passou o systemPrompt
// corrente por extensão). Ordem de append: persona → rules → [continuation
// F27] → [lessons F28]. Cada item carrega seu marker — NUNCA sobrescreve
// (append; F27/F28 continuam donos dos adendos deles).
//
// PURO por construção: mesmo input → mesmo systemPrompt (F21 D10 — sem
// timestamp/path no texto).
import { PERSONA_TEXT, PERSONA_VERSION } from "./persona.ts";
import { buildPiRulesInjection } from "./rules.ts";

/** Marker da seção de persona (convenção F27/F28). */
export const PERSONA_MARKER = "<!-- runecraft:persona -->" as const;

export interface PersonaInjectionInput {
  /** texto da persona (default PERSONA_TEXT — injetável p/ teste). */
  persona?: string;
  /** injeção de regras (default buildPiRulesInjection() — reuso F19). */
  rules?: string;
  /** variante de primeira mensagem (opcional — só em sessão inicial). */
  variant?: string;
}

/** Adendo de persona: marker + texto + versão (golden F23). */
export function buildPersonaSection(persona: string = PERSONA_TEXT): string {
  return `${PERSONA_MARKER}\n${persona}\n\n(persona v${PERSONA_VERSION})`;
}

/**
 * Compõe o adendo completo (persona → rules → [variante]) e o anexa ao
 * systemPrompt corrente (append — encadeado, nunca sobrescreve). Retorna o
 * shape do BeforeAgentStartEventResult.
 */
export function composeInjection(
  currentSystemPrompt: string,
  input: PersonaInjectionInput = {},
): { systemPrompt: string } {
  const parts: string[] = [];
  const personaSection = buildPersonaSection(input.persona);
  if (personaSection.trim().length > 0) parts.push(personaSection);
  const rules = input.rules ?? buildPiRulesInjection();
  if (rules.trim().length > 0) parts.push(rules);
  if (input.variant !== undefined && input.variant.trim().length > 0) parts.push(input.variant.trim());
  if (parts.length === 0) return { systemPrompt: currentSystemPrompt };
  return { systemPrompt: `${currentSystemPrompt}\n\n${parts.join("\n\n")}` };
}
