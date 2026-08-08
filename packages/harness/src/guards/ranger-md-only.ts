// guards/ranger-md-only.ts — GUARD-03 (F24, D4/D5).
//
// Port do `ranger-md-only` do guild (OpenCode): agentes da lista
// `guards.rangerMdOnly.options.mdOnlyAgents` só podem escrever arquivos `.md`
// (case-insensitive — edge da spec: `.MD`/`.Markdown` contam como `.md`).
// v1 (D5): lista vazia por default → guard ATIVO mas inerte (nada bloqueia);
// o F32 registra o papel auditor na lista.
//
// "Agente atual": o Pi não expõe o nome do agente na sessão (validado no
// Execute — ExtensionContext não tem agent identity); o harness controla a
// identidade via `RUNECRAFT_AGENT_ID` (convenção RUNECRAFT_*, mesmo padrão
// do F20/F21). Ausente → agente "main" (sessão principal) — só entra na
// política se listado. Config inválida → fail-closed (D10): TODO agente é
// tratado como md-only (bloqueia, não libera) e o doctor reporta.
import * as path from "node:path";
import { block, type GuardRuntime } from "./guardKit.ts";

export const RANGER_GUARD_ID = "rangerMdOnly" as const;

export const MD_EXTENSIONS = new Set([".md", ".markdown"]);

/** Agente "atual" da sessão (D5): env do harness; default "main". */
export function currentAgentId(env: NodeJS.ProcessEnv): string {
  const raw = env.RUNECRAFT_AGENT_ID?.trim();
  return raw && raw.length > 0 ? raw : "main";
}

/** Extensão do alvo normalizada (case-insensitive): "x.MD" → ".md". */
export function targetExtension(inputPath: string): string {
  return path.extname(inputPath).toLowerCase();
}

/**
 * Decisão pura do ranger (evento fake → decisão). `undefined` = passa.
 * - config inválida → fail-closed: todo agente md-only (D10)
 * - agente não listado → passa (AC 2.2)
 * - extensão ∈ {md, markdown} case-insensitive → passa (AC 2.3)
 * - lista vazia (default v1) → nada bloqueia (AC 2.4)
 */
export function decideRangerMdOnly(
  cfg: GuardRuntime,
  agentId: string,
  inputPath: string,
): { block: true; reason: string } | undefined {
  if (!cfg.enabled) return undefined; // AC 3.4: guard desabilitado não intervém
  const options = cfg.options as { mdOnlyAgents: string[] };
  const listed = cfg.valid ? options.mdOnlyAgents : ["*"]; // fail-closed: todos
  if (!listed.includes(agentId) && !listed.includes("*")) return undefined;

  const ext = targetExtension(inputPath);
  if (MD_EXTENSIONS.has(ext)) return undefined;

  return {
    block: true,
    reason: block(
      RANGER_GUARD_ID,
      `write blocked for agent ${agentId}: only .md files are allowed (${ext || "sem extensão"} não é .md — regra runecraft:workflow: documentação/auditoria não escreve código)`,
    ).reason,
  };
}
