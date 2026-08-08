// persona/first-message.ts — variante de primeira mensagem (D3, PFC-03).
//
// Port FIEL do first-message-variant do guild (guild/src/hooks/
// first-message-variant.ts — lido na íntegra): Sets em memória `created/
// applied` por processo + markSessionCreated/markApplied/shouldApplyVariant/
// clearSession/clearAll (semântica AS-IS do source). DI do sessionId e do
// reason (do evento do SDK — F27 estabeleceu initial/resume/reload).
//
// Seleção determinística por reason (D3): inicial/undefined → variante;
// resume|reload → SEM variante (a continuação é dona do F27 — fronteira
// D11). Aplicado UMA vez por sessão (shouldApplyVariant). Estado em memória
// por processo — nova instância de extensão = novo estado (semântica fiel
// do source, documentada no docs/PI.md).
export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork" | undefined;

/** Razões que NÃO re-aplicam a variante (F27 dono da continuação — D3). */
const NON_INITIAL_REASONS = new Set<string>(["resume", "reload"]);

/**
 * Variante para o reason da sessão (D3 — determinístico): initial/undefined
 * → a variante; resume|reload → null (continuação é dona do F27).
 */
export function variantForReason(reason: SessionStartReason): boolean {
  if (reason === undefined) return true;
  return !NON_INITIAL_REASONS.has(reason);
}

/** Port AS-IS do source (Set created/applied em memória). */
const appliedSessions = new Set<string>();
const createdSessions = new Set<string>();

export function markSessionCreated(sessionId: string): void {
  createdSessions.add(sessionId);
}

export function markApplied(sessionId: string): void {
  appliedSessions.add(sessionId);
}

export function shouldApplyVariant(sessionId: string): boolean {
  return createdSessions.has(sessionId) && !appliedSessions.has(sessionId);
}

export function clearSession(sessionId: string): void {
  appliedSessions.delete(sessionId);
  createdSessions.delete(sessionId);
}

export function clearAll(): void {
  appliedSessions.clear();
  createdSessions.clear();
}

/**
 * Registra a criação da sessão (session_start). Retorna true quando a
 * variante deve ser aplicada no before_agent_start seguinte (created &&
 * !applied && reason inicial).
 */
export function noteSessionStart(sessionId: string, reason: SessionStartReason): boolean {
  markSessionCreated(sessionId);
  return variantForReason(reason) && shouldApplyVariant(sessionId);
}
