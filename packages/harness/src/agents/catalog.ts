// agents/catalog.ts — catálogo dos papéis objetivos (F32, D3; ROLE-02).
//
// Fonte ÚNICA de verdade para os 7 papéis objetivos: identidade, tools
// allowlist (fail-closed — o que não está na lista não existe), constraints e
// política de delegação. Consumido por:
//   - render de prompts (dynamic-prompt-builder.ts — D4)
//   - template de delegação (delegation.ts — D5)
//   - evals EVAL-057..066 (D9) e pela validação catalog ↔ .md abaixo
//   - docs (ROUTING §8.13 — D10)
//
// O vocabulário de tools é ANCORADO no frontmatter real dos 9 builtins do
// fork (packages/subagents/agents/*.md — lido no Execute F32) e no conjunto
// READ_ONLY_BUILTIN_TOOLS do fork (completion-guard.ts:7-17). `glob` NÃO é
// tool do fork (não observada em nenhum builtin/fonte) → fora do vocabulário
// (fail-closed: nome não verificado é rejeitado).
//
// D3 (papéis, semântica extraída dos default.ts do arcanum — lidos):
//   planner   — planos apenas, 2 modos, clarificação por escopo, nunca
//               implementa (read-only; output persistido pelo runtime)
//   builder   — executa o plano, verifica antes de reportar; ÚNICO papel que
//               delega (subagent → scout/reviewer)
//   reviewer  — veredito [APPROVE]/[REJECT] + ≤3 blocking issues, approval
//               bias; read-only (SEM edit/write — endurecido vs builtin)
//   auditor   — auditoria de conformidade; write restrito a .md (guard F24)
//   scout     — recon read-only; reporta no retorno (output persistido)
//   researcher— pesquisa externa read-only; cita fontes (output persistido)
//   security  — revisão de segurança read-only; triage + fast-exit
//
// Zero tema RPG (decisão 2 — AD-022): nenhum identificador/nome de papel aqui
// referencia personagens de fantasia; a deny-list abaixo é o espelho dos
// evals (EVAL-057 — precedente F30 EVAL-047).
import * as fs from "node:fs";

/** Ids dos 7 papéis objetivos (naming travado do roadmap F32). */
export const ROLE_IDS = [
  "planner",
  "builder",
  "reviewer",
  "auditor",
  "scout",
  "researcher",
  "security",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/** Vocabulário de tools verificado no fork (builtins + review-loop.md). */
export const TOOL_VOCABULARY = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
  "intercom",
  "contact_supervisor",
  "subagent",
  "web_search",
  "fetch_content",
  "get_search_content",
] as const;

export type RoleTool = (typeof TOOL_VOCABULARY)[number];

/** Tools read-only do fork (completion-guard.ts READ_ONLY_BUILTIN_TOOLS). */
export const READ_ONLY_TOOLS = new Set<string>([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "fetch_content",
  "get_search_content",
  "intercom",
  "contact_supervisor",
]);

/** Keys de frontmatter aceitas pelo parser do fork (agent-serializer.ts
 *  KNOWN_FIELDS — validação fail-closed contra typos). */
export const FORK_FRONTMATTER_KEYS = new Set<string>([
  "name",
  "package",
  "description",
  "tools",
  "model",
  "fallbackModels",
  "thinking",
  "systemPromptMode",
  "inheritProjectContext",
  "inheritSkills",
  "defaultContext",
  "async",
  "timeoutMs",
  "turnBudget",
  "acceptance",
  "acceptanceRole",
  "skill",
  "skills",
  "skillPath",
  "extensions",
  "subagentOnlyExtensions",
  "output",
  "defaultReads",
  "defaultProgress",
  "interactive",
  "maxSubagentDepth",
  "completionGuard",
  "toolBudget",
  "memory",
]);

/** Termos RPG/arcaicos (decisão 2 — deny-list dos evals; precedente F30).
 *  Substring check (mesmo critério do EVAL-047 — "explore" contém "lore"). */
export const RPG_DENY_LIST = [
  "bard",
  "wizard",
  "ranger",
  "fighter",
  "warlock",
  "cleric",
  "paladin",
  "rogue",
  "spell",
  "lore",
  "guild",
  "thread",
  "saga",
];

export interface RoleConstraints {
  /** read-only: sem tools de mutação direta (edit/write) no allowlist. */
  readOnly: boolean;
  /** md-only: write restrito a .md (guard rangerMdOnly do F24 — D7). */
  mdOnly: boolean;
  /** pode delegar (tool subagent no allowlist — D5; só o builder). */
  canDelegate: boolean;
  /** artefato de output persistido pelo runtime do fork (D3). */
  output?: string;
  defaultReads: string[];
  thinking: "high" | "medium" | "low";
}

export interface RoleDefinition {
  id: RoleId;
  /** nome do arquivo de agente (name == filename — D3). */
  file: string;
  /** identidade objetiva (uma linha — usada em listas/triggers). */
  description: string;
  /** tools allowlist (fail-closed: exatamente o que o papel pode usar). */
  tools: RoleTool[];
  constraints: RoleConstraints;
}

function role(
  id: RoleId,
  description: string,
  tools: RoleTool[],
  constraints: RoleConstraints,
): RoleDefinition {
  return { id, file: `${id}.md`, description, tools, constraints };
}

/** Os 7 papéis objetivos — fonte única de verdade (D3). */
export const ROLE_CATALOG: Record<RoleId, RoleDefinition> = {
  planner: role(
    "planner",
    "Creates implementation plans from context and requirements — never implements",
    ["read", "grep", "find", "ls", "intercom"],
    { readOnly: true, mdOnly: false, canDelegate: false, output: "plan.md", defaultReads: ["context.md"], thinking: "high" },
  ),
  builder: role(
    "builder",
    "Executes the plan with narrow, verified edits — the only role that delegates",
    ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "contact_supervisor", "subagent"],
    { readOnly: false, mdOnly: false, canDelegate: true, defaultReads: ["plan.md"], thinking: "high" },
  ),
  reviewer: role(
    "reviewer",
    "Read-only in-loop reviewer — plan review and work review with a structured verdict",
    ["read", "grep", "find", "ls", "bash", "intercom"],
    { readOnly: true, mdOnly: false, canDelegate: false, defaultReads: ["plan.md", "progress.md"], thinking: "high" },
  ),
  auditor: role(
    "auditor",
    "Independent compliance auditor — writes audit reports in Markdown only",
    ["read", "grep", "find", "ls", "bash", "write", "intercom"],
    { readOnly: false, mdOnly: true, canDelegate: false, defaultReads: ["plan.md"], thinking: "high" },
  ),
  scout: role(
    "scout",
    "Fast read-only codebase reconnaissance that returns compressed context",
    ["read", "grep", "find", "ls", "intercom"],
    { readOnly: true, mdOnly: false, canDelegate: false, output: "context.md", defaultReads: ["context.md"], thinking: "low" },
  ),
  researcher: role(
    "researcher",
    "Read-only external research that returns a sourced brief",
    ["read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content", "intercom"],
    { readOnly: true, mdOnly: false, canDelegate: false, output: "research.md", defaultReads: ["context.md"], thinking: "medium" },
  ),
  security: role(
    "security",
    "Read-only security and compliance reviewer with triage, fast exit, and a structured verdict",
    ["read", "grep", "find", "ls", "bash", "intercom"],
    { readOnly: true, mdOnly: false, canDelegate: false, defaultReads: ["plan.md"], thinking: "high" },
  ),
};

/** Lista determinística dos papéis (ordem do ROLE_IDS — D4). */
export function roleList(): RoleDefinition[] {
  return ROLE_IDS.map((id) => ROLE_CATALOG[id]);
}

// ---------------------------------------------------------------------------
// Validação catalog ↔ assets (D3 — fail-closed com diagnóstico)
// ---------------------------------------------------------------------------

export interface Frontmatter {
  [key: string]: string;
}

export interface ParsedAgentFile {
  role: RoleId;
  frontmatter: Frontmatter;
  body: string;
}

/**
 * Parser mínimo de frontmatter FLAT (espelho do parseFrontmatter do fork
 * para `key: value` — agentes do catálogo usam só chaves flat; block values
 * são rejeitados pela validação). Sem deps (zero YAML em runtime).
 */
export function parseFlatFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const frontmatter: Frontmatter = {};
  if (!content.startsWith("---")) return { frontmatter, body: content };
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return { frontmatter, body: content };
  const block = content.slice(4, endIndex);
  for (const line of block.split("\n")) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match) {
      const rawValue = match[2]!.trim();
      const isQuoted =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"));
      frontmatter[match[1]!] = isQuoted ? rawValue.slice(1, -1) : rawValue;
    }
    // Linhas sem `key:` são ignoradas (comentários/indent — mesmo critério do fork).
  }
  return { frontmatter, body: content.slice(endIndex + 4).trim() };
}

/** Parsing dos tools do frontmatter (lista comma — mesmo split do fork). */
export function parseToolList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export interface RoleValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Valida os 7 arquivos `.md` do diretório de assets contra o catálogo
 * (fail-closed — D3/edge "frontmatter inválido"): arquivo presente por papel,
 * name == filename, description presente, tools == allowlist do catálogo
 * (exato), tools ⊆ vocabulário verificado, keys ⊆ KNOWN_FIELDS do fork,
 * thinking/acceptanceRole/output/defaultReads consistentes, deny-list RPG
 * ausente do frontmatter E do corpo.
 */
export function validateRoleAssets(assetsDir: string): RoleValidationResult {
  const errors: string[] = [];
  for (const definition of roleList()) {
    const filePath = pathJoin(assetsDir, definition.file);
    const content = readFileIfExists(filePath);
    if (content === null) {
      errors.push(`${definition.file}: arquivo ausente em ${assetsDir}`);
      continue;
    }
    const { frontmatter, body } = parseFlatFrontmatter(content);
    validateRoleFile(definition, frontmatter, body, errors);
  }
  return { ok: errors.length === 0, errors };
}

/** Valida UM arquivo de papel (puro — usado pelos unit tests e evals). */
export function validateRoleFile(
  definition: RoleDefinition,
  frontmatter: Frontmatter,
  body: string,
  errors: string[] = [],
): boolean {
  const label = definition.file;
  const name = frontmatter.name;
  if (name !== definition.id) {
    errors.push(`${label}: frontmatter.name "${name ?? "(ausente)"}" != "${definition.id}"`);
  }
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    errors.push(`${label}: frontmatter.description ausente (o parser do fork pula arquivos sem description)`);
  }
  const tools = parseToolList(frontmatter.tools);
  const expectedTools = definition.tools.slice().sort();
  const actualTools = tools.slice().sort();
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    errors.push(`${label}: tools [${tools.join(", ")}] != allowlist do catálogo [${definition.tools.join(", ")}]`);
  }
  for (const tool of tools) {
    if (!(TOOL_VOCABULARY as readonly string[]).includes(tool)) {
      errors.push(`${label}: tool "${tool}" fora do vocabulário verificado do fork`);
    }
  }
  for (const key of Object.keys(frontmatter)) {
    if (!FORK_FRONTMATTER_KEYS.has(key)) {
      errors.push(`${label}: key de frontmatter desconhecida "${key}" (parser do fork preserva, catálogo falha)`);
    }
  }
  if (frontmatter.thinking !== definition.constraints.thinking) {
    errors.push(`${label}: thinking "${frontmatter.thinking ?? "(ausente)"}" != "${definition.constraints.thinking}"`);
  }
  if (definition.constraints.readOnly && frontmatter.acceptanceRole !== "read-only") {
    errors.push(`${label}: papel read-only exige acceptanceRole "read-only" (tem "${frontmatter.acceptanceRole ?? "(ausente)"}")`);
  }
  if (definition.constraints.output !== undefined && frontmatter.output !== definition.constraints.output) {
    errors.push(`${label}: output "${frontmatter.output ?? "(ausente)"}" != "${definition.constraints.output}"`);
  }
  if (definition.constraints.canDelegate && !tools.includes("subagent")) {
    errors.push(`${label}: papel com canDelegate exige tool subagent no allowlist`);
  }
  if (!definition.constraints.canDelegate && tools.includes("subagent")) {
    errors.push(`${label}: papel sem canDelegate NÃO pode ter tool subagent (fail-closed — D5)`);
  }
  for (const term of RPG_DENY_LIST) {
    const haystack = `${JSON.stringify(frontmatter)} ${body}`.toLowerCase();
    if (haystack.includes(term)) {
      errors.push(`${label}: termo proibido "${term}" presente no conteúdo`);
    }
  }
  return errors.length === 0;
}

// --- IO mínimo (asset dir real; os unit tests usam validateRoleFile puro) ---

function pathJoin(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, "")}/${file}`;
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
