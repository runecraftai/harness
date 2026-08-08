// eval-e2e/scenarios/04-pr-review.ts — COEX-04 (pr-review com nossos subagents).
//
// PR de teste descartável (padrão F5/F7): repo GitHub privado + PR com bug
// seedado → `/pr-review <n>` → verdict JSON publicado (COMMENT-only — o PR
// permanece aberto) → limpeza (close + delete, best-effort). gh ausente →
// fail-infra (o runner nem roda o cenário — needsGh). Modelo sem resposta
// (F7: deepseek-v4-flash engasgou no prompt longo) → fail-infra com nota
// (qualidade de modelo, não regressão de harness).
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { check } from "../lib/verdict.ts";
import { waitForCondition } from "../lib/wait.ts";
import type { ScenarioContext, ScenarioModule, ScenarioOutcome } from "../types.ts";

const SEED_FILE = "multiply.js";

function gh(ctx: ScenarioContext, args: string[]): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = execSync(`gh ${args.map(quote).join(" ")}`, {
			cwd: ctx.repoDir,
			env: ctx.env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { ok: true, stdout: stdout.trim(), stderr: "" };
	} catch (error) {
		const stderr = error instanceof Error ? error.message : String(error);
		return { ok: false, stdout: "", stderr };
	}
}

function quote(arg: string): string {
	return /^[a-zA-Z0-9._/-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Extrai o primeiro objeto JSON com campo `verdict` do texto (review body). */
function extractVerdict(body: string): { verdict: string } | null {
	// remove fences markdown
	const cleaned = body.replace(/```(?:json)?/g, "").trim();
	const start = cleaned.indexOf("{");
	if (start === -1) return null;
	for (let end = start + 1; end <= cleaned.length; end += 1) {
		const candidate = cleaned.slice(start, end);
		try {
			const parsed = JSON.parse(candidate) as { verdict?: unknown };
			if (typeof parsed.verdict === "string") return { verdict: parsed.verdict };
		} catch {
			// ainda não fechou o objeto — continua
		}
	}
	return null;
}

const scenario: ScenarioModule = {
	id: "COEX-04",
	name: "pr-review",
	description:
		"pr-review real em PR de teste descartável — verdict JSON, publicação COMMENT-only, limpeza",
	needsGh: true,
	timeoutMs: 8 * 60_000,
	async run(ctx) {
		const checks: ScenarioOutcome["checks"] = [];
		const notes: string[] = [];
		const confounders: string[] = [];

		// 1. Identidade do owner + nome único do repo de teste.
		const ownerCall = gh(ctx, ["api", "user", "--jq", ".login"]);
		if (!ownerCall.ok || ownerCall.stdout === "") {
			notes.push(`gh api user falhou: ${ownerCall.stderr}`);
			return { checks: [check("gh-owner", false, ownerCall.stderr)], notes, confounders };
		}
		const owner = ownerCall.stdout.trim();
		const repoName = `runecraft-e2e-pr-${Math.floor(Date.now() / 1000)}`;

		// 2. Bug seedado (padrão F7 — o review tem algo a encontrar).
		fs.writeFileSync(
			path.join(ctx.repoDir, SEED_FILE),
			[
				"// BUG: scale computes n * factor + factor instead of n * factor",
				"export function scale(n, factor) {",
				"  return n * factor + factor;",
				"}",
				"export function multiply(a, b) {",
				"  return a * b;",
				"}",
				"",
			].join("\n"),
		);
		execSync("git add multiply.js", { cwd: ctx.repoDir, encoding: "utf8" });
		execSync('git commit -q -m "feat: add multiply and scale helpers"', {
			cwd: ctx.repoDir,
			encoding: "utf8",
		});

		// 3. Repo remoto descartável + PR (padrão F5).
		const createRepo = gh(ctx, [
			"repo",
			"create",
			repoName,
			"--private",
			"--source",
			ctx.repoDir,
			"--push",
		]);
		if (!createRepo.ok) {
			notes.push(`gh repo create falhou: ${createRepo.stderr}`);
			return {
				checks: [check("pr-created", false, createRepo.stderr)],
				notes: [
					...notes,
					"fail-infra: criação do repo de teste falhou (permissão do token gh — repo:create)",
				],
				confounders,
				statusOverride: "fail-infra",
			};
		}
		const prCall = gh(ctx, [
			"pr",
			"create",
			"--title",
			"feat: add multiply and scale helpers",
			"--body",
			"E2E test PR (F22)",
		]);
		if (!prCall.ok) {
			notes.push(`gh pr create falhou: ${prCall.stderr}`);
			return {
				checks: [check("pr-created", false, prCall.stderr)],
				notes: [...notes, "fail-infra: criação do PR de teste falhou (permissão do token gh)"],
				confounders,
				statusOverride: "fail-infra",
			};
		}
		const prNumber = extractPrNumber(prCall.stdout);
		if (prNumber === null) {
			notes.push(`gh pr create sem número no output: ${prCall.stdout.slice(0, 120)}`);
			cleanup(ctx, owner, repoName, null, confounders);
			return {
				checks: [check("pr-created", false, "número do PR não parseado")],
				notes,
				confounders,
			};
		}
		checks.push(check("pr-created", true, String(prNumber)));
		notes.push(`PR criado: ${owner}/${repoName}#${prNumber}`);

		// 4. `/pr-review <n>` na sessão (o modelo dirige o loop do fork).
		try {
			await ctx.session.prompt(`/pr-review ${prNumber}`);
		} catch (error) {
			notes.push(
				`/pr-review falhou na sessão: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// 5. Verdict JSON publicado (poll gh — reviews OU issue comments).
		const hasVerdict = (): { found: string | null } => {
			const reviews = gh(ctx, [
				"api",
				`repos/${owner}/${repoName}/pulls/${prNumber}/reviews`,
				"--jq",
				".[].body",
			]);
			const comments = gh(ctx, [
				"api",
				`repos/${owner}/${repoName}/issues/${prNumber}/comments`,
				"--jq",
				".[].body",
			]);
			const bodies = [reviews.stdout, comments.stdout].join("\n");
			for (const body of bodies.split("\n")) {
				const verdict = extractVerdict(body);
				if (verdict !== null) return { found: verdict.verdict };
			}
			return { found: null };
		};
		const verdict = await waitForCondition(() => hasVerdict().found !== null, {
			timeoutMs: 4 * 60_000,
			label: "verdict JSON publicado (COEX-04)",
		});

		if (verdict) {
			const found = hasVerdict().found;
			checks.push(check("verdict-json", found !== null, found ?? "n/d"));
			notes.push(
				`verdict: ${found ?? "?"} — conteúdo de findings vai para notas, nunca julgado (D3)`,
			);
		} else {
			checks.push(check("verdict-json", false, "nenhum review publicado no tempo"));
			notes.push(
				"nenhum review publicado — possível resposta vazia do modelo (F7 COEX-04: deepseek-v4-flash engasgou no prompt longo; comportamento de modelo, não do harness)",
			);
			// Modelo sem resposta = qualidade de modelo → fail-infra (não conta no F23).
			cleanup(ctx, owner, repoName, prNumber, confounders);
			return {
				checks,
				notes,
				confounders,
				statusOverride: "fail-infra",
			};
		}

		// 6. COMMENT-only: o PR permanece aberto (nenhum merge automático).
		const prState = gh(ctx, ["pr", "view", String(prNumber), "--json", "state", "--jq", ".state"]);
		checks.push(
			check(
				"comment-only",
				prState.ok && prState.stdout === "OPEN",
				prState.stdout || prState.stderr,
			),
		);

		cleanup(ctx, owner, repoName, prNumber, confounders);
		return { checks, notes, confounders };
	},
};

function extractPrNumber(stdout: string): number | null {
	const match = stdout.match(/#(\d+)/);
	return match !== null ? Number(match[1]) : null;
}

/** Limpeza best-effort: close PR + delete repo (F7 pendência: token sem delete_repo). */
function cleanup(
	ctx: ScenarioContext,
	owner: string,
	repoName: string,
	prNumber: number | null,
	confounders: string[],
): void {
	if (prNumber !== null) gh(ctx, ["pr", "close", String(prNumber), "--delete-branch"]);
	const del = gh(ctx, ["repo", "delete", `${owner}/${repoName}`, "--yes"]);
	if (!del.ok) {
		confounders.push(
			`repo de teste não deletado (${del.stderr.slice(0, 120)}) — token gh sem delete_repo? (F7 pendência)`,
		);
	}
}

export default scenario;
