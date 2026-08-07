// merge.ts — settings merge engine (F14, SETM-01..06).
//
// Aplica defaults do harness por overlay sobre targets por componente
// (AD-012: config surface heterogênea — subagents/taskflow leem o settings.json
// do Pi com prefixos; pr-review usa arquivo próprio; goal-loop-audit tem arquivo
// próprio). Regras (design F14, G3 híbrido):
//   - merge profundo por chave dentro do bloco gerenciado (prefix); fora dele
//     nada é tocado (chaves desconhecidas intactas — edge SETM)
//   - chave existente do usuário SEMPRE vence; valor ≠ default → conflito
//     reportado (path + valor do usuário + valor do harness), nunca clobber
//   - chave ausente → default aplicado + registrado para settingsChanges
//     (SETM-03; o caller grava no state)
//   - idempotente: re-aplicar com os mesmos defaults → zero mudanças
//   - JSON inválido em QUALQUER alvo → abort apontando o arquivo, nada é
//     modificado (SETM-04; two-pass: todos os alvos validados antes de escrever)
//   - arrays são atômicos: chave existente substitui (usuário vence); ausente →
//     default (blocos de config não são concat-enáveis com segurança)
//   - mode remove (uninstall, SETM-05): entry registrada com valor atual ==
//     registrado → chave removida; valor ≠ (usuário editou) → preservada e
//     reportada
//
// Defaults v1 = valores reais do upstream dos forks (experimento F14 2026-08-05):
// ver COMPONENT_MERGE_TARGETS. O harness não inventa valores.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { gllaSettingsPath, piSettingsPath, prReviewConfigPath, type Runtime, type Scope } from "./config.ts";
import type { SettingsChange } from "./state.ts";

// ---------------------------------------------------------------------------
// Target model (AD-012): { file, scope, prefix }
// ---------------------------------------------------------------------------

/** Logical config file a component reads (resolved per scope). */
export type MergeFileKind = "settings" | "pr-review" | "glla";

export interface MergeEntry {
  /** JSON path into the file, relative to the target prefix (or top-level when no prefix). */
  path: string[];
  value: unknown;
}

export interface MergeTarget {
  /** logical component group, e.g. "taskflow" (matches plan COMPONENTS). */
  component: string;
  /** which config file the target lives in. */
  file: MergeFileKind;
  scope: Scope;
  /**
   * Managed block prefix (e.g. ["subagents"]). Absent → target manages only the
   * exact top-level default paths (G3 "top-level limitado" — model defaults).
   */
  prefix?: string[];
  /** defaults to apply when the key is absent (user wins otherwise). */
  defaults: MergeEntry[];
}

/** One reported change: path + value on each side. */
export interface MergeChange {
  /** absolute path of the config file. */
  file: string;
  /** full JSON path into the file. */
  path: string[];
  /** created → the applied default; conflict → the user's kept value. */
  value: unknown;
  /** conflict only: the harness default that was NOT applied. */
  harness?: unknown;
}

export interface MergeOutcome {
  /** defaults actually applied (→ settingsChanges). */
  created: MergeChange[];
  /** user values kept because they differ from the default (never clobbered). */
  conflicts: MergeChange[];
  /** absolute paths of files that were written (created or modified). */
  filesWritten: string[];
}

export interface RemoveOutcome {
  /** keys removed because the current value still matched the registered default. */
  removed: MergeChange[];
  /** keys preserved because the user edited them since install (SETM 2.2). */
  preserved: MergeChange[];
  filesWritten: string[];
}

/** Abort error for SETM-04: names the file, nothing was modified. */
export class MergeError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(message);
    this.name = "MergeError";
    this.file = file;
  }
}

// ---------------------------------------------------------------------------
// Path resolution per scope
// ---------------------------------------------------------------------------

/** Resolves a target's file path for the scope. */
export function mergeFilePath(rt: Runtime, scope: Scope, file: MergeFileKind): string {
  switch (file) {
    case "settings":
      return piSettingsPath(rt, scope);
    case "pr-review":
      return prReviewConfigPath(rt, scope);
    case "glla":
      return gllaSettingsPath(rt, scope);
  }
}

// ---------------------------------------------------------------------------
// Defaults v1 (experimento F14 — validados contra o source dos 4 forks)
// ---------------------------------------------------------------------------

/**
 * modelRoles recomendado pelo próprio taskflow (RECOMMENDED_DEFAULTS de `/tf
 * init` — source: packages/taskflow/pi/src/init.ts, INIT_ROLES @0.2.6). É a
 * "chave de conveniência (model por role)" que o fork suporta nativamente
 * (resolução `{{role}}`); top-level limitado (G3). Não inventado: copia o
 * default do upstream.
 */
export const TASKFLOW_MODEL_ROLES: Readonly<Record<string, string>> = {
  steward: "openrouter/anthropic/claude-fable-5",
  expert: "openrouter/anthropic/claude-opus-5",
  builder: "openrouter/anthropic/claude-sonnet-5",
  scout: "openrouter/anthropic/claude-haiku-4.5",
};

/**
 * Targets com defaults do preset full (v1). Resultado do experimento F14:
 *
 * | fork             | o que lê                                    | defaults finais v1 |
 * | ---              | ---                                         | --- |
 * | subagents        | settings.json → bloco `subagents.*`         | `subagents.modelScope.enforce=false` (default upstream: sem enforcement) |
 * | taskflow         | settings.json → bloco `taskflow.*` + top-level `modelRoles` | `taskflow.piChild.resourceProfile="isolated"` (DEFAULT_PI_CHILD_SETTINGS) + `modelRoles` = RECOMMENDED_DEFAULTS |
 * | pr-review        | arquivo próprio `pr-review.json`            | sem defaults v1 — o fork não hardcoda modelos ("No model names are hardcoded here — you configure them"); tier ausente = pi default model |
 * | goal-loop-audit  | arquivo próprio `pi-goal-list-loop-audit.settings.json` / `.pi-glla/settings.json` | sem defaults v1 — DEFAULT_SETTINGS do fork já se aplicam com arquivo ausente; escrever = no-op |
 *
 * Correções vs. design: watchdog NÃO ganha default (upstream default é
 * `enabled: false`; ligar seria inventar comportamento) e o resourceProfile é
 * `"isolated"` (não `"allowlist"` como o design propôs).
 */
const COMPONENT_MERGE_TARGETS: ReadonlyArray<Omit<MergeTarget, "scope">> = [
  {
    component: "subagents",
    file: "settings",
    prefix: ["subagents"],
    defaults: [
      // DEFAULT upstream (ausente = sem enforcement; parser aceita enforce:false
      // sem allow) — documenta a garantia "não forçar modelo" (design F14).
      { path: ["modelScope", "enforce"], value: false },
    ],
  },
  {
    component: "taskflow",
    file: "settings",
    prefix: ["taskflow"],
    defaults: [
      // DEFAULT_PI_CHILD_SETTINGS.resourceProfile (core/src/agents.ts @0.2.6).
      { path: ["piChild", "resourceProfile"], value: "isolated" },
    ],
  },
  {
    component: "taskflow",
    file: "settings",
    // Sem prefix: top-level limitado (G3) — só os paths listados são gerenciados.
    defaults: [{ path: ["modelRoles"], value: { ...TASKFLOW_MODEL_ROLES } }],
  },
  {
    component: "pr-review",
    file: "pr-review",
    // Arquivo inteiro é do fork; v1 não escreve nada (sem defaults sensatos).
    defaults: [],
  },
  {
    component: "goal-loop-audit",
    file: "glla",
    // Arquivo inteiro é do fork; defaults do fork já valem na ausência do arquivo.
    defaults: [],
  },
];

/** Targets do preset full para os componentes selecionados (instalados). */
export function targetsForComponents(components: readonly string[], scope: Scope): MergeTarget[] {
  const out: MergeTarget[] = [];
  for (const target of COMPONENT_MERGE_TARGETS) {
    if (components.includes(target.component)) out.push({ ...target, scope });
  }
  return out;
}

/** Full managed leaf paths of a target (for settingsChanges attribution). */
function managedPaths(target: MergeTarget): string[][] {
  const out: string[][] = [];
  for (const entry of target.defaults) {
    out.push(target.prefix ? [...target.prefix, ...entry.path] : [...entry.path]);
  }
  return out;
}

/**
 * Which component owns a settingsChange entry (for component-scoped uninstall).
 * Match por PREFIXO gerenciado (não só path exato): o deep merge registra
 * leaves abaixo do managed path (ex.: ["modelRoles","steward"] para managed
 * ["modelRoles"]) — match exato deixaria esses parciais órfãos até --all.
 * Null quando a entry não está sob nenhum path que esta versão gerencia.
 */
export function componentForSettingsChange(
  entry: Pick<SettingsChange, "file" | "path">,
  rt: Runtime,
  scope: Scope,
): string | null {
  for (const target of COMPONENT_MERGE_TARGETS) {
    if (mergeFilePath(rt, scope, target.file) !== entry.file) continue;
    for (const managed of managedPaths({ ...target, scope })) {
      if (managed.length <= entry.path.length && managed.every((seg, i) => seg === entry.path[i])) {
        return target.component;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality (JSON semantics). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function getPath(doc: Record<string, unknown>, p: string[]): unknown {
  let current: unknown = doc;
  for (const seg of p) {
    if (!isPlainObject(current)) return undefined;
    if (!(seg in current)) return undefined;
    current = current[seg];
  }
  return current;
}

/**
 * First path segment (from the root) that exists but is not a plain object.
 * Null when every intermediate segment is absent or a plain object — i.e.
 * when the path is safe to create. Used to never clobber a user scalar that
 * occupies an intermediate segment (SETM-01/02: chaves do usuário vencem;
 * "nunca clobber" vale também para o caminho até a chave, não só a leaf).
 */
function blockingSegment(
  doc: Record<string, unknown>,
  p: string[],
): { path: string[]; value: unknown } | null {
  let current: unknown = doc;
  const walked: string[] = [];
  for (let i = 0; i < p.length - 1; i += 1) {
    const seg = p[i];
    if (seg === undefined) return null;
    const holder = current as Record<string, unknown>;
    if (!(seg in holder)) return null; // segmento ausente → caminho criável
    const next = holder[seg];
    if (!isPlainObject(next)) return { path: [...walked, seg], value: next };
    walked.push(seg);
    current = next;
  }
  return null;
}

/**
 * Default do harness como subtree no prefixo bloqueado: aninha entry.value a
 * partir do segmento bloqueado (ex.: prefix ["subagents"], entry
 * ["modelScope","enforce"] = false, blocked ["subagents"] →
 * { modelScope: { enforce: false } }) — o lado "harness" do conflito.
 */
function defaultSubtreeAt(entry: MergeEntry, prefix: string[] | undefined, blockedPath: string[]): unknown {
  const consumed = prefix ? blockedPath.length - prefix.length : blockedPath.length;
  let value: unknown = entry.value;
  for (let i = entry.path.length - 1; i >= consumed; i -= 1) {
    const seg = entry.path[i];
    if (seg === undefined) break;
    value = { [seg]: value };
  }
  return value;
}

function setPath(doc: Record<string, unknown>, p: string[], value: unknown): void {
  let current: Record<string, unknown> = doc;
  for (let i = 0; i < p.length - 1; i += 1) {
    const seg = p[i];
    if (seg === undefined) throw new Error("merge: path segmento vazio");
    const next = current[seg];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      current[seg] = created;
      current = created;
    } else {
      current = next;
    }
  }
  const last = p[p.length - 1];
  if (last === undefined) throw new Error("merge: path vazio");
  current[last] = value;
}

/** Removes a leaf then prunes empty containers up the path (no `{}` residue). */
function deletePath(doc: Record<string, unknown>, p: string[]): void {
  const stack: Array<{ obj: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = doc;
  for (let i = 0; i < p.length - 1; i += 1) {
    const seg = p[i];
    if (seg === undefined) return;
    const next = current[seg];
    if (!isPlainObject(next)) return; // caminho intermediário não-objeto → nada a remover
    stack.push({ obj: current, key: seg });
    current = next;
  }
  const last = p[p.length - 1];
  if (last === undefined) return;
  if (!(last in current)) return; // chave ausente
  delete current[last];
  // prune empty containers from the leaf up to (not including) the root: a
  // top-level key whose container is now empty is deleted too (no `{}` residue)
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i];
    if (frame === undefined) break;
    if (isPlainObject(frame.obj[frame.key]) && Object.keys(frame.obj[frame.key] as Record<string, unknown>).length === 0) {
      delete frame.obj[frame.key];
    } else {
      break;
    }
  }
}

/** Atomic write: tmp + rename (STBK-03 pattern). Creates parent dirs. */
function atomicWriteJson(file: string, doc: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Parses the target file. Missing → {}. Invalid JSON / non-object → MergeError (SETM-04). */
function readTargetFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new MergeError(file, `não foi possível ler o arquivo: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MergeError(file, `JSON inválido em '${file}' — corrija ou restaure um backup (F13); nada foi modificado (${(error as Error).message})`);
  }
  if (!isPlainObject(parsed)) {
    throw new MergeError(file, `'${file}' deve conter um objeto JSON; nada foi modificado`);
  }
  return parsed;
}

/**
 * Deep merge of one default value against the current doc. `current === undefined`
 * → apply (created); both plain objects → recurse per key; otherwise → conflict
 * when values differ (user kept, never clobbered). Arrays are atomic (leaf).
 */
function deepMergeDefaults(
  current: unknown,
  defaults: unknown,
  fullPath: string[],
  file: string,
  outcome: MergeOutcome,
): void {
  if (current === undefined) {
    outcome.created.push({ file, path: fullPath, value: defaults });
    return;
  }
  if (isPlainObject(current) && isPlainObject(defaults)) {
    for (const [key, defaultValue] of Object.entries(defaults)) {
      deepMergeDefaults(current[key], defaultValue, [...fullPath, key], file, outcome);
    }
    return;
  }
  if (!deepEqual(current, defaults)) {
    outcome.conflicts.push({ file, path: fullPath, value: current, harness: defaults });
  }
}

/**
 * Applies the targets' defaults over the target files (SETM-01..04).
 * Two-pass: ALL target files are parsed/validated before ANY write — JSON
 * inválido em qualquer arquivo → MergeError e nada é modificado (SETM-04).
 * Idempotent: re-applying the same defaults produces zero changes.
 */
export function applyMerge(targets: MergeTarget[], rt: Runtime): MergeOutcome {
  const outcome: MergeOutcome = { created: [], conflicts: [], filesWritten: [] };

  // Group by resolved file so each file is parsed/written once.
  const byFile = new Map<string, MergeTarget[]>();
  for (const target of targets) {
    const file = mergeFilePath(rt, target.scope, target.file);
    const list = byFile.get(file) ?? [];
    list.push(target);
    byFile.set(file, list);
  }

  // Pass 1 (SETM-04): parse/validate TODOS os arquivos alvo, sem nenhum write.
  const docs = new Map<string, Record<string, unknown>>();
  for (const file of byFile.keys()) docs.set(file, readTargetFile(file));

  // Pass 2: computa as mudanças e só então escreve — só roda com todos válidos.
  for (const [file, fileTargets] of byFile) {
    const doc = docs.get(file) ?? {};
    const fileCreated: MergeChange[] = [];
    const fileConflicts: MergeChange[] = [];
    for (const target of fileTargets) {
      for (const entry of target.defaults) {
        const fullPath = target.prefix ? [...target.prefix, ...entry.path] : [...entry.path];
        const current = getPath(doc, fullPath);
        const local: MergeOutcome = { created: [], conflicts: [], filesWritten: [] };
        const blocked = blockingSegment(doc, fullPath);
        if (blocked !== null) {
          // SETM-01/02: segmento intermediário existe e não é objeto plano →
          // o default não pode descer; conflito reportado, valor do usuário
          // permanece (nunca clobber no caminho até a chave).
          local.conflicts.push({
            file,
            path: blocked.path,
            value: blocked.value,
            harness: defaultSubtreeAt(entry, target.prefix, blocked.path),
          });
        } else {
          deepMergeDefaults(current, entry.value, fullPath, file, local);
        }
        fileCreated.push(...local.created);
        fileConflicts.push(...local.conflicts);
      }
    }
    if (fileCreated.length > 0) {
      for (const change of fileCreated) setPath(doc, change.path, change.value);
      atomicWriteJson(file, doc);
      outcome.filesWritten.push(file);
    }
    outcome.created.push(...fileCreated);
    outcome.conflicts.push(...fileConflicts);
  }

  return outcome;
}

/**
 * Removes previously-registered settings changes (SETM-05): key whose current
 * value still matches the registered default → removed; value edited by the
 * user → preserved and reported. Missing keys are skipped silently (already
 * gone). Invalid JSON on a target file → the whole remove for that file is
 * skipped and reported as preserved entries (conservative: never destroy
 * config we cannot read safely).
 */
export function removeSettingsChanges(
  entries: SettingsChange[],
  rt: Runtime,
  scope: Scope,
): RemoveOutcome {
  const outcome: RemoveOutcome = { removed: [], preserved: [], filesWritten: [] };

  const byFile = new Map<string, SettingsChange[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }

  for (const [file, fileEntries] of byFile) {
    let doc: Record<string, unknown>;
    try {
      doc = readTargetFile(file);
    } catch (error) {
      // Conservador: não conseguimos ler com segurança → nada é removido.
      for (const entry of fileEntries) {
        outcome.preserved.push({ file, path: entry.path, value: entry.value });
      }
      continue;
    }
    const fileRemoved: MergeChange[] = [];
    const filePreserved: MergeChange[] = [];
    for (const entry of fileEntries) {
      const current = getPath(doc, entry.path);
      if (current === undefined) continue; // já não existe → nada a fazer
      if (deepEqual(current, entry.value)) {
        deletePath(doc, entry.path);
        fileRemoved.push({ file, path: entry.path, value: entry.value });
      } else {
        filePreserved.push({ file, path: entry.path, value: current, harness: entry.value });
      }
    }
    if (fileRemoved.length > 0) {
      atomicWriteJson(file, doc);
      outcome.filesWritten.push(file);
    }
    outcome.removed.push(...fileRemoved);
    outcome.preserved.push(...filePreserved);
  }

  return outcome;
}
