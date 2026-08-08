#!/usr/bin/env bun
import { spawn } from "node:child_process";
// eval-e2e/run.ts — runner F22 (E2E com modelos reais — env-gated).
//
// Uso:
//   RUNECRAFT_E2E=1 bun run eval:e2e                 # rodada completa
//   RUNECRAFT_E2E=1 bun run eval:e2e --pre-tag       # gate pré-tag (F9/D6)
//   bun run eval:e2e --list-scenarios                # offline — lista
//   bun run eval:e2e --dry-run                       # offline — plano
//   bun run eval:e2e --doctor                        # offline — preflight
//   bun run eval:e2e --verbose | --keep              # transcript / preserva repos
//
// Exit codes (contrato F23): 0 tudo pass · 1 fail/fail-infra · 2 cost cap (limit).
// Sem RUNECRAFT_E2E → skip explícito + exit 0 (padrão gentle-ai — D5): CI
// normal fica verde, ZERO tokens. O runner NUNCA roda em bun test/turbo/CI.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./config.ts";
import { isE2EEnabled, resolveConfig, skipMessage } from "./lib/env.ts";
import { runPreflight } from "./lib/preflight.ts";
import { formatDuration } from "./lib/render.ts";
import { writeRoundAtomic } from "./lib/results.ts";
import { executeRound } from "./lib/runner.ts";
import { createRealSession } from "./lib/session.ts";
import { loadScenarios } from "./scenarios/index.ts";
import type { ExecFn, RoundResult, ScenarioModule } from "./types.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const RESULTS_ROOT = path.join(REPO_ROOT, ".specs", "features", "f22-e2e-benchmark", "results");

/** Execução real de comando (injetável nos testes). */
export const realExec: ExecFn = (cmd, args) =>
	new Promise((resolve) => {
		const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		proc.on("error", (error) => resolve({ ok: false, stdout: "", stderr: error.message }));
		proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
	});

const RUN_LOG_DIR = path.join(REPO_ROOT, ".runecraft", "eval-e2e");

/** Abre o log da rodada (D8) — .runecraft/eval-e2e/<timestamp>.log (gitignored). */
function openRoundLog(): string | null {
	try {
		fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
		const file = path.join(RUN_LOG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
		fs.writeFileSync(file, `eval:e2e rodada iniciada ${new Date().toISOString()}\n`);
		return file;
	} catch {
		return null; // log é best-effort — nunca derruba a rodada
	}
}

function appendLog(file: string | null, line: string): void {
	if (file === null) return;
	try {
		fs.appendFileSync(file, `${line}\n`);
	} catch {
		// best-effort
	}
}

function usage(): string {
	return [
		"eval:e2e — benchmark E2E com modelos reais (F22, env-gated RUNECRAFT_E2E=1)",
		"",
		"Uso:",
		"  RUNECRAFT_E2E=1 bun run eval:e2e [flags]",
		"",
		"Flags:",
		"  --list-scenarios   lista os cenários (offline, sem env)",
		"  --dry-run          mostra o plano da rodada (offline, sem env)",
		"  --doctor           roda só o preflight do ambiente (offline)",
		"  --pre-tag          gate pré-tag do release (F9/D6): S0 pass obrigatório",
		"  --model=<id>       override de RUNECRAFT_E2E_MODEL",
		"  --provider=<id>    override de RUNECRAFT_E2E_PROVIDER",
		"  --verbose          transcript da sessão no stdout (também RUNECRAFT_E2E_VERBOSE=1)",
		"  --keep             preserva repos de teste (também RUNECRAFT_E2E_KEEP=1)",
		"",
		"Env:",
		"  RUNECRAFT_E2E=1                        habilita a rodada (obrigatório)",
		"  RUNECRAFT_E2E_MODEL                    modelo (default haiku-class: deepseek-v4-flash)",
		"  RUNECRAFT_E2E_PROVIDER                 provider (default opencode-go)",
		"  RUNECRAFT_E2E_API_KEY                  API key (ou env padrão do provider)",
		"  RUNECRAFT_E2E_BASE_URL / _API          provider custom (opcional)",
		"  RUNECRAFT_E2E_COST_CAP_USD             cap de custo (default 10 — AD-037)",
		"  RUNECRAFT_E2E_PROBE=0                  pula o probe de modelo do preflight",
		"  RUNECRAFT_E2E_MAX_TOKENS               reservado (D7) — cap em USD cobre",
	].join("\n");
}

async function main(argv: string[]): Promise<number> {
	const parsed = parseCliArgs(argv);
	if (!parsed.ok) {
		process.stderr.write(`eval:e2e: ${parsed.error}\n`);
		process.stderr.write(usage());
		return 1;
	}
	const args = parsed.args;
	const env = { ...process.env };
	if (args.verbose) env.RUNECRAFT_E2E_VERBOSE = "1";
	if (args.keep) env.RUNECRAFT_E2E_KEEP = "1";
	if (args.model !== undefined) env.RUNECRAFT_E2E_MODEL = args.model;
	if (args.provider !== undefined) env.RUNECRAFT_E2E_PROVIDER = args.provider;

	const scenarios = await loadScenarios();

	// Surfaces offline (sem env — D5): lista, dry-run, doctor.
	if (args.listScenarios) {
		return listScenarios(scenarios);
	}
	if (args.dryRun) {
		return dryRun(env, scenarios);
	}
	if (args.doctor) {
		return doctor();
	}

	// Gating (D5): sem RUNECRAFT_E2E → skip + exit 0 (CI verde sem tokens).
	if (!isE2EEnabled(env)) {
		process.stdout.write(`${skipMessage()}\n`);
		return 0;
	}

	if (args.preTag) {
		process.stdout.write(
			"modo --pre-tag (D6): a comparação com o baseline do F23 é do ratchet (bun run eval:ratchet --e2e — P2).\n",
		);
	}

	// Log de rodada (D8): .runecraft/eval-e2e/<timestamp>.log — runtime, não
	// evidência (o JSON dos resultados é o versionado). Heartbeat do transcript
	// fica como limite documentado (sessão in-process); o log captura progresso.
	const logPath = openRoundLog();
	const out = (line: string): void => {
		process.stdout.write(`${line}\n`);
		appendLog(logPath, line);
	};
	const err = (line: string): void => {
		process.stderr.write(`${line}\n`);
		appendLog(logPath, line);
	};

	// SIGINT: preserva a rodada parcial (F2 — escrita atômica por cenário já
	// gravou os completos; aqui marcamos partial + interruptedAt).
	let currentRound: { round: RoundResult; path: string } | null = null;
	const onInterrupt = (): void => {
		if (currentRound !== null) {
			const updated = {
				...currentRound.round,
				partial: true,
				interruptedAt: new Date().toISOString(),
			};
			try {
				writeRoundAtomic(currentRound.path, updated);
				process.stdout.write(
					`\nrodada interrompida — parcial preservada em ${currentRound.path}\n`,
				);
			} catch {
				// nada a fazer
			}
		}
		process.exit(130);
	};
	process.on("SIGINT", onInterrupt);
	process.on("SIGTERM", onInterrupt);

	const outcome = await executeRound({
		env,
		repoRoot: REPO_ROOT,
		resultsRoot: RESULTS_ROOT,
		scenarios,
		createSession: createRealSession,
		preflight: runPreflight,
		exec: realExec,
		onRoundUpdate: (round, resultsPath) => {
			currentRound = { round, path: resultsPath };
		},
		out,
		err,
	});

	process.removeListener("SIGINT", onInterrupt);
	process.removeListener("SIGTERM", onInterrupt);
	return outcome.exitCode;
}

function listScenarios(scenarios: ScenarioModule[]): number {
	process.stdout.write(`Cenários E2E (${scenarios.length}):\n`);
	process.stdout.write("| Ordem | ID | name (F23 scenarioId) | Sanity | Timeout | Descrição |\n");
	process.stdout.write("| --- | --- | --- | --- | --- | --- |\n");
	scenarios.forEach((s, i) => {
		process.stdout.write(
			`| ${i} | ${s.id} | ${s.name} | ${s.sanity ? "**sanity**" : ""} | ${formatDuration(s.timeoutMs)} | ${s.description} |\n`,
		);
	});
	process.stdout.write(
		"\nAdicionar um cenário = criar scripts/eval-e2e/scenarios/NN-nome.ts (export default ScenarioModule).\n",
	);
	return 0;
}

function dryRun(env: NodeJS.ProcessEnv, scenarios: ScenarioModule[]): number {
	const resolved = resolveConfig(env);
	const model = resolved.ok
		? `${resolved.config.provider}/${resolved.config.model}`
		: "não resolvido (env incompleto — veja --doctor)";
	process.stdout.write("Plano da rodada E2E (dry-run — nada será executado):\n");
	process.stdout.write(`  modelo: ${model}\n`);
	process.stdout.write(
		`  cost cap: US$ ${resolved.ok ? resolved.config.costCapUsd : "?"} (AD-037)\n`,
	);
	process.stdout.write(`  resultados: ${RESULTS_ROOT}/<harnessVersion>/<roundId>.json\n`);
	process.stdout.write(
		`  cenários (${scenarios.length}): ${scenarios.map((s) => s.name).join(" → ")}\n`,
	);
	if (!isE2EEnabled(env)) {
		process.stdout.write(
			"\n  ⓘ RUNECRAFT_E2E não setado — a rodada real ficaria skipped (zero tokens).\n",
		);
	}
	return 0;
}

async function doctor(): Promise<number> {
	process.stdout.write("Preflight do ambiente E2E (--doctor — nada é executado):\n");
	const result = await runPreflight({ env: process.env, exec: realExec, repoRoot: REPO_ROOT });
	for (const [key, value] of Object.entries(result.environment)) {
		process.stdout.write(`  ${key}: ${value}\n`);
	}
	for (const issue of result.aborts) {
		process.stdout.write(`  ✗ ${issue.check}: ${issue.message}\n    → ${issue.remedy}\n`);
	}
	if (result.confounders.length > 0) {
		process.stdout.write(`  Confundidores: ${result.confounders.join(" · ")}\n`);
	}
	process.stdout.write(
		`gh autenticado: ${result.ghAuthed ? "sim" : "não (COEX-04 → fail-infra)"}\n`,
	);
	return result.ok ? 0 : 1;
}

// Entry — evita rodar quando importado pelos testes (bun test).
const isMain =
	process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			process.stderr.write(
				`eval:e2e: erro fatal: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			process.exitCode = 1;
		});
}
