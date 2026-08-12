// framework/copilot.test.ts — EVAL-049..056: Copilot/VSCode Adapter (F31) via
// framework F26.
//
// Tudo determinístico e offline/$0 (zero LLM/rede — fixture; PATH mínimo com
// fake `code`; workspace temp como cwd; GIT_CONFIG_* não usados — F21 D10):
//   EVAL-049 render/goldens — renderMcpConfig("copilot") == mcp-copilot.golden
//     byte-a-byte (F23; arquivo mcp.json COMPLETO — D5) · renderRules("copilot")
//     === NON_PI_RULES (reuso F19) · ausência goal|loop|subagent|pr-review|auditor;
//   EVAL-050 detect — fake `code` bin no PATH mínimo → instalado; fake dir de
//     extensão github.copilot-* (sem bin) → instalado; ausente → not installed
//     + reasons + hint (display-only);
//   EVAL-051 inject round-trip — workspace temp: seção em
//     .github/copilot-instructions.md + servers.taskflow em .vscode/mcp.json;
//     2 runs byte-idênticos; conteúdo do usuário fora do marcador preservado;
//     BOM/CRLF (F18);
//   EVAL-052 remove round-trip — fingerprint == registrado → remove (arquivo
//     vazio deletado); editado → preserved + edited; marcador não registrado
//     (outro id runecraft:) → preservado;
//   EVAL-053 fail-closed — install sem detecção → recusa + hint, zero writes;
//     copilot + --component Pi-only → firstUnsupported recusa; dry-run sem
//     efeitos colaterais;
//   EVAL-054 matrix/status — coluna copilot (taskflow/rules + 4 unsupported);
//     status 3 fontes (--json agents[].components[] com reason); doctor check
//     21 presente e honesto; consistência matriz↔suites (v9);
//   EVAL-055 two-driver — outro installer state (HOME fake) → owners warn + gate
//     MXST-04 (sem TTY sem --yes aborta); --yes prossegue com warnings; sync
//     three-way: seção editada → "preservada (editada)";
//   EVAL-056 sync/state — targets registrados com contentHash; sync
//     idempotente (already in sync, zero writes); uninstall content-based
//     (preserva edição do usuário); determinismo 2 runs.
//
// Delta vs EVAL-017..048 documentado em cada case (D6 — sem double-test): o
// mecanismo de sections/owners/sync three-way já é coberto pelos EVALs
// existentes (F18/F19); os cases novos provam a ADIÇÃO dos alvos copilot
// (repo-scoped .github/copilot-instructions.md + .vscode/mcp.json) e a
// coluna nova da matriz.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { evalTest } from "../helpers/evalTest.ts";
import { makeSandboxCleanPath, readJson, runHarness, stateFile, writeSettings, type Sandbox } from "../../helpers.ts";
import { GOLDEN_DIR, pinnedEnv, renderMcpGolden } from "../goldens.ts";
import { renderMcpConfig } from "../../../src/adapters/mcpConfig.ts";
import { renderRules } from "../../../src/adapters/rulesContent.ts";
import { copilotAdapter } from "../../../src/adapters/copilot.ts";
import { AGENTS, MATRIX, columnComponents, firstUnsupported } from "../../../src/matrix.ts";

const GOLDEN_PATH = path.join(GOLDEN_DIR, "mcp-copilot.golden");

/**
 * Sandbox com fake bin `code` no PATH mínimo + HOME fake (determinismo — a
 * detecção do copilot lê env.HOME; nada toca o ~ real). Workspace = projeto
 * temp sob o sandbox (QA-4: cwd = raiz dos alvos repo-scoped).
 */
function sandboxWithCode(extraBins: string[] = []): Sandbox & { binDir: string; project: string } {
  const sb = makeSandboxCleanPath() as Sandbox & { binDir: string; project: string };
  const binDir = path.join(sb.dir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const bin of ["code", ...extraBins]) {
    const file = path.join(binDir, bin);
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n");
    fs.chmodSync(file, 0o755);
  }
  sb.env.PATH = `${binDir}:${sb.env.PATH}`;
  sb.env.HOME = path.join(sb.dir, "home");
  sb.env.RUNECRAFT_TASKFLOW_CLAUDE_BIN = path.join(binDir, "mcp-fake.js");
  const project = path.join(sb.dir, "proj");
  fs.mkdirSync(project, { recursive: true });
  // settings.json do Pi presente (doctor checks 2/5; install de agente não-Pi
  // não cria — pré-criado vazio).
  writeSettings(sb, []);
  sb.binDir = binDir;
  sb.project = project;
  return sb;
}

function copilotRulesFile(sb: Sandbox & { project: string }): string {
  return path.join(sb.project, ".github", "copilot-instructions.md");
}

function copilotMcpFile(sb: Sandbox & { project: string }): string {
  return path.join(sb.project, ".vscode", "mcp.json");
}

/** Sem bin nem extensão: PATH limpo + HOME sem .vscode* (fail-closed). */
function sandboxWithoutCode(): Sandbox & { binDir: string; project: string } {
  const sb = sandboxWithCode();
  fs.rmSync(path.join(sb.binDir, "code"), { force: true });
  return sb;
}

// ---------------------------------------------------------------------------
// EVAL-049 — render/goldens (D5; reuso F19)
// ---------------------------------------------------------------------------

describe("EVAL-049 — render MCP + rules (golden byte-a-byte; NON_PI_RULES)", () => {
  test("renderMcpConfig('copilot') == mcp-copilot.golden (arquivo completo); rerun idêntico", async () => {
    await evalTest(
      "EVAL-049: golden — renderMcpConfig('copilot') byte-a-byte == mcp-copilot.golden (F23; arquivo mcp.json completo — D5); rerun idêntico",
      async () => {
        const env = pinnedEnv();
        const render = renderMcpGolden("copilot", env);
        const golden = fs.readFileSync(GOLDEN_PATH, "utf8");
        expect(render).toBe(golden);
        expect(render.length).toBe(golden.length);
        // Arquivo completo: raiz servers.taskflow (2 níveis — desvio D5).
        const parsed = JSON.parse(render) as { servers: { taskflow: { type: string } } };
        expect(Object.keys(parsed)).toEqual(["servers"]);
        expect(parsed.servers.taskflow.type).toBe("stdio");
        // Rerun byte-a-byte (F21 D10).
        expect(renderMcpGolden("copilot", env)).toBe(render);
        // O render é a MESMA fonte do que o adapter injeta (F23 D4).
        const ctx = { mcpBin: env.RUNECRAFT_TASKFLOW_CLAUDE_BIN ?? "", mcpBinCommand: [env.RUNECRAFT_TASKFLOW_CLAUDE_BIN ?? ""] };
        expect(renderMcpConfig("copilot", ctx)).toBe(render);
      },
      { evalId: "EVAL-049" },
    );
  });

  test("renderRules('copilot') === NON_PI_RULES (reuso F19 — zero texto novo); ausência de Pi-only", async () => {
    await evalTest(
      "EVAL-049: rules — renderRules('copilot') === NON_PI_RULES (mesmo texto dos demais não-Pi); ausência goal|loop|subagent|pr-review|auditor",
      async () => {
        expect(renderRules("copilot")).toBe(renderRules("claude-code"));
        expect(renderRules("copilot")).toBe(renderRules("codex"));
        expect(renderRules("copilot")).toContain("taskflow-MCP");
        expect(renderRules("copilot")).not.toMatch(/goal|loop|subagent|pr-review|auditor/i);
        // Golden do conteúdo de rules NÃO é duplicado (F19 dono — a cadeia
        // renderRules == golden vive no f19-routing.test.ts; aqui só a
        // igualdade entre agentes não-Pi, incluindo copilot).
      },
      { evalId: "EVAL-049" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-050 — detect (D6)
// ---------------------------------------------------------------------------

describe("EVAL-050 — detecção honesta (bin code/code-insiders OU extensão; fail-closed)", () => {
  test("fake 'code' bin no PATH mínimo → instalado (binPath); reasons vazio", async () => {
    await evalTest(
      "EVAL-050: detect — fake 'code' no PATH mínimo → installed com binPath; ausente → not installed + reasons + hint (display-only)",
      async () => {
        const sb = sandboxWithCode();
        try {
          const detect = await copilotAdapter.detect({ cwd: sb.project, env: sb.env });
          expect(detect.installed).toBe(true);
          expect(detect.binPath).toBe(path.join(sb.binDir, "code"));
          expect(detect.reasons).toEqual([]);
          // Determinismo: 2 runs idênticos.
          const again = await copilotAdapter.detect({ cwd: sb.project, env: sb.env });
          expect(again.installed).toBe(true);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-050" },
    );
  });

  test("extensão github.copilot-* em ~/.vscode/extensions (sem bin no PATH) → instalado", async () => {
    await evalTest("EVAL-050: detect — extensão github.copilot-* (sem bin) → installed via extension dir", async () => {
      const sb = sandboxWithoutCode();
      try {
        const ext = path.join(sb.env.HOME as string, ".vscode", "extensions", "github.copilot-1.244.0");
        fs.mkdirSync(ext, { recursive: true });
        const detect = await copilotAdapter.detect({ cwd: sb.project, env: sb.env });
        expect(detect.installed).toBe(true);
        expect(detect.binPath).toBeUndefined();
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-050" });
  });

  test("ausente → not installed + reasons com hint display-only (nunca executado)", async () => {
    await evalTest("EVAL-050: detect — ausente (sem bin nem extensão) → not installed + reasons + hint", async () => {
      const sb = sandboxWithoutCode();
      try {
        const detect = await copilotAdapter.detect({ cwd: sb.project, env: sb.env });
        expect(detect.installed).toBe(false);
        expect(detect.reasons.length).toBeGreaterThan(0);
        const text = detect.reasons.join(" ");
        expect(text).toContain("code");
        expect(text).toContain("display-only");
        expect(copilotAdapter.installHint).toContain("GitHub Copilot");
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-050" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-051 — inject round-trip (D2/D3)
// ---------------------------------------------------------------------------

describe("EVAL-051 — inject round-trip (repo-scoped; idempotente; usuário preservado; BOM/CRLF)", () => {
  test("install via CLI: seção + servers.taskflow; rerun byte-idêntico; conteúdo do usuário preservado", async () => {
    await evalTest(
      "EVAL-051: inject — CLI install --agent copilot → .github/copilot-instructions.md (seção runecraft:workflow) + .vscode/mcp.json (servers.taskflow); rerun byte-idêntico; usuário fora do marcador preservado",
      async () => {
        const sb = sandboxWithCode();
        try {
          // Conteúdo do usuário pré-existente (nunca clobber — D2/D10).
          fs.mkdirSync(path.join(sb.project, ".github"), { recursive: true });
          fs.writeFileSync(copilotRulesFile(sb), "# Minhas instruções do Copilot\n\n- regra minha\n", "utf8");
          const install = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(install.code).toBe(0);
          const rules = fs.readFileSync(copilotRulesFile(sb), "utf8");
          expect(rules.startsWith("# Minhas instruções do Copilot\n\n- regra minha\n")).toBe(true);
          expect(rules).toContain("<!-- runecraft:workflow -->");
          expect(rules).toContain(renderRules("copilot"));
          const mcp = JSON.parse(fs.readFileSync(copilotMcpFile(sb), "utf8")) as { servers: { taskflow: { type: string; command: string } } };
          expect(mcp.servers.taskflow.type).toBe("stdio");
          expect(mcp.servers.taskflow.command).toBe(path.join(sb.binDir, "mcp-fake.js"));

          // Rerun → byte-idêntico (idempotência F15; zero mudanças).
          const rulesBefore = fs.readFileSync(copilotRulesFile(sb), "utf8");
          const mcpBefore = fs.readFileSync(copilotMcpFile(sb), "utf8");
          const rerun = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(rerun.code).toBe(0);
          expect(fs.readFileSync(copilotRulesFile(sb), "utf8")).toBe(rulesBefore);
          expect(fs.readFileSync(copilotMcpFile(sb), "utf8")).toBe(mcpBefore);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-051" },
    );
  });

  test("BOM preservado + CRLF detectado no rules file (F18)", async () => {
    await evalTest("EVAL-051: inject — BOM preservado e CRLF detectado no .github/copilot-instructions.md", async () => {
      const sb = sandboxWithCode();
      try {
        fs.mkdirSync(path.join(sb.project, ".github"), { recursive: true });
        const file = copilotRulesFile(sb);
        fs.writeFileSync(file, "\ufeff# titulo\r\nlinha\r\n", "utf8");
        const install = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
        expect(install.code).toBe(0);
        const buf = fs.readFileSync(file);
        expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
        expect(buf.toString("utf8")).toContain("<!-- runecraft:workflow -->\r\n");
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-051" });
  });

  test("entry MCP estrangeira em .vscode/mcp.json → conflict, nunca sobrescrita", async () => {
    await evalTest("EVAL-051: inject — entry MCP estrangeira (servers.taskflow sem registro) → conflict reportado; nunca sobrescrita", async () => {
      const sb = sandboxWithCode();
      try {
        fs.mkdirSync(path.join(sb.project, ".vscode"), { recursive: true });
        fs.writeFileSync(
          copilotMcpFile(sb),
          JSON.stringify({ servers: { taskflow: { type: "stdio", command: "npx", args: ["-y", "-p", "claude-taskflow@0.2.6", "claude-taskflow-mcp"] } } }, null, 2),
        );
        const install = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("conflito");
        expect(fs.readFileSync(copilotMcpFile(sb), "utf8")).toContain("claude-taskflow@0.2.6"); // intacta
        // Entry estrangeira nunca é registrada como nossa → status mcp "colisão".
        const status = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
        const json = JSON.parse(status.stdout) as { agents: Array<{ agent: string; components: Array<{ component: string; state?: string }> }> };
        const copilot = json.agents.find((a) => a.agent === "copilot");
        expect(copilot?.components.find((c) => c.component === "taskflow")?.state).toBe("colisão");
      } finally {
        sb.cleanup();
      }
    }, { evalId: "EVAL-051" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-052 — remove round-trip (D9/D7)
// ---------------------------------------------------------------------------

describe("EVAL-052 — remove round-trip (content-based; edited/preserved; arquivo vazio deletado)", () => {
  test("uninstall: seção + entry removidas; arquivos vazios deletados; rerun sem nada", async () => {
    await evalTest(
      "EVAL-052: remove — uninstall --agent copilot → seção + entry removidas; arquivos vazios deletados (D6); rerun 'nada a remover'",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const uninstall = await runHarness(sb, ["uninstall", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(uninstall.code).toBe(0);
          expect(uninstall.stdout).toContain("removido");
          expect(fs.existsSync(copilotRulesFile(sb))).toBe(false);
          expect(fs.existsSync(copilotMcpFile(sb))).toBe(false);
          // Estado limpo: agente não registrado; 2º run → nothing to remove.
          const state = readJson(stateFile(sb));
          expect((state.agents as Record<string, unknown>).copilot).toBeUndefined();
          const rerun = await runHarness(sb, ["uninstall", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(rerun.code).toBe(0);
          expect(rerun.stdout).toContain("não está registrado");
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-052" },
    );
  });

  test("entry MCP editada (fingerprint ≠ registrado) → preservada + edited reportado", async () => {
    await evalTest(
      "EVAL-052: remove — entry MCP editada pelo usuário → preserved + edited (D7); arquivo intacto; seção rules ainda removida",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const mcpFile = copilotMcpFile(sb);
          const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8")) as { servers: { taskflow: { args?: string[] } } };
          mcp.servers.taskflow.args = ["/user/edited"];
          fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");
          const uninstall = await runHarness(sb, ["uninstall", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(uninstall.code).toBe(0);
          expect(uninstall.stdout).toContain("preservado (editado pelo usuário)");
          expect(uninstall.stdout).toContain("taskflow");
          expect(fs.existsSync(mcpFile)).toBe(true);
          expect(fs.readFileSync(mcpFile, "utf8")).toContain("/user/edited");
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-052" },
    );
  });

  test("conteúdo do usuário + marcador não registrado → preservados (F18)", async () => {
    await evalTest(
      "EVAL-052: remove — conteúdo do usuário fora do marcador preservado; seção de outro id (runecraft:) não registrada nunca removida",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const rulesFile = copilotRulesFile(sb);
          fs.appendFileSync(rulesFile, "# conteúdo do usuário\n", "utf8");
          // Um marcador runecraft: de OUTRO id (não registrado no state).
          const { upsertSectionFamily } = await import("../../../src/sections.ts");
          upsertSectionFamily(rulesFile, "runecraft:outro", "bloco alheio", "html");
          const uninstall = await runHarness(sb, ["uninstall", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(uninstall.code).toBe(0);
          const after = fs.readFileSync(rulesFile, "utf8");
          expect(after).toContain("# conteúdo do usuário");
          expect(after).not.toContain("runecraft:workflow");
          expect(after).toContain("runecraft:outro"); // preservado (F18 MXST-02)
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-052" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-053 — fail-closed (D6/D8/D9)
// ---------------------------------------------------------------------------

describe("EVAL-053 — fail-closed (sem detecção recusa + hint, zero writes; --component Pi-only; dry-run)", () => {
  test("install sem detecção → recusa + hint, zero writes nos alvos", async () => {
    await evalTest(
      "EVAL-053: fail-closed — install --agent copilot sem detecção → recusa com hint (display-only), zero writes nos alvos repo-scoped (rules/mcp)",
      async () => {
        const sb = sandboxWithoutCode();
        try {
          const result = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain("copilot");
          expect(result.stderr).toContain("display-only");
          // Fail-closed real (contrato F15): nenhum ALVO do copilot é escrito —
          // rules nem MCP (bookkeeping do harness no state.json pode ser criado
          // pelo fluxo F15 pré-existente; exit ≠ 0 é o contrato).
          expect(fs.existsSync(copilotRulesFile(sb))).toBe(false);
          expect(fs.existsSync(copilotMcpFile(sb))).toBe(false);
          expect(fs.existsSync(path.join(sb.project, ".github"))).toBe(false);
          expect(fs.existsSync(path.join(sb.project, ".vscode"))).toBe(false);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-053" },
    );
  });

  test("copilot + --component Pi-only → firstUnsupported recusa com o motivo da célula", async () => {
    await evalTest(
      "EVAL-053: fail-closed — copilot + --component subagents → recusa com o motivo da célula (firstUnsupported); nada escrito",
      async () => {
        const sb = sandboxWithCode();
        try {
          const result = await runHarness(sb, ["install", "--agent", "copilot", "--component", "subagents", "--yes"], { cwd: sb.project });
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain("subagents é extensão Pi; use --agent pi");
          expect(fs.existsSync(copilotRulesFile(sb))).toBe(false);
          expect(fs.existsSync(copilotMcpFile(sb))).toBe(false);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-053" },
    );
  });

  test("dry-run: plano sem efeitos colaterais (sem lock/state); unit firstUnsupported", async () => {
    await evalTest("EVAL-053: fail-closed — dry-run imprime o plano e não escreve nada; firstUnsupported unit", async () => {
      const sb = sandboxWithCode();
      try {
        const before = fs.existsSync(stateFile(sb));
        const result = await runHarness(sb, ["install", "--agent", "copilot", "--dry-run"], { cwd: sb.project });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Agentes não-Pi (F15): copilot");
        expect(result.stdout).toContain("dry-run: nada foi escrito");
        expect(fs.existsSync(stateFile(sb))).toBe(before);
        expect(fs.existsSync(copilotRulesFile(sb))).toBe(false);
        expect(fs.existsSync(copilotMcpFile(sb))).toBe(false);
      } finally {
        sb.cleanup();
      }
      // Unit: par agente×componente (D8). B1: a coluna copilot ganhou a célula
      // routing (unsupported — motivo do manifest).
      expect(firstUnsupported(["copilot"], ["subagents"])?.reason).toContain("é extensão Pi");
      expect(firstUnsupported(["copilot"], ["taskflow"])).toBeUndefined();
      expect(columnComponents("copilot")).toEqual(["taskflow", "rules", "routing", "subagents", "goal-loop-audit", "pr-review", "guards"]);
    }, { evalId: "EVAL-053" });
  });
});

// ---------------------------------------------------------------------------
// EVAL-054 — matrix/status (D8)
// ---------------------------------------------------------------------------

describe("EVAL-054 — coluna copilot na matriz + status 3 fontes + doctor check 21", () => {
  test("matriz: AGENTS.copilot + células mcp/rules + 4 unsupported com motivo", async () => {
    await evalTest(
      "EVAL-054: matrix — AGENTS.copilot (display/binary/note) + células taskflow(mcp)/rules + 4 unsupported com motivo; AGENTS/MATRIX declarativos",
      async () => {
        expect(AGENTS.copilot.display).toBe("Copilot (VS Code)");
        expect(AGENTS.copilot.binary).toBe("code");
        expect(AGENTS.copilot.note).toContain("repo-scoped");
        expect(MATRIX.copilot.taskflow?.kind).toBe("mcp");
        expect((MATRIX.copilot.taskflow as { entry: string }).entry).toBe("taskflow");
        expect(MATRIX.copilot.rules?.kind).toBe("rules");
        expect((MATRIX.copilot.rules as { file: string }).file).toBe(".github/copilot-instructions.md");
        for (const component of ["subagents", "goal-loop-audit", "pr-review", "guards"] as const) {
          const cell = MATRIX.copilot[component];
          expect(cell?.kind).toBe("unsupported");
          expect((cell as { reason: string }).reason).toContain("é extensão Pi; use --agent pi");
        }
        expect(MATRIX.copilot.guards?.kind).toBe("unsupported"); // F24: sem enforcement
        // Aditiva: as colunas existentes ficam intocadas.
        expect(MATRIX["claude-code"].rules?.kind).toBe("rules");
        expect(MATRIX.pi.subagents?.kind).toBe("pi-packages");
      },
      { evalId: "EVAL-054" },
    );
  });

  test("status --json: copilot gerenciado com cells ok; unsupported com reason; doctor check 21", async () => {
    await evalTest(
      "EVAL-054: status/doctor — 3 fontes (configs × state × matriz); cells taskflow/rules ok; 4 unsupported com reason no --json; doctor check 21 honesto",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const status = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
          expect(status.code).toBe(0);
          const json = JSON.parse(status.stdout) as {
            agents: Array<{
              agent: string;
              detected: boolean;
              managed: boolean;
              components: Array<{ component: string; supported: boolean; state?: string; reason?: string }>;
            }>;
          };
          const copilot = json.agents.find((a) => a.agent === "copilot");
          expect(copilot?.detected).toBe(true);
          expect(copilot?.managed).toBe(true);
          expect(copilot?.components.find((c) => c.component === "taskflow")?.state).toBe("ok");
          expect(copilot?.components.find((c) => c.component === "rules")?.state).toBe("ok");
          const subagents = copilot?.components.find((c) => c.component === "subagents");
          expect(subagents?.supported).toBe(false);
          expect(subagents?.reason).toContain("extensão Pi; use --agent pi");
          const guards = copilot?.components.find((c) => c.component === "guards");
          expect(guards?.supported).toBe(false);

          // Doctor check 21 (F31 — numeração pós-F30 check 20): detectado +
          // gerenciado, sem crash.
          const doctor = await runHarness(sb, ["doctor"], { cwd: sb.project });
          expect(doctor.code).toBe(0);
          expect(doctor.stdout).toContain("[21] Copilot (VS Code)");
          expect(doctor.stdout).toContain("detectado");
          // Ausente (sem bin nem extensão) → pass informativo, sem crash.
          const sb2 = sandboxWithoutCode();
          try {
            const doctor2 = await runHarness(sb2, ["doctor"], { cwd: sb2.project });
            expect(doctor2.code).toBe(0);
            expect(doctor2.stdout).toContain("[21] Copilot (VS Code)");
            expect(doctor2.stdout).toContain("não detectado");
          } finally {
            sb2.cleanup();
          }
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-054" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-055 — two-driver / outro installer (D10)
// ---------------------------------------------------------------------------

describe("EVAL-055 — two-driver outro installer (owners warn + gate MXST-04; sync three-way)", () => {
  test("outro installer state em HOME fake → owners warn; install sem TTY e sem --yes aborta apontando --yes", async () => {
    await evalTest(
      "EVAL-055: two-driver — upstream-installer state (~/.gentle-ai/state.json) → owners warn + gate MXST-04: sem TTY sem --yes aborta apontando --yes; zero writes",
      async () => {
        const sb = sandboxWithCode();
        try {
          const gaDir = path.join(sb.env.HOME as string, ".gentle-ai");
          fs.mkdirSync(gaDir, { recursive: true });
          fs.writeFileSync(path.join(gaDir, "state.json"), JSON.stringify({ version: 1 }));
          // Sem TTY e sem --yes → fail-closed (MXST-04).
          const result = await runHarness(sb, ["install", "--agent", "copilot"], { cwd: sb.project });
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain("upstream-installer");
          expect(result.stderr).toContain("--yes");
          expect(fs.existsSync(copilotRulesFile(sb))).toBe(false);
          expect(fs.existsSync(copilotMcpFile(sb))).toBe(false);
          // --yes prossegue, registra warnings no relatório.
          const yes = await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(yes.code).toBe(0);
          expect(yes.stdout).toContain("upstream-installer");
          expect(fs.existsSync(copilotRulesFile(sb))).toBe(true);
          // Status Owners reflete o outro installer (F18).
          const status = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
          const json = JSON.parse(status.stdout) as { warnings: Array<{ name: string; severity: string }> };
          expect(json.warnings.some((w) => w.name === "upstream-installer")).toBe(true);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-055" },
    );
  });

  test("marcadores de terceiros em .github/copilot-instructions.md → owners warn (F18)", async () => {
    await evalTest(
      "EVAL-055: two-driver — marcadores `<!-- gentle-ai:` no rules file do copilot → owners warn; install exige --yes",
      async () => {
        const sb = sandboxWithCode();
        try {
          fs.mkdirSync(path.join(sb.project, ".github"), { recursive: true });
          fs.writeFileSync(
            copilotRulesFile(sb),
            "<!-- gentle-ai:workflow -->\ngentle\n<!-- /gentle-ai:workflow -->\n",
            "utf8",
          );
          // Sem TTY e sem --yes → gate MXST-04 aborta (fail-closed).
          const result = await runHarness(sb, ["install", "--agent", "copilot"], { cwd: sb.project });
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain("upstream-installer");
          expect(result.stderr).toContain("--yes");
          // Status Owners: marcador detectado (F18 — estrito, por arquivo).
          const status = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
          const json = JSON.parse(status.stdout) as { warnings: Array<{ name: string; detail: string }> };
          expect(json.warnings.some((w) => w.name === "upstream-installer" && w.detail.includes("copilot-instructions.md"))).toBe(true);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-055" },
    );
  });

  test("sync three-way: seção editada pelo usuário → 'preservada (editada)', nunca sobrescreve", async () => {
    await evalTest(
      "EVAL-055: sync three-way — usuário edita a seção → 'preservada (editada)' (F19 D7 — nunca auto-cura); re-inject quando ausente",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const rulesFile = copilotRulesFile(sb);
          const { upsertSectionFamily } = await import("../../../src/sections.ts");
          upsertSectionFamily(rulesFile, "runecraft:workflow", renderRules("copilot") + "\n\n# nota do usuário", "html");
          const editedContent = fs.readFileSync(rulesFile, "utf8");
          const stateBefore = fs.readFileSync(stateFile(sb), "utf8");
          const sync = await runHarness(sb, ["sync"], { cwd: sb.project });
          expect(sync.code).toBe(0);
          expect(sync.stdout).toContain("preservada (editada");
          expect(sync.stdout).toContain("nunca sobrescreve");
          expect(fs.readFileSync(rulesFile, "utf8")).toBe(editedContent);
          expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore);
          // Re-inject quando a seção sumiu (usuário apagou) — conteúdo do
          // usuário preservado (F18).
          fs.writeFileSync(rulesFile, "# só conteúdo do usuário\n", "utf8");
          const sync2 = await runHarness(sb, ["sync"], { cwd: sb.project });
          expect(sync2.code).toBe(0);
          expect(sync2.stdout).toContain("re-injetado");
          const after = fs.readFileSync(rulesFile, "utf8");
          expect(after).toContain("runecraft:workflow");
          expect(after).toContain("# só conteúdo do usuário");
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-055" },
    );
  });
});

// ---------------------------------------------------------------------------
// EVAL-056 — sync/state (D9; F21 D10)
// ---------------------------------------------------------------------------

describe("EVAL-056 — sync/state (targets contentHash; sync idempotente; uninstall preservado; determinismo)", () => {
  test("install registra targets com contentHash; sync idempotente (already in sync, zero writes)", async () => {
    await evalTest(
      "EVAL-056: sync/state — targets rules+mcp registrados com contentHash (fingerprint do ARQUIVO); sync 2 runs → already in sync com zero writes",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          const state = readJson(stateFile(sb)) as { agents: Record<string, { targets: Array<{ kind: string; component: string; contentHash: string }> }> };
          const rec = state.agents.copilot;
          if (!rec) throw new Error("copilot sem registro no state");
          const rules = rec.targets.find((t) => t.kind === "rules");
          const mcp = rec.targets.find((t) => t.kind === "mcp");
          expect(rules?.component).toBe("rules");
          expect(rules?.contentHash).toMatch(/^[0-9a-f]{64}$/);
          expect(mcp?.component).toBe("taskflow");
          expect(mcp?.contentHash).toMatch(/^[0-9a-f]{64}$/);
          // Fingerprint do MCP == o que o adapter lê do ARQUIVO (lição F15).
          const adapterFp = copilotAdapter.readMcpFingerprint({ cwd: sb.project, env: sb.env });
          if (adapterFp === null) throw new Error("fingerprint MCP ausente");
          expect(mcp?.contentHash).toBe(adapterFp);

          // Sync 1 → already in sync (zero mudanças); sync 2 → idêntico (F21 D10).
          const stateBefore = fs.readFileSync(stateFile(sb), "utf8");
          const rulesBefore = fs.readFileSync(copilotRulesFile(sb), "utf8");
          const sync1 = await runHarness(sb, ["sync"], { cwd: sb.project });
          expect(sync1.code).toBe(0);
          expect(sync1.stdout).toContain("already in sync — zero mudanças");
          const sync2 = await runHarness(sb, ["sync"], { cwd: sb.project });
          expect(sync2.stdout).toBe(sync1.stdout);
          expect(fs.readFileSync(stateFile(sb), "utf8")).toBe(stateBefore);
          expect(fs.readFileSync(copilotRulesFile(sb), "utf8")).toBe(rulesBefore);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-056" },
    );
  });

  test("uninstall preserva edição do usuário no rules file; determinismo 2 runs", async () => {
    await evalTest(
      "EVAL-056: uninstall — conteúdo do usuário fora da seção preservado após uninstall (SETM-05/06); 2 runs do status idênticos",
      async () => {
        const sb = sandboxWithCode();
        try {
          await runHarness(sb, ["install", "--agent", "copilot", "--yes"], { cwd: sb.project });
          fs.appendFileSync(copilotRulesFile(sb), "# nota do usuário\n", "utf8");
          const uninstall = await runHarness(sb, ["uninstall", "--agent", "copilot", "--yes"], { cwd: sb.project });
          expect(uninstall.code).toBe(0);
          const after = fs.readFileSync(copilotRulesFile(sb), "utf8");
          expect(after).toContain("# nota do usuário");
          expect(after).not.toContain("runecraft:workflow");
          // Determinismo: 2 runs do status → mesma saída (sem timestamps).
          const s1 = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
          const s2 = await runHarness(sb, ["status", "--json"], { cwd: sb.project });
          expect(s2.stdout).toBe(s1.stdout);
        } finally {
          sb.cleanup();
        }
      },
      { evalId: "EVAL-056" },
    );
  });
});
