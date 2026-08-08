---
name: sdd-tasks
description: "SDD — fase Tasks: escreve .specs/features/<feature>/tasks.md no shape da casa (templates assets/sdd/templates/tasks.md + prompt assets/sdd/prompts/tasks.md), escopo recomendado: quick"
---
## worker
Escreva as TASKS da feature `<feature>` no shape da casa. CWD: repo do usuário.

PASSO 1 — Leia `.specs/features/<feature>/spec.md` e `design.md` e o código real antes de quebrar.

PASSO 2 — Carregue o template e o prompt da fase:
  - template: `assets/sdd/templates/tasks.md`
  - prompt: `assets/sdd/prompts/tasks.md` (siga as regras dele)

PASSO 3 — Escreva `.specs/features/<feature>/tasks.md` com: Base (design D1..Dn + infra reutilizada com IDs das features prévias), T1..Tn (cada task: módulos/arquivos, ações checkbox, bloco **Verificar** com unit/golden/TSC/zero deps), dependências (T## depende de T## / QA-##).

PASSO 4 — Rastreabilidade 1:1: todo requirement ID da spec (PFC-xx) tem task; toda task referencia requirement. Task de evals/governança quando a feature tocar EVAL-MATRIX/ratchet (política aditiva).

PASSO 5 — Escopo por task = mudança estreita e verificável. Sem RPG, sem narrativa de personagem.

Reportar: caminho criado e contagem de tasks por requirement.
## reviewer
Valide as tasks. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. `.specs/features/<feature>/tasks.md` existe e segue o shape do template (Base/Tasks/Verificar/Success Criteria/Traceability).
2. Toda task tem bloco **Verificar** concreto e dependências explícitas.
3. Rastreabilidade completa: todo requirement ID da spec aparece em tasks e vice-versa.
4. Deny-list RPG ausente do conteúdo — nenhum termo de RPG/persona de classe (deny-list do EVAL-047).
5. Reportar status por requisito (APROVADO / AJUSTES).
