// eval/targets/prompt-render.ts — target prompt-render (F26, D3).
//
// Mapeamento do builtin-agent-target do arcanum → harness: o ÚNICO prompt
// builtin do harness é a seção `runecraft:workflow` renderizada por
// renderRules() do F19 (rulesContent.ts — a fonte de verdade; os goldens do
// F23 já cobrem o render — D3: zero cases v1; consumidores pós-F30/F32).
// Artifacts no shape do arcanum: renderedPrompt + promptLength +
// agentMetadata (sourceKind "default" — sem composer no harness v1).
import { renderRules } from "../../adapters/rulesContent.ts";
import type { MatrixAgentId } from "../../matrix.ts";
import type { EvalArtifacts, ExecutionContext, ExecutorSpec, PromptRenderTarget, ResolvedTarget } from "../types.ts";

/** Agentes da matriz aceitos pelo target (F17). */
const MATRIX_AGENTS = ["pi", "claude-code", "opencode", "codex"] as const;

export function resolvePromptRenderTarget(target: PromptRenderTarget): ResolvedTarget {
  const agent = (target.agent ?? "pi") as MatrixAgentId;
  const renderedPrompt = renderRules(agent);
  return {
    target,
    artifacts: {
      renderedPrompt,
      promptLength: renderedPrompt.length,
      agentMetadata: {
        agent,
        description: "workflow rules section (runecraft:workflow — F19)",
        sourceKind: "default",
      },
    },
  };
}

/** Executor thin do arcanum (prompt-renderer.ts): devolve os artifacts do
 *  target com o promptLength garantido (D3 — o render vive no target). */
export async function executePromptRender(
  resolvedTarget: ResolvedTarget,
  executor: ExecutorSpec,
  _context: ExecutionContext,
): Promise<EvalArtifacts> {
  if (executor.kind !== "prompt-render") {
    throw new Error(`Executor ${executor.kind} is not implemented in Phase 1`);
  }
  return {
    ...resolvedTarget.artifacts,
    promptLength:
      resolvedTarget.artifacts.promptLength ?? resolvedTarget.artifacts.renderedPrompt?.length ?? 0,
  };
}

/** Ids de agente aceitos (para o schema/loader — hint de erro). */
export function isKnownMatrixAgent(value: unknown): value is MatrixAgentId {
  return typeof value === "string" && (MATRIX_AGENTS as readonly string[]).includes(value);
}
