#!/usr/bin/env node
/**
 * @runecraft/harness CLI entry point.
 *
 * F6 (umbrella meta-package) ships this minimal entry so the package exposes
 * the `harness` bin declared in package.json. The actual CLI (install/doctor/
 * status/sync/uninstall) lands in F11 — see .specs/features/f11-cli-harness.
 */
import process from "node:process";

process.stdout.write(
  "@runecraft/harness 0.1.0 — umbrella meta-package (F6).\n" +
    "The harness CLI (install/doctor/status/sync/uninstall) ships in F11.\n" +
    "Install the harness into Pi with: pi install npm:@runecraft/harness\n",
);
process.exit(0);
