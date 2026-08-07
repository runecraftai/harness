// cli.test.ts — dispatch: help/version, stubs F12/F13, wrapper bin smoke.
import { describe, expect, test } from "bun:test";
import { dispatch } from "../src/cli.ts";
import { makeSandbox, runHarness, type Sandbox } from "./helpers.ts";

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(String(chunk));
  }
  get text(): string {
    return this.chunks.join("");
  }
}

async function dispatchCapture(sb: Sandbox, args: string[]) {
  const out = new StringSink();
  const err = new StringSink();
  const code = await dispatch(args, { env: sb.env, cwd: sb.dir, stdout: out, stderr: err, isTTY: false });
  return { code, stdout: out.text, stderr: err.text };
}

describe("--help / --version (CLI-06)", () => {
  test("--help sai com 0 e documenta presets", async () => {
    const sb = makeSandbox();
    try {
      const result = await dispatchCapture(sb, ["--help"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Presets:");
      expect(result.stdout).toContain("minimal");
      expect(result.stdout).toContain("full");
    } finally {
      sb.cleanup();
    }
  });

  test("--version sai com 0 e imprime o nome do package", async () => {
    const sb = makeSandbox();
    try {
      const result = await dispatchCapture(sb, ["--version"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("@runecraft/harness");
    } finally {
      sb.cleanup();
    }
  });
});

describe("F13 implementado: backups e restore", () => {
  test("backups sem snapshots: lista vazia e instrui, exit 0", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["backups"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("harness backups");
      expect(result.stdout).toContain("nenhum snapshot");
      expect(result.stdout).not.toContain("F13");
    } finally {
      sb.cleanup();
    }
  });

  test("backups --json: shape {scope, snapshots}", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["backups", "--json"]);
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { scope: string; snapshots: unknown[] };
      expect(json.scope).toBe("global");
      expect(json.snapshots).toEqual([]);
      expect(result.stdout).not.toContain("F13");
    } finally {
      sb.cleanup();
    }
  });

  test("restore sem nome: falha listando os disponíveis (STBK 3.2)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["restore"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("restore");
      expect(result.stderr).toContain("Nenhum snapshot disponível");
      expect(result.stdout).not.toContain("F13");
    } finally {
      sb.cleanup();
    }
  });

  test("restore de snapshot inexistente: falha listando os disponíveis", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["restore", "runecraft-99999999-000000-000.tar.gz"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("não encontrado");
      expect(result.stderr).toContain("disponív");
    } finally {
      sb.cleanup();
    }
  });

  test("restore com dois nomes: erro de parse", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["restore", "a.tar.gz", "b.tar.gz"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("único nome");
    } finally {
      sb.cleanup();
    }
  });
});

describe("comandos F12 implementados (stubs removidos)", () => {
  test("doctor roda de verdade (read-only) e não reporta mais F12", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["doctor"]);
      expect(result.code).toBe(1); // pi ausente → check 1 fail
      expect(result.stdout).toContain("[1] Pi bin");
      expect(result.stdout).not.toContain("F12");
    } finally {
      sb.cleanup();
    }
  });

  test("status roda de verdade e instrui install quando vazio (LIFE 4.3)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["status"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("harness status");
      expect(result.stdout).toContain("nada instalado pelo harness");
      expect(result.stdout).not.toContain("F12");
    } finally {
      sb.cleanup();
    }
  });

  test("sync roda de verdade: sem state → nothing to reconcile", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["sync"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nada para reconciliar");
      expect(result.stdout).not.toContain("F12");
    } finally {
      sb.cleanup();
    }
  });

  test("uninstall exige --all ou --component (nada é removido sem seleção)", async () => {
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["uninstall"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--all");
      expect(result.stdout).not.toContain("F12");
    } finally {
      sb.cleanup();
    }
  });
});

describe("bin wrapper smoke (F21 D1)", () => {
  test("bin/harness.ts é um wrapper fino que repassa argv e exit code", async () => {
    // O wrapper só pode ser exercitado como subprocesso; verifica o contrato
    // via dispatch direto + inspeção do arquivo (shebang + dispatch único).
    const sb = makeSandbox();
    try {
      const source = await Bun.file(new URL("../bin/harness.ts", import.meta.url).pathname).text();
      expect(source).toContain("#!/usr/bin/env node");
      expect(source).toContain("dispatch");
      expect(source).toContain("process.exit");
      // dispatch("status") sem pi → tabela vazia + sugestão de install (F12 real)
      const result = await runHarness(sb, ["status"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("npx @runecraft/harness install");
    } finally {
      sb.cleanup();
    }
  });
});
