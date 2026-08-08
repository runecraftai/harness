// agents/materialize.ts — materialização dos papéis objetivos (F32, D1/T5;
// ROLE-01).
//
// Alvo novo de install/sync: copia os 7 assets versionados
// (packages/harness/agents/*.md — espelho de packages/subagents/agents/) para
// <cwd>/.pi/agents/ (escopo PROJETO — QA-2a; o fork descobre agentes de
// <root>/.pi/agents/ — resolveNearestProjectAgentDirs, agents.ts:1493) com
// THREE-WAY por conteúdo (F19 D7) + contentHash no state (F13 — seção
// `piAgents`; shape validada no Execute — T5). Órfãos reportados, nunca
// removidos (F18); fork ausente → dados inertes (status/doctor informam —
// matriz F17).
//
// Estados por arquivo (espelho do planAgentReconciliation do F19 D7):
//   ausente           → missing  → copia (re-injetado)
//   arquivo == asset  → in-sync  (registrado == hash) | adopted (registra, sem write)
//   arquivo != asset  → updated (arquivo == registrado ≠ asset: template vN→vM,
//                       copia) | edited (arquivo ≠ registrado: usuário editou —
//                       NUNCA reescreve, preserva + reporta)
//
// Deterministismo (F21 D10): planos derivados só de conteúdo (sha256), sem
// $TMP/$TS em identidade.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ROLE_IDS, type RoleId } from "./catalog.ts";

/** Versão do template dos assets (bump quando os .md mudarem — F19 vN→vM). */
export const ROLE_ASSETS_VERSION = "1" as const;

/** Diretório relativo dos agentes de papel no projeto (.pi/agents — QA-2a). */
export const ROLE_AGENTS_REL_DIR = path.join(".pi", "agents");

/** Registro no state de UM papel materializado (F13 — contentHash). */
export interface RoleAgentRecord {
  installedAt: string;
  harnessVersion: string;
  /** sha256 do conteúdo do arquivo no ÚLTIMO sync/install (F13). */
  contentHash: string;
  /** versão do template asset naquele sync (F19 vN→vM). */
  assetVersion: string;
}

export type RoleFileStatus = "missing" | "in-sync" | "adopted" | "updated" | "edited";

export interface RoleFilePlan {
  roleId: RoleId;
  /** caminho absoluto do alvo (<cwd>/.pi/agents/<id>.md). */
  file: string;
  assetHash: string;
  fileHash: string | null;
  registered: RoleAgentRecord | undefined;
  status: RoleFileStatus;
}

/** Diretório de assets dos papéis no pacote (injetável p/ teste). */
export function roleAssetsDir(root: string = packageRoot()): string {
  return path.join(root, "agents");
}

/** Diretório alvo no projeto (<cwd>/.pi/agents). */
export function roleAgentsDir(cwd: string): string {
  return path.join(cwd, ROLE_AGENTS_REL_DIR);
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
export function readRoleAsset(roleId: RoleId, root: string): string | null {
  try {
    return fs.readFileSync(path.join(roleAssetsDir(root), `${roleId}.md`), "utf8");
  } catch {
    return null;
  }
}

/** Lê o arquivo materializado; null quando ausente. */
function readRoleFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Planeja a reconciliação read-only dos 7 papéis (three-way F19 D7).
 * Ordem determinística (ROLE_IDS). Nunca escreve.
 */
export function planRoleAgents(
  cwd: string,
  piAgents: Record<string, RoleAgentRecord> | undefined,
  root: string = packageRoot(),
): RoleFilePlan[] {
  const plans: RoleFilePlan[] = [];
  for (const roleId of ROLE_IDS) {
    const asset = readRoleAsset(roleId, root);
    if (asset === null) continue; // asset ausente do pacote — papel não materializado
    const file = path.join(roleAgentsDir(cwd), `${roleId}.md`);
    const assetHash = contentHash(asset);
    const fileContent = readRoleFile(file);
    const fileHash = fileContent === null ? null : contentHash(fileContent);
    const registered = piAgents?.[roleId];

    let status: RoleFileStatus;
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

export interface ApplyRoleAgentsResult {
  /** arquivos copiados (missing + updated). */
  copied: string[];
  /** true quando o mapa de registros MUDOU (exige saveState — LIFE 3.2). */
  changed: boolean;
  notes: string[];
}

/**
 * Aplica o plano (writes only para missing/updated — F19 D7), atualiza o
 * registro `piAgents` in-place e devolve notas para o reporte do CLI.
 * Nunca toca arquivos edited (F19 D7 — preserva + reporta).
 */
export function applyRoleAgents(
  cwd: string,
  piAgents: Record<string, RoleAgentRecord>,
  plans: RoleFilePlan[],
  root: string = packageRoot(),
): ApplyRoleAgentsResult {
  const copied: string[] = [];
  const notes: string[] = [];
  let changed = false;
  const version = harnessVersion();
  for (const plan of plans) {
    const asset = readRoleAsset(plan.roleId, root);
    if (asset === null) continue;
    if (plan.status === "missing" || plan.status === "updated") {
      fs.mkdirSync(path.dirname(plan.file), { recursive: true }); // precedente agent-management.ts:812
      fs.writeFileSync(plan.file, asset, "utf8");
      copied.push(`${plan.roleId}.md`);
      notes.push(
        plan.status === "missing"
          ? `${plan.roleId}: re-injetado (ausente)`
          : `${plan.roleId}: atualizado (template ${plan.registered?.assetVersion ?? "?"}→${ROLE_ASSETS_VERSION})`,
      );
      piAgents[plan.roleId] = {
        installedAt: new Date().toISOString(),
        harnessVersion: version,
        contentHash: plan.assetHash,
        assetVersion: ROLE_ASSETS_VERSION,
      };
      changed = true;
    } else if (plan.status === "adopted" || plan.status === "in-sync") {
      if (plan.status === "adopted") {
        notes.push(`${plan.roleId}: registrado (arquivo == asset — adotado sem escrita)`);
      }
      const record: RoleAgentRecord = {
        installedAt: plan.registered?.installedAt ?? new Date().toISOString(),
        harnessVersion: plan.registered?.harnessVersion ?? version,
        contentHash: plan.assetHash,
        assetVersion: plan.registered?.assetVersion ?? ROLE_ASSETS_VERSION,
      };
      const previous = plan.registered;
      if (
        previous === undefined ||
        previous.contentHash !== record.contentHash ||
        previous.assetVersion !== record.assetVersion
      ) {
        changed = true;
      }
      piAgents[plan.roleId] = record;
    } else {
      // edited — NUNCA reescreve (F19 D7). O registro antigo permanece (a
      // detecção vN→vM continua válida p/ um futuro revert do usuário).
      notes.push(`${plan.roleId}: preservado (editado — usuário editou; sync nunca sobrescreve)`);
    }
  }
  return { copied, changed, notes };
}
