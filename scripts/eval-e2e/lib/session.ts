// eval-e2e/lib/session.ts — sessão Pi in-process com modelos REAIS (D3/Execute #1).
//
// Mecanismo validado no Execute (F21/AD-021): SDK 0.81.0 in-process —
// ModelRuntime.create({authPath, modelsPath}) + getModel(provider, modelId) +
// createAgentSession + bindExtensions({}) (obrigatório: o SDK não emite
// session_start sozinho — o glla registra as goal tools nele).
//
// O SDK expõe usage REAL (verificado no Execute: pi-ai types.d.ts:288
// AssistantMessage.usage e :300 ToolResult.usage — incl. o auditor in-process
// do glla, que roda como tool). tokensApprox = totalTokens acumulado;
// indisponível → null + nota (nunca estimativa inventada — STOP RULE).
//
// Observação de compaction (F27 — emissão real): compaction_start/end são
// eventos de sessão (AgentSession.subscribe) — registrados em observations
// como evidência para o cenário F22 de validação do F27.
import * as path from "node:path";
import type {
	AgentSession,
	AgentSessionEvent,
} from "../../../packages/harness/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts";
import {
	ModelRuntime,
	SessionManager,
	createAgentSession,
} from "../../../packages/harness/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import type { SessionDriver, SessionFactory, SessionObservations, UsageLike } from "../types.ts";

const SDK_IMPORT_NOTE = "sessão SDK in-process (F21/AD-021)";

function asUsage(value: unknown): UsageLike | null {
	if (typeof value !== "object" || value === null) return null;
	const u = value as Record<string, unknown>;
	const num = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
	return {
		input: num("input"),
		output: num("output"),
		cacheRead: num("cacheRead"),
		cacheWrite: num("cacheWrite"),
	};
}

interface RealSession extends SessionDriver {
	session: AgentSession;
}

export const createRealSession: SessionFactory = async (opts) => {
	const { config, repoDir, agentDir, env } = opts;
	const modelsPath = env.RUNECRAFT_E2E_MODELS_PATH ?? path.join(agentDir, "models.json");
	const authPath = env.RUNECRAFT_E2E_AUTH_PATH ?? path.join(agentDir, "auth.json");

	const runtime = await ModelRuntime.create({
		authPath,
		modelsPath,
		allowModelNetwork: false,
	});
	const model = runtime.getModel(config.provider, config.model);
	if (!model) {
		throw new Error(
			`getModel("${config.provider}", "${config.model}") retornou undefined — modelo/provider não resolvem no models.json gerado (${SDK_IMPORT_NOTE}).`,
		);
	}

	const { session } = await createAgentSession({
		cwd: repoDir,
		agentDir,
		modelRuntime: runtime,
		model,
		sessionManager: SessionManager.inMemory(repoDir),
	});
	await session.bindExtensions({});

	const usage: UsageLike = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { total: 0 },
	};
	const observations: SessionObservations = { compactionEvents: [], agentEnds: 0, toolCalls: [] };
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		observeEvent(event, usage, observations);
	});

	return {
		session,
		usage,
		tokensApprox: usageTotal(usage),
		observations,
		async prompt(text: string) {
			await session.prompt(text);
		},
		async abort() {
			await session.abort();
		},
		toolRegistered(name: string) {
			return session.getToolDefinition(name) !== undefined;
		},
		dispose() {
			try {
				unsubscribe();
			} catch {
				// já desinscrito — ok
			}
			session.dispose();
		},
	} as RealSession;
};

function observeEvent(
	event: AgentSessionEvent,
	usage: UsageLike,
	observations: SessionObservations,
): void {
	switch (event.type) {
		case "message_end": {
			const u = (event as { message?: { usage?: unknown } }).message?.usage;
			if (u !== undefined) recordUsage(usage, u);
			break;
		}
		case "turn_end": {
			const toolResults = (event as { toolResults?: Array<{ usage?: unknown }> }).toolResults ?? [];
			for (const tr of toolResults) {
				if (tr.usage !== undefined) recordUsage(usage, tr.usage);
			}
			break;
		}
		case "tool_execution_start":
			observations.toolCalls.push((event as { toolName?: string }).toolName ?? "");
			break;
		case "agent_end":
			observations.agentEnds += 1;
			break;
		case "compaction_start":
		case "compaction_end":
			observations.compactionEvents.push({
				type: event.type,
				reason: (event as { reason?: string }).reason,
				at: Date.now(),
			});
			break;
		default:
			break;
	}
}

function recordUsage(usage: UsageLike, raw: unknown): void {
	const u = asUsage(raw);
	if (u === null) return;
	usage.input += u.input;
	usage.output += u.output;
	usage.cacheRead += u.cacheRead;
	usage.cacheWrite += u.cacheWrite;
	usage.totalTokens = usageTotal(usage) ?? undefined;
	const cost = (raw as { cost?: { total?: number } }).cost?.total;
	if (typeof cost === "number" && cost > 0) {
		usage.cost = { total: (usage.cost?.total ?? 0) + cost };
	}
}

function usageTotal(usage: UsageLike): number | null {
	const sum = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return sum > 0 ? sum : null;
}
