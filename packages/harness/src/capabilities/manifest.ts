// capabilities/manifest.ts — capability manifest (Phase B0, PARITY.md B0).
//
// Port in TS of the gentle-ai idea (`internal/agents/capabilitymanifest/
// manifest.go` — recon report §6B): per-agent feature claims as a SINGLE
// SOURCE OF TRUTH consumed by install, doctor, status and PARITY.md.
// Prevents N-adapter drift before it starts — the alternative is the same
// "planned:" string scattered across matrix.ts, agents.md and PARITY.md
// tables, drifting independently.
//
// Dimensions (the 5 named in the brief + the delivery surface PARITY.md
// enumerates): hooks / subagents / mcp / models / guards + taskflow /
// goal-loop / pr-review / memory / persona / sdds. A claim is one cell:
//   verdict   — "native" (host mechanism) | "adapt" (harness adapter wraps an
//               engine) | "done" (already delivered) | "none" (no mechanism)
//   mechanism — the concrete native surface (single string, no duplication)
//   phase     — roadmap phase that delivers it (PARITY.md); undefined when
//               delivered today or excluded from the roadmap
//   delivered — TRUE when the harness ships it TODAY (honesty: claim vs plan
//               — mirrors gentle-ai's dormant/advertised contract exposure:
//               a claim without `delivered` is a plan, never an assertion)
//
// Validation (manifest_test.go analog — digest tests): every supported agent
// has a claim per capability; verdict values are closed; `delivered` implies
// verdict ≠ none; `none` implies not delivered; mechanism non-empty; the
// canonical JSON digest is byte-stable (golden). Doctor check 25 and
// status (B0 section) consume this module; matrix.ts sources its refusal
// reasons from capabilityReason() so the copy can't drift.
//
// Honesty rules carried from the recon report §7: Copilot has NO guard/hook
// surface (claim `none`, never "native"); Codex/Claude hooks are real;
// goal-loop is EXCLUDED from non-Pi v1 (commander decision D2 — taskflow +
// subagents are the documented substitutes; B7 stays future).
import type { AgentId } from "../adapters/types.ts";
import { createHash } from "node:crypto";

/** Agents covered by the manifest (supported + Pi; Tier 3 is detect-only —
 *  intentionally absent: no claims, no adapter). */
export type ManifestAgentId = "pi" | AgentId;

export const MANIFEST_AGENT_IDS: readonly ManifestAgentId[] = [
  "pi",
  "claude-code",
  "opencode",
  "codex",
  "copilot",
] as const;

/** Feature dimensions of the manifest (brief: hooks/subagents/mcp/models/
 *  guards; + the delivery surface PARITY.md enumerates per agent). */
export const CAPABILITY_IDS = [
  "hooks",
  "subagents",
  "mcp",
  "models",
  "guards",
  "taskflow",
  "goal-loop",
  "pr-review",
  "memory",
  "persona",
  "routing",
  "sdds",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type Verdict = "native" | "adapt" | "done" | "none";

export interface CapabilityClaim {
  /** host mechanism class: native / adapt / done / none. */
  verdict: Verdict;
  /** concrete native surface (single string — the "planned:" copy source). */
  mechanism: string;
  /** roadmap phase that delivers it (PARITY.md B0..B8); undefined when
   *  delivered today or excluded from the roadmap. */
  phase?: string;
  /** shipped TODAY? false = plan, never an assertion (dormant exposure). */
  delivered: boolean;
  /** honest boundary note (e.g. Copilot single-mode, goal-loop D2 exclusion). */
  note?: string;
}

export type AgentCapabilityManifest = Record<CapabilityId, CapabilityClaim>;

/** Schema id for the canonical JSON digest (gentle-ai manifest.go pattern:
 *  domain + payload hash; byte-stable across runs — F21 D10). */
export const MANIFEST_SCHEMA = "runecraft.agent-capability-manifest/v1" as const;

// ---------------------------------------------------------------------------
// Claims per agent (source: PARITY.md native-surface tables = recon §4)
// ---------------------------------------------------------------------------

const PI: AgentCapabilityManifest = {
  hooks: { verdict: "native", mechanism: "Pi SDK extension hooks (before_agent_start / tool_call / session_start)", delivered: true },
  subagents: { verdict: "native", mechanism: "subagents tool + .pi/agents/ role materialization (fork)", delivered: true },
  mcp: { verdict: "native", mechanism: "MCP via Pi SDK", delivered: true },
  models: { verdict: "native", mechanism: "models.json registry + modelSwitch (src/models/)", delivered: true },
  guards: { verdict: "native", mechanism: "tool_call blocking extensions (guards)", delivered: true },
  taskflow: { verdict: "done", mechanism: "taskflow packages as Pi extensions", delivered: true },
  "goal-loop": { verdict: "native", mechanism: "goal-loop extension driving agent_end (two-driver)", delivered: true },
  "pr-review": { verdict: "native", mechanism: "pr-review extension + receipts/gates", delivered: true },
  memory: { verdict: "native", mechanism: "rune_* tools over the SQLite runes store", delivered: true },
  persona: { verdict: "native", mechanism: "persona extension (before_agent_start marker)", delivered: true },
  // F33: coded routing (classificador determinístico + directive) — extensão Pi.
  routing: { verdict: "native", mechanism: "before_agent_start routing extension (F33 classifier + directive)", delivered: true },
  sdds: { verdict: "native", mechanism: "skills + chains (.pi/chains/)", delivered: true },
};

const CLAUDE_CODE: AgentCapabilityManifest = {
  hooks: { verdict: "native", mechanism: "PreToolUse/PostToolUse/SessionStart/Stop hooks (~/.claude/settings.json)", phase: "B2", delivered: false },
  // B1 SHIPS subagents for Claude Code: 7 role agents in ~/.claude/agents/ +
  // delegation via the native Task (Agent) tool.
  subagents: { verdict: "native", mechanism: "Task tool + agent files (~/.claude/agents/*.md) — 7 role agents (B1)", delivered: true },
  mcp: { verdict: "native", mechanism: "MCP servers via ~/.claude/.mcp.json / per-server files", delivered: true },
  models: { verdict: "native", mechanism: "agent-file model: frontmatter + settings.json model", phase: "B5", delivered: false },
  guards: { verdict: "native", mechanism: "PreToolUse hooks in ~/.claude/settings.json (deny/rewrite)", phase: "B2", delivered: false },
  taskflow: { verdict: "done", mechanism: "taskflow-MCP (taskflow-claude in .mcp.json)", delivered: true },
  "goal-loop": { verdict: "none", mechanism: "no session-continuation API — external supervisor would be B7", note: "excluded from non-Pi v1 (D2) — taskflow + subagents are the documented substitutes", delivered: false },
  "pr-review": { verdict: "adapt", mechanism: "parallel Task-tool dispatch + harness review CLI + receipts", phase: "B4", delivered: false },
  memory: { verdict: "adapt", mechanism: "runes SQLite store exposed as an MCP server", phase: "B3", delivered: false },
  persona: { verdict: "native", mechanism: "CLAUDE.md marker sections", delivered: true, note: "rules delivered today (runecraft:workflow + runecraft:routing sections); full persona content planned (B5)" },
  // B1: coded-routing directive como seção runecraft:routing do CLAUDE.md
  // (mesmo catálogo do classificador F33 — thresholds/segurança obrigatória).
  routing: { verdict: "native", mechanism: "CLAUDE.md runecraft:routing section (coded-routing directive, B1)", delivered: true },
  sdds: { verdict: "adapt", mechanism: "skills + slash commands; chains → agent-file conversion", phase: "B6", delivered: false },
};

const OPENCODE: AgentCapabilityManifest = {
  hooks: { verdict: "none", mechanism: "no PreToolUse hook surface — permission overlay only", note: "enforcement is permission-level, not logic-level (recon §7 guard-parity honesty)", delivered: false },
  subagents: { verdict: "native", mechanism: "agent.<name> modes in opencode.json (overlay agents)", phase: "B6", delivered: false },
  mcp: { verdict: "native", mechanism: "MCP entry in opencode.json", delivered: true },
  models: { verdict: "native", mechanism: "per-agent model: in overlay + named profiles", phase: "B5", delivered: false },
  guards: { verdict: "adapt", mechanism: "permission rules (allow/deny/ask) + plugin hooks — best-effort", phase: "B2", delivered: false },
  taskflow: { verdict: "done", mechanism: "taskflow-MCP (mcp.taskflow in opencode.json)", delivered: true },
  "goal-loop": { verdict: "none", mechanism: "no cross-session continuation — external supervisor would be B7", note: "excluded from non-Pi v1 (D2) — taskflow + subagents are the documented substitutes", delivered: false },
  "pr-review": { verdict: "adapt", mechanism: "native task subagents + review skill, or harness review CLI", phase: "B4", delivered: false },
  memory: { verdict: "adapt", mechanism: "MCP server entry in opencode.json", phase: "B3", delivered: false },
  persona: { verdict: "native", mechanism: "AGENTS.md + overlay agent prompt files", delivered: true },
  routing: { verdict: "adapt", mechanism: "routing directive via AGENTS.md rules/persona (no directive section)", note: "the runecraft:routing directive section is Claude Code-specific (B1)", delivered: false },
  sdds: { verdict: "adapt", mechanism: "commands/*.md slash commands + skills", phase: "B6", delivered: false },
};

const CODEX: AgentCapabilityManifest = {
  hooks: { verdict: "native", mechanism: "PreToolUse/PostToolUse/SessionStart/Stop hooks (hooks.json / [hooks] in config.toml)", phase: "B2", delivered: false },
  subagents: { verdict: "adapt", mechanism: "headless codex exec (taskflow-codex runner)", note: "solo-agent surface — no stable native subagent mechanism", delivered: false },
  mcp: { verdict: "native", mechanism: "[mcp_servers] in config.toml", delivered: true },
  models: { verdict: "native", mechanism: "profiles: ~/.codex/<name>.config.toml via codex --profile", phase: "B5", delivered: false },
  guards: { verdict: "native", mechanism: "PreToolUse hooks (hooks.json / config.toml [hooks])", phase: "B2", delivered: false },
  taskflow: { verdict: "done", mechanism: "taskflow-MCP ([mcp_servers.taskflow] in config.toml)", delivered: true },
  "goal-loop": { verdict: "none", mechanism: "external supervisor via codex exec would be B7", note: "excluded from non-Pi v1 (D2) — taskflow + subagents are the documented substitutes", delivered: false },
  "pr-review": { verdict: "adapt", mechanism: "harness review CLI + headless codex exec reviewer", phase: "B4", delivered: false },
  memory: { verdict: "adapt", mechanism: "[mcp_servers] upsert (Engram pattern)", phase: "B3", delivered: false },
  persona: { verdict: "native", mechanism: "AGENTS.md system prompt (already written) + hook-injected context", delivered: true },
  routing: { verdict: "adapt", mechanism: "routing directive via AGENTS.md system prompt (no directive section)", note: "the runecraft:routing directive section is Claude Code-specific (B1)", delivered: false },
  sdds: { verdict: "adapt", mechanism: "skills + AGENTS.md orchestrator prompt (solo mode)", phase: "B6", delivered: false },
};

const COPILOT: AgentCapabilityManifest = {
  hooks: { verdict: "none", mechanism: "no tool-call hook surface in VS Code chat", note: "enforcement advisory via instructions only (recon §4.4)", delivered: false },
  subagents: { verdict: "adapt", mechanism: "runSubagent delegation (prompt-carried, no config file)", note: "harness roles → instructions-driven delegation", delivered: false },
  mcp: { verdict: "native", mechanism: "Code/User/mcp.json", delivered: true },
  models: { verdict: "none", mechanism: "no per-agent model config — single active model", note: "single-mode only — acceptable (gentle-ai agrees)", delivered: false },
  guards: { verdict: "none", mechanism: "no tool-call hook surface", note: "guard parity impossible in v1 — detect-only, documented", delivered: false },
  taskflow: { verdict: "done", mechanism: "servers.taskflow in .vscode/mcp.json (reuses taskflow-claude host)", delivered: true },
  "goal-loop": { verdict: "none", mechanism: "no extension or hook API — external supervisor only", note: "excluded from non-Pi v1 (D2) — taskflow + subagents are the documented substitutes", delivered: false },
  "pr-review": { verdict: "adapt", mechanism: "harness review CLI (no native parallel review config)", phase: "B4", delivered: false },
  memory: { verdict: "adapt", mechanism: "MCP (Code/User/mcp.json)", phase: "B3", delivered: false },
  persona: { verdict: "native", mechanism: ".github/copilot-instructions.md (repo) + Code/User/prompts/*.instructions.md (user)", delivered: true },
  routing: { verdict: "none", mechanism: "no routing mechanism beyond the instructions file", note: "advisory only — no directive section surface", delivered: false },
  sdds: { verdict: "adapt", mechanism: "skills (~/.copilot/skills/)", phase: "B6", delivered: false },
};

const MANIFEST: Record<ManifestAgentId, AgentCapabilityManifest> = {
  pi: PI,
  "claude-code": CLAUDE_CODE,
  opencode: OPENCODE,
  codex: CODEX,
  copilot: COPILOT,
};

/** The manifest — single source of truth. */
export const CAPABILITY_MANIFEST: Readonly<Record<ManifestAgentId, AgentCapabilityManifest>> = MANIFEST;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function manifestFor(agent: ManifestAgentId): AgentCapabilityManifest {
  return MANIFEST[agent];
}

export function allManifests(): Array<{ agent: ManifestAgentId; manifest: AgentCapabilityManifest }> {
  return MANIFEST_AGENT_IDS.map((agent) => ({ agent, manifest: MANIFEST[agent] }));
}

export function claimFor(agent: ManifestAgentId, capability: CapabilityId): CapabilityClaim {
  return MANIFEST[agent][capability];
}

/** Claims delivered today for an agent (honest projection — status/doctor). */
export function deliveredClaims(agent: ManifestAgentId): Array<{ capability: CapabilityId; claim: CapabilityClaim }> {
  return CAPABILITY_IDS.filter((id) => MANIFEST[agent][id].delivered).map((id) => ({ capability: id, claim: MANIFEST[agent][id] }));
}

// ---------------------------------------------------------------------------
// Validation (manifest_test.go analog — digest tests, recon §5/§7)
// ---------------------------------------------------------------------------

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
}

/** Structural validation of the manifest (doctor check 25 consumes this).
 *  Content is data (never judged "wrong"); only broken CONTRACTS fail:
 *  missing agent/capability cells, closed verdict set, delivered↔verdict
 *  consistency, non-empty mechanism, phase only on not-delivered claims. */
export function validateManifest(): ManifestValidation {
  const errors: string[] = [];
  for (const agent of MANIFEST_AGENT_IDS) {
    const manifest = MANIFEST[agent];
    if (manifest === undefined) {
      errors.push(`${agent}: sem claims no manifest (agente suportado exige cobertura completa)`);
      continue;
    }
    for (const capability of CAPABILITY_IDS) {
      const claim = manifest[capability];
      if (claim === undefined) {
        errors.push(`${agent}.${capability}: claim ausente (todo agente suportado cobre toda capability)`);
        continue;
      }
      if (!["native", "adapt", "done", "none"].includes(claim.verdict)) {
        errors.push(`${agent}.${capability}: verdict inválido "${String(claim.verdict)}"`);
      }
      if (claim.mechanism === undefined || claim.mechanism.trim() === "") {
        errors.push(`${agent}.${capability}: mechanism vazio`);
      }
      if (claim.delivered && claim.verdict === "none") {
        errors.push(`${agent}.${capability}: delivered=true com verdict "none" (contradição — não há o que entregar)`);
      }
      if (!claim.delivered && claim.verdict === "done") {
        errors.push(`${agent}.${capability}: verdict "done" exige delivered=true`);
      }
      if (claim.phase !== undefined && claim.delivered) {
        errors.push(`${agent}.${capability}: phase "${claim.phase}" em claim já entregue (fase é para planos)`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Digest (gentle-ai manifest.go: domain + payload → "sha256:…" byte-stable)
// ---------------------------------------------------------------------------

function digest(domain: string, payload: string): string {
  const hash = createHash("sha256");
  hash.update(domain);
  hash.update("\u0000");
  hash.update(payload);
  return `sha256:${hash.digest("hex")}`;
}

/** Canonical JSON of the manifest (stable key order — byte-stable digest). */
export function canonicalManifestJson(): string {
  return JSON.stringify(
    Object.fromEntries(
      MANIFEST_AGENT_IDS.map((agent) => [
        agent,
        Object.fromEntries(CAPABILITY_IDS.map((capability) => [capability, MANIFEST[agent][capability]])),
      ]),
    ),
    null,
    2,
  );
}

/** Manifest digest — the golden/doctor identity (F21 D10: 2 runs identical). */
export function manifestDigest(): string {
  return digest(MANIFEST_SCHEMA, canonicalManifestJson());
}

// ---------------------------------------------------------------------------
// Single-source reason strings (matrix.ts consumes these — no drift)
// ---------------------------------------------------------------------------

/**
 * The refusal/delivery reason for an unsupported matrix cell, sourced from
 * the manifest claim (install/doctor/status read the SAME text). Mirrors the
 * F15 fail-closed phrasing ("<component> é extensão Pi; use --agent pi")
 * and appends the manifest's claim. Honest distinction (F4): for DELIVERED
 * capabilities the reason says "nativo entregue:" (the native mechanism is
 * shipped — only the FORK tool stays Pi-only), so the refusal never reads
 * as a contradiction; for not-delivered claims it says "planned:" with the
 * roadmap phase.
 */
export function capabilityReason(agent: ManifestAgentId, capability: CapabilityId, componentLabel: string): string {
  const claim = MANIFEST[agent][capability];
  if (claim === undefined) return `${componentLabel} é extensão Pi; use --agent pi`;
  const claimText = claim.delivered
    ? `nativo entregue: ${claim.mechanism}`
    : `planned: ${claim.mechanism}${claim.phase !== undefined ? ` (${claim.phase})` : ""}`;
  const note = claim.note !== undefined ? ` (${claim.note})` : "";
  return `${componentLabel} é extensão Pi; use --agent pi; ${claimText}${note}`;
}
