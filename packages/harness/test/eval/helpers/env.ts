// eval/helpers/env.ts — hermetic environment for the F21 suite (D3).
//
// Every eval test runs against temp dirs: HOME isolado (nada da máquina real
// é lido), PI_CODING_AGENT_DIR temp (config do pi), GIT_CONFIG_* anulados.
// Nenhum fetch/spawn sai de 127.0.0.1 por construção.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Cria um tmp dir único para o teste e devolve o caminho. */
export function tmpDir(prefix = "runecraft-eval-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** HOME hermético: um tmp dir que o teste usa como $HOME (D3). */
export function makeIsolatedHome(base: string): string {
  const home = path.join(base, "home");
  fs.mkdirSync(home, { recursive: true });
  return home;
}

/**
 * Constrói o env hermético de um teste (D3): HOME próprio, agentDir do pi,
 * GIT_CONFIG_GLOBAL/SYSTEM = /dev/null, XDG_CONFIG_HOME apontando para tmp.
 * NUNCA herda config real do runner.
 */
export function buildEvalEnv(base: string, piAgentDir: string): NodeJS.ProcessEnv {
  const home = makeIsolatedHome(base);
  const xdg = path.join(base, "xdg");
  fs.mkdirSync(xdg, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    PI_CODING_AGENT_DIR: piAgentDir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    // O glla (v0.28.18+) expõe override hermético para o settings global.
    GLLA_GLOBAL_SETTINGS_PATH: path.join(base, "glla-global.settings.json"),
    // Nunca deixar um pi real da máquina vazar para subprocessos dos forks.
    PI_SUBAGENT_PI_BINARY: "",
  };
}
