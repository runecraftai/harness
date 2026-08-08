// routing/routes.ts — catálogo de rotas como DADOS (F33, D2/D3; RTE-02).
//
// Port da SEMÂNTICA de categorias do bard (src/agents/bard/prompt-composer.ts
// do arcanum — lido): o bard DECIDIA a rota por LLM a partir de sinais
// textuais; aqui os sinais viram DADOS (keywords high/medium por rota) e a
// decisão vira CÓDIGO puro (classifier.ts — decisão 3c). O MECANISMO
// probabilístico NÃO é portado — só a semântica de categoria (o que
// prompt-composer descrevia como "Simple tasks → do them yourself",
// "Substantial work → delegate", rogue=recon primeiro, warlock=pesquisa,
// wizard=planejamento, fighter=execução, cleric=review, paladin=OBRIGATÓRIO
// em auth/crypto/tokens/secrets/passwords/sessions/CORS/OAuth/OIDC/SAML/
// input validation).
//
// Papel = id do catalog do F32 (src/agents/catalog.ts — fonte única, lida
// read-only); chain = asset .chain.md da rota (D4 — 1:1 no v1; review/direct
// não têm chain de piloto no v1 → fail-closed direct + warn quando resolvida).
// Prioridade determinística em empate: security > planning > implement >
// review > research > explore (D3 — testada em EVAL-071).
//
// Módulo PURO (F21 D10): mesmo input → mesmo output byte-idêntico.
import type { RoleId } from "../agents/catalog.ts";

export const ROUTE_IDS = [
  "explore",
  "research",
  "review",
  "implement",
  "planning",
  "security",
  "direct",
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

/** Rotas delegáveis (tudo exceto direct — o fail-closed). */
export const DELEGATABLE_ROUTE_IDS = ROUTE_IDS.filter((id) => id !== "direct") as Exclude<
  RouteId,
  "direct"
>[];

/** Sinais textuais de uma rota (semântica do prompt-composer — D3). */
export interface RouteKeywords {
  /** sinais FORTES — pontuam ×2 (paladin = obrigatório; "substantial work"). */
  high: string[];
  /** sinais médios — pontuam ×1 (categorias adjacentes). */
  medium: string[];
}

export interface RouteDefinition {
  id: RouteId;
  /** papel F32 alvo (catalog.ts read-only); direct → null (fail-closed). */
  role: RoleId | null;
  /** asset da chain de piloto (.chain.md — D4); null = sem chain no v1
   *  (review/direct → rota resolvida sem chain = fail-closed direct + warn). */
  chain: string | null;
  keywords: RouteKeywords;
  /** prioridade em empate (maior vence — D3). */
  priority: number;
  /** rota OBRIGATÓRIA: high-signal bypassa o threshold (espelho do paladin
   *  "MUST ... not optional" — D3). */
  mandatory: boolean;
  /** descrição curta e objetiva (docs/directive — zero RPG). */
  description: string;
}

/** Keywords extraídas da semântica REAL do prompt-composer do bard (D3):
 *  explore = recon (rogue — "delegar PRIMEIRO"), research = pesquisa externa
 *  (warlock), implement = trabalho substancial (fighter /start-work),
 *  review = revisão pós-mudança (cleric — 3+ arquivos), security = paladin
 *  OBRIGATÓRIO, planning = planejamento pré-implementação (wizard — PLAN →
 *  REVIEW → EXECUTE). Calibração empírica nos evals EVAL-067..071 (F21 D10 —
 *  sem invenção de comportamento). */
export const ROUTE_CATALOG: Record<RouteId, RouteDefinition> = {
  explore: {
    id: "explore",
    role: "scout",
    chain: "explore.chain.md",
    keywords: {
      high: ["locate", "trace", "where is", "find where", "map the codebase", "codebase recon", "recon"],
      medium: ["explore", "navigate", "codebase", "understand the code", "module boundaries"],
    },
    priority: 1,
    mandatory: false,
    description: "Codebase reconnaissance (read-only) — scout",
  },
  research: {
    id: "research",
    role: "researcher",
    chain: "research.chain.md",
    keywords: {
      high: ["research", "look up docs", "look up documentation", "external docs", "check the docs", "search the web", "read the docs", "find documentation"],
      medium: ["documentation", "sources", "cite", "best practices", "compare"],
    },
    priority: 2,
    mandatory: false,
    description: "External research with cited sources — researcher",
  },
  review: {
    id: "review",
    role: "reviewer",
    chain: null,
    keywords: {
      high: ["review", "validate", "check my work", "approve", "verify my changes", "code review", "review my"],
      medium: ["assess", "quality", "verdict", "audit", "verify", "feedback", "check the"],
    },
    priority: 3,
    mandatory: false,
    description: "Read-only review with a structured verdict — reviewer",
  },
  implement: {
    id: "implement",
    role: "builder",
    chain: "implement.chain.md",
    keywords: {
      high: ["implement", "build", "refactor", "add feature", "port", "fix", "execute the plan", "write the code", "create the"],
      medium: ["modify", "update", "edit", "create", "add", "execute", "code changes", "todo list"],
    },
    priority: 4,
    mandatory: false,
    description: "Implementation execution — builder",
  },
  planning: {
    id: "planning",
    role: "planner",
    chain: "plan.chain.md",
    keywords: {
      high: ["plan", "planning", "break down", "roadmap", "spec", "specification", "design", "redesign", "scope", "task list", "decompose", "estimate", "architecture"],
      medium: ["outline", "approach", "strategy", "steps", "todos", "milestones", "requirements"],
    },
    priority: 5,
    mandatory: false,
    description: "Planning before substantial implementation — planner",
  },
  security: {
    id: "security",
    role: "security",
    chain: "security.chain.md",
    keywords: {
      high: [
        "auth",
        "authentication",
        "authorization",
        "crypto",
        "cryptographic",
        "token",
        "tokens",
        "secret",
        "secrets",
        "password",
        "passwords",
        "session",
        "sessions",
        "cors",
        "oauth",
        "oidc",
        "saml",
        ".env",
        "input validation",
        "signature",
        "signatures",
        "csrf",
        "xss",
        "credential",
        "credentials",
        "encrypt",
        "encryption",
        "sanitize",
      ],
      medium: ["security", "vulnerability", "threat", "privilege", "permissions", "exploit", "injection", "data breach", "leak"],
    },
    priority: 6,
    mandatory: true,
    description: "Security & compliance review — MANDATORY when high-signal keywords are present",
  },
  direct: {
    id: "direct",
    role: null,
    chain: null,
    keywords: { high: [], medium: [] },
    priority: 0,
    mandatory: false,
    description: "Fail-closed default — no delegation, the session operates directly",
  },
};

/** Chain de piloto de uma rota (1:1 no v1 — D4); null = rota sem chain. */
export function chainForRoute(route: RouteId): string | null {
  return ROUTE_CATALOG[route].chain;
}

/** Lista determinística das rotas delegáveis (ordem do ROUTE_IDS). */
export function routeList(): RouteDefinition[] {
  return DELEGATABLE_ROUTE_IDS.map((id) => ROUTE_CATALOG[id]);
}
