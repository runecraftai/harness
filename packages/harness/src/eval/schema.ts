// eval/schema.ts — validação runtime LEVE hand-rolled (F26, D1/D2).
//
// Zero deps novas (HARD): o zod NÃO existe no dep tree do harness
// (validado no Execute — package.json), então o port dos schemas do arcanum
// (schema.ts, zod) é hand-rolled: validators puros que devolvem issues
// `{path, message}` no formato do arcanum (`formatSchemaIssues` +
// `formatKindHint` — hint dos kinds permitidos). O guard PRIMÁRIO é o tipo
// TS dos dados (`satisfies EvalSuiteManifest` etc. nos módulos TS — QA-1);
// esta validação cobre o runtime (dynamic import) com erros tipados
// (EvalConfigError no loader).
import {
  EVAL_PHASES,
  EVAL_TARGET_KINDS,
  EXECUTOR_KINDS,
  EVALUATOR_KINDS,
  type EvalCase,
  type EvalSuiteManifest,
  type HarnessScenario,
} from "./types.ts";

export interface SchemaIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };

// --- validators primitivos (zero deps) ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issues(path: string, message: string): SchemaIssue[] {
  return [{ path, message }];
}

function expectString(value: unknown, path: string, label: string): SchemaIssue[] {
  return isNonEmptyString(value) ? [] : issues(path, `${label} esperado string não-vazia, encontrado ${typeof value}`);
}

function expectBoolean(value: unknown, path: string, label: string): SchemaIssue[] {
  return typeof value === "boolean" ? [] : issues(path, `${label} esperado boolean, encontrado ${typeof value}`);
}

function expectOptional(value: unknown, path: string, validate: (v: unknown, p: string) => SchemaIssue[]): SchemaIssue[] {
  return value === undefined ? [] : validate(value, path);
}

function expectStringArray(value: unknown, path: string, label: string, min = 0): SchemaIssue[] {
  if (!Array.isArray(value)) return issues(path, `${label} esperado array, encontrado ${typeof value}`);
  const out: SchemaIssue[] = [];
  if (value.length < min) out.push({ path, message: `${label} esperado mínimo ${min} item(ns)` });
  value.forEach((item, i) => {
    if (!isNonEmptyString(item)) out.push({ path: `${path}[${i}]`, message: `${label} esperado string não-vazia, encontrado ${typeof item}` });
  });
  return out;
}

function enumCheck(value: unknown, allowed: readonly string[], path: string, label: string): SchemaIssue[] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? []
    : issues(path, `${label} esperado um de [${allowed.join(", ")}], encontrado ${typeof value === "string" ? value : typeof value}`);
}

// --- evaluators ---

function validateWeighted(spec: Record<string, unknown>, path: string): SchemaIssue[] {
  return expectOptional(spec.weight, `${path}.weight`, (v, p) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return issues(p, `weight esperado number positivo, encontrado ${String(v)}`);
    return [];
  });
}

function validateEvaluatorKind(kind: unknown, path: string): SchemaIssue[] {
  return enumCheck(kind, EVALUATOR_KINDS, path, "evaluator.kind");
}

export function validateEvaluatorSpec(value: unknown, path = "evaluators"): SchemaIssue[] {
  if (!isPlainObject(value)) return issues(path, "evaluator esperado objeto");
  const spec = value;
  const out: SchemaIssue[] = [...validateEvaluatorKind(spec.kind, `${path}.kind`), ...validateWeighted(spec, path)];
  const kind = spec.kind;

  const patterns = (p: string): SchemaIssue[] => expectStringArray(spec.patterns, p, "patterns", 1);
  if (kind === "contains-all" || kind === "contains-any" || kind === "excludes-all" || kind === "ordered-contains") {
    return [...out, ...patterns(`${path}.patterns`)];
  }
  if (kind === "section-contains-all") {
    return [...out, ...expectString(spec.section, `${path}.section`, "section"), ...patterns(`${path}.patterns`)];
  }
  if (kind === "xml-sections-present") {
    return [...out, ...expectStringArray(spec.sections, `${path}.sections`, "sections", 1)];
  }
  if (kind === "tool-policy") {
    if (!isPlainObject(spec.expectations)) return [...out, ...issues(`${path}.expectations`, "expectations esperado Record<string, boolean>")];
    const bad = Object.entries(spec.expectations).filter(([, v]) => typeof v !== "boolean");
    return bad.length > 0 ? [...out, ...issues(`${path}.expectations`, `expectations esperado valores boolean, encontrado ${bad.map(([k]) => k).join(", ")}`)] : out;
  }
  if (kind === "min-length") {
    if (typeof spec.min !== "number" || !Number.isInteger(spec.min) || spec.min < 0) {
      return [...out, ...issues(`${path}.min`, "min esperado integer >= 0")];
    }
    return out;
  }
  if (kind === "llm-judge") {
    return [
      ...out,
      ...expectOptional(spec.expectedContains, `${path}.expectedContains`, (v, p) => expectStringArray(v, p, "expectedContains")),
      ...expectOptional(spec.expectedAnyOf, `${path}.expectedAnyOf`, (v, p) => expectStringArray(v, p, "expectedAnyOf", 1)),
      ...expectOptional(spec.forbiddenContains, `${path}.forbiddenContains`, (v, p) => expectStringArray(v, p, "forbiddenContains")),
      ...expectOptional(spec.rubricRef, `${path}.rubricRef`, (v, p) => expectString(v, p, "rubricRef")),
    ];
  }
  if (kind === "baseline-diff") {
    return [...out, ...expectOptional(spec.baselineRef, `${path}.baselineRef`, (v, p) => expectString(v, p, "baselineRef"))];
  }
  if (kind === "trajectory-assertion") {
    const optional = (key: string, label: string, min = 0): SchemaIssue[] =>
      expectOptional(spec[key], `${path}.${key}`, (v, p) => expectStringArray(v, p, label, min));
    return [
      ...out,
      ...optional("expectedSequence", "expectedSequence"),
      ...optional("expectedDelegationTargets", "expectedDelegationTargets"),
      ...optional("requiredAgents", "requiredAgents"),
      ...optional("requiredDelegationTargets", "requiredDelegationTargets"),
      ...optional("forbiddenAgents", "forbiddenAgents"),
      ...optional("forbiddenDelegationTargets", "forbiddenDelegationTargets"),
      ...expectOptional(spec.minTurns, `${path}.minTurns`, (v, p) =>
        typeof v === "number" && Number.isInteger(v) && v > 0 ? [] : issues(p, `minTurns esperado integer positivo, encontrado ${String(v)}`),
      ),
      ...expectOptional(spec.maxTurns, `${path}.maxTurns`, (v, p) =>
        typeof v === "number" && Number.isInteger(v) && v > 0 ? [] : issues(p, `maxTurns esperado integer positivo, encontrado ${String(v)}`),
      ),
    ];
  }
  return out;
}

// --- targets ---

function validateTarget(value: unknown, path = "target"): SchemaIssue[] {
  if (!isPlainObject(value)) return issues(path, "target esperado objeto");
  const target = value;
  const out = enumCheck(target.kind, EVAL_TARGET_KINDS, `${path}.kind`, "target.kind");
  if (target.kind === "prompt-render") {
    return [...out, ...expectOptional(target.agent, `${path}.agent`, (v, p) => expectString(v, p, "agent"))];
  }
  if (target.kind === "single-turn-agent") {
    const beforeSession = target.beforeSession;
    const beforeSessionOk = beforeSession === undefined || typeof beforeSession === "function";
    return [
      ...out,
      ...expectString(target.agent, `${path}.agent`, "agent"),
      ...expectOptional(target.input, `${path}.input`, (v, p) => expectString(v, p, "input")),
      ...expectOptional(target.tools, `${path}.tools`, (v, p) => expectStringArray(v, p, "tools")),
      ...expectOptional(target.bindExtensions, `${path}.bindExtensions`, (v, p) => expectBoolean(v, p, "bindExtensions")),
      ...(beforeSessionOk ? [] : issues(`${path}.beforeSession`, "beforeSession esperado function")),
    ];
  }
  return out;
}

// --- executors ---

function validateExecutor(value: unknown, path = "executor"): SchemaIssue[] {
  if (!isPlainObject(value)) return issues(path, "executor esperado objeto");
  const executor = value;
  const out = enumCheck(executor.kind, EXECUTOR_KINDS, `${path}.kind`, "executor.kind");
  if (executor.kind === "trajectory-run") {
    return [...out, ...expectString(executor.scenarioRef, `${path}.scenarioRef`, "scenarioRef")];
  }
  return out;
}

// --- case / suite / scenario ---

export function validateCase(value: unknown): ValidationResult<EvalCase> {
  if (!isPlainObject(value)) return { ok: false, issues: issues("<root>", "case esperado objeto") };
  const c = value;
  const out: SchemaIssue[] = [
    ...expectString(c.id, "id", "id"),
    ...expectString(c.title, "title", "title"),
    ...enumCheck(c.phase, EVAL_PHASES, "phase", "phase"),
    ...validateTarget(c.target),
    ...validateExecutor(c.executor),
  ];
  if (!Array.isArray(c.evaluators) || c.evaluators.length < 1) {
    out.push({ path: "evaluators", message: "evaluators esperado array com mínimo 1 item" });
  } else {
    c.evaluators.forEach((evaluator, i) => out.push(...validateEvaluatorSpec(evaluator, `evaluators[${i}]`)));
  }
  if (c.tags !== undefined) out.push(...expectStringArray(c.tags, "tags", "tags"));
  if (c.description !== undefined) out.push(...expectString(c.description, "description", "description"));
  if (c.notes !== undefined) out.push(...expectString(c.notes, "notes", "notes"));
  return out.length > 0 ? { ok: false, issues: out } : { ok: true, value: c as unknown as EvalCase };
}

export function validateSuiteManifest(value: unknown): ValidationResult<EvalSuiteManifest> {
  if (!isPlainObject(value)) return { ok: false, issues: issues("<root>", "suite manifest esperado objeto") };
  const s = value;
  const out: SchemaIssue[] = [
    ...expectString(s.id, "id", "id"),
    ...expectString(s.title, "title", "title"),
    ...enumCheck(s.phase, EVAL_PHASES, "phase", "phase"),
    ...expectStringArray(s.caseFiles, "caseFiles", "caseFiles", 1),
    ...expectOptional(s.tags, "tags", (v, p) => expectStringArray(v, p, "tags")),
  ];
  if (s.suiteMetadata !== undefined) {
    if (!isPlainObject(s.suiteMetadata)) {
      out.push({ path: "suiteMetadata", message: "suiteMetadata esperado objeto" });
    } else {
      out.push(...expectString(s.suiteMetadata.title, "suiteMetadata.title", "title"));
      if (s.suiteMetadata.routingKind !== undefined) {
        out.push(...enumCheck(s.suiteMetadata.routingKind, ["identity", "intent", "trajectory", "other"], "suiteMetadata.routingKind", "routingKind"));
      }
    }
  }
  return out.length > 0 ? { ok: false, issues: out } : { ok: true, value: s as unknown as EvalSuiteManifest };
}

/** Validação leve do cenário (HarnessScenario) — o script em si é tipado
 *  pelo TS (construído com o helper `script()` do fixture F21). */
export function validateScenario(value: unknown): ValidationResult<HarnessScenario> {
  if (!isPlainObject(value)) return { ok: false, issues: issues("<root>", "cenário esperado objeto") };
  const s = value;
  const out: SchemaIssue[] = [
    ...expectString(s.id, "id", "id"),
    ...expectString(s.title, "title", "title"),
    ...expectOptional(s.prompt, "prompt", (v, p) => expectString(v, p, "prompt")),
    ...expectOptional(s.withRepo, "withRepo", (v, p) => expectBoolean(v, p, "withRepo")),
    ...expectOptional(s.tools, "tools", (v, p) => expectStringArray(v, p, "tools")),
    ...expectOptional(s.bindExtensions, "bindExtensions", (v, p) => expectBoolean(v, p, "bindExtensions")),
    ...(s.beforeSession === undefined || typeof s.beforeSession === "function" ? [] : issues("beforeSession", "beforeSession esperado function")),
  ];
  if (!isPlainObject(s.scenario)) {
    out.push({ path: "scenario", message: "scenario esperado ScriptedScenario (fixture F21)" });
  } else {
    const sc = s.scenario;
    out.push(...expectString(sc.id, "scenario.id", "id"));
    if (!Array.isArray(sc.steps) || sc.steps.length < 1) {
      out.push({ path: "scenario.steps", message: "steps esperado array com mínimo 1 item" });
    }
    if (typeof sc.stepFor !== "function") out.push({ path: "scenario.stepFor", message: "stepFor esperado function" });
    if (typeof sc.summary !== "function") out.push({ path: "scenario.summary", message: "summary esperado function" });
  }
  return out.length > 0 ? { ok: false, issues: out } : { ok: true, value: s as unknown as HarnessScenario };
}

// --- formatação (formato arcanum) ---

/** Formata issues no formato do arcanum: `<file>:<path> <mensagem>`. */
export function formatSchemaIssues(filePath: string, issuesList: SchemaIssue[]): string {
  return issuesList
    .map((issue) => `${filePath}:${issue.path} ${issue.message}`)
    .join("\n");
}

/** Hint de kinds permitidos (formato arcanum — kind desconhecido). */
export function formatKindHint(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as Record<string, unknown>;
  const hints: string[] = [];

  if (record.target && typeof record.target === "object") {
    const target = record.target as Record<string, unknown>;
    if (typeof target.kind === "string" && !EVAL_TARGET_KINDS.includes(target.kind as never)) {
      hints.push(`Allowed target.kind values: ${EVAL_TARGET_KINDS.join(", ")}`);
    }
  }

  if (record.executor && typeof record.executor === "object") {
    const executor = record.executor as Record<string, unknown>;
    if (typeof executor.kind === "string" && !EXECUTOR_KINDS.includes(executor.kind as never)) {
      hints.push(`Allowed executor.kind values: ${EXECUTOR_KINDS.join(", ")}`);
    }
  }

  if (Array.isArray(record.evaluators)) {
    const invalid = record.evaluators
      .map((evaluator, index) => ({ evaluator, index }))
      .filter(({ evaluator }) => evaluator && typeof evaluator === "object")
      .filter(({ evaluator }) => {
        const kind = (evaluator as Record<string, unknown>).kind;
        return typeof kind === "string" && !EVALUATOR_KINDS.includes(kind as never);
      });
    if (invalid.length > 0) {
      hints.push(`Allowed evaluator.kind values: ${EVALUATOR_KINDS.join(", ")}`);
    }
  }

  return hints.length > 0 ? `\n${hints.join("\n")}` : "";
}

export const AllowedEvalTargetKinds = [...EVAL_TARGET_KINDS];
export const AllowedExecutorKinds = [...EXECUTOR_KINDS];
export const AllowedEvaluatorKinds = [...EVALUATOR_KINDS];
