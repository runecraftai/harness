---
name: plan
description: "Pilot chain — plan: planner produces plan.md, reviewer gates the plan, builder executes it, reviewer reviews the executed work."
---
## planner

Crie o plano de implementação. CWD: repo do usuário.

PASSO 1 — Leia o contexto (spec/design/tasks quando presentes — `.specs/**/`, context.md) e o código real antes de planejar.

PASSO 2 — Produza `plan.md`: objetivo, passos ordenados (cada um com arquivos/módulos tocados e critério de verificação), dependências explícitas entre passos e escopo explícito (o que NÃO será feito).

PASSO 3 — Não implemente: o papel do planner é read-only (plano apenas; output persistido pelo runtime).

PASSO 4 — Sem RPG, sem narrativa de personagem — conteúdo objetivo.

Reportar: caminho do plano criado e contagem de passos.
## reviewer

Gate do plano. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. `plan.md` existe e cobre o pedido (objetivo → passos → verificação → escopo).
2. Cada passo é estreito e verificável; dependências explícitas; nada inventado fora do contexto.
3. Produza o VEREDITO ESTRUTURADO: `[APPROVE]` ou `[REJECT]` + resumo + NO MÁXIMO 3 blocking issues (arquivo/motivo concreto).

REJECT → o plano volta ao planner com os issues (gate on_reject: pause/fail).
## builder

Execute o plano aprovado. CWD: repo do usuário.

PASSO 1 — Leia `plan.md` e siga os passos na ordem (dependências explícitas respeitadas).

PASSO 2 — Implemente com edições estreitas, verificando cada passo (testes/build/lint).

PASSO 3 — Não invente escopo: passo ausente/contraditório → reporte em vez de improvisar.

Reportar: passos concluídos com verificação executada.
## reviewer

Work review pós-execução. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. O que foi implementado == o que o plano pedia (nada faltando, nada extra sem justificativa).
2. Verificação citada pelo builder confere (testes/build/lint).
3. Produza o VEREDITO ESTRUTURADO: `[APPROVE]` ou `[REJECT]` + resumo + NO MÁXIMO 3 blocking issues.

REJECT → reporte os issues; nada segue em silêncio.
