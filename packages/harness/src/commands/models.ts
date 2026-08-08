// commands/models.ts — CLI `harness models generate|list|doctor` (D7, PFC-07).
//
// Camada fina: kill switch → recusa fail-visible (nada escrito, exit 0);
// merge do state `models` (workspace > global > default — D5) → dispatch
// puro (src/models/cli.ts) → sinks (out/err). `--json` devolve shape estável
// por subcomando (F21 D1 — CLI testável in-process).
import * as fs from "node:fs";
import * as path from "node:path";
import type { Runtime, TextSink } from "../config.ts";
import { modelsJsonPath } from "../models/registry.ts";
import { loadSessionModels, modelsKillSwitch, modelOverrideEnv } from "../models/config.ts";
import { resolveAvailableModels } from "../models/registry.ts";
import {
	runModelsDoctor,
	runModelsGenerate,
	runModelsList,
	resolveForAgent,
	agentsForList,
	chainForAgent,
} from "../models/cli.ts";

export interface ModelsCommandOptions {
	json: boolean;
	out: TextSink;
	err: TextSink;
	rt: Runtime;
	subcommand: string;
	args: string[];
}

/** Shape JSON estável por subcomando (F21 D1 — determinístico). */
export function modelsJsonShape(subcommand: string, payload: Record<string, unknown>): string {
	return `${JSON.stringify({ command: `models ${subcommand}`, ...payload }, null, 2)}\n`;
}

export async function runModelsCommand(opts: ModelsCommandOptions): Promise<number> {
	const env = opts.rt.env;

	// Kill switch (F20/D5): recusa fail-visible — NADA escrito (D7).
	const kill = modelsKillSwitch(env);
	if (kill.active) {
		opts.out.write(`@runecraft/companion models: models disabled (RUNECRAFT_MODELS=${kill.value})\n`);
		return 0;
	}

	// Config efetiva (workspace > global > default) + availableModels reais.
	const session = loadSessionModels(opts.rt.cwd, env);
	const config = session.config;
	const file = modelsJsonPath(env);
	const existingContent = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
	const available = resolveAvailableModels(env);

	const ctx = {
		config,
		availableModels: available.models,
		existingContent,
		path: file,
	};

	switch (opts.subcommand) {
		case "generate": {
			const result = runModelsGenerate(ctx);
			if (result.code !== 0) {
				opts.err.write(result.text);
				return result.code;
			}
			// Fix cleric F30: o modo --json NÃO pode pular a escrita (mentia
			// "wrote: <path>" sem gravar) — escreve primeiro, reporta depois.
			try {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				const tmp = `${file}.tmp-${process.pid}`;
				fs.writeFileSync(tmp, result.text, "utf8");
				fs.renameSync(tmp, file);
			} catch (error) {
				opts.err.write(`@runecraft/companion models: falha ao escrever ${file} — ${error instanceof Error ? error.message : String(error)}\n`);
				return 1;
			}
			if (opts.json) {
				opts.out.write(modelsJsonShape("generate", { ok: true, wrote: file, bytes: Buffer.byteLength(result.text) }));
				return 0;
			}
			opts.out.write(`models.json escrito em ${file} (${result.text.trim().split(/\r?\n/).length} linhas)\n`);
			return 0;
		}
		case "list": {
			const result = runModelsList(ctx);
			if (opts.json) {
				opts.out.write(
					modelsJsonShape("list", {
						agents: agentsForList(config).map((agent) => ({
							agent,
							chain: chainForAgent(config, agent).map((e) => ({ providers: e.providers, model: e.model })),
							resolved: resolveForAgent(agent, ctx),
						})),
					}),
				);
				return 0;
			}
			opts.out.write(result.text);
			return 0;
		}
		case "doctor": {
			const result = runModelsDoctor(ctx);
			if (opts.json) {
				opts.out.write(
					modelsJsonShape("doctor", {
						path: ctx.path,
						fileExists: ctx.existingContent !== undefined,
						availableModels: available.models.size,
						override: modelOverrideEnv(env) ?? config.override,
						source: session.source,
						problems: session.problems,
					}),
				);
				return 0;
			}
			for (const problem of session.problems) opts.err.write(`warn: ${problem}\n`);
			opts.out.write(result.text);
			return 0;
		}
		default:
			opts.err.write(`@runecraft/companion models: subcomando desconhecido "${opts.subcommand}" (esperado generate|list|doctor)\n`);
			return 2;
	}
}
