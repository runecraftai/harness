#!/usr/bin/env node
// fake-gh.mjs — fake of the `gh` binary for the F20 receipt capture tests.
// Handles `gh pr view <pr> --json number,headRefOid,baseRefName,state`
// (the exact invocation the capture uses). Overrides via env:
//   FAKE_GH_PR     → pr number (default 42)
//   FAKE_GH_HEAD   → headRefOid (default: 40 a's)
//   FAKE_GH_BASE   → baseRefName (default "main")
//   FAKE_GH_STATE  → "OPEN" | "CLOSED" | "MERGED" (default "OPEN")
//   FAKE_GH_EXIT   → exit code (default 0) — simulate gh failures
//   FAKE_GH_LOG    → file to write the argv (assertion of flags)
import fs from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) {
  fs.writeFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }, null, 2));
}
if (process.env.FAKE_GH_EXIT && Number(process.env.FAKE_GH_EXIT) !== 0) {
  process.stderr.write("gh: simulated failure\n");
  process.exit(Number(process.env.FAKE_GH_EXIT));
}
const pr = Number(process.env.FAKE_GH_PR ?? "42");
const head = process.env.FAKE_GH_HEAD ?? "a".repeat(40);
const base = process.env.FAKE_GH_BASE ?? "main";
const state = process.env.FAKE_GH_STATE ?? "OPEN";
if (args[0] === "pr" && args[1] === "view") {
  process.stdout.write(
    `${JSON.stringify({ number: pr, headRefOid: head, baseRefName: base, state })}\n`,
  );
  process.exit(0);
}
process.stderr.write(`gh: unknown args: ${args.join(" ")}\n`);
process.exit(1);
