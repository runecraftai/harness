// eval/helpers/fixtureHome.ts — materializa o agentDir temp do pi (D8).
//
// O agente real (SDK in-process) e os subprocessos spawnados pelos forks
// (subagents/pr-review children) leem a config do diretório apontado por
// PI_CODING_AGENT_DIR: models.json (provider "fixture" loopback, apiKey
// literal "fixture"), auth.json, e settings.json com as extensões dos
// forks (H1 — a manifest do pi resolve `settings.extensions` como paths).
//
// Validação no Execute (F21): settings.json `extensions` com paths ABSOLUTOS
// materializa as extensões dos forks (subagents/taskflow/glla/pr-review/
// harness-status) — verificado empiricamente (o glla registra as tools no
// session_start e o /goal start funciona com elas).
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { renderModelsJson } from "../layer2/fixture/modelsTemplate.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Extensões dos forks + do próprio harness, na ordem da manifest do package. */
export function harnessExtensionPaths(): string[] {
  return [
    path.join(PACKAGE_ROOT, "extensions", "harness-status.ts"),
    path.join(PACKAGE_ROOT, "node_modules", "@runecraft", "subagents", "index.ts"),
    path.join(PACKAGE_ROOT, "node_modules", "@runecraft", "taskflow", "dist", "index.js"),
    path.join(PACKAGE_ROOT, "node_modules", "@runecraft", "goal-loop-audit", "extensions", "loops", "goal.ts"),
    path.join(PACKAGE_ROOT, "node_modules", "@runecraft", "pr-review", "extensions", "index.ts"),
  ];
}

export interface FixtureHomeOptions {
  /** porta real do servidor fixture (port 0 — D5); regrava o models.json. */
  port?: number;
  /** extensões a registrar no settings.json (default: harnessExtensionPaths()). */
  extensions?: string[];
}

export interface FixtureHome {
  agentDir: string;
  modelsJsonPath: string;
  authJsonPath: string;
  settingsJsonPath: string;
}

/**
 * Materializa <base>/pi-agent com models.json + auth.json + settings.json.
 * O models.json NÃO é regravado quando `port` é undefined (o chamador pode
 * escrever o conteúdo completo via modelsJsonPath depois do listen).
 */
export function materializeAgentDir(base: string, opts: FixtureHomeOptions = {}): FixtureHome {
  const agentDir = path.join(base, "pi-agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const modelsJsonPath = path.join(agentDir, "models.json");
  const authJsonPath = path.join(agentDir, "auth.json");
  const settingsJsonPath = path.join(agentDir, "settings.json");

  const auth = { fixture: { type: "api_key" as const, key: "fixture" } };
  fs.writeFileSync(authJsonPath, JSON.stringify(auth, null, 2));

  const settings = {
    extensions: opts.extensions ?? harnessExtensionPaths(),
  };
  fs.writeFileSync(settingsJsonPath, JSON.stringify(settings, null, 2));

  if (opts.port !== undefined) {
    fs.writeFileSync(modelsJsonPath, renderModelsJson({ port: opts.port }));
  }

  return { agentDir, modelsJsonPath, authJsonPath, settingsJsonPath };
}

/**
 * Wrapper `pi` no PATH (D12/Execute): os children do pr-review fazem lookup
 * de `pi` no PATH (getPiInvocation — sob bun test cai em { command: "pi" }).
 * O wrapper executa `bun <sdk>/dist/cli.js "$@"` — herda PI_CODING_AGENT_DIR
 * e models.json do fixture (mesma porta do SDK in-process).
 */
export function installPiWrapper(base: string, env: NodeJS.ProcessEnv): string {
  const binDir = path.join(base, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const sdkCli = resolveSdkCli();
  const wrapper = path.join(binDir, "pi");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${sdkCli}" "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  env.PATH = `${binDir}:${env.PATH ?? ""}`;
  return wrapper;
}

/** Resolve o CLI do SDK instalado (dist/cli.js do @earendil-works/pi-coding-agent). */
export function resolveSdkCli(): string {
  const cli = path.join(PACKAGE_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  if (!fs.existsSync(cli)) {
    throw new Error(`SDK CLI não encontrado em ${cli} — o @earendil-works/pi-coding-agent precisa estar instalado (transitiva do harness).`);
  }
  return cli;
}
