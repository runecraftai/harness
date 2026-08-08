---
name: security
description: "Pilot chain — security: builder implements the change, security audits it (triage + fast exit, vulnerability classes), builder fixes findings, reviewer gates with a structured verdict."
---
## builder

Implemente a mudança com foco em segurança. CWD: repo do usuário.

PASSO 1 — Leia o plano/contexto e o código real antes de editar.

PASSO 2 — Implemente com edições estreitas, verificando cada passo (testes/build/lint).

PASSO 3 — Trate as superfícies sensíveis com cuidado explícito: auth/crypto/tokens/secrets/passwords/sessions/CORS/input validation/.env — sem atalhos, sem segredos em log, sem validação ausente.

Reportar: mudanças implementadas + superfícies sensíveis tocadas.
## security

Auditoria de segurança read-only. CWD: repo do usuário.

PASSO 1 — TRIAGE: leia o diff/relatório do builder e classifique o risco (fast exit quando não há superfície sensível — reporte "sem achados" e pare).

PASSO 2 — Audite por CLASSE DE VULNERABILIDADE: auth/authz, injeção (input validation), segredos/credenciais, crypto, sessions/tokens, CORS, .env/secretos em texto, exposição de dados.

PASSO 3 — Produza o relatório estruturado: classe × arquivo × severidade (blocking/não-blocking) × evidência concreta. No máximo 3 blocking issues (espelho do formato de veredito).

Reportar: veredito de auditoria — achados por classe + lista de blocking issues.
## builder

Corrija os achados da auditoria. CWD: repo do usuário.

PASSO 1 — Leia o relatório de auditoria e corrija cada blocking issue com edição estreita e verificação (testes/build/lint).

PASSO 2 — Re-verifique as superfícies sensíveis do PASSO 3 da implementação (nada regrediu).

Reportar: correções por achado + verificação executada.
## reviewer

Gate final. CWD: repo do usuário.

VERIFICAR (não modificar arquivos):
1. Todos os blocking issues da auditoria foram corrigidos (evidência por achado).
2. Veredito ESTRUTURADO: `[APPROVE]` ou `[REJECT]` + resumo + NO MÁXIMO 3 blocking issues remanescentes.

REJECT → reporte os issues remanescentes; nada segue em silêncio (gate on_reject: pause/fail).
