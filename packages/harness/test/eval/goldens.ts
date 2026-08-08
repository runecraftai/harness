// eval/goldens.ts — renderers + registro dos 5 goldens v1 (F23 D4).
//
// Goldens = drift detector de assets injetados (templates/seções/configs).
// Cada renderer aqui é a MESMA fonte usada pela produção (renderRules do F19,
// markers do F18, renderMcpEntry/renderMcpConfig do F15) — mudança no render
// = diff revisável no teste. O golden de rules NÃO é duplicado: vive no
// f19-routing.test.ts (apêndice do ROUTING.md, D9). Prompts: o harness v1 não
// define prompt próprio (os forks têm os deles) — categoria vazia, nota no
// README do test/eval.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMcpConfig, resolveMcpBin } from "../../src/adapters/mcpConfig.ts";
import { renderRules } from "../../src/adapters/rulesContent.ts";
import { markersFor } from "../../src/sections.ts";
import type { AgentId } from "../../src/adapters/types.ts";

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.resolve(EVAL_DIR, "../golden");

export const SECTION_WORKFLOW_ID = "runecraft:workflow";

/** Bins MCP pinados pelos testes de golden (F23 D4 — env fixture; NUNCA
 *  executados, só renderizados; o literal é o mesmo em qualquer máquina). */
export const MCP_FIXTURE_BINS: Record<AgentId, string> = {
  "claude-code": "/test/fixtures/bin/claude-taskflow-mcp",
  opencode: "/test/fixtures/bin/opencode-taskflow-mcp",
  codex: "/test/fixtures/bin/codex-taskflow-mcp",
};

/** Ambiente com os bins MCP pinados (determinismo byte a byte do render). */
export function pinnedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RUNECRAFT_TASKFLOW_CLAUDE_BIN: MCP_FIXTURE_BINS["claude-code"],
    RUNECRAFT_TASKFLOW_OPENCODE_BIN: MCP_FIXTURE_BINS.opencode,
    RUNECRAFT_TASKFLOW_CODEX_BIN: MCP_FIXTURE_BINS.codex,
  };
}

/** Seção completa `<!-- runecraft:workflow --> … <!-- /runecraft:workflow -->`
 *  (markers html do F18 + renderRules do F19). Termina com newline. */
export function renderSectionWorkflow(agentKey: "pi" | "non-pi"): string {
  const markers = markersFor("html", SECTION_WORKFLOW_ID);
  const rules = agentKey === "pi" ? renderRules("pi") : renderRules("claude-code");
  return `${markers.open}\n${rules}\n${markers.close}\n`;
}

/** Entry MCP do host com bin pinado via env (F23 D4: resolveMcpBin > env). */
export function renderMcpGolden(host: AgentId, env: NodeJS.ProcessEnv): string {
  const rt = { cwd: process.cwd(), env };
  const hostKey = host === "claude-code" ? "claude" : host;
  const resolved = resolveMcpBin(hostKey, rt);
  return renderMcpConfig(host, {
    mcpBin: resolved.command[resolved.command.length - 1] ?? "",
    mcpBinCommand: resolved.command,
  });
}

export interface GoldenDef {
  name: string;
  render: () => string;
  /** limite de linhas (calibrado no Execute — F23 D4; regras ≤46/≤25 + 2
   *  linhas de markers; MCP pequeno por construção). */
  maxLines: number;
}

/** Os 5 goldens v1 — ordem estável para --update e relatórios. */
export function goldenDefs(): GoldenDef[] {
  const env = pinnedEnv();
  return [
    { name: "section-workflow-pi.golden", render: () => renderSectionWorkflow("pi"), maxLines: 48 },
    { name: "section-workflow-nonpi.golden", render: () => renderSectionWorkflow("non-pi"), maxLines: 27 },
    { name: "mcp-claude.golden", render: () => renderMcpGolden("claude-code", env), maxLines: 20 },
    { name: "mcp-opencode.golden", render: () => renderMcpGolden("opencode", env), maxLines: 20 },
    { name: "mcp-codex.golden", render: () => renderMcpGolden("codex", env), maxLines: 20 },
  ];
}

export function goldenPath(name: string): string {
  return path.join(GOLDEN_DIR, name);
}

/** Lê um golden de um diretório; ENOENT (golden ausente) propaga para o
 *  check tratar como drift total. */
export function readGolden(name: string, dir: string = GOLDEN_DIR): string {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

/** Conta linhas ignorando o newline final (convenção dos limites do F19 D5). */
export function countLines(content: string): number {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}
