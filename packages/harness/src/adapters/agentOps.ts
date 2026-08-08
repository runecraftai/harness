// adapters/agentOps.ts — orchestration of non-Pi agent install/uninstall
// (F15 fluxos; F17 D5/D6 formalizam a matriz e o sync).
//
// installAgents: detect → fail-closed (comando display-only) → detect-only
// report → inject por agente (regras + MCP) → state agents.<id>.targets.
// uninstallAgents: backup dos alvos registrados → remove só o gerenciado
// (D6/D7) → state cleanup. Falha de config isola o agente (D2).
import * as fs from "node:fs";
import { ADAPTERS, DETECT_ONLY_GUIDES, genericDetectOnlyGuide, resolveAgentId } from "./registry.ts";
import { RULES_SECTION, upsertSection, removeSection, listRulesSectionIds } from "./rules.ts";
import { renderWorkflowRules, WORKFLOW_RULES_VERSION } from "./rulesContent.ts";
import { resolveMcpBin, UpstreamReferenceError } from "./mcpConfig.ts";
import { readJsonConfig } from "./jsonc.ts";
import { upsertAgent, type AgentRecord, type AgentTarget, type HarnessState } from "../state.ts";
import { MATRIX, type ComponentId, type MatrixAgentId } from "../matrix.ts";
import { sectionContentHash } from "../sections.ts";
import type { AgentAdapter, AgentContext, AgentId, DetectResult, InjectResult } from "./types.ts";
import type { Runtime, Scope } from "../config.ts";

export interface AgentInstallOutcome {
  agentId: string;
  status: "installed" | "failed" | "detect-only";
  /** written files (installed) or guide (detect-only). */
  detail: string[];
  error?: string;
}

export interface AgentUninstallOutcome {
  agentId: string;
  status: "removed" | "failed" | "not-managed";
  detail: string[];
  error?: string;
}

/** Shared per-agent context builder (rules content + MCP resolution). */
function buildContext(adapter: AgentAdapter, rt: Runtime, registered: AgentRecord | undefined): AgentContext {
  // F31 QA-2/D4: o host MCP do Copilot REUSA @runecraft/taskflow-claude
  // (servidor MCP stdio genérico — resolveMcpBin("claude"); nunca inventar
  // @runecraft/taskflow-copilot).
  const host = adapter.id === "claude-code" || adapter.id === "copilot" ? "claude" : adapter.id;
  const mcp = resolveMcpBin(host, rt);
  return {
    rt,
    mcpBin: mcp.command[mcp.command.length - 1] ?? "",
    mcpBinCommand: mcp.command,
    rulesContent: renderWorkflowRules(adapter.id),
    mcpArgs: [],
    targets: registered?.targets ?? [],
  };
}

/** Detect-only report for agents without an adapter (never fails — F17 D4). */
export function detectOnlyReport(agentId: string): { agentId: string; guide: string } {
  return { agentId, guide: DETECT_ONLY_GUIDES[agentId] ?? genericDetectOnlyGuide(agentId) };
}

/**
 * Targets to register after an inject (F17 D2, shared install/sync): rules
 * when written (or the previous registration survives a no-op rerun), mcp
 * when written without conflict (or the fingerprint still matches the
 * registered one). A foreign entry (conflict D5) is never registered as ours.
 */
export function buildAgentTargets(
  adapter: AgentAdapter,
  rt: Runtime,
  ctx: AgentContext,
  result: InjectResult,
  registered: AgentRecord | undefined,
): AgentTarget[] {
  const paths = adapter.paths(rt);
  const targets: AgentTarget[] = [];
  const rulesWritten = result.written.includes(paths.rulesFile);
  const rulesTarget = registered?.targets.find((t) => t.kind === "rules");
  if (rulesWritten) {
    if (fs.existsSync(paths.rulesFile)) {
      targets.push({
        kind: "rules",
        component: "rules",
        file: paths.rulesFile,
        section: RULES_SECTION,
        contentHash: sectionContentHash(RULES_SECTION, ctx.rulesContent),
        rulesVersion: WORKFLOW_RULES_VERSION,
      });
    }
  } else if (rulesTarget && fs.existsSync(rulesTarget.file)) {
    targets.push(rulesTarget); // rerun: registro prévio preservado
  }
  const mcpWritten = result.written.includes(paths.mcpFile) && result.conflicts.length === 0;
  const mcpTarget = registered?.targets.find((t) => t.kind === "mcp");
  const mcpFingerprint = adapter.readMcpFingerprint(rt);
  if (mcpWritten) {
    targets.push({
      kind: "mcp",
      component: "taskflow",
      file: paths.mcpFile,
      entry: paths.mcpKey,
      bin: ctx.mcpBin,
      contentHash: mcpFingerprint ?? "",
    });
  } else if (mcpTarget && mcpTarget.contentHash === mcpFingerprint) {
    targets.push(mcpTarget); // rerun: entry nossa ainda no lugar
  }
  // Preserva targets registrados sem célula na matriz atual (órfãos — F17 D6:
  // re-inject nunca remove; remoção é contrato do uninstall). Sem isso o
  // rerun/sync dropa o órfão do state e check 13/status "órfã" param de
  // reportar, contradizendo a mensagem "não removido".
  const orphans = (registered?.targets ?? []).filter(
    (t) => MATRIX[adapter.id as MatrixAgentId]?.[t.component as ComponentId] === undefined,
  );
  for (const orphan of orphans) {
    if (!targets.includes(orphan)) targets.push(orphan);
  }
  return targets;
}

/**
 * Install one non-Pi agent. Returns the outcome; throws never (failures are
 * reported per agent — D2). `failClosed` is set when the binary is missing.
 */
export async function installAgent(
  agentId: AgentId,
  rt: Runtime,
  scope: Scope,
  state: HarnessState,
): Promise<AgentInstallOutcome> {
  const adapter = ADAPTERS[agentId];
  const detect: DetectResult = await adapter.detect(rt);
  if (!detect.installed) {
    // F31 D6: copilot detecta por bin 'code'/'code-insiders' OU extensão
    // github.copilot* — o hint reflete a detecção honesta (não só o bin).
    const detectedBy =
      agentId === "copilot"
        ? "sem bin 'code'/'code-insiders' no PATH nem extensão github.copilot*"
        : `binário '${adapter.bin}' ausente do PATH`;
    return {
      agentId,
      status: "failed",
      detail: [],
      error: `agente '${agentId}' não detectado (${detectedBy}). Instale com: ${adapter.installHint} (display-only — o harness nunca instala runtimes).`,
    };
  }
  try {
    const registered = state.agents[agentId];
    const ctx = buildContext(adapter, rt, registered);
    const result = await adapter.inject(ctx);
    // State registration (F17 D2): rules target + mcp target. O target mcp é
    // registrado quando (a) o inject escreveu sem conflito, OU (b) rerun:
    // nada mudou (written vazio) mas o fingerprint atual ainda bate com o
    // registrado — re-registra para manter o registro vivo. Entry estrangeira
    // (conflito D5) nunca é registrada como nossa — uninstall não a remove.
    const targets = buildAgentTargets(adapter, rt, ctx, result, registered);
    const record: AgentRecord = {
      installedAt: registered?.installedAt ?? new Date().toISOString(),
      harnessVersion: registered?.harnessVersion ?? "0.1.0",
      targets,
    };
    if (targets.length > 0) upsertAgent(state, agentId, record);
    else delete state.agents[agentId]; // nada nosso restante (conflito total) — não registra
    return { agentId, status: "installed", detail: [...result.written, ...result.conflicts.map((c) => `conflito: ${c.file} (${c.reason})`)] };
  } catch (error) {
    if (error instanceof UpstreamReferenceError) {
      return { agentId, status: "failed", detail: [], error: error.message };
    }
    return { agentId, status: "failed", detail: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Uninstall one non-Pi agent: removes only what the state registers as ours
 * (D6/D7). Never touches foreign content. State record dropped at the end.
 */
export async function uninstallAgent(
  agentId: AgentId,
  rt: Runtime,
  state: HarnessState,
): Promise<AgentUninstallOutcome> {
  const registered = state.agents[agentId];
  if (!registered) {
    return { agentId, status: "not-managed", detail: [`agente '${agentId}' não está registrado no state — nada a remover.`] };
  }
  const adapter = ADAPTERS[agentId];
  try {
    const ctx = buildContext(adapter, rt, registered);
    const result = await adapter.remove(ctx);
    delete state.agents[agentId];
    // F18 MXST-02: marcador runecraft: no arquivo SEM registro no state →
    // preservado + reportado (modo conservador — sem evidência, não remove).
    const preservedUnregistered: string[] = [];
    for (const id of listRulesSectionIds(adapter.paths(rt).rulesFile)) {
      if (!registered.targets.some((t) => t.kind === "rules" && t.section === id)) {
        preservedUnregistered.push(`preservado (sem registro): seção ${id} em ${adapter.paths(rt).rulesFile}`);
      }
    }
    return {
      agentId,
      status: "removed",
      detail: [
        ...result.removed.map((f) => `removido: ${f}`),
        ...result.deleted.map((f) => `arquivo removido (ficou vazio): ${f}`),
        ...result.edited.map((e) => `preservado (editado pelo usuário): ${e.file} (${e.entry})`),
        ...result.preserved.map((f) => `preservado: ${f}`),
        ...result.conflicts.map((c) => `conflito: ${c.file} (${c.reason})`),
        ...preservedUnregistered,
      ],
    };
  } catch (error) {
    return { agentId, status: "failed", detail: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Resolve an --agent list into supported ids + detect-only ids. */
export function parseAgentArgs(values: string[]): { supported: AgentId[]; detectOnly: string[]; unknown: string[] } {
  const supported: AgentId[] = [];
  const detectOnly: string[] = [];
  const unknown: string[] = [];
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const id = part.trim();
      if (!id) continue;
      const resolved = resolveAgentId(id);
      if (resolved) supported.push(resolved);
      else if (DETECT_ONLY_GUIDES[id]) detectOnly.push(id);
      else unknown.push(id);
    }
  }
  return { supported: [...new Set(supported)], detectOnly: [...new Set(detectOnly)], unknown: [...new Set(unknown)] };
}
