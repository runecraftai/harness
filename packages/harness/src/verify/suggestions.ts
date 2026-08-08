// verify/suggestions.ts — reasons + sugestões acionáveis (F25, D8/D12/VER-11).
//
// Port do `verification-reminder` do arcanum (guild/OpenCode): o que era texto
// de prompt ("1. Read the changes: git diff --stat... 2. Run checks... 3.
// Validate behavior... 4. Gate decision...") vira REASON estruturado por
// camada + sugestão acionável. A sugestão de cada camada carrega o conteúdo
// semântico correspondente:
//   structural  → checks (2) — comando + trecho do stderr
//   integrity   → gate decision (4) — restauração / autorização allow
//   sufficiency → diff/stat (1) — proporção e escopo da mudança
//   embedding    → validação de comportamento (3) — output cobre a spec?
//   judge        → gate decision (4) — critérios de faithfulness da spec
//
// Formato do reason (D8): `<reasonId>: <camada> — <motivo>; <sugestão>`,
// SEM path absoluto e SEM timestamp (normalização F21 D10). A camada 2 herda
// o reason-id do F24 (VER-03 — `write-existing-file-guard`).
import { GUARD_REASON_IDS } from "../guards/guardKit.ts";
import { VERIFY_REASON_ID, type LayerId } from "./verdict.ts";

export interface ReasonParts {
  /** prefixo estável (VERIFY_REASON_ID; F24 na camada de integridade — VER-03). */
  reasonId: string;
  /** camada do veredito (structural/integrity/…/judge; cost/config p/ vereditos especiais). */
  layer: string;
  motivo: string;
  suggestion: string;
}

/** Monta o reason no formato D8 (`<reasonId>: <layer> — <motivo>; <sugestão>`). */
export function formatReason(parts: ReasonParts): string {
  return `${parts.reasonId}: ${parts.layer} — ${parts.motivo}; ${parts.suggestion}`;
}

/** Substitui o cwd por "<repo>" em trechos de stderr (normalização F21 D10 — nunca path absoluto). */
export function sanitizeExcerpt(text: string, cwd: string, maxLines = 10, maxChars = 600): string {
  const normalizedCwd = cwd.replace(/\/+$/, "");
  const cleaned = text.replaceAll(normalizedCwd, "<repo>");
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-maxLines);
  const joined = tail.join(" | ");
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
}

export function structuralFailReason(script: string, exitCode: number, excerpt: string): string {
  const suggestion =
    excerpt.length > 0
      ? `rode "bun run ${script}" e corrija os erros reportados (checks do repo): ${excerpt}`
      : `rode "bun run ${script}" e corrija os erros reportados (checks do repo)`;
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "structural",
    motivo: `comando "${script}" falhou (exit ${exitCode})`,
    suggestion,
  });
}

export function structuralTimeoutReason(script: string, timeoutMs: number): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "structural",
    motivo: `comando "${script}" excedeu o timeout (${timeoutMs}ms)`,
    suggestion: `rode "bun run ${script}" localmente e verifique se o check conclui dentro do limite`,
  });
}

export function structuralDegradedReason(): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "structural",
    motivo: "nenhum script detectado no package.json do repo",
    suggestion: "adicione scripts lint/typecheck/test (ou configure verification.structural.commands) para habilitar os checks",
  });
}

export function integrityFailReason(rel: string, kind: "deleted" | "replaced"): string {
  const motivo = kind === "deleted" ? `arquivo protegido ${rel} deletado` : `arquivo protegido ${rel} sobrescrito por inteiro`;
  return formatReason({
    reasonId: GUARD_REASON_IDS.writeExistingFile,
    layer: "integrity",
    motivo,
    suggestion: `restaure ${rel} ou autorize a alteração via guards.writeExistingFile.options.allow (gate decision — o domínio protegido é o do write-guard F24)`,
  });
}

export function sufficiencyEmptyReason(): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "sufficiency",
    motivo: "mudança ausente (diff vazio)",
    suggestion: "produza a mudança declarada no goal — git diff --stat deve mostrar o trabalho concluído (a conclusão sem diff não é verificável)",
  });
}

export function sufficiencyOversizedReason(diffTokens: number, limitTokens: number): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "sufficiency",
    motivo: `mudança desproporcional (${diffTokens} tokens, limite ${limitTokens})`,
    suggestion: "reduza o diff ao escopo do goal — git diff --stat e revise o que está além do declarado (mudança ∝ escopo)",
  });
}

export function sufficiencyScopeViolationReason(file: string, scopePaths: string[]): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "sufficiency",
    motivo: `arquivo ${file} fora do escopo do goal`,
    suggestion: `restrinja as mudanças a ${scopePaths.join(", ")} — git diff --stat e ajuste o escopo declarado (scopePaths ou o manifesto do goal)`,
  });
}

export function sufficiencyDegradedReason(): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "sufficiency",
    motivo: "spec indisponível (sem baseline de tamanho)",
    suggestion: "defina o objetivo/escopo do goal para habilitar a checagem de proporção (sem essa evidência não é violação)",
  });
}

export function embeddingFailReason(score: number, min: number): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "embedding",
    motivo: `score ${score.toFixed(4)} <= min ${min}`,
    suggestion: "revise a saída contra a spec — o output deve cobrir o escopo declarado (validação de comportamento: o código faz o que foi pedido?)",
  });
}

export function embeddingGrayNoJudgeReason(score: number, min: number, max: number): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "embedding",
    motivo: `zona cinza (${min} < score ${score.toFixed(4)} < ${max}) sem judge`,
    suggestion: "confirme na conversa que cada linha do diff cumpre a spec (gate decision) ou habilite o judge (RUNECRAFT_VERIFY_LLM_JUDGE=1) — CI não certifica caso duvidoso sem judge",
  });
}

export function embeddingDegradedReason(): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "embedding",
    motivo: "spec indisponível para a similaridade",
    suggestion: "veredito degradado registrado — sem a evidência da spec não é violação (embeddingUnavailable)",
  });
}

export function judgeFailReason(reasons: string[]): string {
  const detail = reasons.length > 0 ? reasons.join("; ") : "sem detalhes";
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "judge",
    motivo: `veredito do judge: fail (${detail})`,
    suggestion: "revise os critérios de faithfulness apontados (o output cobre o escopo declarado, não inventa, diff coerente)",
  });
}

export function judgeInvalidReason(): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "judge",
    motivo: "resposta do judge fora do schema (JSON inválido)",
    suggestion: "resposta inválida conta como falha (fail-closed) e é contabilizada no cap — re-tente ou revise o adaptador do judge",
  });
}

export function costCapReason(accounting: string): string {
  return formatReason({
    reasonId: VERIFY_REASON_ID,
    layer: "cost",
    motivo: `cap de custo esgotado (${accounting})`,
    suggestion: "HALT sem judge — aumente os costCaps ou reduza o escopo do goal; o judge nunca roda depois do cap",
  });
}
