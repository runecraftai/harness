// eval/executors/trajectory-run.ts — executa o cenário scriptado na sessão
// REAL e constrói o HarnessTrace do transcript (F26, D3/QA-2).
//
// SUBSTITUI o trajectory-run do arcanum (mock-text — "intentionally
// mock-backed and text-based", comentário no código-fonte): o harness
// replaya o ScriptedScenario do fixture F21 na sessão SDK in-process
// (helpers/sdkSession.ts) — a ESCOLHA do tool call é scriptada, a EXECUÇÃO
// é real (EVAL-006/007 provam o bloqueio real no loop do Pi). O trace é o
// transcript real (ChatServer.seen), não respostas canônicas.
//
// Diagnóstico adversarial (F24 T7 / F21 D7): se o fixture acumular
// diagnóstico (desvio induzido — ex.: guard off e o marcador de reason
// some da conversa), o executor FALHA com o diagnóstico do fixture (case
// vermelho com reason — nunca passa em silêncio).
//
// TEST-COUPLED POR DESIGN (fix cleric F26): este executor dirige o fixture
// do F21 (test/eval/) — é infra de teste, não superfície de runtime. O
// pacote publicado (files: bin/src/extensions/docs) NÃO inclui test/;
// guards/verify/CLI não importam este módulo. Se o publish precisar do
// framework sem o fixture (F9), este executor fica de fora da superfície
// (documentado em docs/EVAL-FRAMEWORK.md).
import type { SeenRequest } from "../../../test/eval/layer2/fixture/chatServer.ts";
import type { ScriptedScenario } from "../../../test/eval/layer2/fixture/scenarios.ts";
import { setupEvalFixture } from "../../../test/eval/helpers/evalFixture.ts";
import { EvalConfigError, loadScenario } from "../loader.ts";
import type {
  EvalArtifacts,
  ExecutionContext,
  ResolvedTarget,
  TrajectoryRunExecutor,
  TrajectoryTrace,
  TrajectoryTurnResult,
} from "../types.ts";

/** Prefixos de reason dos guards F24 (guardKit GUARD_REASON_IDS — estáveis,
 *  sem path absoluto/timestamp — F21 D10). O tool bloqueado é a palavra antes
 *  de " blocked" no reason (ex.: "write-existing-file-guard: write blocked — …"). */
const GUARD_BLOCKED_RE =
  /(write-existing-file-guard|ranger-md-only|todo-description-override|todo-continuation-enforcer):\s*([a-z_]+)\s+blocked/g;

/** Tool calls BLOQUEADOS pelos guards F24, na ordem de primeira aparição na
 *  conversa real (o reason aparece na conversa do request seguinte ao block). */
export function deriveBlockedTools(seen: readonly SeenRequest[]): string[] {
  const blocked: string[] = [];
  const seenTools = new Set<string>();
  for (const req of seen) {
    for (const match of req.conversationText.matchAll(GUARD_BLOCKED_RE)) {
      const tool = match[2];
      if (tool !== undefined && !seenTools.has(tool)) {
        seenTools.add(tool);
        blocked.push(tool);
      }
    }
  }
  return blocked;
}

/** Registry de tools da sessão: união dos tools vistos nos requests reais
 *  (tool-policy — enumeração validada no Execute: o fixture vê o registry
 *  exato que o SDK envia por request). */
export function deriveToolPolicy(seen: readonly SeenRequest[]): Record<string, boolean> {
  const policy: Record<string, boolean> = {};
  for (const req of seen) {
    for (const tool of req.tools) policy[tool] = true;
  }
  return policy;
}

/** HarnessTrace do transcript real (QA-2). delegationSequence = tool calls
 *  replayadas (replyTool do fixture); delegationTargets = tool calls
 *  BLOQUEADOS; turns.agent = agente da sessão ("main" — sem guild agents). */
export function buildHarnessTrace(scenarioId: string, seen: readonly SeenRequest[]): TrajectoryTrace {
  const delegationSequence: string[] = [];
  const turns: TrajectoryTurnResult[] = [];
  for (const req of seen) {
    if (req.replyTool !== null) delegationSequence.push(req.replyTool);
    turns.push({
      turn: req.n,
      agent: "main",
      role: "assistant",
      response: req.lastUserText,
      observedDelegation: req.replyTool,
      durationMs: 0, // determinismo D8: o fixture não mede timing por request
    });
  }
  return {
    scenarioId,
    turns,
    delegationSequence,
    delegationTargets: deriveBlockedTools(seen),
    totalTurns: seen.length,
    completedTurns: seen.length,
  };
}

export async function executeTrajectoryRun(
  resolvedTarget: ResolvedTarget,
  executor: TrajectoryRunExecutor,
  context: ExecutionContext,
): Promise<EvalArtifacts> {
  const scenario = await loadScenario(context.scenariosDir, executor.scenarioRef);

  // Perfil da sessão: target (single-turn-agent) > cenário > contexto.
  const target = resolvedTarget.target.kind === "single-turn-agent" ? resolvedTarget.target : undefined;
  const prompt = target?.input ?? scenario.prompt ?? "Execute the scripted task.";
  const beforeSession = target?.beforeSession ?? scenario.beforeSession ?? context.beforeSession;

  const fx = await setupEvalFixture({
    // O cenário é construído com o helper `script()` do fixture F21 nos
    // dados TS (test/eval/scenarios); o cast cobre o shape estrutural.
    scenario: scenario.scenario as unknown as ScriptedScenario,
    withRepo: scenario.withRepo ?? true,
    tools: target?.tools ?? scenario.tools,
    bindExtensions: target?.bindExtensions ?? scenario.bindExtensions,
    beforeSession,
  });

  try {
    await fx.session.session.prompt(prompt);

    // F24 T7 (fails loudly): desvio induzido → o fixture acumula diagnóstico
    // (evidência fora de ordem — o reason do guard sumiu da conversa). O
    // case vira ERRO com o diagnóstico do fixture — nunca passa em silêncio.
    if (fx.server.diagnosis.length > 0) {
      throw new EvalConfigError(
        `fixture adversarial (desvio induzido): ${fx.server.diagnosis.join("; ")}`,
      );
    }

    const seen = fx.server.seen;
    const trace = buildHarnessTrace(scenario.id, seen);
    return {
      ...resolvedTarget.artifacts,
      trace,
      toolPolicy: deriveToolPolicy(seen),
      modelOutput: seen.map((req) => req.lastUserText).join("\n\n---\n\n"),
      promptLength: prompt.length,
    };
  } finally {
    fx.cleanup();
  }
}
