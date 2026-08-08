// eval/helpers/evalFixture.ts — montagem padrão da camada 2 (F3).
//
// Ordem (D5/D8): (1) ChatServer escuta em porta efêmera (port 0); (2) o
// models.json do agentDir é regravado com a porta REAL; (3) o SDK in-process
// é criado com esse modelsPath/authPath; (4) o fluxo roda (agente REAL executa
// cada tool call scriptada no repo descartável); (5) finally: server.close()
// + rm -rf do tmp.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChatServer } from "../layer2/fixture/chatServer.ts";
import type { ScriptedScenario } from "../layer2/fixture/scenarios.ts";
import { buildEvalEnv } from "./env.ts";
import { materializeAgentDir, type FixtureHomeOptions } from "./fixtureHome.ts";
import { initEvalRepo, type TestRepo } from "./gitRepo.ts";
import { installPiWrapper } from "./fixtureHome.ts";
import { createFixtureSession, type SdkSessionResult } from "./sdkSession.ts";

export interface EvalFixtureOptions {
  scenario: ScriptedScenario;
  /** true → cria repo git descartável no tmp (D3). */
  withRepo?: boolean;
  /** precisa do wrapper `pi` no PATH para children do pr-review (EVAL-004/005). */
  withPiWrapper?: boolean;
  /** allowlist de tools do SDK (default: todas as extensões — config 1). */
  tools?: string[];
  /** bindExtensions (default true — dispara session_start/glla tools). */
  bindExtensions?: boolean;
  /** hooks do fixtureHome (ex.: settings do glla). */
  homeOptions?: Omit<FixtureHomeOptions, "port">;
  /** roda APÓS repo/agentDir materializados e ANTES do createFixtureSession —
   *  usado pelos testes de guards para gravar o state.json do workspace
   *  (config de guards lida no session_start — F24 D12) e o settings do glla
   *  (autoAcceptDrafts) no repo antes da sessão abrir. Aditivo (default undefined). */
  beforeSession?: (ctx: { base: string; repoDir: string; agentDir: string; env: NodeJS.ProcessEnv }) => void;
}

export interface EvalFixture {
  base: string;
  repo: TestRepo | null;
  server: ChatServer;
  port: number;
  agentDir: string;
  modelsJsonPath: string;
  authJsonPath: string;
  env: NodeJS.ProcessEnv;
  session: SdkSessionResult;
  cleanup(): void;
}

/**
 * Sobe o fixture completo e devolve o handle. O caller é dono do ciclo de
 * vida: use `try/finally { fx.cleanup() }`.
 */
export async function setupEvalFixture(opts: EvalFixtureOptions): Promise<EvalFixture> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "runecraft-eval-"));
  let repo: TestRepo | null = null;
  try {
    const server = new ChatServer(opts.scenario);
    const port = await server.listen();

    const home = materializeAgentDir(base, {
      port,
      ...opts.homeOptions,
    });

    const env = buildEvalEnv(base, home.agentDir);
    if (opts.withRepo) {
      repo = initEvalRepo(base, env);
    }
    if (opts.withPiWrapper) {
      installPiWrapper(base, env);
    }

    const repoDir = repo?.dir ?? path.join(base, "repo-nogit");
    fs.mkdirSync(repoDir, { recursive: true });
    opts.beforeSession?.({ base, repoDir, agentDir: home.agentDir, env });

    const session = await createFixtureSession({
      cwd: repoDir,
      agentDir: home.agentDir,
      modelsPath: home.modelsJsonPath,
      authPath: home.authJsonPath,
      tools: opts.tools,
      bindExtensions: opts.bindExtensions,
    });

    return {
      base,
      repo,
      server,
      port,
      agentDir: home.agentDir,
      modelsJsonPath: home.modelsJsonPath,
      authJsonPath: home.authJsonPath,
      env,
      session,
      cleanup() {
        try {
          session.dispose();
        } catch {
          // dispose já corrido — ok
        }
        server.close();
        repo?.cleanup();
        fs.rmSync(base, { recursive: true, force: true });
      },
    };
  } catch (error) {
    repo?.cleanup();
    fs.rmSync(base, { recursive: true, force: true });
    throw error;
  }
}
