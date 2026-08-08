// routing/directive.ts — ROUTING DIRECTIVE (F33, D1/D5; RTE-03/05).
//
// Bloco determinístico injetado no systemPrompt (marker `<!-- runecraft:routing
// -->` — precedente F28/F30: markers de adendo encadeável no before_agent_start).
// Conteúdo: rota resolvida + chain de piloto selecionada + delegação via tool
// `subagent` (F2 — equivalente nativo do call_guild_agent; NUNCA
// call_guild_agent) com os alvos válidos do catalog F32
// (renderDelegationPrompt + buildKeyTriggersSection — read-only).
//
// Política QA-5 PRESERVADA (F32): só o builder tem a tool `subagent` no
// allowlist; papéis não-delegadores recebem a instrução "a chain orquestra os
// passos — não spawn in-role" (renderDelegationPrompt devolve null para eles —
// fail-closed; o runtime do fork spawna os passos da chain).
//
// Rota direct → NENHUM bloco (null — fail-closed silencioso; o agente opera
// normal). Módulo PURO (F21 D10): mesmo input → mesmo output byte-idêntico.
import { renderDelegationPrompt } from "../agents/delegation.ts";
import { buildKeyTriggersSection } from "../agents/dynamic-prompt-builder.ts";
import type { RoleDefinition } from "../agents/catalog.ts";
import { ROUTE_CATALOG, type RouteId } from "./routes.ts";
import type { RouteDecision } from "./classifier.ts";

/** Marker do bloco de routing (convenção F28/F30 — encadeável). */
export const ROUTING_MARKER = "<!-- runecraft:routing -->";

export interface RoutingDirectiveOptions {
  /** decisão do classificador (freeze por sessão — T3). */
  decision: RouteDecision;
  /** chain de piloto selecionada (nome do asset — verificada presente no
   *  .pi/chains/ pelo caller; null para rota sem chain = nunca chamar com
   *  rota delegável + chain null — o caller fail-closed para direct antes). */
  chain: string | null;
  /** papéis do catalog F32 (roleList() — read-only). */
  roles: readonly RoleDefinition[];
}

/** Rota do bloco → papel alvo (catalog F32); direct → null. */
export function routeRole(route: RouteId, roles: readonly RoleDefinition[]): RoleDefinition | null {
  const roleId = ROUTE_CATALOG[route].role;
  if (roleId === null) return null;
  return roles.find((role) => role.id === roleId) ?? null;
}

/**
 * Renderiza o ROUTING DIRECTIVE. `null` para rota direct (sem bloco —
 * fail-closed silencioso). Determinístico — 2 runs byte-idênticos (EVAL-078).
 */
export function renderRoutingDirective(
  decision: RouteDecision,
  chain: string | null,
  roles: readonly RoleDefinition[],
): string | null {
  if (decision.route === "direct") return null;
  const role = routeRole(decision.route, roles);
  const delegation = role !== null ? renderDelegationPrompt(role, [...roles]) : null;

  const lines: string[] = [
    ROUTING_MARKER,
    "## Routing directive",
    `Route: ${decision.route}`,
    `Role: ${role?.id ?? "—"}`,
    `Pilot chain: ${chain ?? "(none)"}`,
    "",
    "This session was routed by the deterministic classifier (pure code with explicit",
    "thresholds — never LLM-selected). The pilot chain above orchestrates the work: the",
    "subagents fork executes its steps in order, each step spawning its role agent via",
    "the `subagent` tool. Review gates return the structured verdict `[APPROVE]` or",
    "`[REJECT]` with at most 3 blocking issues.",
    "",
  ];
  if (delegation !== null) {
    lines.push(delegation, "");
  } else {
    lines.push(
      "Your role does not delegate in-role (QA-5 — only the builder has the `subagent` tool).",
      "The chain runtime spawns the steps; do not attempt to spawn agents yourself.",
      "",
    );
  }
  lines.push(buildKeyTriggersSection(roles));

  return lines.join("\n");
}
