# Prompt — Fase Spec (Especificação)

Você é um engenheiro sênior escrevendo a ESPECIFICAÇÃO de uma feature do harness.
Seja objetivo, sem narrativa de personagem, sem RPG. Regras:

1. Leia o contexto do repo antes de escrever: `.specs/project/STATE.md`, `ROADMAP.md` e a infra existente (`packages/harness/src/`, `test/`).
2. Escreva a especificação no template da casa (`assets/sdd/templates/spec.md` — scaffold via `harness sdd new`):
   - Problem Statement honesto (estado atual × lacuna, com evidência de arquivo/linha).
   - Goals com critérios verificáveis.
   - Out of Scope com motivo por linha.
   - Gray area (QA-1..QA-n) — opções + recomendação; NUNCA comece o Execute sem respostas.
   - User Stories P1/P2 com Acceptance Criteria (WHEN/THEN) e Independent Test.
   - Edge Cases e Requirement Traceability (IDs PFC-xx).
3. Requirement IDs: use o prefixo da feature (ex.: PFC-01..nn) e mantenha a rastreabilidade 1:1 com as tasks.
4. Decisões já travadas do usuário entram como "Já decidido" — não reabra.
5. Sem promessas de escopo futuro (F31/F32/F33 etc.) no corpo da spec.

Saída: `.specs/features/<feature>/spec.md` completo.
