// eval/diff.ts — unified diff mínimo p/ goldens (F23 D4, zero deps).
//
// Comparação byte a byte com diff revisável: divergência → o ratchet imprime
// um unified diff padrão (`--- / +++` + hunks `@@ -a,b +c,d @@`). Implementado
// com LCS por linhas (goldens são pequenos — O(n*m) é folgado). Nunca usa
// `diff` de shell (não depende do ambiente; o requisito é diff estável, não
// formato exato do GNU diff).
export interface DiffLine {
  kind: " " | "-" | "+";
  text: string;
}

/** Sequência de operações linha a linha (LCS — Myers simplificado via DP). */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "-", text: a[i]! });
      i++;
    } else {
      ops.push({ kind: "+", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "-", text: a[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "+", text: b[j]! });
    j++;
  }
  return ops;
}

interface Hunk {
  from: number;
  to: number;
}

/** Agrupa mudanças em hunks com `context` linhas de contexto (regra padrão:
 *  mudanças separadas por ≤ 2*context+1 linhas compartilham o hunk). */
function buildHunks(ops: DiffLine[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastChange = -1;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k]!.kind === " ") continue;
    if (cur === null) {
      cur = { from: Math.max(0, k - context), to: Math.min(ops.length, k + context + 1) };
    } else if (k - lastChange <= 2 * context + 1) {
      cur.to = Math.min(ops.length, k + context + 1);
    } else {
      hunks.push(cur);
      cur = { from: Math.max(0, k - context), to: Math.min(ops.length, k + context + 1) };
    }
    lastChange = k;
  }
  if (cur !== null) hunks.push(cur);
  return hunks;
}

/**
 * Unified diff de `aText` vs `bText`. Retorna "" quando byte-iguais; senão o
 * diff com header `--- <nameA>` / `+++ <nameB>` e um hunk por região de
 * mudança. Determinístico (sem timestamps no header — o relatório do ratchet
 * carrega o contexto).
 */
export function unifiedDiff(nameA: string, nameB: string, aText: string, bText: string, context = 3): string {
  const ops = diffLines(aText.split("\n"), bText.split("\n"));
  if (ops.every((op) => op.kind === " ")) return "";
  const hunks = buildHunks(ops, context);
  const out: string[] = [`--- ${nameA}`, `+++ ${nameB}`];
  for (const h of hunks) {
    let lineA = 1;
    let lineB = 1;
    for (let k = 0; k < h.from; k++) {
      if (ops[k]!.kind !== "+") lineA++;
      if (ops[k]!.kind !== "-") lineB++;
    }
    let countA = 0;
    let countB = 0;
    for (let k = h.from; k < h.to; k++) {
      if (ops[k]!.kind !== "+") countA++;
      if (ops[k]!.kind !== "-") countB++;
    }
    const hdrA = countA === 1 ? `${lineA}` : `${lineA},${countA}`;
    const hdrB = countB === 1 ? `${lineB}` : `${lineB},${countB}`;
    out.push(`@@ -${hdrA} +${hdrB} @@`);
    for (let k = h.from; k < h.to; k++) {
      const op = ops[k]!;
      out.push(`${op.kind}${op.text}`);
    }
  }
  return `${out.join("\n")}\n`;
}
