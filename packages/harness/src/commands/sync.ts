// sync.ts — idempotent reconciliation (F12, LIFE-06).
//
// Compares state.json (what the harness manages) × `pi list` (reality) ×
// versions.ts (expected pins):
//   - state entries missing from `pi list` → reinstall (LIFE 3.1)
//   - state version ≠ expected pin       → reinstall with the pinned version (LIFE 3.3)
//   - nothing to do                      → "already in sync", zero writes (LIFE 3.2)
//
// Packages the user installed by hand (present in `pi list`, absent from
// state) are NEVER touched nor adopted into the state. Sync never edits user
// settings — only restores packages (config is F14's domain). A backup is
// taken before any write (LIFE 3.4); `--dry-run` prints the plan only.
// F15 T8: agentes gerenciados com seção/entry ausente são re-injetados
// (idempotente; reconciliado formalmente no F17).
import * as fs from "node:fs";
import * as path from "node:path";
import {
  backupsDir,
  filesTouchedByInstall,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { createSnapshot } from "../backup.ts";
import { npmIdentity, type PiInterop } from "../pi.ts";
import { loadState, saveState, upsertInstalled, type AgentRecord, type AgentTarget, type HarnessState, type InstalledEntry } from "../state.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { ADAPTERS } from "../adapters/registry.ts";
import { buildAgentTargets } from "../adapters/agentOps.ts";
import { hasSection, readSectionContent } from "../adapters/rules.ts";
import { resolveMcpBin } from "../adapters/mcpConfig.ts";
import { renderRules, renderWorkflowRules, WORKFLOW_RULES_VERSION } from "../adapters/rulesContent.ts";
import { sectionContentHash } from "../sections.ts";
import type { AgentAdapter, AgentContext } from "../adapters/types.ts";
import { MATRIX, columnComponents, type ComponentId, type MatrixAgentId } from "../matrix.ts";
import { scanConflicts, type ConflictInfo } from "../conflicts.ts";
import { withRunecraftLock } from "../lock.ts";
import { defaultGuardsConfig } from "../guards/guardKit.ts";

export interface SyncCommandOptions {
  json: boolean;
  dryRun: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  pi: PiInterop;
  scope: Scope;
}

export interface SyncAction {
  /** package name, e.g. @runecraft/subagents */
  name: string;
  group: string;
  /** full pinned spec passed to pi install, e.g. npm:@runecraft/subagents@0.37.2 */
  spec: string;
  reason: "missing" | "version-divergence";
  stateVersion: string;
  expected: string;
}

export interface SyncReport {
  scope: Scope;
  status: "in-sync" | "dry-run" | "synced" | "error";
  installed: string[];
  diverged: Array<{ package: string; from: string; to: string }>;
  kept: string[];
  /** catalog packages present in `pi list` but not in state (user installed by hand). */
  preserved: string[];
  conflicts: ConflictInfo[];
  failed: Array<{ spec: string; code: number | null; stderr: string }>;
  backup?: string;
  /** dir where the pre-write snapshot lives (or would live in dry-run). */
  backupDir?: string;
  corruptStatePath?: string;
  notes: string[];
}

export interface SyncPlan {
  actions: SyncAction[];
  kept: string[];
  preserved: string[];
  conflicts: ConflictInfo[];
  notes: string[];
}

/** Builds the reconciliation plan (pure — no side effects). */
export function buildSyncPlan(
  stateEntries: Record<string, InstalledEntry>,
  piPackages: string[],
): SyncPlan {
  const identities = new Set(piPackages.map(npmIdentity));
  const actions: SyncAction[] = [];
  const kept: string[] = [];
  const notes: string[] = [];

  for (const [name, entry] of Object.entries(stateEntries)) {
    const expected = HARNESS_VERSIONS[name];
    if (!expected) {
      notes.push(`${name}: versão esperada desconhecida no manifest do harness — entry ignorada`);
      continue;
    }
    const spec = `${entry.source}@${expected}`;
    if (!identities.has(entry.source)) {
      actions.push({ name, group: entry.group, spec, reason: "missing", stateVersion: entry.version, expected });
    } else if (entry.version !== expected) {
      actions.push({
        name,
        group: entry.group,
        spec,
        reason: "version-divergence",
        stateVersion: entry.version,
        expected,
      });
    } else {
      kept.push(spec);
    }
  }

  // Catalog packages installed by hand (present, not managed) — preserved, never adopted.
  const preserved: string[] = [];
  for (const spec of piPackages) {
    const identity = npmIdentity(spec).replace(/^npm:/, "");
    if (HARNESS_VERSIONS[identity] !== undefined && !stateEntries[identity]) preserved.push(spec);
  }

  return { actions, kept, preserved, conflicts: scanConflicts(piPackages), notes };
}

function renderSync(report: SyncReport, opts: { tty: boolean }): string {
  const c = (s: string, color: string) => (opts.tty ? `${color}${s}\u001b[0m` : s);
  if (report.status === "in-sync") {
    const lines = [`@runecraft/harness sync (scope ${report.scope}): already in sync — zero mudanças`];
    for (const note of report.notes) lines.push(`${c("note:", "\u001b[2m")} ${note}`);
    if (report.preserved.length > 0) {
      lines.push(`Preservado (instalado à mão, fora do state): ${report.preserved.join(", ")}`);
    }
    for (const conflict of report.conflicts) {
      lines.push(`${c("warn:", "\u001b[33m")} colisão com upstream ${conflict.package} — ${conflict.suggestion}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [`@runecraft/harness sync (scope ${report.scope})`];
  for (const note of report.notes) lines.push(`${c("note:", "\u001b[2m")} ${note}`);
  if (report.installed.length > 0) {
    lines.push(`${c(`Reinstalado (${report.installed.length}):`, "\u001b[32m")}`);
    for (const spec of report.installed) lines.push(`  ${c("✓", "\u001b[32m")} ${spec}`);
  }
  if (report.diverged.length > 0) {
    lines.push(`Versão divergente (${report.diverged.length}):`);
    for (const d of report.diverged) lines.push(`  ${c("↻", "\u001b[33m")} ${d.package}: state ${d.from} → esperado ${d.to}`);
  }
  if (report.kept.length > 0) {
    lines.push(`Em sync, mantido (${report.kept.length}):`);
    for (const spec of report.kept) lines.push(`  ${c("=", "\u001b[2m")} ${spec}`);
  }
  if (report.preserved.length > 0) {
    lines.push(`${c(`Preservado (instalado à mão, fora do state — não adotado) (${report.preserved.length}):`, "\u001b[2m")}`);
    for (const spec of report.preserved) lines.push(`  ${c("=", "\u001b[2m")} ${spec}`);
  }
  if (report.conflicts.length > 0) {
    lines.push(`${c(`Colisão com upstream (${report.conflicts.length}) — nada removido:`, "\u001b[33m")}`);
    for (const conflict of report.conflicts) lines.push(`  ${c("!", "\u001b[33m")} ${conflict.package} (${conflict.suggestion})`);
  }
  if (report.failed.length > 0) {
    lines.push(`${c(`Falhou (${report.failed.length}):`, "\u001b[31m")}`);
    for (const fail of report.failed) {
      lines.push(`  ${c("✗", "\u001b[31m")} ${fail.spec} (exit ${fail.code ?? "?"})`);
      const detail = fail.stderr.trim();
      if (detail) lines.push(`    ${detail.split(/\r?\n/)[0]}`);
    }
  }
  if (report.status === "dry-run") lines.push(`DRY-RUN — nada foi modificado. Backup pré-write seria criado em ${report.backupDir ?? "<backups dir>"}.`);
  if (report.backup) lines.push(`${c(`Backup pré-sync: ${report.backup}`, "\u001b[2m")}`);
  if (report.corruptStatePath) lines.push(`${c(`state.json corrompido foi movido para ${report.corruptStatePath}`, "\u001b[33m")}`);
  return `${lines.join("\n")}\n`;
}

export function renderSyncJson(report: SyncReport): string {
  return `${JSON.stringify(
    {
      scope: report.scope,
      status: report.status,
      installed: report.installed,
      diverged: report.diverged,
      kept: report.kept,
      preserved: report.preserved,
      conflicts: report.conflicts,
      failed: report.failed,
      backup: report.backup ?? null,
      notes: report.notes,
    },
    null,
    2,
  )}\n`;
}

/** Write-lock wrapper (F18 Riscos). Dry-run não escreve — roda sem lock. */
export async function runSyncCommand(opts: SyncCommandOptions): Promise<number> {
  if (opts.dryRun) return runSyncCommandLocked(opts);
  try {
    return await withRunecraftLock(opts.rt, opts.scope, "sync", () => runSyncCommandLocked(opts));
  } catch (error) {
    opts.err.write(`@runecraft/harness sync: ${(error as Error).message}\n`);
    return 1;
  }
}

async function runSyncCommandLocked(opts: SyncCommandOptions): Promise<number> {
  const { out, err, rt, scope } = opts;
  const stateFile = statePath(rt, scope);
  const loaded = loadState(stateFile, scope);

  // Modo conservador (edge F12): state corrompido → não reconcilia nada (nada
  // pode ser atribuído ao harness com segurança). O arquivo foi movido para
  // <file>.corrupt-<ts> pelo loadState; nenhum write acontece aqui.
  if (loaded.corruptPath && loaded.corruptPath !== stateFile) {
    const message = `warn: state.json corrompido — movido para ${loaded.corruptPath}; sync abortado em modo conservador (nada foi modificado).`;
    if (opts.json) {
      out.write(
        renderSyncJson({ scope, status: "error", installed: [], diverged: [], kept: [], preserved: [], conflicts: [], failed: [], corruptStatePath: loaded.corruptPath, notes: [message] }),
      );
    } else {
      err.write(`${message}\n`);
    }
    return 1;
  }
  if (loaded.created) {
    const message = "warn: nenhum state registrado neste scope — nada para reconciliar (rode `npx @runecraft/harness install`).";
    if (opts.json) {
      out.write(
        renderSyncJson({ scope, status: "in-sync", installed: [], diverged: [], kept: [], preserved: [], conflicts: [], failed: [], notes: [message] }),
      );
    } else {
      out.write(`@runecraft/harness sync (scope ${scope}): ${message}\n`);
    }
    return 0;
  }

  const list = opts.pi.list();
  if (list.error) {
    // Edge F12: sync opera com fallback de settings.json + warn.
    opts.err.write(`warn: \`pi list\` falhou (${list.error}) — usando fallback de settings.json.\n`);
  }
  const plan = buildSyncPlan(loaded.state.components, list.packages);

  // F17 D6: pendência por CONTEÚDO (seção/entry ausente, não só arquivo
  // sumido) + coluna nova (célula sem target registrado e config ausente) +
  // órfãs de matriz (reportados, nunca removidos). Computada aqui para o
  // early-return de in-sync também considerar agentes pendentes.
  const agentPlan = planAgentReconciliation(rt, loaded.state);
  const pendingNotes = agentPlan.pending.map(
    (p) => `${p.agentId}: re-injetar (${p.missingCells.join(", ")} ausente)`,
  );
  // F19 D7: os 4 estados por target rules (reportados nas notas; apenas
  // pending/stale geram escrita — edited preserva, in-sync não aparece).
  const templateChangedNotes = agentPlan.templateChanged.map(
    (t) => `${t.agentId}: atualizar (template ${t.fromVersion}→${WORKFLOW_RULES_VERSION})`,
  );
  const editedNotes = agentPlan.edited.map(
    (e) => `${e.agentId}: rules preservada (editada — usuário editou; sync nunca sobrescreve)`,
  );
  // F24 (GUARD-06 AC 4.4): re-aplica o config de guards ao state — quando a
  // seção `guards` está AUSENTE (state da era pré-F24 ou removida à mão) o
  // sync grava os defaults fail-closed. Config presente (mesmo inválida) NUNCA
  // é reescrita aqui (D10: o doctor reporta + o guard opera fail-closed).
  const guardsDefaultsApplied = loaded.state.guards === undefined;
  if (guardsDefaultsApplied) loaded.state.guards = defaultGuardsConfig();
  const guardsNote = guardsDefaultsApplied ? "guards: defaults fail-closed re-aplicados ao state (F24)" : "";
  const hasChanges =
    plan.actions.length > 0 || agentPlan.pending.length > 0 || agentPlan.templateChanged.length > 0 || guardsDefaultsApplied;

  if (!hasChanges) {
    const report: SyncReport = {
      scope,
      status: "in-sync",
      installed: [],
      diverged: [],
      kept: plan.kept,
      preserved: plan.preserved,
      conflicts: plan.conflicts,
      failed: [],
      notes: [...plan.notes, ...agentPlan.orphanNotes, ...agentPlan.staleNotes, ...editedNotes, ...(guardsNote ? [guardsNote] : [])],
    };
    if (opts.json) out.write(renderSyncJson(report));
    else out.write(renderSync(report, { tty: false }));
    return 0;
  }

  if (opts.dryRun) {
    const report: SyncReport = {
      scope,
      status: "dry-run",
      installed: plan.actions.map((a) => a.spec),
      diverged: plan.actions
        .filter((a) => a.reason === "version-divergence")
        .map((a) => ({ package: a.name, from: a.stateVersion, to: a.expected })),
      kept: plan.kept,
      preserved: plan.preserved,
      conflicts: plan.conflicts,
      failed: [],
      backupDir: backupsDir(rt, scope),
      notes: [
        ...plan.notes,
        ...agentPlan.orphanNotes,
        ...agentPlan.staleNotes,
        ...pendingNotes.map((n) => `(dry-run) ${n}`),
        ...templateChangedNotes.map((n) => `(dry-run) ${n}`),
        ...editedNotes,
        ...(guardsNote ? [`(dry-run) ${guardsNote}`] : []),
      ],
    };
    if (opts.json) out.write(renderSyncJson(report));
    else out.write(renderSync(report, { tty: false }));
    return 0;
  }

  // Backup pré-write (LIFE 3.4): falhou → aborta antes de modificar qualquer coisa.
  // Alvos dos agentes gerenciados entram no snapshot (F15 T8: reconciliação).
  const agentTargetFiles = Object.values(loaded.state.agents).flatMap((rec) =>
    rec.targets.map((t) => t.file),
  );
  let backupFile: string | undefined;
  try {
    const snapshot = createSnapshot({
      files: [...filesTouchedByInstall(rt, scope), ...agentTargetFiles],
      destDir: backupsDir(rt, scope),
      reason: "sync",
      scope,
    });
    backupFile = snapshot.file;
  } catch (error) {
    err.write(
      `@runecraft/harness sync: falha ao criar o snapshot pré-write — nada foi modificado.\n  ${(error as Error).message}\n`,
    );
    return 1;
  }

  const installed: string[] = [];
  const diverged: SyncReport["diverged"] = [];
  const failed: SyncReport["failed"] = [];
  for (const action of plan.actions) {
    const result = opts.pi.install(action.spec, scope);
    if (result.ok) {
      installed.push(action.spec);
      if (action.reason === "version-divergence") {
        diverged.push({ package: action.name, from: action.stateVersion, to: action.expected });
      }
      upsertInstalled(loaded.state, {
        name: action.name,
        group: action.group,
        source: action.spec.replace(/@[^@]+$/, ""),
        version: action.expected,
      });
    } else {
      const stderr = result.stderr.trim() || `pi install falhou com exit code ${result.code ?? "?"}`;
      failed.push({ spec: action.spec, code: result.code, stderr });
      err.write(`  ✗ ${action.spec} — ${stderr.split(/\r?\n/)[0]}\n`);
    }
  }

  try {
    saveState(stateFile, loaded.state);
  } catch (error) {
    err.write(`@runecraft/harness sync: falha ao gravar o state (${(error as Error).message}).\n`);
  }

  // F17 D6: re-inject dos agentes pendentes (planejados acima) — idempotente,
  // targets pós-inject registrados no state (mesma regra do install — D2).
  // F19 D7 three-way por target rules: pendente → re-injeta; template mudou
  // (arquivo == registrado ≠ render) → update in-place pelo ID estável via
  // inject + contentHash novo; usuário editou (arquivo ≠ registrado) →
  // preserveRules no inject (nunca sobrescreve) + reporta. Órfãs de matriz já
  // foram reportados no plano; nunca removidos aqui (remoção é contrato do
  // uninstall).
  const agentNotes: string[] = [...agentPlan.orphanNotes, ...agentPlan.staleNotes];
  let agentsChanged = false;
  const templateVersionById = new Map(agentPlan.templateChanged.map((t) => [t.agentId, t.fromVersion]));
  const editedIds = new Set(agentPlan.edited.map((e) => e.agentId));
  const pendingById = new Map(agentPlan.pending.map((p) => [p.agentId, p.missingCells]));

  // Só-editado (nenhuma outra pendência): zero writes — preserva + reporta.
  for (const edited of agentPlan.edited) {
    if (!templateVersionById.has(edited.agentId) && !pendingById.has(edited.agentId)) {
      agentNotes.push(`${edited.agentId}: rules preservada (editada — usuário editou; sync nunca sobrescreve)`);
    }
  }

  const toSync = new Set<string>([...pendingById.keys(), ...templateVersionById.keys()]);
  for (const agentId of toSync) {
    const adapter = ADAPTERS[agentId as keyof typeof ADAPTERS];
    const rec = loaded.state.agents[agentId];
    if (!rec) continue; // sumiu do state entre o plano e a execução (corrida)
    const missingCells = pendingById.get(agentId) ?? [];
    const templateChanged = templateVersionById.get(agentId);
    const preserveRules = editedIds.has(agentId);
    try {
      const ctx = syncAgentContext(adapter, rt, rec, { preserveRules });
      const outcome = await adapter.inject(ctx);
      const targets = buildAgentTargets(adapter, rt, ctx, outcome, rec);
      if (targets.length > 0) {
        loaded.state.agents[agentId] = { ...rec, targets };
        agentsChanged = true;
      }
      if (templateChanged !== undefined) {
        agentNotes.push(`${agentId}: atualizada (template ${templateChanged}→${WORKFLOW_RULES_VERSION})`);
      }
      if (missingCells.length > 0) {
        agentNotes.push(`${agentId}: re-injetado (${missingCells.join(", ")} ausente)`);
      }
      if (preserveRules) {
        agentNotes.push(`${agentId}: rules preservada (editada — usuário editou; sync nunca sobrescreve)`);
      }
      if (outcome.conflicts.length > 0) {
        for (const conflict of outcome.conflicts) {
          agentNotes.push(`  ${agentId} conflito: ${conflict.file} (${conflict.reason})`);
        }
      }
    } catch (error) {
      // O inject pode ter gravado a rules ANTES de falhar na etapa MCP
      // (config ilegível). Reporta o que aconteceu de fato, não só o erro.
      const paths = adapter.paths(rt);
      const rulesCell = MATRIX[agentId as MatrixAgentId].rules;
      const rulesRestored = rulesCell?.kind === "rules" && hasSection(paths.rulesFile, rulesCell.section);
      agentNotes.push(
        rulesRestored
          ? `${agentId}: rules re-injetada; etapa MCP falhou — ${(error as Error).message} (corrija a config e rode sync de novo)`
          : `${agentId}: re-inject falhou (${(error as Error).message})`,
      );
    }
  }
  if (agentsChanged) {
    try {
      saveState(stateFile, loaded.state);
    } catch (error) {
      err.write(`@runecraft/harness sync: falha ao gravar o state dos agentes (${(error as Error).message}).\n`);
    }
  }

  const report: SyncReport = {
    scope,
    status: "synced",
    installed,
    diverged,
    kept: plan.kept,
    preserved: plan.preserved,
    conflicts: plan.conflicts,
    failed,
    backup: backupFile,
    notes: [...plan.notes, ...agentNotes, ...(guardsNote ? [guardsNote] : [])],
  };
  if (opts.json) out.write(renderSyncJson(report));
  else out.write(renderSync(report, { tty: false }));

  return failed.length > 0 ? 1 : 0;
}

/**
 * F17 D6 — planejamento read-only da reconciliação de agentes: células da
 * coluna da matriz (rules/mcp) com config real ausente → pending (re-inject);
 * F19 D7 three-way por target rules — arquivo × registrado × render do
 * template: arquivo == registrado ≠ render → templateChanged (update
 * in-place); arquivo ≠ registrado → edited (preserva + reporta); arquivo ==
 * registrado == render → em sincronia (zero writes). targets sem célula na
 * matriz atual → órfãos (reportados, nunca removidos); agentes no state sem
 * adapter → stale (matriz mudou entre versões do CLI).
 */
export function planAgentReconciliation(
  rt: Runtime,
  state: HarnessState,
): {
  pending: Array<{ agentId: string; missingCells: string[] }>;
  /** F19 D7: rules template mudou — arquivo == registrado ≠ render (update in-place). */
  templateChanged: Array<{ agentId: string; fromVersion: string }>;
  /** F19 D7: rules editada pelo usuário — arquivo ≠ registrado (preserva + reporta). */
  edited: Array<{ agentId: string }>;
  orphanNotes: string[];
  staleNotes: string[];
} {
  const pending: Array<{ agentId: string; missingCells: string[] }> = [];
  const templateChanged: Array<{ agentId: string; fromVersion: string }> = [];
  const edited: Array<{ agentId: string }> = [];
  const orphanNotes: string[] = [];
  const staleNotes: string[] = [];
  for (const [agentId, rec] of Object.entries(state.agents)) {
    const matrixId = agentId as MatrixAgentId;
    const adapter = ADAPTERS[agentId as keyof typeof ADAPTERS];
    if (!adapter) {
      staleNotes.push(`agente '${agentId}' no state sem adapter no CLI — ignorado (matriz mudou?)`);
      continue;
    }
    for (const target of rec.targets) {
      if (MATRIX[matrixId]?.[target.component as ComponentId] === undefined) {
        orphanNotes.push(
          `${agentId}: target órfão (matriz mudou) — '${target.component}' em ${target.file} (não removido; use \`harness uninstall --agent ${agentId}\`)`,
        );
      }
    }
    const paths = adapter.paths(rt);
    const missingCells: string[] = [];
    let unreadable = false;
    const rulesTarget = rec.targets.find(
      (t): t is Extract<AgentTarget, { kind: "rules" }> => t.kind === "rules" && Boolean(t.contentHash),
    );
    for (const component of columnComponents(matrixId)) {
      const cell = MATRIX[matrixId][component];
      if (cell?.kind === "rules") {
        if (!hasSection(paths.rulesFile, cell.section)) {
          missingCells.push(component);
        } else if (rulesTarget) {
          // F19 D7 three-way (por target rules): arquivo × registrado × render.
          const fileContent = readSectionContent(paths.rulesFile, cell.section);
          const fileHash = sectionContentHash(cell.section, fileContent ?? "");
          if (fileHash === rulesTarget.contentHash) {
            const renderHash = sectionContentHash(cell.section, renderRules(matrixId));
            if (renderHash !== rulesTarget.contentHash) {
              templateChanged.push({ agentId, fromVersion: rulesTarget.rulesVersion ?? "?" });
            }
          } else {
            edited.push({ agentId });
          }
        }
      } else if (cell?.kind === "mcp") {
        let fingerprint: string | null;
        try {
          fingerprint = adapter.readMcpFingerprint(rt);
        } catch {
          // Config ilegível (JSON/TOML quebrado) NÃO é pendência de re-inject:
          // o inject também falharia e o arquivo deve ficar para o usuário
          // corrigir (doctor check 11 aponta; sync é o remedy do check 9/11).
          unreadable = true;
          continue;
        }
        if (fingerprint === null) missingCells.push(component);
      }
    }
    if (unreadable) {
      staleNotes.push(
        `${agentId}: config MCP ilegível em ${paths.mcpFile} — re-inject ignorado (corrija o arquivo; doctor check 11 aponta o erro)`,
      );
    }
    if (missingCells.length > 0) pending.push({ agentId, missingCells });
  }
  return { pending, templateChanged, edited, orphanNotes, staleNotes };
}

/** Context de re-inject do sync (regras do template + bin do fork). F19 D7:
 *  preserveRules marca o inject para NÃO reescrever a seção editada pelo
 *  usuário (arquivo ≠ registrado) — a regra é preservada e reportada. */
function syncAgentContext(
  adapter: AgentAdapter,
  rt: Runtime,
  rec: AgentRecord,
  opts: { preserveRules?: boolean } = {},
): AgentContext {
  const mcp = resolveMcpBin(adapter.id === "claude-code" ? "claude" : adapter.id, rt);
  return {
    rt,
    mcpBin: mcp.command[mcp.command.length - 1] ?? "",
    mcpBinCommand: mcp.command,
    rulesContent: renderWorkflowRules(adapter.id),
    mcpArgs: [],
    targets: rec.targets,
    preserveRules: opts.preserveRules,
  };
}
