// eval-e2e/types.ts — tipos compartilhados do runner F22 (E2E com modelos reais).
//
// Contrato F23 (design F23 D1/D5): o campo `name` do cenário é o scenarioId do
// baseline e2e-passrate.txt; `status` ∈ pass|fail|limit|fail-infra (fail-infra
// excluído do pass rate). Os campos aditivos (verdict, environment,
// confounders, …) são opcionais e não quebram o consumidor (design F22 D4).

/** Status de um cenário (contrato F23 — D4 do design F22). */
export type ScenarioStatus = "pass" | "fail" | "limit" | "fail-infra";

/** Check determinístico do harness (veredito nunca vem do modelo — D3). */
export interface Check {
	id: string;
	ok: boolean;
	/** evidência curta (normalizada — sem paths/timestamps absolutos quando possível). */
	detail?: string;
}

/** Uso de tokens exposto pelo SDK (pi-ai Usage — tipos verificados no Execute). */
export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
}

/** Config resolvida da rodada (env — fail-closed quando a API key falta). */
export interface E2EConfig {
	model: string;
	provider: string;
	apiKey: string;
	/** baseUrl/api opcionais (provider custom — env RUNECRAFT_E2E_BASE_URL/API). */
	baseUrl?: string;
	api?: string;
	/** cost cap da rodada em USD (AD-037: US$ 10 default). */
	costCapUsd: number;
	/** taxa de fallback documentada (haiku-class) quando o SDK não expõe cost. */
	rate: RateTable;
	timeouts: ScenarioTimeouts;
	verbose: boolean;
	keep: boolean;
	/** true → sem probe de modelo no preflight (RUNECRAFT_E2E_PROBE=0). */
	skipProbe: boolean;
}

/** Taxas por 1M tokens (fallback documentado — nunca inventado; tabela D7). */
export interface RateTable {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Timeouts por cenário (config.ts — calibrar com a primeira rodada real). */
export interface ScenarioTimeouts {
	helloWorld: number;
	baselineLoad: number;
	goalSubagent: number;
	taskflowGoal: number;
	prReview: number;
	auditorIsolation: number;
}

/** Observações da sessão (F27: emissão real de compaction — evidência). */
export interface SessionObservations {
	compactionEvents: Array<{ type: string; reason?: string; at: number }>;
	agentEnds: number;
	/** nomes de tools invocadas (tool_execution_start — COEX-01/02 evidence). */
	toolCalls: string[];
}

/** Handle da sessão Pi in-process (F21/AD-021 — SDK createAgentSession). */
export interface SessionDriver {
	/** Envia um prompt e aguarda o fim do turno (goal loop continua sozinho). */
	prompt(text: string): Promise<void>;
	/** Aborta a operação corrente e aguarda idle (HALT do cost cap). */
	abort(): Promise<void>;
	/** Tool registrada na sessão? (COEX-01 — baseline load por registro). */
	toolRegistered(name: string): boolean;
	/** Usage acumulado da sessão (message_end + tool results com usage). */
	usage: UsageLike;
	/** tokens aproximados da sessão (totalTokens) — null quando indisponível. */
	tokensApprox: number | null;
	/** Observações de eventos da sessão (compaction etc.). */
	observations: SessionObservations;
	dispose(): void;
}

/** Input da factory de sessão (o runner monta; cenários recebem o driver). */
export interface SessionContext {
	config: E2EConfig;
	repoDir: string;
	agentDir: string;
	env: NodeJS.ProcessEnv;
}

/** Factory da sessão — injetável (testes usam fake; run real usa o SDK). */
export type SessionFactory = (opts: SessionContext) => Promise<SessionDriver>;

/** Contexto por cenário (repo descartável + sessão + ambiente p/ children). */
export interface ScenarioContext {
	config: E2EConfig;
	/** repo git descartável do cenário (cwd da sessão). */
	repoDir: string;
	/** agentDir Pi temp (settings.json + models.json + auth.json). */
	agentDir: string;
	/** env p/ children (PI_CODING_AGENT_DIR etc.). */
	env: NodeJS.ProcessEnv;
	session: SessionDriver;
	keep: boolean;
	log(line: string): void;
}

/** Resultado de UM cenário (checks do harness + notas honestas). */
export interface ScenarioOutcome {
	checks: Check[];
	notes: string[];
	confounders: string[];
	/** override de status (ex.: limit p/ fallback assistido — D3). */
	statusOverride?: ScenarioStatus;
}

/** Módulo de cenário — um arquivo por cenário (lista extensível — D1). */
export interface ScenarioModule {
	/** id estável do F7 (COEX-01..06). */
	id: string;
	/** scenarioId do F23 (campo `name` — ex.: hello-world-sdlc). */
	name: string;
	description: string;
	/** cenário 0 = sanity obrigatório (E2EV-03). */
	sanity?: boolean;
	timeoutMs: number;
	/** cenário exige gh autenticado (COEX-04 — senão fail-infra). */
	needsGh?: boolean;
	run(ctx: ScenarioContext): Promise<ScenarioOutcome>;
}

/** Resultado de UM cenário na rodada (schema D4 — serializado no JSON). */
export interface ScenarioResult {
	id: string;
	name: string;
	status: ScenarioStatus;
	durationMs: number;
	tokensApprox: number | null;
	verdict: { checks: Check[] };
	notes: string[];
	confounders: string[];
}

/** Rodada completa (schema D4 + campos aditivos marcados). */
export interface RoundResult {
	harnessVersion: string;
	piVersion: string | null;
	model: string;
	provider: string;
	date: string;
	roundId: string;
	partial: boolean;
	sanityFailed: boolean;
	interruptedAt: string | null;
	environment: Record<string, string>;
	confounders: string[];
	/** uso do probe de modelo do preflight (aditivo — contabilizado no cap). */
	probe: { tokensApprox: number | null; costUsd: number | null } | null;
	scenarios: ScenarioResult[];
}

/** Resultado do preflight (D2). */
export interface PreflightIssue {
	check: string;
	message: string;
	remedy: string;
}

export interface PreflightResult {
	ok: boolean;
	/** falhas que abortam a rodada (com instruções exatas). */
	aborts: PreflightIssue[];
	/** confundidores registrados (não abortam — D2/D9). */
	confounders: string[];
	environment: Record<string, string>;
	ghAuthed: boolean;
}

/** Execução de comando injetável (testes usam fake). */
export interface ExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

/** Deps injetáveis do runner (offline-testability — HARD CONSTRAINT). */
export interface RunnerDeps {
	env: NodeJS.ProcessEnv;
	repoRoot: string;
	resultsRoot: string;
	scenarios: ScenarioModule[];
	createSession: SessionFactory;
	preflight: (deps: {
		env: NodeJS.ProcessEnv;
		exec: ExecFn;
		repoRoot: string;
	}) => Promise<PreflightResult>;
	exec: ExecFn;
	now?: () => Date;
	/** chamado após cada escrita atômica (run.ts usa p/ marcar partial no Ctrl-C). */
	onRoundUpdate?: (round: RoundResult, resultsPath: string) => void;
	out(line: string): void;
	err(line: string): void;
}

/** Desfecho da rodada (exit codes: 0 pass · 1 fail · 2 cost cap — contrato). */
export interface RunOutcome {
	exitCode: 0 | 1 | 2;
	round: RoundResult | null;
	resultsPath: string | null;
}
