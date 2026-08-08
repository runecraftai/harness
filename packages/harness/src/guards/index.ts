// guards/index.ts — registry dos execution guards (F24, D1).
//
// Espelho do `create-hooks.ts` do guild: um registro central instala os
// guards como handlers do Pi (`installGuards(pi)`); um guard novo = um
// arquivo novo + uma linha aqui. Ordem de registro documentada (D1):
//   1. write-existing-file-guard  — sobrescrita destrutiva (maior dano)
//   2. ranger-md-only             — escopo de escrita (write + edit)
//   3. todo-description-override  — reescrita do input (nunca bloqueia)
//   4. todo-continuation-enforcer — gate de conclusão (complete_goal)
// O runner do Pi (validado no Execute — runner.js emitToolCall) interrompe
// no PRIMEIRO `{ block: true }`; um guard que bloqueia impede os seguintes
// de rodar para aquele evento — ordem entre guards de bloqueio só importa
// entre write e ranger (write primeiro: a existência é o dano irreversível).
//
// Config (D2): lida do state.json (F13) no `session_start` e CONGELADA para
// a sessão (D12) — mudança de config no meio da sessão não gera drift.
// Kill switch `RUNECRAFT_GUARDS=0` (F20) → todos os guards inativos (AC 1.4).
// Config inválida de UM guard não desliga os outros (D10 — validação isolada
// no guardKit; o guard afetado opera fail-closed: bloqueia, não libera).
import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { SessionGuardConfig, guardLog } from "./guardKit.ts";
import { decideWriteGuard } from "./write-existing-file-guard.ts";
import { decideRangerMdOnly, currentAgentId } from "./ranger-md-only.ts";
import { rewriteTodoInput, TODO_WRITE_TOOL } from "./todo-description-override.ts";
import { decideTodoEnforcer, TODO_COMPLETE_TOOL } from "./todo-continuation-enforcer.ts";
import { SessionVerifyConfig } from "../verify/config.ts";
import { configInvalidReason, runSessionVerification } from "../verify/engine.ts";
import type { VerifyDeps } from "../verify/types.ts";

export interface GuardsDeps {
  /** env override (testes) — default process.env */
  env?: NodeJS.ProcessEnv;
  /** identidade do agente atual (testes) — default RUNECRAFT_AGENT_ID ?? "main" */
  getAgentId?: () => string | undefined;
  /** F25: deps injetáveis da cascata de verificação (testes — fake judge/runner). */
  verify?: VerifyDeps;
}

/**
 * Registra os 4 guards no Pi (D1). Carregado apenas em sessões gerenciadas
 * pelo harness (D8): a extensão é materializada no agentDir pelo mecanismo
 * H1/F6 (settings.json `extensions` com paths absolutos — validado no F21).
 */
export function installGuards(pi: ExtensionAPI, deps: GuardsDeps = {}): void {
  const env = deps.env ?? process.env;
  const sessionConfig = new SessionGuardConfig(env);
  const verifyConfig = new SessionVerifyConfig(env);

  pi.on("session_start", (_event, ctx) => {
    // D12: config congelada por sessão — lida aqui, mantida durante a sessão.
    sessionConfig.capture(ctx.cwd);
    verifyConfig.capture(ctx.cwd);
    const frozen = sessionConfig.frozen(ctx.cwd);
    for (const problem of frozen.problems) guardLog.warn(`config: ${problem}`);
    const verify = verifyConfig.frozen(ctx.cwd);
    for (const problem of verify.problems) guardLog.warn(`config (verification): ${problem}`);
  });

  pi.on("tool_call", async (event, ctx) => {
    const frozen = sessionConfig.frozen(ctx.cwd);
    if (frozen.killSwitch) return undefined; // AC 1.4: RUNECRAFT_GUARDS=0 → tudo inativo

    // 1. write-existing-file-guard (GUARD-01/02) — apenas `write` (ver o
    //    escopo no módulo: edit não cria arquivos — bloqueá-lo negaria correção).
    if (isToolCallEventType("write", event)) {
      const cfg = frozen.guards.writeExistingFile;
      if (cfg.enabled) {
        const decision = decideWriteGuard(cfg, ctx.cwd, event.input.path);
        if (decision) {
          guardLog.debug(`blocked: ${decision.reason}`);
          return decision;
        }
      }
    }

    // 2. ranger-md-only (GUARD-03) — write + edit (escopo de escrita, original do guild).
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const cfg = frozen.guards.rangerMdOnly;
      if (cfg.enabled) {
        const agentId = deps.getAgentId?.() ?? currentAgentId(env);
        const decision = decideRangerMdOnly(cfg, agentId, event.input.path);
        if (decision) {
          guardLog.debug(`blocked: ${decision.reason}`);
          return decision;
        }
      }
    }

    // 3. todo-description-override (GUARD-04) — reescrita do input (AC 3.1);
    //    nunca bloqueia. O tool executa com o input reescrito.
    if (isToolCallEventType(TODO_WRITE_TOOL, event)) {
      const cfg = frozen.guards.todoDescriptionOverride;
      if (cfg.enabled) {
        rewriteTodoInput(event.input as { tasks?: unknown });
        guardLog.debug(`${TODO_WRITE_TOOL} input rewritten to canonical "Done when" format`);
      }
    }

    // 4. todo-continuation-enforcer (GUARD-05) — gate de conclusão (AC 3.2/3.3).
    if (isToolCallEventType(TODO_COMPLETE_TOOL, event)) {
      // F24 PRIMEIRO (D11 — ordem determinística): pendências bloqueiam antes
      // da cascata (o gate mais barato/duro; bloqueou, não gasta a verificação).
      const cfg = frozen.guards.todoContinuationEnforcer;
      if (cfg.enabled) {
        const decision = decideTodoEnforcer(cfg, ctx.cwd);
        if (decision) {
          guardLog.debug(`blocked: ${decision.reason}`);
          return decision;
        }
      }

      // F25 (D11 — aditivo, mesmo ponto de registro): cascata de verificação.
      const verify = verifyConfig.frozen(ctx.cwd);
      if (!verify.killSwitch) {
        if (verify.config === undefined) {
          // Config inválida → fail-closed (D9): bloqueia com o motivo nomeando
          // os campos; o doctor reporta e o CLI sai 3 (mesma engine).
          const reason = configInvalidReason(verify.problems);
          guardLog.warn(`verification config invalid — blocking: ${verify.problems.join("; ")}`);
          return { block: true, reason };
        }
        if (verify.config.enabled) {
          const result = await runSessionVerification({
            cwd: ctx.cwd,
            env,
            config: verify.config,
            input: (event.input ?? {}) as Record<string, unknown>,
            deps: deps.verify,
          });
          if (result.block && result.reason !== null) {
            guardLog.debug(`blocked (verification): ${result.reason}`);
            return { block: true, reason: result.reason };
          }
        }
      }
    }

    return undefined;
  });
}

/** Tipo auxiliar para handlers de teste (evento fake do tool_call). */
export type { ToolCallEvent, ExtensionContext };
