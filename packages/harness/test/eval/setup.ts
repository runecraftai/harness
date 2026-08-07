// eval/setup.ts — preload/hermeticidade + classificação fail-infra (D10).
//
// Preload do `bun test` (package.json: `bun test --preload ./test/eval/setup.ts`):
// roda ANTES de qualquer test file/import — HOME/XDG/GIT_CONFIG são isolados
// antes do primeiro os.homedir()/git (bun cacheia os.homedir() na primeira
// chamada; o DefaultResourceLoader do pi lê ~/.agents/skills e o glla lê o
// settings global real — sem isolamento nada da máquina do runner vaza).
//
// A classificação fail-infra (edge da spec) vive aqui: uma falha de teste é
// fail-infra quando o AMBIENTE está quebrado (git ausente, versão de bun,
// rede fora de 127.0.0.1) — não é regressão da suite e o ratchet do F23 a
// trata separadamente.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const EVAL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "runecraft-eval-home-"));

// Escopo de módulo: roda no preload, antes de qualquer import de teste.
process.env.HOME = EVAL_HOME;
process.env.XDG_CONFIG_HOME = path.join(EVAL_HOME, ".config");
process.env.GLLA_GLOBAL_SETTINGS_PATH = path.join(EVAL_HOME, "glla-global.settings.json");
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
// Nunca deixar um pi real da máquina vazar para os children dos forks.
process.env.PI_SUBAGENT_PI_BINARY = "";

const LOOPBACK = /127\.0\.0\.1|localhost|\[::1\]/;

function infraPatterns(error: unknown, message: string): string | null {
  if (error instanceof Error && (error as { code?: string }).code === "ENOENT" && /git/.test(message)) {
    return "git ausente no ambiente";
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|fetch failed/i.test(message)) {
    // Rede para fora de loopback = ambiente quebrado (a suite é offline por
    // construção; qualquer tentativa real de rede é bug de ambiente, não da suite).
    const nonLoopback = message.replace(LOOPBACK, "");
    if (/https?:|\.dev|\.com|\.io|registry|npmjs/.test(nonLoopback)) {
      return "rede fora de 127.0.0.1 (suite deve ser offline por construção)";
    }
  }
  if (/bun version|requires bun/i.test(message)) {
    return "versão do bun insuficiente";
  }
  return null;
}

/**
 * Classifica uma falha de teste: fail-infra (ambiente quebrado — não é
 * regressão da suite) vs fail (regressão real). Edge da spec: "fail-infra
 * classificado no setup.ts (env de bun/node, git config, rede)".
 */
export function classifyFailure(error: unknown, message: string): "fail" | "fail-infra" {
  return infraPatterns(error, message) ? "fail-infra" : "fail";
}

/** Versões do runner para a evidência (D10). */
export function runnerInfo(): { bun: string; node: string } {
  return {
    bun: typeof Bun !== "undefined" ? Bun.version : "unknown",
    node: process.versions.node,
  };
}
