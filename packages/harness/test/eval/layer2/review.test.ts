// review.test.ts — EVAL-004: review de diff com o child do pr-review (F7 COEX-04).
//
// Validação no Execute (F21 #6): as tools de review do pr-review (review_subagent
// / review_subagents / pr_review_verify) ficam OCULTAS fora de um /pr-review
// ativo — o ReviewLoopCoordinator do fork esconde as loop tools e o begin()
// exige fonte interactive/rpc + prompt do pacote. O fluxo determinístico
// exercita então o CHILD exatamente como o fork o spawna (buildReviewBaseArgs
// do próprio fork + wrapper `pi` no PATH — getPiInvocation sob bun test cai
// em { command: "pi" }), com o diff REAL no repo descartável e o verdict JSON
// do contrato do pr-review. Isolamento do child: --no-extensions →
// tools = builtins apenas (validado pelo fixture adversarial).
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChatServer } from "./fixture/chatServer.ts";
import { EVAL_004 } from "./fixture/scenarios.ts";
import { buildEvalEnv } from "../helpers/env.ts";
import { materializeAgentDir, installPiWrapper, resolveSdkCli } from "../helpers/fixtureHome.ts";
import { initEvalRepo, git } from "../helpers/gitRepo.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { waitForExit } from "../helpers/wait.ts";

// Mesmos flags que o fork passa ao child (fonte única: lib/pr-review-policy.ts).
import { buildReviewBaseArgs } from "@runecraft/pr-review/lib/pr-review-policy.ts";

const REVIEW_SYSTEM_PROMPT = [
  "You are an isolated review subagent for pull request 42.",
  "Review the diff between the base and the head. Return ONLY strict JSON with the exact shape:",
  '{"verdict":"approve|request_changes","overview":"...","strengths":[...],"findings":[...],"verification":"..."}',
  "No prose, no markdown fences.",
].join("\n");

describe("EVAL-004 — review de diff (F7 COEX-04)", () => {
  test("EVAL-004: diff real → child pr-review (builtins only) → verdict JSON estruturado", async () => {
    await evalTest(
      "EVAL-004: diff real → child pr-review (builtins only) → verdict JSON estruturado",
      async () => {
        const base = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "runecraft-eval-"));
        try {
          const server = new ChatServer(EVAL_004);
          const port = await server.listen();
          const home = materializeAgentDir(base, { port });
          const env = buildEvalEnv(base, home.agentDir);
          installPiWrapper(base, env);

          // Repo com um diff REAL (commit de feature sobre a base).
          const repo = initEvalRepo(base, env);
          fs.writeFileSync(path.join(repo.dir, "feature.txt"), "feature content\n");
          git(repo.dir, env, "add", "feature.txt");
          git(repo.dir, env, "commit", "-q", "-m", "feat: feature file");

          // Spawn do child exatamente como o fork: args do buildReviewBaseArgs
          // + --append-system-prompt; a task vai pelo stdin (modo -p).
          const args = buildReviewBaseArgs();
          const promptFile = path.join(base, "review-system.txt");
          fs.writeFileSync(promptFile, REVIEW_SYSTEM_PROMPT);
          args.push("--append-system-prompt", promptFile);

          const task = [
            `PR 42: ${git(repo.dir, env, "rev-parse", "--short", "HEAD")}`,
            "Objective: review the feature.txt change and return the structured JSON verdict.",
            "Context: the diff adds feature.txt with 'feature content'.",
          ].join("\n");

          const proc = spawn("pi", args, {
            cwd: repo.dir,
            env,
            stdio: ["pipe", "pipe", "pipe"],
          });
          proc.stdin.write(task);
          proc.stdin.end();
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
          proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          const code = await waitForExit(proc);

          expect(code).toBe(0);
          expect(stderr).toBe("");

          // Child fez as calls scriptadas (read + verdict) e o fixture não falhou.
          expect(server.diagnosis).toEqual([]);
          expect(server.seen).toHaveLength(2);
          for (const seen of server.seen) {
            expect([...seen.tools].sort()).toEqual(["bash", "edit", "read", "write"]);
          }

          // Verdict JSON estruturado no transcript (contrato do pr-review).
          const verdict = JSON.parse(extractVerdictJson(stdout)) as { verdict: string; findings: unknown[] };
          expect(verdict.verdict).toBe("approve");
          expect(Array.isArray(verdict.findings)).toBe(true);
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      },
      { evalId: "EVAL-004" },
    );
  });
});

/** Extrai o último texto assistant do transcript JSONL (o verdict JSON do child). */
function extractVerdictJson(stdout: string): string {
  const lines = stdout.split("\n").filter(Boolean);
  let lastAssistantText = "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: { role?: string; content?: Array<{ type?: string; text?: unknown }> };
      };
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = (event.message.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("");
        if (text.trim()) lastAssistantText = text;
      }
    } catch {
      // linha não-JSON (início/erros) — ignora
    }
  }
  return lastAssistantText;
}
