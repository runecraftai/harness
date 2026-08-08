# F8 — Design: Docs

**Status:** Ready for Execute (QA-1..3 resolvidas — AD-038)
**Prereqs de fato:** F7 ✓ (limites), F19 ✓ (`docs/ROUTING.md` canônico, EN), AD-035 ✓ (licença: remover atribuições), AD-036 ✓ (nome `@runecraft/companion` confirmado, rename executado commit `072204b`).

## D1 — Doc set e mapa de seções (gentle-ai style, sem duplicar ROUTING.md)

**Contexto:** o roadmap pede "estrutura estilo gentle-ai: quickstart, intended-usage, matriz de agents, troubleshooting". O recon mostrou que boa parte desse conteúdo **já existe**, mas espalhado/no formato errado:
- README raiz (`README.md`): já EN, já tem tabela de packages + dev commands — falta quickstart de instalação real, intended-usage, limites (F7), troubleshooting.
- `packages/harness/README.md`: PT-BR, contém a matriz de agents (F32) e o resumo de routing (F33) — mas embutidos em prosa de **changelog de features** (F11..F33), não em formato de doc de usuário.
- `docs/ROUTING.md` (F19): já é o mental model canônico (EN, 10 seções, golden testado) — NÃO deve ser duplicado.
- `docs/{EVENTS,MEMORY,PI,EVAL-FRAMEWORK}.md`: docs técnicos internos (PT-BR) — só linkados.
- `docs/SYNC.md` (raiz do repo, não em `packages/harness/docs/`): runbook de sync (F10) — só linkado.

**Decisão — onde vive cada seção:**

| Seção (estilo gentle-ai) | Vive em | Fonte / evita duplicar |
| --- | --- | --- |
| Quickstart | README raiz (novo) | Comando de install já existe no umbrella README — root herda |
| Intended-usage (quando usar qual tool) | README raiz (resumo curto) + `docs/ROUTING.md` §1/§3 (completo) | ROUTING.md é a fonte; root linka |
| Matriz de agents (F32) | `packages/harness/README.md` (extraída/traduzida da prosa atual) — resumo curto no README raiz com link | Tabela já existe em `packages/harness/README.md` (PT-BR) — traduzir e mover para seção própria, não duplicar nos 6 lugares |
| Troubleshooting | README raiz (curto: `harness doctor`) + `packages/harness/README.md` (seção própria: doctor/status/uninstall/aviso de colisão) | Comandos já documentados em prosa espalhada — consolidar |
| Relationship-to-upstream | Só nos 4 READMEs de fork (pointer-style, D4) | — |
| Docs índice | `packages/harness/docs/README.md` (novo) | Lista ROUTING/EVENTS/MEMORY/PI/EVAL-FRAMEWORK + `docs/SYNC.md` |

## D2 — Inventário de atribuição a remover (AD-035) — grep-driven, verificado por arquivo:linha

**Método:** `grep -rniE "atribuição|gentle-ai|AD-002|MIT" --include="*.ts" --include="*.md" --include="*.json" .` (excluindo `node_modules/`, `.git/`, `.specs/`), seguido de leitura de contexto por arquivo para separar **atribuição de licença** (remover) de **falso-positivo funcional** (preservar).

### A remover (13 arquivos, ~16 pontos) — só comentário/prosa, zero linha de código executável

| # | Arquivo | Linha(s) | O que remover |
| --- | --- | --- | --- |
| 1 | `packages/harness/src/resilience/config.ts` | 3–4, 10–11 | Parágrafo de header "provados em campo — atribuição por constante..." / "(fork é nosso — AD-001; upstream MIT — atribuição em docs/ROUTING.md seção Resilience...)" |
| 2 | `packages/harness/src/resilience/config.ts` | 27 | Comentário de seção "Defaults do fork glla (atribuição por constante — fonte citada)." |
| 3 | `packages/harness/src/resilience/config.ts` | 117 | JSDoc "Defaults calibrados (valores do fork glla — ver atribuição acima)." |
| 4 | `packages/harness/src/resilience/stall.ts` | 3–10 (header) | Parágrafo "Port dos padrões PROVADOS EM CAMPO do fork goal-loop-audit (fork é nosso — AD-001; upstream MIT — atribuição por função abaixo...)" — **validar no Execute**: citações por função ao longo do arquivo inteiro (o header promete "atribuição por função abaixo" — varrer o arquivo completo, não só a linha grepada) |
| 5 | `packages/harness/src/memory/client.ts` | 1–2 | "port de db/client.ts do runes — org própria, MIT; AD-002" |
| 6 | `packages/harness/src/memory/cli.ts` | 3–4 | "Port do bin/runes.ts (... — org própria, MIT; AD-002)" |
| 7 | `packages/harness/src/memory/migrations.ts` | 1–2 | "port de db/migrations.ts do runes — org própria, MIT; AD-002" |
| 8 | `packages/harness/src/memory/project.ts` | 1–2 | "port de lib/project.ts do runes — org própria, MIT; AD-002" |
| 9 | `packages/harness/src/memory/repository.ts` | 1–2 | "port completo do Repository do runes (db/repository.ts — org própria, MIT; AD-002)" |
| 10 | `packages/harness/src/memory/tools.ts` | 1–3 | "Port 1:1 dos tools do runes (src/tools/*.ts — org própria, MIT; AD-002)" |
| 11 | `packages/harness/src/memory/types.ts` | 1–2 | "port de db/types.ts do pacote runes do arcanum — org própria, MIT; AD-002" |
| 12 | `packages/harness/test/resilience/config.test.ts` | 1–6 (header), 31 (label do `describe()`) | Header "(d) defaults = valores do fork glla (atribuição verificada contra...)"; label `"resilience config — defaults do fork glla (atribuição D4)"` → renomear sem "atribuição" (ex.: `"resilience config — defaults do fork glla (verificados contra o source)"`); **zero mudança de asserção** |
| 13a | `packages/harness/docs/ROUTING.md` | 330–335 | Seção `**Atribuição (AD-002)**: os padrões de stall/backoff/quota são portes dos mecanismos do fork goal-loop-audit (MIT, Copyright (c) 2026 dracon...)` — remover ou reescrever sem crédito de licença |
| 13b | `packages/harness/docs/ROUTING.md` | 378 | Parentético `(supersedido, AD-001/AD-002)` na frase "porta o pacote `runes` do arcanum (supersedido, AD-001/AD-002) para MECANISMOS REAIS..." — remover parentético, manter o resto da frase |
| 14 | `packages/harness/docs/MEMORY.md` | 5 | Parentético `(org própria, MIT — AD-002; fonte: \`packages/runes\` em \`~/Projects/arcanum\`)` no parágrafo de abertura |
| 15 | `packages/harness/docs/MEMORY.md` | 169–172 | Seção inteira `## Atribuição` (crédito ao pacote `runes` do arcanum) |
| 16 | `packages/harness/test/EVAL-MATRIX.md` | 156 | Trecho `(defaults do fork glla — atribuição)` na linha da tabela `EVAL-019` → remover só o sufixo "— atribuição", manter "(defaults do fork glla)" ou similar (a linha documenta um fato funcional: os limiares são configuráveis; só o crédito de licença sai) |

**Nota importante (D9 golden chain):** os pontos 13a/13b em `ROUTING.md` estão nas seções §8.9 (Resilience) e §8.10 (Memory) — **fora** da seção 9 (apêndice injetado, testado byte-a-byte pelo golden `renderRules()`↔apêndice, F19 D9). Confirmado por leitura: a remoção não toca a seção 9. **Validar no Execute** com o teste golden específico antes de considerar a task fechada.

### Explicitamente preservados (falso-positivo do grep — NÃO são atribuição de licença)

| Padrão | Arquivos (exemplos) | Por que preservar |
| --- | --- | --- |
| "gentle-ai" como produto coexistente (detecção/two-driver) | `src/commands/{install,doctor,status}.ts`, `src/owners.ts`, `src/adapters/{types,registry}.ts`, `src/lock.ts`, `docs/ROUTING.md` §two-driver, `test/f18-coexistence.test.ts`, `test/adapters.test.ts`, `test/agent-install.test.ts`, `test/eval/**` | Descreve comportamento REAL de coexistência com um produto externo instalado pelo usuário — não é crédito de código copiado |
| "Atribuição de sessão" | `src/observability/export.ts` (linhas 15, 20, 61, 100), `docs/EVENTS.md` (linhas 88, 91) | "Atribuição" aqui = a que sessão um evento pertence (domínio de eventos), não atribuição de licença |
| "atribuição por componente" | `test/merge.test.ts` (linhas 3, 436) | = a qual componente uma seção de settings pertence (domínio de merge/uninstall), não atribuição de licença |
| `"license": "MIT"` em `package.json` | `packages/{subagents,claude-auth,goal-loop-audit,pr-review,taskflow/*,harness}/package.json` | Declaração SPDX real da licença do fork/pacote — fato legal, não prosa de atribuição; **NÃO remover** |
| `.pi/skills/roadmap-loop/{SKILL.md,REFERENCE.md}` mencionando AD-002 como barreira | — | Fora do escopo do F8 (skill interno de orquestração, não doc público) — ver riscos/notas abaixo |

## D3 — Pass de consistência de nome (`@runecraft/harness` → `@runecraft/companion`)

**Escopo (P2 explícito na spec):** só o **identificador de pacote npm** `@runecraft/harness` (nome antigo, pré-rename). NÃO inclui: `packages/harness` (nome de diretório, detalhe de implementação — AD-036 confirma que permanece), `RUNECRAFT_*` (env vars), `harness` como substantivo genérico do produto ("Runecraft Harness"), bin alias `harness`.

**Inventário (grep verificado, 2 hits):**

| # | Arquivo | Linha | Contexto | Ação |
| --- | --- | --- | --- | --- |
| 1 | `packages/harness/extensions/harness-status.ts` | 7 | Comentário: `` instalado → instrui `npx @runecraft/harness install` (CLI-07 AC2). `` | `@runecraft/harness` → `@runecraft/companion` (só comentário — a mensagem real do runtime deve ser conferida no Execute: se o texto de output real também usa o nome antigo, é bug funcional pré-existente, fora do escopo docs-only do F8 — reportar como achado, não corrigir código nesta feature) |
| 2 | `packages/harness/assets/sdd/chains/sdd-spec.chain.md` | 11 | `` template: `assets/sdd/templates/spec.md` (do package @runecraft/harness — scaffold via `harness sdd new <feature> --scope <scope>`) `` | `@runecraft/harness` → `@runecraft/companion` (asset de doc/prompt SDD, texto puro) |

**Validar no Execute:** se `harness-status.ts:7` for só comentário acima de uma string literal que TAMBÉM contém `@runecraft/harness` (mensagem real exibida ao usuário), a correção da string é uma mudança funcional de output de texto (não de lógica) — permitida sob a régua "docs + atribuição" do hard constraint SE for tratada como correção de nome (mesma natureza do DOCS-06), com teste existente (se houver snapshot da mensagem) atualizado a par. Se não houver teste que trave o texto antigo, a mudança é segura por definição.

## D4 — READMEs de fork: pointer-style (recomendado) vs adapted-full

**Opções avaliadas:**
- **(a) Pointer-style (RECOMENDADO)**: 1–2 parágrafos (o que é, no contexto do harness) + instalação (via `companion`, nota de standalone) + links (README raiz, `docs/ROUTING.md`) + seção "Relationship to upstream" (nome original, MIT, SHA/versão pinada — `vendor.json`, principais divergências F2/F4/F5). Remove lore, banners, features detalhadas do upstream.
- **(b) Adapted-full**: manter a estrutura what/install/quickstart/config/limits/relationship-to-upstream completa por fork (spec original). Rejeitada: gera 4 READMEs quase-duplicados entre si e com o README raiz/umbrella; qualquer mudança de config precisaria ser replicada em 5 lugares (raiz + umbrella + 4 forks) — viola "referenciar sem duplicar" já aplicado ao ROUTING.md.

**Template (D4, aplicado aos 4 forks):**

```md
# @runecraft/<name>

Part of [Runecraft Companion](../../README.md), the multi-agent harness for
the [Pi coding agent](https://pi.dev).

<1–2 sentence: what this component does inside the harness — no upstream lore>

## Install

Installed automatically as part of `@runecraft/companion`. Standalone:

    pi install npm:@runecraft/<name>

## Docs

- Full guide, quickstart & agent matrix: [root README](../../README.md)
- Mental model / when to use this vs the other tools: [ROUTING.md](../harness/docs/ROUTING.md)

## Relationship to upstream

Fork of `<upstream-name>` (MIT), pinned at `<version/SHA>` (see `vendor.json`).
Notable divergences: <1 line — F2 install.mjs removed / F4 rename / F5
hardcode fixes>.
```

**Aplicação por fork:**

| Fork | Diretório README | Upstream original | Divergência a citar |
| --- | --- | --- | --- |
| `@runecraft/subagents` | `packages/subagents/README.md` | `pi-subagents` (nicobailon) | F2: `install.mjs` removido (rename completo do install path) |
| `@runecraft/goal-loop-audit` | `packages/goal-loop-audit/README.md` | `pi-goal-list-loop-audit` (dracon) | F4: rename `@runecraft/*` (604/607 testes) |
| `@runecraft/pr-review` | `packages/pr-review/README.md` | `pi-pr-review` | F5: fix real de hardcodes `pi-pr-review`/10ego (verify-package-contents.mjs) |
| `@runecraft/taskflow` (grupo) | `packages/taskflow/README.md` (**novo** — não existe hoje) | `taskflow` (heggria) | F16: camada MCP re-vendorada (9 packages); F10: sync three-way ativo |

**QA-2 (ver seção final):** `packages/taskflow/hosts/README.md` (único README que já existe nos subpacotes internos do taskflow, é doc técnico de arquitetura interna, não lore de produto) recebe só o pass de nome (D3-equivalente, se houver) — não é convertido em pointer; os demais subpacotes (`core/pi/dsl/claude/codex/opencode/grok`) não têm README e não ganham um novo no F8 (não são instalados isoladamente pelo usuário final — o pointer único em `packages/taskflow/README.md` cobre o grupo).

## D5 — `packages/claude-auth`: fora do escopo de rewrite, dentro do escopo de grep (QA-3)

Achado no recon: `packages/claude-auth` (`@runecraft/claude-auth`) não está no bundle do umbrella (F6 — não aparece na tabela `packages/harness/README.md` de componentes instalados) nem é citado no roadmap M6/F8. Já está em inglês, sem lore de upstream (é conteúdo próprio, não fork). **Decisão:** só entra no grep de nome (D3) — sem rewrite de estrutura. Se o usuário quiser tratá-lo como 5º componente do harness, isso é decisão de escopo de produto (fora do F8), registrada como QA-3.

## D6 — Verificação (DOCS-07)

| Checagem | Comando/método | Critério de sucesso |
| --- | --- | --- |
| Golden chain (F19 D9) | `bun test` filtrando o teste de golden `renderRules()`↔apêndice `ROUTING.md` §9 | Verde, byte-a-byte — F8 não toca §9 |
| Suite harness completa | `bun test` em `packages/harness` | 1152/1152 (sem regressão; test #12 do inventário só muda label/comentário) |
| Suite sync | `bun test` (scripts `sync-upstream`) | 58/58 |
| Ratchet/goldens (F23) | `bun run test:eval` sem `--update` | Sem baseline nova (F8 não deveria gerar nenhuma — se gerar, é sinal de escopo vazado para código) |
| Grep de completude — atribuição | `grep -rniE "atribuição|org própria.*MIT|## Atribuição" --include="*.ts" --include="*.md" .` (excl. node_modules/.git/.specs) | Zero hits fora dos falso-positivos documentados em D2 (session-attribution, component-attribution) |
| Grep de completude — nome antigo | `grep -rn "@runecraft/harness" .` (excl. node_modules/.git/.specs) | Zero hits |
| Grep de completude — installs antigos | `grep -rn "pi install npm:pi-subagents\|pi install npm:pi-goal-list-loop-audit\|pi install npm:pi-pr-review" .` | Zero hits fora de `.specs/` (histórico) |
| Links do docs index | Checagem manual/`ls` de cada path referenciado em `packages/harness/docs/README.md` | Todos resolvem |
| Markdown básico | Revisão visual (sem linter de markdown configurado no repo — não introduzir dependência nova) | Headings consistentes, sem links quebrados óbvios |

**Não há link-checker/markdown-lint configurado no repo hoje** (verificado: nenhum devDependency de `markdownlint`/`remark` no `package.json` raiz) — decisão: v1 usa checagem manual + grep de paths (D6), sem introduzir dependência nova (consistente com o padrão "zero deps novas" do resto do harness). Documentar como débito aceitável, não bloqueante.

## Riscos e notas

- **`.pi/skills/roadmap-loop/{SKILL.md,REFERENCE.md}`** ainda descrevem AD-002 como barreira pendente ("F8 exige a decisão de licença AD-002 resolvida") — isso está **desatualizado** (AD-035 já resolveu). É um doc de processo interno (não público, não faz parte do bundle npm), portanto fora do escopo estrito do F8 (README/docs de produto) — mas deixá-lo desatualizado pode confundir o próximo loop do roadmap-loop. **Recomendação:** tratar como follow-up de 1 linha fora do F8 (ou task opcional T8, ver tasks.md) — não é um requirement novo, é higiene de processo.
- A menção da AD-035 a "comentários de atribuição existentes em F11/F13/F30/F31 etc." é **imprecisa** frente ao grep real: as atribuições de licença concentram-se em F27 (resilience)/F29 (memory) + `ROUTING.md`/`MEMORY.md`/`EVAL-MATRIX.md`. F11/F13/F30/F31 não têm hits de "atribuição de licença" no grep atual (só falsos-positivos de domínio, se algum). O grep de completude (D6) no fim do Execute serve como rede de segurança caso existam menções fraseadas sem a palavra "atribuição" (ex.: "port of X, MIT" sem o termo em português) — recomenda-se rodar também `grep -rniE "\bport(e|ed)? (de|of|from)\b.*\bMIT\b"` como sweep adicional antes de fechar a task.
- `resilience/stall.ts` promete "atribuição por função abaixo" no header — o arquivo inteiro precisa ser lido no Execute (não só a linha grepada) para achar todas as citações por função.
- Zero risco ao golden chain confirmado por leitura (D2 nota); revalidar mesmo assim como gate (D6).

## QAs (≤3 — resolver antes/durante o Execute)

1. **Idioma dos arquivos reescritos pelo F8** — o README raiz já é EN e `ROUTING.md` (F19) é EN por decisão explícita; `packages/harness/README.md` atual é PT-BR (divergente). **Recomendação: EN** para todos os arquivos que o F8 reescreve/cria (root README, umbrella README, 4 READMEs de fork, docs index) — consistente com o padrão público já estabelecido. Docs internos (`EVENTS/MEMORY/PI/EVAL-FRAMEWORK/SYNC`) continuam PT-BR, fora do escopo (só linkados). Baixo risco de estar errado; seguir a recomendação salvo objeção.
2. **Estrutura do taskflow (grupo com 9 sub-packages)** — recomendação D4: 1 README pointer novo em `packages/taskflow/README.md` para o grupo, em vez de 4–9 READMEs individuais (só `hosts/` tem um hoje, e é doc técnico interno, não lore). Confirmar se esse nível de agregação é aceitável ou se o usuário quer pointer também em `packages/taskflow/{claude,codex,opencode,grok}/README.md` (delivery packages, instaláveis via `npm install -g codex-taskflow` hoje).
3. **`packages/claude-auth`** — não faz parte do bundle F6/companion nem do roadmap M6. Recomendação D5: só grep de nome, sem rewrite. Confirmar se deve ficar totalmente fora do F8 ou se merece nota mínima no README raiz (ex.: linha na tabela de packages, já que teoricamente é instalável via `pi install npm:@runecraft/claude-auth`).
