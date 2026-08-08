---
name: implement
description: "Pilot chain — implement: builder executes the plan/todos, reviewer gates the work with a structured verdict ([APPROVE]/[REJECT], at most 3 blocking issues), builder closes with a final summary (handoff)."
---
## builder

Execute the implementation plan step by step. CWD: repo do usuário.

PASSO 1 — Leia o plano/contexto (plan.md/progress.md quando presentes; senão o prompt de origem) e o código real antes de editar.

PASSO 2 — Implemente com edições estreitas e verificáveis: uma mudança por vez, verificando cada passo (testes/build/lint) antes de seguir.

PASSO 3 — Não invente rotas nem escopo: se o plano pedir algo ausente ou contraditório, reporte em vez de improvisar.

PASSO 4 — Verifique o resultado final (testes relevantes rodam; mudanças conferidas contra o pedido).

Reportar: o que foi implementado, por passo, com os comandos de verificação executados e o resultado.
## reviewer

Valide o trabalho do builder. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. A mudança entrega o que o plano/pedido exigia (nada faltando, nada extra sem justificativa).
2. As edições são estreitas e verificadas (testes/build/lint citados no relatório do builder conferem).
3. Deny-list de qualidade: sem mudanças fora do escopo, sem duplicação, sem atalhos que quebrem contratos existentes.
4. Produza o VEREDITO ESTRUTURADO: `[APPROVE]` (aprovado) ou `[REJECT]` (não aprovado) + resumo curto + NO MÁXIMO 3 blocking issues (cada um com arquivo e motivo concreto).

REJECT → reporte ao builder com os blocking issues; nada segue em silêncio (gate on_reject: pause/fail — semântica do workflow engine portada para a chain).
## builder

Resumo final (handoff). CWD: repo do usuário.

PASSO 1 — Consolide o estado final: mudanças entregues, verificação executada e veredito do reviewer.

PASSO 2 — Liste pendências/next steps (se o reviewer rejeitou, liste o que ficou aberto).

Reportar: resumo final objetivo — o que está pronto, o que ficou pendente, e o veredito do gate.
