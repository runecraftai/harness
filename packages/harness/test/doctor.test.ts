// doctor.test.ts — F12 LIFE-01/02: read-only health checks (pass/warn/fail/skip).
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendPackages,
  makeSandbox,
  makeSandboxCleanPath,
  readJson,
  runHarness,
  settingsFile,
  stateFile,
  writeSettings,
  type Sandbox,
} from "./helpers.ts";
import { parsePinnedVersion, runDoctorChecks, type DoctorReport } from "../src/commands/doctor.ts";
import { resolveRuntime } from "../src/config.ts";
import { createPiInterop } from "../src/pi.ts";
import { loadStateReadonly } from "../src/state.ts";

function fileHash(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function summaryLine(stdout: string): string {
  const line = stdout.split("\n").find((l) => l.startsWith("Resumo:"));
  expect(line).toBeDefined();
  return line ?? "";
}

describe("doctor — pass e read-only (LIFE-01)", () => {
  test("harness saudável: 8 checks pass e zero modificações (diff antes/depois)", async () => {
    // PATH mínimo: os checks 7–13 não podem depender dos bins reais do ambiente.
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      const settingsBefore = fileHash(settingsFile(sb));
      const stateBefore = fileHash(stateFile(sb));
      const backupsBefore = fs.existsSync(path.join(sb.runecraftHome, "backups"))
        ? fs.readdirSync(path.join(sb.runecraftHome, "backups")).sort()
        : [];

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      // 1–6 (F12) + 7 (detecção, informativo) + 12 (detect-only, informativo)
      expect(summaryLine(result.stdout)).toContain("pass 8");
      expect(summaryLine(result.stdout)).toContain("fail 0");
      for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) expect(result.stdout).toContain(`[${id}]`);

      // read-only: nenhum arquivo foi tocado
      expect(fileHash(settingsFile(sb))).toBe(settingsBefore);
      expect(fileHash(stateFile(sb))).toBe(stateBefore);
      const backupsAfter = fs.readdirSync(path.join(sb.runecraftHome, "backups")).sort();
      expect(backupsAfter).toEqual(backupsBefore);
    } finally {
      sb.cleanup();
    }
  });

  test("--json reporta checks e summary parseáveis", async () => {
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      const result = await runHarness(sb, ["doctor", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as DoctorReport;
      expect(json.checks).toHaveLength(13); // 1–6 (F12) + 7–13 agentes (F17; consolidado 7–15 no F18)
      expect(json.summary.pass + json.summary.warn).toBe(8);
      expect(json.summary.skip).toBe(5); // 8–11 e 13: nada de agentes para avaliar
      expect(json.exitCode).toBe(0);
      for (const check of json.checks) {
        expect(["pass", "warn", "fail", "skip"]).toContain(check.status);
        expect(check.detail.length).toBeGreaterThan(0);
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — checks de falha (LIFE-02)", () => {
  test("pi ausente → check 1 fail com o comando exato; checks 3-6 skip (sem cascade)", async () => {
    const sb = makeSandboxCleanPath();
    try {
      const result = await runHarness(sb, ["doctor"], { piBin: path.join(sb.dir, "no-such-pi") });
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[1] Pi bin");
      expect(result.stdout).toContain("fail");
      expect(result.stdout).toContain("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
      // dependentes pulados, não falham em cascata
      expect(summaryLine(result.stdout)).toContain("skip 9"); // 3-6 (Pi) + 8-11,13 (agentes)
      expect(result.stdout).toContain("pulado — depende do Pi");
    } finally {
      sb.cleanup();
    }
  });

  test("component ausente do pi list → check 3 fail apontando o componente e o fix", async () => {
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      // simula `pi remove npm:@runecraft/subagents` (o fake pi só edita settings)
      const settings = readJson(settingsFile(sb));
      settings.packages = (settings.packages as string[]).filter((p) => p !== "npm:@runecraft/subagents");
      fs.writeFileSync(settingsFile(sb), JSON.stringify(settings, null, 2));

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("@runecraft/subagents");
      expect(result.stdout).toContain("ausente");
      expect(result.stdout).toContain("harness install --component");
      expect(result.stdout).toContain("harness sync");

      // read-only mesmo em estado quebrado: settings intactos após o doctor
      const after = readJson(settingsFile(sb));
      expect((after.packages as string[])).not.toContain("npm:@runecraft/subagents");
    } finally {
      sb.cleanup();
    }
  });

  test("versão divergente no state → check 3 fail com remedy sync", async () => {
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      const state = readJson(stateFile(sb));
      (state.components as Record<string, { version: string }>)["@runecraft/subagents"]!.version = "0.0.1";
      fs.writeFileSync(stateFile(sb), JSON.stringify(state, null, 2));

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("@runecraft/subagents");
      expect(result.stdout).toContain("versão divergente");
      expect(result.stdout).toContain("0.0.1");
      expect(result.stdout).toContain("0.37.2");
    } finally {
      sb.cleanup();
    }
  });

  test("state.json corrompido → check 3 fail com remedy, arquivo preservado (read-only)", async () => {
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      fs.writeFileSync(stateFile(sb), "{ corrupt", "utf8");
      const stateHashBefore = fileHash(stateFile(sb));
      const dirBefore = fs.readdirSync(sb.runecraftHome).sort();

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[3] Components");
      expect(result.stdout).toContain("corrompido");
      expect(result.stdout).toContain(stateFile(sb));
      expect(result.stdout).toContain("harness restore");
      expect(summaryLine(result.stdout)).toContain("fail 1");

      // read-only: hash original preservado e nenhum state.json.corrupt-* criado
      expect(fileHash(stateFile(sb))).toBe(stateHashBefore);
      const dirAfter = fs.readdirSync(sb.runecraftHome).sort();
      expect(dirAfter).toEqual(dirBefore);
      expect(dirAfter.some((e) => e.startsWith("state.json.corrupt-"))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("settings.json com JSON inválido → check 2 fail apontando arquivo e erro de parse", async () => {
    const sb = makeSandboxCleanPath();
    try {
      fs.mkdirSync(path.dirname(settingsFile(sb)), { recursive: true });
      fs.writeFileSync(settingsFile(sb), "{ invalid json", "utf8");

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[2] Pi config");
      expect(result.stdout).toContain("JSON inválido");
      expect(result.stdout).toContain(settingsFile(sb));
      expect(result.stdout).toContain("remedy");
    } finally {
      sb.cleanup();
    }
  });

  test("bloco subagents com tipo errado → check 5 fail", async () => {
    const sb = makeSandboxCleanPath();
    try {
      fs.mkdirSync(path.dirname(settingsFile(sb)), { recursive: true });
      fs.writeFileSync(settingsFile(sb), JSON.stringify({ packages: [], subagents: "nao-e-objeto" }));

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[5] Settings dos forks");
      expect(result.stdout).toContain("subagents.*");
      expect(result.stdout).toContain("esperado como objeto");
    } finally {
      sb.cleanup();
    }
  });

  test("pr-review.json inválido → check 5 fail apontando o arquivo", async () => {
    const sb = makeSandboxCleanPath();
    try {
      await runHarness(sb, ["install"]);
      fs.writeFileSync(path.join(sb.piHome, "pr-review.json"), "{ broken", "utf8");

      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("pr-review.json");
      expect(result.stdout).toContain("JSON inválido");
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — warns (colisão) e scopes", () => {
  test("upstream instalado → check 4 warn com sugestão de remoção, exit 0", async () => {
    const sb = makeSandboxCleanPath();
    try {
      writeSettings(sb, ["npm:pi-subagents"]);
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[4] Colisão");
      expect(result.stdout).toContain("warn");
      expect(result.stdout).toContain("pi remove npm:pi-subagents");
      expect(summaryLine(result.stdout)).toContain("fail 0");
    } finally {
      sb.cleanup();
    }
  });

  test("scope workspace: state e settings do projeto considerados (edge -l)", async () => {
    const sb = makeSandboxCleanPath();
    try {
      // o check 2 exige settings.json global presente e válido (design F12);
      // o install de workspace não cria o global — pré-cria aqui.
      writeSettings(sb, []);
      const project = path.join(sb.dir, "proj");
      fs.mkdirSync(project, { recursive: true });
      await runHarness(sb, ["install", "--scope", "workspace"], { cwd: project });

      const result = await runHarness(sb, ["doctor"], { cwd: project });
      expect(result.code).toBe(0);
      // check 3 vê o state do workspace e o pi list (global + project do fake pi)
      expect(result.stdout).toContain("[3] Components");
      expect(result.stdout).toContain("pass");
      expect(summaryLine(result.stdout)).toContain("pass 8"); // 1-6 + 7,12 (informativos)
    } finally {
      sb.cleanup();
    }
  });

  test("nada instalado → check 3 warn com sugestão de install", async () => {
    const sb = makeSandboxCleanPath();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), JSON.stringify({ packages: [] }));
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[3] Components");
      expect(result.stdout).toContain("nada registrado no state");
      expect(result.stdout).toContain("npx @runecraft/harness install");
    } finally {
      sb.cleanup();
    }
  });

  test("pi list falha (Pi corrompido) → check 3 fail com erro bruto + hint, sem crash", async () => {
    const sb = makeSandbox({ piListFail: true });
    try {
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("[3] Components");
      expect(result.stdout).toContain("pi list falhou");
      expect(result.stdout).toContain("FAKE_PI_LIST_FAIL"); // erro bruto do pi
      expect(result.stdout).toContain("verifique a instalação do Pi");
    } finally {
      sb.cleanup();
    }
  });
});

describe("doctor — unit", () => {
  test("parsePinnedVersion extrai o pin de um spec npm", () => {
    expect(parsePinnedVersion("npm:@runecraft/subagents@0.37.2")).toBe("0.37.2");
    expect(parsePinnedVersion("npm:pi-mcp-adapter")).toBeNull();
  });

  test("runDoctorChecks com fake pi presente e settings válidos não falha", () => {
    const sb = makeSandboxCleanPath();
    try {
      writeSettings(sb, []);
      const rt = resolveRuntime(sb.dir, sb.env);
      const report = runDoctorChecks(rt, createPiInterop(rt));
      expect(report.exitCode).toBe(0);
      expect(report.summary.skip).toBe(5); // 8-11,13: sem agentes para avaliar
      expect(report.checks.some((c) => c.id === 3 && c.status === "warn")).toBe(true); // nada instalado
    } finally {
      sb.cleanup();
    }
  });

  test("loadStateReadonly não move arquivo corrompido e expõe o erro (LIFE-01)", () => {
    const sb = makeSandboxCleanPath();
    try {
      fs.mkdirSync(sb.runecraftHome, { recursive: true });
      const file = stateFile(sb);
      fs.writeFileSync(file, "{ corrupt", "utf8");
      const hash = fileHash(file);

      const result = loadStateReadonly(file, "global");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("corrupt");
        expect(result.file).toBe(file);
      }
      expect(fileHash(file)).toBe(hash);
      expect(fs.readdirSync(sb.runecraftHome)).toEqual(["state.json"]);
    } finally {
      sb.cleanup();
    }
  });
});
