// agents/dynamic-prompt-builder.ts — builder de prompts dinâmicos (F32, D4;
// ROLE-04).
//
// Port data-driven do `dynamic-prompt-builder.ts` do arcanum (lido no
// Execute F32 — categorizeTools + buildKeyTriggersSection): a lista de
// papéis disponíveis para delegação é RENDERIZADA a partir do ROLE_CATALOG
// (D3) — o delegador vê nomes/descrições/tools reais, nunca texto hardcoded.
// AGENT_NAME_VARIANTS do arcanum NÃO é portado (nomenclatura de fantasia —
// decisão 2: zero RPG).
//
// Módulo PURO (F21 D10): mesmo input → mesmo output byte-idêntico.
import { READ_ONLY_TOOLS, type RoleDefinition, type RoleTool } from "./catalog.ts";

export interface ToolCategories {
  readOnly: string[];
  mutation: string[];
}

/**
 * Classifica tools em read-only × mutation usando o conjunto read-only do
 * fork (completion-guard.ts READ_ONLY_BUILTIN_TOOLS — espelho em catalog.ts).
 */
export function categorizeTools(tools: readonly string[]): ToolCategories {
  const readOnly: string[] = [];
  const mutation: string[] = [];
  for (const tool of tools) {
    if (READ_ONLY_TOOLS.has(tool)) readOnly.push(tool);
    else mutation.push(tool);
  }
  return { readOnly, mutation };
}

/** Formata a lista de tools de um papel (ordem do allowlist — D3). */
export function formatRoleTools(tools: readonly RoleTool[]): string {
  return tools.join(", ");
}

/**
 * Renderiza a seção de "roles disponíveis" do prompt de delegação (D4/D5):
 * um bloco por papel com identidade, descrição e allowlist de tools.
 * Determinístico — 2 runs byte-idênticos (F21 D10).
 */
export function buildKeyTriggersSection(roles: readonly RoleDefinition[]): string {
  const lines: string[] = ["## Available roles", ""];
  for (const role of roles) {
    const { readOnly, mutation } = categorizeTools(role.tools);
    const constraints: string[] = [];
    if (role.constraints.readOnly && mutation.length === 0) constraints.push("read-only");
    if (role.constraints.mdOnly) constraints.push("md-only (writes .md reports only)");
    if (role.constraints.canDelegate) constraints.push("can delegate (subagent)");
    if (role.constraints.output !== undefined) constraints.push(`output: ${role.constraints.output}`);
    lines.push(`### ${role.id}`);
    lines.push(role.description);
    lines.push(`Tools: ${formatRoleTools(role.tools)}`);
    if (constraints.length > 0) lines.push(`Constraints: ${constraints.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
