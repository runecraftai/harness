// agents/delegation.ts — delegação via template (F32, D5; ROLE-05).
//
// O "guild_spawn_wizard" do arcanum (src/tools/spawn-wizard.ts +
// spawn-wizard-builder.ts — spawna uma sessão com o prompt do planejador;
// wizard-tool-policy.ts — o planejador NUNCA spawna) vira um TEMPLATE
// renderizado: `renderDelegationPrompt(delegator, catalog)` instrui o papel
// delegador a usar a tool `subagent` (F2 — a delegação observada no F28) com
// `agent: "<papel>"` e lista os alvos válidos via buildKeyTriggersSection
// (D4). Política v1 (QA-5a, AD-032): SÓ o builder tem `subagent` no
// allowlist (D3) — papéis sem a tool recebem `null` (fail-closed: não
// spawnam; espelho do wizard-tool-policy: o planejador nunca spawna).
//
// Módulo PURO (F21 D10): mesmo input → mesmo output byte-idêntico.
import { buildKeyTriggersSection } from "./dynamic-prompt-builder.ts";
import type { RoleDefinition, RoleId } from "./catalog.ts";

/** Alvos de delegação do builder no v1 (QA-5a — recon + verificação). */
export const BUILDER_DELEGATION_TARGETS: readonly RoleId[] = ["scout", "reviewer"] as const;

/** Papel com tool `subagent` no allowlist (D3/D5 — só o builder). */
export function canDelegate(role: RoleDefinition): boolean {
  return role.tools.includes("subagent");
}

/**
 * Renderiza a instrução de delegação para um papel delegador.
 * Retorna `null` quando o papel NÃO tem a tool `subagent` no allowlist
 * (fail-closed — D5): papéis não-delegadores nunca recebem instrução de
 * delegação, espelhando a política do arcanum (planejador nunca spawna).
 * Determinístico — 2 runs idênticos (EVAL-065).
 */
export function renderDelegationPrompt(
  delegator: RoleDefinition,
  roles: readonly RoleDefinition[],
): string | null {
  if (!canDelegate(delegator)) return null;

  const targets = BUILDER_DELEGATION_TARGETS.filter((id) =>
    roles.some((role) => role.id === id),
  );
  const targetLines =
    targets.length > 0
      ? targets.map((id) => `- \`subagent({ agent: "${id}", task: "<concrete task>" })\``).join("\n")
      : "- (nenhum alvo disponível no catálogo)";

  return [
    "## Delegation",
    "",
    `You are the only role allowed to spawn other agents. Use the \`subagent\` tool for scoped sub-work only:`,
    targetLines,
    "",
    "Pass a concrete task and any required context. Await the result and incorporate it — never offload the whole task.",
    "",
    buildKeyTriggersSection(roles),
  ].join("\n");
}
