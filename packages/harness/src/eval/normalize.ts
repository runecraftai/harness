// eval/normalize.ts — identidade estável de falha (F23 D2).
//
// A identidade de uma falha conhecida é `(testFile, testName, mensagem
// normalizada)` — nunca a linha crua. A evidência do F21 grava a mensagem
// CRUA (contrato AD-015); a normalização é responsabilidade ÚNICA deste
// módulo, aplicada na gravação do baseline E na comparação (mesma função).
//
// Removido da identidade (regexes versionadas abaixo — uma por padrão,
// cada uma com teste dedicado em normalize.test.ts):
//   timestamps ISO/epoch · paths absolutos · portas efêmeras · versões de
//   pacote · hashes · durações · ANSI escapes
// NUNCA removido: números de assert (`expected 0 writes, got 2`) — número
// diferente = identidade diferente = falha nova = vermelho (contrato mudou).
//
// Fail-safe: padrão não previsto → a mensagem aparece CRUA no diff (entrada
// nova = vermelho); a normalização nunca mascara por regex excessiva. Cada
// padrão substitui por um token estável (`<ts>` etc.) — remover com "" poderia
// colar palavras vizinhas; o token preserva a estrutura e é determinístico.
//
// Regras de identidade: primeira linha do erro; newlines → espaço; tabs →
// espaço; truncamento em 200 chars; dedup canônico (uma entrada por
// identidade — contagem fora do contrato).

export const MAX_IDENTITY_MESSAGE_LENGTH = 200;

export interface NormalizePattern {
  /** nome do padrão (usado no relatório/testes). */
  name: string;
  regex: RegExp;
  replacement: string;
}

/** Tabela versionada de padrões (ordem importa: ISO antes de durations/ports
 *  para não raspar substrings de timestamp; paths antes de hashes para não
 *  confundir o sufixo hex de um diretório tmp com sha). */
export const NORMALIZE_PATTERNS: readonly NormalizePattern[] = [
  { name: "ansi", regex: /\u001b\[[0-9;?]*[A-Za-z]/g, replacement: "" },
  { name: "timestamp", regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, replacement: "<ts>" },
  { name: "timestamp-epoch", regex: /\b1[6-9]\d{8,12}\b/g, replacement: "<ts>" },
  // IPs (loopback do fixture) ANTES de version — "127.0.0.1" casaria com o
  // padrão de versão (3 grupos de dígitos separados por ponto).
  { name: "ip", regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "<ip>" },
  { name: "duration", regex: /\b\d+(?:\.\d+)?(?:ms|µs|us|ns|s)\b/g, replacement: "<dur>" },
  { name: "port", regex: /:\d{4,5}\b/g, replacement: ":<port>" },
  { name: "path", regex: /(?:file:\/\/)?\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)+/g, replacement: "<path>" },
  { name: "version", regex: /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/g, replacement: "<ver>" },
  { name: "hash", regex: /\b[0-9a-f]{7,40}\b/g, replacement: "<hash>" },
];

/** Sanitização base: primeira linha, newlines → espaço, tabs → espaço. */
export function firstLineSanitized(raw: string): string {
  const first = raw.split(/\r?\n/)[0] ?? "";
  return first.replace(/\t/g, " ").replace(/\r/g, " ");
}

/** Aplica a tabela de padrões na ordem (fail-safe: token estável por padrão). */
export function applyPatterns(message: string): string {
  let out = message;
  for (const pattern of NORMALIZE_PATTERNS) {
    out = out.replace(pattern.regex, pattern.replacement);
  }
  return out;
}

/**
 * Normaliza a mensagem crua do F21 para a identidade estável: primeira
 * linha → sanitização → padrões → truncamento em 200 chars. Determinística:
 * mesma entrada → mesma saída em qualquer máquina/run.
 */
export function normalizeMessage(raw: string): string {
  const line = firstLineSanitized(raw);
  const cleaned = applyPatterns(line);
  return cleaned.slice(0, MAX_IDENTITY_MESSAGE_LENGTH);
}
