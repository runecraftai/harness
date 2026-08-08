// eval/normalize.test.ts — testes dedicados por regex (F23 D2: "cada uma com
// teste dedicado") + regras de identidade (primeira linha, tabs, 200 chars,
// dedup, fail-safe, números de assert NUNCA removidos).
import { describe, expect, test } from "bun:test";
import { applyPatterns, firstLineSanitized, normalizeMessage, NORMALIZE_PATTERNS, MAX_IDENTITY_MESSAGE_LENGTH } from "./normalize.ts";

describe("normalize — regexes versionadas (um teste por padrão, D2)", () => {
  test("cada padrão tem nome único e regex com flag global (replace determinístico)", () => {
    const names = new Set<string>();
    for (const p of NORMALIZE_PATTERNS) {
      expect(p.regex.global).toBe(true);
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
    }
  });

  test("ansi: \u001b[...m removido (varia com TTY)", () => {
    expect(applyPatterns("\u001b[31merro\u001b[0m")).toBe("erro");
    expect(applyPatterns("a\u001b[1;31mb\u001b[0mc")).toBe("abc");
  });

  test("timestamp ISO: 2026-08-05T10:00:00Z → <ts>", () => {
    expect(applyPatterns("falhou em 2026-08-05T10:00:00Z agora")).toBe("falhou em <ts> agora");
    expect(applyPatterns("2026-08-05T10:00:00.123+02:00")).toBe("<ts>");
  });

  test("timestamp epoch: 1785… (ms) → <ts>", () => {
    expect(applyPatterns("gerado em 1785000000000")).toBe("gerado em <ts>");
    expect(applyPatterns("ts=1785000000")).toBe("ts=<ts>");
  });

  test("duração: (1.2s), 123ms → <dur> (varia com a máquina)", () => {
    expect(applyPatterns("took 1.2s total")).toBe("took <dur> total");
    expect(applyPatterns("timeout em 123ms")).toBe("timeout em <dur>");
  });

  test("porta efêmera: :54321 → :<port> (port 0 do fixture F21)", () => {
    expect(applyPatterns("http://127.0.0.1:54321/x")).toBe("http://<ip>:<port>/x");
    expect(applyPatterns("servidor em localhost:43210")).toBe("servidor em localhost:<port>");
  });

  test("ip de loopback: 127.0.0.1 → <ip> (fixture F21; antes do version — senão casaria como versão)", () => {
    expect(applyPatterns("http://127.0.0.1/x")).toBe("http://<ip>/x");
    expect(applyPatterns("conexão recusada em 127.0.0.1")).toBe("conexão recusada em <ip>");
  });

  test("path absoluto: /tmp/runecraft-eval-abc123/… → <path> (fixtures F21)", () => {
    expect(applyPatterns("arquivo /tmp/runecraft-eval-abc123/x.txt ilegível")).toBe("arquivo <path> ilegível");
    expect(applyPatterns("home /tmp/runecraft-eval-home-xyz")).toBe("home <path>");
  });

  test("versão de pacote: 0.1.0, bun@1.3.14 → <ver> (bump legítimo)", () => {
    expect(applyPatterns("@runecraft/harness@0.1.0 quebrou")).toBe("@runecraft/harness@<ver> quebrou");
    expect(applyPatterns("requer bun@1.3.14 ou maior")).toBe("requer bun@<ver> ou maior");
  });

  test("hash: 21b6bb0 → <hash>", () => {
    expect(applyPatterns("commit 21b6bb0 falhou")).toBe("commit <hash> falhou");
    expect(applyPatterns("sha abcdef0123456789abcdef0123456789abcdef01 ok")).toBe("sha <hash> ok");
  });
});

describe("normalize — regras de identidade (D2)", () => {
  test("primeira linha apenas: stack nunca entra na identidade", () => {
    expect(firstLineSanitized("expected 0 writes, got 2\n  at install (test/eval/layer1/install.test.ts:12:3)\n  at ...")).toBe(
      "expected 0 writes, got 2",
    );
  });

  test("tabs → espaço (TSV do baseline nunca contém tab no campo mensagem)", () => {
    expect(firstLineSanitized("a\tb\tc")).toBe("a b c");
  });

  test("números de assert NUNCA são removidos (número diferente = falha nova = vermelho)", () => {
    expect(normalizeMessage("expected 0 writes, got 2")).toBe("expected 0 writes, got 2");
    expect(normalizeMessage("expected 0 writes, got 3")).toBe("expected 0 writes, got 3");
    expect(normalizeMessage("expected 0 writes, got 2")).not.toBe(normalizeMessage("expected 0 writes, got 3"));
  });

  test("truncamento em 200 chars (depois dos padrões)", () => {
    const long = `erro ${"x".repeat(500)} fim`;
    const normalized = normalizeMessage(long);
    expect(normalized.length).toBeLessThanOrEqual(MAX_IDENTITY_MESSAGE_LENGTH);
    expect(normalizeMessage(long)).toBe(normalizeMessage(long));
  });

  test("fail-safe: padrão não previsto aparece crua (nunca mascarado)", () => {
    const weird = "erro estranho com @@token@@ e #hashtag# aqui";
    expect(normalizeMessage(weird)).toBe(weird);
  });

  test("determinismo: mesma entrada → mesma identidade (rerun byte a byte)", () => {
    const raw = "falhou em 2026-08-05T10:00:00Z no /tmp/runecraft-eval-abc/x porta :54321\nstack";
    const a = normalizeMessage(raw);
    const b = normalizeMessage(raw);
    expect(a).toBe(b);
    for (let i = 0; i < a.length; i++) expect(a.charCodeAt(i)).toBe(b.charCodeAt(i));
  });

  test("identidade composta: padrões + primeira linha + truncamento em conjunto", () => {
    const msg = `2026-08-05T10:00:00Z timeout 123ms em http://127.0.0.1:54321 com bun@1.3.14\nstack`;
    expect(normalizeMessage(msg)).toBe("<ts> timeout <dur> em http://<ip>:<port> com bun@<ver>");
  });
});
