// eval/helpers/sdkSession.ts — wiring validado do SDK 0.81.0 (F21 Execute #1).
//
// Fatos empíricos (experimentos F21):
// - `InMemoryCredentialStore` NÃO existe no 0.81.0. O caminho suportado é
//   `ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false })`
//   + `setRuntimeApiKey("fixture","fixture")` (a chave fica no override
//   in-memory do RuntimeCredentials — nada de disco, nada de rede).
// - `getModel("fixture","eval-model")` enxerga o models.json custom.
// - `createAgentSession` do SDK NÃO emite `session_start` sozinho (isso só
//   acontece em `bindExtensions`, chamado pelos modos reais do pi). O glla
//   registra as tools de goal (complete_goal etc.) NO session_start — sem
//   `await session.bindExtensions({})` as tools não aparecem no request.
import { createAgentSession, ModelRuntime, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model, Api } from "@earendil-works/pi-ai";

type AnyModel = Model<Api>;

export interface SdkSessionOptions {
  cwd: string;
  agentDir: string;
  modelsPath: string;
  authPath: string;
  tools?: string[];
  /** default true — dispara session_start (registro das tools do glla). */
  bindExtensions?: boolean;
}

export interface SdkSessionResult {
  session: AgentSession;
  model: AnyModel;
  runtime: ModelRuntime;
  dispose(): void;
}

export async function createFixtureSession(opts: SdkSessionOptions): Promise<SdkSessionResult> {
  const runtime = await ModelRuntime.create({
    authPath: opts.authPath,
    modelsPath: opts.modelsPath,
    allowModelNetwork: false,
  });
  await runtime.setRuntimeApiKey("fixture", "fixture");
  const model = runtime.getModel("fixture", "eval-model");
  if (!model) {
    throw new Error(`getModel("fixture","eval-model") retornou undefined — modelsPath=${opts.modelsPath}`);
  }
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    modelRuntime: runtime,
    model,
    sessionManager: SessionManager.inMemory(opts.cwd),
    tools: opts.tools,
  });
  if (opts.bindExtensions !== false) {
    await session.bindExtensions({});
  }
  return {
    session,
    model,
    runtime,
    dispose() {
      session.dispose();
    },
  };
}
