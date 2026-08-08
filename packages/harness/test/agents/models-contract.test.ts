// agents/models-contract.test.ts — F32 T7 (ROLE-08): interface de modelos F30.
//
// Contrato (QA-4a, AD-032): os 7 ids de papel são ids válidos de
// `models.agents.<id>.fallbackChain` (F30 D5/D11) — NENHUM chain default no
// código (F30 D4: AGENT_MODEL_REQUIREMENTS = {} — zero IDs inventados). A
// resolução F30 (resolveAgentModel) consome chains por papel via state, com
// precedência override → custom chain > builtin → systemDefault → null + warn.
// Este teste NÃO toca src/models/ (F30 é o dono — reuso read-only).
import { describe, expect, test } from "bun:test";
import { resolveAgentModel, getNextFallbackModel } from "../../src/models/resolution.ts";
import { validateModelsConfig, defaultModelsConfig } from "../../src/models/config.ts";
import { AGENT_MODEL_REQUIREMENTS } from "../../src/models/defaults.ts";
import { ROLE_IDS } from "../../src/agents/catalog.ts";

const AVAILABLE = new Set(["provider-a/model-x", "provider-a/model-y", "provider-b/model-z"]);

describe("interface de modelos F30 × papéis objetivos (D8 — QA-4a)", () => {
  test("os 7 ids de papel resolvem via custom chain do state (custom-chain)", () => {
    for (const id of ROLE_IDS) {
      const outcome = resolveAgentModel(id, {
        availableModels: AVAILABLE,
        customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
      });
      expect(outcome.model, `${id} deveria resolver via custom chain`).toBe("provider-a/model-x");
      expect(outcome.via).toBe("custom-chain");
    }
  });

  test("sem chain → systemDefault; fim-de-chain → null + warn (nada inventado)", () => {
    // chain sem match disponível → cai para o default do sistema.
    const defaultOutcome = resolveAgentModel("auditor", {
      availableModels: new Set(["provider-a/model-x"]),
      customFallbackChain: [{ providers: ["provider-b"], model: "model-z" }],
      systemDefaultModel: "provider-a/model-x",
    });
    expect(defaultOutcome.model).toBe("provider-a/model-x");
    expect(defaultOutcome.via).toBe("system-default");

    // nada disponível e sem default → null + warn (fail-visible, D4).
    const exhausted = resolveAgentModel("builder", {
      availableModels: new Set(),
      customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
    });
    expect(exhausted.model).toBeNull();
    expect(exhausted.via).toBe("none");
    if (exhausted.via === "none") expect(exhausted.warning.length).toBeGreaterThan(0);

    // getNextFallbackModel: fim da chain → null (semântica source).
    expect(
      getNextFallbackModel(
        "builder",
        "provider-a/model-x",
        new Set(),
        [{ providers: ["provider-a"], model: "model-x" }],
      ),
    ).toBeNull();
  });

  test("override vence tudo (mesmo com chain de papel)", () => {
    const outcome = resolveAgentModel("security", {
      availableModels: AVAILABLE,
      overrideModel: "provider-a/model-y",
      customFallbackChain: [{ providers: ["provider-a"], model: "model-x" }],
    });
    expect(outcome.model).toBe("provider-a/model-y");
    expect(outcome.via).toBe("override");
  });

  test("validateModelsConfig aceita ids de papel (state models.agents.<id> — D5)", () => {
    const cfg: Record<string, unknown> = {
      ...defaultModelsConfig(),
      agents: {
        ...Object.fromEntries(ROLE_IDS.map((id) => [id, { fallbackChain: [{ providers: ["provider-a"], model: "model-x" }] }])),
      },
    };
    const result = validateModelsConfig(cfg);
    expect(result.ok, result.errors?.join("; ")).toBe(true);
  });

  test("zero chains default no código (F30 D4 — AGENT_MODEL_REQUIREMENTS vazio)", () => {
    expect(Object.keys(AGENT_MODEL_REQUIREMENTS)).toEqual([]);
  });
});
