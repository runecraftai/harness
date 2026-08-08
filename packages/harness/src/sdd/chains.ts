// sdd/chains.ts — metadata das chains SDD + seleção por escopo (D8, PFC-08).
//
// Chains `.pi/chains/sdd-*.chain.md` no formato REAL consumido pelo fork
// subagents (validado no Execute F30): chain-serializer.ts parseChain exige
// front-matter `name` + `description` e seções `## <agente>` (worker/
// reviewer — papéis builtin do fork, sem RPG). O f3-taskflow.chain.md
// (formato `worker "..." -> reviewer "..."`) é o precedente HISTÓRICO do
// harness; o parser ATUAL do fork (0.37.2) lê `## <agente>` — os assets F30
// seguem o formato que o fork parseia HOJE (evidência: packages/
// harness/node_modules/@runecraft/subagents/src/agents/chain-serializer.ts:
// 101-131).
//
// Leitura mínima do front-matter (name/description) SEM parser YAML — regex
// determinística (zero deps). Papéis = worker/reviewer existentes no fork
// (agents/worker.md, agents/reviewer.md — builtin, sem RPG).
import * as fs from "node:fs";
import * as path from "node:path";
import { chainsDir } from "./templates.ts";
import type { SddScope } from "./scope.ts";

export const SDD_CHAIN_NAMES = ["sdd-spec", "sdd-design", "sdd-tasks", "sdd-review"] as const;
export type SddChainName = (typeof SDD_CHAIN_NAMES)[number];

/** Escopo recomendado por chain (D8 — tabela determinística). */
export const CHAIN_RECOMMENDED_SCOPE: Record<SddChainName, SddScope | "all"> = {
	"sdd-spec": "large",
	"sdd-design": "medium",
	"sdd-tasks": "quick",
	"sdd-review": "all",
};

/** Chain inicial recomendada por escopo (padrão escopo→chain do familiar —
 *  D8; mecanismo NÃO portado — só a seleção). */
export function selectChain(scope: SddScope): SddChainName {
	switch (scope) {
		case "quick":
			return "sdd-tasks";
		case "medium":
			return "sdd-design";
		case "large":
			return "sdd-spec";
	}
}

/** Path do asset da chain (assets/sdd/chains/<name>.chain.md). */
export function chainFilePath(name: SddChainName, root?: string): string {
	return path.join(chainsDir(root), `${name}.chain.md`);
}

export interface ChainFrontmatter {
	name: string;
	description: string;
}

/** Parse mínimo do front-matter (--- ... ---) — regex, sem YAML (D8). */
export function parseChainFrontmatter(content: string): ChainFrontmatter | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (match === null) return null;
	const block = match[1] ?? "";
	const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim();
	const description = /^description:\s*"?(.+?)"?\s*$/m.exec(block)?.[1]?.trim();
	if (name === undefined || description === undefined) return null;
	return { name, description };
}

export interface SddChainInfo {
	name: SddChainName;
	/** nome real do front-matter (valida o formato do fork). */
	frontmatterName: string;
	description: string;
	recommendedScope: SddScope | "all";
	/** seções `## <agente>` presentes (worker/reviewer — formato do fork). */
	steps: string[];
}

/** Lê a metadata de uma chain do asset (ausente/malformada → throw claro). */
export function readChainInfo(name: SddChainName, root?: string): SddChainInfo {
	const file = chainFilePath(name, root);
	const content = fs.readFileSync(file, "utf8");
	const frontmatter = parseChainFrontmatter(content);
	if (frontmatter === null) {
		throw new Error(`chain ${name} sem front-matter válido (name + description obrigatórios) em ${file}`);
	}
	const steps = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]?.trim() ?? "");
	return {
		name,
		frontmatterName: frontmatter.name,
		description: frontmatter.description,
		recommendedScope: CHAIN_RECOMMENDED_SCOPE[name],
		steps,
	};
}

/** Lista todas as chains SDD do package (ordem estável). */
export function listChains(root?: string): SddChainInfo[] {
	return SDD_CHAIN_NAMES.map((name) => readChainInfo(name, root));
}
