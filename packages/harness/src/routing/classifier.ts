// routing/classifier.ts — classificador determinístico PURO (F33, D1/D3;
// RTE-01).
//
// Decisão 3c (AD-022): a rota é decisão de CÓDIGO com thresholds explícitos —
// NUNCA LLM, nunca probabilístico. O keyword-detector do arcanum era
// determinístico (mapa keyword → injection); o que era probabilístico era a
// ORQUESTRAÇÃO do bard (a LLM escolhia a rota). Aqui o PADRÃO vira
// `input features → route decision` (classificador puro) e a SEMÂNTICA das
// categorias vem do prompt-composer (routes.ts).
//
// Regras (D3 — todas em constantes explícitas):
//   - score por rota = Σ (high ×2, medium ×1), case-insensitive, com
//     token-boundary para keywords de palavra única (evita "plan" em
//     "explain"/"plant" e "fix" em "fixture" — calibração EVAL-069);
//   - ROUTE_THRESHOLD = 2: score ≥ 2 → rota; score < 2 → direct (fail-closed;
//     o bard só delegava trabalho substancial);
//   - security = OBRIGATÓRIA: qualquer keyword HIGH de segurança → rota
//     security SEM threshold (espelho do paladin "MUST ... not optional");
//   - empate → prioridade determinística (security > planning > implement >
//     review > research > explore — routes.ts);
//   - features de arquivo: presença de `.specs/.../spec.md` (SDD — specPath
//     injetado pelo caller) OU menção de `.specs/` no texto → +2 planning;
//   - entrada vazia/ilegível → direct (fail-closed);
//   - ZERO I/O dentro do classificador (features injetadas — pureza/teste).
//
// Config opcional (state.routing — config.ts): threshold e rotas
// habilitadas/mandatory via override; defaults = constantes aqui.
import { ROUTE_CATALOG, ROUTE_IDS, type RouteId } from "./routes.ts";

/** Threshold explícito em constante (D3 — calibrado: 1 medium → direct). */
export const ROUTE_THRESHOLD = 2;

/** Peso de keyword high (×2 — D3). */
export const HIGH_SIGNAL_WEIGHT = 2;
/** Peso de keyword medium (×1 — D3). */
export const MEDIUM_SIGNAL_WEIGHT = 1;
/** Bônus de feature SDD (`.specs/.../spec.md` presente/mencionada — D3). */
export const SDD_PLANNING_BONUS = 2;

export interface RouteInput {
  /** texto do prompt/tarefa (primeira mensagem — event.prompt do
   *  before_agent_start; fallback honesto: texto do prompt do evento). */
  text: string;
  /** caminho de um spec SDD presente (`.specs/.../spec.md`) — injetado pelo
   *  caller (extensão resolve o arquivo; zero I/O aqui). */
  specPath?: string | null;
}

export interface RouteScoreOptions {
  /** threshold efetivo (default ROUTE_THRESHOLD — config state.routing). */
  threshold?: number;
  /** rotas habilitadas (default: todas — config state.routing; direct é
   *  SEMPRE o fail-closed e não entra no catálogo de candidatas). */
  enabledRoutes?: ReadonlySet<RouteId>;
  /** overrides de mandatory por rota (config state.routing.routes.<id>). */
  mandatoryOverrides?: Readonly<Partial<Record<RouteId, boolean>>>;
}

export type RouteReason = "mandatory" | "threshold" | "fail-closed" | "empty";

export interface RouteDecision {
  route: RouteId;
  /** score da rota vencedora (0 para direct). */
  score: number;
  /** scores por rota (ordem determinística do ROUTE_IDS — diagnóstico). */
  scores: Record<RouteId, number>;
  reason: RouteReason;
  /** keywords high que acionaram a obrigatoriedade (vazio se não mandatory). */
  mandatoryHits: string[];
}

/** Determina se a feature SDD está presente (specPath injetado OU menção de
 *  `.specs/` no texto — D3: "mencionada/relacionada"). Pura. */
export function sddPresent(input: RouteInput): boolean {
  const specPath = input.specPath;
  if (specPath !== undefined && specPath !== null && specPath.trim() !== "") return true;
  return /\.specs\//i.test(input.text);
}

/** Escapa regex (keywords são dados — sem re-invenção de escape). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keyword puramente alfanumérica → token-boundary; com espaço OU caracteres
 *  não-alfanuméricos (frases, `.env`) → substring literal. Case-insensitive;
 *  determinística (F21 D10). */
export function hasKeyword(text: string, keyword: string): boolean {
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase();
  if (!/^[a-z0-9]+$/.test(needle)) return haystack.includes(needle);
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack);
}

/** Score de UMA rota + high hits (obrigatoriedade). Pura. */
export function scoreRoute(
  text: string,
  keywords: { high: readonly string[]; medium: readonly string[] },
): { score: number; highHits: string[] } {
  let score = 0;
  const highHits: string[] = [];
  for (const keyword of keywords.high) {
    if (hasKeyword(text, keyword)) {
      score += HIGH_SIGNAL_WEIGHT;
      highHits.push(keyword);
    }
  }
  for (const keyword of keywords.medium) {
    if (hasKeyword(text, keyword)) score += MEDIUM_SIGNAL_WEIGHT;
  }
  return { score, highHits };
}

/** Classifica um input → decisão de rota. PURA: mesmo input → mesmo output
 *  byte-idêntico (2 runs — EVAL-067); zero LLM; zero I/O. */
export function classifyRoute(input: RouteInput, opts: RouteScoreOptions = {}): RouteDecision {
  const text = input.text ?? "";
  const scores = Object.fromEntries(ROUTE_IDS.map((id) => [id, 0])) as Record<RouteId, number>;

  if (text.trim() === "") {
    return { route: "direct", score: 0, scores, reason: "empty", mandatoryHits: [] };
  }

  const threshold = opts.threshold ?? ROUTE_THRESHOLD;
  const enabled = opts.enabledRoutes ?? new Set<RouteId>(ROUTE_IDS);
  const mandatoryOf = (id: RouteId): boolean =>
    opts.mandatoryOverrides?.[id] ?? ROUTE_CATALOG[id].mandatory;

  // SDD feature → +2 planning (D3; só quando planning habilitada).
  if (enabled.has("planning") && sddPresent(input)) {
    scores.planning += SDD_PLANNING_BONUS;
  }

  // Scores por rota (high ×2, medium ×1) — ordem determinística do ROUTE_IDS.
  const highHitsByRoute: Record<RouteId, string[]> = {
    explore: [],
    research: [],
    review: [],
    implement: [],
    planning: [],
    security: [],
    direct: [],
  };
  for (const route of ROUTE_IDS) {
    if (route === "direct") continue;
    if (!enabled.has(route)) continue;
    const definition = ROUTE_CATALOG[route];
    const { score, highHits } = scoreRoute(text, definition.keywords);
    scores[route] += score;
    highHitsByRoute[route] = highHits;
  }

  // security OBRIGATÓRIA: high-signal bypassa o threshold (paladin — D3).
  const securityHigh = highHitsByRoute.security;
  if (enabled.has("security") && mandatoryOf("security") && securityHigh.length > 0) {
    return {
      route: "security",
      score: scores.security,
      scores,
      reason: "mandatory",
      mandatoryHits: securityHigh,
    };
  }

  // Candidatas: score ≥ threshold (fail-closed — nada abaixo da linha).
  const candidates = (Object.keys(scores) as RouteId[]).filter(
    (id) => id !== "direct" && enabled.has(id) && scores[id] >= threshold,
  );
  if (candidates.length === 0) {
    return { route: "direct", score: 0, scores, reason: "fail-closed", mandatoryHits: [] };
  }

  // Vencedora: maior score; empate → prioridade (maior vence — D3).
  candidates.sort((a, b) => {
    const byScore = scores[b]! - scores[a]!;
    if (byScore !== 0) return byScore;
    return ROUTE_CATALOG[b].priority - ROUTE_CATALOG[a].priority;
  });
  const winner = candidates[0]!;
  return {
    route: winner,
    score: scores[winner]!,
    scores,
    reason: "threshold",
    mandatoryHits: [],
  };
}
