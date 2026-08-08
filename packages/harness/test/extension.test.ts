// extension.test.ts — /harness slash command registra e responde (CLI-07).
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import registerHarnessStatus, { type HarnessStatusDeps } from "../extensions/harness-status.ts";
import { makeSandbox, stateFile } from "./helpers.ts";

interface FakeCommandDef {
  description?: string;
  handler: (args: string, ctx: FakeExtensionContext) => void;
}

interface FakeExtensionContext {
  ui: { notify: (message: string, level: string) => void };
}

function makeFakePi() {
  const commands: Record<string, FakeCommandDef> = {};
  const messages: string[] = [];
  const pi = {
    registerCommand(name: string, def: FakeCommandDef) {
      commands[name] = def;
    },
  };
  const ctx: FakeExtensionContext = {
    ui: {
      notify(message: string, level: string) {
        messages.push(message);
      },
    },
  };
  return { pi, commands, ctx, messages };
}

describe("/harness — registro e resposta (CLI-07)", () => {
  test("registra o comando `harness` no ExtensionAPI", () => {
    const fake = makeFakePi();
    registerHarnessStatus(fake.pi as never);
    expect(Object.keys(fake.commands)).toEqual(["harness"]);
    expect(fake.commands.harness?.description).toContain("harness");
  });

  test("com state vazio instrui o install (AC 2.2)", async () => {
    const sb = makeSandbox();
    try {
      const fake = makeFakePi();
      const deps: HarnessStatusDeps = { env: sb.env, cwd: sb.dir };
      registerHarnessStatus(fake.pi as never, deps);
      fake.commands.harness?.handler("status", fake.ctx);
      expect(fake.messages.join("\n")).toContain("npx @runecraft/companion install");
    } finally {
      sb.cleanup();
    }
  });

  test("com state instalado lista components e versões", async () => {
    const sb = makeSandbox();
    try {
      // escreve um state global com 2 components (subagents + taskflow-core)
      const file = stateFile(sb);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: 1,
          scope: "global",
          installedAt: "2026-08-05T12:00:00Z",
          components: {
            "@runecraft/subagents": { group: "subagents", source: "npm:@runecraft/subagents", version: "0.37.2" },
            "@runecraft/taskflow-core": { group: "taskflow", source: "npm:@runecraft/taskflow-core", version: "0.2.6" },
          },
          createdFiles: [],
          settingsChanges: [],
          preInstall: [],
        }),
      );

      const fake = makeFakePi();
      registerHarnessStatus(fake.pi as never, { env: sb.env, cwd: sb.dir });
      fake.commands.harness?.handler("status", fake.ctx);
      const message = fake.messages.join("\n");
      expect(message).toContain("@runecraft/subagents@0.37.2");
      expect(message).toContain("@runecraft/taskflow-core@0.2.6");
    } finally {
      sb.cleanup();
    }
  });
});
