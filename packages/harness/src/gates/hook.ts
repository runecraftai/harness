// gates/hook.ts — git hook shims (D4) + .gitignore helpers (fluxo 3).
//
// The hook is a minimal POSIX shim that delegates to `harness gates run
// <hook>`; every decision (hash, algebra, messages) lives in tested TS.
// Installation uses the sections engine shell family (F18/AD-014):
// `# BEGIN runecraft:gates` … `# END runecraft:gates`. A pre-existing hook is
// preserved (append — never overwrite); a missing hook is created with a
// shebang; the file is chmod +x; no BOM (a BOM before the shebang breaks
// execution).
//
// Binary resolution (design fluxo 3): `RUNECRAFT_BIN` (testability, F11
// pattern) > `harness` on PATH > `npx --no-install @runecraft/harness` (no
// download, fast fail). Binary missing → deny fail-closed with a remedy.
//
// Note (divergência documentada): the fluxo-3 block of the design shows the
// marker line with a trailing comment; the sections engine matches strict
// `# BEGIN runecraft:gates` markers (listSectionIds/hasSectionFamily), so the
// marker is engine-exact and the "gerenciado pelo harness, não editar" note
// lives as the first body line. `RUNECRAFT_BIN` is checked first per the
// resolution list of the same design section.
import * as fs from "node:fs";
import * as path from "node:path";
import { hasSectionFamily, removeSectionFamily, upsertSectionFamily } from "../sections.ts";

export const GATES_SECTION_ID = "runecraft:gates" as const;
export const GATES_SECTION_FAMILY = "shell" as const;

export const HOOK_NAMES = ["pre-commit", "pre-push"] as const;
export type GateHookName = (typeof HOOK_NAMES)[number];

/**
 * Hooks dir for a repo root: `<root>/.git/hooks`. Same path git resolves
 * (`git rev-parse --git-path hooks`) for a main repo AND linked worktrees
 * (git falls back to `$GIT_COMMON_DIR/hooks` — verificado no Execute com
 * worktree real).
 */
export function hooksDirFor(root: string): string {
  return path.join(root, ".git", "hooks");
}

/** Exact shim body (the content between the section markers) for one hook. */
export function gatesShimBody(hook: GateHookName): string {
  return [
    "# Gerenciado pelo harness — não editar.",
    `if [ -n "$RUNECRAFT_BIN" ]; then`,
    `  exec "$RUNECRAFT_BIN" gates run ${hook}`,
    "elif command -v harness >/dev/null 2>&1; then",
    `  exec harness gates run ${hook}`,
    "elif command -v npx >/dev/null 2>&1; then",
    `  exec npx --no-install @runecraft/harness gates run ${hook}`,
    "else",
    '  echo "runecraft gates: harness não encontrado (npm i -g @runecraft/harness)" >&2',
    "  exit 1",
    "fi",
  ].join("\n");
}

export interface HooksInstallResult {
  /** hook files written (created or section upserted). */
  written: string[];
  /** hook files created from scratch (createdFiles candidates — removed whole on uninstall). */
  created: string[];
  /** hook files already in sync (no write). */
  unchanged: string[];
}

/**
 * Install the gates shim into every hook of the hooks dir. Files created from
 * scratch start with `#!/bin/sh` (the sections engine appends the block after
 * it). Idempotent rerun: same content → zero writes. chmod +x always.
 */
export function installGatesHooks(hooksDir: string, hookNames: readonly GateHookName[] = HOOK_NAMES): HooksInstallResult {
  fs.mkdirSync(hooksDir, { recursive: true });
  const result: HooksInstallResult = { written: [], created: [], unchanged: [] };
  for (const hook of hookNames) {
    const file = path.join(hooksDir, hook);
    const wasMissing = !fs.existsSync(file);
    if (wasMissing) {
      // Shebang first — the engine appends the section right after it.
      fs.writeFileSync(file, "#!/bin/sh\n", { encoding: "utf8" });
    }
    const upsert = upsertSectionFamily(file, GATES_SECTION_ID, gatesShimBody(hook), GATES_SECTION_FAMILY);
    // BOM check: files WE create must never start with a BOM (breaks the
    // shebang). A pre-existing hook with a BOM keeps it (engine contract).
    if (wasMissing) {
      const raw = fs.readFileSync(file);
      if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
        fs.writeFileSync(file, raw.subarray(3), { encoding: "utf8", mode: 0o755 });
      }
    }
    fs.chmodSync(file, 0o755);
    if (wasMissing) result.created.push(file);
    if (upsert.changed || wasMissing) result.written.push(file);
    else result.unchanged.push(file);
  }
  return result;
}

export interface HooksRemoveResult {
  /** hooks where our section was removed and the file content rewritten. */
  removed: string[];
  /** hook files deleted whole (created from scratch by us, per createdFiles or shebang-only residue). */
  deleted: string[];
  /** hooks with no runecraft:gates section — left untouched. */
  untouched: string[];
}

/**
 * Remove the gates section from hooks (design fluxo 5 / F18 shell family).
 * Rules: a file WE created from scratch (registered in createdFiles) is
 * removed whole; a file that after section removal holds only a bare shebang
 * (residue of a fresh install whose createdFiles registration was lost) is
 * removed too — a shebang-only hook is a no-op, so nothing functional is
 * lost; otherwise the pre-existing content is written back byte-for-byte
 * (user hooks preserved).
 */
export function removeGatesHooks(
  hooksDir: string,
  createdFiles: string[],
  hookNames: readonly GateHookName[] = HOOK_NAMES,
): HooksRemoveResult {
  const result: HooksRemoveResult = { removed: [], deleted: [], untouched: [] };
  const createdSet = new Set(createdFiles);
  for (const hook of hookNames) {
    const file = path.join(hooksDir, hook);
    if (!fs.existsSync(file)) continue;
    if (createdSet.has(file)) {
      fs.rmSync(file, { force: true });
      result.deleted.push(file);
      continue;
    }
    const next = removeSectionFamily(file, GATES_SECTION_ID, GATES_SECTION_FAMILY);
    if (next === null) {
      result.untouched.push(file);
      continue;
    }
    const trimmed = next.replace(/^\ufeff/, "").trim();
    if (trimmed === "#!/bin/sh") {
      // Só o shebang sobrou — criado por nós (registro perdido) → remove.
      fs.rmSync(file, { force: true });
      result.deleted.push(file);
      continue;
    }
    fs.writeFileSync(file, next, "utf8");
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
    result.removed.push(file);
  }
  return result;
}

/** True when the hooks dir has a complete runecraft:gates section in `file`. */
export function hasGatesSection(file: string): boolean {
  return hasSectionFamily(file, GATES_SECTION_ID, GATES_SECTION_FAMILY);
}

// ---------------------------------------------------------------------------
// .gitignore (fluxo 3): only the fine-grained lines, never `.runecraft/`
// wholesale (state.json/backups de workspace do F13 ficam fora).
// ---------------------------------------------------------------------------

/** The exact lines the harness guarantees in `.gitignore` (fine scope). */
export const GITIGNORE_LINES: readonly string[] = [".runecraft/receipts/", ".runecraft/config.json"];

export function gitignorePath(root: string): string {
  return path.join(root, ".gitignore");
}

export interface GitignoreEnsureResult {
  changed: boolean;
  created: boolean;
  added: string[];
}

/**
 * Append the gates lines to `.gitignore` (idempotent; only missing exact
 * lines are added; nothing else is touched).
 */
export function ensureGitignoreLines(root: string): GitignoreEnsureResult {
  const file = gitignorePath(root);
  const existed = fs.existsSync(file);
  const current = existed ? fs.readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const added = GITIGNORE_LINES.filter((line) => !lines.includes(line));
  if (added.length === 0) return { changed: false, created: false, added: [] };
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const body = current.replace(/\s+$/, "");
  const content = body === "" ? `${added.join(eol)}${eol}` : `${body}${eol}${eol}${added.join(eol)}${eol}`;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return { changed: true, created: !existed, added };
}

export interface GitignoreRemoveResult {
  removed: string[];
  preserved: string[];
}

/**
 * Remove the gates lines ONLY when they still match exactly what we added
 * (SETM-05 — a user-edited line is preserved and reported). Other lines are
 * never touched.
 */
export function removeGitignoreLinesIfUnchanged(root: string): GitignoreRemoveResult {
  const file = gitignorePath(root);
  if (!fs.existsSync(file)) return { removed: [], preserved: [] };
  const current = fs.readFileSync(file, "utf8");
  const lines = current.split(/\r?\n/);
  const removed = GITIGNORE_LINES.filter((line) => lines.includes(line));
  if (removed.length === 0) return { removed: [], preserved: [] };
  const remaining = lines.filter((line) => !GITIGNORE_LINES.includes(line));
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const content = `${remaining.join(eol)}${remaining.length > 0 ? eol : ""}`;
  fs.writeFileSync(file, content, "utf8");
  const preserved = GITIGNORE_LINES.filter((line) => !removed.includes(line));
  return { removed, preserved };
}

/** Which of the gates lines are present in `.gitignore` (read-only). */
export function gitignoreGatesLines(root: string): string[] {
  const file = gitignorePath(root);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  return GITIGNORE_LINES.filter((line) => lines.includes(line));
}
