// src/extensions/routing.ts — wiring Pi do F33 (D1/D6; RTE-03/06).
//
// Registra a camada de roteamento codificado como extensão Pi. O wiring é
// THIN — a decisão vive nos módulos puros de src/routing/:
//
//   session_start      → freeze config `routing` (F24 D12) + reset do freeze
//                        por sessão (nova sessão = nova decisão)
//   before_agent_start → kill switch RUNECRAFT_ROUTING=0 → inerte;
//                        two-driver (F19 sessionDriver — goal-loop dirige) →
//                        INERTE (o loop é o piloto; ROUTING.md §2);
//                        classifica o texto da PRIMEIRA MENSAGEM
//                        (event.prompt — validado no Execute: o tipo
//                        BeforeAgentStartEvent do SDK 0.81.0 declara
//                        `prompt: string` = "The raw user prompt text
//                        (after expansion)" — types.d.ts:518; o prompt do
//                        evento É a 1ª mensagem — fallback honesto = o
//                        mecanismo primário); decide a rota UMA vez por
//                        sessão (freeze — subagentes/steps herdam a MESMA
//                        decisão; sem re-classificação por spawn);
//                        rota ≠ direct → verifica a chain em .pi/chains/
//                        (ausente → fail-closed direct + warn — nunca
//                        inventa); anexa o ROUTING DIRECTIVE ao systemPrompt
//                        (ENCADEADO — mesmo padrão F27/F28/F30; marker
//                        `<!-- runecraft:routing -->`)
//
// Kill switch RUNECRAFT_ROUTING=0 → camada INERTE (nenhum rewrite, nenhuma
// decisão — F20/D6). Erro/exception → nenhum rewrite (fail-closed — D1; a
// rota vira direct implícita) + warn no log. Nada de console.log: log
// dedicado em stderr (regra do guild).
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { roleList, type RoleDefinition } from "../agents/catalog.ts";
import { detectActiveDriver, type DriverState } from "../sessionDriver.ts";
import { SessionRoutingConfig, enabledRoutes, mandatoryOf } from "../routing/config.ts";
import { classifyRoute, type RouteDecision } from "../routing/classifier.ts";
import { chainForRoute } from "../routing/routes.ts";
import { renderRoutingDirective } from "../routing/directive.ts";

/** Logger dedicado (regra do guild: sem console.log; stderr, não stdout). */
const log = {
  debug(message: string): void {
    if (process.env.RUNECRAFT_ROUTING_DEBUG === "1" || process.env.RUNECRAFT_ROUTING_DEBUG === "true") {
      process.stderr.write(`[runecraft:routing] ${message}\n`);
    }
  },
  warn(message: string): void {
    process.stderr.write(`[runecraft:routing] warn: ${message}\n`);
  },
};

/** Diretório onde o fork subagents descobre as chains (<root>/.pi/chains/). */
export const PILOT_CHAINS_DIR = path.join(".pi", "chains");

export interface RoutingDeps {
  /** env override (testes) — default process.env. */
  env?: NodeJS.ProcessEnv;
  /** identity de sessão injetável — default ctx.sessionManager.getSessionId(). */
  sessionId?: (ctx: ExtensionContext) => string | null;
  /** driver detection injetável (testes) — default detectActiveDriver (F19). */
  detectDriver?: (cwd: string) => DriverState;
  /** resolve o spec SDD presente (testes) — default resolveSpecPath. */
  resolveSpecPath?: (cwd: string) => string | null;
  /** verifica a chain materializada (testes) — default chainExists. */
  chainExists?: (cwd: string, chain: string) => boolean;
  /** papéis do catalog F32 (testes) — default roleList(). */
  roles?: () => readonly RoleDefinition[];
  /** sink de warn (testes) — default log.warn. */
  warn?: (message: string) => void;
}

/** Path do spec SDD presente: `.specs/.../spec.md` (v1 — `.specs/features/
 *  <slug>/spec.md`, o padrão de scaffold do F30; scan determinístico com
 *  ordenação estável). Ausente → null. */
export function resolveSpecPath(cwd: string): string | null {
  const specsDir = path.join(cwd, ".specs");
  if (!fs.existsSync(specsDir)) return null;
  const featuresDir = path.join(specsDir, "features");
  if (fs.existsSync(featuresDir)) {
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(featuresDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return null;
    }
    for (const name of entries) {
      const candidate = path.join(featuresDir, name, "spec.md");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  // Fallback genérico: qualquer `spec.md` diretamente sob um subdir de
  // `.specs` (determinístico — ordenação estável).
  try {
    const subs = fs
      .readdirSync(specsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const sub of subs) {
      const candidate = path.join(specsDir, sub, "spec.md");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

/** Chain materializada presente em <cwd>/.pi/chains/<chain>? */
export function chainExists(cwd: string, chain: string): boolean {
  try {
    return fs.existsSync(path.join(cwd, PILOT_CHAINS_DIR, chain));
  } catch {
    return false;
  }
}

/** Estado congelado da sessão (um por processo de extensão — F24 D12). */
interface SessionRoutingState {
  sessionId: string | null;
  decision: RouteDecision | null;
  chain: string | null;
}

/**
 * Registra a camada de routing no Pi. Carregado apenas em sessões gerenciadas
 * pelo harness (manifest pi.extensions / settings.json do fixture).
 */
export function installRouting(pi: ExtensionAPI, deps: RoutingDeps = {}): void {
  const env = deps.env ?? process.env;
  const sessionConfig = new SessionRoutingConfig(env);

  const state: SessionRoutingState = { sessionId: null, decision: null, chain: null };

  const sessionIdOf = (ctx: ExtensionContext): string | null => {
    if (deps.sessionId) return deps.sessionId(ctx);
    try {
      return ctx.sessionManager.getSessionId() ?? null;
    } catch {
      return null;
    }
  };

  const warn = deps.warn ?? log.warn;
  const detectDriver = deps.detectDriver ?? detectActiveDriver;
  const resolveSpec = deps.resolveSpecPath ?? resolveSpecPath;
  const chainPresent = deps.chainExists ?? chainExists;
  const roles = deps.roles ?? roleList;

  /** Decide a rota UMA vez por sessão (freeze — D6); chain ausente →
   *  fail-closed direct + warn (D4 — nunca inventa rota/chain). */
  const resolveDecision = (cwd: string, text: string): void => {
    const frozen = sessionConfig.frozen(cwd);
    const input = { text, specPath: resolveSpec(cwd) };
    const decision = classifyRoute(input, {
      threshold: frozen.config.threshold.direct,
      enabledRoutes: enabledRoutes(frozen.config),
      mandatoryOverrides: Object.fromEntries(
        (Object.keys(frozen.config.routes) as (keyof typeof frozen.config.routes)[]).map((id) => [id, mandatoryOf(frozen.config, id)]),
      ),
    });
    if (decision.route === "direct") {
      state.decision = decision;
      state.chain = null;
      return;
    }
    const chain = chainForRoute(decision.route);
    if (chain === null || !chainPresent(cwd, chain)) {
      warn(`chain ausente para a rota ${decision.route} (${chain ?? "sem chain no catálogo"}) — fail-closed: direct (nunca inventa rota/chain)`);
      state.decision = { ...decision, route: "direct", score: 0, reason: "fail-closed", mandatoryHits: [] };
      state.chain = null;
      return;
    }
    state.decision = decision;
    state.chain = chain;
    log.debug(`routing decision: ${decision.route} (score ${decision.score}) — chain ${chain}`);
  };

  // ---------------------------------------------------------------
  // session_start — freeze config + reset do freeze por sessão (D6)
  // ---------------------------------------------------------------
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
    void event;
    sessionConfig.capture(ctx.cwd);
    const frozen = sessionConfig.frozen(ctx.cwd);
    for (const problem of frozen.problems) warn(`config: ${problem}`);
    state.sessionId = sessionIdOf(ctx);
    state.decision = null;
    state.chain = null;
    if (frozen.killSwitch || !frozen.config.enabled) {
      log.debug("routing layer inert (kill switch or disabled)");
    }
  });

  // ---------------------------------------------------------------
  // before_agent_start — decisão determinística + directive encadeado
  // ---------------------------------------------------------------
  pi.on(
    "before_agent_start",
    (event: BeforeAgentStartEvent, ctx: ExtensionContext): { systemPrompt?: string } | undefined => {
      const frozen = sessionConfig.frozen(ctx.cwd);
      if (frozen.killSwitch || !frozen.config.enabled) return undefined;

      // Two-driver (F19/ROUTING.md §2): sessão supervisionada pelo goal-loop
      // → o LOOP é o piloto; routing INERTE (nenhum directive — D6).
      const driver = detectDriver(ctx.cwd);
      if (driver === "goal-loop") {
        log.debug("routing inert — goal-loop is the driver (two-driver rule)");
        return undefined;
      }

      // Freeze por sessão (D6): mesma decisão para toda a sessão — sem
      // re-classificação por passo/spawn (edge case da spec).
      const sessionId = sessionIdOf(ctx);
      if (sessionId !== null && state.sessionId !== sessionId) {
        state.sessionId = sessionId;
        state.decision = null;
        state.chain = null;
      }
      if (state.decision === null) {
        try {
          // Primeira mensagem do usuário: event.prompt É o texto cru do prompt
          // (types.d.ts:518 — "The raw user prompt text (after expansion)");
          // classificação determinística de texto (STOP RULES — sem evento de
          // input no surface usado; o prompt do evento é o fallback honesto).
          resolveDecision(ctx.cwd, event.prompt ?? "");
        } catch (error) {
          // Fail-closed (D1): erro → nenhum rewrite, rota = direct implícita.
          warn(`classificação falhou — sessão segue sem directive (fail-closed): ${error instanceof Error ? error.message : String(error)}`);
          state.decision = null;
          state.chain = null;
          return undefined;
        }
      }
      if (state.decision === null || state.decision.route === "direct") return undefined;

      const directive = renderRoutingDirective(state.decision, state.chain, roles());
      if (directive === null) return undefined;
      log.debug(`routing directive injected (route ${state.decision.route})`);
      // ENCADEADO (não sobrescreve outras extensões — runner.js re-passou o
      // systemPrompt por extensão): anexa ao systemPrompt corrente.
      return { systemPrompt: `${event.systemPrompt}\n\n${directive}` };
    },
  );
}

/** Factory da extensão (convenção do SDK — jiti.import resolve o DEFAULT
 *  export; mesmo padrão dos extensions/guards.ts do F24). */
export default function registerRouting(pi: ExtensionAPI): void {
  installRouting(pi);
}
