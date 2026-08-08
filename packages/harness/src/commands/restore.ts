// restore.ts — restore a snapshot to its original paths (F13, STBK-08).
//
// `harness restore <name>`: validates the snapshot (manifest + all entries)
// BEFORE writing anything (fail-closed — invalid/incomplete snapshots abort
// with nothing modified), snapshots the current config (pre-restore backup, so
// a restore is reversible too) and then extracts every file to the path
// recorded in the manifest. Symlinks are recreated as symlinks; files not
// listed in the snapshot are never touched (non-destructive restore).
//
// Edge (F13): a file that fails to restore individually (e.g. permission) is
// reported and the remaining files still restore; a missing backup reference
// fails listing the available snapshots (STBK 3.2).
import * as fs from "node:fs";
import * as path from "node:path";
import { backupsDir, type Runtime, type Scope, type TextSink } from "../config.ts";
import {
  createSnapshot,
  extractSnapshot,
  listSnapshots,
  resolveSnapshot,
  type ExtractedSnapshot,
} from "../backup.ts";

export interface RestoreCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  scope: Scope;
  /** snapshot name (or path) to restore. */
  name?: string;
}

export interface RestoreReport {
  scope: Scope;
  /** snapshot file name restored. */
  snapshot: string;
  restored: string[];
  /** files that failed to restore individually (reported, others continue). */
  failed: Array<{ file: string; error: string }>;
  /** pre-restore snapshot of the current config (undo point). */
  backup?: string;
}

export interface RestoreErrorReport {
  scope: Scope;
  error: string;
  available: string[];
}

function renderRestore(report: RestoreReport): string {
  const lines = [`@runecraft/companion restore (scope ${report.scope})`];
  lines.push(`Restaurado de ${report.snapshot} (${report.restored.length} arquivo${report.restored.length === 1 ? "" : "s"}):`);
  for (const file of report.restored) lines.push(`  ✓ ${file}`);
  if (report.failed.length > 0) {
    lines.push(`Falhou (${report.failed.length}) — os demais foram restaurados:`);
    for (const fail of report.failed) lines.push(`  ✗ ${fail.file} (${fail.error})`);
  }
  if (report.backup) lines.push(`Backup pré-restore: ${report.backup}`);
  return `${lines.join("\n")}\n`;
}

function renderRestoreJson(report: RestoreReport): string {
  return `${JSON.stringify(
    {
      scope: report.scope,
      snapshot: report.snapshot,
      restored: report.restored,
      failed: report.failed,
      backup: report.backup ?? null,
    },
    null,
    2,
  )}\n`;
}

function renderRestoreError(report: RestoreErrorReport): string {
  const lines = [`@runecraft/companion restore (scope ${report.scope}): ${report.error}`];
  if (report.available.length === 0) {
    lines.push("Nenhum snapshot disponível neste scope — todo install/sync/uninstall cria um antes de modificar config.");
  } else {
    lines.push("Snapshots disponíveis:");
    for (const name of report.available) lines.push(`  ${name}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderRestoreErrorJson(report: RestoreErrorReport): string {
  return `${JSON.stringify({ scope: report.scope, error: report.error, available: report.available }, null, 2)}\n`;
}

function isSymlink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Writes one snapshot entry back to its original path. */
function writeEntry(target: string, entry: ExtractedSnapshot["entries"][number]): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (entry.kind === "symlink") {
    // never follow/expand symlinks on restore (edge F13): replace the path
    fs.rmSync(target, { force: true });
    fs.symlinkSync(entry.linkTarget ?? "", target);
    return;
  }
  // a regular file must not be written through an existing symlink
  if (isSymlink(target)) fs.rmSync(target, { force: true });
  fs.writeFileSync(target, entry.content);
}

export function runRestoreCommand(opts: RestoreCommandOptions): number {
  const { out, err, rt, scope } = opts;
  const dir = backupsDir(rt, scope);
  const available = listSnapshots(dir).map((info) => info.name);

  const fail = (error: string): number => {
    if (opts.json) out.write(renderRestoreErrorJson({ scope, error, available }));
    else err.write(renderRestoreError({ scope, error, available }));
    return 1;
  };

  // STBK 3.2: backup inexistente (ou nome ausente) → falha listando os disponíveis.
  const rawName = opts.name?.trim() ?? "";
  if (rawName === "") {
    return fail("especifique o snapshot a restaurar: `npx @runecraft/companion restore <nome>`");
  }
  const snapshotFile = resolveSnapshot(dir, rawName);
  if (snapshotFile === null) {
    return fail(`snapshot não encontrado: ${rawName}`);
  }

  // Fail-closed (STBK-08): snapshot inválido/incompleto → nada é escrito.
  let extracted: ExtractedSnapshot;
  try {
    extracted = extractSnapshot(snapshotFile);
  } catch (error) {
    return fail((error as Error).message);
  }

  // Pre-restore backup do estado atual (ciclo reversível): falhou → aborta
  // antes de escrever qualquer coisa (mesma garantia fail-safe do STBK-07).
  let backup: string | undefined;
  try {
    const pre = createSnapshot({
      files: extracted.manifest.files,
      destDir: dir,
      reason: "restore",
      scope,
    });
    backup = pre.file;
  } catch (error) {
    return fail(`falha ao criar o backup pré-restore — nada foi modificado. ${(error as Error).message}`);
  }

  // Restaura: arquivos ausentes no disco atual são recriados; falha individual
  // é reportada e os demais seguem (edge F13).
  const restored: string[] = [];
  const failed: RestoreReport["failed"] = [];
  extracted.manifest.files.forEach((target, index) => {
    const entry = extracted.entries[index];
    if (!entry) {
      failed.push({ file: target, error: "entry ausente no snapshot" });
      return;
    }
    try {
      writeEntry(target, entry);
      restored.push(target);
    } catch (error) {
      failed.push({ file: target, error: (error as Error).message });
    }
  });

  const report: RestoreReport = {
    scope,
    snapshot: path.basename(snapshotFile),
    restored,
    failed,
    backup,
  };
  if (opts.json) out.write(renderRestoreJson(report));
  else out.write(renderRestore(report));
  return failed.length > 0 ? 1 : 0;
}
