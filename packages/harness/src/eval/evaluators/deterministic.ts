// eval/evaluators/deterministic.ts — evaluators determinísticos (F26, D4).
//
// Port AS-IS dos 8 kinds do arcanum (deterministic.ts) com as mensagens
// RPG-free (D8 — sem "wizard"/lore; mensagens normalizadas, sem path
// absoluto/timestamp — F21 D10). Semântica do arcanum preservada:
// distributeWeight (peso distribuído pelos itens; count 0 → peso total) e
// veredito por item. tool-policy adaptado (D4/Execute): o registry do
// harness = união dos tools dos requests REAIS do fixture; tool ausente =
// false (desabilitado) — mismatch documentado na mensagem.
import type {
  AssertionResult,
  ContainsAllEvaluator,
  ContainsAnyEvaluator,
  EvalArtifacts,
  EvaluatorSpec,
  ExcludesAllEvaluator,
  MinLengthEvaluator,
  OrderedContainsEvaluator,
  SectionContainsAllEvaluator,
  ToolPolicyEvaluator,
  XmlSectionsPresentEvaluator,
} from "../types.ts";

function getWeight(spec: EvaluatorSpec): number {
  return spec.weight ?? 1;
}

function getPrompt(artifacts: EvalArtifacts): string {
  return artifacts.renderedPrompt ?? "";
}

function distributeWeight(totalWeight: number, count: number): number {
  return count > 0 ? totalWeight / count : totalWeight;
}

function containsAll(prompt: string, spec: ContainsAllEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length);
  return spec.patterns.map((pattern) => {
    const passed = prompt.includes(pattern);
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed ? `Found required pattern: ${pattern}` : `Missing required pattern: ${pattern}`,
    };
  });
}

function containsAny(prompt: string, spec: ContainsAnyEvaluator): AssertionResult[] {
  const match = spec.patterns.find((pattern) => prompt.includes(pattern));
  const weight = getWeight(spec);
  return [
    {
      evaluatorKind: spec.kind,
      passed: match !== undefined,
      score: match ? weight : 0,
      maxScore: weight,
      message:
        match !== undefined
          ? `Found one allowed pattern: ${match}`
          : `Expected one of: ${spec.patterns.join(", ")}`,
    },
  ];
}

function excludesAll(prompt: string, spec: ExcludesAllEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length);
  return spec.patterns.map((pattern) => {
    const passed = !prompt.includes(pattern);
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed ? `Excluded forbidden pattern: ${pattern}` : `Forbidden pattern present: ${pattern}`,
    };
  });
}

function sectionContainsAll(prompt: string, spec: SectionContainsAllEvaluator): AssertionResult[] {
  const openTag = `<${spec.section}>`;
  const closeTag = `</${spec.section}>`;
  const start = prompt.indexOf(openTag);
  const end = prompt.indexOf(closeTag);
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length);

  if (start < 0 || end < 0 || end <= start) {
    return spec.patterns.map((pattern) => ({
      evaluatorKind: spec.kind,
      passed: false,
      score: 0,
      maxScore: perItem,
      message: `Missing section ${spec.section} for required pattern: ${pattern}`,
    }));
  }

  const sectionContent = prompt.slice(start, end + closeTag.length);
  return spec.patterns.map((pattern) => {
    const passed = sectionContent.includes(pattern);
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Found required pattern in section ${spec.section}: ${pattern}`
        : `Missing required pattern in section ${spec.section}: ${pattern}`,
    };
  });
}

function orderedContains(prompt: string, spec: OrderedContainsEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.patterns.length);
  let lastIndex = -1;
  return spec.patterns.map((pattern) => {
    const index = prompt.indexOf(pattern, lastIndex + 1);
    const passed = index >= 0;
    if (passed) lastIndex = index;
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Pattern appears in order: ${pattern}`
        : `Pattern missing or out of order: ${pattern}`,
    };
  });
}

function xmlSectionsPresent(prompt: string, spec: XmlSectionsPresentEvaluator): AssertionResult[] {
  const perItem = distributeWeight(getWeight(spec), spec.sections.length);
  return spec.sections.map((section) => {
    const hasOpen = prompt.includes(`<${section}>`);
    const hasClose = prompt.includes(`</${section}>`);
    const passed = hasOpen && hasClose;
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `XML section present: ${section}`
        : `Missing XML section tags for: ${section}`,
    };
  });
}

function toolPolicy(artifacts: EvalArtifacts, spec: ToolPolicyEvaluator): AssertionResult[] {
  const keys = Object.keys(spec.expectations);
  const perItem = distributeWeight(getWeight(spec), keys.length);
  const actualPolicy = artifacts.toolPolicy ?? {};

  return keys.map((tool) => {
    const expected = spec.expectations[tool];
    // Adaptação F26 (validada no Execute): tool ausente do registry real da
    // sessão = desabilitada (false). O registry é a união dos tools vistos
    // nos requests do fixture — ausência observada == não exposta.
    const actual = actualPolicy[tool] ?? false;
    const passed = actual === expected;
    return {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Tool policy matches for ${tool}: ${expected}`
        : `Tool policy mismatch for ${tool}: expected ${expected}, received ${String(actualPolicy[tool] === undefined ? "undefined" : actual)}`,
    };
  });
}

function minLength(prompt: string, spec: MinLengthEvaluator): AssertionResult[] {
  const weight = getWeight(spec);
  const passed = prompt.length >= spec.min;
  return [
    {
      evaluatorKind: spec.kind,
      passed,
      score: passed ? weight : 0,
      maxScore: weight,
      message: passed
        ? `Prompt length ${prompt.length} meets minimum ${spec.min}`
        : `Prompt length ${prompt.length} below minimum ${spec.min}`,
    },
  ];
}

/** Roda os evaluators determinísticos (8 kinds — port as-is, RPG-free). */
export function runDeterministicEvaluator(spec: EvaluatorSpec, artifacts: EvalArtifacts): AssertionResult[] {
  const prompt = getPrompt(artifacts);

  switch (spec.kind) {
    case "contains-all":
      return containsAll(prompt, spec);
    case "contains-any":
      return containsAny(prompt, spec);
    case "excludes-all":
      return excludesAll(prompt, spec);
    case "section-contains-all":
      return sectionContainsAll(prompt, spec);
    case "ordered-contains":
      return orderedContains(prompt, spec);
    case "xml-sections-present":
      return xmlSectionsPresent(prompt, spec);
    case "tool-policy":
      return toolPolicy(artifacts, spec);
    case "min-length":
      return minLength(prompt, spec);
    case "llm-judge":
      throw new Error("Evaluator llm-judge is handled by llm-judge evaluator path");
    case "trajectory-assertion":
      throw new Error("Evaluator trajectory-assertion is handled by trajectory-assertion evaluator path");
    case "baseline-diff":
      throw new Error("Evaluator baseline-diff is handled by baseline-diff evaluator path");
  }
}
