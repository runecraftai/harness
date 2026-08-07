// sdlc-helloworld.test.ts — EVAL-005: hello world SDLC completo (F7 COEX-05).
//
// Fluxo canônico do ROUTING.md seção 5 (F19 D4): goal com "Done when" →
// dispatch via subagent worker → auditor isolado (regression_shield) →
// review (child do pr-review sobre o diff real) → complete_goal sobrevive ao
// auditor. EVAL-001 + EVAL-002 + EVAL-004 encadeados num único SDLC.
//
// Decisão de Execute (validado no Execute F21 #6): as loop tools do pr-review
// ficam ocultas fora de um /pr-review ativo; o review entra como child do
// fork (buildReviewBaseArgs + wrapper `pi` no PATH) num SERVIDOR DEDICADO —
// o contador do servidor do fluxo de goal fica imune à continuação
// pós-aprovação do glla (o models.json é regravado para a porta do review
// antes do spawn do child; o child lê a config no start do processo).
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildReviewBaseArgs } from "@runecraft/pr-review/lib/pr-review-policy.ts";
import { setupEvalFixture } from "../helpers/evalFixture.ts";
import { evalTest } from "../helpers/evalTest.ts";
import { git } from "../helpers/gitRepo.ts";
import { waitForCondition, waitForExit } from "../helpers/wait.ts";
import { ChatServer } from "./fixture/chatServer.ts";
import { EVAL_005 } from "./fixture/scenarios.ts";
import { renderModelsJson } from "./fixture/modelsTemplate.ts";

const GOAL =
  'Create a file greeting.txt whose content is exactly "hello harness". Done when: greeting.txt exists in the repo root and its content is exactly "hello harness"';

const REVIEW_SYSTEM_PROMPT = [
  "You are an isolated review subagent for pull request 42.",
  "Review the diff between the base and the head. Return ONLY strict JSON with the exact shape:",
  '{"verdict":"approve|request_changes","overview":"...","strengths":[...],"findings":[...],"verification":"..."}',
  "No prose, no markdown fences.",
].join("\n");

describe("EVAL-005 — hello world SDLC completo (F7 COEX-05)", () => {
  test("EVAL-005: goal → subagent worker → auditor isolado → review → complete_goal sobrevive", async () => {
    await evalTest(
      "EVAL-005: goal → subagent worker → auditor isolado → review → complete_goal sobrevive",
      async () => {
        const fx = await setupEvalFixture({
          scenario: EVAL_005,
          withRepo: true,
          withPiWrapper: true,
        });
        try {
          const repoDir = fx.repo!.dir;
          await fx.session.session.prompt(`/goal start ${GOAL}`);

          // Goal → subagent worker → auditor → goal_archived (server 1).
          const ledger = path.join(repoDir, ".pi-glla", "active.jsonl");
          const archived = await waitForCondition(
            () => fs.existsSync(ledger) && fs.readFileSync(ledger, "utf8").includes('"goal_archived"'),
            { timeoutMs: 90_000, label: "goal_archived (EVAL-005)" },
          );
          expect(archived).toBe(true);

          const greeting = path.join(repoDir, "greeting.txt");
          expect(fs.existsSync(greeting)).toBe(true);
          expect(fs.readFileSync(greeting, "utf8")).toBe("hello harness");
          expect(fx.server.seen.length).toBeGreaterThanOrEqual(6);
          expect(fx.server.diagnosis).toEqual([]);
          expect(fx.server.seen[3]!.tools).toContain("complete_goal");

          // Review (server 2 — contador dedicado): child do pr-review sobre o
          // commit real. O models.json é regravado para a porta do server 2
          // antes do spawn (o child lê a config no start do processo).
          git(repoDir, fx.env, "add", "greeting.txt");
          git(repoDir, fx.env, "commit", "-q", "-m", "feat: greeting.txt");
          const reviewServer = new ChatServer(REVIEW_SCENARIO);
          const reviewPort = await reviewServer.listen();
          fs.writeFileSync(fx.modelsJsonPath, renderModelsJson({ port: reviewPort }));

          const args = buildReviewBaseArgs();
          const promptFile = path.join(fx.base, "review-system.txt");
          fs.writeFileSync(promptFile, REVIEW_SYSTEM_PROMPT);
          args.push("--append-system-prompt", promptFile);
          const proc = spawn("pi", args, {
            cwd: repoDir,
            env: fx.env,
            stdio: ["pipe", "pipe", "pipe"],
          });
          proc.stdin.write(
            `PR 42: ${git(repoDir, fx.env, "rev-parse", "--short", "HEAD")}\nObjective: review greeting.txt and return the structured JSON verdict.\nContext: the diff adds greeting.txt with content 'hello harness'.\n`,
          );
          proc.stdin.end();
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
          proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          const code = await waitForExit(proc);
          expect(code).toBe(0);
          expect(stderr).toBe("");

          // Review completo: 2 calls no server dedicado, verdict JSON, isolado.
          expect(reviewServer.diagnosis).toEqual([]);
          expect(reviewServer.seen).toHaveLength(2);
          for (const seen of reviewServer.seen) {
            expect([...seen.tools].sort()).toEqual(["bash", "edit", "read", "write"]);
          }
          const verdict = JSON.parse(extractLastAssistantText(stdout)) as { verdict: string };
          expect(verdict.verdict).toBe("approve");
        } finally {
          fx.cleanup();
        }
      },
      { evalId: "EVAL-005" },
    );
  });
});

/** Extrai o último texto assistant do transcript JSONL (o verdict JSON do child). */
function extractLastAssistantText(stdout: string): string {
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
      // linha não-JSON — ignora
    }
  }
  return lastAssistantText;
}

const REVIEW_SCENARIO = {
  id: "EVAL-005-review",
  description: "review child do pr-review (servidor dedicado)",
  steps: [
    {
      expect: { tools: ["read", "bash", "edit", "write"] },
      reply: { kind: "tool" as const, name: "read", args: { path: "greeting.txt" } },
    },
    {
      expect: { tools: ["read", "bash", "edit", "write"] },
      reply: {
        kind: "text" as const,
        text: JSON.stringify({
          verdict: "approve",
          overview: "greeting.txt created exactly as specified",
          strengths: ["content matches the contract byte for byte"],
          findings: [],
          verification: "verified against exact head",
        }),
      },
    },
  ],
  stepFor(n: number) {
    return n >= 1 && n <= this.steps.length ? this.steps[n - 1] : undefined;
  },
  summary(): string {
    return "1:read, 2:text";
  },
};
