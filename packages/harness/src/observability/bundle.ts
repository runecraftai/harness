// observability/bundle.ts — harness bundles: fingerprint canônico (D3, OBS-02).
//
// Bundle = sha256 da serialização canônica (chaves ordenadas recursivamente —
// padrão sort F23, mesmo algoritmo do normalizeToolArgs do F27) de
// {harnessVersion, sdkVersion, forks, config (sections guards/verification/
// resilience/observability do state F13), settings (prefixos gerenciados do
// F14), rules: renderRules(agentId) (F19 PURO — prompts+roteamento),
// routingVersion (WORKFLOW_RULES_VERSION F19)}.
//
// `gitHead` FORA do hash (QA-2a — identidade de execução, não de variante):
// o MESMO bundle roda com HEADs diferentes; comparar execuções do mesmo
// bundle ("bundle a7f3 rodou em 12s, b9c1 em 38s") é comparar variantes de
// config/prompts. Full hash (64 hex) no header session:started; prefixo curto
// (12 hex) nos eventos seguintes; mudança no meio da sessão → bundle:changed
// (eventos antigos imutáveis).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { piSettingsPath, resolveRuntime, runecraftDir, type Runtime } from "../config.ts";
import { renderRules, WORKFLOW_RULES_VERSION } from "../adapters/rulesContent.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import type { BundleFingerprintInput, BundleHash } from "./types.ts";

/** Prefixo curto (12 hex = 48 bits — colisão negligível para agrupamento, D3). */
export const BUNDLE_SHORT_LENGTH = 12 as const;

/**
 * Serialização canônica: JSON.stringify com chaves ordenadas recursivamente
 * (padrão sort F23 — determinístico em qualquer runtime). Arrays preservam
 * ordem (ordem é semântica); objetos têm chaves sorted.
 */
export function canonicalJson(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input !== null && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = stable((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(stable(value ?? {}));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash do bundle (D3): full 64 hex + short 12 hex. PURO — mesmo input → mesmo hash. */
export function computeBundleHash(input: BundleFingerprintInput): BundleHash {
  const full = sha256Hex(canonicalJson(input));
  return { full, short: full.slice(0, BUNDLE_SHORT_LENGTH) };
}

/** Prefixo curto de um full hash (12 hex — D3). */
export function bundleShortOf(full: string): string {
  return full.slice(0, BUNDLE_SHORT_LENGTH);
}

// ---------------------------------------------------------------------------
// Coleta do input canônico (IO — cwd/env; determinística por construção)
// ---------------------------------------------------------------------------

/** Prefixos gerenciados do settings.json pelo F14 (targets do merge — D3). */
export const SETTINGS_PREFIXES = ["subagents", "taskflow", "modelRoles"] as const;

function readJsonObject(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Seções do state (F13) que entram no bundle: guards/verification/resilience/observability.
 *  Leitura direta read-only (nunca escreve; workspace > global por seção). */
export function stateConfigSections(rt: Runtime): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ws = readJsonObject(path.join(runecraftDir(rt, "workspace"), "state.json"));
  const gl = readJsonObject(path.join(runecraftDir(rt, "global"), "state.json"));
  for (const section of ["guards", "verification", "resilience", "observability"] as const) {
    const value = ws?.[section] ?? gl?.[section];
    if (value !== undefined) out[section] = value;
  }
  return out;
}

/** Settings do F14 (prefixos gerenciados): workspace > global por prefixo. */
export function managedSettings(rt: Runtime): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ws = readJsonObject(piSettingsPath(rt, "workspace"));
  const gl = readJsonObject(piSettingsPath(rt, "global"));
  for (const prefix of SETTINGS_PREFIXES) {
    const value = ws?.[prefix] ?? gl?.[prefix];
    if (value !== undefined) out[prefix] = value;
  }
  return out;
}

export interface CollectBundleOptions {
  /** overrides (testes) — cada campo substitui o valor coletado. */
  overrides?: Partial<BundleFingerprintInput>;
}

function packageVersion(file: string, fallback: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string };
    return pkg.version ?? fallback;
  } catch {
    return fallback;
  }
}

const HARNESS_PACKAGE_JSON = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../package.json");
const SDK_PACKAGE_JSON = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../node_modules/@earendil-works/pi-coding-agent/package.json",
);

/** Versão do harness (package.json — best-effort; fallback estável). */
export function harnessPackageVersion(): string {
  return packageVersion(HARNESS_PACKAGE_JSON, "0.0.0-dev");
}

/** Versão do SDK pi-coding-agent (best-effort; fallback estável). */
export function sdkPackageVersion(): string {
  return packageVersion(SDK_PACKAGE_JSON, "0.81.0");
}

/**
 * Coleta o input canônico do bundle para uma sessão (D3). Determinístico dado
 * o mesmo estado (config/settings/rules/versões estáveis; gitHead NÃO entra).
 */
export function collectBundleInput(cwd: string, env: NodeJS.ProcessEnv, agentId: string, opts: CollectBundleOptions = {}): BundleFingerprintInput {
  const rt = resolveRuntime(cwd, env);
  const input: BundleFingerprintInput = {
    harnessVersion: harnessPackageVersion(),
    sdkVersion: sdkPackageVersion(),
    forks: { ...HARNESS_VERSIONS },
    config: stateConfigSections(rt),
    settings: managedSettings(rt),
    rules: renderRules(agentId as Parameters<typeof renderRules>[0]),
    routingVersion: WORKFLOW_RULES_VERSION,
  };
  if (opts.overrides) {
    return { ...input, ...opts.overrides };
  }
  return input;
}

/** gitHead (FORA do hash — D3): best-effort, null quando indisponível. */
export function readGitHead(cwd: string, env: NodeJS.ProcessEnv): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}
