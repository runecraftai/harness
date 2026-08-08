// backups.ts — snapshot listing and pinning (F13, STBK 3.3).
//
// `harness backups` lists snapshots of the effective scope with date, size,
// files included, trigger and pin state. `--keep <name>` pins a snapshot
// against prune (STBK-06); `--json` gives the machine-readable shape.
import {
  backupsDir,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { listSnapshots, pinSnapshot, type SnapshotInfo } from "../backup.ts";

export interface BackupsCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  scope: Scope;
  /** `backups --keep <name>` — pins a snapshot (never pruned). */
  keep?: string;
}

function renderBackups(snapshots: SnapshotInfo[], opts: { dir: string; scope: Scope }): string {
  const lines = [
    `@runecraft/companion backups (scope ${opts.scope}) — ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} em ${opts.dir}`,
  ];
  if (snapshots.length === 0) {
    lines.push("nenhum snapshot ainda — todo install/sync/uninstall cria um antes de modificar config.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`${"Snapshot".padEnd(38)}${"Data".padEnd(25)}${"Tamanho".padEnd(10)}Trigger${"Pinado".padStart(9)}`);
  for (const snap of snapshots) {
    const size = snap.sizeBytes < 1024 ? `${snap.sizeBytes} B` : `${(snap.sizeBytes / 1024).toFixed(1)} KB`;
    lines.push(
      `${snap.name.padEnd(38)}${snap.createdAt.padEnd(25)}${size.padEnd(10)}${(snap.reason ?? "?").padEnd(7)}${snap.pinned ? "sim" : "não"}`,
    );
    lines.push(`    arquivos (${snap.files.length}): ${snap.files.length > 0 ? snap.files.join(", ") : "(nenhum arquivo existente no momento do snapshot)"}`);
  }
  lines.push("");
  lines.push("Para restaurar: `npx @runecraft/companion restore <snapshot>` · para pinar: `npx @runecraft/companion backups --keep <snapshot>`");
  return `${lines.join("\n")}\n`;
}

function renderBackupsJson(snapshots: SnapshotInfo[], opts: { dir: string; scope: Scope }): string {
  return `${JSON.stringify(
    {
      scope: opts.scope,
      dir: opts.dir,
      snapshots: snapshots.map((s) => ({
        name: s.name,
        createdAt: s.createdAt,
        sizeBytes: s.sizeBytes,
        reason: s.reason ?? null,
        scope: s.scope ?? null,
        files: s.files,
        pinned: s.pinned,
      })),
    },
    null,
    2,
  )}\n`;
}

export function runBackupsCommand(opts: BackupsCommandOptions): number {
  const dir = backupsDir(opts.rt, opts.scope);

  if (opts.keep) {
    try {
      pinSnapshot(dir, opts.keep);
    } catch (error) {
      const message = `@runecraft/companion backups: ${(error as Error).message}`;
      if (opts.json) {
        opts.out.write(`${JSON.stringify({ scope: opts.scope, error: message, snapshots: listSnapshots(dir).map((s) => s.name) }, null, 2)}\n`);
      } else {
        opts.err.write(`${message}\n`);
        opts.err.write("Snapshots disponíveis:\n");
        for (const snap of listSnapshots(dir)) opts.err.write(`  ${snap.name}\n`);
      }
      return 1;
    }
  }

  const snapshots = listSnapshots(dir);
  if (opts.json) opts.out.write(renderBackupsJson(snapshots, { dir, scope: opts.scope }));
  else opts.out.write(renderBackups(snapshots, { dir, scope: opts.scope }));
  return 0;
}
