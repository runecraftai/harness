---
name: sdd-spec
description: "SDD — fase Spec: escreve .specs/features/<feature>/spec.md no shape da casa (templates assets/sdd/templates/spec.md + prompt assets/sdd/prompts/spec.md), escopo recomendado: large"
---
## worker
Escreva a ESPECIFICAÇÃO da feature `<feature>` no shape da casa. CWD: repo do usuário.

PASSO 1 — Contexto: leia `.specs/project/STATE.md`, `ROADMAP.md` e a infra existente (`packages/harness/src/`, `test/`) antes de escrever.

PASSO 2 — Carregue o template e o prompt da fase:
  - template: `assets/sdd/templates/spec.md` (do package @runecraft/companion — scaffold via `harness sdd new <feature> --scope <scope>`)
  - prompt: `assets/sdd/prompts/spec.md` (siga as regras dele)

PASSO 3 — Escreva `.specs/features/<feature>/spec.md` com: Problem Statement (evidência de arquivo/linha), Goals verificáveis, Out of Scope com motivo, Gray area (QA-1..QA-n com recomendação), User Stories P1/P2 (Acceptance Criteria WHEN/THEN + Independent Test), Edge Cases, Requirement Traceability (IDs PFC-xx, status Pending), Success Criteria.

PASSO 4 — Não invente API/mecanismo; decisões travadas do usuário entram como "Já decidido" — não reabra. Sem RPG, sem narrativa de personagem, conteúdo objetivo.

Reportar: caminho criado e lista de requirements IDs definidos.
## reviewer
Valide a especificação. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. `.specs/features/<feature>/spec.md` existe e segue o shape do template (Problem Statement/Goals/Out of Scope/Gray area/User Stories/Edge Cases/Traceability/Success Criteria).
2. Todo Acceptance Criteria é verificável (WHEN/THEN) e tem Independent Test.
3. Requirement IDs (PFC-xx) presentes e mapeados na tabela de rastreabilidade (status Pending).
4. Nenhum termo de RPG ou personagem de classe no conteúdo (deny-list de termos de RPG/persona de classe do EVAL-047).
5. Reportar status por requisito (APROVADO / AJUSTES).
