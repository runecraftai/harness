// eval/loader.ts — carregamento de suites/cases/scenarios TS (F26, D2).
//
// QA-1 (AD-026): dados = módulos TS sob test/eval/{suites,cases,scenarios}.
// Mecanismo escolhido no Execute: DYNAMIC IMPORT (não registradoras) —
// (1) os módulos de dados são objetos puros (sem top-level await/side
// effects — o bun cacheia o módulo, reimport = mesma instância, inofensivo
// para dados); (2) zero boilerplate de registro (caso novo = arquivo de
// dados, runner/loader não mudam — D5); (3) mesmo mecanismo do fixture F21
// (scenarios.ts já é TS importado pelos testes). Sem parser JSONC (não há
// JSONC — os dados SÃO código).
//
// Erros tipados no formato do arcanum (loader.ts): EvalConfigError com
// arquivo + motivo + hint de kinds (schema.formatKindHint).
import { pathToFileURL } from "node:url";
import { formatKindHint, formatSchemaIssues, validateCase, validateScenario, validateSuiteManifest } from "./schema.ts";
import type { HarnessScenario, LoadedEvalCase, LoadedEvalSuiteManifest } from "./types.ts";

export class EvalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalConfigError";
  }
}

/** Resolve <dir>/suites/<id>.ts. */
export function resolveSuitePath(suitesDir: string, suite: string): string {
  if (suite.endsWith(".ts")) return `${suitesDir}/suites/${suite}`;
  return `${suitesDir}/suites/${suite}.ts`;
}

/** Resolve um ref de case relativo ao dir do suite (arcanum: resolvePath). */
export function resolveCasePath(suiteDir: string, casesDir: string, caseFile: string): string {
  if (caseFile.endsWith(".ts")) return caseFile.startsWith("..") ? `${suiteDir}/${caseFile}` : caseFile;
  return caseFile.startsWith("..") ? `${suiteDir}/${caseFile}.ts` : `${casesDir}/${caseFile}.ts`;
}

/** Resolve um scenarioRef: <scenariosDir>/<ref>.ts (aceita o sufixo .ts). */
export function resolveScenarioPath(scenariosDir: string, scenarioRef: string): string {
  if (scenarioRef.endsWith(".ts")) return `${scenariosDir}/${scenarioRef}`;
  return `${scenariosDir}/${scenarioRef}.ts`;
}

async function importModule(filePath: string): Promise<{ default?: unknown }> {
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(filePath).href)) as { default?: unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EvalConfigError(`Failed to load eval module ${filePath}: ${detail}`);
  }
  if (mod.default === undefined) {
    throw new EvalConfigError(`Eval module ${filePath} has no default export (convenção F26: dados TS exportam default)`);
  }
  return mod;
}

export async function loadSuite(suitesDir: string, suite: string): Promise<LoadedEvalSuiteManifest> {
  const filePath = resolveSuitePath(suitesDir, suite);
  const mod = await importModule(filePath);
  const result = validateSuiteManifest(mod.default);
  if (!result.ok) {
    throw new EvalConfigError(`${formatSchemaIssues(filePath, result.issues)}${formatKindHint(mod.default)}`);
  }
  return { ...result.value, filePath };
}

export async function loadCaseFile(_casesDir: string, filePath: string): Promise<LoadedEvalCase> {
  const mod = await importModule(filePath);
  const result = validateCase(mod.default);
  if (!result.ok) {
    throw new EvalConfigError(`${formatSchemaIssues(filePath, result.issues)}${formatKindHint(mod.default)}`);
  }
  return { ...result.value, filePath };
}

export async function loadCasesForSuite(
  suite: LoadedEvalSuiteManifest,
  casesDir: string,
): Promise<LoadedEvalCase[]> {
  const suiteDir = suite.filePath.slice(0, suite.filePath.lastIndexOf("/"));
  const cases: LoadedEvalCase[] = [];
  for (const caseFile of suite.caseFiles) {
    cases.push(await loadCaseFile(casesDir, resolveCasePath(suiteDir, casesDir, caseFile)));
  }
  return cases;
}

export async function loadScenario(scenariosDir: string, scenarioRef: string): Promise<HarnessScenario> {
  const filePath = resolveScenarioPath(scenariosDir, scenarioRef);
  const mod = await importModule(filePath);
  const result = validateScenario(mod.default);
  if (!result.ok) {
    throw new EvalConfigError(formatSchemaIssues(filePath, result.issues));
  }
  return result.value;
}
