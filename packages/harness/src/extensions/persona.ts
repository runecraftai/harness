// src/extensions/persona.ts — wiring Pi do F30 (D1/D2/D3, PFC-01/02/03).
//
// Registra a camada de persona do Pi como extensão. O init é THIN — a
// decisão vive nos módulos puros de src/persona/:
//
//   session_start        → freeze config `persona` (D5/D12) + markSession
//                          Created(sessionId, reason) — seleção da variante
//                          determinística por reason (D3: inicial → variante;
//                          resume|reload → sem — F27 dono da continuação)
//   before_agent_start   → composeInjection(persona → rules → [variante])
//                          anexado ao systemPrompt ENCADEADO (markers
//                          persona/rules — convenção F27/F28; NUNCA
//                          sobrescreve) + markApplied UMA vez por sessão
//
// Kill switch RUNECRAFT_PERSONA=0 → camada INERTE (sem injeção, zero
// arquivos — F20/D5). Falha de render → sessão segue sem injeção + aviso
// (fail-soft — injeção de prompt não é gate; D1). Nada de console.log:
// log dedicado em stderr (regra do guild).
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { SessionPersonaConfig } from "../persona/config.ts";
import { composeInjection } from "../persona/inject.ts";
import { markApplied, noteSessionStart, shouldApplyVariant, type SessionStartReason } from "../persona/first-message.ts";

/** Logger dedicado (regra do guild: sem console.log; stderr, não stdout). */
const log = {
	debug(message: string): void {
		if (process.env.RUNECRAFT_PERSONA_DEBUG === "1" || process.env.RUNECRAFT_PERSONA_DEBUG === "true") {
			process.stderr.write(`[runecraft:persona] ${message}\n`);
		}
	},
	warn(message: string): void {
		process.stderr.write(`[runecraft:persona] warn: ${message}\n`);
	},
};

export interface PersonaDeps {
	/** env override (testes) — default process.env. */
	env?: NodeJS.ProcessEnv;
	/** identity de sessão injetável — default ctx.sessionManager.getSessionId(). */
	sessionId?: (ctx: ExtensionContext) => string | null;
}

/**
 * Registra a camada de persona no Pi. Carregado apenas em sessões gerenciadas
 * pelo harness (manifest pi.extensions / settings.json do fixture).
 */
export function installPersona(pi: ExtensionAPI, deps: PersonaDeps = {}): void {
	const env = deps.env ?? process.env;
	const sessionConfig = new SessionPersonaConfig(env);

	// Estado da sessão (um por processo de extensão — semântica fiel do
	// source first-message-variant: nova instância = novo estado).
	let currentSessionId: string | null = null;
	// Variante habilitada para a sessão ATUAL por reason (D3): initial → true;
	// resume|reload → false (F27 dono da continuação). Separado do Set
	// created/applied do source — shouldApplyVariant só conhece created&&!applied.
	let variantEnabled = false;

	const sessionIdOf = (ctx: ExtensionContext): string | null => {
		if (deps.sessionId) return deps.sessionId(ctx);
		try {
			return ctx.sessionManager.getSessionId() ?? null;
		} catch {
			return null;
		}
	};

	// ---------------------------------------------------------------
	// session_start — freeze + registro da sessão (D3/D5)
	// ---------------------------------------------------------------
	pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
		sessionConfig.capture(ctx.cwd);
		const frozen = sessionConfig.frozen(ctx.cwd);
		for (const problem of frozen.problems) log.warn(`config: ${problem}`);
		if (frozen.killSwitch || !frozen.config.enabled) {
			log.debug("persona layer inert (kill switch or disabled)");
			return;
		}
		const sessionId = sessionIdOf(ctx);
		if (sessionId === null) return; // sem identidade — nunca inventar
		currentSessionId = sessionId;
		variantEnabled = frozen.config.firstMessageVariant.enabled && noteSessionStart(sessionId, event.reason as SessionStartReason);
		log.debug(`session_start: ${sessionId} (reason=${event.reason}, variant=${variantEnabled ? "yes" : "no"})`);
	});

	// ---------------------------------------------------------------
	// before_agent_start — persona + rules (+ variante) ENCADEADO
	// ---------------------------------------------------------------
	pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: ExtensionContext): { systemPrompt?: string } | undefined => {
		const frozen = sessionConfig.frozen(ctx.cwd);
		if (frozen.killSwitch || !frozen.config.enabled) return undefined;
		const sessionId = sessionIdOf(ctx) ?? currentSessionId;
		if (sessionId === null) return undefined;

		// Variante de primeira mensagem: aplicada UMA vez por sessão inicial
		// (D3 — reason resume|reload → variantEnabled=false; F27 dono da
		// continuação). shouldApplyVariant garante 1× (Sets created/applied).
		let variant: string | undefined;
		const rulesEnabled = frozen.config.rulesInjector.enabled;
		if (variantEnabled && shouldApplyVariant(sessionId)) {
			variant = buildFirstMessageVariant(frozen.config.rulesInjector.enabled);
			markApplied(sessionId);
		}
		try {
			const result = composeInjection(event.systemPrompt, {
				...(rulesEnabled ? {} : { rules: "" }),
				...(variant !== undefined ? { variant } : {}),
			});
			if (result.systemPrompt === event.systemPrompt) return undefined;
			log.debug(`persona+rules injected (markers runecraft:persona/runecraft:rules)`);
			// ENCADEADO (não sobrescreve outras extensões — runner.js re-passou
			// o systemPrompt por extensão): anexa ao systemPrompt corrente.
			return result;
		} catch (error) {
			// Fail-soft (D1): injeção de prompt não é gate — a sessão segue.
			log.warn(`render falhou — sessão segue sem injeção: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	});
}

/** Variante de primeira mensagem (D3 — texto curto e objetivo; a persona e
 *  as regras já vão no adendo principal; a variante orienta o PRIMEIRO turno
 *  quando a sessão é inicial). */
function buildFirstMessageVariant(rulesInjected: boolean): string {
	const rules = rulesInjected
		? "The workflow rules above govern your session."
		: "Follow the harness workflow rules for this session.";
	return `First message (session start): orient the very first turn — ${rules} Read the repository state before proposing work, and start by confirming the immediate next action.`;
}
