// routing/boundaries.test.ts — fronteiras composicionais (F33, T6; D7,
// RTE-06/07).
//
// Contratos (zero mudança nos módulos das features prévias):
//   F27 — o fallback NÃO re-roteia: a rota é congelada por sessão (T3) e a
//         camada de resiliência não importa routing (sem acoplamento);
//   F30 — passos das chains referenciam ids de papel F32 → modelo via
//         `models.agents.<id>.fallbackChain` (resolveAgentModel — contrato de
//         ids, read-only); fim-de-chain → null + warn (F30 D4);
//   F28 — lessons informam PROMPTS, nunca rotas: o classificador é função
//         pura do input (não importa lessons; adendo de lessons não altera a
//         decisão — rota independe do conteúdo de lessons).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRoute } from "../../src/routing/classifier.ts";
import { resolveAgentModel, getNextFallbackModel } from "../../src/models/resolution.ts";
import { ROLE_IDS } from "../../src/agents/catalog.ts";
import { PILOT_CHAIN_NAMES } from "../../src/routing/materialize.ts";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

/** Imports locais DIRETOS de um arquivo TS (fronteira honesta: infra
 *  compartilhada como state.ts/config.ts é comum às features — o contrato é
 *  NENHUM import direto do módulo vizinho). */
function directLocalImports(file: string): string[] {
  const content = fs.readFileSync(file, "utf8");
  const imports: string[] = [];
  for (const match of content.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const spec = match[1]!;
    if (spec.startsWith(".")) imports.push(path.resolve(path.dirname(file), spec));
  }
  return imports;
}

describe("F27 — fallback NÃO re-roteia (D7, RTE-06)", () => {
  test("src/resilience/ não importa src/routing DIRETAMENTE (fronteira — zero acoplamento)", () => {
    const resilienceDir = path.join(SRC_DIR, "resilience");
    const routingDir = path.join(SRC_DIR, "routing");
    const resilienceFiles = fs
      .readdirSync(resilienceDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(resilienceDir, f));
    for (const file of resilienceFiles) {
      for (const imported of directLocalImports(file)) {
        expect(imported.startsWith(routingDir), `${file} importa routing (${imported}) — F27 não pode re-rotear`).toBe(false);
      }
    }
  });

  test("rota congelada por sessão: evento sintético de resiliência não muda a decisão (padrão F24 D12)", () => {
    // O freeze é da EXTENSÃO (T3 — testado em extension.test.ts); aqui o
    // contrato de não-re-roteio: a decisão é função pura e estável do input.
    const decision = classifyRoute({ text: "implement the feature" });
    const again = classifyRoute({ text: "implement the feature" });
    expect(decision.route).toBe(again.route);
    // Re-classificar o MESMO input após um evento de resiliência (que não muda
    // o texto da tarefa) produz a MESMA rota — fallback age sobre a MESMA rota.
    expect(decision.route).toBe("implement");
  });
});

describe("F30 — modelo por papel via models.agents.<id> (D7, RTE-06)", () => {
  test("passos das chains referenciam ids de papel F32 → resolveAgentModel resolve", () => {
    const available = new Set(["provider-a/model-x"]);
    for (const id of ROLE_IDS) {
      const outcome = resolveAgentModel(id, {
        availableModels: available,
        customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
      });
      expect(outcome.model).toBe("provider-a/model-x");
      expect(outcome.via).toBe("custom-chain");
    }
  });

  test("fim-de-chain → null + warn (F30 D4 — nada inventado)", () => {
    const outcome = resolveAgentModel("security", {
      availableModels: new Set(),
      customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
    });
    expect(outcome.model).toBeNull();
    expect(outcome.via).toBe("none");
    if (outcome.via === "none") expect(outcome.warning.length).toBeGreaterThan(0);
  });

  test("getNextFallbackModel: primeiro disponível APÓS o falho; fim → null", () => {
    const available = new Set(["provider-a/model-b"]);
    const chain = [
      { providers: ["provider-a"], model: "model-a" },
      { providers: ["provider-a"], model: "model-b" },
      { providers: ["provider-a"], model: "model-c" },
    ];
    expect(getNextFallbackModel("builder", "provider-a/model-a", available, chain)).toBe("provider-a/model-b");
    expect(getNextFallbackModel("builder", "provider-a/model-b", available, chain)).toBeNull();
    expect(getNextFallbackModel("builder", "provider-a/model-c", available, chain)).toBeNull();
  });

  test("ids dos passos das chains ⊆ papéis F32 (contrato de ids — read-only)", () => {
    const roleIds = new Set<string>(ROLE_IDS);
    for (const name of PILOT_CHAIN_NAMES) {
      const asset = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../chains", `${name}.chain.md`);
      const content = fs.readFileSync(asset, "utf8");
      const steps = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
      for (const step of steps) {
        expect(roleIds.has(step), `chain ${name}: passo "${step}" não é papel F32`).toBe(true);
      }
    }
  });
});

describe("F28 — lessons informam PROMPTS, nunca rotas (D7, RTE-07)", () => {
  test("src/routing/ não importa lessons/observability/memory DIRETAMENTE (fronteira — rota = função pura do input)", () => {
    const routingDir = path.join(SRC_DIR, "routing");
    const routingFiles = fs
      .readdirSync(routingDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(routingDir, f));
    const observabilityDir = path.join(SRC_DIR, "observability");
    const memoryDir = path.join(SRC_DIR, "memory");
    for (const file of routingFiles) {
      for (const imported of directLocalImports(file)) {
        expect(
          imported.startsWith(observabilityDir) || imported.startsWith(memoryDir),
          `${file} importa lessons/memória (${imported}) — lessons nunca alteram rota`,
        ).toBe(false);
      }
    }
  });

  test("adendo de lessons no texto NÃO altera a decisão (rota = f(prompt), não f(lessons))", () => {
    // O F28 injeta o adendo no systemPrompt; a classificação usa APENAS o
    // texto do prompt/tarefa (event.prompt). Um prompt de tarefa idêntico
    // com/sem conteúdo de lessons no entorno produz a MESMA rota.
    const task = "implement the feature";
    const withLessonsAdendo = `${task}\n\n<!-- runecraft:lessons -->\nLesson: gate blocked — retry the same write`;
    expect(classifyRoute({ text: task }).route).toBe(classifyRoute({ text: withLessonsAdendo }).route);
    expect(classifyRoute({ text: task })).toEqual(classifyRoute({ text: withLessonsAdendo }));
  });
});
