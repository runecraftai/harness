// sdd/cli.ts — comandos `harness sdd new|chains` + `harness plans archive`
// (D8/D9, PFC-08/09).
//
// Lógica por subcomando (o IO vive no caller — commands/sdd.ts):
//   sdd new <feature> [--scope quick|medium|large] → classifica o escopo
//     (scope.ts — limiares em código, decisão 3) ou usa o --scope →
//     scaffold de .specs/features/<feature>/{spec,design,tasks}.md a partir
//     dos templates (D8) + materializa as chains SDD em .pi/chains/ (D8 —
//     o fork subagents descobre chains de <root>/.pi/chains/);
//   sdd chains → lista as chains SDD com escopo recomendado;
//   plans archive <slug> → port do createArchivePlanTool (D9).
import * as fs from "node:fs";
import * as path from "node:path";
import { archivePlan, plansDir, SLUG_REGEX } from "./archive.ts";
import { listChains, readChainInfo, selectChain, SDD_CHAIN_NAMES, type SddChainName } from "./chains.ts";
import { classifyScope, parseScope, type SddScope } from "./scope.ts";
import { renderTemplate, type TemplateVars } from "./templates.ts";

export interface SddCliContext {
	cwd: string;
	/** root do package (assets — default packageRoot()). */
	packageRoot?: string;
}

export interface SddCliResult {
	code: number;
	text: string;
}

export interface ScaffoldInput {
	feature: string;
	scope?: SddScope;
	/** estimativas para classificação automática (sem --scope). */
	estimate?: { fileCount: number; sentenceCount: number; taskCount: number; multiComponent?: boolean };
	prereq?: string;
	objective?: string;
}

/** Slug de feature válido (kebab-case — mesmo espírito do slug de plano). */
export function validFeatureName(feature: string): boolean {
	return SLUG_REGEX.test(feature) && feature.length >= 3;
}

/** Resultado do scaffold (inclui o escopo efetivo — JSON/relatório). */
export interface ScaffoldResult extends SddCliResult {
	/** escopo efetivo (--scope ou auto-classificado). */
	scope: SddScope;
}

/** Scaffold de .specs/features/<feature>/ a partir dos templates (D8). */
export function scaffoldFeature(ctx: SddCliContext, input: ScaffoldInput): ScaffoldResult {
	const feature = input.feature.trim();
	if (!validFeatureName(feature)) {
		return {
			code: 2,
			text: `nome de feature inválido "${feature}" (esperado kebab-case, ≥3 chars — regex ${SLUG_REGEX})\n`,
			scope: input.scope ?? "quick",
		};
	}
	const scope = input.scope ?? classifyScope(input.estimate ?? { fileCount: 1, sentenceCount: 1, taskCount: 1 });
	const targetDir = path.join(ctx.cwd, ".specs", "features", feature);
	const files = ["spec.md", "design.md", "tasks.md"];
	const vars: TemplateVars = {
		feature,
		scope,
		prereq: input.prereq ?? "",
		objective: input.objective ?? "",
		status: "Pending",
	};
	const created: string[] = [];
	for (const file of files) {
		const name = file.slice(0, -3) as "spec" | "design" | "tasks";
		const content = renderTemplate(name, vars, ctx.packageRoot);
		const out = path.join(targetDir, file);
		if (fs.existsSync(out)) {
			return { code: 1, text: `scaffold recusado: ${out} já existe (nunca sobrescreve)\n`, scope };
		}
		fs.mkdirSync(targetDir, { recursive: true });
		fs.writeFileSync(out, content, "utf8");
		created.push(path.relative(ctx.cwd, out));
	}
	return { code: 0, text: `scaffold criado em .specs/features/${feature}/ (escopo ${scope}):\n${created.map((c) => `  ${c}`).join("\n")}\n`, scope };
}

/** Materializa as chains SDD em <cwd>/.pi/chains/ (D8 — install/sync/sdd
 *  new). Idempotente: copia quando ausente ou divergente (chains são assets
 *  versionados — a cópia é determinística e idêntica ao asset). */
export function materializeChains(ctx: SddCliContext): { copied: string[]; skipped: string[] } {
	const srcDir = path.join(ctx.packageRoot ?? "", "assets", "sdd", "chains");
	const destDir = path.join(ctx.cwd, ".pi", "chains");
	const copied: string[] = [];
	const skipped: string[] = [];
	if (!fs.existsSync(srcDir)) return { copied, skipped };
	fs.mkdirSync(destDir, { recursive: true });
	for (const name of SDD_CHAIN_NAMES) {
		const src = path.join(srcDir, `${name}.chain.md`);
		if (!fs.existsSync(src)) continue;
		const dest = path.join(destDir, `${name}.chain.md`);
		try {
			const content = fs.readFileSync(src, "utf8");
			if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) {
				skipped.push(`${name}.chain.md`);
				continue;
			}
			fs.writeFileSync(dest, content, "utf8");
			copied.push(`${name}.chain.md`);
		} catch {
			skipped.push(`${name}.chain.md`);
		}
	}
	return { copied, skipped };
}

/** Lista das chains SDD com escopo recomendado (tabela determinística). */
export function sddChainsList(ctx: SddCliContext): SddCliResult {
	const lines = ["| chain | descrição | escopo recomendado |", "| ----- | --------- | ------------------ |"];
	for (const info of listChains(ctx.packageRoot)) {
		lines.push(`| ${info.name} | ${info.description} | ${info.recommendedScope} |`);
	}
	return { code: 0, text: `${lines.join("\n")}\n` };
}

/** Chain inicial recomendada para um escopo (padrão escopo→chain — D8). */
export function recommendedChain(scope: SddScope): SddChainName {
	return selectChain(scope);
}

/** `plans archive <slug>` — port do createArchivePlanTool (D9). */
export function plansArchive(ctx: SddCliContext, slug: string): SddCliResult {
	const output = archivePlan({ cwd: ctx.cwd }, slug);
	return { code: output.ok ? 0 : 1, text: `${JSON.stringify(output, null, 2)}\n` };
}

export { plansDir, parseScope, readChainInfo };
