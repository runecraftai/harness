// restore.test.ts — F13 STBK-08: restore de snapshot via CLI.
// Restaura arquivos nos paths originais, fail-closed com snapshot inválido,
// nunca destrói o que não estava no snapshot, backup pré-restore (ciclo
// reversível) e symlinks preservados.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, settingsFile, type Sandbox } from "./helpers.ts";
import { createSnapshot, listSnapshots } from "../src/backup.ts";

function backupsDir(sb: Sandbox): string {
  return path.join(sb.runecraftHome, "backups");
}

function createTestSnapshot(sb: Sandbox, files: string[], reason = "install"): string {
  const result = createSnapshot({
    files,
    destDir: backupsDir(sb),
    reason,
    scope: "global",
    now: new Date("2026-08-05T12:00:00.000Z"),
  });
  return path.basename(result.file);
}

describe("restore — restaura arquivos (STBK 3.1)", () => {
  test("settings.json quebrado → restore devolve o conteúdo original (diff vazio)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      const original = '{"packages":["npm:@runecraft/subagents"],"myKey":{"keep":"me"}}\n';
      fs.writeFileSync(settingsFile(sb), original);

      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      fs.writeFileSync(settingsFile(sb), "{ broken", "utf8");

      const result = await runHarness(sb, ["restore", name]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Restaurado de");
      expect(result.stdout).toContain(settingsFile(sb));
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(original);
    } finally {
      sb.cleanup();
    }
  });

  test("--json reporta {scope, snapshot, restored, failed, backup}", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":[]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      fs.writeFileSync(settingsFile(sb), "{ broken", "utf8");

      const result = await runHarness(sb, ["restore", name, "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as {
        scope: string;
        snapshot: string;
        restored: string[];
        failed: unknown[];
        backup: string | null;
      };
      expect(json.scope).toBe("global");
      expect(json.snapshot).toBe(name);
      expect(json.restored).toEqual([settingsFile(sb)]);
      expect(json.failed).toEqual([]);
      expect(typeof json.backup).toBe("string");
    } finally {
      sb.cleanup();
    }
  });

  test("backup pré-restore do estado atual é criado (ciclo reversível)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":["a"]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      fs.writeFileSync(settingsFile(sb), '{"packages":["b"]}\n');

      await runHarness(sb, ["restore", name]);
      const pre = listSnapshots(backupsDir(sb)).find((s) => s.reason === "restore");
      expect(pre).toBeDefined();
      // o backup pré-restore capturou o estado "b" (o que foi sobrescrito)
      expect(pre?.files).toEqual([settingsFile(sb)]);
      expect(pre?.name).not.toBe(name);
    } finally {
      sb.cleanup();
    }
  });

  test("arquivo do snapshot ausente no disco atual é recriado", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":["npm:@runecraft/pr-review"]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      fs.rmSync(settingsFile(sb)); // removido depois do snapshot

      const result = await runHarness(sb, ["restore", name]);
      expect(result.code).toBe(0);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe('{"packages":["npm:@runecraft/pr-review"]}\n');
    } finally {
      sb.cleanup();
    }
  });

  test("não destrói arquivos que não estavam no snapshot", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":[]}\n');
      const other = path.join(sb.piHome, "pr-review.json");
      fs.writeFileSync(other, '{"review":{"enabled":true}}\n');
      const otherHash = fs.readFileSync(other, "utf8");

      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      fs.writeFileSync(settingsFile(sb), '{"packages":["mutado"]}\n');

      const result = await runHarness(sb, ["restore", name]);
      expect(result.code).toBe(0);
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe('{"packages":[]}\n');
      expect(fs.readFileSync(other, "utf8")).toBe(otherHash); // intocado
    } finally {
      sb.cleanup();
    }
  });

  test("symlink no snapshot é restaurado como symlink", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      const real = path.join(sb.piHome, "real.json");
      fs.writeFileSync(real, '{"packages":["npm:@runecraft/subagents"]}\n');
      const link = settingsFile(sb);
      fs.symlinkSync(real, link);

      const name = createTestSnapshot(sb, [link]);
      // quebra o symlink: substitui por um arquivo comum
      fs.rmSync(link);
      fs.writeFileSync(link, "{ not json", "utf8");

      const result = await runHarness(sb, ["restore", name]);
      expect(result.code).toBe(0);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(link)).toBe(real);
      // o alvo original não foi tocado pelo restore do symlink
      expect(fs.readFileSync(real, "utf8")).toBe('{"packages":["npm:@runecraft/subagents"]}\n');
    } finally {
      sb.cleanup();
    }
  });
});

describe("restore — fail-closed (STBK-08)", () => {
  test("snapshot inválido (arquivo corrompido) → falha sem modificar nada", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      const content = '{"packages":[]}\n';
      fs.writeFileSync(settingsFile(sb), content);

      fs.mkdirSync(backupsDir(sb), { recursive: true });
      const bogus = path.join(backupsDir(sb), "runecraft-bogus.tar.gz");
      fs.writeFileSync(bogus, "não é um tar.gz");

      const result = await runHarness(sb, ["restore", "runecraft-bogus.tar.gz"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("inválido ou corrompido");
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(content); // intocado
    } finally {
      sb.cleanup();
    }
  });

  test("snapshot incompleto (manifest sem os entries) → falha antes de escrever", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      const content = '{"packages":[]}\n';
      fs.writeFileSync(settingsFile(sb), content);

      // tar.gz com paths.json listando 1 arquivo mas sem files/0
      const name = createTestSnapshot(sb, [settingsFile(sb)]);
      const dir = backupsDir(sb);
      const gz = fs.readFileSync(path.join(dir, name));
      const zlib = await import("node:zlib");
      const tar = zlib.gunzipSync(gz);
      // trunca o archive antes de files/0 (primeiro bloco de conteúdo)
      const truncated = tar.subarray(0, 1024);
      const brokenName = "runecraft-incomplete.tar.gz";
      fs.writeFileSync(path.join(dir, brokenName), zlib.gzipSync(truncated));

      const result = await runHarness(sb, ["restore", brokenName]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("incompleto");
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe(content); // intocado
    } finally {
      sb.cleanup();
    }
  });

  test("backup inexistente → falha listando os disponíveis (STBK 3.2)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":[]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)]);

      const result = await runHarness(sb, ["restore", "runecraft-99999999-000000-000.tar.gz"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("não encontrado");
      expect(result.stderr).toContain(name); // lista o que existe
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe('{"packages":[]}\n');
    } finally {
      sb.cleanup();
    }
  });

  test("sem nome → falha com instrução", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["restore"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("especifique o snapshot");
    } finally {
      sb.cleanup();
    }
  });
});

describe("restore — scope workspace", () => {
  test("restaura no .pi do projeto quando --scope workspace", async () => {
    const sb = makeSandbox();
    try {
      const project = path.join(sb.dir, "proj");
      const wsSettings = path.join(project, ".pi", "settings.json");
      fs.mkdirSync(path.dirname(wsSettings), { recursive: true });
      fs.writeFileSync(wsSettings, '{"packages":["npm:@runecraft/taskflow-core"]}\n');

      // snapshot no dir de backups do workspace
      const wsBackups = path.join(project, ".runecraft", "backups");
      const snapshot = createSnapshot({
        files: [wsSettings],
        destDir: wsBackups,
        reason: "install",
        scope: "workspace",
        now: new Date("2026-08-05T12:00:00.000Z"),
      });

      fs.writeFileSync(wsSettings, "{ broken", "utf8");

      const result = await runHarness(sb, ["restore", path.basename(snapshot.file), "--scope", "workspace"], { cwd: project });
      expect(result.code).toBe(0);
      expect(fs.readFileSync(wsSettings, "utf8")).toBe('{"packages":["npm:@runecraft/taskflow-core"]}\n');
      // state do global intocado (não há nem backups globais novos)
      expect(listSnapshots(backupsDir(sb))).toEqual([]);
    } finally {
      sb.cleanup();
    }
  });
});

describe("backups — listagem via CLI (STBK 3.3)", () => {
  test("lista data, tamanho, trigger e arquivos; --json parseável", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":["npm:@runecraft/subagents"]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)], "install");

      const tty = await runHarness(sb, ["backups"]);
      expect(tty.code).toBe(0);
      expect(tty.stdout).toContain(name);
      expect(tty.stdout).toContain("install");
      expect(tty.stdout).toContain(settingsFile(sb));

      const json = await runHarness(sb, ["backups", "--json"]);
      expect(json.code).toBe(0);
      const parsed = JSON.parse(json.stdout) as { scope: string; snapshots: Array<{ name: string; createdAt: string; sizeBytes: number; files: string[]; pinned: boolean }> };
      expect(parsed.scope).toBe("global");
      expect(parsed.snapshots).toHaveLength(1);
      expect(parsed.snapshots[0]?.name).toBe(name);
      expect(parsed.snapshots[0]?.files).toEqual([settingsFile(sb)]);
      expect(parsed.snapshots[0]?.pinned).toBe(false);
      expect(parsed.snapshots[0]?.sizeBytes).toBeGreaterThan(0);
    } finally {
      sb.cleanup();
    }
  });

  test("--keep pina um snapshot (sobrevive ao prune)", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":["a"]}\n');
      const name = createTestSnapshot(sb, [settingsFile(sb)]);

      const result = await runHarness(sb, ["backups", "--keep", name.replace(/\.tar\.gz$/, "")]);
      expect(result.code).toBe(0);
      expect(listSnapshots(backupsDir(sb))[0]?.pinned).toBe(true);
    } finally {
      sb.cleanup();
    }
  });

  test("--keep com snapshot inexistente → exit 1 listando os disponíveis", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["backups", "--keep", "runecraft-99999999-000000-000.tar.gz"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("não encontrado");
    } finally {
      sb.cleanup();
    }
  });
});
