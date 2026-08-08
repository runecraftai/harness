// src/extensions/memory.ts — wiring Pi do F29 (D1/D3/D5/D7, MEM-03/04/05).
//
// Registra a camada de memória como extensão Pi. O init é THIN — a decisão
// vive nos módulos puros de src/memory/:
//
//   session_start → freeze da config `memory` (D5/D12) + abertura do DB
//     (ensureMemoryDir + openDatabase — WAL, migração idempotente) +
//     getOrCreateProject (slug do remote git — D1) + pi.registerTool ×10
//     (rune_* — D3) + auto-import de lessons do F28 quando
//     importLessonsOnStart=true (D7 — QA-3 default false)
//
// Kill switch RUNECRAFT_MEMORY=0 → camada INERTE: nenhum tool registrado,
// nenhum arquivo criado (F20/D5). Falha de abertura do DB → tools ausentes
// + aviso (fail-closed — a sessão segue sem memória; D1/D5). Nada de
// console.log: log dedicado em stderr (regra do guild) com metadados apenas
// (D10 — conteúdo de memória nunca logado cru).
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { openDatabase } from "../memory/client.ts";
import { ensureMemoryDir } from "../memory/paths.ts";
import { resolveProjectSlugSync } from "../memory/project.ts";
import { Repository } from "../memory/repository.ts";
import { createToolsRecord, filterToolsByDisabled, type RuneTool } from "../memory/tools.ts";
import { importLessons } from "../memory/import-lessons.ts";
import { SessionMemoryConfig, promotedLessonsPath } from "../memory/config.ts";

/** Logger dedicado (regra do guild: sem console.log; stderr, não stdout). */
const log = {
	debug(message: string): void {
		if (process.env.RUNECRAFT_MEMORY_DEBUG === "1" || process.env.RUNECRAFT_MEMORY_DEBUG === "true") {
			process.stderr.write(`[runecraft:memory] ${message}\n`);
		}
	},
	warn(message: string): void {
		process.stderr.write(`[runecraft:memory] warn: ${message}\n`);
	},
};

export interface MemoryDeps {
	/** env override (testes) — default process.env. */
	env?: NodeJS.ProcessEnv;
	/** relógio injetável (epoch ms — determinismo D6). */
	now?: () => number;
	/** idGen injetável (determinismo D6). */
	idGen?: () => string;
	/** identidade do agente — default RUNECRAFT_AGENT_ID ?? "pi" (F24). */
	getAgentId?: () => string | undefined;
	/** override do dir da memória (testes) — default resolveMemoryDir. */
	memoryDir?: (cwd: string, env: NodeJS.ProcessEnv) => string;
	/** hook de teste: observa os tools registrados (nomes). */
	onRegistered?: (names: string[]) => void;
}

/**
 * Registra a camada de memória no Pi. Carregado apenas em sessões gerenciadas
 * pelo harness (manifest pi.extensions / settings.json do fixture).
 */
export function installMemory(pi: ExtensionAPI, deps: MemoryDeps = {}): void {
	const env = deps.env ?? process.env;
	const sessionConfig = new SessionMemoryConfig(env);
	let initialized = false;

	/** Registra as 10 tools rune_* no pi (defineTool — SDK 0.81.0, D3). */
	const registerRuneTools = (tools: Record<string, RuneTool>): void => {
		const names: string[] = [];
		for (const tool of Object.values(tools)) {
			pi.registerTool(
				defineTool({
					name: tool.name,
					label: tool.label,
					description: tool.description,
					parameters: tool.parameters,
					async execute(_id, params) {
						return tool.execute(params as unknown as Record<string, unknown>);
					},
				}),
			);
			names.push(tool.name);
		}
		deps.onRegistered?.(names);
	};

	/**
	 * Init lazy no primeiro session_start (padrão F28/F27): freeze da config
	 * (D12), open+migrate, project, tools ×10, auto-import. Kill switch →
	 * no-op (zero tools/arquivos). Falha de abertura → tools ausentes +
	 * aviso (fail-closed — D1/D5).
	 */
	const ensureInitialized = (cwd: string): void => {
		if (initialized) return;
		initialized = true;
		const frozen = sessionConfig.frozen(cwd);
		for (const problem of frozen.problems) log.warn(`config: ${problem}`);
		if (frozen.killSwitch || !frozen.config.enabled) {
			log.debug("memory layer inert (kill switch or disabled)");
			return;
		}
		try {
			const memoryDir = deps.memoryDir ? deps.memoryDir(cwd, env) : ensureMemoryDir(cwd, env);
			const db = openDatabase(memoryDir);
			const repo = new Repository(db, { clock: deps.now, idGen: deps.idGen });
			// Síncrono (padrão glla — registro de tools no session_start; sem
			// race no request do primeiro turno).
			const identity = resolveProjectSlugSync(cwd, env);
			const project = repo.getOrCreateProject(identity.slug, identity.rootPath, identity.remoteUrl);
			const agentId = deps.getAgentId?.() ?? env.RUNECRAFT_AGENT_ID ?? "pi";
			const tools = createToolsRecord({
				repository: repo,
				projectSlug: project.slug,
				projectId: project.id,
				categoryCap: frozen.config.categoryCap,
				agentId,
			});
			const filtered = filterToolsByDisabled(tools, frozen.config.disabledTools);
			registerRuneTools(filtered);
			log.debug(`tools registered (${Object.keys(filtered).length}) — project ${project.slug}`);
			if (frozen.config.importLessonsOnStart) {
				const report = importLessons(repo, project.id, promotedLessonsPath(cwd));
				log.debug(`importLessonsOnStart: imported=${report.imported} skipped=${report.skipped}`);
			}
		} catch (error) {
			// Fail-closed (D1/D5): a sessão segue sem memória; nada registrado.
			log.warn(
				`memory layer could not initialize — tools rune_* NOT registered (fail-closed): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	};

	pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
		void event;
		ensureInitialized(ctx.cwd);
	});
}

/** Factory da extensão (convenção do SDK — jiti.import resolve o DEFAULT
 *  export; mesmo padrão do extensions/guards.ts do F24). */
export default function registerMemory(pi: ExtensionAPI): void {
	installMemory(pi);
}
