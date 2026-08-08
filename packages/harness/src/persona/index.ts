// persona/index.ts — exports públicos do módulo persona (F30, PFC-01/02/03/05).
export { PERSONA_VERSION, PERSONA_TEXT } from "./persona.ts";
export { RULES_MARKER, buildRulesInjection, buildPiRulesInjection } from "./rules.ts";
export {
	PERSONA_MARKER,
	buildPersonaSection,
	composeInjection,
	type PersonaInjectionInput,
} from "./inject.ts";
export {
	noteSessionStart,
	markSessionCreated,
	markApplied,
	shouldApplyVariant,
	clearSession,
	clearAll,
	variantForReason,
	type SessionStartReason,
} from "./first-message.ts";
export {
	defaultPersonaConfig,
	personaKillSwitch,
	validatePersonaConfig,
	loadSessionPersona,
	SessionPersonaConfig,
	type PersonaConfig,
} from "./config.ts";
