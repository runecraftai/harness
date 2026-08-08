# {{feature}} Design — (título)

**Status:** (Draft | Ready for Execute | Implemented)
**Decisões aprovadas (usuário/briefing, travadas):** (decisão 1) · (decisão 2) · zero deps novas · offline/$0 · escopo packages/harness · (outras)

## Contexto

(estado atual do código, precedentes, evidências verificadas no recon — com refs de arquivo/linha onde aplicável)

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | (decisão) | (justificativa) |
| D2 | (decisão) | (justificativa) |

## Arquitetura — módulos

```
packages/harness/
├── src/.../
│   ├── index.ts          # exports públicos
│   └── ...               # módulos
└── test/
    └── ...               # unit + fixture
```

## Fluxos

### F1 — (fluxo 1)

```
1. (passo)
2. (passo)
```

## Tabela de mapeamento source → harness

| source (arcanum) | Decisão | Adaptação no port | Evidência |
| --- | --- | --- | --- |
| (fonte) | (PORT/ADAPT/DROP) | (adaptação) | (ref) |

## Tabela de mecanismos (o que existe → o que a feature constrói)

| Mecanismo | Existe (SDK/harness) — evidência | A feature constrói |
| --- | --- | --- |
| (mecanismo) | (ref) ✓ | (novo) |

## Integração CI

- **Roda com**: (lane)
- **Evidência**: (mecanismo de evidência)
- **Consistência**: (matriz/ratchet)
- **Kill switches**: (envs)
- **Falha em regressão**: (comportamento)

## Riscos

| Risco | Mitigação |
| --- | --- |
| (risco) | (mitigação) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| (ID) | (story) | (módulo + EVAL) |

**Cobertura:** N/N mapeados.

**Pontos a validar no Execute** (consolidado): (lista de validações pendentes)

## Open questions para o usuário (QA-1..QA-n)

1. **QA-1 — (tema)** (D#): (a) **recomendado — (opção)** · (b) (alternativa)
