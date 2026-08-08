// verify/repo.ts — estado do repo para a cascata (F25, D1/D10/F1 — validado no Execute).
//
// Fonte compartilhada do input da engine para o gate de sessão (complete_goal)
// e o CLI `harness verify` (D10 — MESMA engine; a preparação do input é
// compartilhada onde o contexto permite):
//   - `collectRepoDiff` — diff do working tree vs HEAD (inclui untracked):
//     `git status --porcelain --untracked-files=all` (lista de arquivos) +
//     `git diff HEAD --numstat` (linhas +/− por arquivo rastreado) + conteúdo
//     de arquivos untracked (tudo é "added"). Fora de repo git → null (infra).
//   - `readGllaGoalContext` — spec da sessão (ledger `.pi-glla/active.jsonl`,
//     formato validado no F24): objective do goal + títulos da taskList.
//   - `detectStructuralCommands` — scripts lint/typecheck/test do package.json
//     do repo (raiz git primeiro, cwd como fallback — validado no Execute).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Diff do working tree (D10 — "output" do CLI e fonte da camada 3/4). */
export interface RepoDiff {
  /** paths relativos tocados (ordem do git status; inclui untracked). */
  files: string[];
  /** paths relativos DELETADOS (arquivos que existiam em HEAD e sumiram). */
  deleted: string[];
  /** tokens adicionados + deletados (linhas do numstat + conteúdo untracked). */
  addedTokens: number;
  deletedTokens: number;
  /** texto completo do diff (camada 4 embedding / camada 5 judge). */
  text: string;
  /** contagem de linhas por arquivo em HEAD (baseline da camada 2). */
  headLines: Record<string, number>;
  /** linhas +/− por arquivo rastreado (numstat; camada 2 — substituição integral). */
  fileStats: Record<string, { added: number; deleted: number }>;
}

export type RepoDiffRead = { ok: true; diff: RepoDiff } | { ok: false; reason: "not-a-repo" | "git-error"; detail?: string };

export interface RepoState {
  cwd: string;
  /** diff do working tree (null fora de repo git — infra). */
  diff: RepoDiff | null;
  /** scripts detectados no package.json do repo (nome → comando). */
  scripts: Record<string, string>;
  /** raiz do repo git (null fora de repo). */
  gitRoot: string | null;
}

/** exec de git sem config global (mesmo padrão do gitRepo.ts do fixture — GIT_CONFIG_* anulado). */
function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
}

/** Dirs internos do harness (bookkeeping — nunca parte do deliverable do goal). */
const INTERNAL_DIRS = [".pi-glla", ".runecraft"] as const;

function isInternalPath(rel: string): boolean {
  return INTERNAL_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv): { ok: true; out: string } | { ok: false; error: string } {
  try {
    const out = execFileSync("git", args, { cwd, env: gitEnv(env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** Tokens de um texto (whitespace) — medida determinística de tamanho. */
export function countTokens(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Conta tokens de linhas com prefixo +/− de um diff (sem linhas de header). */
function countDiffLineTokens(text: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += countTokens(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) deleted += countTokens(line.slice(1));
  }
  return { added, deleted };
}

/** Contagem de linhas de um arquivo (para o baseline da camada 2). */
function countFileLines(file: string): number {
  try {
    const content = fs.readFileSync(file, "utf8");
    return content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * Diff do working tree vs HEAD (D10). Inclui arquivos untracked (o git diff
 * não os mostra — a sessão escreve arquivos novos; sem eles o diff seria
 * vazio e a camada 3 classificaria "empty" por engano). Repo sem commits
 * (sem HEAD) → apenas untracked. Fora de repo git → not-a-repo.
 */
export function collectRepoDiff(cwd: string, env: NodeJS.ProcessEnv): RepoDiffRead {
  const root = repoRootOf(cwd, env);
  if (root === null) return { ok: false, reason: "not-a-repo" };

  const status = git(["status", "--porcelain", "--untracked-files=all"], root, env);
  if (!status.ok) return { ok: false, reason: "git-error", detail: status.error };

  const hasHead = git(["rev-parse", "--verify", "HEAD"], root, env).ok;
  const files: string[] = [];
  const deleted: string[] = [];
  let addedTokens = 0;
  let deletedTokens = 0;
  const textParts: string[] = [];
  const headLines: Record<string, number> = {};
  const fileStats: Record<string, { added: number; deleted: number }> = {};

  // Rastreados (M/A/D/R) — numstat por arquivo (linhas +/−).
  if (hasHead) {
    const numstat = git(["diff", "HEAD", "--numstat"], root, env);
    if (numstat.ok) {
      for (const line of numstat.out.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const added = Number.parseInt(parts[0] ?? "0", 10);
        const del = Number.parseInt(parts[1] ?? "0", 10);
        const file = parts.slice(2).join("\t");
        if (Number.isNaN(added) || Number.isNaN(del)) continue;
        if (isInternalPath(file)) continue; // bookkeeping do harness
        files.push(file);
        addedTokens += added;
        deletedTokens += del;
        headLines[file] = countFileLines(path.join(root, file));
        fileStats[file] = { added, deleted: del };
        // Headers de arquivo para o texto do diff (numstat não tem conteúdo).
        textParts.push(`diff --git a/${file} b/${file}`);
        textParts.push(`--- a/${file}`);
        textParts.push(`+++ b/${file}`);
      }
    }
  }

  // Untracked (??) — conteúdo todo é "added" (não existe em HEAD).
  for (const line of status.out.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^"|"$/g, "").replace(/\\"/g, '"');
    if (file.length === 0) continue;
    const untracked = code.trim() === "??";
    if (untracked) {
      if (isInternalPath(file)) continue; // bookkeeping do harness
      files.push(file);
      const abs = path.join(root, file);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const content = fs.readFileSync(abs, "utf8");
        const tokens = countTokens(content);
        addedTokens += tokens;
        textParts.push(`diff --git a/${file} b/${file}`);
        textParts.push(`--- /dev/null`);
        textParts.push(`+++ b/${file}`);
        for (const contentLine of content.split("\n")) {
          textParts.push(`+${contentLine}`);
        }
      }
    } else if (code.includes("D")) {
      if (isInternalPath(file)) continue; // bookkeeping do harness
      deleted.push(file);
    }
  }

  return {
    ok: true,
    diff: {
      files,
      deleted,
      addedTokens,
      deletedTokens,
      text: textParts.join("\n"),
      headLines,
      fileStats,
    },
  };
}

/** Raiz do repo git que contém cwd (null fora de repo). */
export function repoRootOf(cwd: string, env: NodeJS.ProcessEnv): string | null {
  const res = git(["rev-parse", "--show-toplevel"], cwd, env);
  if (!res.ok) return null;
  const root = res.out.trim();
  return root.length > 0 ? root : null;
}

/** Contexto do goal ativo no ledger do glla (F19/F24 — formato validado). */
export interface GllaGoalContext {
  /** objective do goal (spec da camada 4); null quando o goal não tem objective. */
  objective: string | null;
  /** títulos da taskList ativa (spec adicional — F1). */
  taskTitles: string[];
}

export type GllaGoalRead = { ok: true; goal: GllaGoalContext | null } | { ok: false; reason: "missing" | "unreadable" };

/**
 * Spec da sessão (F1): objective + títulos da taskList do goal ativo.
 * Mesma dobra tolerante do todo-writer.ts (F24): linhas malformadas são
 * puladas; goal sem taskList não cobra lista obsoleta de goal anterior.
 */
export function readGllaGoalContext(cwd: string): GllaGoalRead {
  const file = path.join(cwd, ".pi-glla", "active.jsonl");
  if (!fs.existsSync(file)) return { ok: false, reason: "missing" };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let active: GllaGoalContext | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt: { type?: unknown; value?: unknown };
    try {
      evt = JSON.parse(line) as { type?: unknown; value?: unknown };
    } catch {
      continue;
    }
    if (evt.type !== "state") continue;
    const value = evt.value;
    if (value === null || typeof value !== "object") continue;
    const v = value as { goal?: unknown };
    if (v.goal === null || v.goal === undefined) continue;
    if (typeof v.goal !== "object") continue;
    const goal = v.goal as { objective?: unknown; taskList?: unknown; status?: unknown };
    // O ULTIMO estado do goal decide (validado no Execute: o tool_call do
    // complete_goal roda com status "active"; arquivado/pausado NÃO é spec —
    // o CLI pós-conclusão não usa spec de goal arquivado). Um estado
    // não-ativo RESETA o contexto (sem acumular objetivo de goal antigo).
    if (goal.status !== "active") {
      active = null;
      continue;
    }
    const objective = typeof goal.objective === "string" && goal.objective.trim().length > 0 ? goal.objective : null;
    const taskTitles: string[] = [];
    const tl = goal.taskList;
    if (tl !== null && tl !== undefined && typeof tl === "object") {
      const tasks = (tl as { tasks?: unknown }).tasks;
      if (Array.isArray(tasks)) {
        for (const t of tasks) {
          collectTaskTitles(t, taskTitles);
        }
      }
    }
    active = { objective, taskTitles };
  }
  return { ok: true, goal: active };
}

function collectTaskTitles(raw: unknown, out: string[]): void {
  if (raw === null || typeof raw !== "object") return;
  const t = raw as { title?: unknown; subtasks?: unknown };
  if (typeof t.title === "string" && t.title.trim().length > 0) out.push(t.title);
  if (Array.isArray(t.subtasks)) {
    for (const s of t.subtasks) collectTaskTitles(s, out);
  }
}

/** Spec de texto da sessão (F1): objective + títulos; null quando nada disponível. */
export function sessionSpec(goal: GllaGoalContext | null): string | null {
  if (goal === null) return null;
  const parts: string[] = [];
  if (goal.objective !== null && goal.objective.trim().length > 0) parts.push(goal.objective);
  parts.push(...goal.taskTitles);
  const text = parts.join("\n").trim();
  return text.length > 0 ? text : null;
}

/** Scripts do package.json do repo (raiz git primeiro; cwd como fallback). */
export function detectRepoScripts(cwd: string, env: NodeJS.ProcessEnv): { scripts: Record<string, string>; root: string | null } {
  const root = repoRootOf(cwd, env);
  const candidates = root !== null ? [root, cwd] : [cwd];
  for (const dir of candidates) {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
      if (pkg.scripts !== null && pkg.scripts !== undefined && typeof pkg.scripts === "object") {
        const scripts: Record<string, string> = {};
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          if (typeof cmd === "string") scripts[name] = cmd;
        }
        return { scripts, root: dir };
      }
    } catch {
      // package.json ilegível — trata como sem scripts (camada 1 degrada).
    }
  }
  return { scripts: {}, root: root ?? cwd };
}

/** Estado do repo preparado para a engine (D1: input = repoState + diff). */
export function collectRepoState(cwd: string, env: NodeJS.ProcessEnv): RepoState {
  const diffRead = collectRepoDiff(cwd, env);
  const { scripts, root } = detectRepoScripts(cwd, env);
  return {
    cwd,
    diff: diffRead.ok ? diffRead.diff : null,
    scripts,
    gitRoot: root,
  };
}

/** Path relativo ao cwd (nunca absoluto — normalização F21 D10). */
export function relPathOf(cwd: string, target: string): string {
  const joined = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  const rel = path.relative(cwd, joined);
  if (rel === "") return ".";
  return rel.split(path.sep).join("/");
}
