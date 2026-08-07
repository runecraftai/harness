// harness-status.ts — slash command /harness (F11 CLI-07, F12 status real).
//
// Registers the `harness` command in a Pi session and delegates to the real
// status logic of this package (same module root — no isolation issue):
// buildStatusMessage computes the cross-state report (pi list × state ×
// manifest, design G3) and renders a compact per-scope summary. Nothing
// installed → instructs `npx @runecraft/harness install` (CLI-07 AC2).
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildStatusMessage } from "../src/commands/status.ts";

export interface HarnessStatusDeps {
  /** env override (tests) — default process.env */
  env?: NodeJS.ProcessEnv;
  /** cwd override (tests) — default process.cwd() */
  cwd?: string;
}

export default function registerHarnessStatus(pi: ExtensionAPI, deps: HarnessStatusDeps = {}): void {
  pi.registerCommand("harness", {
    description:
      "Estado do harness: /harness status (packages instalados e versões, estado cruzado).",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify(buildStatusMessage(deps.env, deps.cwd), "info");
    },
  });
}
