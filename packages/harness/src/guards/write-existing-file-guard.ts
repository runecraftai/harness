// guards/write-existing-file-guard.ts — GUARD-01/02 (F24, D3/D4).
//
// Port do `write-existing-file-guard` do guild (OpenCode) para o Pi:
// no guild o guard era um aviso no prompt que a LLM podia ignorar; aqui o
// `tool_call` do `write` é BLOQUEADO de verdade com `{ block: true, reason }`
// quando o alvo já existe — a sobrescrita destrutiva (whole-file) é impedida
// antes de executar. `allow` (paths relativos) e `force` (libera tudo) no
// config (D2) são a autorização explícita (AC 1.2).
//
// Escopo: apenas o tool `write`. O `edit` é um mutation direcionado de
// arquivo EXISTENTE (o tool não cria arquivos — pré-condição de existência) —
// bloquear todo edit seria negar a capacidade de corrigir código, não um
// guard (validado no Execute contra o write.js/edit.js do SDK 0.81.0). O
// ranger-md-only cobre write+edit (escopo de escrita — original do guild).
//
// Symlink (edge da spec): o alvo é resolvido via realpath antes da checagem
// de existência — um symlink apontando para um arquivo existente BLOQUEIA
// (sem bypass). Reason (D3): `<guardId>: <mensagem>` com o path RELATIVO ao
// cwd da sessão, nunca absoluto, nunca timestamp.
import * as fs from "node:fs";
import * as path from "node:path";
import { block, relPath, type GuardRuntime } from "./guardKit.ts";

export const WRITE_GUARD_ID = "writeExistingFile" as const;

export interface WriteDecision {
  block: true;
  reason: string;
}

/**
 * Resolve o alvo real do write (edge symlink): o dirname é realpath-ado
 * (diretórios symlinkados), e o próprio alvo também quando é um symlink.
 * Path inexistente (pai ausente) → { exists: false } (criação passa — AC 1.3).
 */
export function resolveWriteTarget(cwd: string, inputPath: string): { absolute: string; exists: boolean } {
  const joined = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
  let realParent: string;
  try {
    realParent = fs.realpathSync(path.dirname(joined));
  } catch {
    return { absolute: joined, exists: false };
  }
  const real = path.join(realParent, path.basename(joined));
  let target = real;
  try {
    target = fs.realpathSync(real);
  } catch {
    // não é symlink (ou link quebrado) — mantém o path real para a checagem
  }
  return { absolute: target, exists: fs.existsSync(target) };
}

/** O path está na allowlist (paths relativos normalizados — D2 options.allow). */
export function isAllowedOverwrite(cfg: GuardRuntime, cwd: string, inputPath: string): boolean {
  const options = cfg.options as { allow: string[]; force: boolean };
  if (options.force) return true;
  const rel = relPath(cwd, inputPath);
  return options.allow.some((allowed) => normalizeAllowPath(allowed) === rel);
}

function normalizeAllowPath(allowed: string): string {
  return allowed.trim().replace(/^\.\//, "").split(path.sep).join("/");
}

/**
 * Decisão pura do write guard (evento fake → decisão). `undefined` = passa.
 * - config inválida → fail-closed (D10): sem allow/force, bloqueia existente
 * - alvo existe → block com reason citando o guard e o path relativo (AC 1.1/D3)
 * - alvo novo → passa (AC 1.3)
 * - allow/force → passa (AC 1.2)
 */
export function decideWriteGuard(cfg: GuardRuntime, cwd: string, inputPath: string): WriteDecision | undefined {
  if (!cfg.enabled) return undefined; // AC 3.4: guard desabilitado não intervém
  const target = resolveWriteTarget(cwd, inputPath);
  if (!target.exists) return undefined;
  if (cfg.valid && isAllowedOverwrite(cfg, cwd, inputPath)) return undefined;
  const rel = relPath(cwd, inputPath);
  return {
    block: true,
    reason: block(
      WRITE_GUARD_ID,
      `write blocked — target already exists: ${rel} (overwrite requires allow/force in the harness guards config)`,
    ).reason,
  };
}
