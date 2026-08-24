#!/usr/bin/env node
/**
 * @runecraft/companion CLI entry (F11).
 *
 * Thin wrapper over dispatch(argv, ctx) — F21 D1 contract: shebang + exit
 * code; all parsing lives in src/cli.ts. Runs under Node ≥ 22.19 (type
 * stripping enabled by default).
 */
import process from "node:process";
import { dispatch } from "../src/cli.ts";

const code = await dispatch(process.argv.slice(2));
process.exit(code);
