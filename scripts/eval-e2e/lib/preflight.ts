// eval-e2e/lib/preflight.ts — pré-requisitos verificados no início (D2).
//
// Cada check falho imprime o problema + o comando exato de correção. Dois
// níveis: aborta a rodada (sem preflight ok, nada roda — exit 1 com
// instruções) e registra confundidor (não aborta). `--doctor` roda só o
// preflight e sai com tabela (auto-documentação do ambiente).
//
// Desvio documentado (Execute #1): o check "pi list mostra @runecraft/*" do
// design virou confundidor — a sessão in-process materializa as extensões do
// umbrella direto (F21 H1, validado no Execute F21), sem depender do
// `pi install` do usuário; children herdam o agentDir via env. Abortar por
// falta do umbrella no `pi` do usuário bloquearia rodadas válidas.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExecFn, PreflightResult } from "../types.ts";

export interface PreflightDeps {
	env: NodeJS.ProcessEnv;
	exec: ExecFn;
	repoRoot: string;
}

const UPSTREAM_MARKERS = ["gentle-ai:", "GENTLE_AI_"];

/** Detecta confundidores de coexistência (D2/D9): marcadores de outros installers + upstreams. */
export function detectConfounders(repoRoot: string): string[] {
	const confounders: string[] = [];
	// Marcadores de outros installers em arquivos comuns do repo (detecção F18 — grep).
	for (const rel of ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md", "README.md"]) {
		const file = path.join(repoRoot, rel);
		if (!fs.existsSync(file)) continue;
		const content = fs.readFileSync(file, "utf8");
		if (UPSTREAM_MARKERS.some((m) => content.includes(m))) {
			confounders.push(`marcadores de outro installer: em ${rel}`);
			break;
		}
	}
	// Pacotes upstream Pi instalados no ambiente (pi list) são coletados pelo
	// caller via exec (precisa do pi) — aqui só o repo.
	return confounders;
}

export async function runPreflight(deps: PreflightDeps): Promise<PreflightResult> {
	const { env, exec, repoRoot } = deps;
	const aborts: PreflightResult["aborts"] = [];
	const confounders = detectConfounders(repoRoot);
	const environment: Record<string, string> = {};

	// 1. `pi` no PATH (D2 — aborta; children de subagents/pr-review usam `pi`).
	const whichPi = await exec("sh", ["-c", "command -v pi"]);
	if (!whichPi.ok || whichPi.stdout.trim() === "") {
		aborts.push({
			check: "pi no PATH",
			message: "binário `pi` não detectado no PATH.",
			remedy:
				"Instale o Pi (https://pi.dev) e garanta `pi` no PATH — children dos forks o invocam.",
		});
	} else {
		const ver = await exec("pi", ["--version"]);
		environment.piVersion = ver.ok ? (ver.stdout.trim().split("\n")[0] ?? "unknown") : "unknown";
		if (ver.ok) environment.pi = ver.stdout.trim().split("\n")[0] ?? "unknown";
	}

	// 2. git disponível (repo fixture — aborta).
	const gitVer = await exec("git", ["--version"]);
	if (!gitVer.ok) {
		aborts.push({
			check: "git",
			message: "git não encontrado no PATH.",
			remedy: "Instale git (https://git-scm.com) — o repo descartável por cenário exige git.",
		});
	} else {
		environment.git = gitVer.stdout.trim();
	}

	// 3. gh autenticado (NÃO aborta — COEX-04 reporta fail-infra com nota).
	const ghAuth = await exec("gh", ["auth", "status"]);
	const ghAuthed = ghAuth.ok;
	if (ghAuthed) {
		environment.gh = "authed";
	} else {
		environment.gh = "not-authed";
		confounders.push(
			"gh não autenticado — COEX-04 (pr-review) reportará fail-infra (degradação F5 preservada)",
		);
	}

	// 4. Versões de bun/node (D2 — registra, não aborta).
	environment.bun = typeof Bun !== "undefined" ? Bun.version : "unknown";
	environment.node = process.versions.node;
	environment.os = process.platform;

	// 5. Umbrella do usuário (pi list) — confundidor (desvio documentado acima).
	const piList = await exec("pi", ["list"]);
	const hasRunecraft = piList.ok && /@runecraft\//.test(piList.stdout);
	if (!hasRunecraft) {
		confounders.push(
			"`pi list` não mostra @runecraft/* no agente do usuário — a sessão usa a materialização direta das extensões do umbrella (F21 H1); children herdam o agentDir temp.",
		);
	}

	return {
		ok: aborts.length === 0,
		aborts,
		confounders,
		environment,
		ghAuthed,
	};
}
