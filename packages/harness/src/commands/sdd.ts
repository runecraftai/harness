// commands/sdd.ts — CLI `harness sdd new|chains` + `harness plans archive`
// (D8/D9, PFC-08/09).
//
// Camada fina: dispatch por subcomando (args do caller) → lógica pura de
// src/sdd/ → sinks (out/err). `--json` devolve shape estável (F21 D1).
import type { Runtime, TextSink } from "../config.ts";
import { packageRoot } from "../sdd/templates.ts";
import {
	plansArchive,
	sddChainsList,
	scaffoldFeature,
	materializeChains,
	recommendedChain,
} from "../sdd/index.ts";
import { parseScope } from "../sdd/scope.ts";

export interface SddCommandOptions {
	json: boolean;
	out: TextSink;
	err: TextSink;
	rt: Runtime;
	subcommand: string;
	args: string[];
	/** --scope do parseArgs global (extraído p/ sdd — quick|medium|large). */
	sddScope?: string;
}

/** Shape JSON estável por subcomando (F21 D1 — determinístico). */
export function sddJsonShape(subcommand: string, payload: Record<string, unknown>): string {
	return `${JSON.stringify({ command: subcommand, ...payload }, null, 2)}\n`;
}

export async function runSddCommand(opts: SddCommandOptions): Promise<number> {
	const ctx = { cwd: opts.rt.cwd, packageRoot: packageRoot() };

	switch (opts.subcommand) {
		case "new": {
			const feature = opts.args[0];
			if (feature === undefined) {
				opts.err.write("@runecraft/harness sdd: uso: harness sdd new <feature> [--scope quick|medium|large]\n");
				return 2;
			}
			const scopeArg = opts.sddScope ?? opts.args.find((a) => a !== feature && !a.startsWith("-"));
			const scope = parseScope(scopeArg) ?? undefined;
			if (opts.sddScope !== undefined && scope === undefined) {
				opts.err.write(`@runecraft/harness sdd: --scope inválido "${opts.sddScope}" (esperado quick|medium|large)\n`);
				return 2;
			}
			const result = scaffoldFeature(ctx, { feature, scope });
			if (result.code !== 0) {
				opts.err.write(result.text);
				return result.code;
			}
			// Materializa as chains SDD (D8 — fork subagents descobre de
			// .pi/chains/; idempotente, best-effort).
			const materialized = materializeChains(ctx);
			const chainsNote =
				materialized.copied.length > 0
					? `\nchains SDD materializadas em .pi/chains/: ${materialized.copied.join(", ")}`
					: materialized.skipped.length > 0
						? `\nchains SDD já presentes em .pi/chains/ (${materialized.skipped.length})`
						: "";
			if (opts.json) {
				opts.out.write(
					sddJsonShape("sdd new", {
						feature,
						scope: result.scope,
						recommendedChain: recommendedChain(result.scope),
						files: result.text,
						materialized,
					}),
				);
				return 0;
			}
			opts.out.write(`${result.text}${chainsNote}`);
			return 0;
		}
		case "chains": {
			const result = sddChainsList(ctx);
			if (opts.json) {
				opts.out.write(
					sddJsonShape("sdd chains", {
						chains: result.text
							.split(/\r?\n/)
							.filter((l) => l.startsWith("| sdd-"))
							.map((l) => {
								const cells = l.split("|").map((c) => c.trim());
								return { chain: cells[1], description: cells[2], recommendedScope: cells[3] };
							}),
					}),
				);
				return 0;
			}
			opts.out.write(result.text);
			return 0;
		}
		default:
			opts.err.write(`@runecraft/harness sdd: subcomando desconhecido "${opts.subcommand}" (esperado new|chains)\n`);
			return 2;
	}
}

/** CLI `harness plans archive <slug>` (D9 — QA-5a). */
export async function runPlansCommand(opts: SddCommandOptions): Promise<number> {
	const ctx = { cwd: opts.rt.cwd, packageRoot: packageRoot() };
	const sub = opts.subcommand;
	if (sub !== "archive") {
		opts.err.write(`@runecraft/harness plans: subcomando desconhecido "${sub}" (esperado archive)\n`);
		return 2;
	}
	const slug = opts.args[0];
	if (slug === undefined) {
		opts.err.write("@runecraft/harness plans: uso: harness plans archive <slug>\n");
		return 2;
	}
	const result = plansArchive(ctx, slug);
	if (opts.json) {
		opts.out.write(sddJsonShape(`plans ${sub}`, { slug, ok: result.code === 0, warnings: parseWarnings(result.text) }));
		return result.code;
	}
	opts.out.write(result.text);
	return result.code;
}

/** Extrai warnings do JSON de saída (shape {ok, warnings}). */
function parseWarnings(text: string): string[] {
	try {
		const parsed = JSON.parse(text) as { warnings?: string[] };
		return Array.isArray(parsed.warnings) ? parsed.warnings : [];
	} catch {
		return [];
	}
}
