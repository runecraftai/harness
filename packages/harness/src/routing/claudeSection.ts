// routing/claudeSection.ts — coded-routing directive como seção de CLAUDE.md
// (Phase B1, PARITY.md B1).
//
// O classificador determinístico do F33 (src/routing/classifier.ts) decide a
// rota por CÓDIGO nas sessões Pi (extensão before_agent_start). O Claude Code
// não tem superfície de extensão — a decisão é carregada como DIRECTIVE:
// esta seção (`runecraft:routing`) é renderizada a partir do MESMO catálogo
// (ROUTE_CATALOG do F33 + ROLE_CATALOG do F32) e injetada em
// ~/.claude/CLAUDE.md pelo motor de seções (F18) — o agente aplica as regras
// codificadas; o mecanismo continua sendo o mesmo catálogo, nunca texto
// inventado. A paridade decisória (classificador × directive) é o alvo do B8.
//
// Regras (espelho do classifier.ts — thresholds EXPLÍCITOS, segurança
// OBRIGATÓRIA, fail-closed direct):
//   - score por rota = Σ (high ×2, medium ×1); ROUTE_THRESHOLD = 2;
//   - abaixo do threshold → direct (trabalhe direto, sem delegação);
//   - segurança: qualquer keyword HIGH de segurança → delegar ao papel
//     security — NÃO opcional (paladin "MUST ... not optional");
//   - empate → prioridade determinística (security > planning > implement >
//     review > research > explore);
//   - presença de `.specs/.../spec.md` (SDD) → +2 planning;
//   - sem sinal → direct (fail-closed).
//
// Delegação (QA-5 do F32 espelhado): via a tool nativa `Agent` (a "Task
// tool" — ferramenta de delegação do Claude Code) com o nome do papel;
// SÓ o builder tem a tool Agent no allowlist; os demais papéis nunca spawnam.
//
// Módulo PURO (F21 D10): mesmo input → mesmo output byte-idêntico (golden).
import { roleList, type RoleDefinition } from "../agents/catalog.ts";
import { ROUTE_CATALOG, DELEGATABLE_ROUTE_IDS, type RouteId } from "./routes.ts";
import { ROUTE_THRESHOLD } from "./classifier.ts";
import { CLAUDE_DELEGATION_TOOL } from "../adapters/claudeAgents.ts";

/** Id da seção no CLAUDE.md (motor F18 — markers html). */
export const ROUTING_SECTION = "runecraft:routing";

/** Versão do template da seção (bump quando o conteúdo mudar — F19 vN→vM). */
export const CLAUDE_ROUTING_SECTION_VERSION = "1" as const;

/** Rota do catálogo → papel alvo (F32); direct → null. */
export function claudeRouteRole(route: RouteId, roles: readonly RoleDefinition[]): RoleDefinition | null {
  const roleId = ROUTE_CATALOG[route].role;
  if (roleId === null) return null;
  return roles.find((role) => role.id === roleId) ?? null;
}

/** Lista de keywords de uma rota no formato compacto do directive. */
function keywordList(keywords: readonly string[]): string {
  if (keywords.length === 0) return "—";
  return keywords.map((k) => `\`${k}\``).join(" ");
}

/**
 * Renderiza o corpo da seção `runecraft:routing` (o que vai ENTRE os markers
 * do F18 — os markers/upsert são do adaptador). Determinístico — 2 runs
 * byte-idênticos (F21 D10). Contém apenas dados do catálogo: rotas × papéis ×
 * keywords × threshold + regra de segurança obrigatória + delegação via a
 * tool `Agent` do Claude Code.
 */
export function renderClaudeRoutingSection(roles: readonly RoleDefinition[] = roleList()): string {
  const lines: string[] = [
    "## Coded routing directive (deterministic — never LLM-selected)",
    "",
    "The harness routes work by explicit thresholds in code. This section is the directive",
    `rendered from the same route catalog (threshold ${ROUTE_THRESHOLD}; high-signal ×2, medium ×1;`,
    "below threshold or no signal → direct: do the work yourself, no delegation).",
    "",
    "## Route table",
    "",
    "| Route | Role | When (high-signal keywords) |",
    "| --- | --- | --- |",
  ];
  for (const route of DELEGATABLE_ROUTE_IDS) {
    const definition = ROUTE_CATALOG[route];
    const role = claudeRouteRole(route, roles);
    const roleName = role?.id ?? "—";
    lines.push(`| ${route} | ${roleName} | ${keywordList(definition.keywords.high)} |`);
  }
  lines.push(
    "",
    "Ties resolve deterministically: security > planning > implement > review > research > explore.",
    "Presence of `.specs/.../spec.md` (SDD) adds +2 to planning.",
    "",
    "## Security is MANDATORY",
    "",
    `When the task mentions any high-signal security keyword — ${keywordList(ROUTE_CATALOG.security.keywords.high)} —`,
    `delegate to the \`security\` role via the ${CLAUDE_DELEGATION_TOOL} tool. This is NOT optional:`,
    "do not skip it, do not substitute another role.",
    "",
    "## Delegation",
    "",
    `Delegate via the native ${CLAUDE_DELEGATION_TOOL} tool (the Task tool) naming the role —`,
    "e.g. a recon before implementing delegates to `scout`, review of finished work delegates to `reviewer`.",
    `Only the \`builder\` role has the ${CLAUDE_DELEGATION_TOOL} tool in its allowlist: roles other than builder`,
    "never spawn other agents (the routing directive is applied by the session, not by role agents).",
    "",
    "## Available roles",
    "",
  );
  for (const role of roles) {
    lines.push(`- **${role.id}** — ${role.description}`);
  }
  return lines.join("\n");
}
