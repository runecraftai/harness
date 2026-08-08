// verify/stages/integrity.ts — camada 2: integridade de arquivos (F25, D3/VER-03).
//
// Herança DIRETA do domínio do write-guard F24 (D3 — NENHUMA definição nova
// de "protegido"): conjunto protegido = arquivos RASTREADOS no HEAD do repo
// (o write-guard protege "arquivos existentes"; no momento da verificação o
// baseline determinístico disponível é o HEAD — "re-captura no momento da
// verificação", validado no Execute) menos as autorizações do F24
// (`guards.writeExistingFile.options.allow`/`force`).
//
// Violação = operação destrutiva que o write-guard não cobre (não há guard
// de delete no F24) ou que escapou do tool `write`:
//   - DELETE de arquivo protegido (D no working tree vs HEAD)
//   - SUBSTITUIÇÃO INTEGRAL (todo o conteúdo de HEAD substituído — numstat
//     added+deleted >= linhas do arquivo em HEAD; edição pontual passa)
// Symlink: o path do diff é realpath-ado antes da checagem (padrão F24 —
// um symlink apontando para alvo protegido NÃO faz bypass: a escrita através
// do link aparece no git como modificação do ALVO real, que é o protegido).
// Reason-id = GUARD_REASON_IDS do F24 (`write-existing-file-guard` — VER-03).
import * as fs from "node:fs";
import * as path from "node:path";
import { effectiveGuards, loadSessionGuards, type GuardRuntime } from "../../guards/guardKit.ts";
import { integrityFailReason } from "../suggestions.ts";
import type { RepoState } from "../repo.ts";
import type { StageResult } from "../verdict.ts";

export interface IntegrityStageInput {
  repo: RepoState;
  env: NodeJS.ProcessEnv;
}

/** Autorizações do write-guard F24 (allow/force) — herança, sem definição nova. */
export function writeGuardExemptions(cwd: string, env: NodeJS.ProcessEnv): { allow: string[]; force: boolean } {
  const merged = loadSessionGuards(cwd, env);
  const write = merged.guards.writeExistingFile as GuardRuntime;
  if (!write.valid) return { allow: [], force: false }; // config inválida → fail-closed (sem exceção)
  const options = write.options as { allow: string[]; force: boolean };
  return { allow: options.allow ?? [], force: options.force ?? false };
}

/** Normaliza um path de allow (relativo, sem "./"). */
function normalizeScope(p: string): string {
  return p.trim().replace(/^\.\//, "").split(path.sep).join("/");
}

/** realpath do alvo (symlink edge — padrão F24 resolveWriteTarget). */
export function realTarget(cwd: string, rel: string): string {
  const joined = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
  try {
    return fs.realpathSync(joined);
  } catch {
    return joined;
  }
}

/**
 * Camada 2 (D3): o diff do working tree vs HEAD é cruzado com o domínio
 * protegido. Sem diff (fora de repo git) → degraded (a integridade não pode
 * ser avaliada sem baseline — a cascata segue). Violação → fail com reason
 * F24; política default halt (QA-1 — integridade é guardrail HARD).
 */
export function integrityStage(input: IntegrityStageInput): StageResult {
  const diff = input.repo.diff;
  if (diff === null) {
    return {
      layer: "integrity",
      status: "degraded",
      reasonId: "write-existing-file-guard",
      reason: "fora de repositório git — baseline de integridade indisponível",
      suggestion: "rode dentro de um repo git para habilitar a checagem de integridade (sem essa evidência não é violação)",
    };
  }
  const exemptions = writeGuardExemptions(input.repo.cwd, input.env);
  if (exemptions.force) {
    return {
      layer: "integrity",
      status: "pass",
      reasonId: "write-existing-file-guard",
      reason: "force ativo no write-guard F24 — nenhum arquivo protegido",
      suggestion: "",
    };
  }
  const allow = exemptions.allow.map(normalizeScope);

  const isExempt = (file: string): boolean => {
    const normalized = normalizeScope(file);
    return allow.some((a) => normalized === a || normalized.startsWith(`${a}/`));
  };

  // 1) DELETES: arquivo protegido removido do working tree (realpath do alvo
  //    — symlink para alvo protegido conta, padrão F24).
  for (const file of diff.deleted) {
    const target = normalizeScope(relOf(input.repo.cwd, realTarget(input.repo.cwd, file)));
    if (isExempt(target) || isExempt(file)) continue;
    const reason = integrityFailReason(file, "deleted");
    return failStage(file, reason);
  }

  // 2) SUBSTITUIÇÃO INTEGRAL: numstat mostra o arquivo todo reescrito
  //    (added+deleted >= linhas em HEAD) — operação destrutiva que o guard
  //    de `write` bloquearia e que escapa por bash/outros caminhos.
  for (const file of diff.files) {
    if (isExempt(file)) continue;
    const head = diff.headLines[file];
    if (head === undefined || head <= 0) continue; // untracked/novo — não protegido
    const stats = diff.fileStats[file];
    if (stats === undefined) continue;
    if (stats.added + stats.deleted >= head) {
      const reason = integrityFailReason(file, "replaced");
      return failStage(file, reason);
    }
  }

  return {
    layer: "integrity",
    status: "pass",
    reasonId: "write-existing-file-guard",
    reason: `arquivos protegidos intactos (${diff.files.length} no diff)`,
    suggestion: "",
  };
}

function failStage(file: string, reason: string): StageResult {
  return {
    layer: "integrity",
    status: "fail",
    reasonId: "write-existing-file-guard",
    reason,
    suggestion: `restaure ${file} ou autorize a alteração via guards.writeExistingFile.options.allow`,
    detail: { file },
  };
}

/** Path relativo ao cwd de um alvo realpath-ado (nunca absoluto — F21 D10). */
function relOf(cwd: string, target: string): string {
  const rel = path.relative(cwd, target);
  if (rel === "") return ".";
  return rel.split(path.sep).join("/");
}

/** Re-export para o engine (config efetiva do write guard no mesmo shape do F24). */
export { effectiveGuards };
