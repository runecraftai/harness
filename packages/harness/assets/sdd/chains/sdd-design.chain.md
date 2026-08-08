---
name: sdd-design
description: "SDD — fase Design: escreve .specs/features/<feature>/design.md no shape da casa (templates assets/sdd/templates/design.md + prompt assets/sdd/prompts/design.md), escopo recomendado: medium"
---
## worker
Escreva o DESIGN da feature `<feature>` no shape da casa. CWD: repo do usuário.

PASSO 1 — Leia `.specs/features/<feature>/spec.md` e o código REAL antes de propor; cada decisão referencia evidência (arquivo:linha).

PASSO 2 — Carregue o template e o prompt da fase:
  - template: `assets/sdd/templates/design.md`
  - prompt: `assets/sdd/prompts/design.md` (siga as regras dele)

PASSO 3 — Escreva `.specs/features/<feature>/design.md` com: Contexto (fatos verificados), Decisões D1..Dn (tabela), Arquitetura — módulos (árvore), Fluxos F1..Fn, Tabela de mapeamento source → harness, Tabela de mecanismos, Integração CI, Riscos, Requisitos cobertos (rastreabilidade por requirement ID).

PASSO 4 — Resolva os gray areas da spec com recomendação (QA-1..QA-n). Se o SDK não expõe o mecanismo, documente o plano honesto ("validar no Execute" + STOP rule) — NUNCA invente API.

PASSO 5 — Fronteiras explícitas entre features (dono de cada arquivo/módulo). Sem RPG, sem narrativa de personagem.

Reportar: caminho criado e decisões D1..Dn resumidas.
## reviewer
Valide o design. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. `.specs/features/<feature>/design.md` existe e segue o shape do template (Contexto/Decisões/Arquitetura/Fluxos/Tabelas/Riscos/Traceability).
2. Toda decisão D# tem justificativa e mapeia para requirement ID da spec.
3. Nenhuma API/mecanismo inventado: referências de SDK/harness com arquivo:linha.
4. Fronteiras explícitas (nenhum arquivo de feature fechada sem flag).
5. Deny-list RPG ausente do conteúdo — nenhum termo de RPG/persona de classe (deny-list do EVAL-047).
6. Reportar status por requisito (APROVADO / AJUSTES).
