# F8 — Tasks: Docs

**Convenções:** tarefas atômicas com verificação; cada tarefa referencia requisito(s) da spec; commits atômicos por tarefa; hard constraint global — **zero mudança funcional** em qualquer task (docs + remoção de atribuição em comentário/prosa apenas); a suite (1152 harness + 58 sync) e o golden chain (F19 D9) SHALL permanecer verdes após CADA task.

## Dependências

```
T1 (atribuição) ─┐
T2 (nome antigo) ─┤
T3 (README raiz) ─┤
T4 (umbrella README) ─┼──► T7 (verificação)
T5 (READMEs fork) ─┤
T6 (docs index) ──┘
T8 (roadmap-loop refs — opcional/follow-up) — independente, não bloqueia T7
```

T1–T6 tocam arquivos disjuntos (sem overlap) e podem ser executadas em qualquer ordem/paralelo. T7 depende de T1–T6 completas. T8 é opcional (higiene de processo, fora do escopo estrito da spec).

## T1 — Remoção de atribuição MIT (DOCS-03)

Editar os 13 arquivos do inventário (design.md D2), removendo/reescrevendo só a prosa/comentário de atribuição de licença (nunca uma linha de código executável):

- `src/resilience/config.ts` (L3–4, 10–11, 27, 117)
- `src/resilience/stall.ts` (L3–10 + varredura completa do arquivo por citações "por função" adicionais)
- `src/memory/{client,cli,migrations,project,repository,tools,types}.ts` (headers, L1–4 cada)
- `test/resilience/config.test.ts` (header L1–6 + label do `describe()` em L31 — só o texto, zero mudança de asserção)
- `docs/ROUTING.md` (L330–335 seção "Atribuição (AD-002)"; L378 parentético "(supersedido, AD-001/AD-002)")
- `docs/MEMORY.md` (L5 parentético; L169–172 seção "## Atribuição")
- `test/EVAL-MATRIX.md` (L156 sufixo "— atribuição" na linha EVAL-019)

Preservar explicitamente (NÃO tocar): referências funcionais a "gentle-ai" (coexistência), "atribuição de sessão" (`observability/export.ts`, `docs/EVENTS.md`), "atribuição por componente" (`test/merge.test.ts`), e todos os campos `"license": "MIT"` em `package.json`.

**Verificação:**
1. `git diff --stat` mostra só os 13 arquivos listados (nenhum arquivo de código fora da lista)
2. Revisão manual linha a linha do diff de cada arquivo: nenhuma linha fora de comentário (`//`, `/** */`) ou prosa markdown foi alterada
3. `bun test` em `packages/harness` — 1152/1152 verde (sem regressão)
4. `bun test` do golden chain específico (F19 D9, `renderRules()`↔`ROUTING.md` §9) — verde, confirma que L330–335/L378 (fora da §9) não afetaram o apêndice
5. `grep -rniE "atribuição|org própria.*MIT|## Atribuição" --include="*.ts" --include="*.md" .` (excl. node_modules/.git/.specs) retorna só os falso-positivos documentados (session-attribution, component-attribution) — zero hit de licença remanescente
6. Sweep adicional: `grep -rniE "\bport(e|ed)?\b.*\bMIT\b"` para achados fraseados sem a palavra "atribuição" — se algo aparecer, tratar como achado desta task (não adiar)

## T2 — Consistência de nome: `@runecraft/harness` → `@runecraft/companion` (DOCS-06)

Corrigir os 2 hits residuais:
- `packages/harness/extensions/harness-status.ts:7` (comentário; se a string literal de output real também citar o nome antigo, corrigir junto — validar no Execute se há teste/snapshot que trava esse texto)
- `packages/harness/assets/sdd/chains/sdd-spec.chain.md:11` (texto de prompt/asset SDD)

**Verificação:**
1. `grep -rn "@runecraft/harness" .` (excl. node_modules/.git/.specs) retorna vazio
2. `bun test` verde (nenhuma asserção quebrada — se `harness-status.ts` tiver teste de output, confirmar que o texto esperado também foi atualizado)
3. Confirmar que `packages/harness` (diretório), `RUNECRAFT_*` (env vars) e "harness" como nome genérico do produto/bin alias permanecem intocados (grep negativo: nenhuma mudança fora dos 2 arquivos)

## T3 — README raiz: quickstart + intended-usage + limites + troubleshooting (DOCS-01)

Editar `README.md` (raiz) adicionando (sem remover o que já existe: proposta, tabela de packages, dev commands):
- **Quickstart**: `pi install npm:@runecraft/companion` (global/local), comando de verificação (`companion doctor` ou equivalente), 1 exemplo de "hello world" (ex.: `pi -p "/tf --help"`)
- **Intended usage** (resumo curto — quando usar qual tool): link para `docs/ROUTING.md` §1/§3 em vez de duplicar a tabela completa
- **Known limits**: aviso de colisão com upstreams (não instalar junto), two-driver rule (resumo + link)
- **Troubleshooting**: `companion doctor` / `companion status`, link para a seção de troubleshooting do umbrella README (T4)
- Nota de nome: `companion` como comando primário, `harness` como alias

**Verificação:**
1. Leitura ponta a ponta do README raiz reproduz um hello world real (comandos existem e funcionam conforme F7/F11/F12)
2. Nenhuma tabela/seção de `docs/ROUTING.md` duplicada (só linkada)
3. `bun test` verde (arquivo é `.md`, sem impacto em testes — checagem de não-regressão trivial)

## T4 — Rewrite do umbrella README (`packages/harness/README.md`) em EN, estilo gentle-ai (DOCS-02)

Reescrever seguindo a estrutura D1/D6: what / quickstart / intended-usage (matriz de agents F32 traduzida para seção própria, com link para `docs/ROUTING.md` §8.13 para detalhes) / configuração essencial / troubleshooting (doctor/status/uninstall/aviso de colisão) / relationship-to-upstreams (visão geral dos 4 forks + link para os READMEs pointer de T5). Remover o log de features/roadmap embutido (F11..F33 em prosa) — esse conteúdo já vive em `.specs/project/STATE.md`/`ROADMAP.md`; se algo for essencial para o usuário final (ex.: a matriz de agents, o resumo de routing), extrair para a seção própria em vez de descartar.

**Verificação:**
1. `grep -nE "F1[0-9]|F2[0-9]|F3[0-9]"` no novo README retorna vazio ou só menções pontuais de versão/SHA pinado (não histórico de implementação feature a feature)
2. Matriz de agents (7 papéis: planner/builder/reviewer/auditor/scout/researcher/security) presente e correta (comparar contra `packages/harness/agents/*.md` e `src/routing/` para fidelidade)
3. Idioma: EN (consistente com README raiz e `ROUTING.md`)
4. `docs/ROUTING.md` linkado, não duplicado (nenhuma tabela de routing de 7 rotas ou texto de `renderRules()` colado no README)
5. `bun test` verde

## T5 — READMEs de fork pointer-style (4 forks) (DOCS-04)

Aplicar o template D4 a:
- `packages/subagents/README.md` (remover banner/vídeo/"Try this first" completo; nota F2)
- `packages/goal-loop-audit/README.md` (remover seção "Why this exists"/feature-list completa; nota F4)
- `packages/pr-review/README.md` (remover feature-list completa; nota F5)
- `packages/taskflow/README.md` (**novo arquivo** — grupo inteiro; nota F16/F10)

Remover instruções de instalação antigas (`pi install npm:pi-subagents`, `pi install npm:pi-goal-list-loop-audit`, `pi install npm:pi-pr-review`) e qualquer asset de lore (banner `raw.githubusercontent.com/nicobailon/...`).

**Verificação:**
1. `grep -rn "pi install npm:pi-subagents\|pi install npm:pi-goal-list-loop-audit\|pi install npm:pi-pr-review\|raw.githubusercontent.com/nicobailon"` nos 4 READMEs retorna vazio
2. Cada README segue o template D4 (what curto / install / docs links / relationship-to-upstream)
3. Links relativos (`../../README.md`, `../harness/docs/ROUTING.md`) resolvem (checagem manual/`ls`)
4. `bun test` verde

## T6 — Índice de docs (`packages/harness/docs/README.md`) (DOCS-05)

Criar o índice listando (1 linha cada, com link relativo correto): `ROUTING.md`, `EVENTS.md`, `MEMORY.md`, `PI.md`, `EVAL-FRAMEWORK.md` (todos em `packages/harness/docs/`) e `docs/SYNC.md` (raiz do repo — path relativo `../../../docs/SYNC.md` a partir de `packages/harness/docs/README.md`). Atualizar README raiz e umbrella README (T3/T4) para apontar para este índice em vez de linkar cada doc individualmente (ou linkar `ROUTING.md` diretamente como entrada principal + índice para o resto).

**Verificação:**
1. Todos os 6 links do índice resolvem para arquivos existentes (`ls` de cada path)
2. README raiz e umbrella README referenciam o índice (ou `ROUTING.md` + índice) sem listar os 6 docs individualmente em mais de um lugar
3. `bun test` verde

## T7 — Verificação final integrada (DOCS-07)

Rodar a checklist completa do design D6 após T1–T6:
1. Golden chain (F19 D9) verde
2. Suite harness completa (1152) verde
3. Suite sync (58) verde
4. Ratchet/goldens (F23) sem `--update` necessário
5. Grep de completude — atribuição: zero hits fora dos falso-positivos
6. Grep de completude — nome antigo (`@runecraft/harness`): zero hits
7. Grep de completude — installs antigos: zero hits
8. Links do docs index resolvem
9. Revisão visual de markdown (sem linter configurado — checagem manual)

**Verificação:** todos os 9 itens acima documentados como passados (ou achados reportados) num resumo de fechamento da feature (pode ser o corpo do commit final ou uma nota em STATE.md).

## T8 — (Opcional/follow-up) Atualizar `.pi/skills/roadmap-loop/{SKILL.md,REFERENCE.md}` (fora da spec formal)

Os dois arquivos ainda descrevem AD-002 como barreira pendente do F8. Não é um requirement da spec (skill de processo interno, não doc de produto) — task opcional para não confundir o próximo ciclo do roadmap-loop. Se executada: atualizar a menção de "F8 exige a decisão de licença AD-002 resolvida" para refletir que AD-035 já resolveu (remover atribuições), mantendo o histórico da decisão.

**Verificação:** leitura confirma que a barreira F8/AD-002 não aparece mais como pendente; nenhuma outra barreira (F22/F9) foi alterada.

## Rastreabilidade

| Task | Requisito(s) | Depende |
| --- | --- | --- |
| T1 | DOCS-03 | — |
| T2 | DOCS-06 | — |
| T3 | DOCS-01 | — |
| T4 | DOCS-02 | — |
| T5 | DOCS-04 | — |
| T6 | DOCS-05 | — |
| T7 | DOCS-07 | T1, T2, T3, T4, T5, T6 |
| T8 | — (fora da spec) | — |
