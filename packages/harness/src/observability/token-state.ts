// observability/token-state.ts — port do session-token-state do arcanum
// (D4, OBS-05): mapa em memória por sessão {maxTokens, usedTokens}.
//
// Semântica do guild (session-token-state.ts — supersedido, AD-001):
//   - setContextLimit: define maxTokens; NÃO sobrescreve usedTokens;
//   - updateUsage: só com inputTokens > 0 (semântica "input tokens" do
//     message.updated); guarda o LATEST, não cumulativo (a janela atual);
//   - clearSession: reset.
// A FONTE no Pi é `ctx.getContextUsage()` (ContextUsage {tokens,
// contextWindow} — API tipada do SDK 0.81.0) + token-budget do taskflow
// (bridge read-only). O monitor consome o snapshot para context:usage.
export interface TokenStateValue {
  maxTokens: number;
  usedTokens: number;
}

export class TokenState {
  private maxTokens = 0;
  private usedTokens = 0;

  /** Define o limite da janela (chat.params do arcanum). Não toca usedTokens. */
  setContextLimit(maxTokens: number): void {
    if (typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0) {
      this.maxTokens = maxTokens;
    }
  }

  /** updateUsage (message.updated): só inputTokens > 0; LATEST, não cumulativo. */
  updateUsage(inputTokens: number): void {
    if (typeof inputTokens === "number" && Number.isFinite(inputTokens) && inputTokens > 0) {
      this.usedTokens = inputTokens;
    }
  }

  clearSession(): void {
    this.maxTokens = 0;
    this.usedTokens = 0;
  }

  snapshot(): TokenStateValue {
    return { maxTokens: this.maxTokens, usedTokens: this.usedTokens };
  }
}
