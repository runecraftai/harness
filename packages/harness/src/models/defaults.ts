// models/defaults.ts — requisitos de modelo do harness (D4, PFC-04).
//
// O harness NÃO tem registry próprio de modelos: os modelos vêm do
// models.json do SDK (F21/AD-021 — ModelRuntime.create({modelsPath}) +
// getModel). As chains por agente são CONFIG via state
// (models.agents.<id>.fallbackChain) — builtin = {} (sem IDs inventados;
// D4). O port do guild tinha AGENT_MODEL_REQUIREMENTS com chains hardcoded
// por agente RPG; aqui agentes = HOSTS (pi/opencode/claude/codex — decisão
// 2/8) e a precedência builtin vazia cai para custom chain > systemDefault >
// null + warn (nada fabricado).
import type { AgentModelRequirement, FallbackEntry } from "./types.ts";

/** Hosts roteados pelo harness (decisão 8: pi/opencode/claude/codex; F31
 *  adiciona copilot — o módulo aceita qualquer nome de agente). */
export const MODEL_HOST_AGENTS = ["pi", "opencode", "claude", "codex"] as const;

/** Builtin vazio (comentário honesto — D4): o harness não tem registry
 *  próprio; o registry de modelos é do models.json do SDK. Chains = state. */
export const AGENT_MODEL_REQUIREMENTS: Record<string, AgentModelRequirement> = {};

/** A chain builtin de um agente (sempre vazia no harness — D4). */
export function builtinFallbackChain(_agentName: string): FallbackEntry[] | undefined {
	return AGENT_MODEL_REQUIREMENTS[_agentName]?.fallbackChain;
}
