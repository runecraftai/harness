// backup.test.ts — F13 backup engine: snapshot, manifest, dedupe (STBK-05),
// prune + pins (STBK-06), fail-safe de espaço (STBK-07), symlinks e reader.
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createSnapshot,
  extractSnapshot,
  listSnapshots,
  pinSnapshot,
  pruneSnapshots,
  readSnapshotManifest,
} from "../src/backup.ts";
import { backupsDir, makeSandbox, runHarness, settingsFile, stateFile, writeSettings, type Sandbox } from "./helpers.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-backup-"));
}

function snapshotFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tar.gz")).sort();
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

describe("createSnapshot — escrita e manifest (STBK-04)", () => {
  test("grava runecraft-<ts>.tar.gz com manifest legível (scope/reason/files/hash)", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, '{"packages":[]}\n');
      const now = new Date("2026-08-05T12:00:00.000Z");
      const result = createSnapshot({ files: [cfg], destDir: path.join(dir, "backups"), now, reason: "install", scope: "global" });

      expect(result.deduped).toBe(false);
      expect(path.basename(result.file)).toBe("runecraft-20260805-120000-000.tar.gz");
      expect(result.files).toEqual([cfg]);
      expect(result.createdAt).toBe("2026-08-05T12:00:00.000Z");

      const manifest = readSnapshotManifest(result.file);
      expect(manifest).not.toBeNull();
      expect(manifest?.schemaVersion).toBe(1);
      expect(manifest?.scope).toBe("global");
      expect(manifest?.reason).toBe("install");
      expect(manifest?.files).toEqual([cfg]);
      expect(manifest?.hash).toBe(result.hash);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("arquivos ausentes são pulados (não entram no snapshot)", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, "{}");
      const result = createSnapshot({
        files: [cfg, path.join(dir, "nao-existe.json")],
        destDir: path.join(dir, "backups"),
        reason: "install",
      });
      expect(result.files).toEqual([cfg]);
      const manifest = readSnapshotManifest(result.file);
      expect(manifest?.files).toEqual([cfg]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("hash é estável entre execuções com o mesmo conteúdo (base do dedupe)", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, '{"packages":["npm:@runecraft/subagents"]}\n');
      const destDir = path.join(dir, "backups");
      const a = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:00.000Z") });
      const b = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-06T12:00:00.000Z") });
      expect(a.hash).toBe(b.hash);
      expect(a.hash).not.toBe(sha256('{"packages":["npm:@runecraft/subagents"]}\n')); // não é só o conteúdo: inclui o path
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dedupe (STBK-05)", () => {
  test("conteúdo idêntico → reutiliza o snapshot existente (nenhum arquivo novo)", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, '{"packages":[]}\n');
      const destDir = path.join(dir, "backups");

      const first = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:00.000Z") });
      expect(first.deduped).toBe(false);
      const second = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:01.000Z") });

      expect(second.deduped).toBe(true);
      expect(second.file).toBe(first.file);
      expect(second.createdAt).toBe(first.createdAt);
      expect(snapshotFiles(destDir)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("conteúdo diferente → novo snapshot", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");

      fs.writeFileSync(cfg, '{"packages":[]}\n');
      const first = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:00.000Z") });
      fs.writeFileSync(cfg, '{"packages":["npm:@runecraft/subagents"]}\n');
      const second = createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:01.000Z") });

      expect(second.deduped).toBe(false);
      expect(second.file).not.toBe(first.file);
      expect(snapshotFiles(destDir)).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("mesmo conteúdo em path diferente → hash diferente (dedupe por path completo — edge F13)", () => {
    const dir = tmpDir();
    try {
      const globalCfg = path.join(dir, "pi-agent", "settings.json");
      const wsCfg = path.join(dir, "proj", ".pi", "settings.json");
      for (const f of [globalCfg, wsCfg]) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '{"packages":[]}\n');
      }
      const destDir = path.join(dir, "backups");
      const a = createSnapshot({ files: [globalCfg], destDir, now: new Date("2026-08-05T12:00:00.000Z") });
      const b = createSnapshot({ files: [wsCfg], destDir, now: new Date("2026-08-05T12:00:01.000Z") });
      expect(a.hash).not.toBe(b.hash);
      expect(snapshotFiles(destDir)).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prune + pins (STBK-06)", () => {
  function distinctSnapshots(destDir: string, cfg: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      fs.writeFileSync(cfg, `{"packages":["pkg-${i}"]}\n`);
      createSnapshot({
        files: [cfg],
        destDir,
        now: new Date(Date.UTC(2026, 7, 5, 12, 0, i)),
        reason: "install",
      });
    }
  }

  test("acima de maxKeep (5) os mais antigos são pruned", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");
      distinctSnapshots(destDir, cfg, 7);

      expect(snapshotFiles(destDir)).toHaveLength(5);
      const listed = listSnapshots(destDir);
      expect(listed).toHaveLength(5);
      // os 5 mais recentes (12:00:02..06) permanecem
      expect(listed[0]?.name).toBe("runecraft-20260805-120006-000.tar.gz");
      expect(listed[4]?.name).toBe("runecraft-20260805-120002-000.tar.gz");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("snapshot pinado sobrevive ao prune", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");
      fs.writeFileSync(cfg, '{"packages":["pkg-0"]}\n');
      createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:00.000Z"), reason: "install" });
      pinSnapshot(destDir, "runecraft-20260805-120000-000.tar.gz");

      distinctSnapshots(destDir, cfg, 7);

      const names = snapshotFiles(destDir);
      expect(names).toHaveLength(6); // 5 recentes + o pinado
      expect(names).toContain("runecraft-20260805-120000-000.tar.gz");
      expect(listSnapshots(destDir).find((s) => s.name === "runecraft-20260805-120000-000.tar.gz")?.pinned).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pinSnapshot aceita nome com ou sem .tar.gz e falha para snapshot inexistente", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");
      fs.writeFileSync(cfg, "{}");
      createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:00.000Z") });

      pinSnapshot(destDir, "runecraft-20260805-120000-000"); // sem extensão
      expect(listSnapshots(destDir)[0]?.pinned).toBe(true);
      expect(() => pinSnapshot(destDir, "runecraft-19990101-000000-000.tar.gz")).toThrow("não encontrado");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("listSnapshots ordena do mais novo e expõe data/tamanho/arquivos/pinado", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");
      fs.writeFileSync(cfg, '{"packages":["a"]}\n');
      createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:01.000Z"), reason: "sync" });
      fs.writeFileSync(cfg, '{"packages":["b"]}\n');
      createSnapshot({ files: [cfg], destDir, now: new Date("2026-08-05T12:00:02.000Z"), reason: "install" });

      const listed = listSnapshots(destDir);
      expect(listed[0]?.reason).toBe("install");
      expect(listed[1]?.reason).toBe("sync");
      expect(listed[0]?.sizeBytes).toBeGreaterThan(0);
      expect(listed[0]?.files).toEqual([cfg]);
      expect(listed[0]?.pinned).toBe(false);
      expect(listed[0]?.createdAt).toBe("2026-08-05T12:00:02.000Z");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pruneSnapshots manual remove e reporta", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      const destDir = path.join(dir, "backups");
      distinctSnapshots(destDir, cfg, 3);
      const removed = pruneSnapshots(destDir, 1);
      expect(removed).toHaveLength(2);
      expect(snapshotFiles(destDir)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fail-safe de espaço (STBK-07)", () => {
  test("espaço abaixo do threshold → throw antes de qualquer write", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, "{}");
      const destDir = path.join(dir, "backups");
      expect(() =>
        createSnapshot({
          files: [cfg],
          destDir,
          minFreeBytes: 50 * 1024 * 1024,
          freeBytes: () => 1024, // 1 KB livre
        }),
      ).toThrow("espaço livre insuficiente");
      expect(fs.existsSync(destDir)).toBe(false); // nada foi escrito
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("threshold customizado (teste): abaixo dele falha, acima funciona", () => {
    const dir = tmpDir();
    try {
      const cfg = path.join(dir, "settings.json");
      fs.writeFileSync(cfg, "{}");
      const destDir = path.join(dir, "backups");
      expect(() =>
        createSnapshot({ files: [cfg], destDir, minFreeBytes: 10_000, freeBytes: () => 1_000 }),
      ).toThrow();
      const ok = createSnapshot({ files: [cfg], destDir, minFreeBytes: 100, freeBytes: () => 1_000 });
      expect(fs.existsSync(ok.file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integração CLI — dedupe (spec F13: install 2x no mesmo estado → 1 snapshot)", () => {
  test("rerun do install com settings pré-existente idêntico não cria snapshot novo", async () => {
    const sb = makeSandbox();
    try {
      const identities = [
        "npm:@runecraft/subagents",
        "npm:@runecraft/taskflow-core",
        "npm:@runecraft/taskflow",
        "npm:@runecraft/taskflow-dsl",
        "npm:@runecraft/goal-loop-audit",
        "npm:@runecraft/pr-review",
      ];
      writeSettings(sb, identities);
      const destDir = backupsDir(sb);

      const first = await runHarness(sb, ["install"]);
      expect(first.code).toBe(0);
      const afterFirst = snapshotFiles(destDir);
      expect(afterFirst).toHaveLength(1);

      const second = await runHarness(sb, ["install"]);
      expect(second.code).toBe(0);
      expect(snapshotFiles(destDir)).toEqual(afterFirst); // dedupe: 1 snapshot, não 2
    } finally {
      sb.cleanup();
    }
  });
});

describe("integração CLI — fail-safe (STBK-07: aborta antes de modificar)", () => {
  test("backups dir impossível de criar → install aborta sem tocar o settings", async () => {
    const sb = makeSandbox();
    try {
      // runecraft home é um arquivo: mkdir dos backups falha → snapshot falha → abort
      fs.writeFileSync(sb.runecraftHome, "sou um arquivo, não um dir");
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":[]}\n');

      const result = await runHarness(sb, ["install"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("snapshot pré-write");
      // nada foi modificado: settings e packages intactos
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe('{"packages":[]}\n');
      expect(fs.existsSync(stateFile(sb))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  test("restore com backup pré-restore impossível → aborta sem escrever nada", async () => {
    const sb = makeSandbox();
    try {
      fs.mkdirSync(sb.piHome, { recursive: true });
      fs.writeFileSync(settingsFile(sb), '{"packages":["a"]}\n');
      // snapshot vive fora do dir de backups (restore aceita path absoluto)
      const elsewhere = path.join(sb.dir, "elsewhere");
      const snapshot = createSnapshot({ files: [settingsFile(sb)], destDir: elsewhere, now: new Date("2026-08-05T12:00:00.000Z") });

      fs.writeFileSync(settingsFile(sb), '{"packages":["b"]}\n');
      // o dir de backups vira um arquivo: o backup pré-restore não pode ser escrito
      const destDir = backupsDir(sb);
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      fs.writeFileSync(destDir, "não sou um dir");

      const result = await runHarness(sb, ["restore", snapshot.file]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("backup pré-restore");
      expect(fs.readFileSync(settingsFile(sb), "utf8")).toBe('{"packages":["b"]}\n'); // intocado
    } finally {
      sb.cleanup();
    }
  });
});

describe("symlinks (edge F13) e leitura do snapshot", () => {
  test("symlink é capturado como symlink (não seguido) e restaurado como symlink", () => {
    const dir = tmpDir();
    try {
      const real = path.join(dir, "real-settings.json");
      fs.writeFileSync(real, '{"packages":["npm:@runecraft/subagents"]}\n');
      const link = path.join(dir, "settings.json");
      fs.symlinkSync(real, link);

      const destDir = path.join(dir, "backups");
      const result = createSnapshot({ files: [link], destDir, reason: "install" });
      expect(result.files).toEqual([link]);

      const extracted = extractSnapshot(result.file);
      expect(extracted.manifest.files).toEqual([link]);
      expect(extracted.entries[0]?.kind).toBe("symlink");
      expect(extracted.entries[0]?.linkTarget).toBe(real); // target original preservado, não seguido

      // extração para outro local recria o symlink (não o conteúdo)
      const out = path.join(dir, "out");
      const target = path.join(out, "settings.json");
      fs.mkdirSync(out, { recursive: true });
      const entry = extracted.entries[0];
      if (entry?.kind === "symlink") {
        fs.symlinkSync(entry.linkTarget ?? "", target);
      }
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("extractSnapshot rejeita snapshot corrompido (fail-closed)", () => {
    const dir = tmpDir();
    try {
      const destDir = path.join(dir, "backups");
      fs.mkdirSync(destDir, { recursive: true });
      const bogus = path.join(destDir, "runecraft-bogus.tar.gz");
      fs.writeFileSync(bogus, "isto não é um tar.gz");
      expect(() => extractSnapshot(bogus)).toThrow("inválido ou corrompido");
      expect(readSnapshotManifest(bogus)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
