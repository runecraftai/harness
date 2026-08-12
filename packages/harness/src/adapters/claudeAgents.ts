// adapters/claudeAgents.ts — materialização dos 7 papéis objetivos para o
// Claude Code (Phase B1, PARITY.md B1).
//
// Espelho do F32 (agents/materialize.ts): copia os 7 assets versionados
// (packages/harness/claude-agents/*.md — formato de agent file do Claude Code:
// frontmatter name/description/tools + corpo = system prompt) para
// ~/.claude/agents/ (escopo USUÁRIO — o Claude Code descobre agent files de
// ~/.claude/agents/ em todo projeto; o recon B1 fixa esse alvo) com THREE-WAY
// por conteúdo (F19 D7) + contentHash no state (F13 — seção `claudeAgents`).
// Órfãos reportados, nunca removidos (F18); claude ausente → dados inertes
// (status/doctor informam — matriz F17).
//
// Estados por arquivo (espelho do planRoleAgents do F32):
//   ausente           → missing  → copia (re-injetado)
//   arquivo == asset  → in-sync  (registrado == hash) | adopted (registra, sem write)
//   arquivo != asset  → updated (arquivo == registrado ≠ asset: template vN→vM,
//                       copia) | edited (arquivo ≠ registrado: usuário editou —
//                       NUNCA reescreve, preserva + reporta)
//
// Validação (fail-closed — espelho do validateRoleAssets do F32): os 7 assets
// devem ter frontmatter válido (name == papel, description presente, tools ⊆
// vocabulário VERIFICADO do Claude Code), só o builder com a tool de delegação
// (Agent — espelho QA-5 do F32: papéis não-delegadores NÃO spawnam) e deny-list
// RPG ausente. Zero tema RPG (decisão 2 — AD-022).
//
// Deterministismo (F21 D10): planos derivados só de conteúdo (sha256), sem
// $TMP/$TS em identidade.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ROLE_IDS, type RoleId, RPG_DENY_LIST } from "../agents/catalog.ts";

/** Versão do template dos assets (bump quando os .md mudarem — F19 vN→vM). */
export const CLAUDE_AGENTS_ASSETS_VERSION = "1" as const;

/** Registro no state de UM papel Claude materializado (F13 — contentHash;
 *  mesma shape do RoleAgentRecord do F32 — reuso de tipo). */
export interface ClaudeAgentRecord {
  installedAt: string;
  harnessVersion: string;
  /** sha256 do conteúdo do arquivo no ÚLTIMO sync/install (F13). */
  contentHash: string;
  /** versão do template asset naquele sync (F19 vN→vM). */
  assetVersion: string;
}

export type ClaudeAgentFileStatus = "missing" | "in-sync" | "adopted" | "updated" | "edited";

export interface ClaudeAgentFilePlan {
  roleId: RoleId;
  /** caminho absoluto do alvo (~/.claude/agents/<id>.md). */
  file: string;
  assetHash: string;
  fileHash: string | null;
  registered: ClaudeAgentRecord | undefined;
  status: ClaudeAgentFileStatus;
}

/**
 * Vocabulário de tools VERIFICADO do Claude Code (tools-reference 2026 —
 * subagent `tools` allowlist; os nomes são exatamente os aceitos no
 * frontmatter). `Agent` = delegação nativa (a "Task tool" da doc histórica —
 * a ferramenta canônica atual; ver docs/agents.md B1). Nenhum nome fora do
 * vocabulário é aceito (fail-closed: o Claude falha ao lançar agente com
 * tools que não resolvem — "Agent would be spawned with zero tools").
 */
export const CLAUDE_TOOL_VOCABULARY = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "Edit",
  "Write",
  "WebSearch",
  "WebFetch",
  "Agent",
] as const;

export type ClaudeTool = (typeof CLAUDE_TOOL_VOCABULARY)[number];

/** Tool de delegação nativa do Claude Code (espelho do `subagent` do F32 —
 *  QA-5: só o builder a tem no allowlist). */
export const CLAUDE_DELEGATION_TOOL = "Agent" as const;

/** Keys de frontmatter aceitas (validação fail-closed contra typos — o
 *  Claude ignora/registra erros p/ keys desconhecidas; aqui falha cedo). */
export const CLAUDE_FRONTMATTER_KEYS = new Set<string>([
  "name",
  "description",
  "tools",
  "model",
  "disallowedTools",
  "permissionMode",
  "maxTurns",
  "skills",
  "memory",
  "background",
  "isolation",
  "color",
]);

/** Mapeamento papel → tools do Claude Code (espelho das allowlists do F32
 *  traduzidas para o vocabulário nativo; read-only roles sem mutation tools;
 *  só o builder com Agent). */
export const CLAUDE_ROLE_TOOLS: Record<RoleId, readonly ClaudeTool[]> = {
  planner: ["Read", "Glob", "Grep"],
  builder: ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "Agent"],
  reviewer: ["Read", "Glob", "Grep", "Bash"],
  auditor: ["Read", "Glob", "Grep", "Bash", "Write"],
  scout: ["Read", "Glob", "Grep"],
  researcher: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  security: ["Read", "Glob", "Grep", "Bash"],
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Diretório de assets dos papéis Claude no pacote (injetável p/ teste). */
export function claudeAgentsAssetsDir(root: string = packageRoot()): string {
  return path.join(root, "claude-agents");
}

/** Diretório alvo (~/.claude/agents — escopo usuário; o alvo vem do
 *  claudeCodeHome(env) do caller, nunca os.homedir() do processo). */
export function claudeAgentsDir(claudeHome: string): string {
  return path.join(claudeHome, "agents");
}

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

let cachedHarnessVersion: string | undefined;

/** Versão do package do harness (best-effort; fallback estável — F13). */
export function harnessVersion(): string {
  if (cachedHarnessVersion === undefined) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as { version?: string };
      cachedHarnessVersion = pkg.version ?? "0.0.0-dev";
    } catch {
      cachedHarnessVersion = "0.0.0-dev";
    }
  }
  return cachedHarnessVersion;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Lê o asset de um papel; null quando ausente (asset sumiu do pacote). */
export function readClaudeAgentAsset(roleId: RoleId, root: string): string | null {
  try {
    return fs.readFileSync(path.join(claudeAgentsAssetsDir(root), `${roleId}.md`), "utf8");
  } catch {
    return null;
  }
}

function readAgentFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plan + apply (three-way F19 D7 — espelho F32)
// ---------------------------------------------------------------------------

/**
 * Planeja a reconciliação read-only dos 7 papéis Claude (three-way F19 D7).
 * Ordem determinística (ROLE_IDS). Nunca escreve.
 */
export function planClaudeAgents(
  claudeHome: string,
  claudeAgents: Record<string, ClaudeAgentRecord> | undefined,
  root: string = packageRoot(),
): ClaudeAgentFilePlan[] {
  const plans: ClaudeAgentFilePlan[] = [];
  for (const roleId of ROLE_IDS) {
    const asset = readClaudeAgentAsset(roleId, root);
    if (asset === null) continue; // asset ausente do pacote — papel não materializado
    const file = path.join(claudeAgentsDir(claudeHome), `${roleId}.md`);
    const assetHash = contentHash(asset);
    const fileContent = readAgentFile(file);
    const fileHash = fileContent === null ? null : contentHash(fileContent);
    const registered = claudeAgents?.[roleId];

    let status: ClaudeAgentFileStatus;
    if (fileHash === null) {
      status = "missing";
    } else if (fileHash === assetHash) {
      status = registered?.contentHash === assetHash ? "in-sync" : "adopted";
    } else if (registered?.contentHash === assetHash) {
      // arquivo ≠ asset, mas o registrado == asset → o usuário editou depois do
      // último sync (preserva — nunca auto-cura, F19 D7).
      status = "edited";
    } else if (registered !== undefined && fileHash === registered.contentHash) {
      // arquivo == registrado ≠ asset → o TEMPLATE mudou (vN→vM): atualiza.
      status = "updated";
    } else {
      // arquivo ≠ asset e ≠ registrado (ou nunca registrado) → preserva.
      status = "edited";
    }
    plans.push({ roleId, file, assetHash, fileHash, registered, status });
  }
  return plans;
}

export interface ApplyClaudeAgentsResult {
  /** arquivos copiados (missing + updated). */
  copied: string[];
  /** true quando o mapa de registros MUDOU (exige saveState — LIFE 3.2). */
  changed: boolean;
  notes: string[];
}

/**
 * Aplica o plano (writes only para missing/updated — F19 D7), atualiza o
 * registro `claudeAgents` in-place e devolve notas para o reporte do CLI.
 * Nunca toca arquivos edited (F19 D7 — preserva + reporta).
 */
export function applyClaudeAgents(
  claudeHome: string,
  claudeAgents: Record<string, ClaudeAgentRecord>,
  plans: ClaudeAgentFilePlan[],
  root: string = packageRoot(),
): ApplyClaudeAgentsResult {
  const copied: string[] = [];
  const notes: string[] = [];
  let changed = false;
  const version = harnessVersion();
  for (const plan of plans) {
    const asset = readClaudeAgentAsset(plan.roleId, root);
    if (asset === null) continue;
    if (plan.status === "missing" || plan.status === "updated") {
      fs.mkdirSync(path.dirname(plan.file), { recursive: true }); // precedente F32 materialize.ts
      fs.writeFileSync(plan.file, asset, "utf8");
      copied.push(`${plan.roleId}.md`);
      notes.push(
        plan.status === "missing"
          ? `${plan.roleId}: re-injetado (ausente)`
          : `${plan.roleId}: atualizado (template ${plan.registered?.assetVersion ?? "?"}→${CLAUDE_AGENTS_ASSETS_VERSION})`,
      );
      claudeAgents[plan.roleId] = {
        installedAt: new Date().toISOString(),
        harnessVersion: version,
        contentHash: plan.assetHash,
        assetVersion: CLAUDE_AGENTS_ASSETS_VERSION,
      };
      changed = true;
    } else if (plan.status === "adopted" || plan.status === "in-sync") {
      if (plan.status === "adopted") {
        notes.push(`${plan.roleId}: registrado (arquivo == asset — adotado sem escrita)`);
      }
      const record: ClaudeAgentRecord = {
        installedAt: plan.registered?.installedAt ?? new Date().toISOString(),
        harnessVersion: plan.registered?.harnessVersion ?? version,
        contentHash: plan.assetHash,
        assetVersion: plan.registered?.assetVersion ?? CLAUDE_AGENTS_ASSETS_VERSION,
      };
      const previous = plan.registered;
      if (
        previous === undefined ||
        previous.contentHash !== record.contentHash ||
        previous.assetVersion !== record.assetVersion
      ) {
        changed = true;
      }
      claudeAgents[plan.roleId] = record;
    } else {
      // edited — NUNCA reescreve (F19 D7). O registro antigo permanece (a
      // detecção vN→vM continua válida p/ um futuro revert do usuário).
      notes.push(`${plan.roleId}: preservado (editado — usuário editou; sync nunca sobrescreve)`);
    }
  }
  return { copied, changed, notes };
}

// ---------------------------------------------------------------------------
// Validação dos assets (fail-closed — espelho do validateRoleAssets F32)
// ---------------------------------------------------------------------------

export interface Frontmatter {
  [key: string]: string;
}

export interface ClaudeAgentValidationResult {
  ok: boolean;
  errors: string[];
}

/** Parser mínimo de frontmatter FLAT (`key: value` — agent files do Claude
 *  usam só chaves flat; sem YAML em runtime, zero deps). */
export function parseClaudeFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
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
  }
  return { frontmatter, body: content.slice(endIndex + 4).trim() };
}

/** Parsing dos tools do frontmatter (lista comma — mesmo formato do Claude). */
export function parseClaudeToolList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Validação de UM arquivo de papel Claude (puro — usado pelos unit tests e
 *  evals): name == papel, description presente, tools == CLAUDE_ROLE_TOOLS
 *  (exato, ordem-independente), tools ⊆ vocabulário verificado, keys ⊆
 *  frontmatter conhecido, só o builder com a tool Agent (QA-5), deny-list
 *  RPG ausente do frontmatter E do corpo. */
export function validateClaudeAgentFile(
  roleId: RoleId,
  content: string,
  errors: string[] = [],
): boolean {
  const label = `${roleId}.md`;
  const { frontmatter, body } = parseClaudeFrontmatter(content);
  const name = frontmatter.name;
  if (name !== roleId) {
    errors.push(`${label}: frontmatter.name "${name ?? "(ausente)"}" != "${roleId}"`);
  }
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    errors.push(`${label}: frontmatter.description ausente (o Claude não delega para agentes sem description)`);
  }
  const tools = parseClaudeToolList(frontmatter.tools);
  const expected = CLAUDE_ROLE_TOOLS[roleId].slice().sort();
  const actual = tools.slice().sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: tools [${tools.join(", ")}] != allowlist esperada [${CLAUDE_ROLE_TOOLS[roleId].join(", ")}]`);
  }
  for (const tool of tools) {
    if (!(CLAUDE_TOOL_VOCABULARY as readonly string[]).includes(tool)) {
      errors.push(`${label}: tool "${tool}" fora do vocabulário verificado do Claude Code`);
    }
  }
  for (const key of Object.keys(frontmatter)) {
    if (!CLAUDE_FRONTMATTER_KEYS.has(key)) {
      errors.push(`${label}: key de frontmatter desconhecida "${key}" (o Claude ignora com erro no debug log — catálogo falha)`);
    }
  }
  const hasAgent = tools.includes(CLAUDE_DELEGATION_TOOL);
  if (roleId === "builder" && !hasAgent) {
    errors.push(`${label}: builder exige a tool ${CLAUDE_DELEGATION_TOOL} (único papel delegador — QA-5)`);
  }
  if (roleId !== "builder" && hasAgent) {
    errors.push(`${label}: papel não-delegador NÃO pode ter a tool ${CLAUDE_DELEGATION_TOOL} (fail-closed — QA-5)`);
  }
  for (const term of RPG_DENY_LIST) {
    const haystack = `${JSON.stringify(frontmatter)} ${body}`.toLowerCase();
    if (haystack.includes(term)) {
      errors.push(`${label}: termo proibido "${term}" presente no conteúdo`);
    }
  }
  return errors.length === 0;
}

/** Valida os 7 arquivos do diretório de assets (fail-closed — D3/edge
 *  "frontmatter inválido"). */
export function validateClaudeAgentAssets(assetsDir: string): ClaudeAgentValidationResult {
  const errors: string[] = [];
  for (const roleId of ROLE_IDS) {
    const filePath = path.join(assetsDir, `${roleId}.md`);
    let content: string | null = null;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      errors.push(`${roleId}.md: arquivo ausente em ${assetsDir}`);
      continue;
    }
    validateClaudeAgentFile(roleId, content, errors);
  }
  return { ok: errors.length === 0, errors };
}
