// guards/setup.ts — preload da suite de guards (F24 T7, padrão F21 D3).
//
// O preload global (test/eval/setup.ts) já isola HOME/XDG/GIT_CONFIG_* antes
// do primeiro import; este preload reafirma as invariantes e isola o agentDir
// do Pi (PI_CODING_AGENT_DIR temp) para qualquer processo que leia a config
// do pi sem um agentDir explícito. A infra do F21 (buildEvalEnv) regrava
// PI_CODING_AGENT_DIR por teste nos subprocessos; o SDK in-process recebe o
// agentDir explicitamente (createFixtureSession) — o default aqui é só o piso
// hermético (nunca o agentDir real da máquina do runner).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "runecraft-guards-agent-"));
}
// Reafirma o isolamento do preload do F21 (defensivo — ordem dos preloads não importa).
if (!process.env.GIT_CONFIG_GLOBAL) process.env.GIT_CONFIG_GLOBAL = "/dev/null";
if (!process.env.GIT_CONFIG_SYSTEM) process.env.GIT_CONFIG_SYSTEM = "/dev/null";
