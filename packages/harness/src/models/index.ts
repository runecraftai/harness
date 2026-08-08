// models/index.ts — exports públicos do módulo models (F30, PFC-04/05/06/07).
export type { FallbackEntry, AgentModelRequirement } from "./types.ts";
export { MODEL_HOST_AGENTS, AGENT_MODEL_REQUIREMENTS, builtinFallbackChain } from "./defaults.ts";
export {
	resolveAgentModel,
	getNextFallbackModel,
	getKnownModels,
	type ResolveAgentModelOptions,
	type ResolveOutcome,
} from "./resolution.ts";
export {
	defaultModelsConfig,
	modelsKillSwitch,
	modelOverrideEnv,
	validateModelsConfig,
	loadSessionModels,
	SessionModelsConfig,
	type ModelsConfig,
} from "./config.ts";
export { modelsJsonPath, resolveAvailableModels, type AvailableModelsRead } from "./registry.ts";
export { renderModelsJsonFromConfig, type ModelsGenerateOptions } from "./generate.ts";
export { resolveModelSwitch, type ModelSwitchResult, type ResolveModelSwitchOptions } from "./switch.ts";
