# results/ — resultados datados e versionados do E2E (F22)

Rodadas do benchmark E2E (modelos reais, env-gated `RUNECRAFT_E2E=1`), na
forma `results/<harnessVersion>/<roundId>.json`:

- **`<harnessVersion>`**: versão do `packages/harness/package.json` (umbrella —
  hoje `0.1.0`); bump de versão → diretório novo (E2EV-05 AC 2.1).
- **`<roundId>`**: timestamp ISO UTC do início da rodada com `:` → `-`
  (ex.: `2026-08-08T14-30-00Z.json`); mesma versão, 2 rodadas → 2 arquivos
  (E2EV-05 AC 2.2).

Regras (F22 D4/F4): **resultados nunca são editados nem re-rodados "no lugar"**
— rodada nova = arquivo novo; rodadas parciais ficam marcadas
(`partial: true` + `interruptedAt`) como evidência. O F23 (ratchet P2) lê daqui
a tendência de pass rate por versão (fail-only-on-worse, fail-infra excluído).

Este diretório é versionado em git — a evidência faz parte do repo.
