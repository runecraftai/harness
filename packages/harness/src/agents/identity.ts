// agents/identity.ts — ponte de identidade do agente (F32, D7 — ROLE-07).
//
// Validado no Execute F32: o fork `@runecraft/subagents` NÃO seta
// `RUNECRAFT_AGENT_ID` por dispatch de agente — ele seta
// `PI_SUBAGENT_CHILD_AGENT=<agent>` no env do child (pi-args.ts:26/354,
// lido no Execute). O guard ranger-md-only do F24 lê `RUNECRAFT_AGENT_ID`
// (currentAgentId — ranger-md-only.ts:24) e a observabilidade idem
// (observability.ts:188). A bridge documentada no design (adendo
// before_agent_start do F28 — SEM tocar o guard) traduz a identidade do
// child do fork para o env que o harness lê, no `before_agent_start` do
// child (o child carrega as extensões do harness do agentDir compartilhado).
//
// Semântica: o child do fork É o papel — a identidade do child VENCE o env
// herdado do pai (o RUNECRAFT_AGENT_ID do pai não vaza para o filho).
//
// Módulo PURO (F21 D10) — `env` injetável (testes).
export const FORK_CHILD_AGENT_ENV = "PI_SUBAGENT_CHILD_AGENT";

/** Id do agente do child do fork (env do fork); trim; vazio → undefined. */
export function forkChildAgentId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[FORK_CHILD_AGENT_ENV]?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Aplica a ponte num env in-place; devolve o id propagado (undefined quando
 *  o env não é de um child do fork — sessão principal, nada a fazer). */
export function propagateForkAgentIdentity(env: NodeJS.ProcessEnv): string | undefined {
  const id = forkChildAgentId(env);
  if (id !== undefined) env.RUNECRAFT_AGENT_ID = id;
  return id;
}
