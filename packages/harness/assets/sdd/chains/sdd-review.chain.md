---
name: sdd-review
description: "SDD — Review: verificação independente da feature <feature> contra spec/design/tasks (prompt assets/sdd/prompts/review.md), escopo recomendado: all"
---
## reviewer
Revise a implementação da feature `<feature>` contra a tríade spec/design/tasks. CWD: repo do usuário.

PASSO 1 — Leia `.specs/features/<feature>/{spec,design,tasks}.md` e compare com a implementação REAL (src/, test/, assets/).

PASSO 2 — Carregue o prompt da fase: `assets/sdd/prompts/review.md` (siga as regras dele).

PASSO 3 — Verifique por requirement ID (PFC-xx): cada critério da spec tem implementação + teste + evidência?

PASSO 4 — Checks obrigatórios:
  1. Zero deps novas (audite imports); offline/$0 (nenhuma chamada LLM em CI sem env-gate).
  2. Determinismo: 2 runs idênticos; sem timestamp/path absoluto em identidade (F21 D10).
  3. Fronteiras: nenhum arquivo de feature fechada alterado sem flag explícita.
  4. Kill switches funcionam (camadas inertes; CLI recusa fail-visible).
  5. Testes verdes + TSC limpo + ratchet/matriz consistentes.

PASSO 5 — Deny-list RPG ausente do conteúdo renderizado — nenhum termo de RPG/persona de classe (deny-list do EVAL-047).

PASSO 6 — Veredito estruturado: APROVADO / APROVADO COM FIXES (lista) / REJEITADO (motivos por requirement). Cada linha referencia arquivo/linha ou teste.

Reportar: veredito com achados P0–nit e status por requirement.
