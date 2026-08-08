// eval/targets/single-turn-agent.ts — target single-turn-agent (F26, D3).
//
// Sessão SDK in-process (helpers/sdkSession.ts — F21) + fixture
// ScriptedScenario → trace + tool registry. A resolução do target é leve
// (valida/normaliza o perfil da sessão); o executor trajectory-run é quem
// monta a sessão (precisa do cenário carregado — scenarioRef do executor)
// e produz os artifacts (trace/toolPolicy/modelOutput). agent default
// "main" (RUNECRAFT_AGENT_ID do F24 — sem agentes guild pré-F32).
import type { ResolvedTarget, SingleTurnAgentTarget } from "../types.ts";

export const DEFAULT_SESSION_AGENT = "main" as const;

export function resolveSingleTurnAgentTarget(target: SingleTurnAgentTarget): ResolvedTarget {
  const agent = target.agent.trim().length > 0 ? target.agent : DEFAULT_SESSION_AGENT;
  return {
    target: { ...target, agent },
    artifacts: {
      agentMetadata: {
        agent,
        description: "in-process SDK session (helpers/sdkSession.ts — F21 fixture)",
        sourceKind: "default",
      },
    },
  };
}
