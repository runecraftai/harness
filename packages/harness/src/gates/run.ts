// gates/run.ts — `harness gates run pre-commit|pre-push` (D4).
//
// The hook shim (hook.ts) delegates here; every decision lives in this TS
// layer. Flow (design fluxo 3/4):
//   root = dirname(git-common-dir)  → configs repo/global + effective
//   config ausente                  → deny fail-closed (hook presente implica enable)
//   config ilegível                 → deny apontando o arquivo
//   disabled (kill switch repo/global) → exit 0 "disabled/unmanaged" (nunca fabrica aprovação)
//   enabled                         → scan receipts (corrompido → deny no arquivo)
//                                   → álgebra: receipts do mais recente ao mais antigo,
//                                     primeiro match (exact/compatible) vence
//                                   → sem match → deny com "o quê falhou + o que fazer"
//
// pre-commit compares ONLY the staged index (projeção staged — index materializado
// via `git write-tree` para paridade de bytes com a captura, validado no Execute);
// pre-push reads the refs from stdin (`<local_ref> <local_sha> <remote_ref> <remote_sha>`
// per line): tags → skip, deletions → skip, refs/heads/* → validate ALL (one
// failure denies the push).
import * as fs from "node:fs";
import type { Runtime, TextSink } from "../config.ts";
import type { Receipt } from "../receipt/schema.ts";
import { receiptsDir, scanReceipts, type ScannedReceipt } from "../receipt/store.ts";
import { comparePreCommit, comparePrePush, failurePriority, type PreCommitResult, type PrePushResult } from "./compare.ts";
import { resolveGates, type GatesResolution } from "./config.ts";
import { DIFF_WARN_BYTES, repoRoot } from "./git.ts";

export type GateHookName = "pre-commit" | "pre-push";

export interface GatesRunOptions {
  rt: Runtime;
  hook: GateHookName;
  /** pre-push: content of stdin (refs to validate). pre-commit ignores it. */
  stdinText?: string;
  out: TextSink;
  err: TextSink;
}

/** How many bytes of diff we warn about (design Riscos: > 50 MB). */
export const GATES_DIFF_WARN_BYTES = DIFF_WARN_BYTES;

function hash8(sha: string): string {
  return sha.slice(0, 8);
}

function deny(err: TextSink, message: string): number {
  err.write(`runecraft gates: ${message}\n`);
  return 1;
}

function pass(out: TextSink, message: string): number {
  out.write(`runecraft gates: ${message}\n`);
  return 0;
}

function warnLargeDiff(err: TextSink, bytes: number, hook: GateHookName): void {
  if (bytes > GATES_DIFF_WARN_BYTES) {
    err.write(
      `runecraft gates: warn — diff de ${(bytes / (1024 * 1024)).toFixed(1)} MB (${hook}); o hash consumiu tempo/memória além do threshold (50 MB)\n`,
    );
  }
}

export interface StdinRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/** Parse pre-push stdin: tags skip, deletions (zero sha) skip, refs/heads validate. */
export function parsePrePushRefs(stdinText: string): StdinRef[] {
  const refs: StdinRef[] = [];
  for (const rawLine of stdinText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const fields = line.split(/\s+/);
    if (fields.length < 4) continue; // malformed line — ignored (git always writes 4)
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (!localRef || !localSha) continue;
    if (localRef.startsWith("refs/tags/")) continue; // v1: sem conceito de receipt de tag (documentado)
    if (/^0+$/.test(localSha)) continue; // deleção
    if (!localRef.startsWith("refs/heads/")) continue; // v1 valida apenas refs/heads/*
    refs.push({ localRef, localSha, remoteRef: remoteRef ?? "", remoteSha: remoteSha ?? "" });
  }
  return refs;
}

interface BestFailure {
  priority: number;
  message: string;
}

function failureMessage(
  hook: GateHookName,
  file: string,
  result: PreCommitResult | PrePushResult,
): string {
  const expected = result.expectedHash ? hash8(result.expectedHash) : "?";
  const obtained = result.obtainedHash ? hash8(result.obtainedHash) : "?";
  switch (result.relation) {
    case "ambiguous":
      return `estado ambíguo (${result.detail ?? "informação de git indisponível"}) — fail-closed, nenhuma aprovação fabricada`;
    case "unrelated":
      return `unrelated — ${result.detail ?? "merge-base mudou"} — o conteúdo não foi revisado; rode /pr-review de novo (ou \`harness gates disable\` para bypass consciente)`;
    case "changed":
      return `changed — ${result.detail ?? "conteúdo do diff mudou"} — o conteúdo não foi revisado; rode /pr-review de novo (ou \`harness gates disable\` para bypass consciente)`;
    case "drift":
      return `drift — o diff atual difere do receipt ${file} (esperado ${expected}, obtido ${obtained}); rode /pr-review de novo (ou \`harness gates disable\` para bypass consciente)`;
    default:
      return `nenhum receipt cobre o diff do ${hook === "pre-commit" ? "index" : "push"} — rode /pr-review (ou review equivalente) antes de commitar (ou: harness gates disable para bypass consciente)`;
  }
}

async function validateEnabled(
  hook: GateHookName,
  root: string,
  scanned: ScannedReceipt[],
  stdinText: string | undefined,
  out: TextSink,
  err: TextSink,
): Promise<number> {
  const receipts = scanned.filter((s): s is ScannedReceipt & { receipt: Receipt } => s.receipt !== undefined);

  if (hook === "pre-commit") {
    if (receipts.length === 0) {
      return deny(err, "nenhum receipt cobre o diff do index — rode /pr-review (ou review equivalente) antes de commitar (ou: harness gates disable para bypass consciente)");
    }
    let best: BestFailure | undefined;
    for (const scannedReceipt of receipts) {
      const result = await comparePreCommit(root, scannedReceipt.receipt);
      warnLargeDiff(err, result.bytes ?? 0, hook);
      if (result.relation === "exact") {
        return pass(out, `pass (exact) — receipt ${scannedReceipt.file}`);
      }
      const message = failureMessage(hook, scannedReceipt.file, result);
      const priority = failurePriority(result.relation);
      if (!best || priority > best.priority) best = { priority, message };
    }
    // Drift is the most informative when the newest receipt was a near-miss;
    // the generic "sem receipt" covers empty scans (handled above).
    const message =
      best && best.priority > 0
        ? best.message
        : `nenhum receipt cobre o diff do index — rode /pr-review (ou review equivalente) antes de commitar (ou: harness gates disable para bypass consciente)`;
    return deny(err, message);
  }

  // pre-push
  const refs = parsePrePushRefs(stdinText ?? "");
  if (refs.length === 0) {
    // Só tags/deleções/outras refs — nada a validar (v1 documentado).
    return pass(out, "pass — nenhuma refs/heads/* no push (tags/deleções não são validadas no v1)");
  }
  let pushedRefs = 0;
  let anyFailure: BestFailure | undefined;
  for (const ref of refs) {
    pushedRefs += 1;
    let refOk = false;
    let refFailure: BestFailure | undefined;
    if (receipts.length === 0) {
      refFailure = {
        priority: 1,
        message: "nenhum receipt cobre o diff do push — rode /pr-review (ou review equivalente) antes de commitar (ou: harness gates disable para bypass consciente)",
      };
    } else {
      for (const scannedReceipt of receipts) {
        const receipt = scannedReceipt.receipt;
        const remoteRef = `refs/remotes/${receipt.candidate.base.remote}/${receipt.candidate.base.ref}`;
        const result = await comparePrePush(root, receipt, ref.localSha, remoteRef);
        warnLargeDiff(err, result.bytes ?? 0, hook);
        if (result.relation === "exact" || result.relation === "compatible_base_advance") {
          refOk = true;
          if (result.relation === "compatible_base_advance") {
            out.write(
              `runecraft gates: pass (compatible_base_advance) — ${ref.localRef} — base avançou, candidate intacto — receipt ${scannedReceipt.file}\n`,
            );
          } else {
            out.write(`runecraft gates: pass (exact) — ${ref.localRef} — receipt ${scannedReceipt.file}\n`);
          }
          break;
        }
        const message = failureMessage(hook, scannedReceipt.file, result);
        const priority = failurePriority(result.relation);
        if (!refFailure || priority > refFailure.priority) refFailure = { priority, message };
      }
    }
    if (!refOk) {
      if (!anyFailure || (refFailure && refFailure.priority > anyFailure.priority)) {
        anyFailure = refFailure ?? { priority: 0, message: "falhou" };
      }
    }
  }
  if (anyFailure) {
    return deny(err, anyFailure.message);
  }
  return pass(out, `pass — ${pushedRefs} refs/heads/* validada(s) contra os receipts`);
}

/**
 * Entry of `gates run <hook>` (called by the hook shim; also directly for
 * debug). Returns the process exit code: 0 = pass or disabled/unmanaged,
 * 1 = deny (fail-closed).
 */
export async function runGatesHook(opts: GatesRunOptions): Promise<number> {
  const { rt, hook, out, err } = opts;
  const root = repoRoot(rt.cwd);
  if (root === null) {
    return deny(err, "não é um repositório git (git rev-parse falhou) — fail-closed");
  }
  const resolution: GatesResolution = resolveGates(rt, root);
  if (resolution.error !== undefined) {
    return deny(err, resolution.error);
  }
  if (resolution.effective === "absent") {
    return deny(err, "config de gates ausente — rode `harness gates enable` ou `harness doctor` (fail-closed)");
  }
  if (resolution.effective === "disabled") {
    const source =
      resolution.global.config?.gates.enabled === false
        ? `kill switch global (${resolution.global.file})`
        : `repo off (${resolution.repo.file})`;
    return pass(out, `disabled/unmanaged (${source} gates.enabled=false) — nada a validar, exit 0`);
  }

  const dir = receiptsDir(root);
  if (!fs.existsSync(dir)) {
    return deny(err, `receipts não encontrados (${dir}) — rode \`harness doctor\` (fail-closed)`);
  }
  const scanned = scanReceipts(root);
  const corrupt = scanned.find((s) => s.errorKind === "corrupt");
  if (corrupt) {
    return deny(err, `receipt corrompido: ${corrupt.file} (JSON inválido) — fail-closed, rode harness doctor`);
  }
  for (const invalid of scanned.filter((s) => s.errorKind === "invalid")) {
    err.write(`runecraft gates: warn — receipt inválido ignorado: ${invalid.error}\n`);
  }
  return validateEnabled(hook, root, scanned, opts.stdinText, out, err);
}
