// verify/config.ts — VerificationConfig (F25, D9/VER-12).
//
// Config aditiva `verification` no state.json (F13, schemaVersion 1 — ao lado
// de `guards` do F24), merge por overlay F14 (workspace > global > default),
// congelada por sessão (D12 — lida no session_start, sem drift mid-turn) e
// kill switch `RUNECRAFT_VERIFY=0|false|off` (padrão F20 guardKit).
//
// Validação determinística (D9): min < max, limiares ≥ 0, tipos corretos,
// política conhecida (retry|skip|halt) → config inválida = fail-closed com
// motivo (a cascata não roda com um contrato quebrado; o CLI sai 3 e o
// doctor reporta). O estado efetivo herda a semântica do guardKit do F24:
// workspace > global > default; inválida → motivo claro nomeando o campo.
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, statePath, type Runtime, type Scope } from "../config.ts";
import { loadStateReadonly } from "../state.ts";
import { isPlainObject } from "../guards/guardKit.ts";
import { LAYER_IDS, VERIFY_REASON_ID, type LayerId, type PolicyAction } from "./verdict.ts";

export const VERIFY_POLICIES = ["retry", "skip", "halt"] as const;
export const VERIFY_DEGRADE_OPTIONS = ["skip", "fail", "halt"] as const;
export type DegradeOption = (typeof VERIFY_DEGRADE_OPTIONS)[number];

/** Limiares de score da camada 4 (D5 — boundaries inclusivos, calibrados por projeto). */
export interface EmbeddingThresholds {
  min: number;
  max: number;
}

/** Camada 3 (QA-2): escopo de arquivos + proporção de tamanho. */
export interface SufficiencyThresholds {
  minRatio: number;
  maxRatio: number;
  /** escopo de arquivos do goal (paths relativos, prefixo); vazio = checagem de escopo não aplica. */
  scopePaths: string[];
}

export function defaultSufficiencyThresholds(): SufficiencyThresholds {
  return { minRatio: 0.03, maxRatio: 8, scopePaths: [] };
}

export interface PolicyConfig {
  /** política por camada quando a camada FALHA (D7 — defaults QA-1: integrity/sufficiency halt; demais skip). */
  onFail: Record<LayerId, PolicyAction>;
  /** retries adicionais da cascata (a 1ª execução não conta; cap por costCaps.maxCascadeRuns). */
  retry: { maxRuns: number };
}

export interface CostCapsConfig {
  /** cap duro de execuções da cascata (retries inclusos) → esgotado = HALT. */
  maxCascadeRuns: number;
  /** cap duro de chamadas do judge → esgotado = HALT sem judge. */
  maxJudgeCalls: number;
  /** cap duro de tokens estimados do judge → esgotado = HALT sem judge. */
  maxJudgeTokens: number;
}

export interface DegradeConfig {
  /** camada indisponível (sem spec/scripts) → skip (degraded) | fail | halt (QA-3). */
  embeddingUnavailable: DegradeOption;
  /** zona cinza sem judge (env off) → fail por default (fail-closed — QA-3). */
  grayZoneNoJudge: DegradeOption;
}

/** Config aditiva `verification` (D9) — defaults = recomendados (QA-1/QA-3). */
export interface VerificationConfig {
  /** cascade ativa em sessões gerenciadas (default true — fail-closed). */
  enabled: boolean;
  thresholds: {
    embedding: EmbeddingThresholds;
    sufficiency: SufficiencyThresholds;
  };
  policy: PolicyConfig;
  costCaps: CostCapsConfig;
  degrade: DegradeConfig;
  structural: { commands: string[] };
}

/** Defaults calibrados (validados no Execute F25; ajuste por projeto via config). */
export function defaultVerificationConfig(): VerificationConfig {
  return {
    enabled: true,
    thresholds: {
      embedding: { min: 0.35, max: 0.75 },
      sufficiency: defaultSufficiencyThresholds(),
    },
    policy: {
      onFail: {
        structural: "skip",
        integrity: "halt",
        sufficiency: "halt",
        embedding: "skip",
        judge: "skip",
      },
      retry: { maxRuns: 2 },
    },
    costCaps: { maxCascadeRuns: 3, maxJudgeCalls: 2, maxJudgeTokens: 4000 },
    degrade: { embeddingUnavailable: "skip", grayZoneNoJudge: "fail" },
    structural: { commands: ["lint", "typecheck", "test"] },
  };
}

export interface ConfigValidation {
  ok: boolean;
  config?: VerificationConfig;
  /** motivos estáveis (campo + problema) — normalização F21 D10. */
  errors: string[];
}

/** Kill switch (F20): `RUNECRAFT_VERIFY=0|false|off` (case-insensitive) → cascade inativa. */
export function verifyKillSwitch(env: NodeJS.ProcessEnv): { active: boolean; value: string | null } {
  const raw = env.RUNECRAFT_VERIFY?.trim();
  if (raw === undefined || raw === "") return { active: false, value: null };
  const normalized = raw.toLowerCase();
  return { active: normalized === "0" || normalized === "false" || normalized === "off", value: raw };
}

function numberField(
  value: unknown,
  field: string,
  errors: string[],
  opts: { min?: number; max?: number; int?: boolean } = {},
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${field}: esperado number, encontrado ${Array.isArray(value) ? "array" : typeof value}`);
    return undefined;
  }
  if (opts.int && !Number.isInteger(value)) {
    errors.push(`${field}: esperado inteiro, encontrado ${value}`);
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    errors.push(`${field}: esperado >= ${opts.min}, encontrado ${value}`);
    return undefined;
  }
  if (opts.max !== undefined && value > opts.max) {
    errors.push(`${field}: esperado <= ${opts.max}, encontrado ${value}`);
    return undefined;
  }
  return value;
}

function stringArrayField(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
    errors.push(`${field}: esperado string[], encontrado ${Array.isArray(value) ? "array com tipo errado" : typeof value}`);
    return undefined;
  }
  return value;
}

function policyField(value: unknown, field: string, errors: string[]): PolicyAction | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(VERIFY_POLICIES as readonly string[]).includes(value)) {
    errors.push(`${field}: política desconhecida "${String(value)}" (esperado retry|skip|halt)`);
    return undefined;
  }
  return value as PolicyAction;
}

function degradeField(value: unknown, field: string, errors: string[]): DegradeOption | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(VERIFY_DEGRADE_OPTIONS as readonly string[]).includes(value)) {
    errors.push(`${field}: opção desconhecida "${String(value)}" (esperado skip|fail|halt)`);
    return undefined;
  }
  return value as DegradeOption;
}

/**
 * Validação determinística da config bruta (D9). Inválida → fail-closed:
 * a cascata NÃO roda (o contrato de limiares é a calibração da decisão de
 * escalada — min >= max torna a zona cinza indefinida). Os erros nomeiam o
 * campo/layer (isolamento por camada na mensagem — padrão F24 D10).
 */
export function validateVerificationConfig(raw: unknown): ConfigValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, config: defaultVerificationConfig(), errors: [] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`verification: esperado objeto, encontrado ${Array.isArray(raw) ? "array" : typeof raw}`] };
  }
  const errors: string[] = [];
  const cfg = defaultVerificationConfig();

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") errors.push("verification.enabled: esperado boolean");
    else cfg.enabled = raw.enabled;
  }

  // thresholds.embedding.{min,max} — 0 <= min < max <= 1 (D5; min == max rejeitado).
  if (raw.thresholds !== undefined) {
    if (!isPlainObject(raw.thresholds)) {
      errors.push("verification.thresholds: esperado objeto");
    } else {
      const emb = raw.thresholds.embedding;
      if (emb !== undefined) {
        if (!isPlainObject(emb)) {
          errors.push("verification.thresholds.embedding: esperado objeto");
        } else {
          const min = numberField(emb.min, "verification.thresholds.embedding.min", errors, { min: 0, max: 1 });
          const max = numberField(emb.max, "verification.thresholds.embedding.max", errors, { min: 0, max: 1 });
          if (min !== undefined) cfg.thresholds.embedding.min = min;
          if (max !== undefined) cfg.thresholds.embedding.max = max;
          if (cfg.thresholds.embedding.min >= cfg.thresholds.embedding.max) {
            errors.push(
              `verification.thresholds.embedding: min (${cfg.thresholds.embedding.min}) deve ser < max (${cfg.thresholds.embedding.max})`,
            );
          }
        }
      }
      const suff = raw.thresholds.sufficiency;
      if (suff !== undefined) {
        if (!isPlainObject(suff)) {
          errors.push("verification.thresholds.sufficiency: esperado objeto");
        } else {
          const minRatio = numberField(suff.minRatio, "verification.thresholds.sufficiency.minRatio", errors, { min: 0 });
          const maxRatio = numberField(suff.maxRatio, "verification.thresholds.sufficiency.maxRatio", errors, { min: 0 });
          const scopePaths = stringArrayField(suff.scopePaths, "verification.thresholds.sufficiency.scopePaths", errors);
          if (minRatio !== undefined) cfg.thresholds.sufficiency.minRatio = minRatio;
          if (maxRatio !== undefined) cfg.thresholds.sufficiency.maxRatio = maxRatio;
          if (scopePaths !== undefined) cfg.thresholds.sufficiency.scopePaths = scopePaths;
          if (cfg.thresholds.sufficiency.minRatio >= cfg.thresholds.sufficiency.maxRatio) {
            errors.push(
              `verification.thresholds.sufficiency: minRatio (${cfg.thresholds.sufficiency.minRatio}) deve ser < maxRatio (${cfg.thresholds.sufficiency.maxRatio})`,
            );
          }
        }
      }
    }
  }

  // policy.onFail.<layer> + policy.retry.maxRuns (D7).
  if (raw.policy !== undefined) {
    if (!isPlainObject(raw.policy)) {
      errors.push("verification.policy: esperado objeto");
    } else {
      const onFail = raw.policy.onFail;
      if (onFail !== undefined) {
        if (!isPlainObject(onFail)) {
          errors.push("verification.policy.onFail: esperado objeto");
        } else {
          for (const layer of LAYER_IDS) {
            const value = onFail[layer];
            if (value === undefined) continue;
            const action = policyField(value, `verification.policy.onFail.${layer}`, errors);
            if (action !== undefined) cfg.policy.onFail[layer] = action;
          }
          // Campos de layer desconhecida → erro (política desconhecida — D9).
          for (const key of Object.keys(onFail)) {
            if (!(LAYER_IDS as readonly string[]).includes(key)) {
              errors.push(`verification.policy.onFail.${key}: layer desconhecida (esperado ${LAYER_IDS.join("|")})`);
            }
          }
        }
      }
      const retry = raw.policy.retry;
      if (retry !== undefined) {
        if (!isPlainObject(retry)) {
          errors.push("verification.policy.retry: esperado objeto");
        } else {
          const maxRuns = numberField(retry.maxRuns, "verification.policy.retry.maxRuns", errors, { min: 1, int: true });
          if (maxRuns !== undefined) cfg.policy.retry.maxRuns = maxRuns;
        }
      }
    }
  }

  // costCaps (D7) — inteiros >= 1 (maxCascadeRuns) / >= 0 (judge; 0 = sem orçamento).
  if (raw.costCaps !== undefined) {
    if (!isPlainObject(raw.costCaps)) {
      errors.push("verification.costCaps: esperado objeto");
    } else {
      const maxCascadeRuns = numberField(raw.costCaps.maxCascadeRuns, "verification.costCaps.maxCascadeRuns", errors, { min: 1, int: true });
      const maxJudgeCalls = numberField(raw.costCaps.maxJudgeCalls, "verification.costCaps.maxJudgeCalls", errors, { min: 0, int: true });
      const maxJudgeTokens = numberField(raw.costCaps.maxJudgeTokens, "verification.costCaps.maxJudgeTokens", errors, { min: 0, int: true });
      if (maxCascadeRuns !== undefined) cfg.costCaps.maxCascadeRuns = maxCascadeRuns;
      if (maxJudgeCalls !== undefined) cfg.costCaps.maxJudgeCalls = maxJudgeCalls;
      if (maxJudgeTokens !== undefined) cfg.costCaps.maxJudgeTokens = maxJudgeTokens;
    }
  }

  // degrade (QA-3): embeddingUnavailable (default skip) + grayZoneNoJudge (default fail).
  if (raw.degrade !== undefined) {
    if (!isPlainObject(raw.degrade)) {
      errors.push("verification.degrade: esperado objeto");
    } else {
      const unavailable = degradeField(raw.degrade.embeddingUnavailable, "verification.degrade.embeddingUnavailable", errors);
      const grayNoJudge = degradeField(raw.degrade.grayZoneNoJudge, "verification.degrade.grayZoneNoJudge", errors);
      if (unavailable !== undefined) cfg.degrade.embeddingUnavailable = unavailable;
      if (grayNoJudge !== undefined) cfg.degrade.grayZoneNoJudge = grayNoJudge;
    }
  }

  // structural.commands (D12) — nomes de scripts do package.json.
  if (raw.structural !== undefined) {
    if (!isPlainObject(raw.structural)) {
      errors.push("verification.structural: esperado objeto");
    } else {
      const commands = stringArrayField(raw.structural.commands, "verification.structural.commands", errors);
      if (commands !== undefined) cfg.structural.commands = commands;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: cfg, errors: [] };
}

export interface VerificationStateRead {
  /** config bruta da seção `verification` (undefined quando ausente). */
  verification: unknown;
  corrupt: boolean;
}

/** Leitura read-only da seção `verification` de um state.json (F13; nunca escreve). */
export function readStateVerification(file: string, scope: Scope): VerificationStateRead {
  if (!fs.existsSync(file)) return { verification: undefined, corrupt: false };
  const loaded = loadStateReadonly(file, scope);
  if (!loaded.ok) return { verification: undefined, corrupt: true };
  return { verification: loaded.state.verification, corrupt: false };
}

export interface SessionVerificationConfig {
  killSwitch: boolean;
  killSwitchValue: string | null;
  /** config validada (undefined quando inválida — fail-closed com problems). */
  config: VerificationConfig | undefined;
  /** problemas de config encontrados (workspace/global) — doctor reporta. */
  problems: string[];
  /** de onde veio a config (diagnóstico status/doctor). */
  source: "workspace" | "global" | "default";
}

/** Merge efetivo: workspace > global > default; inválida → fail-closed (D9). */
export function effectiveVerification(workspace: unknown, global: unknown, env: NodeJS.ProcessEnv): SessionVerificationConfig {
  const kill = verifyKillSwitch(env);
  const ws = isPlainObject(workspace) ? workspace : undefined;
  const gl = isPlainObject(global) ? global : undefined;
  const raw = ws ?? gl ?? undefined;
  const source = ws !== undefined ? ("workspace" as const) : gl !== undefined ? ("global" as const) : ("default" as const);
  const validation = validateVerificationConfig(raw);
  if (!validation.ok) {
    return { killSwitch: kill.active, killSwitchValue: kill.value, config: undefined, problems: validation.errors, source };
  }
  return { killSwitch: kill.active, killSwitchValue: kill.value, config: validation.config, problems: [], source };
}

/** Resolve a config efetiva de verificação para uma sessão (cwd + env). D12: congelada pelo caller. */
export function loadSessionVerification(cwd: string, env: NodeJS.ProcessEnv): SessionVerificationConfig {
  const rt = resolveRuntime(cwd, env);
  const workspace = readStateVerification(statePath(rt, "workspace"), "workspace");
  const global = readStateVerification(statePath(rt, "global"), "global");
  const merged = effectiveVerification(workspace.verification, global.verification, env);
  if (workspace.corrupt) merged.problems.push("workspace: state.json corrompido — config de verificação tratada como ausente (fail-closed)");
  if (global.corrupt) merged.problems.push("global: state.json corrompido — config de verificação tratada como ausente (fail-closed)");
  return merged;
}

/** Congelamento por sessão (D12): captura no session_start; handlers usam o snapshot. */
export class SessionVerifyConfig {
  private snapshot: SessionVerificationConfig | null = null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  capture(cwd: string): void {
    this.snapshot = loadSessionVerification(cwd, this.env);
  }

  /** Snapshot congelado; carrega sob demanda na primeira chamada (defensivo). */
  frozen(cwd: string): SessionVerificationConfig {
    if (this.snapshot === null) this.capture(cwd);
    return this.snapshot as SessionVerificationConfig;
  }
}

/** Caminho do log de vereditos da sessão (append-only, precedente do ledger do glla). */
export function verdictLogPath(cwd: string): string {
  return path.join(cwd, ".runecraft", "verify-verdicts.jsonl");
}
