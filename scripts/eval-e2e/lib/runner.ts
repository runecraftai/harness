// eval-e2e/lib/runner.ts — orquestração da rodada (F1 do design).
//
// Fluxo: preflight → probe de modelo (barato, <30s — D2) → cenários em ordem
// fixa (S0 sanity primeiro) → escrita atômica por cenário → resumo + exit.
// HALT do cost cap (AD-037): ledger estourou → cenário atual vira `limit`,
// rodada parcial, exit 2. S0 ≠ pass → rodada inválida (sanityFailed) e aborta
// (economia de tokens — D3). Exit codes: 0 pass · 1 fail/fail-infra · 2 cap.
//
// TODAS as deps são injetáveis (HARD CONSTRAINT: offline-testability — os
// testes usam cenários/sessão/exec fake; o caminho real é env-gated).
import * as fs from "node:fs";
import * as path from "node:path";
import type {
	E2EConfig,
	RoundResult,
	RunOutcome,
	RunnerDeps,
	ScenarioContext,
	ScenarioModule,
	ScenarioResult,
	SessionDriver,
} from "../types.ts";
import { materializeAgentDir } from "./agentDir.ts";
import { classifyExecutionFailure, infraNote } from "./classify.ts";
import { resolveConfig } from "./env.ts";
import { runPreflight } from "./preflight.ts";
import { progressLine, resultLine, summaryTable } from "./render.ts";
import { createRepoFixture } from "./repoFixture.ts";
import { roundIdFromDate, roundPath, writeRoundAtomic } from "./results.ts";
import { CostLedger } from "./usage.ts";
import { allPass } from "./verdict.ts";

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_PROMPT = "Reply with exactly: OK";

/** Resolve a harnessVersion: package.json do umbrella, fallback git describe. */
export function resolveHarnessVersion(repoRoot: string): string {
	const pkg = path.join(repoRoot, "packages", "harness", "package.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: string };
		if (typeof parsed.version === "string" && parsed.version !== "") return parsed.version;
	} catch {
		// fallback abaixo
	}
	try {
		const { execSync } = requireChildProcess();
		const describe = execSync("git describe --always", { cwd: repoRoot, encoding: "utf8" }).trim();
		return `0.0.0-dev-${describe}`;
	} catch {
		return "0.0.0-dev";
	}
}

/** Builda o env dos children (herda o processo + agentDir isolado). */
export function childEnv(agentDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const gllaSettings = path.join(agentDir, "glla-settings.json");
	try {
		if (!fs.existsSync(gllaSettings)) fs.writeFileSync(gllaSettings, "{}\n");
	} catch {
		// best-effort — o glla cai no default sem o arquivo
	}
	return {
		...env,
		PI_CODING_AGENT_DIR: agentDir,
		GLLA_GLOBAL_SETTINGS_PATH: gllaSettings,
	};
}

export async function executeRound(deps: RunnerDeps): Promise<RunOutcome> {
	const { env, repoRoot, resultsRoot, scenarios, out, err } = deps;

	// Contrato do sanity (E2EV-03): cenário 0 é obrigatório e marcado sanity.
	const first = scenarios[0];
	if (first === undefined) {
		err("Nenhum cenário registrado — scripts/eval-e2e/scenarios/ está vazio?");
		return { exitCode: 1, round: null, resultsPath: null };
	}
	if (!first.sanity) {
		err(
			`Cenário 0 (${first.id}) não está marcado como sanity — hello world deve ser o cenário 0 (E2EV-03).`,
		);
		return { exitCode: 1, round: null, resultsPath: null };
	}

	// Config fail-closed (API key só do env — mensagem clara).
	const resolved = resolveConfig(env);
	if (!resolved.ok) {
		err(resolved.error);
		return { exitCode: 1, round: null, resultsPath: null };
	}
	const config = resolved.config;

	// Preflight: aborta com instruções exatas quando o ambiente não isola.
	const preflight = await deps.preflight({ env, exec: deps.exec, repoRoot });
	if (!preflight.ok) {
		for (const issue of preflight.aborts) {
			err(`✗ ${issue.check}: ${issue.message}`);
			err(`  → ${issue.remedy}`);
		}
		return { exitCode: 1, round: null, resultsPath: null };
	}

	const now = deps.now ?? (() => new Date());
	const startedAt = now();
	const roundId = roundIdFromDate(startedAt);
	const harnessVersion = resolveHarnessVersion(repoRoot);
	const resultsPath = roundPath(resultsRoot, harnessVersion, roundId);

	const round: RoundResult = {
		harnessVersion,
		piVersion: preflight.environment.piVersion ?? null,
		model: config.model,
		provider: config.provider,
		date: startedAt.toISOString(),
		roundId,
		partial: false,
		sanityFailed: false,
		interruptedAt: null,
		environment: preflight.environment,
		confounders: [...preflight.confounders],
		probe: null,
		scenarios: [],
	};

	const agent = materializeAgentDir(config, repoRoot);
	const ledger = new CostLedger(config.costCapUsd, config.rate);
	const envForChildren = childEnv(agent.agentDir, env);
	let probeSession: SessionDriver | null = null;
	try {
		// Probe de modelo (D2): 1 chamada trivial < 30s — evita gastar uma
		// rodada inteira com modelo indisponível/rate limit. Uso contabilizado.
		if (!config.skipProbe) {
			out("probe de modelo (1 chamada trivial)…");
			probeSession = await deps.createSession({
				config,
				repoDir: agent.agentDir,
				agentDir: agent.agentDir,
				env: envForChildren,
			});
			let probeResult: { ok: boolean; error?: string };
			try {
				const ok = await withTimeout(probeSession.prompt(PROBE_PROMPT), PROBE_TIMEOUT_MS, "probe");
				probeResult = ok.ok ? { ok: true } : { ok: false, error: ok.error };
			} catch (error) {
				probeResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			if (!probeResult.ok) {
				probeSession.abort().catch(() => {});
				disposeSession(probeSession);
				probeSession = null;
				err(`✗ probe de modelo falhou (${probeResult.error}) — modelo indisponível ou rate limit.`);
				err(
					"  Re-tente em outro momento ou troque o modelo (RUNECRAFT_E2E_MODEL). Rodada não iniciada.",
				);
				return { exitCode: 1, round: null, resultsPath: null };
			}
			ledger.record(probeSession.usage);
			round.probe = {
				tokensApprox: probeSession.tokensApprox,
				costUsd: ledger.summary().costUsd,
			};
			disposeSession(probeSession);
			probeSession = null;
		}

		for (let index = 0; index < scenarios.length; index += 1) {
			if (ledger.isCapped) break; // HALT — cenários restantes não rodam (D7)
			const scenario = scenarios[index];
			if (scenario === undefined) continue;
			out(progressLine(index, scenarios.length, scenario, 0));
			const scenarioResult = await runOneScenario({
				config,
				scenario,
				agentDir: agent.agentDir,
				env: envForChildren,
				ledger,
				ghAuthed: preflight.ghAuthed,
				createSession: deps.createSession,
				out: deps.out,
				now,
			});
			round.scenarios.push(scenarioResult);
			out(resultLine(scenarioResult));

			// HALT do cost cap (AD-037 — HALT semantics: status limit + parcial).
			// O cenário que estourou o cap vira `limit` (a rodada foi abortada —
			// os checks ficam no verdict e a nota explica; o cap é verificado
			// ENTRE cenários — um cenário individual é limitado pelo timeout).
			if (ledger.isCapped) {
				round.partial = true;
				round.interruptedAt = now().toISOString();
				const last = round.scenarios.length - 1;
				const prev = round.scenarios[last];
				if (prev !== undefined && prev.status !== "limit") {
					round.scenarios[last] = {
						...prev,
						status: "limit",
						notes: [...prev.notes, `cost cap atingido (${ledger.accountingText()}) — HALT`],
					};
				}
				out(
					`✗ cost cap atingido: ${ledger.accountingText()} — HALT (cenários restantes não rodam).`,
				);
				writeRoundAtomic(resultsPath, round);
				deps.onRoundUpdate?.(round, resultsPath);
				break;
			}
			// Sanity (E2EV-03/D3): S0 ≠ pass invalida a rodada → aborta.
			if (scenario.sanity && scenarioResult.status !== "pass") {
				round.sanityFailed = true;
				round.partial = true;
				round.interruptedAt = now().toISOString();
				writeRoundAtomic(resultsPath, round);
				deps.onRoundUpdate?.(round, resultsPath);
				out(
					`✗ sanity (${scenario.name}) ${scenarioResult.status} — rodada inválida como evidência (F23 não compara).`,
				);
				break;
			}
			writeRoundAtomic(resultsPath, round);
			deps.onRoundUpdate?.(round, resultsPath);
		}

		out(summaryTable(round));
		const exitCode = resolveExitCode(round, ledger.isCapped);
		if (exitCode === 2) out(`exit 2 — cost cap atingido (${ledger.accountingText()}).`);
		else if (exitCode === 1) out("exit 1 — há falha(s) na rodada (veja o JSON).");
		else
			out(
				`exit 0 — rodada completa (${round.scenarios.length} cenários, ${ledger.accountingText()}).`,
			);
		out(`resultados: ${resultsPath}`);
		return { exitCode, round, resultsPath };
	} finally {
		if (probeSession !== null) {
			try {
				probeSession.dispose();
			} catch {
				// já descartada — ok
			}
		}
		agent.cleanup();
	}
}

interface ScenarioRunInput {
	config: E2EConfig;
	scenario: ScenarioModule;
	agentDir: string;
	env: NodeJS.ProcessEnv;
	ledger: CostLedger;
	ghAuthed: boolean;
	createSession: RunnerDeps["createSession"];
	out: RunnerDeps["out"];
	now: () => Date;
}

async function runOneScenario(input: ScenarioRunInput): Promise<ScenarioResult> {
	const { config, scenario, agentDir, env, ledger, ghAuthed, createSession, out, now } = input;
	const startedAt = now();
	const repo = createRepoFixture(scenario.name);
	let session: SessionDriver | null = null;

	let checks: ScenarioResult["verdict"]["checks"] = [];
	let notes: string[] = [];
	let confounders: string[] = [];
	let status: ScenarioResult["status"];

	try {
		// gh ausente + cenário que exige PR → fail-infra SEM rodar (economia).
		if (scenario.needsGh && !ghAuthed) {
			status = "fail-infra";
			notes = [infraNote("gh não autenticado — necessário para criar PR de teste (COEX-04)")];
			confounders = ["gh ausente (preflight registrou)"];
		} else {
			session = await createSession({ config, repoDir: repo.dir, agentDir, env });
			const ctx: ScenarioContext = {
				config,
				repoDir: repo.dir,
				agentDir,
				env,
				session,
				keep: config.keep,
				log: (line) => out(`  ${line}`),
			};
			const outcome = await withTimeout(scenario.run(ctx), scenario.timeoutMs, scenario.id);
			if (!outcome.ok) {
				// Timeout → limit (limite documentável — D7), nunca fail; aborta a
				// sessão para parar o trabalho em background (HALT suave).
				status = "limit";
				notes = [`timeout de ${Math.round(scenario.timeoutMs / 1000)}s — limite documentável`];
				session.abort().catch(() => {});
			} else if (outcome.value.statusOverride !== undefined) {
				status = outcome.value.statusOverride;
				checks = outcome.value.checks;
				notes = outcome.value.notes;
				confounders = outcome.value.confounders;
			} else {
				checks = outcome.value.checks;
				notes = outcome.value.notes;
				confounders = outcome.value.confounders;
				status = allPass(checks) ? "pass" : "fail";
			}
			// Uso REAL da sessão → ledger (o cap contabiliza tudo, inclusive o probe).
			ledger.record(session.usage);
			// Observação de compaction (F27 — evidência honesta quando ocorrer).
			if (session.observations.compactionEvents.length > 0) {
				confounders.push(
					`compaction emitido: ${session.observations.compactionEvents.map((e) => `${e.type}${e.reason ? `(${e.reason})` : ""}`).join(", ")}`,
				);
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		status = classifyExecutionFailure(error, message);
		notes = [status === "fail-infra" ? infraNote(message) : `falha na execução: ${message}`];
		if (session !== null) ledger.record(session.usage);
	} finally {
		disposeSession(session);
		if (!config.keep) repo.cleanup();
	}

	return {
		id: scenario.id,
		name: scenario.name,
		status,
		durationMs: now().getTime() - startedAt.getTime(),
		tokensApprox: session?.tokensApprox ?? null,
		verdict: { checks },
		notes,
		confounders,
	};
}

function disposeSession(session: SessionDriver | null): void {
	if (session === null) return;
	try {
		session.dispose();
	} catch {
		// já descartada — ok
	}
}

/** Resolve o exit code da rodada (contrato: 0 pass · 1 fail · 2 cost cap). */
export function resolveExitCode(round: RoundResult, capped: boolean): 0 | 1 | 2 {
	if (capped) return 2;
	const anyNonPass = round.scenarios.some((s) => s.status === "fail" || s.status === "fail-infra");
	return anyNonPass || round.sanityFailed ? 1 : 0;
}

/** Run com timeout: {ok:true} no sucesso; {ok:false,error} SÓ no timeout. As
 *  rejeições do promise PROPAGAM (o caller classifica — fail-infra etc.). */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then((value) => ({ ok: true as const, value })),
			new Promise<{ ok: false; error: string }>((resolve) => {
				timer = setTimeout(() => resolve({ ok: false, error: `timeout (${label})` }), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function requireChildProcess(): typeof import("node:child_process") {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("node:child_process") as typeof import("node:child_process");
}
