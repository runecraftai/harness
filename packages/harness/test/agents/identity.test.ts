// agents/identity.test.ts — F32 T6 (ROLE-07): ponte de identidade do agente.
//
// Validado no Execute F32: o fork subagents NÃO seta RUNECRAFT_AGENT_ID por
// dispatch (seta PI_SUBAGENT_CHILD_AGENT no child — pi-args.ts:26/354). A
// bridge (adendo before_agent_start do F28 — design D7/fallback) traduz a
// identidade do child para o env que o harness lê (guard F24 currentAgentId).
import { describe, expect, test } from "bun:test";
import {
  FORK_CHILD_AGENT_ENV,
  forkChildAgentId,
  propagateForkAgentIdentity,
} from "../../src/agents/identity.ts";
import { currentAgentId } from "../../src/guards/ranger-md-only.ts";

describe("ponte de identidade (D7 — fork child → RUNECRAFT_AGENT_ID)", () => {
  test("forkChildAgentId lê PI_SUBAGENT_CHILD_AGENT (trim; vazio → undefined)", () => {
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "auditor" })).toBe("auditor");
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "  scout  " })).toBe("scout");
    expect(forkChildAgentId({})).toBeUndefined();
    expect(forkChildAgentId({ [FORK_CHILD_AGENT_ENV]: "" })).toBeUndefined();
  });

  test("propagateForkAgentIdentity: child do fork vence o env herdado do pai", () => {
    const env: NodeJS.ProcessEnv = { RUNECRAFT_AGENT_ID: "main", [FORK_CHILD_AGENT_ENV]: "auditor" };
    const propagated = propagateForkAgentIdentity(env);
    expect(propagated).toBe("auditor");
    // O guard F24 lê exatamente esse env (currentAgentId — ranger-md-only.ts).
    expect(currentAgentId(env)).toBe("auditor");
  });

  test("sem child do fork → nada a propagar (env intocado)", () => {
    const env: NodeJS.ProcessEnv = { RUNECRAFT_AGENT_ID: "main" };
    expect(propagateForkAgentIdentity(env)).toBeUndefined();
    expect(env.RUNECRAFT_AGENT_ID).toBe("main");
  });

  test("child sem identidade explícita do pai → auditor resolve no guard", () => {
    const env: NodeJS.ProcessEnv = { [FORK_CHILD_AGENT_ENV]: "auditor" };
    propagateForkAgentIdentity(env);
    expect(currentAgentId(env)).toBe("auditor");
  });
});
