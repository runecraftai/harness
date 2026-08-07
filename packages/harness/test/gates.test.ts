// gates.test.ts — F20: delivery gates (RCPT-05..08; D3/D4/D5 + fluxo 3/4/5).
//
// Cobre: config repo/global + effective (kill switch), shim do hook (conteúdo
// exato, sem BOM, chmod, pré-existente preservado, idempotente), enable
// (config+hooks+.gitignore+state+backup), disable (global default com prompt
// TTY, --scope workspace, dry-run), `gates run pre-commit` (sem receipt nega,
// exact passa, drift nega, off exit 0, config ausente nega, corrompido nega),
// `gates run pre-push` (tags/deleção skip, exact, compatible_base_advance com
// aviso, changed/unrelated/ambiguous negam), uninstall (hooks removidos,
// pré-existentes preservados, config/.gitignore limpos, receipts preservados),
// doctor check 17 e status seção Gates + --json.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { makeSandbox, readJson, runHarness, type Sandbox } from "./helpers.ts";
import { diffHash, git, initReviewRepo, type TestRepo } from "./gitrepo.ts";
import { writeReceipt } from "../src/receipt/store.ts";
import type { Receipt } from "../src/receipt/schema.ts";
import { resolveRuntime } from "../src/config.ts";
import { resolveGates, repoConfigPath, globalConfigPath, serializeGatesConfig, readGatesConfig, isGatesOnlyConfig } from "../src/gates/config.ts";
import { gatesShimBody, installGatesHooks, removeGatesHooks, hasGatesSection, ensureGitignoreLines, removeGitignoreLinesIfUnchanged, HOOK_NAMES, hooksDirFor, GITIGNORE_LINES } from "../src/gates/hook.ts";
import { parsePrePushRefs } from "../src/gates/run.ts";

/** Readable stdin for pre-push refs / prompts. */
function stdinFrom(text: string): NodeJS.ReadableStream {
  const stream = new Readable({ read() {} });
  stream.push(text);
  stream.push(null);
  return stream as NodeJS.ReadableStream;
}

function receiptFor(repo: TestRepo, opts: Partial<Receipt> = {}): Receipt {
  return {
    schema: "runecraft.receipt/v1",
    candidate: {
      head_sha: repo.headSha,
      diff_hash: diffHash(repo.dir, repo.baseSha, repo.headSha),
      base: { sha: repo.baseSha, ref: "main", remote: "origin" },
    },
    verdict: "approve",
    reviewHash: "e".repeat(64),
    issuedAt: new Date().toISOString(),
    ...opts,
  };
}

/** Habilita gates no repo (config) e escreve um receipt válido para o head. */
function enableAndReceipt(repo: TestRepo): void {
  const config = repoConfigPath(repo.dir);
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, serializeGatesConfig(true), "utf8");
  writeReceipt(repo.dir, receiptFor(repo));
}

describe("gates/config — effective + kill switch (D3)", () => {
  test("repo enabled → enabled; com kill switch global → disabled; sem config → absent", () => {
    const sb = makeSandbox();
    try {
      const dir = fs.mkdtempSync(path.join(sb.dir, "repo-"));
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      const rt = resolveRuntime(dir, sb.env);

      fs.writeFileSync(repoConfigPath(dir), serializeGatesConfig(true), "utf8");
      expect(resolveGates(rt, dir).effective).toBe("enabled");

      // kill switch global desliga o repo mesmo com repo enabled
      fs.mkdirSync(path.dirname(globalConfigPath(rt)), { recursive: true });
      fs.writeFileSync(globalConfigPath(rt), serializeGatesConfig(false), "utf8");
      expect(resolveGates(rt, dir).effective).toBe("disabled");

      // sem config nenhuma → absent
      fs.rmSync(repoConfigPath(dir), { force: true });
      fs.rmSync(globalConfigPath(rt), { force: true });
      expect(resolveGates(rt, dir).effective).toBe("absent");
    } finally {
      sb.cleanup();
    }
  });

  test("config ilegível → error apontando o arquivo (deny fail-closed)", () => {
    const sb = makeSandbox();
    try {
      const dir = fs.mkdtempSync(path.join(sb.dir, "repo-"));
      fs.mkdirSync(path.join(dir, ".runecraft"), { recursive: true });
      fs.writeFileSync(repoConfigPath(dir), "{ broken json", "utf8");
      const rt = resolveRuntime(dir, sb.env);
      const resolution = resolveGates(rt, dir);
      expect(resolution.error).toContain(repoConfigPath(dir));
      expect(resolution.error).toContain("JSON inválido");

      // global ilegível também nega
      fs.rmSync(repoConfigPath(dir), { force: true });
      fs.mkdirSync(path.dirname(globalConfigPath(rt)), { recursive: true });
      fs.writeFileSync(globalConfigPath(rt), "not json", "utf8");
      expect(resolveGates(rt, dir).error).toContain(globalConfigPath(rt));
    } finally {
      sb.cleanup();
    }
  });

  test("isGatesOnlyConfig: só keys conhecidas → true; estendido → false; ilegível (TOCTOU) → false", () => {
    const sb = makeSandbox();
    try {
      const file = path.join(sb.dir, "config.json");
      fs.writeFileSync(file, serializeGatesConfig(false), "utf8");
      expect(readGatesConfig(file).ok).toBe(true);
      expect(isGatesOnlyConfig(readGatesConfig(file))).toBe(true);
      fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, gates: { enabled: false }, minhas: 1 }, null, 2)}\n`, "utf8");
      expect(readGatesConfig(file).ok).toBe(true);
      expect((readGatesConfig(file).config?.gates.enabled)).toBe(false);
      expect(isGatesOnlyConfig(readGatesConfig(file))).toBe(false);
      // TOCTOU: config lida ok antes, mas o arquivo ficou ilegível entre a
      // leitura e o re-parse do uninstall → preservar (SETM-05 conservador).
      fs.writeFileSync(file, "not json", "utf8");
      expect(
        isGatesOnlyConfig({ file, absent: false, ok: true, config: { schemaVersion: 1, gates: { enabled: false } } }),
      ).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});

describe("gates/hook — shim POSIX (D4, fluxo 3)", () => {
  test("conteúdo exato do shim: RUNECRAFT_BIN > harness > npx; binário ausente → deny", () => {
    const body = gatesShimBody("pre-commit");
    expect(body).toContain(`if [ -n "$RUNECRAFT_BIN" ]; then`);
    expect(body).toContain(`exec "$RUNECRAFT_BIN" gates run pre-commit`);
    expect(body).toContain("exec harness gates run pre-commit");
    expect(body).toContain("exec npx --no-install @runecraft/harness gates run pre-commit");
    expect(body).toContain("harness não encontrado");
    expect(body).toContain("exit 1");
    // pre-push usa o mesmo shim com o nome do hook
    expect(gatesShimBody("pre-push")).toContain("gates run pre-push");
  });

  test("install cria com shebang, sem BOM, chmod +x; idempotente; pré-existente preservado", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f20-hook-"));
    try {
      const hooks = path.join(dir, ".git", "hooks");
      const install = installGatesHooks(hooks);
      expect(install.created).toHaveLength(2);
      for (const name of HOOK_NAMES) {
        const file = path.join(hooks, name);
        const raw = fs.readFileSync(file);
        expect(raw[0]).not.toBe(0xef); // sem BOM antes do shebang
        const content = raw.toString("utf8");
        expect(content.startsWith("#!/bin/sh")).toBe(true);
        expect(content).toContain("# BEGIN runecraft:gates");
        expect(content).toContain("# END runecraft:gates");
        expect(fs.statSync(file).mode & 0o111).not.toBe(0); // chmod +x
        expect(hasGatesSection(file)).toBe(true);
      }
      // idempotente: rerun sem escrever
      const rerun = installGatesHooks(hooks);
      expect(rerun.written).toHaveLength(0);
      expect(rerun.unchanged).toHaveLength(2);

      // hook pré-existente: conteúdo do usuário preservado após install+remove
      const preCommit = path.join(hooks, "pre-commit");
      const user = "#!/bin/sh\necho \"meu hook\"\n";
      fs.writeFileSync(preCommit, user, "utf8");
      installGatesHooks(hooks);
      expect(fs.readFileSync(preCommit, "utf8")).toContain("meu hook");
      const removed = removeGatesHooks(hooks, []);
      expect(removed.removed).toContain(preCommit);
      expect(fs.readFileSync(preCommit, "utf8")).toBe(user);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("hook criado do zero com só shebang é removido inteiro (createdFiles / shebang-only)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f20-hook2-"));
    try {
      const hooks = path.join(dir, ".git", "hooks");
      const install = installGatesHooks(hooks);
      expect(install.created).toHaveLength(2);
      const removed = removeGatesHooks(hooks, install.created); // createdFiles conhecidos
      expect(removed.deleted).toHaveLength(2);
      for (const name of HOOK_NAMES) expect(fs.existsSync(path.join(hooks, name))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gates enable — fluxo 3 (config + hooks + .gitignore + state + backup)", () => {
  test("enable escreve config, instala hooks, garante .gitignore e registra no state", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["gates", "enable"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      // config
      const config = readJson(repoConfigPath(repo.dir));
      expect((config as { gates: { enabled: boolean } }).gates.enabled).toBe(true);
      // hooks
      for (const name of HOOK_NAMES) {
        const file = path.join(hooksDirFor(repo.dir), name);
        expect(fs.existsSync(file)).toBe(true);
        expect(hasGatesSection(file)).toBe(true);
        expect((fs.statSync(file).mode & 0o111)).not.toBe(0);
      }
      // .gitignore com as linhas finas
      const ignore = fs.readFileSync(path.join(repo.dir, ".gitignore"), "utf8");
      expect(ignore).toContain(".runecraft/receipts/");
      expect(ignore).toContain(".runecraft/config.json");
      // state (workspace): createdFiles + settingsChanges
      const state = readJson(path.join(repo.dir, ".runecraft", "state.json")) as { createdFiles: string[]; settingsChanges: Array<{ path: string[] }> };
      expect(state.createdFiles.some((f) => f.endsWith("config.json"))).toBe(true);
      expect(state.createdFiles.some((f) => f.endsWith("pre-commit"))).toBe(true);
      expect(state.createdFiles.some((f) => f.endsWith(".gitignore"))).toBe(true);
      expect(state.settingsChanges.length).toBe(2);
      // backup pré-write existe
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "backups"))).toBe(true);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("enable dry-run: reporta sem escrever nada", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["gates", "enable", "--dry-run", "--json"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { dryRun: boolean; config: { file: string } };
      expect(json.dryRun).toBe(true);
      expect(fs.existsSync(json.config.file)).toBe(false);
      expect(fs.existsSync(path.join(hooksDirFor(repo.dir), "pre-commit"))).toBe(false);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("gates disable — kill switch (RCPT-07)", () => {
  test("default global escreve ~/.runecraft/config.json; --scope workspace escreve no repo", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const global = await runHarness(sb, ["gates", "disable", "--yes"], { cwd: repo.dir });
      expect(global.code).toBe(0);
      const globalConfig = readJson(path.join(sb.runecraftHome, "config.json"));
      expect((globalConfig as { gates: { enabled: boolean } }).gates.enabled).toBe(false);

      const ws = await runHarness(sb, ["gates", "disable", "--yes", "--scope", "workspace"], { cwd: repo.dir });
      expect(ws.code).toBe(0);
      const repoConfig = readJson(repoConfigPath(repo.dir));
      expect((repoConfig as { gates: { enabled: boolean } }).gates.enabled).toBe(false);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("TTY: prompt default N aborta; y confirma; --yes pula", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const no = await runHarness(sb, ["gates", "disable"], { cwd: repo.dir, isTTY: true, stdin: stdinFrom("n\n") });
      expect(no.code).not.toBe(0);
      expect(fs.existsSync(path.join(sb.runecraftHome, "config.json"))).toBe(false);

      const yes = await runHarness(sb, ["gates", "disable"], { cwd: repo.dir, isTTY: true, stdin: stdinFrom("y\n") });
      expect(yes.code).toBe(0);
      expect(fs.existsSync(path.join(sb.runecraftHome, "config.json"))).toBe(true);

      const flagged = await runHarness(sb, ["gates", "disable", "--yes"], { cwd: repo.dir });
      expect(flagged.code).toBe(0);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("dry-run: reporta sem escrever", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["gates", "disable", "--dry-run", "--json", "--yes"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      expect(fs.existsSync(path.join(sb.runecraftHome, "config.json"))).toBe(false);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("gates run pre-commit (RCPT-05; fluxo 4)", () => {
  test("sem config → deny fail-closed", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("config de gates ausente");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("kill switch global → exit 0 disabled/unmanaged (nunca fabrica aprovação)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["gates", "disable", "--yes"], { cwd: repo.dir });
      enableAndReceipt(repo); // receipt existe mas gates off → não valida
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("disabled/unmanaged");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("habilitado sem dir de receipts → deny 'receipts não encontrados' + doctor (edge spec)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const config = repoConfigPath(repo.dir);
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, serializeGatesConfig(true), "utf8");
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("receipts não encontrados");
      expect(result.stderr).toContain("harness doctor");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("habilitado com dir de receipts vazio → deny 'rode /pr-review'", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const config = repoConfigPath(repo.dir);
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, serializeGatesConfig(true), "utf8");
      fs.mkdirSync(path.join(repo.dir, ".runecraft", "receipts"), { recursive: true });
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("rode /pr-review");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("exact: receipt cobre o index → passa", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pass (exact)");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("drift: mudança staged depois do review → nega com mensagem de drift", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      fs.appendFileSync(path.join(repo.dir, "feature.txt"), "mudou\n");
      git(repo.dir, "add", "feature.txt");
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("drift");
      expect(result.stderr).toContain("esperado");
      expect(result.stderr).toContain("obtido");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("working tree sujo mas index limpo → passa (projeção staged)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      fs.appendFileSync(path.join(repo.dir, "feature.txt"), "sujo, fora do index\n");
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).toBe(0); // o workspace sujo é ignorado por construção
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("receipt corrompido → nega apontando o arquivo", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const config = repoConfigPath(repo.dir);
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, serializeGatesConfig(true), "utf8");
      const receipts = path.join(repo.dir, ".runecraft", "receipts");
      fs.mkdirSync(receipts, { recursive: true });
      fs.writeFileSync(path.join(receipts, "20260805-090000-000.json"), "{broken", "utf8");
      const result = await runHarness(sb, ["gates", "run", "pre-commit"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("receipt corrompido");
      expect(result.stderr).toContain("20260805-090000-000.json");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("gates run pre-push (RCPT-06; fluxo 4)", () => {
  test("parsePrePushRefs: tags e deleções são puladas; refs/heads validadas", () => {
    const refs = parsePrePushRefs(
      [
        `refs/tags/v1 ${"a".repeat(40)} refs/tags/v1 ${"a".repeat(40)}`,
        `refs/heads/feature ${"0".repeat(40)} refs/heads/feature ${"b".repeat(40)}`,
        `refs/heads/feature ${"c".repeat(40)} refs/heads/feature ${"d".repeat(40)}`,
        "linha malformada",
      ].join("\n"),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.localRef).toBe("refs/heads/feature");
    expect(refs[0]?.localSha).toBe("c".repeat(40));
  });

  test("só tags/deleções → nada a validar, exit 0", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      const refs = `refs/tags/v1 ${repo.headSha} refs/tags/v1 ${repo.headSha}\nrefs/heads/feature ${"0".repeat(40)} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nenhuma refs/heads/*");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("exact: push do head revisado → passa", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      const refs = `refs/heads/feature ${repo.headSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pass (exact)");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("compatible_base_advance: base avançou + amend sem mudança de conteúdo → passa com aviso", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      // base avança
      git(repo.dir, "checkout", "-q", "main");
      fs.writeFileSync(path.join(repo.dir, "main2.txt"), "main2\n");
      git(repo.dir, "add", "main2.txt");
      git(repo.dir, "commit", "-q", "-m", "main2");
      const main2 = git(repo.dir, "rev-parse", "HEAD");
      git(repo.dir, "update-ref", "refs/remotes/origin/main", main2);
      // feature: amend da mensagem (mesma árvore)
      git(repo.dir, "checkout", "-q", "feature");
      git(repo.dir, "commit", "-q", "--amend", "-m", "feature amended");
      const localSha = git(repo.dir, "rev-parse", "HEAD");
      expect(localSha).not.toBe(repo.headSha);
      const refs = `refs/heads/feature ${localSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("compatible_base_advance");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("changed: arquivo novo no push → nega", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      fs.writeFileSync(path.join(repo.dir, "extra.txt"), "extra\n");
      git(repo.dir, "add", "extra.txt");
      git(repo.dir, "commit", "-q", "-m", "extra");
      const localSha = git(repo.dir, "rev-parse", "HEAD");
      const refs = `refs/heads/feature ${localSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("changed");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("unrelated: rebase sobre base avançado → merge-base mudou, nega", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      git(repo.dir, "checkout", "-q", "main");
      fs.writeFileSync(path.join(repo.dir, "main2.txt"), "main2\n");
      git(repo.dir, "add", "main2.txt");
      git(repo.dir, "commit", "-q", "-m", "main2");
      const main2 = git(repo.dir, "rev-parse", "HEAD");
      git(repo.dir, "update-ref", "refs/remotes/origin/main", main2);
      git(repo.dir, "checkout", "-q", "feature");
      git(repo.dir, "rebase", "-q", main2);
      const localSha = git(repo.dir, "rev-parse", "HEAD");
      const refs = `refs/heads/feature ${localSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("unrelated");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("duas refs: uma passa, outra nega → push negado (um falhou = nega)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      // extra.txt quebra o diff agregado da segunda ref
      fs.writeFileSync(path.join(repo.dir, "extra.txt"), "extra\n");
      git(repo.dir, "add", "extra.txt");
      git(repo.dir, "commit", "-q", "-m", "extra");
      const changedSha = git(repo.dir, "rev-parse", "HEAD");
      const refs =
        `refs/heads/feature ${repo.headSha} refs/heads/feature ${repo.headSha}\n` +
        `refs/heads/feature ${changedSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).not.toBe(0);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("ambiguous: ref remota do base ausente → nega com hint de fetch", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      // amend para localSha ≠ headSha (o caminho compatible usa a ref remota)
      git(repo.dir, "commit", "-q", "--amend", "-m", "feature amended");
      const localSha = git(repo.dir, "rev-parse", "HEAD");
      git(repo.dir, "update-ref", "-d", "refs/remotes/origin/main");
      const refs = `refs/heads/feature ${localSha} refs/heads/feature ${repo.headSha}\n`;
      const result = await runHarness(sb, ["gates", "run", "pre-push"], { cwd: repo.dir, stdin: stdinFrom(refs) });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("git fetch");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("uninstall — limpeza de gates (RCPT-08; fluxo 5)", () => {
  test("hooks removidos (pré-existente preservado; criado por nós removido); config/.gitignore limpos; receipts preservados", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      // hook pré-existente do usuário
      const hooks = hooksDirFor(repo.dir);
      fs.mkdirSync(hooks, { recursive: true });
      const userHook = "#!/bin/sh\necho \"meu hook pré-existente\"\n";
      fs.writeFileSync(path.join(hooks, "pre-commit"), userHook, "utf8");
      // .gitignore pré-existente do usuário (não criado por nós → linhas limpas, arquivo preservado)
      fs.writeFileSync(path.join(repo.dir, ".gitignore"), "node_modules/\n", "utf8");
      await runHarness(sb, ["gates", "enable"], { cwd: repo.dir });
      // receipt para verificar preservação
      writeReceipt(repo.dir, receiptFor(repo));

      const result = await runHarness(sb, ["uninstall", "--all", "--yes"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      // pre-commit volta ao conteúdo do usuário (sem seção runecraft:)
      const preCommit = fs.readFileSync(path.join(hooks, "pre-commit"), "utf8");
      expect(preCommit).toBe(userHook);
      // pre-push criado por nós → removido inteiro
      expect(fs.existsSync(path.join(hooks, "pre-push"))).toBe(false);
      // config removido
      expect(fs.existsSync(repoConfigPath(repo.dir))).toBe(false);
      // .gitignore pré-existente preservado, linhas de gates limpas (SETM-05)
      expect(fs.existsSync(path.join(repo.dir, ".gitignore"))).toBe(true);
      const ignore = fs.readFileSync(path.join(repo.dir, ".gitignore"), "utf8");
      expect(ignore).toContain("node_modules/");
      for (const line of GITIGNORE_LINES) expect(ignore).not.toContain(line);
      // receipts preservados (RCPT-08 AC 4.3)
      const receipts = fs.readdirSync(path.join(repo.dir, ".runecraft", "receipts")).filter((f) => f.endsWith(".json"));
      expect(receipts).toHaveLength(1);
      expect(result.stdout).toContain("receipts preservados");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("uninstall global remove o kill switch (~/.runecraft/config.json)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["gates", "disable", "--yes"], { cwd: repo.dir });
      expect(fs.existsSync(path.join(sb.runecraftHome, "config.json"))).toBe(true);
      const result = await runHarness(sb, ["uninstall", "--all", "--yes", "--scope", "global"], { cwd: sb.dir });
      expect(result.code).toBe(0);
      expect(fs.existsSync(path.join(sb.runecraftHome, "config.json"))).toBe(false);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("doctor — check 17 Gates (fluxo 5)", () => {
  test("habilitado sem hook → warn com remedy gates enable", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      const config = repoConfigPath(repo.dir);
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, serializeGatesConfig(true), "utf8");
      const result = await runHarness(sb, ["doctor"], { cwd: repo.dir });
      expect(result.stdout).toContain("[17] Gates");
      expect(result.stdout).toContain("warn");
      expect(result.stdout).toContain("harness gates enable");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("receipt corrompido → fail apontando o arquivo", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      enableAndReceipt(repo);
      fs.writeFileSync(path.join(repo.dir, ".runecraft", "receipts", "20260805-090000-000.json"), "{broken", "utf8");
      const result = await runHarness(sb, ["doctor"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stdout).toContain("[17] Gates");
      expect(result.stdout).toContain("FAIL");
      expect(result.stdout).toContain("receipt corrompido");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("kill switch global ativo → pass (info)", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["gates", "disable", "--yes"], { cwd: repo.dir });
      const result = await runHarness(sb, ["doctor"], { cwd: repo.dir });
      expect(result.stdout).toContain("[17] Gates");
      expect(result.stdout).toContain("kill switch global");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });

  test("habilitado com hooks → pass", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["gates", "enable"], { cwd: repo.dir });
      const result = await runHarness(sb, ["doctor"], { cwd: repo.dir });
      expect(result.stdout).toContain("[17] Gates");
      expect(result.stdout).toContain("pass");
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});

describe("status — seção Gates (F20)", () => {
  test("TTY mostra effective + hooks + receipts; --json expõe gates", async () => {
    const repo = initReviewRepo();
    const sb = makeSandbox();
    try {
      await runHarness(sb, ["gates", "enable"], { cwd: repo.dir });
      writeReceipt(repo.dir, receiptFor(repo));
      const tty = await runHarness(sb, ["status"], { cwd: repo.dir });
      expect(tty.stdout).toContain("Gates (F20)");
      expect(tty.stdout).toContain("effective: enabled");
      expect(tty.stdout).toContain("receipts: 1");

      const jsonResult = await runHarness(sb, ["status", "--json"], { cwd: repo.dir });
      const json = JSON.parse(jsonResult.stdout) as {
        gates: { effective: string; hooks: { preCommit: { section: boolean }; prePush: { section: boolean } }; receipts: { count: number } };
      };
      expect(json.gates.effective).toBe("enabled");
      expect(json.gates.hooks.preCommit.section).toBe(true);
      expect(json.gates.hooks.prePush.section).toBe(true);
      expect(json.gates.receipts.count).toBe(1);
    } finally {
      sb.cleanup();
      repo.cleanup();
    }
  });
});
