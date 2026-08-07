// receipt/capture.ts — `harness receipt capture <pr>` (D2, fluxo 2) + list.
//
// Fluxo automático (RPC): gh pr view → base.sha = merge-base → cat-file do
// head/base (hint de fetch quando ausente) → Pi não-interativo `/pr-review`
// (pi.ts runPiReview — `--print --mode json`, validado no Execute) → valida o
// JSON do review com o validator estrito próprio (receipt/review.ts — espelho
// do parsePublishableReview, zero dependência do fork) → `approve` e sem
// P0/P1 → reviewHash = sha256(JSON.stringify(review)) (mesma fórmula do fork)
// + diff_hash = sha256(`git diff <base> <head> --binary --full-index
// --no-ext-diff --no-renames`) (D5) → escreve `.runecraft/receipts/<ts>.json`
// (escrita atômica — RCPT-01/04). Senão: SEM receipt, exit ≠ 0 (RCPT-03).
//
// Fluxo manual (--from <review.json>): zero re-review — o usuário rodou
// `/pr-review` no TUI e salvou o JSON; o CLI deriva head (pr.head_sha do
// review), base (refs/remotes/<remote>/HEAD, fallback <remote>/main) e
// diff_hash do git. `--include-closed` permite PR fechado (allowNonOpen).
//
// gh é invocado via RUNECRAFT_GH_BIN (testabilidade, padrão F21 D1).
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { currentRemote, hashGitDiff, mergeBase, runGit, sha256Hex } from "../gates/git.ts";
import type { Runtime, TextSink } from "../config.ts";
import { runPiReview } from "../pi.ts";
import { validateReview, reviewBlocksReceipt, type ReviewLike } from "./review.ts";
import { scanReceipts, writeReceipt, type ScannedReceipt } from "./store.ts";
import { validateReceipt, type Receipt } from "./schema.ts";

export interface CaptureOptions {
  rt: Runtime;
  /** repo root (dirname git-common-dir). */
  root: string;
  pr: number;
  /** `--from <review.json>` — manual flow, zero re-review. */
  fromFile?: string;
  includeClosed?: boolean;
  out: TextSink;
  err: TextSink;
  json: boolean;
}

export interface CaptureReport {
  ok: boolean;
  pr: number;
  file?: string;
  diffHash?: string;
  reviewHash?: string;
  verdict?: string;
  headSha?: string;
  baseSha?: string;
  baseRef?: string;
  remote?: string;
  error?: string;
}

function ghBin(env: NodeJS.ProcessEnv): string {
  return env.RUNECRAFT_GH_BIN?.trim() || "gh";
}

interface GhResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function runGh(env: NodeJS.ProcessEnv, cwd: string, args: string[]): GhResult {
  let res;
  try {
    res = spawnSync(ghBin(env), args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    return { ok: false, code: null, stdout: "", stderr: (error as Error).message };
  }
  return { ok: res.status === 0, code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

interface PrMetadata {
  number: number;
  headRefOid: string;
  baseRefName: string;
  state: string;
}

/** `gh pr view --json number,headRefOid,baseRefName,state` (fork parity). */
function fetchPrMetadata(env: NodeJS.ProcessEnv, root: string, pr: number): { metadata?: PrMetadata; error?: string } {
  const gh = runGh(env, root, ["pr", "view", String(pr), "--json", "number,headRefOid,baseRefName,state"]);
  if (!gh.ok) {
    return { error: `gh pr view falhou: ${gh.stderr.trim() || `exit ${gh.code ?? "?"}`}` };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(gh.stdout) as Record<string, unknown>;
  } catch {
    return { error: "gh pr view devolveu JSON inválido" };
  }
  if (
    !Number.isInteger(raw.number) ||
    Number(raw.number) !== pr ||
    typeof raw.headRefOid !== "string" ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(raw.headRefOid) ||
    typeof raw.baseRefName !== "string" ||
    raw.baseRefName.trim() === "" ||
    typeof raw.state !== "string"
  ) {
    return { error: "gh pr view omitiu campos obrigatórios (number/headRefOid/baseRefName/state)" };
  }
  return { metadata: { number: pr, headRefOid: raw.headRefOid, baseRefName: raw.baseRefName, state: raw.state } };
}

function commitExists(cwd: string, sha: string): boolean {
  return runGit(cwd, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

/** Derive base.ref for the manual flow: refs/remotes/<remote>/HEAD → short name. */
function deriveBaseRefFromRemote(root: string, remote: string): string | null {
  const sym = runGit(root, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
  if (sym.ok) {
    const ref = sym.stdout.trim();
    const match = /^refs\/remotes\/[^/]+\/(.+)$/.exec(ref);
    if (match?.[1]) return match[1];
  }
  const main = runGit(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/main`]);
  if (main.ok) return "main";
  return null;
}

/** Build the receipt payload from a validated review + git-derived evidence. */
function buildReceipt(
  review: ReviewLike,
  headSha: string,
  baseSha: string,
  baseRef: string,
  remote: string,
  diffHash: string,
): Receipt {
  return {
    schema: "runecraft.receipt/v1",
    candidate: { head_sha: headSha, diff_hash: diffHash, base: { sha: baseSha, ref: baseRef, remote } },
    verdict: "approve",
    reviewHash: sha256Hex(JSON.stringify(review)),
    issuedAt: new Date().toISOString(),
  };
}

async function captureWithReview(
  opts: CaptureOptions,
  review: ReviewLike,
  headSha: string,
  baseSha: string,
  baseRef: string,
  remote: string,
): Promise<CaptureReport> {
  const diff = await hashGitDiff(opts.root, [baseSha, headSha]);
  if (!diff.ok) {
    return { ok: false, pr: opts.pr, error: `git diff ${baseSha.slice(0, 8)}..${headSha.slice(0, 8)} falhou: ${diff.stderr.trim() || "exit não-zero"}` };
  }
  const receipt = buildReceipt(review, headSha, baseSha, baseRef, remote, diff.hash);
  // RCPT-04: nunca persiste um receipt que o schema estrito rejeite.
  const validated = validateReceipt(receipt);
  if (!validated.receipt) {
    return { ok: false, pr: opts.pr, error: `receipt não passou no schema estrito — ${validated.error}` };
  }
  const file = writeReceipt(opts.root, receipt);
  return {
    ok: true,
    pr: opts.pr,
    file,
    diffHash: diff.hash,
    reviewHash: receipt.reviewHash,
    verdict: "approve",
    headSha,
    baseSha,
    baseRef,
    remote,
  };
}

/** RPC flow: gh → merge-base → cat-file → Pi /pr-review → validator → receipt. */
async function captureRpc(opts: CaptureOptions): Promise<CaptureReport> {
  const env = opts.rt.env;
  const { metadata, error } = fetchPrMetadata(env, opts.root, opts.pr);
  if (error || !metadata) return { ok: false, pr: opts.pr, error: error ?? "metadata indisponível" };
  if (metadata.state !== "OPEN" && !opts.includeClosed) {
    return {
      ok: false,
      pr: opts.pr,
      error: `PR #${opts.pr} está ${metadata.state} — fechado; rode com --include-closed para revisar mesmo assim (o review roda completo, sem receita de abertura)`,
    };
  }
  const remote = currentRemote(opts.root);
  const baseSha = mergeBase(opts.root, `refs/remotes/${remote}/${metadata.baseRefName}`, metadata.headRefOid);
  if (baseSha === null) {
    return {
      ok: false,
      pr: opts.pr,
      error: `merge-base não resolvível (refs/remotes/${remote}/${metadata.baseRefName} ou head ausente) — rode: git fetch ${remote} ${metadata.baseRefName} ${metadata.headRefOid}`,
    };
  }
  if (!commitExists(opts.root, metadata.headRefOid)) {
    return { ok: false, pr: opts.pr, error: `head_sha ${metadata.headRefOid.slice(0, 8)} não presente localmente — rode: git fetch ${remote} ${metadata.headRefOid}` };
  }
  if (!commitExists(opts.root, baseSha)) {
    return { ok: false, pr: opts.pr, error: `base.sha ${baseSha.slice(0, 8)} não presente localmente — rode: git fetch ${remote} ${metadata.baseRefName}` };
  }

  const reviewRun = await runPiReview(opts.rt, { pr: opts.pr, includeClosed: opts.includeClosed, cwd: opts.root });
  if (!reviewRun.ok || reviewRun.code !== 0) {
    const detail = reviewRun.stderr.trim() || `exit code ${reviewRun.code ?? "?"}`;
    return { ok: false, pr: opts.pr, error: `pi /pr-review falhou — ${detail}` };
  }
  if (reviewRun.reviewText.trim() === "") {
    return { ok: false, pr: opts.pr, error: "pi /pr-review terminou sem mensagem final (sem review JSON) — rode no TUI e use --from" };
  }
  const parsed = validateReview(reviewRun.reviewText);
  if (parsed.error || !parsed.review) {
    return { ok: false, pr: opts.pr, error: `review inválido: ${parsed.error}` };
  }
  const blocked = reviewBlocksReceipt(parsed.review);
  if (blocked) return { ok: false, pr: opts.pr, error: blocked };

  return captureWithReview(opts, parsed.review, metadata.headRefOid, baseSha, metadata.baseRefName, remote);
}

/** Manual flow (--from): no re-review; head/base/diff_hash derived from git. */
async function captureFromFile(opts: CaptureOptions): Promise<CaptureReport> {
  const fromFile = opts.fromFile;
  if (!fromFile) return { ok: false, pr: opts.pr, error: "--from requer um arquivo de review" };
  let text: string;
  try {
    text = fs.readFileSync(fromFile, "utf8");
  } catch (error) {
    return { ok: false, pr: opts.pr, error: `não consegui ler --from ${fromFile}: ${(error as Error).message}` };
  }
  const parsed = validateReview(text);
  if (parsed.error || !parsed.review) return { ok: false, pr: opts.pr, error: `review inválido: ${parsed.error}` };
  if (parsed.review.pr.number !== opts.pr) {
    return { ok: false, pr: opts.pr, error: `review.pr.number ${parsed.review.pr.number} ≠ ${opts.pr} (o arquivo é de outro PR)` };
  }
  const blocked = reviewBlocksReceipt(parsed.review);
  if (blocked) return { ok: false, pr: opts.pr, error: blocked };

  const headSha = parsed.review.pr.head_sha;
  if (!commitExists(opts.root, headSha)) {
    return { ok: false, pr: opts.pr, error: `head_sha ${headSha.slice(0, 8)} não presente localmente — rode: git fetch origin ${headSha}` };
  }
  const remote = currentRemote(opts.root);
  const baseRef = deriveBaseRefFromRemote(opts.root, remote);
  if (baseRef === null) {
    return {
      ok: false,
      pr: opts.pr,
      error: `não consegui derivar a base do PR (refs/remotes/${remote}/HEAD e refs/remotes/${remote}/main ausentes) — use o fluxo RPC: harness receipt capture ${opts.pr}`,
    };
  }
  const baseSha = mergeBase(opts.root, `refs/remotes/${remote}/${baseRef}`, headSha);
  if (baseSha === null) {
    return { ok: false, pr: opts.pr, error: `merge-base não resolvível — rode: git fetch ${remote} ${baseRef} ${headSha}` };
  }
  return captureWithReview(opts, parsed.review, headSha, baseSha, baseRef, remote);
}

/** Entry: `harness receipt capture <pr> [--from <file>] [--include-closed]`. */
export async function runReceiptCapture(opts: CaptureOptions): Promise<number> {
  const report = opts.fromFile ? await captureFromFile(opts) : await captureRpc(opts);
  if (report.ok && report.file) {
    if (opts.json) {
      opts.out.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      opts.out.write(
        `@runecraft/harness receipt: receipt emitido — ${report.file}\n` +
          `  candidate: head ${report.headSha?.slice(0, 8)} · base ${report.baseSha?.slice(0, 8)} (${report.baseRef}@${report.remote}) · diff_hash ${report.diffHash?.slice(0, 8)}…\n` +
          `  reviewHash: ${report.reviewHash?.slice(0, 8)}… · verdict approve (sem P0/P1)\n`,
      );
    }
    return 0;
  }
  const message = `@runecraft/harness receipt: NENHUM receipt emitido — ${report.error ?? "falha desconhecida"}`;
  if (opts.json) {
    opts.out.write(`${JSON.stringify({ ok: false, pr: opts.pr, error: report.error ?? "falha desconhecida" }, null, 2)}\n`);
  } else {
    opts.err.write(`${message}\n`);
  }
  return 1;
}

export interface ReceiptListEntry {
  file: string;
  issuedAt?: string;
  headSha?: string;
  diffHash?: string;
  baseSha?: string;
  baseRef?: string;
  remote?: string;
  reviewHash?: string;
  error?: string;
  errorKind?: "corrupt" | "invalid";
}

/** `harness receipt list [--json]` — newest first, per-file errors surfaced. */
export function listReceipts(root: string, json: boolean, out: TextSink): number {
  const scanned: ScannedReceipt[] = scanReceipts(root);
  const entries: ReceiptListEntry[] = scanned.map((s) => {
    if (s.error || !s.receipt) {
      return { file: s.file, error: s.error ?? "inválido", errorKind: s.errorKind };
    }
    return {
      file: s.file,
      issuedAt: s.receipt.issuedAt,
      headSha: s.receipt.candidate.head_sha,
      diffHash: s.receipt.candidate.diff_hash,
      baseSha: s.receipt.candidate.base.sha,
      baseRef: s.receipt.candidate.base.ref,
      remote: s.receipt.candidate.base.remote,
      reviewHash: s.receipt.reviewHash,
    };
  });
  if (json) {
    out.write(`${JSON.stringify({ root, receipts: entries }, null, 2)}\n`);
    return 0;
  }
  const lines = [`@runecraft/harness receipt list (${root})`];
  if (entries.length === 0) lines.push("nenhum receipt encontrado — rode `harness receipt capture <pr>`");
  for (const entry of entries) {
    if (entry.error) {
      lines.push(`  ✗ ${entry.file} — ${entry.error}`);
    } else {
      lines.push(
        `  ${entry.issuedAt}  head ${entry.headSha?.slice(0, 8)}  base ${entry.baseRef}@${entry.remote}  diff_hash ${entry.diffHash?.slice(0, 8)}…`,
      );
    }
  }
  out.write(`${lines.join("\n")}\n`);
  return 0;
}
