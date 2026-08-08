// commands/events.ts — CLI `harness events export` (D8, OBS-10).
//
// Export jsonl determinístico: eventos do store (sessionId lexicográfico,
// seq asc) + bridges externos com `source:"bridge"` (--include-external):
// verify-verdicts.jsonl → verification:verdict; ledger glla +
// continuation.json + resilience-events.jsonl → resilience:signal (D7).
// Verificação do prevHash (D1) → violações no stderr (exit 0 com aviso).
// Linhas malformadas puladas (fail-soft). Zero deps. 2 runs → byte-idêntico.
import type { Runtime, TextSink } from "../config.ts";
import { exportEvents, renderExport } from "../observability/export.ts";
import { observabilityKillSwitch } from "../observability/config.ts";

export interface EventsCommandOptions {
  json: boolean;
  out: TextSink;
  err: TextSink;
  rt: Runtime;
  subcommand: string;
  args: string[];
  /** flags parseadas pelo CLI (parseArgs — contrato F11). */
  format?: string;
  session?: string;
  includeExternal?: boolean;
}

/** Parse das flags de `harness events export` (--format/--session/--include-external). */
export interface EventsExportFlags {
  format: string;
  session: string | undefined;
  includeExternal: boolean;
}

export function parseEventsExportFlags(args: string[]): { ok: boolean; flags: EventsExportFlags; error?: string } {
  let format = "jsonl";
  let session: string | undefined;
  let includeExternal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--format") {
      const value = args[i + 1];
      if (value === undefined) return { ok: false, flags: { format, session, includeExternal }, error: "--format precisa de um valor (jsonl)" };
      format = value;
      i += 1;
    } else if (arg === "--session") {
      const value = args[i + 1];
      if (value === undefined) return { ok: false, flags: { format, session, includeExternal }, error: "--session precisa de um valor (id da sessão)" };
      session = value;
      i += 1;
    } else if (arg === "--include-external") {
      includeExternal = true;
    } else {
      return { ok: false, flags: { format, session, includeExternal }, error: `flag desconhecida: ${arg}` };
    }
  }
  if (format !== "jsonl") {
    return { ok: false, flags: { format, session, includeExternal }, error: `--format ${format} não suportado na v1 (jsonl; OTel adiado — docs/EVENTS.md)` };
  }
  return { ok: true, flags: { format, session, includeExternal } };
}

export async function runEventsCommand(opts: EventsCommandOptions): Promise<number> {
  const cwd = opts.rt.cwd;
  if (opts.subcommand !== "export") {
    opts.err.write(`@runecraft/companion: subcomando desconhecido de events: ${opts.subcommand || "(vazio)"} (esperado: export)\n`);
    return 1;
  }

  if (observabilityKillSwitch(opts.rt.env).active) {
    opts.out.write("@runecraft/companion events: observability inativa — kill switch RUNECRAFT_OBSERVABILITY=0 (F20)\n");
    return 0;
  }

  const parsed = parseEventsExportFlags(opts.args);
  if (!parsed.ok) {
    opts.err.write(`@runecraft/companion: ${parsed.error}\n`);
    return 1;
  }
  // Flags vindas do parseArgs do CLI (F11) têm precedência sobre os args
  // posicionais (--format/--session/--include-external).
  const format = opts.format ?? parsed.flags.format;
  const session = opts.session ?? parsed.flags.session;
  const includeExternal = opts.includeExternal ?? parsed.flags.includeExternal;
  if (format !== "jsonl") {
    opts.err.write(`@runecraft/companion: --format ${format} não suportado na v1 (jsonl; OTel adiado — docs/EVENTS.md)\n`);
    return 1;
  }

  const result = exportEvents({
    cwd,
    session: session,
    includeExternal: includeExternal,
  });

  if (opts.json) {
    opts.out.write(
      `${JSON.stringify(
        {
          format,
          events: result.lines.length,
          skipped: result.skipped,
          hashViolations: result.hashViolations,
          output: result.lines,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    opts.out.write(renderExport(result));
  }

  for (const violation of result.hashViolations) {
    opts.err.write(`@runecraft/companion: prevHash violation — ${violation}\n`);
  }
  if (result.skipped > 0) {
    opts.err.write(`@runecraft/companion: ${result.skipped} linha(s) malformada(s) pulada(s) (fail-soft)\n`);
  }
  // Violações de hash chain → aviso no stderr, exit 0 (D8 — nunca bloqueia).
  return 0;
}
