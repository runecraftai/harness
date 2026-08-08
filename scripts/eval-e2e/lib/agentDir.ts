// eval-e2e/lib/agentDir.ts — materializa o agentDir Pi temp da rodada (D3).
//
// Decisão de Execute (validado no Execute F22 #1/#2): sessão SDK in-process
// (F21/AD-021 — createAgentSession + bindExtensions) com agentDir temp no
// padrão H1 do F21: settings.json `extensions` com paths ABSOLUTOS do
// umbrella + models.json com o provider real (env) + auth.json com a API key
// (origem: env — 0600, tmp, removido no cleanup; nunca logada, nunca nos
// resultados). Children (subagents/pr-review) herdam PI_CODING_AGENT_DIR e
// usam o `pi` real do PATH (preflight D2).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { E2EConfig } from "../types.ts";

export interface AgentDirFixture {
	agentDir: string;
	modelsJsonPath: string;
	authJsonPath: string;
	settingsJsonPath: string;
	cleanup(): void;
}

/** Extensões do umbrella (ordem da manifest do package — F21 fixtureHome). */
export function harnessExtensionPaths(packageRoot: string): string[] {
	return [
		path.join(packageRoot, "extensions", "harness-status.ts"),
		path.join(packageRoot, "extensions", "guards.ts"),
		path.join(packageRoot, "extensions", "resilience.ts"),
		path.join(packageRoot, "extensions", "observability.ts"),
		path.join(packageRoot, "extensions", "memory.ts"),
		path.join(packageRoot, "extensions", "persona.ts"),
		path.join(packageRoot, "extensions", "routing.ts"),
		path.join(packageRoot, "node_modules", "@runecraft", "subagents", "index.ts"),
		path.join(packageRoot, "node_modules", "@runecraft", "taskflow", "dist", "index.js"),
		path.join(
			packageRoot,
			"node_modules",
			"@runecraft",
			"goal-loop-audit",
			"extensions",
			"loops",
			"goal.ts",
		),
		path.join(packageRoot, "node_modules", "@runecraft", "pr-review", "extensions", "index.ts"),
	];
}

/**
 * Gera o models.json da rodada (provider real do env — D3/Execute #2).
 *
 * shape verificado no Execute: `{ providers: { <id>: { baseUrl?, api?,
 * apiKey?, models: [{id, name}] } } }` (F21 modelsTemplate estendido — o SDK
 * compõe o provider; api/baseUrl só entram quando o env os fornece — nunca
 * inventados). A key vive no auth.json (0600) — o models.json fica sem segredo.
 */
export function renderModelsJson(config: E2EConfig): string {
	const provider: Record<string, unknown> = {
		models: [{ id: config.model, name: config.model }],
	};
	if (config.baseUrl !== undefined) provider.baseUrl = config.baseUrl;
	if (config.api !== undefined) provider.api = config.api;
	return JSON.stringify({ providers: { [config.provider]: provider } }, null, 2);
}

export function materializeAgentDir(config: E2EConfig, packageRoot: string): AgentDirFixture {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "runecraft-e2e-agent-"));
	const modelsJsonPath = path.join(agentDir, "models.json");
	const authJsonPath = path.join(agentDir, "auth.json");
	const settingsJsonPath = path.join(agentDir, "settings.json");

	fs.writeFileSync(modelsJsonPath, renderModelsJson(config));

	// auth.json: shape do SDK (Record<providerId, Credential>) — 0600, nunca logado.
	const auth: Record<string, unknown> = {
		[config.provider]: { type: "api_key", key: config.apiKey },
	};
	fs.writeFileSync(authJsonPath, JSON.stringify(auth, null, 2), { mode: 0o600 });

	const settings: Record<string, unknown> = {
		extensions: harnessExtensionPaths(packageRoot),
		defaultProvider: config.provider,
		defaultModel: config.model,
	};
	fs.writeFileSync(settingsJsonPath, JSON.stringify(settings, null, 2));

	return {
		agentDir,
		modelsJsonPath,
		authJsonPath,
		settingsJsonPath,
		cleanup() {
			fs.rmSync(agentDir, { recursive: true, force: true });
		},
	};
}
