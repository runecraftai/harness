// report.ts — output for the install command (F11).
//
// TTY: human table. --json: SETM-06-compatible shape so CI consumers get a
// stable contract:
//   { installed, kept, conflicts, failed, backup, ..., settings: {created, conflicts, removed, preserved} }
import type { Scope } from "./config.ts";
import type { MergeChange, MergeTarget } from "./merge.ts";
import type { InstallPlan } from "./plan.ts";

export interface ConflictInfo {
  package: string;
  suggestion: string;
}

export interface FailInfo {
  spec: string;
  code: number | null;
  stderr: string;
}

/** Merge outcome attached to the install report (F14, SETM-06). */
export interface SettingsMergeReport {
  created: MergeChange[];
  conflicts: MergeChange[];
  /** remove mode only (uninstall); empty on install. */
  removed: MergeChange[];
  /** remove mode only (uninstall); empty on install. */
  preserved: MergeChange[];
}

/** JSON-safe shape of a merge change (file + dotted path + both values). */
export interface SettingsMergeChangeJson {
  file: string;
  path: string;
  value: unknown;
  harness?: unknown;
}

export function settingsMergeChangeToJson(change: MergeChange): SettingsMergeChangeJson {
  return {
    file: change.file,
    path: change.path.join("."),
    value: change.value,
    harness: change.harness,
  };
}

export interface InstallReport {
  preset: string;
  scope: Scope;
  components: string[];
  specs: string[];
  installed: string[];
  kept: string[];
  conflicts: ConflictInfo[];
  failed: FailInfo[];
  backup?: string;
  corruptStatePath?: string;
  filesTouched: string[];
  /** F14 merge outcome (populated on preset full). */
  settings?: SettingsMergeReport;
  /** note attached when a preset flag is accepted but its full semantics land later */
  notes: string[];
}

export interface RenderOptions {
  json: boolean;
  tty: boolean;
}

const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";

export function renderReport(report: InstallReport, opts: RenderOptions): string {
  if (opts.json) return `${JSON.stringify(toJson(report), null, 2)}\n`;
  const c = (s: string, color: string) => (opts.tty ? `${color}${s}${RESET}` : s);
  const lines: string[] = [
    `@runecraft/harness install (preset ${report.preset}, scope ${report.scope})`,
  ];
  for (const note of report.notes) lines.push(`${c("note:", DIM)} ${note}`);
  if (report.installed.length > 0) {
    lines.push(`${c(`Instalado (${report.installed.length}):`, GREEN)}`);
    for (const spec of report.installed) lines.push(`  ${c("✓", GREEN)} ${spec}`);
  }
  if (report.kept.length > 0) {
    lines.push(`Já presente, mantido (${report.kept.length}):`);
    for (const spec of report.kept) lines.push(`  ${c("=", DIM)} ${spec}`);
  }
  if (report.conflicts.length > 0) {
    lines.push(`${c(`Conflito com upstream (${report.conflicts.length}) — nada foi removido:`, YELLOW)}`);
    for (const conflict of report.conflicts) {
      lines.push(`  ${c("!", YELLOW)} ${conflict.package}`);
      lines.push(`    sugestão: ${conflict.suggestion}`);
    }
  }
  if (report.failed.length > 0) {
    lines.push(`${c(`Falhou (${report.failed.length}):`, RED)}`);
    for (const fail of report.failed) {
      lines.push(`  ${c("✗", RED)} ${fail.spec} (exit ${fail.code ?? "?"})`);
      const detail = fail.stderr.trim();
      if (detail) lines.push(`    ${detail.split(/\r?\n/)[0]}`);
    }
    lines.push(`  ${c("Sugestão: corrija e rode de novo — o snapshot pré-write permite restore manual (F13).", DIM)}`);
  }
  if (report.backup) lines.push(`${c(`Backup pré-install: ${report.backup}`, DIM)}`);
  if (report.corruptStatePath) {
    lines.push(`${c(`state.json corrompido foi movido para ${report.corruptStatePath}`, YELLOW)}`);
  }
  if (report.settings) {
    const settings = report.settings;
    if (settings.created.length > 0) {
      lines.push(`${c(`Settings — defaults aplicados (${settings.created.length}):`, GREEN)}`);
      for (const change of settings.created) {
        lines.push(`  ${c("✓", GREEN)} ${change.path.join(".")} = ${JSON.stringify(change.value)}`);
        lines.push(`    ${c(change.file, DIM)}`);
      }
    }
    if (settings.conflicts.length > 0) {
      lines.push(`${c(`Settings — conflito (${settings.conflicts.length}) — valor do usuário mantido, nunca sobrescrito:`, YELLOW)}`);
      for (const change of settings.conflicts) {
        lines.push(`  ${c("!", YELLOW)} ${change.path.join(".")}`);
        lines.push(`    usuário: ${JSON.stringify(change.value)}`);
        lines.push(`    harness: ${JSON.stringify(change.harness)}`);
      }
    }
    if (settings.removed.length > 0) {
      lines.push(`${c(`Settings — removidos (${settings.removed.length}):`, GREEN)}`);
      for (const change of settings.removed) lines.push(`  ${c("✓", GREEN)} ${change.path.join(".")}`);
    }
    if (settings.preserved.length > 0) {
      lines.push(`${c(`Settings — preservados por edição do usuário (${settings.preserved.length}):`, YELLOW)}`);
      for (const change of settings.preserved) {
        lines.push(`  ${c("=", YELLOW)} ${change.path.join(".")} = ${JSON.stringify(change.value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Dry-run: the plan + files that would be touched, no side effects (CLI-03). */
export function renderDryRun(
  plan: InstallPlan,
  filesTouched: string[],
  conflicts: ConflictInfo[],
  opts: RenderOptions,
  mergeTargets?: MergeTarget[],
): string {
  if (opts.json) {
    return `${JSON.stringify(
      {
        dryRun: true,
        preset: plan.preset,
        components: plan.components,
        specs: plan.specs,
        filesTouched,
        conflicts,
        settingsDefaults: mergeTargets?.map((t) => ({
          component: t.component,
          file: t.file,
          prefix: t.prefix ? t.prefix.join(".") : null,
          keys: t.defaults.map((d) => (t.prefix ? [...t.prefix, ...d.path].join(".") : d.path.join("."))),
        })),
      },
      null,
      2,
    )}\n`;
  }
  const c = (s: string, color: string) => (opts.tty ? `${color}${s}${RESET}` : s);
  const lines: string[] = [
    `@runecraft/harness install — DRY-RUN (nada será modificado)`,
    `preset: ${plan.preset} · components: ${plan.components.join(", ")} · packages: ${plan.specs.length}`,
    "",
    "Specs:",
    ...plan.specs.map((s) => `  ${s}`),
    "",
    "Arquivos que seriam tocados:",
    ...filesTouched.map((f) => `  ${f}`),
  ];
  if (mergeTargets && mergeTargets.length > 0) {
    lines.push("", "Defaults de settings que seriam aplicados por merge (preset full):");
    for (const target of mergeTargets) {
      const prefix = target.prefix ? `${target.prefix.join(".")}.` : "";
      const keys = target.defaults.map((d) => `${prefix}${d.path.join(".")}`);
      if (keys.length === 0) {
        lines.push(`  ${c(target.component, DIM)} — sem defaults no v1 (arquivo ${target.file})`);
      } else {
        lines.push(`  ${target.component}:`);
        for (const key of keys) lines.push(`    ${key}`);
      }
    }
  }
  if (conflicts.length > 0) {
    lines.push("", `${c(`Conflito com upstream (${conflicts.length}) — nada será removido:`, YELLOW)}`);
    for (const conflict of conflicts) lines.push(`  ${c("!", YELLOW)} ${conflict.package}`);
  }
  return `${lines.join("\n")}\n`;
}

export function toJson(report: InstallReport): Record<string, unknown> {
  const json: Record<string, unknown> = {
    preset: report.preset,
    scope: report.scope,
    components: report.components,
    installed: report.installed,
    kept: report.kept,
    conflicts: report.conflicts,
    failed: report.failed,
    backup: report.backup ?? null,
    filesTouched: report.filesTouched,
    notes: report.notes,
  };
  if (report.settings) {
    json.settings = {
      created: report.settings.created.map(settingsMergeChangeToJson),
      conflicts: report.settings.conflicts.map(settingsMergeChangeToJson),
      removed: report.settings.removed.map(settingsMergeChangeToJson),
      preserved: report.settings.preserved.map(settingsMergeChangeToJson),
    };
  }
  return json;
}
