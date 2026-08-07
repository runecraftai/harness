// commands/receipt.ts — `harness receipt capture|list` (design fluxo 2, D2).
//
//   capture <pr>            → fluxo RPC: gh pr view → merge-base → Pi
//                             /pr-review não-interativo → validator estrito →
//                             reviewHash + diff_hash → receipt (RCPT-01..04)
//   capture <pr> --from F   → fluxo manual: zero re-review (review do TUI)
//   list [--json]           → receipts do diretório, mais recente primeiro
//
// Receipt é emitido SÓ com verdict approve e sem P0/P1 (D7); senão exit ≠ 0 e
// nenhum arquivo (RCPT-03).
import { repoRoot } from "../gates/git.ts";
import type { Runtime, TextSink } from "../config.ts";
import { listReceipts, runReceiptCapture } from "../receipt/capture.ts";

export interface ReceiptCommandOptions {
  subcommand: string;
  args: string[];
  from?: string;
  includeClosed?: boolean;
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
}

export async function runReceiptCommand(opts: ReceiptCommandOptions): Promise<number> {
  const { out, err, rt } = opts;
  const root = repoRoot(rt.cwd);
  if (root === null) {
    err.write("@runecraft/harness receipt: é preciso estar dentro de um repositório git (o receipt liga o review ao diff local)\n");
    return 1;
  }
  switch (opts.subcommand) {
    case "capture": {
      const prArg = opts.args[0];
      if (!prArg || !/^\d+$/.test(prArg)) {
        err.write("@runecraft/harness receipt: uso — `harness receipt capture <pr> [--from <review.json>] [--include-closed]`\n");
        return 1;
      }
      return runReceiptCapture({
        rt,
        root,
        pr: Number(prArg),
        fromFile: opts.from,
        includeClosed: opts.includeClosed,
        out,
        err,
        json: opts.json,
      });
    }
    case "list":
      return listReceipts(root, opts.json, out);
    default:
      err.write(`@runecraft/harness receipt: subcomando desconhecido '${opts.subcommand}' (esperado capture|list)\n`);
      return 1;
  }
}
