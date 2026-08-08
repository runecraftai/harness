// eval/sort.ts — colação pinada (F23 D2): comparador canônico por code points.
//
// O baseline e a evidência são ordenados com o MESMO comparador nos dois
// lados (gravação e comparação) — o requisito é ordem idêntica, nunca um
// byte order específico. `localeCompare` é proibido (locale-dependent: o
// mesmo par ordena diferente entre máquinas/Linux vs macOS). O comparador de
// JS (`<`/`>`) compara unidades UTF-16 lexicograficamente — determinístico
// cross-platform. No CI o job ainda seta LC_ALL=C para ferramentas externas
// (git diff, sort de shell); aqui a ordem é pinada na implementação.
export function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Ordena linhas com a colação pinada (D2). Sempre retorna um array novo. */
export function sortLines(lines: Iterable<string>): string[] {
  return [...lines].sort(compareCodePoints);
}
