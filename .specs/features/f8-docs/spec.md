# F8 — Docs Specification

**Scope:** Medium (reescrita de READMEs; sem código)
**Prereq:** F7 ✓ (limites reais conhecidos)

## Problem Statement

Os READMEs vendorados descrevem os upstreams (nomes antigos, installs antigos, repos antigos). O produto público precisa de docs próprias: identidade `@runecraft/*`, instalação via harness, defaults recomendados, limites de coexistência descobertos no F7 — e a resolução da atribuição de terceiros (AD-002).

## Goals

- [ ] README por package + README raiz coerentes com o produto
- [ ] Atribuição de terceiros resolvida e aplicada (decisão AD-002 fechada)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Site de documentação | Futuro; markdown no repo basta no v1 |
| Tradução PT/EN dupla | v1 em inglês (produto público npm) |
| Changelog retroativo dos upstreams | CHANGELOGs vendorados são zerados no fork |

## Decisões da spec (assumptions)

- **Idioma: inglês** (npm público).
- **Estrutura comum por package**: what/install/quickstart/config/limits/relationship-to-upstream.
- **AD-002 deve fechar aqui no mais tardar**: F9 publica; publicar sem atribuição resolvida é risco legal. A spec exige a decisão registrada (manter `LICENSE-THIRD-PARTY.md` recomendado) antes de F8 ser marcada completa.

---

## User Stories

### P1: README raiz do harness ⭐ MVP

**User Story**: Como dev descobrindo o projeto, quero entender em 2 minutos o que é o harness, o que cada package faz e como instalar tudo junto.

**Acceptance Criteria**:

1. WHEN o README raiz é lido THEN ele SHALL apresentar: proposta do harness, tabela dos packages, instalação única (umbrella), settings recomendado e o fluxo SDLC "hello world" do F7
2. WHEN limites de coexistência existem (F7) THEN eles SHALL estar documentados em seção própria (known limits)

**Independent Test**: seguir o README do zero num projeto de teste reproduz o hello world.

### P1: README por package ⭐ MVP

**User Story**: Como dev usuário de um package específico, quero doc própria dele sem depender do harness inteiro.

**Acceptance Criteria**:

1. WHEN o README de cada fork é lido THEN ele SHALL usar identidade `@runecraft/*`, instalação individual e config essencial (sem referências a install/repos upstream como caminho oficial)
2. WHEN o package tem incompatibilidade com o upstream original instalado junto THEN o README SHALL avisar explicitamente
3. WHEN o leitor quer o upstream THEN uma seção "relationship to upstream" SHALL citar o projeto de origem e a versão base do fork

**Independent Test**: grep por instruções de instalação antigas (`pi install npm:pi-subagents` etc.) retorna vazio nos READMEs.

### P1: Atribuição de terceiros ⭐ MVP

**User Story**: Como owner, quero a questão de licenças resolvida antes de publicar.

**Acceptance Criteria**:

1. WHEN a decisão AD-002 é fechada THEN o resultado SHALL estar registrado no STATE.md (aceite ou recusa da recomendação `LICENSE-THIRD-PARTY.md`)
2. WHEN a recomendação é aceita THEN `LICENSE-THIRD-PARTY.md` SHALL listar os 4 upstreams com autores, licenças e versões base

**Independent Test**: STATE.md com AD-002 resolvido; arquivo presente se aceito.

---

## Edge Cases

- WHEN docs internas dos packages (docs/, DESIGN.md vendorados) referenciam o upstream THEN elas SHALL ser mantidas como estão (material técnico) — só READMEs e instruções de instalação são reescritos
- WHEN o README raiz promete algo não validado no F7 THEN a promessa SHALL ser removida (docs seguem evidência)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DOCS-01 | P1: README raiz (proposta+install+limits+hello world) | Execute | Pending |
| DOCS-02 | P1: READMEs por package (identidade nova) | Execute | Pending |
| DOCS-03 | P1: AD-002 fechada + atribuição aplicada | Execute | Pending |

## Success Criteria

- [ ] Zero instruções de instalação/identidade antigas nos READMEs
- [ ] Hello world reproduzível a partir da doc
- [ ] Situação de licenças resolvida e registrada
