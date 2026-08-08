// sdd/templates.ts — load/render dos templates SDD (D8, PFC-08).
//
// Templates autorais do harness (shape da casa — F29): spec/design/tasks em
// assets/sdd/templates/. Render = load + substituição de placeholders
// ({{feature}}, {{scope}}, {{prereq}}, {{date}}, {{objective}}, {{status}}).
// PURO: mesmo template + mesmos vars → mesmos bytes (sem relógio no render —
// {{date}} é opcional e injetado pelo caller quando desejado).
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Root do package (assets/sdd resolvido relativo a src/sdd/). */
export function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/** Dir dos templates (injetável p/ teste — default assets/sdd/templates). */
export function templatesDir(root: string = packageRoot()): string {
	return path.join(root, "assets", "sdd", "templates");
}

/** Dir dos prompt templates (default assets/sdd/prompts). */
export function promptsDir(root: string = packageRoot()): string {
	return path.join(root, "assets", "sdd", "prompts");
}

/** Dir das chains SDD (default assets/sdd/chains — D8). */
export function chainsDir(root: string = packageRoot()): string {
	return path.join(root, "assets", "sdd", "chains");
}

export type SddTemplateName = "spec" | "design" | "tasks";
export type SddPromptName = "spec" | "design" | "tasks" | "review";

const TEMPLATE_FILES: Record<SddTemplateName, string> = {
	spec: "spec.md",
	design: "design.md",
	tasks: "tasks.md",
};

const PROMPT_FILES: Record<SddPromptName, string> = {
	spec: "spec.md",
	design: "design.md",
	tasks: "tasks.md",
	review: "review.md",
};

export interface TemplateVars {
	/** nome da feature (ex.: "f30-pi-first-class"). */
	feature: string;
	/** escopo classificado (quick|medium|large). */
	scope: string;
	/** prereqs da feature (ex.: "F15 ✓, F17 ✓" — vazio ok). */
	prereq?: string;
	/** data ISO (opcional — injetada pelo caller; default vazio = estável). */
	date?: string;
	/** objetivo em 1 frase (opcional). */
	objective?: string;
	/** status inicial da tabela de rastreabilidade. */
	status?: string;
}

/** Substituição de placeholders ({{key}} — determinística). */
export function renderTemplateContent(template: string, vars: TemplateVars): string {
	const replacements: Record<string, string> = {
		feature: vars.feature,
		scope: vars.scope,
		prereq: vars.prereq ?? "",
		date: vars.date ?? "",
		objective: vars.objective ?? "",
		status: vars.status ?? "Pending",
	};
	let out = template;
	for (const [key, value] of Object.entries(replacements)) {
		out = out.split(`{{${key}}}`).join(value);
	}
	return out;
}

/** Load + render de um template (erro claro quando o asset falta). */
export function renderTemplate(name: SddTemplateName, vars: TemplateVars, root?: string): string {
	const file = path.join(templatesDir(root), TEMPLATE_FILES[name]);
	const template = fs.readFileSync(file, "utf8");
	return renderTemplateContent(template, vars);
}

/** Load de um prompt template (texto puro — sem placeholders em v1). */
export function loadPrompt(name: SddPromptName, root?: string): string {
	const file = path.join(promptsDir(root), PROMPT_FILES[name]);
	return fs.readFileSync(file, "utf8");
}
