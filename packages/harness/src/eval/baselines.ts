// eval/baselines.ts — helpers de baseline do ratchet (F23) promovidos para
// src/ (fix cleric F26: o evaluator baseline-diff em src/eval/ não pode
// importar de test/ — quebraria o tarball publicado, cujo `files` exclui
// test/). Fonte única: parse/serialize/headers compartilhados entre o
// ratchet (test/eval/) e o evaluator (src/eval/). Semântica byte-idêntica à
// implementação original do F23 (parse preserva a linha; serialize ordena
// com a colação pinada).
import { sortLines } from "./sort.ts";

export const KNOWN_FAILURES_HEADER = [
  "# runecraft harness — known failures (may only shrink)",
  "# formato: testFile<TAB>testName<TAB>mensagemNormalizada",
  "# gerado por: bun run eval:ratchet --update",
].join("\n");

export const COVERAGE_HEADER = [
  "# runecraft harness — command coverage (list only grows)",
  "# formato: comando<TAB>flagsCanonicas (nomes ordenados, valores removidos)",
  "# gerado por: bun run eval:ratchet --update",
].join("\n");

/** Linhas não-comentário de um baseline (identidades já canônicas). */
export function parseBaselineLines(text: string): Set<string> {
  const set = new Set<string>();
  for (const line of text.split("\n")) {
    const clean = line.replace(/\r$/, "");
    if (clean === "" || clean.startsWith("#")) continue;
    set.add(clean);
  }
  return set;
}

/** Serializa um baseline: header + identidades ordenadas pela colação pinada. */
export function serializeBaseline(header: string, identities: Iterable<string>): string {
  const lines = sortLines(identities);
  return lines.length === 0 ? `${header}\n` : `${header}\n${lines.join("\n")}\n`;
}
