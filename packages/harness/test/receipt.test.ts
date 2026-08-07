// receipt.test.ts — F20: receipt leve (RCPT-01..04; D1/D2/D5/D6/D7).
//
// Cobre: schema estrito (RCPT-04 — campos extras rejeitados, regex, ISO),
// store (escrita atômica, nome do issuedAt, colisão, scan), capture via RPC
// com fake pi (approve → receipt com diff_hash correto derivado do git real;
// request_changes/P0/P1 → sem receipt exit ≠ 0; pi com exit ≠ 0 → sem
// receipt; PR fechado sem --include-closed → recusa), fluxo manual `--from`
// (zero re-review) e `receipt list [--json]`. O diff_hash esperado é
// calculado de forma independente no teste (spec: Independent Test).
import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeSandbox, readJson, runHarness, type Sandbox } from "./helpers.ts";
import { FIXTURES_DIR } from "./helpers.ts";
import { diffHash, initReviewRepo, p0Finding, p1Finding, reviewFixture, type TestRepo } from "./gitrepo.ts";
import { validateReceipt } from "../src/receipt/schema.ts";
import { writeReceipt, scanReceipts, receiptNameFromIssuedAt } from "../src/receipt/store.ts";
import { validateReview, reviewBlocksReceipt } from "../src/receipt/review.ts";
import type { Receipt } from "../src/receipt/schema.ts";

const FAKE_PI_REVIEW = path.join(FIXTURES_DIR, "fake-pi-review.mjs");
const FAKE_GH = path.join(FIXTURES_DIR, "fake-gh.mjs");

function validReceipt(opts: Partial<Receipt> = {}): Receipt {
  return {
    schema: "runecraft.receipt/v1",
    candidate: {
      head_sha: "a".repeat(40),
      diff_hash: "b".repeat(64),
      base: { sha: "c".repeat(40), ref: "main", remote: "origin" },
    },
    verdict: "approve",
    reviewHash: "d".repeat(64),
    issuedAt: "2026-08-05T14:03:22.123Z",
    ...opts,
  };
}

function reviewHashOf(reviewText: string): string {
  return crypto.createHash("sha256").update(reviewText).digest("hex");
}

/** Sandbox com fake pi (review) + fake gh já configurados. */
function sandboxForCapture(repo: TestRepo, reviewJson: string): Sandbox & { log: string } {
  const sb = makeSandbox();
  sb.env.RUNECRAFT_PI_BIN = FAKE_PI_REVIEW;
  sb.env.RUNECRAFT_GH_BIN = FAKE_GH;
  sb.env.FAKE_GH_HEAD = repo.headSha;
  sb.env.FAKE_GH_PR = "42";
  sb.env.FAKE_REVIEW_JSON = reviewJson;
  const log = path.join(sb.dir, "pi-review-log.json");
  sb.env.FAKE_REVIEW_LOG = log;
  return Object.assign(sb, { log });
}

describe("receipt/schema — validação estrita (RCPT-04)", () => {
  test("receipt válido passa", () => {
    const result = validateReceipt(validReceipt());
    expect(result.error).toBeUndefined();
    expect(result.receipt?.schema).toBe("runecraft.receipt/v1");
    expect(result.receipt?.verdict).toBe("approve");
  });

  test("campos extras em qualquer nível são rejeitados (fail-closed)", () => {
    const base = validReceipt().candidate.base;
    expect(validateReceipt({ ...validReceipt(), extra: 1 } as unknown as Receipt).error).toContain("campos extras");
    expect(
      validateReceipt({ ...validReceipt(), candidate: { ...validReceipt().candidate, x: 1 } } as unknown as Receipt).error,
    ).toContain("campos extras");
    expect(
      validateReceipt({ ...validReceipt(), candidate: { ...validReceipt().candidate, base: { ...base, y: 2 } } } as unknown as Receipt)
        .error,
    ).toContain("campos extras");
  });

  test("regex: head_sha (40 ou 64 hex), diff_hash/reviewHash 64 hex, base.sha hex", () => {
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, head_sha: "z".repeat(40) } })).error).toContain("head_sha");
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, head_sha: "a".repeat(39) } })).error).toContain("head_sha");
    // sha256 repos: 64 hex aceito
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, head_sha: "a".repeat(64) } })).error).toBeUndefined();
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, diff_hash: "b".repeat(63) } })).error).toContain("diff_hash");
    expect(validateReceipt(validReceipt({ reviewHash: "d".repeat(63) })).error).toContain("reviewHash");
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, base: { ...validReceipt().candidate.base, sha: "c".repeat(39) } } })).error).toContain("base.sha");
  });

  test("base.ref/base.remote sem whitespace; verdict approve; issuedAt ISO parseável", () => {
    const base = validReceipt().candidate.base;
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, base: { ...base, ref: "my branch" } } })).error).toContain("base.ref");
    expect(validateReceipt(validReceipt({ candidate: { ...validReceipt().candidate, base: { ...base, remote: "origin " } } })).error).toContain("base.remote");
    expect(validateReceipt(validReceipt({ verdict: "request_changes" as never })).error).toContain("verdict");
    expect(validateReceipt(validReceipt({ issuedAt: "ontem" })).error).toContain("issuedAt");
    expect(validateReceipt(validReceipt({ issuedAt: "2026-13-45T99:00:00.000Z" })).error).toContain("issuedAt");
  });

  test("erro nomeia o arquivo e o campo", () => {
    const result = validateReceipt(validReceipt({ verdict: "comment" as never }), "/repo/.runecraft/receipts/20260805-140322-123.json");
    expect(result.error).toContain("/repo/.runecraft/receipts/20260805-140322-123.json");
    expect(result.error).toContain("verdict");
  });
});

describe("receipt/store — escrita atômica + scan (D6)", () => {
  test("nome do arquivo vem do issuedAt; colisão ganha sufixo -1/-2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f20-store-"));
    try {
      const receipt = validReceipt({ issuedAt: "2026-08-05T14:03:22.123Z" });
      const file1 = writeReceipt(dir, receipt);
      expect(path.basename(file1)).toBe("20260805-140322-123.json");
      const file2 = writeReceipt(dir, receipt);
      expect(path.basename(file2)).toBe("20260805-140322-123-1.json");
      const file3 = writeReceipt(dir, receipt);
      expect(path.basename(file3)).toBe("20260805-140322-123-2.json");
      expect(fs.existsSync(file3)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scan mais recente primeiro; corrompido → errorKind corrupt; schema-inválido → invalid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f20-scan-"));
    try {
      writeReceipt(dir, validReceipt({ issuedAt: "2026-08-05T10:00:00.000Z" }));
      writeReceipt(dir, validReceipt({ issuedAt: "2026-08-05T12:00:00.000Z" }));
      const receipts = path.join(dir, ".runecraft", "receipts");
      fs.writeFileSync(path.join(receipts, "20260805-090000-000.json"), "{not json", "utf8");
      fs.writeFileSync(path.join(receipts, "20260805-080000-000.json"), JSON.stringify({ schema: "runecraft.receipt/v1" }), "utf8");
      const scanned = scanReceipts(dir);
      expect(scanned).toHaveLength(4);
      // mais recente primeiro (nome do issuedAt)
      expect(path.basename(scanned[0]?.file ?? "")).toBe("20260805-120000-000.json");
      const corrupt = scanned.find((s) => path.basename(s.file) === "20260805-090000-000.json");
      expect(corrupt?.errorKind).toBe("corrupt");
      const invalid = scanned.find((s) => path.basename(s.file) === "20260805-080000-000.json");
      expect(invalid?.errorKind).toBe("invalid");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("receiptNameFromIssuedAt formata YYYYMMDD-HHmmss-SSS", () => {
    expect(receiptNameFromIssuedAt("2026-08-05T14:03:22.123Z")).toBe("20260805-140322-123");
  });
});

describe("receipt/review — validator estrito espelho (D7)", () => {
  test("review válido approve passa; reviewHash independe (teste do capture cobre)", () => {
    const text = reviewFixture({ headSha: "a".repeat(40) });
    const parsed = validateReview(text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.review?.verdict).toBe("approve");
    expect(parsed.review?.pr.head_sha).toBe("a".repeat(40));
  });

  test("fence markdown única é tolerada (paridade fork)", () => {
    const inner = reviewFixture({ headSha: "a".repeat(40) });
    const parsed = validateReview(`\`\`\`json\n${inner}\n\`\`\``);
    expect(parsed.error).toBeUndefined();
  });

  test("head_sha inválida, verdict inválido, finding com blocking inconsistente → erro", () => {
    expect(validateReview(JSON.stringify({ ...JSON.parse(reviewFixture({ headSha: "x" })), pr: { ...JSON.parse(reviewFixture({ headSha: "x" })).pr, head_sha: "zz" } })).error).toContain("head_sha");
    expect(validateReview(reviewFixture({ verdict: "wat" as never })).error).toContain("verdict");
    expect(
      validateReview(JSON.stringify({ ...JSON.parse(reviewFixture()), findings: [{ title: "t", body: "b", severity: "P1", blocking: false, confidence_score: 0.5 }] })).error,
    ).toContain("blocking");
  });

  test("reviewBlocksReceipt: request_changes/P0/P1 → bloqueia; approve sem P0/P1 → libera", () => {
    expect(reviewBlocksReceipt({ ...JSON.parse(reviewFixture({ verdict: "request_changes" })), findings: [] })).toContain("request_changes");
    expect(reviewBlocksReceipt({ ...JSON.parse(reviewFixture()), findings: [p0Finding()] })).toContain("P0");
    expect(reviewBlocksReceipt({ ...JSON.parse(reviewFixture()), findings: [p1Finding()] })).toContain("P1");
    expect(reviewBlocksReceipt({ ...JSON.parse(reviewFixture()), findings: [] })).toBeNull();
  });
});

describe("receipt capture — fluxo RPC com fake pi (RCPT-01..03)", () => {
  test("approve → receipt com diff_hash correto (Independent Test)", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha });
      const sb = sandboxForCapture(repo, reviewJson);
      const result = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      // diff_hash esperado, derivado de forma independente do git
      const expectedDiff = diffHash(repo.dir, repo.baseSha, repo.headSha);
      const files = fs.readdirSync(path.join(repo.dir, ".runecraft", "receipts")).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(1);
      const receipt = readJson(path.join(repo.dir, ".runecraft", "receipts", files[0] ?? "")) as unknown as Receipt;
      expect(receipt.candidate.head_sha).toBe(repo.headSha);
      expect(receipt.candidate.diff_hash).toBe(expectedDiff);
      expect(receipt.candidate.base.sha).toBe(repo.baseSha);
      expect(receipt.candidate.base.ref).toBe("main");
      expect(receipt.candidate.base.remote).toBe("origin");
      expect(receipt.verdict).toBe("approve");
      expect(receipt.reviewHash).toBe(reviewHashOf(reviewJson));
      expect(validateReceipt(receipt).error).toBeUndefined();
      // o fake pi foi invocado no formato validado (print/mode json + --no-comment)
      const log = readJson(sb.log) as { argv: string[] };
      expect(log.argv).toContain("--print");
      expect(log.argv).toContain("--mode");
      expect(log.argv).toContain("json");
      expect(log.argv).toContain("/pr-review");
      expect(log.argv).toContain("--no-comment");
    } finally {
      repo.cleanup();
    }
  });

  test("request_changes → sem receipt, exit ≠ 0", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha, verdict: "request_changes", findings: [p1Finding()] });
      const sb = sandboxForCapture(repo, reviewJson);
      const result = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "receipts"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  test("approve com finding P0 → sem receipt (D7 defensivo), exit ≠ 0", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha, findings: [p0Finding()] });
      const sb = sandboxForCapture(repo, reviewJson);
      const result = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("P0");
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "receipts"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  test("pi com exit ≠ 0 → sem receipt (exit code autoritativo)", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha });
      const sb = sandboxForCapture(repo, reviewJson);
      sb.env.FAKE_REVIEW_EXIT = "1";
      const result = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("pi /pr-review falhou");
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "receipts"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  test("PR fechado sem --include-closed → recusa; com flag → prossegue", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha });
      const sb = sandboxForCapture(repo, reviewJson);
      sb.env.FAKE_GH_STATE = "CLOSED";
      const refused = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(refused.code).not.toBe(0);
      expect(refused.stderr).toContain("--include-closed");
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "receipts"))).toBe(false);

      const sb2 = sandboxForCapture(repo, reviewJson);
      sb2.env.FAKE_GH_STATE = "CLOSED";
      const proceed = await runHarness(sb2, ["receipt", "capture", "42", "--include-closed"], { cwd: repo.dir });
      expect(proceed.code).toBe(0);
      const log = readJson(sb2.log) as { argv: string[] };
      expect(log.argv).toContain("--include-closed");
    } finally {
      repo.cleanup();
    }
  });

  test("gh falhou → sem receipt com mensagem", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha });
      const sb = sandboxForCapture(repo, reviewJson);
      sb.env.FAKE_GH_EXIT = "1";
      const result = await runHarness(sb, ["receipt", "capture", "42"], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("gh pr view falhou");
    } finally {
      repo.cleanup();
    }
  });
});

describe("receipt capture --from — fluxo manual (zero re-review, D2)", () => {
  test("review do TUI salvo em arquivo → receipt sem invocar o pi", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha });
      const reviewFile = path.join(repo.dir, "review.json");
      fs.writeFileSync(reviewFile, reviewJson, "utf8");
      const sb = makeSandbox();
      sb.env.RUNECRAFT_PI_BIN = path.join(sb.dir, "must-not-run-pi");
      sb.env.RUNECRAFT_GH_BIN = FAKE_GH;
      const result = await runHarness(sb, ["receipt", "capture", "42", "--from", reviewFile], { cwd: repo.dir });
      expect(result.code).toBe(0);
      const files = fs.readdirSync(path.join(repo.dir, ".runecraft", "receipts")).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(1);
      const receipt = readJson(path.join(repo.dir, ".runecraft", "receipts", files[0] ?? "")) as unknown as Receipt;
      expect(receipt.candidate.head_sha).toBe(repo.headSha);
      expect(receipt.candidate.diff_hash).toBe(diffHash(repo.dir, repo.baseSha, repo.headSha));
      expect(receipt.candidate.base.sha).toBe(repo.baseSha);
      expect(receipt.candidate.base.ref).toBe("main");
      expect(receipt.reviewHash).toBe(reviewHashOf(reviewJson));
    } finally {
      repo.cleanup();
    }
  });

  test("--from com request_changes → sem receipt, exit ≠ 0", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 42, headSha: repo.headSha, verdict: "request_changes", findings: [p1Finding()] });
      const reviewFile = path.join(repo.dir, "review.json");
      fs.writeFileSync(reviewFile, reviewJson, "utf8");
      const sb = makeSandbox();
      const result = await runHarness(sb, ["receipt", "capture", "42", "--from", reviewFile], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(fs.existsSync(path.join(repo.dir, ".runecraft", "receipts"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  test("--from com pr.number de outro PR → recusa", async () => {
    const repo = initReviewRepo();
    try {
      const reviewJson = reviewFixture({ pr: 7, headSha: repo.headSha });
      const reviewFile = path.join(repo.dir, "review.json");
      fs.writeFileSync(reviewFile, reviewJson, "utf8");
      const sb = makeSandbox();
      const result = await runHarness(sb, ["receipt", "capture", "42", "--from", reviewFile], { cwd: repo.dir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("pr.number");
    } finally {
      repo.cleanup();
    }
  });
});

describe("receipt list", () => {
  test("list --json: mais recente primeiro, erros por arquivo", async () => {
    const repo = initReviewRepo();
    try {
      const dir = repo.dir;
      writeReceipt(dir, {
        schema: "runecraft.receipt/v1",
        candidate: { head_sha: repo.headSha, diff_hash: "b".repeat(64), base: { sha: repo.baseSha, ref: "main", remote: "origin" } },
        verdict: "approve",
        reviewHash: "d".repeat(64),
        issuedAt: "2026-08-05T14:03:22.123Z",
      });
      const receipts = path.join(dir, ".runecraft", "receipts");
      fs.writeFileSync(path.join(receipts, "20260805-090000-000.json"), "not json", "utf8");
      const sb = makeSandbox();
      const result = await runHarness(sb, ["receipt", "list", "--json"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      const json = JSON.parse(result.stdout) as { receipts: Array<{ file: string; error?: string }> };
      expect(json.receipts).toHaveLength(2);
      expect(json.receipts[0]?.file).toContain("20260805-140322-123.json");
      expect(json.receipts[1]?.error).toContain("JSON inválido");
    } finally {
      repo.cleanup();
    }
  });

  test("list human: nenhum receipt → mensagem", async () => {
    const repo = initReviewRepo();
    try {
      const sb = makeSandbox();
      const result = await runHarness(sb, ["receipt", "list"], { cwd: repo.dir });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("nenhum receipt");
    } finally {
      repo.cleanup();
    }
  });
});
