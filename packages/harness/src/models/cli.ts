// models/cli.ts — comandos `harness models generate|list|doctor` (D7, PFC-07).
//
// Lógica PURO por subcomando (o IO vive no caller — commands/models.ts):
//   generate → merge do state `models` → models.json (determinístico; 2 runs
//              byte-idênticos — canonicalJson F23); kill switch recusa sem
//              escrever (fail-visible, exit 0 — padrão F29);
//   list     → tabela de resolução por agente (chain atual + modelo resolvido
//              via resolveAgentModel — D4);
//   doctor   → check de paridade estado↔arquivo + availableModels (fail-closed
//              sem crash — models.json ausente/ilegível → [] + warning).
import type { ModelsConfig } from "./config.ts";
import { defaultModelsConfig, modelOverrideEnv } from "./config.ts";
import { renderModelsJsonFromConfig } from "./generate.ts";
import { resolveAgentModel } from "./resolution.ts";
import type { FallbackEntry } from "./types.ts";

export interface ModelsCliContext {
	/** config efetiva `models` (defaults validados). */
	config: ModelsConfig;
	/** availableModels reais (registry — models.json do SDK). */
	availableModels: Set<string>;
	/** content do models.json atual (merge em generate). */
	existingContent?: string;
}

export interface ModelsCliResult {
	code: number;
	text: string;
}

/** Modelo resolvido por agente (para list/doctor — D4). */
export function resolveForAgent(
	agent: string,
	ctx: Pick<ModelsCliContext, "config" | "availableModels">,
): { model: string | null; via: string; warning?: string } {
	const override = modelOverrideEnv(process.env) ?? ctx.config.override ?? undefined;
	const outcome = resolveAgentModel(agent, {
		availableModels: ctx.availableModels,
		overrideModel: override,
		systemDefaultModel: ctx.config.default ?? undefined,
		customFallbackChain: ctx.config.agents[agent]?.fallbackChain,
	});
	if (outcome.model === null) return { model: null, via: outcome.via, warning: outcome.warning };
	return { model: outcome.model, via: outcome.via };
}

/** Lista de agentes da tabela (hosts + qualquer agente com chain configurada).
 *  Fix cleric F30: hosts SEM chain ainda entram — o render decide o que emitir;
 *  o guard `agents.length === 0` era morto (sempre ≥ 4). */
export function agentsForList(config: ModelsConfig): string[] {
	const ids = new Set<string>(Object.keys(config.agents));
	for (const host of ["pi", "opencode", "claude", "codex"]) ids.add(host);
	return [...ids].sort();
}

/** chain efetiva de um agente (custom do state > builtin {}). */
export function chainForAgent(config: ModelsConfig, agent: string): FallbackEntry[] {
	return config.agents[agent]?.fallbackChain ?? [];
}

export function runModelsGenerate(ctx: ModelsCliContext): ModelsCliResult {
	const config = ctx.config;
	const agents = agentsForList(config);
	// Fix cleric F30: a mensagem "nothing to generate" só faz sentido sem NENHUMA
	// chain configurada (agentsForList sempre retorna os 4 hosts).
	const hasChains = agents.some((id) => chainForAgent(config, id).length > 0);
	if (!hasChains) {
		return { code: 0, text: "no agent chains configured — nothing to generate\n" };
	}
	// Delegado ao render (mesma fonte de generate.ts — determinismo).
	const existing = parseExisting(ctx.existingContent);
	const rendered = renderModelsJsonFromConfig(config, { existing, env: process.env });
	return { code: 0, text: rendered };
}

/** Parse do models.json atual para merge (ilegível → undefined — D7). */
function parseExisting(content: string | undefined): Record<string, unknown> | undefined {
	if (content === undefined || content.trim() === "") return undefined;
	try {
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
		return undefined;
	} catch {
		return undefined;
	}
}

export function runModelsList(ctx: ModelsCliContext): ModelsCliResult {
	const lines = ["| agent | chain | resolved |", "| ----- | ----- | -------- |"];
	for (const agent of agentsForList(ctx.config)) {
		const chain = chainForAgent(ctx.config, agent);
		const chainText = chain.length === 0 ? "—" : chain.map((e) => `${e.providers.join("/")}:${e.model}`).join(" → ");
		const resolved = resolveForAgent(agent, ctx);
		const resolvedText = resolved.model ?? "null + warn";
		lines.push(`| ${agent} | ${chainText} | ${resolvedText} |`);
	}
	return { code: 0, text: `${lines.join("\n")}\n` };
}

export interface ModelsDoctorView {
	path: string | null;
	fileExists: boolean;
	/** paridade estado ↔ arquivo (o arquivo contém os modelos das chains?). */
	parity: "ok" | "missing" | "unknown";
	availableCount: number;
	warnings: string[];
}

export function runModelsDoctor(ctx: ModelsCliContext & { path: string | null }): ModelsCliResult {
	const view: ModelsDoctorView = {
		path: ctx.path,
		fileExists: ctx.path !== null && ctx.existingContent !== undefined,
		parity: "unknown",
		availableCount: ctx.availableModels.size,
		warnings: [...(ctx.path === null ? [`models.json não encontrado — availableModels = [] (fail-closed)`] : [])],
	};
	// Paridade: os modelos das chains existem no arquivo gerado?
	const existing = parseExisting(ctx.existingContent);
	const rendered = parseExisting(renderModelsJsonFromConfig(ctx.config, { existing, env: process.env }));
	if (rendered !== undefined) {
		const providers = (rendered.providers as Record<string, unknown> | undefined) ?? {};
		const chainModels = new Set<string>();
		for (const agent of agentsForList(ctx.config)) {
			for (const entry of chainForAgent(ctx.config, agent)) {
				for (const provider of entry.providers) chainModels.add(`${provider}/${entry.model}`);
			}
		}
		const present = [...chainModels].every((qualified) => {
			const [provider, model] = qualified.split("/");
			const list = provider !== undefined ? (providers[provider] as { models?: Array<{ id?: string }> } | undefined)?.models ?? [] : [];
			return list.some((m) => m.id === model);
		});
		view.parity = chainModels.size === 0 ? "unknown" : present ? "ok" : "missing";
		if (view.parity === "missing") {
			view.warnings.push("paridade estado↔arquivo: modelos das chains ausentes do models.json — rode `harness models generate`");
		}
	}
	const lines = [
		`models.json: ${view.path ?? "não encontrado"}`,
		`file: ${view.fileExists ? "presente" : "ausente"}`,
		`parity: ${view.parity}`,
		`availableModels: ${view.availableCount}`,
		...view.warnings.map((w) => `warn: ${w}`),
	];
	return { code: 0, text: `${lines.join("\n")}\n` };
}

export { defaultModelsConfig };
