# F8 — Docs Specification

**Scope:** Large (README raiz + rewrite umbrella + 4 READMEs de fork + docs index + remoção de atribuição em 13 arquivos + pass de nome; >10 tasks)
**Prereq:** F7 ✓ (limites reais conhecidos) · F19 ✓ (ROUTING.md canônico) · AD-035/036 ✓ (licença e nome resolvidos)
**Status:** Spec ATUALIZADA 2026-08-08 (pós AD-035/036/037, pós-rename `@runecraft/companion` commit `072204b`). Spec original: pré-rename, assumia `LICENSE-THIRD-PARTY.md`. Ver "Alterações vs spec original".

## Problem Statement

Os READMEs vendorados descrevem os upstreams (nomes antigos, installs antigos `pi install npm:pi-subagents` etc., lore do produto original). O produto público (`@runecraft/companion`, bin `companion` alias `harness`) precisa de docs próprias: quickstart, intended-usage, matriz de agents, troubleshooting — estrutura estilo gentle-ai — SEM duplicar o mental model já canônico em `docs/ROUTING.md` (F19). Adicionalmente, a decisão de licença (AD-035) fechou pelo caminho **remover atribuições MIT** dos comentários que citam os ports (runes→memory F29, goal-loop-audit→resilience F27) — F8 executa essa remoção, enumerada por arquivo:linha.

## Alterações vs spec original (documentadas)

| # | Item | Spec original (pré-AD-035) | Agora | Motivo |
| --- | --- | --- | --- | --- |
| B1 | Atribuição de terceiros | AD-002 "deve fechar aqui": manter `LICENSE-THIRD-PARTY.md` recomendado | **AD-035 (usuário, 2026-08-08): remover** as atribuições MIT dos comentários/prosa; NÃO criar `LICENSE-THIRD-PARTY.md`; risco documentado no STATE (recai sobre o owner) | Decisão explícita do usuário, apresentada 2× |
| B2 | Nome do produto | `@runecraft/*` genérico | **`@runecraft/companion`** confirmado (AD-036), bin `companion` alias `harness` mantido; rename já executado (commit `072204b`, 1152 testes verdes) — F8 usa o nome final | Nome fechado antes do F8 (docs usam o nome definitivo) |
| B3 | Idioma | "inglês (npm público)" — mantido, mas não verificado contra o estado real dos docs | **Verificado no recon**: README raiz (EN) e `docs/ROUTING.md` (EN, decisão F19 explícita) já são o padrão público; `packages/harness/README.md` está em **PT-BR** (divergente) e `docs/{EVENTS,MEMORY,PI,EVAL-FRAMEWORK}.md` são PT-BR (docs internos/contribuidor, fora do escopo de reescrita do F8 — só linkados) | F8 alinha os arquivos que reescreve (READMEs) ao padrão público já estabelecido (EN); não força tradução dos docs internos (fora de escopo — só link) |
| B4 | Estrutura "por package" | what/install/quickstart/config/limits/relationship-to-upstream (implicava reescrita completa de cada fork) | **Pointer-style** para os 4 forks (1–2 parágrafos + link para README raiz + `docs/ROUTING.md` + nota "relationship to upstream") — recomendado no design (D4); reescrita completa fica só no README raiz + umbrella | Evita 4 READMEs quase-duplicados; lore do upstream sai, mas o conteúdo técnico fica centralizado (raiz + ROUTING.md), zero duplicação |
| B5 | Matriz de agents / troubleshooting | Não localizados explicitamente | **Matriz de agents (F32)** já existe em `packages/harness/README.md` (PT-BR, embutida em prosa de changelog) — F8 a extrai/traduz para uma seção própria do umbrella README reescrito; **troubleshooting** = link para `harness doctor` + seção nova no umbrella README | Conteúdo já existe mas está em formato de log de desenvolvimento, não de doc de usuário |

## Goals

- [ ] README raiz com quickstart, intended-usage, matriz de agents (resumo) e troubleshooting, sem duplicar `docs/ROUTING.md`
- [ ] `packages/harness/README.md` reescrito no estilo gentle-ai (what/quickstart/intended-usage/matriz/troubleshooting/relationship-to-upstream), EN, sem o log de roadmap/changelog embutido
- [ ] READMEs dos 4 forks em estilo pointer (sem lore do upstream, sem instalação antiga)
- [ ] Índice de docs (`packages/harness/docs/README.md`) linkando ROUTING/EVENTS/MEMORY/PI/EVAL-FRAMEWORK (+ `docs/SYNC.md` na raiz do repo)
- [ ] Atribuições MIT removidas dos 13 arquivos enumerados (AD-035) — zero mudança funcional
- [ ] Pass de consistência de nome: `@runecraft/harness` (nome antigo) → `@runecraft/companion` nos 2 hits residuais encontrados
- [ ] Golden chain (F19 D9, renderRules↔ROUTING.md appendix) permanece verde; 1152 + 58 testes intocados

## Out of Scope

| Feature | Reason |
| --- | --- |
| Site de documentação | Futuro; markdown no repo basta no v1 (herdado da spec original) |
| Reescrita de `docs/{EVENTS,MEMORY,PI,EVAL-FRAMEWORK,SYNC}.md` | Só linkados, não duplicados (instrução explícita) — conteúdo técnico já correto e versionado por outras features |
| `LICENSE-THIRD-PARTY.md` | Explicitamente descartado pela AD-035 (opção (b) escolhida) |
| Conteúdo de F9 (publishing) além de naming | F9 é feature separada; F8 só garante que os docs usam o nome final |
| Reescrita completa dos 4 forks (estrutura what/install/quickstart/config/limits) | Substituída por pointer-style (B4) — decisão de design D4 |
| Rewrite de `packages/taskflow/hosts/README.md` e subpacotes internos (core/pi/dsl/adapters) | Light-touch (grep de nome apenas) — não são instalados isoladamente pelo usuário final; ver QA-2 |

## Decisões da spec (assumptions herdadas + atualizadas)

- **Idioma dos arquivos reescritos pelo F8: inglês** (root README, umbrella README, 4 READMEs pointer, docs index) — consistente com o README raiz atual e com a decisão F19 de `ROUTING.md` em inglês. Docs internos (`EVENTS/MEMORY/PI/EVAL-FRAMEWORK/SYNC`) permanecem PT-BR, fora do escopo de reescrita (ver QA-1).
- **Estrutura comum**: gentle-ai-style — quickstart / intended-usage / matriz de agents (resumo, com link para a tabela completa em ROUTING.md) / troubleshooting / relationship-to-upstream (só nos 4 forks).
- **AD-002/AD-035 já fechada**: F8 executa a remoção, não reabre a decisão. A referência à AD-002 permanece como registro histórico em `.specs/` (STATE.md), nunca é removida de lá.

---

## User Stories

### P1: README raiz do harness ⭐ MVP (DOCS-01)

**User Story**: Como dev descobrindo o projeto, quero entender em 2 minutos o que é o harness, o que cada package faz e como instalar tudo junto.

**Acceptance Criteria**:

1. WHEN o README raiz é lido THEN ele SHALL apresentar: proposta do harness, tabela dos packages (nomes finais `@runecraft/*`), instalação única (`companion`, alias `harness` mencionado), quickstart (comando + primeiro uso) e link para `docs/ROUTING.md` para o mental model completo
2. WHEN limites de coexistência existem (F7 — two-driver, aviso de colisão com upstreams) THEN eles SHALL estar documentados em seção "Known limits" ou linkados a ela
3. WHEN o leitor quer troubleshooting THEN uma seção/link para `harness doctor` SHALL existir

**Independent Test**: seguir o README do zero num projeto de teste reproduz o hello world (instala, roda `harness doctor`, `pi -p "/tf --help"` responde).

### P1: README do umbrella (`packages/harness/README.md`) reescrito ⭐ MVP (DOCS-02)

**User Story**: Como dev que já decidiu usar o harness, quero a doc completa do umbrella (matriz de agents, configuração, troubleshooting) sem ter que ler o changelog de features embutido.

**Acceptance Criteria**:

1. WHEN o README do umbrella é lido THEN ele SHALL seguir a estrutura: what / quickstart / intended-usage (matriz de agents F32 resumida) / configuração essencial / troubleshooting / relationship-to-upstreams (visão geral dos 4 forks + link individual)
2. WHEN o README menciona routing/mental-model THEN ele SHALL linkar `docs/ROUTING.md` em vez de duplicar a tabela completa de 7 rotas ou o texto injetado (`renderRules`)
3. WHEN o log de features/roadmap (F11..F33) está embutido no README atual THEN ele SHALL ser removido do README e permanecer só em `.specs/project/STATE.md`/`ROADMAP.md`

**Independent Test**: grep por `F1[0-9]|F2[0-9]|F3[0-9]` (referências de feature-log tipo changelog) no novo README retorna vazio ou só referências pontuais de "relationship to upstream"/versão pinada — não um histórico de implementação.

### P1: READMEs por fork em pointer-style ⭐ MVP (DOCS-04)

**User Story**: Como dev usuário de um fork específico, quero saber rapidamente que ele faz parte do harness e onde encontrar a doc completa, sem ler lore do produto upstream original.

**Acceptance Criteria**:

1. WHEN o README de cada fork (`subagents`, `goal-loop-audit`, `pr-review`, `taskflow` — novo README na raiz do diretório) é lido THEN ele SHALL usar identidade `@runecraft/*`, apontar para instalação via `companion` (com nota de instalação standalone) e linkar o README raiz + `docs/ROUTING.md`
2. WHEN o README antigo tinha lore do upstream (banner, "why this exists", features detalhadas) THEN esse conteúdo SHALL ser removido — substituído por 1–2 parágrafos + seção "Relationship to upstream" (nome original, licença MIT, SHA/versão pinada, principais divergências: F2/F4/F5)
3. WHEN o leitor quer instalar o fork isolado com o nome antigo THEN instruções antigas (`pi install npm:pi-subagents` etc.) SHALL ter sido removidas

**Independent Test**: grep por instruções de instalação antigas (`pi install npm:pi-subagents`, `pi install npm:pi-goal-list-loop-audit`, `pi install npm:pi-pr-review`, banner `raw.githubusercontent.com/nicobailon`) retorna vazio nos READMEs dos forks.

### P1: Índice de docs ⭐ MVP (DOCS-05)

**User Story**: Como dev, quero um ponto de entrada único para os docs técnicos do harness.

**Acceptance Criteria**:

1. WHEN `packages/harness/docs/README.md` é lido THEN ele SHALL listar (1 linha cada) `ROUTING.md`, `EVENTS.md`, `MEMORY.md`, `PI.md`, `EVAL-FRAMEWORK.md` e o `docs/SYNC.md` (raiz do repo) com link relativo correto
2. WHEN o README raiz ou o umbrella README referenciam docs técnicos THEN eles SHALL apontar para este índice (ou diretamente para `ROUTING.md`) em vez de linkar cada doc individualmente

**Independent Test**: todos os links do índice resolvem para arquivos existentes (`ls` de cada path referenciado).

### P1: Atribuição de terceiros removida ⭐ MVP (DOCS-03)

**User Story**: Como owner, quero a remoção de atribuição aplicada conforme AD-035, sem alterar comportamento.

**Acceptance Criteria**:

1. WHEN os 13 arquivos do inventário (design.md D2) são editados THEN as prosas/comentários de atribuição MIT (`atribuição`, `org própria, MIT`, `AD-002` como crédito de origem, `## Atribuição`) SHALL ser removidos ou reescritos sem crédito de licença — nenhuma linha de código funcional SHALL mudar
2. WHEN referências a "gentle-ai" descrevem **coexistência/detecção em runtime** (doctor check 14, owners.ts, ROUTING.md §two-driver, testes de coexistência) THEN elas SHALL ser preservadas — não são atribuição, são comportamento real do produto
3. WHEN o grep de completude (`atribuição|org própria.*MIT|## Atribuição`) roda pós-edição THEN ele SHALL retornar zero hits fora dos casos falso-positivo documentados (session-attribution em `observability/export.ts`/`docs/EVENTS.md`; component-attribution em `test/merge.test.ts`)
4. WHEN `.specs/project/STATE.md` é consultado THEN a AD-002/AD-035 SHALL permanecer registrada como histórico (nunca removida de `.specs/`)

**Independent Test**: `bun test` (1152 harness + 58 sync) permanece 100% verde pós-edição; `git diff --stat` mostra só linhas de comentário/prosa nos 13 arquivos (nenhuma linha de código executável fora de comentários).

### P2: Consistência de nome (DOCS-06)

**User Story**: Como dev lendo qualquer doc/comentário, quero ver sempre o nome final do pacote.

**Acceptance Criteria**:

1. WHEN o repo é varrido por `@runecraft/harness` (nome de pacote antigo) THEN as 2 ocorrências residuais (`extensions/harness-status.ts:7`, `assets/sdd/chains/sdd-spec.chain.md:11` — ambas em comentário/prosa, não em código executado) SHALL ser corrigidas para `@runecraft/companion`
2. WHEN "harness" aparece como substantivo genérico (nome do produto, `RUNECRAFT_*`, diretório `packages/harness`, bin alias) THEN ele SHALL ser preservado — escopo é só o **identificador de pacote npm** `@runecraft/harness`

**Independent Test**: `grep -rn "@runecraft/harness"` no repo (fora de `.specs/`, `node_modules/`) retorna vazio.

### P2: Verificação (DOCS-07)

**User Story**: Como mantenedor, quero garantir que a passada de docs não quebrou nada.

**Acceptance Criteria**:

1. WHEN o golden chain (`renderRules(agentId)` ↔ apêndice do `docs/ROUTING.md`, F19 D9) é testado THEN ele SHALL permanecer verde — F8 não toca a seção 9 (apêndice) de `ROUTING.md`
2. WHEN a suite completa roda THEN harness (1152) + sync (58) SHALL permanecer 100% verde, zero `--update` de ratchet/goldens
3. WHEN os greps de completude (atribuição + nome antigo) rodam pós-edição THEN ambos SHALL retornar zero hits fora dos falso-positivos documentados

**Independent Test**: `bun test` (harness + `scripts/sync-upstream` suite) verde; `bun test test/f19-routing.test.ts` (ou equivalente golden) verde; os 2 greps de completude vazios.

---

## Edge Cases

- WHEN `packages/harness/docs/{EVENTS,MEMORY,PI,EVAL-FRAMEWORK}.md` contêm atribuição (`MEMORY.md` seção `## Atribuição`, `EVENTS.md` "atribuição de sessão") THEN só a atribuição de LICENÇA é removida (`MEMORY.md`); "atribuição de sessão" (`EVENTS.md`) é terminologia de domínio (qual sessão é dona do evento) — SHALL ser preservada intacta
- WHEN um README de fork tinha imagem/vídeo (banner do subagents, vídeo de demo) THEN esse asset SHALL ser removido (lore do upstream) — não é preciso substituir por asset próprio no v1
- WHEN o README raiz promete algo não validado no F7 THEN a promessa SHALL ser removida (docs seguem evidência — herdado da spec original)
- WHEN `packages/claude-auth` é encontrado (não faz parte do bundle F6/companion, não citado no roadmap M6) THEN ele SHALL receber só o grep de nome (DOCS-06), sem rewrite completo — ver QA-3

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| DOCS-01 | P1: README raiz (quickstart+intended-usage+limits+troubleshooting) | Execute | Pending |
| DOCS-02 | P1: README umbrella reescrito (gentle-ai-style, EN, sem changelog embutido) | Execute | Pending |
| DOCS-03 | P1: Atribuição MIT removida (AD-035, 13 arquivos) | Execute | Pending |
| DOCS-04 | P1: READMEs de fork pointer-style (4 forks) | Execute | Pending |
| DOCS-05 | P1: Índice de docs (`packages/harness/docs/README.md`) | Execute | Pending |
| DOCS-06 | P2: Consistência de nome (`@runecraft/harness` → `@runecraft/companion`, 2 hits) | Execute | Pending |
| DOCS-07 | P2: Verificação (golden chain + suites + greps de completude) | Execute | Pending |

## Success Criteria

- [ ] Zero instruções de instalação/identidade antigas nos READMEs (root, umbrella, 4 forks)
- [ ] Hello world reproduzível a partir do README raiz
- [ ] Atribuição MIT removida nos 13 arquivos, zero mudança funcional (1152 + 58 testes verdes, golden chain verde)
- [ ] `@runecraft/harness` (nome antigo) com zero ocorrências fora de `.specs/`
- [ ] Matriz de agents e mental model referenciados sem duplicar `docs/ROUTING.md`
