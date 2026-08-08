// sdd/index.ts — exports públicos do módulo sdd (F30, PFC-08/09).
export {
	classifyScope,
	parseScope,
	SCOPE_LABELS,
	type SddScope,
	type ScopeInput,
} from "./scope.ts";
export {
	packageRoot,
	templatesDir,
	promptsDir,
	chainsDir,
	renderTemplate,
	renderTemplateContent,
	loadPrompt,
	type SddTemplateName,
	type SddPromptName,
	type TemplateVars,
} from "./templates.ts";
export {
	SDD_CHAIN_NAMES,
	CHAIN_RECOMMENDED_SCOPE,
	selectChain,
	chainFilePath,
	parseChainFrontmatter,
	readChainInfo,
	listChains,
	type SddChainName,
	type ChainFrontmatter,
	type SddChainInfo,
} from "./chains.ts";
export {
	SLUG_REGEX,
	plansDir,
	archivePlan,
	type ArchivePlanOutput,
	type ArchivePlanDeps,
} from "./archive.ts";
export {
	scaffoldFeature,
	materializeChains,
	sddChainsList,
	recommendedChain,
	plansArchive,
	validFeatureName,
	type SddCliContext,
	type SddCliResult,
	type ScaffoldInput,
} from "./cli.ts";
