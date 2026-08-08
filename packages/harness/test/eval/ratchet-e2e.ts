// eval/ratchet-e2e.ts — runner E2E pass rate (F23 D5/D6, métrica d; release/manual).
//
// Lê resultados COMMITTED do F22 (results/<versão>/<data>.json — NUNCA roda o
// E2E: zero tokens, zero rede) e compara a rodada mais recente da versão
// atual contra a última rodada de versão ANTERIOR no baseline e2e-passrate.txt
// (fail-only-on-worse; fail-infra excluído do numerador E do denominador —
// D5). Fora do merge gate: `bun run eval:ratchet --e2e` (release/manual).
//
// Exit codes: 0 verde (avisos ok) · 1 regressão (sinalização) · 2 infra/config
// (JSON inválido, sem baseline, rodada inválida, --update recusado/sem rodada
// válida). `--e2e --update` grava a rodada mais recente por versão (aditivo —
// histórico preservado; recusa com CI=true — D6, mesmo contrato do P1).
//
// Paths overrideáveis por env (testes hermeticos — o runner continua lendo
// apenas arquivos commitados, nunca invocando o F22):
//   RUNECRAFT_E2E_RATCHET_RESULTS_ROOT · RUNECRAFT_E2E_RATCHET_BASELINE ·
//   RUNECRAFT_E2E_RATCHET_VERSION
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sortLines } from "../../src/eval/sort.ts";
import { assertUpdateAllowed, UpdateRefusedError } from "./update.ts";

export type E2EStatus = "pass" | "fail" | "limit" | "fail-infra";
const STATUSES: readonly E2EStatus[] = ["pass", "fail", "limit", "fail-infra"];

export interface E2EScenarioLike {
	id?: unknown;
	name?: unknown;
	status?: unknown;
}

export interface E2ERoundLike {
	harnessVersion?: unknown;
	roundId?: unknown;
	date?: unknown;
	partial?: unknown;
	sanityFailed?: unknown;
	model?: unknown;
	scenarios?: unknown;
}

/** Header do baseline e2e-passrate.txt (D1 — sem data na linha; a data vive
 *  no filename do F22). */
export const E2E_PASSRATE_HEADER = [
	"# runecraft harness — E2E pass rate per version (fail-only-on-worse; fail-infra excluded)",
	"# formato: harnessVersion<TAB>scenarioId<TAB>status   (scenarioId = campo `name` do F22 — ex.: hello-world-sdlc)",
	"# gerado por: bun run eval:ratchet --e2e --update",
].join("\n");

/** Comparador de versões (D1 "validar no Execute"): segmentos numéricos por
 *  ".", fallback para a colação pinada (code points) em segmento não numérico.
 *  Determinístico cross-platform — nunca localeCompare. */
export function compareVersions(a: string, b: string): number {
	const sa = a.split(".");
	const sb = b.split(".");
	const n = Math.max(sa.length, sb.length);
	for (let i = 0; i < n; i++) {
		const pa = Number(sa[i]);
		const pb = Number(sb[i]);
		if (Number.isNaN(pa) || Number.isNaN(pb)) {
			// segmento não numérico (ex.: 1.0 vs 1.0.1) → colação pinada
			if (a < b) return -1;
			if (a > b) return 1;
			return 0;
		}
		if (pa !== pb) return pa < pb ? -1 : 1;
	}
	return 0;
}

/** Uma versão do baseline: scenarioId → status (estado efetivo — a última
 *  ocorrência vence porque o arquivo cresce aditivamente). */
export type PassrateEntry = Map<string, string>;

/** Parse do baseline e2e-passrate.txt: Map versão → (scenarioId → status).
 *  Última ocorrência vence (D1: `--update` é aditivo; o bloco mais recente de
 *  uma versão é o estado efetivo). Linhas malformadas são ignoradas. */
export function parsePassrateBaseline(text: string): Map<string, PassrateEntry> {
	const versions = new Map<string, PassrateEntry>();
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (line === "" || line.startsWith("#")) continue;
		const parts = line.split("\t");
		if (parts.length !== 3) continue;
		const [version, scenario, status] = parts;
		if (version === undefined || scenario === undefined || status === undefined) continue;
		let entry = versions.get(version);
		if (entry === undefined) {
			entry = new Map();
			versions.set(version, entry);
		}
		entry.set(scenario, status);
	}
	return versions;
}

/** Serializa o baseline (header + versões por compareVersions, cenários pela
 *  colação pinada). Determinismo byte a byte — mesma ordem da comparação. */
export function serializePassrateBaseline(header: string, versions: Map<string, PassrateEntry>): string {
	const lines: string[] = [];
	for (const version of [...versions.keys()].sort(compareVersions)) {
		const entry = versions.get(version);
		if (entry === undefined) continue;
		for (const scenario of sortLines(entry.keys())) {
			const status = entry.get(scenario);
			if (status !== undefined) lines.push(`${version}\t${scenario}\t${status}`);
		}
	}
	return lines.length === 0 ? `${header}\n` : `${header}\n${lines.join("\n")}\n`;
}

/** Cenário de sanity (cenário 0 — F22: COEX-05, name hello-world-sdlc). */
export function sanityScenario(round: E2ERoundLike): E2EScenarioLike | null {
	const scenarios = Array.isArray(round.scenarios) ? (round.scenarios as E2EScenarioLike[]) : [];
	for (const s of scenarios) {
		if (s.name === "hello-world-sdlc" || s.id === "COEX-05") return s;
	}
	return null;
}

export type RoundValidity = { ok: true } | { ok: false; reason: string };

/** Rodada válida = cenário 0 presente E pass (D5; F22 D4 sanityFailed). */
export function roundValidity(round: E2ERoundLike): RoundValidity {
	if (round.sanityFailed === true) {
		return { ok: false, reason: "sanityFailed: true (F22 D4 — sanity falhou, rodada inválida)" };
	}
	const sanity = sanityScenario(round);
	if (sanity === null) {
		return { ok: false, reason: "cenário 0 (COEX-05 hello-world-sdlc) ausente" };
	}
	if (sanity.status !== "pass") {
		return { ok: false, reason: `cenário 0 (COEX-05 hello-world-sdlc) não passou (status: ${String(sanity.status)})` };
	}
	return { ok: true };
}

export interface PassRate {
	/** pass/(pass+fail+limit) — null quando denominador 0 (inconclusivo). */
	rate: number | null;
	pass: number;
	fail: number;
	limit: number;
	failInfra: number;
}

/** Pass rate com fail-infra excluído do numerador E do denominador (D5). */
export function passRateOf(scenarios: Iterable<E2EScenarioLike>): PassRate {
	let pass = 0;
	let fail = 0;
	let limit = 0;
	let failInfra = 0;
	for (const s of scenarios) {
		switch (s.status) {
			case "pass":
				pass++;
				break;
			case "fail":
				fail++;
				break;
			case "limit":
				limit++;
				break;
			case "fail-infra":
				failInfra++;
				break;
			default:
				break; // status desconhecido — barrado na leitura da rodada
		}
	}
	const denominator = pass + fail + limit;
	return { rate: denominator === 0 ? null : pass / denominator, pass, fail, limit, failInfra };
}

/** Severidade para "piorou" (D5): pass > limit > fail. fail-infra nunca chega
 *  aqui (excluído antes). */
export function severityOf(status: string): number {
	if (status === "pass") return 2;
	if (status === "limit") return 1;
	return 0;
}

export type RoundRead =
	| { ok: true; round: E2ERoundLike; file: string }
	| { ok: false; error: string };

/** Lê e valida o schema de uma rodada (F22 D4). Erro = exit 2 (config). */
export function readRoundFile(file: string): RoundRead {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		return { ok: false, error: `JSON inválido em ${file}: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, error: `schema inválido em ${file}: top-level não é objeto` };
	}
	const round = parsed as E2ERoundLike;
	if (!Array.isArray(round.scenarios)) {
		return { ok: false, error: `schema inválido em ${file}: scenarios não é array` };
	}
	for (const s of round.scenarios as E2EScenarioLike[]) {
		if (typeof s !== "object" || s === null) {
			return { ok: false, error: `schema inválido em ${file}: cenário não é objeto` };
		}
		if (typeof s.name !== "string" || s.name === "") {
			return { ok: false, error: `schema inválido em ${file}: cenário sem name (scenarioId do F23)` };
		}
		if (typeof s.status !== "string" || !STATUSES.includes(s.status as E2EStatus)) {
			return { ok: false, error: `schema inválido em ${file}: status desconhecido (${String(s.status)}) — contrato pass|fail|limit|fail-infra` };
		}
	}
	return { ok: true, round, file };
}

/** Rodada mais recente de results/<version>/ (roundId ISO ordena
 *  lexicograficamente = cronologicamente). null quando não existe. */
export function findLatestRound(resultsRoot: string, version: string): RoundRead | null {
	const dir = path.join(resultsRoot, version);
	let files: string[];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
	} catch {
		return null; // diretório inexistente/inacessível
	}
	if (files.length === 0) return null;
	files.sort();
	const latest = files[files.length - 1];
	if (latest === undefined) return null;
	return readRoundFile(path.join(dir, latest));
}

/** Referência = versão < atual com o MAIOR número no baseline (D1/D5). */
export function referenceVersion(baseline: Map<string, PassrateEntry>, current: string): string | null {
	let ref: string | null = null;
	for (const version of baseline.keys()) {
		if (compareVersions(version, current) < 0 && (ref === null || compareVersions(version, ref) > 0)) {
			ref = version;
		}
	}
	return ref;
}

export interface E2ECompareResult {
	refVersion: string;
	refRate: PassRate;
	curRate: PassRate;
	/** cenários presentes nos dois lados cujo status piorou (D5). */
	worsened: string[];
	/** cenários só na rodada atual com fail/limit (explicam queda sem piora). */
	newNonPass: string[];
	verdict: "regression" | "improved" | "equal";
	/** mensagem LOCKED: `regressão vs v<prev>: 80% → 60% (cenários: ...)`. */
	regressionMessage: string | null;
}

/** Compara a rodada atual contra a rodada de referência (estado efetivo do
 *  baseline — última ocorrência por (versão, cenário)). */
export function compareE2ERound(currentScenarios: E2EScenarioLike[], refVersion: string, refEntry: PassrateEntry): E2ECompareResult {
	const curRate = passRateOf(currentScenarios);
	const refScenarios = [...refEntry.entries()].map(([name, status]) => ({ name, status }));
	const refRate = passRateOf(refScenarios);

	// fail-infra é invisível na comparação (D5 — não conta como regressão).
	const cur = new Map<string, string>();
	for (const s of currentScenarios) {
		if (s.status === "fail-infra") continue;
		if (typeof s.name === "string") cur.set(s.name, String(s.status));
	}

	const worsened: string[] = [];
	const newNonPass: string[] = [];
	for (const [name, status] of cur) {
		const refStatus = refEntry.get(name);
		if (refStatus === undefined) {
			if (status === "fail" || status === "limit") newNonPass.push(name);
			continue;
		}
		if (severityOf(status) < severityOf(refStatus)) worsened.push(name);
	}
	const sortedWorsened = sortLines(worsened);
	const sortedNew = sortLines(newNonPass);

	let verdict: E2ECompareResult["verdict"];
	if (curRate.rate !== null && refRate.rate !== null) {
		if (curRate.rate < refRate.rate) verdict = "regression";
		else if (curRate.rate > refRate.rate) verdict = "improved";
		else verdict = "equal";
	} else {
		verdict = "equal"; // defensivo — rodada válida tem rate ≠ null
	}

	const pct = (rate: number | null): string => (rate === null ? "?" : `${Math.round(rate * 100)}%`);
	const refPct = pct(refRate.rate);
	const curPct = pct(curRate.rate);
	let regressionMessage: string | null = null;
	if (verdict === "regression") {
		regressionMessage =
			sortedWorsened.length > 0
				? `regressão vs v${refVersion}: ${refPct} → ${curPct} (cenários: ${sortedWorsened.join(", ")})`
				: `regressão vs v${refVersion}: ${refPct} → ${curPct} (novos cenários: ${sortedNew.join(", ")})`;
	}
	return { refVersion, refRate, curRate, worsened: sortedWorsened, newNonPass: sortedNew, verdict, regressionMessage };
}

export interface E2ERatchetResult {
	exitCode: number;
	lines: string[];
}

export interface E2ERatchetOpts {
	resultsRoot: string;
	baselinePath: string;
	version: string;
	wantUpdate: boolean;
}

/** Orquestrador da lane E2E (comparação ou --update). Puro — exit codes
 *  retornados (o entry seta process.exitCode). */
export function runE2ERatchet(opts: E2ERatchetOpts): E2ERatchetResult {
	if (opts.wantUpdate) return updateE2EBaseline(opts);
	return compareE2E(opts);
}

function pct(rate: number | null): string {
	return rate === null ? "?" : `${Math.round(rate * 100)}%`;
}

function readFileSafe(file: string): string {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

function roundIdOf(round: E2ERoundLike, file: string): string {
	return typeof round.roundId === "string" ? round.roundId : path.basename(file, ".json");
}

/** Modo comparação (D5) — read-only, estritamente. */
function compareE2E(opts: E2ERatchetOpts): E2ERatchetResult {
	const lines: string[] = [];
	lines.push("runecraft harness — ratchet E2E pass rate (métrica d, F23 P2)");

	const latest = findLatestRound(opts.resultsRoot, opts.version);
	if (latest === null) {
		lines.push(`nenhuma rodada em results/${opts.version}/ — rode o E2E do F22 (RUNECRAFT_E2E=1 bun run eval:e2e) primeiro`);
		lines.push("→ exit 2 (sem resultados — infra/config)");
		return { exitCode: 2, lines };
	}
	if (!latest.ok) {
		lines.push(latest.error);
		lines.push("→ exit 2 (rodada ilegível — infra/config)");
		return { exitCode: 2, lines };
	}
	const round = latest.round;
	const roundId = roundIdOf(round, latest.file);
	const scenarios = Array.isArray(round.scenarios) ? (round.scenarios as E2EScenarioLike[]) : [];

	// Rodada parcial sem cenários completos → inconclusiva (D5: não sinaliza).
	if (round.partial === true && scenarios.length === 0) {
		lines.push(`rodada parcial (${opts.version}/${roundId}.json) sem cenários completos — inconclusiva, não sinaliza (D5)`);
		lines.push("→ VERDE (exit 0)");
		return { exitCode: 0, lines };
	}

	// harnessVersion do JSON deve bater com o diretório (F22 D4 — mesmo contrato).
	if (typeof round.harnessVersion === "string" && round.harnessVersion !== opts.version) {
		lines.push(`rodada mal rotulada: harnessVersion ${round.harnessVersion} no JSON, diretório ${opts.version} — não compara`);
		lines.push("→ exit 2 (rodada mal rotulada — infra/config)");
		return { exitCode: 2, lines };
	}

	const validity = roundValidity(round);
	if (!validity.ok) {
		lines.push(`rodada inválida (${opts.version}/${roundId}.json): ${validity.reason} — não compara (D5)`);
		lines.push("→ exit 2 (rodada inválida — infra/config)");
		return { exitCode: 2, lines };
	}

	const curRate = passRateOf(scenarios);
	const sanity = sanityScenario(round);
	const partialNote = round.partial === true ? " · parcial (compara só cenários completos)" : "";
	lines.push(
		`rodada: results/${opts.version}/${roundId}.json · model ${typeof round.model === "string" ? round.model : "?"} · ${scenarios.length} cenários (${curRate.pass} pass, ${curRate.fail} fail, ${curRate.limit} limit, ${curRate.failInfra} fail-infra excluídas)${partialNote}`,
	);
	lines.push(`sanity: ${String(sanity?.id ?? "?")} ${String(sanity?.name ?? "?")} ${String(sanity?.status ?? "?")}`);

	if (curRate.rate === null) {
		lines.push("pass rate: inconclusivo (denominador 0 — só fail-infra); não sinaliza (D5)");
		lines.push("→ VERDE (exit 0)");
		return { exitCode: 0, lines };
	}

	const baseline = parsePassrateBaseline(readFileSafe(opts.baselinePath));
	const refVersion = referenceVersion(baseline, opts.version);
	if (refVersion === null) {
		lines.push(`sem baseline de versão anterior a v${opts.version} em ${path.basename(opts.baselinePath)} — primeira rodada? rode bun run eval:ratchet --e2e --update para congelar`);
		lines.push("→ exit 2 (sem baseline — infra/config)");
		return { exitCode: 2, lines };
	}
	const refEntry = baseline.get(refVersion);
	if (refEntry === undefined || refEntry.size === 0) {
		lines.push(`baseline da versão v${refVersion} vazio em ${path.basename(opts.baselinePath)} — rode bun run eval:ratchet --e2e --update`);
		lines.push("→ exit 2 (sem baseline — infra/config)");
		return { exitCode: 2, lines };
	}

	const comparison = compareE2ERound(scenarios, refVersion, refEntry);
	const refDenom = comparison.refRate.pass + comparison.refRate.fail + comparison.refRate.limit;
	const curDenom = comparison.curRate.pass + comparison.curRate.fail + comparison.curRate.limit;
	lines.push(`referência: v${refVersion} (baseline) — pass rate ${pct(comparison.refRate.rate)} (${comparison.refRate.pass}/${refDenom})`);
	lines.push(`pass rate: ${pct(comparison.curRate.rate)} (${comparison.curRate.pass}/${curDenom}) vs referência ${pct(comparison.refRate.rate)}`);

	if (comparison.verdict === "regression") {
		lines.push(comparison.regressionMessage ?? "regressão de pass rate");
		lines.push("→ VERMELHO (exit 1) — regressão de pass rate E2E; se conhecida, rode bun run eval:ratchet --e2e --update (nunca em CI)");
		return { exitCode: 1, lines };
	}
	if (comparison.verdict === "improved") {
		lines.push("pass rate melhorou (verde)");
	}
	lines.push("ⓘ aviso: pass rate melhorou/igual — rode bun run eval:ratchet --e2e --update para congelar a rodada como baseline");
	lines.push("→ VERDE (exit 0)");
	return { exitCode: 0, lines };
}

/** Modo --update (D5/D6) — aditivo: appenda a rodada mais recente por versão;
 *  histórico nunca é removido. Recusa com CI=true (D6). */
function updateE2EBaseline(opts: E2ERatchetOpts): E2ERatchetResult {
	const lines: string[] = [];
	lines.push("runecraft harness — ratchet E2E pass rate --update (aditivo — histórico preservado)");

	try {
		assertUpdateAllowed();
	} catch (error) {
		if (error instanceof UpdateRefusedError) {
			lines.push(`refusado: ${error.message}`);
			lines.push("→ exit 2 (--update recusado — infra/config)");
			return { exitCode: 2, lines };
		}
		throw error;
	}

	let versions: string[];
	try {
		versions = fs
			.readdirSync(opts.resultsRoot, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort(compareVersions);
	} catch {
		versions = [];
	}

	const appended = new Map<string, string[]>(); // versão → linhas novas
	let skipped = 0;
	for (const version of versions) {
		const latest = findLatestRound(opts.resultsRoot, version);
		if (latest === null) {
			lines.push(`ⓘ aviso: sem rodada em results/${version}/ — nada a gravar para esta versão`);
			continue;
		}
		if (!latest.ok) {
			lines.push(`ⓘ aviso: ${latest.error} — ignorada`);
			skipped++;
			continue;
		}
		const round = latest.round;
		const roundId = roundIdOf(round, latest.file);
		if (typeof round.harnessVersion === "string" && round.harnessVersion !== version) {
			lines.push(`ⓘ aviso: rodada ${version}/${roundId} com harnessVersion divergente — ignorada`);
			skipped++;
			continue;
		}
		const validity = roundValidity(round);
		if (!validity.ok) {
			lines.push(`ⓘ aviso: rodada ${version}/${roundId} inválida (${validity.reason}) — ignorada (baseline só recebe rodada válida)`);
			skipped++;
			continue;
		}
		// Fix cleric F23 P2: rodada INTERROMPIDA (partial: true — Ctrl-C/SIGTERM
		// do F22) NUNCA vira baseline — cenários ausentes distorcem o pass rate
		// da versão seguinte (infla/desinfla e gera "novos cenários" falsos).
		// F22 design (tabela de riscos): "F23 ignora rodadas marcadas".
		if (round.partial === true) {
			lines.push(`ⓘ aviso: rodada ${version}/${roundId} PARCIAL (interrompida) — ignorada no baseline (F22 design: rodadas marcadas não entram)`);
			skipped++;
			continue;
		}
		const scenarios = Array.isArray(round.scenarios) ? (round.scenarios as E2EScenarioLike[]) : [];
		const entryLines: string[] = [];
		for (const s of scenarios) {
			if (s.status === "fail-infra") continue; // nunca entra no baseline (D5)
			if (typeof s.name !== "string" || s.name === "") continue;
			entryLines.push(`${version}\t${s.name}\t${String(s.status)}`);
		}
		if (entryLines.length === 0) {
			lines.push(`ⓘ aviso: rodada ${version}/${roundId} sem cenários não-infra — nada a gravar`);
			continue;
		}
		appended.set(version, entryLines);
		lines.push(`v${version}: ${entryLines.length} cenários → baseline (results/${version}/${roundId}.json)`);
	}

	if (appended.size === 0) {
		lines.push("nada gravado: nenhuma rodada válida encontrada em results/");
		lines.push("→ exit 2 (sem rodadas válidas — infra/config)");
		return { exitCode: 2, lines };
	}

	const previous = readFileSafe(opts.baselinePath);
	const body = previous.endsWith("\n") ? previous : `${previous}\n`;
	const blocks: string[] = [];
	for (const [version, entryLines] of appended) {
		blocks.push(entryLines.join("\n"));
	}
	fs.mkdirSync(path.dirname(opts.baselinePath), { recursive: true });
	fs.writeFileSync(opts.baselinePath, `${body}${blocks.join("\n")}\n`, "utf8");

	const totalNew = [...appended.values()].reduce((acc, list) => acc + list.length, 0);
	lines.push(`baseline: ${path.basename(opts.baselinePath)} (+${totalNew} linhas; histórico preservado — aditivo)`);
	if (skipped > 0) lines.push(`ⓘ aviso: ${skipped} rodada(s) ignorada(s) (inválida/ilegível/mal rotulada)`);
	lines.push("diff completo na PR (git) — revise antes de commitar");
	lines.push("→ VERDE (exit 0)");
	return { exitCode: 0, lines };
}

/** Fonte da versão (F22 D1): packages/harness/package.json; fallback dev. */
export function resolveHarnessVersion(repoRoot: string): string {
	try {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(repoRoot, "packages", "harness", "package.json"), "utf8"),
		) as { version?: string };
		if (typeof parsed.version === "string" && parsed.version !== "") return parsed.version;
	} catch {
		// fallback abaixo
	}
	return "0.0.0-dev";
}

function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
	const value = env[key];
	return value === undefined || value === "" ? fallback : value;
}

/** Entry da lane E2E (chamado pelo ratchet-run.ts no `--e2e` e pela execução
 *  direta). Resolve paths/versão (env override p/ testes hermeticos). */
export function runE2ERatchetMain(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): E2ERatchetResult {
	// import.meta.dir = packages/harness/test/eval → repo root = 4 níveis acima.
	const repoRoot = path.resolve(import.meta.dir, "../../../..");
	const resultsRoot = envOr(env, "RUNECRAFT_E2E_RATCHET_RESULTS_ROOT", path.join(repoRoot, ".specs", "features", "f22-e2e-benchmark", "results"));
	const baselinePath = envOr(env, "RUNECRAFT_E2E_RATCHET_BASELINE", path.join(import.meta.dir, "baselines", "e2e-passrate.txt"));
	const version = envOr(env, "RUNECRAFT_E2E_RATCHET_VERSION", resolveHarnessVersion(repoRoot));
	return runE2ERatchet({ resultsRoot, baselinePath, version, wantUpdate: argv.includes("--update") });
}

function main(): void {
	const result = runE2ERatchetMain();
	for (const line of result.lines) process.stdout.write(`${line}\n`);
	process.exitCode = result.exitCode;
}

// Execução direta (bun test/eval/ratchet-e2e.ts --e2e). Via ratchet-run.ts é a
// MESMA função (dispatch do --e2e no entry do eval:ratchet) — guard evita
// rodar duas vezes quando importado.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
