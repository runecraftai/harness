// eval/layer2/fixture/modelsTemplate.ts — gera o models.json temp (D8B).
//
// Provider "fixture" OpenAI-wire: baseUrl loopback com a PORTA REAL (port 0 —
// D5, nada de hardcode), api "openai-completions", apiKey literal "fixture"
// (resolução 4 do pi — nada validado), compat.supportsDeveloperRole: false
// (o servidor OpenAI-wire não entende o role `developer`).
export interface ModelsTemplateOptions {
  port: number;
  modelId?: string;
}

export function renderModelsJson(opts: ModelsTemplateOptions): string {
  const { port, modelId = "eval-model" } = opts;
  return JSON.stringify(
    {
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "fixture",
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [{ id: modelId, name: "Eval Model", reasoning: false }],
        },
      },
    },
    null,
    2,
  );
}
