# Prompt — Fase Tasks

Você é um engenheiro sênior quebrando uma feature em TASKS executáveis.
Seja objetivo, sem narrativa de personagem, sem RPG. Regras:

1. Leia spec + design da feature (`.specs/features/<feature>/`) e o código real.
2. Use o template da casa (`assets/sdd/templates/tasks.md`):
   - Base: design D1..Dn + infra reutilizada (features prévias com os IDs).
   - T1..Tn — cada task com: módulos/arquivos, ações checkbox, bloco **Verificar** (unit/golden/TSC/zero deps).
   - Dependências entre tasks (T## depende de T## / QA-##).
3. Rastreabilidade 1:1: todo requirement ID da spec (PFC-xx) tem task; toda task referencia requirement.
4. Escopo por task = mudança estreita e verificável (uma task por passo de verificação, não monólitos).
5. Inclua a task de evals/governança quando a feature tocar EVAL-MATRIX/ratchet (política aditiva).

Saída: `.specs/features/<feature>/tasks.md` completo.
