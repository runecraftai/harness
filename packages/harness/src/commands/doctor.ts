// doctor.ts — read-only health checks (F12, LIFE-01/02).
//
// Six checks run in order; each reports pass/warn/fail (+ `skip` when a
// dependency failed):
//   1 Pi bin            `command -v pi` + `pi --version`
//   2 Pi config         settings.json exists + valid JSON (global; workspace when present)
//   3 Components        state entries present in `pi list`; version == vendor pin
//   4 Colisão           upstream packages (pi-subagents, ...) present → warn (F18 handles)
//   5 Settings dos forks subagents.*/taskflow.* blocks parseable; pr-review.json valid
//   6 Disco             free space in backups dirs > 50 MB
//
// Dependency (design F12): checks 3–6 depend on Pi; when check 1 fails they
// are reported as `skip` instead of failing in cascade with misleading errors.
// Check numbering is distributed — F18 adds checks 7–15, F19 check 16, F20
// check 17 (AD-013/AD-014); this file owns only 1–6.
//
// Read-only guarantee (LIFE-01): no check writes; the independent test
// verifies zero modifications by diff before/after.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  backupsDir,
  piAgentDir,
  piSettingsPath,
  statePath,
  type Runtime,
  type Scope,
  type TextSink,
} from "../config.ts";
import { npmIdentity, piInstallCommandHint, type PiInterop } from "../pi.ts";
import { BACKUP_MIN_FREE_BYTES, freeBytesOnDisk } from "../backup.ts";
import { loadStateReadonly } from "../state.ts";
import { HARNESS_VERSIONS } from "../versions.ts";
import { scanConflicts } from "../conflicts.ts";
import { ADAPTERS, DETECT_ONLY_GUIDES, SUPPORTED_AGENT_IDS } from "../adapters/registry.ts";
import { hasSection, isValidUtf8 } from "../adapters/rules.ts";
import { isUpstreamMcpEntry } from "../adapters/mcpConfig.ts";
import { MATRIX, type ComponentId } from "../matrix.ts";
import type { AgentId } from "../adapters/types.ts";

/** Free-space threshold for the disk check (design F12: 50 MB — same as the backup fail-safe). */
export const DISK_WARN_THRESHOLD_BYTES = BACKUP_MIN_FREE_BYTES;

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: number;
  name: string;
  status: DoctorStatus;
  detail: string;
  remedy?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { pass: number; warn: number; fail: number; skip: number };
  /** fail → 1; warn/pass → 0. */
  exitCode: number;
}

export interface DoctorCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  pi: PiInterop;
}

/** Parses the version pin off an npm spec: npm:@x/y@1.2.3 → "1.2.3" (null when absent). */
export function parsePinnedVersion(spec: string): string | null {
  const m = /^npm:(@?[^@]+)@([^@]+)$/.exec(spec);
  return m?.[2] ?? null;
}

/** Free bytes on the filesystem backing `dir` (null when statfs fails). */
export { freeBytesOnDisk };

interface ComponentProblem {
  package: string;
  group: string;
  issue: "ausente" | "versão divergente";
  stateVersion?: string;
  expected?: string;
}

function checkPiBin(pi: PiInterop): DoctorCheck {
  const detection = pi.detect();
  if (!detection.found) {
    return {
      id: 1,
      name: "Pi bin",
      status: "fail",
      detail: "binário `pi` não foi detectado no PATH",
      remedy: `instale o Pi: ${piInstallCommandHint()}`,
    };
  }
  const where = detection.bin ? ` (${detection.bin})` : "";
  const version = detection.version ? `, versão ${detection.version}` : "";
  return { id: 1, name: "Pi bin", status: "pass", detail: `pi detectado${where}${version}` };
}

function checkPiConfig(rt: Runtime): DoctorCheck {
  const files: Array<{ file: string; label: string; required: boolean }> = [
    { file: piSettingsPath(rt, "global"), label: "settings.json (global)", required: true },
    { file: piSettingsPath(rt, "workspace"), label: "settings.json (workspace)", required: false },
  ];
  for (const { file, label, required } of files) {
    if (!fs.existsSync(file)) {
      if (required) {
        return {
          id: 2,
          name: "Pi config",
          status: "fail",
          detail: `arquivo ausente: ${file}`,
          remedy: "o `pi install` cria o arquivo de settings — rode `npx @runecraft/harness install`",
        };
      }
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      return {
        id: 2,
        name: "Pi config",
        status: "fail",
        detail: `${label} com JSON inválido (${file}): ${(error as Error).message}`,
        remedy: `corrija o JSON do arquivo apontado (ou restaure de um backup do harness)`,
      };
    }
  }
  return { id: 2, name: "Pi config", status: "pass", detail: "settings.json presentes e com JSON válido" };
}

function checkComponents(rt: Runtime, pi: PiInterop): DoctorCheck {
  const problems: ComponentProblem[] = [];
  const checked = new Set<string>();
  const list = pi.list();
  // Edge F12: `pi list` falhou/crashou → fail com o erro bruto + hint (sem crash do CLI).
  if (list.error) {
    return {
      id: 3,
      name: "Components",
      status: "fail",
      detail: `pi list falhou: ${list.error}`,
      remedy: "verifique a instalação do Pi (`pi --version`) e o settings.json de ambos os scopes",
    };
  }
  const identities = new Set(list.packages.map(npmIdentity));

  const corrupt: string[] = [];
  for (const scope of ["global", "workspace"] as const) {
    const file = statePath(rt, scope);
    if (!fs.existsSync(file)) continue;
    const loaded = loadStateReadonly(file, scope);
    if (!loaded.ok) {
      // LIFE-01: read-only — o arquivo corrompido NÃO é movido/alterado aqui.
      corrupt.push(loaded.file);
      continue;
    }
    for (const [name, entry] of Object.entries(loaded.state.components)) {
      if (checked.has(name)) continue;
      checked.add(name);
      const expected = HARNESS_VERSIONS[name];
      if (!expected) {
        problems.push({ package: name, group: entry.group, issue: "versão divergente", stateVersion: entry.version, expected: "?" });
        continue;
      }
      if (!identities.has(entry.source)) {
        problems.push({ package: name, group: entry.group, issue: "ausente" });
      } else if (entry.version !== expected) {
        problems.push({ package: name, group: entry.group, issue: "versão divergente", stateVersion: entry.version, expected });
      }
    }
  }

  if (corrupt.length > 0) {
    return {
      id: 3,
      name: "Components",
      status: "fail",
      detail: `state.json corrompido em ${corrupt.join(", ")} — arquivo preservado (doctor é read-only)`,
      remedy: "rode `harness restore` ou remova o arquivo manualmente",
    };
  }
  if (checked.size === 0) {
    return {
      id: 3,
      name: "Components",
      status: "warn",
      detail: "nada registrado no state do harness (nenhum package gerenciado)",
      remedy: "`npx @runecraft/harness install`",
    };
  }
  if (problems.length === 0) {
    return { id: 3, name: "Components", status: "pass", detail: `${checked.size} packages gerenciados presentes em \`pi list\` com a versão esperada` };
  }
  const detail = problems
    .map((p) =>
      p.issue === "ausente"
        ? `${p.package} (grupo ${p.group}) ausente do \`pi list\``
        : `${p.package} (grupo ${p.group}) versão divergente: state ${p.stateVersion ?? "?"} ≠ esperado ${p.expected ?? "?"}`,
    )
    .join("; ");
  return {
    id: 3,
    name: "Components",
    status: "fail",
    detail,
    remedy: "`harness sync` (reconciliação) ou `harness install --component <grupo>` para reinstalar",
  };
}

function checkCollision(pi: PiInterop): DoctorCheck {
  const conflicts = scanConflicts(pi.list().packages);
  if (conflicts.length === 0) {
    return { id: 4, name: "Colisão", status: "pass", detail: "nenhum upstream em conflito instalado" };
  }
  const detail = conflicts
    .map((c) => `${c.package} (sugestão: ${c.suggestion})`)
    .join("; ");
  return {
    id: 4,
    name: "Colisão",
    status: "warn",
    detail,
    remedy: "upstreams em conflito com os forks runecraft — o harness nunca remove sozinho (tratamento completo no F18); remova com `pi remove <spec>`",
  };
}

function checkForkSettings(rt: Runtime): DoctorCheck {
  const problems: string[] = [];
  const settingsFiles: Array<{ file: string; label: string }> = [
    { file: piSettingsPath(rt, "global"), label: "settings.json (global)" },
  ];
  const workspaceSettings = piSettingsPath(rt, "workspace");
  if (fs.existsSync(workspaceSettings)) settingsFiles.push({ file: workspaceSettings, label: "settings.json (workspace)" });

  for (const { file, label } of settingsFiles) {
    let settings: unknown;
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${label} com JSON inválido (${file}): ${(error as Error).message}`);
      continue;
    }
    for (const block of ["subagents", "taskflow"] as const) {
      const value = (settings as Record<string, unknown>)[block];
      if (value === undefined) continue; // fork sem bloco configurado — ok (defaults são do F14)
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${label}: bloco \`${block}.*\` esperado como objeto, encontrado ${Array.isArray(value) ? "array" : typeof value}`);
      }
    }
  }

  // pr-review.json próprio (global ~/.pi/agent, workspace <repo>/.pi) — validar se existir.
  for (const file of [path.join(piAgentDir(rt.env), "pr-review.json"), path.join(rt.cwd, ".pi", "pr-review.json")]) {
    if (!fs.existsSync(file)) continue;
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`pr-review.json com JSON inválido (${file}): ${(error as Error).message}`);
    }
  }

  if (problems.length === 0) {
    return {
      id: 5,
      name: "Settings dos forks",
      status: "pass",
      detail: "blocos subagents.*/taskflow.* e pr-review.json parseáveis (quando presentes)",
    };
  }
  return {
    id: 5,
    name: "Settings dos forks",
    status: "fail",
    detail: problems.join("; "),
    remedy: "corrija o bloco/arquivo apontado (ou restaure de um backup do harness)",
  };
}

function checkDisk(rt: Runtime): DoctorCheck {
  const low: string[] = [];
  for (const scope of ["global", "workspace"] as const) {
    const dir = backupsDir(rt, scope);
    const free = freeBytesOnDisk(dir);
    if (free === null) continue;
    if (free < DISK_WARN_THRESHOLD_BYTES) {
      low.push(`${dir}: ${Math.floor(free / (1024 * 1024))} MB livres (threshold 50 MB)`);
    }
  }
  if (low.length === 0) {
    return { id: 6, name: "Disco", status: "pass", detail: "espaço livre nos dirs de backup acima do threshold (50 MB)" };
  }
  return {
    id: 6,
    name: "Disco",
    status: "warn",
    detail: low.join("; "),
    remedy: "liberar espaço no disco (snapshots do harness ficam em <runecraft>/backups)",
  };
}

export function runDoctorChecks(rt: Runtime, pi: PiInterop): DoctorReport {
  const checks: DoctorCheck[] = [checkPiBin(pi)];
  const piOk = checks[0]?.status === "pass";
  checks.push(checkPiConfig(rt));
  if (!piOk) {
    const skips: Array<[number, string]> = [
      [3, "Components"],
      [4, "Colisão"],
      [5, "Settings dos forks"],
      [6, "Disco"],
    ];
    for (const [id, name] of skips) {
      checks.push({ id, name, status: "skip", detail: "pulado — depende do Pi (check 1 falhou)" });
    }
  } else {
    checks.push(checkComponents(rt, pi), checkCollision(pi), checkForkSettings(rt), checkDisk(rt));
  }
  // F17 D3: checks 7–13 por agente (numeração provisória — a tabela
  // consolidada 7–15 é formalizada no F18, AD-013 B2).
  checks.push(
    checkAgentDetection(rt),
    checkAgentManaged(rt),
    checkAgentConfigs(rt),
    checkAgentMcpCollision(rt),
    checkAgentConfigParse(rt),
    checkAgentDetectOnly(rt),
    checkAgentMatrixOrphans(rt),
  );

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  return { checks, summary, exitCode: summary.fail > 0 ? 1 : 0 };
}

function renderDoctor(report: DoctorReport, opts: { tty: boolean }): string {
  const statusLabel: Record<DoctorStatus, string> = {
    pass: "pass",
    warn: "warn",
    fail: "FAIL",
    skip: "skip",
  };
  const color: Record<DoctorStatus, string> = {
    pass: "\u001b[32m",
    warn: "\u001b[33m",
    fail: "\u001b[31m",
    skip: "\u001b[2m",
  };
  const RESET = "\u001b[0m";
  const c = (s: string, status: DoctorStatus) => (opts.tty ? `${color[status]}${s}${RESET}` : s);
  const lines = ["@runecraft/harness doctor — diagnóstico (read-only, nada foi modificado)"];
  for (const check of report.checks) {
    lines.push(`[${check.id}] ${check.name} ..... ${c(statusLabel[check.status].padEnd(6), check.status)} ${check.detail}`);
    if (check.remedy) lines.push(`     remedy: ${check.remedy}`);
  }
  const s = report.summary;
  lines.push(`Resumo: pass ${s.pass} · warn ${s.warn} · fail ${s.fail} · skip ${s.skip}`);
  if (s.fail > 0) lines.push("Exit ≠ 0 — corrija os checks falhos e rode `harness doctor` de novo.");
  return `${lines.join("\n")}\n`;
}

export function renderDoctorJson(report: DoctorReport): string {
  return `${JSON.stringify({ checks: report.checks, summary: report.summary, exitCode: report.exitCode }, null, 2)}\n`;
}

export async function runDoctorCommand(opts: DoctorCommandOptions): Promise<number> {
  const report = runDoctorChecks(opts.rt, opts.pi);
  if (opts.json) {
    opts.out.write(renderDoctorJson(report));
  } else {
    opts.out.write(renderDoctor(report, { tty: false }));
  }
  return report.exitCode;
}

/**
 * F17 D3 check 7 — detecção por agente (informativo, nunca falha).
 * Binary on PATH = installed; the config dir is informative only (F15 ADPT-02).
 */
function checkAgentDetection(rt: Runtime): DoctorCheck {
  const detected = detectedAgentIds(rt);
  if (detected.length === 0) {
    return { id: 7, name: "Agentes (detecção)", status: "pass", detail: "nenhum agente não-Pi detectado no PATH" };
  }
  const detail = detected.map((id) => `${id} (bin '${ADAPTERS[id].bin}')`).join("; ");
  return { id: 7, name: "Agentes (detecção)", status: "pass", detail: `detectado: ${detail}` };
}

/**
 * F17 D3 check 8 — gerenciado? Binário presente sem state → warn "não
 * gerenciado" (nunca "quebrado"), remedy install --agent. Sem detecção → skip.
 */
function checkAgentManaged(rt: Runtime): DoctorCheck {
  const detected = detectedAgentIds(rt);
  if (detected.length === 0) {
    return { id: 8, name: "Agentes (gerenciado)", status: "skip", detail: "pulado — nenhum agente não-Pi detectado (check 7)" };
  }
  const loaded = loadStateReadonly(statePath(rt, "global"), "global");
  const notManaged = detected.filter((id) => !(loaded.ok && loaded.state.agents[id] !== undefined));
  if (notManaged.length === 0) {
    return { id: 8, name: "Agentes (gerenciado)", status: "pass", detail: `todos os agentes detectados são gerenciados: ${detected.join(", ")}` };
  }
  return {
    id: 8,
    name: "Agentes (gerenciado)",
    status: "warn",
    detail: `${notManaged.join(", ")} detectado(s) mas não gerenciado(s) pelo harness`,
    remedy: `harness install --agent ${notManaged.join(",")}`,
  };
}

/**
 * F17 D3 check 9 — configs injetadas: state registra um target, mas a seção
 * `runecraft:` / entry MCP sumiu → "quebrado", remedy sync. Sem agente
 * gerenciado → skip. Read-only (LIFE-01): usa hasSection/fingerprint, nunca
 * escreve. Targets órfãos (sem célula na matriz atual) são domínio do check
 * 13 — pulados aqui. Config ilegível (JSON inválido) conta como quebrado;
 * o check 11 aponta o erro de parse.
 */
function checkAgentConfigs(rt: Runtime): DoctorCheck {
  const loaded = loadStateReadonly(statePath(rt, "global"), "global");
  if (!loaded.ok || Object.keys(loaded.state.agents).length === 0) {
    return { id: 9, name: "Agentes (configs)", status: "skip", detail: "pulado — nenhum agente não-Pi gerenciado no state" };
  }
  const problems: string[] = [];
  for (const [agentId, record] of Object.entries(loaded.state.agents)) {
    const adapter = ADAPTERS[agentId as keyof typeof ADAPTERS];
    if (!adapter) continue; // órfã de matriz — check 13 reporta
    for (const target of record.targets) {
      const cell = MATRIX[agentId as keyof typeof MATRIX]?.[target.component as ComponentId];
      if (cell === undefined) continue; // target órfão — check 13
      if (target.kind === "rules") {
        if (!hasSection(target.file, target.section)) {
          problems.push(`${agentId}: seção '${target.section}' ausente em ${target.file}`);
        }
      } else {
        let fingerprint: string | null;
        try {
          fingerprint = adapter.readMcpFingerprint(rt);
        } catch (error) {
          problems.push(`${agentId}: config MCP ilegível em ${target.file} (${(error as Error).message})`);
          continue;
        }
        if (fingerprint === null) {
          problems.push(`${agentId}: entry MCP '${target.entry}' ausente em ${target.file}`);
        }
      }
    }
  }
  if (problems.length === 0) {
    return { id: 9, name: "Agentes (configs)", status: "pass", detail: "seções runecraft: e entries MCP registradas presentes" };
  }
  return {
    id: 9,
    name: "Agentes (configs)",
    status: "fail",
    detail: problems.join("; "),
    remedy: "harness sync --agent <id> (re-injeção idempotente)",
  };
}

/**
 * F17 D3 check 10 — colisão MCP upstream: entry `taskflow` presente apontando
 * para bin não-runecraft → warn (detecção de donos formalizada no F18). O
 * install nunca sobrescreve essa entry (F15 D5).
 */
function checkAgentMcpCollision(rt: Runtime): DoctorCheck {
  const detected = detectedAgentIds(rt);
  if (detected.length === 0) {
    return { id: 10, name: "Agentes (colisão MCP)", status: "skip", detail: "pulado — nenhum agente não-Pi detectado (check 7)" };
  }
  const collisions: string[] = [];
  for (const id of detected) {
    let entry: unknown;
    try {
      entry = ADAPTERS[id].readMcpEntry(rt);
    } catch {
      continue; // config ilegível — check 11 reporta o parse
    }
    if (entry !== null && isUpstreamMcpEntry(entry)) {
      collisions.push(`${id}: entry MCP 'taskflow' aponta para bin upstream (instalação manual?)`);
    }
  }
  if (collisions.length === 0) {
    return { id: 10, name: "Agentes (colisão MCP)", status: "pass", detail: "nenhuma entry MCP com referência upstream" };
  }
  return {
    id: 10,
    name: "Agentes (colisão MCP)",
    status: "warn",
    detail: collisions.join("; "),
    remedy: "remova a entry manual (o install do harness nunca sobrescreve) — detecção de donos completa no F18",
  };
}

/**
 * F17 D3 check 11 — config do agente parseável: JSON hosts via JSON.parse
 * estrito; codex TOML com validação estrutural mínima (sem parser TOML de
 * runtime — zero deps, F11). Inválido → fail apontando arquivo + erro.
 */
function checkAgentConfigParse(rt: Runtime): DoctorCheck {
  const detected = detectedAgentIds(rt);
  if (detected.length === 0) {
    return { id: 11, name: "Agentes (config parseável)", status: "skip", detail: "pulado — nenhum agente não-Pi detectado (check 7)" };
  }
  const problems: string[] = [];
  for (const id of detected) {
    const adapter = ADAPTERS[id];
    const paths = adapter.paths(rt);
    if (id === "codex") {
      // Sem parser TOML no runtime (zero deps — F11), a validade TOML não é
      // julgada aqui: o codex tem parser próprio. Só o ilegível (não-UTF8) é
      // fail real; seções alheias/duplicadas são domínio do F18 (donos).
      try {
        if (fs.existsSync(paths.mcpFile)) {
          const raw = fs.readFileSync(paths.mcpFile);
          if (!isValidUtf8(raw)) {
            problems.push(`${paths.mcpFile}: não é UTF-8 legível`);
          }
        }
      } catch (error) {
        problems.push(`${paths.mcpFile}: ilegível — ${(error as Error).message}`);
      }
      continue;
    }
    // JSON hosts: .mcp.json (claude) / opencode.json.
    if (fs.existsSync(paths.mcpFile)) {
      try {
        JSON.parse(fs.readFileSync(paths.mcpFile, "utf8"));
      } catch (error) {
        problems.push(`${paths.mcpFile}: JSON inválido — ${(error as Error).message}`);
      }
    }
  }
  if (problems.length === 0) {
    const detail =
      detected.map((id) => (id === "codex" ? `${id} (estrutura mínima)` : id)).join("; ") + " — configs parseáveis (quando presentes)";
    return { id: 11, name: "Agentes (config parseável)", status: "pass", detail };
  }
  return {
    id: 11,
    name: "Agentes (config parseável)",
    status: "fail",
    detail: problems.join("; "),
    remedy: "corrija o arquivo apontado (ou restaure de um backup do harness)",
  };
}

/**
 * F17 D3 check 12 — detect-only: bins de agentes sem adapter (cursor, grok,
 * …) presentes → informativo com guia (nunca falha — D4).
 */
function checkAgentDetectOnly(rt: Runtime): DoctorCheck {
  const present: string[] = [];
  for (const id of Object.keys(DETECT_ONLY_GUIDES)) {
    if (binOnPath(id, rt)) present.push(id);
  }
  if (present.length === 0) {
    return { id: 12, name: "Agentes (detect-only)", status: "pass", detail: "nenhum agente sem adapter detectado (cursor, grok, …)" };
  }
  const detail = present.map((id) => `${id}: ${DETECT_ONLY_GUIDES[id]}`).join(" | ");
  return { id: 12, name: "Agentes (detect-only)", status: "pass", detail: `detectado(s): ${detail}` };
}

/**
 * F17 D3 check 13 — órfãs de matriz: target no state cuja célula não existe
 * mais na coluna da matriz atual (CLI mudou de versão) → warn, nunca remove
 * (remoção é contrato do uninstall — D6).
 */
function checkAgentMatrixOrphans(rt: Runtime): DoctorCheck {
  const loaded = loadStateReadonly(statePath(rt, "global"), "global");
  if (!loaded.ok || Object.keys(loaded.state.agents).length === 0) {
    return { id: 13, name: "Agentes (órfãs de matriz)", status: "skip", detail: "pulado — nenhum agente gerenciado no state" };
  }
  const orphans: string[] = [];
  for (const [agentId, record] of Object.entries(loaded.state.agents)) {
    for (const target of record.targets) {
      const cell = MATRIX[agentId as keyof typeof MATRIX]?.[target.component as ComponentId];
      if (cell === undefined) {
        orphans.push(`${agentId}: target órfão (matriz mudou) — '${target.component}' em ${target.file}`);
      }
    }
  }
  if (orphans.length === 0) {
    return { id: 13, name: "Agentes (órfãs de matriz)", status: "pass", detail: "nenhum target órfão (todos mapeados na matriz atual)" };
  }
  return {
    id: 13,
    name: "Agentes (órfãs de matriz)",
    status: "warn",
    detail: orphans.join("; "),
    remedy: "harness uninstall --agent <id> (remover o agente inteiro) ou uninstall manual do target",
  };
}

/** Agentes não-Pi da matriz com binário no PATH (síncrono — read-only). */
function detectedAgentIds(rt: Runtime): AgentId[] {
  return SUPPORTED_AGENT_IDS.filter((id) => binOnPath(ADAPTERS[id].bin, rt));
}

/** `command -v <bin>` via sh, síncrono (contrato do doctor: read-only/sync — F12 LIFE-01). */
function binOnPath(bin: string, rt: Runtime): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${bin} 2>/dev/null`], {
      env: rt.env as Record<string, string>,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}
