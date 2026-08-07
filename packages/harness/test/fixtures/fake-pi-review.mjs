#!/usr/bin/env node
// fake-pi-review.mjs — fake of the pi binary for the F20 receipt capture
// tests. Mimics the `pi --print --mode json /pr-review <pr> --no-comment`
// surface (formato validado no Execute):
//   - writes its argv to FAKE_REVIEW_LOG (tests assert the invocation flags)
//   - `--version` → prints a version
//   - otherwise emits a JSONL event stream where the LAST assistant message
//     carries the review JSON (from FAKE_REVIEW_JSON), then exits with
//     FAKE_REVIEW_EXIT (default 0) — the pi exit code is authoritative.
import fs from "node:fs";

const args = process.argv.slice(2);

function logPath() {
  return process.env.FAKE_REVIEW_LOG;
}
if (logPath()) {
  fs.writeFileSync(logPath(), JSON.stringify({ argv: args, cwd: process.cwd(), env: { RUNECRAFT_PI_BIN: process.env.RUNECRAFT_PI_BIN } }, null, 2));
}

if (args.includes("--version")) {
  process.stdout.write("0.84.0\n");
  process.exit(0);
}

// /pr-review invocation: `--print --mode json /pr-review <pr> --no-comment`
const reviewJson = process.env.FAKE_REVIEW_JSON ?? "{}";
const events = [
  { type: "agent_start" },
  {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: reviewJson }] },
  },
  {
    type: "agent_end",
    messages: [{ role: "assistant", content: [{ type: "text", text: reviewJson }] }],
  },
  { type: "agent_settled" },
];
for (const event of events) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
process.exit(Number(process.env.FAKE_REVIEW_EXIT ?? "0"));
