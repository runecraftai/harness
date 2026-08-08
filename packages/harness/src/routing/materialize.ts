// routing/materialize.ts — materialização das pilot chains (F33, D4/T4;
// RTE-04).
//
// Alvo REUSADO do F30: `.pi/chains/` (o fork subagents descobre chains de
// <root>/.pi/chains/ — resolveNearestProjectChainDirs, agents.ts:1513; o F30
// já materializa as chains SDD lá — QA-3a: sem duplicação do alvo). As 5
// pilot chains de F33 (implement/plan/research/explore/security) são assets
// versionados em packages/harness/chains/ e materializadas com THREE-WAY por
// conteúdo (F19 D7) + contentHash no state (F13 — seção `piChains`). Órfãos
// reportados, nunca removidos (F18); fork ausente → dados inertes
// (status/doctor informam — matriz F17).
//
// Estados por arquivo (espelho do planRoleAgents do F32 — D7):
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

/** Nomes das 5 pilot chains (D4 — 1:1 com as rotas delegáveis com chain). */
export const PILOT_CHAIN_NAMES = ["implement", "plan", "research", "explore", "security"] as const;
export type PilotChainName = (typeof PILOT_CHAIN_NAMES)[number];

/** Versão do template dos assets (bump quando os .chain.md mudarem — vN→vM). */
export const PILOT_CHAIN_ASSETS_VERSION = "1" as const;

/** Diretório relativo das chains no projeto (.pi/chains — QA-3a: REUSO do
 *  alvo do F30). */
export const PILOT_CHAINS_REL_DIR = path.join(".pi", "chains");

/** Registro no state de UMA chain materializada (F13 — contentHash). */
export interface PilotChainRecord {
  installedAt: string;
  harnessVersion: string;
  /** sha256 do conteúdo do arquivo no ÚLTIMO sync/install (F13). */
  contentHash: string;
  /** versão do template asset naquele sync (F19 vN→vM). */
  assetVersion: string;
}

export type ChainFileStatus = "missing" | "in-sync" | "adopted" | "updated" | "edited";

export interface ChainFilePlan {
  name: PilotChainName;
  /** caminho absoluto do alvo (<cwd>/.pi/chains/<name>.chain.md). */
  file: string;
  assetHash: string;
  fileHash: string | null;
  registered: PilotChainRecord | undefined;
  status: ChainFileStatus;
}

/** Diretório de assets das pilot chains no pacote (injetável p/ teste). */
export function pilotChainsAssetsDir(root: string = packageRoot()): string {
  return path.join(root, "chains");
}

/** Diretório alvo no projeto (<cwd>/.pi/chains — alvo reusado do F30). */
export function pilotChainsDir(cwd: string): string {
  return path.join(cwd, PILOT_CHAINS_REL_DIR);
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

/** Lê o asset de uma chain; null quando ausente (asset sumiu do pacote). */
export function readPilotChainAsset(name: PilotChainName, root: string): string | null {
  try {
    return fs.readFileSync(path.join(pilotChainsAssetsDir(root), `${name}.chain.md`), "utf8");
  } catch {
    return null;
  }
}

/** Lê o arquivo materializado; null quando ausente. */
function readChainFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Planeja a reconciliação read-only das 5 pilot chains (three-way F19 D7).
 * Ordem determinística (PILOT_CHAIN_NAMES). Nunca escreve.
 */
export function planPilotChains(
  cwd: string,
  piChains: Record<string, PilotChainRecord> | undefined,
  root: string = packageRoot(),
): ChainFilePlan[] {
  const plans: ChainFilePlan[] = [];
  for (const name of PILOT_CHAIN_NAMES) {
    const asset = readPilotChainAsset(name, root);
    if (asset === null) continue; // asset ausente do pacote — chain não materializada
    const file = path.join(pilotChainsDir(cwd), `${name}.chain.md`);
    const assetHash = contentHash(asset);
    const fileContent = readChainFile(file);
    const fileHash = fileContent === null ? null : contentHash(fileContent);
    const registered = piChains?.[name];

    let status: ChainFileStatus;
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
    plans.push({ name, file, assetHash, fileHash, registered, status });
  }
  return plans;
}

export interface ApplyPilotChainsResult {
  /** arquivos copiados (missing + updated). */
  copied: string[];
  /** true quando o mapa de registros MUDOU (exige saveState — LIFE 3.2). */
  changed: boolean;
  notes: string[];
}

/**
 * Aplica o plano (writes only para missing/updated — F19 D7), atualiza o
 * registro `piChains` in-place e devolve notas para o reporte do CLI.
 * Nunca toca arquivos edited (F19 D7 — preserva + reporta).
 */
export function applyPilotChains(
  cwd: string,
  piChains: Record<string, PilotChainRecord>,
  plans: ChainFilePlan[],
  root: string = packageRoot(),
): ApplyPilotChainsResult {
  const copied: string[] = [];
  const notes: string[] = [];
  let changed = false;
  const version = harnessVersion();
  for (const plan of plans) {
    const asset = readPilotChainAsset(plan.name, root);
    if (asset === null) continue;
    if (plan.status === "missing" || plan.status === "updated") {
      fs.mkdirSync(path.dirname(plan.file), { recursive: true }); // precedente F32 materialize.ts
      fs.writeFileSync(plan.file, asset, "utf8");
      copied.push(`${plan.name}.chain.md`);
      notes.push(
        plan.status === "missing"
          ? `${plan.name}: re-injetado (ausente)`
          : `${plan.name}: atualizado (template ${plan.registered?.assetVersion ?? "?"}→${PILOT_CHAIN_ASSETS_VERSION})`,
      );
      piChains[plan.name] = {
        installedAt: new Date().toISOString(),
        harnessVersion: version,
        contentHash: plan.assetHash,
        assetVersion: PILOT_CHAIN_ASSETS_VERSION,
      };
      changed = true;
    } else if (plan.status === "adopted" || plan.status === "in-sync") {
      if (plan.status === "adopted") {
        notes.push(`${plan.name}: registrado (arquivo == asset — adotado sem escrita)`);
      }
      const record: PilotChainRecord = {
        installedAt: plan.registered?.installedAt ?? new Date().toISOString(),
        harnessVersion: plan.registered?.harnessVersion ?? version,
        contentHash: plan.assetHash,
        assetVersion: plan.registered?.assetVersion ?? PILOT_CHAIN_ASSETS_VERSION,
      };
      const previous = plan.registered;
      if (
        previous === undefined ||
        previous.contentHash !== record.contentHash ||
        previous.assetVersion !== record.assetVersion
      ) {
        changed = true;
      }
      piChains[plan.name] = record;
    } else {
      // edited — NUNCA reescreve (F19 D7). O registro antigo permanece (a
      // detecção vN→vM continua válida p/ um futuro revert do usuário).
      notes.push(`${plan.name}: preservado (editado — usuário editou; sync nunca sobrescreve)`);
    }
  }
  return { copied, changed, notes };
}
