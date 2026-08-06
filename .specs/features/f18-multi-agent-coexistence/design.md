# F18 Design — Coexistência multi-agente

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** (a) detecção de outro dono por marcadores conhecidos + state files conhecidos; heurística de conteúdo = aviso informativo, nunca bloqueio · (b) ownership do harness = seções `runecraft:` + entries em `agents.*.targets` (F17 D2) e `settingsChanges`/`createdFiles` (F13/F14) · (c) coexistência, nunca competição — operação não altera conteúdo de outro owner; conflito reportado, não resolvido à força

## Contexto

O harness herda o princípio de não-clobber do F14 (conflito reportado, nunca sobrescrito — SETM-02) e o estende dos settings para todos os arquivos gerenciados: CLAUDE.md/AGENTS.md (seções de texto), configs MCP dos agentes (F16), settings.json do Pi (F14, ownership por prefixo `subagents.*`/`taskflow.*`) e pr-review.json (F14/F12). Esses arquivos podem ter múltiplos donos: gentle-ai (marcadores), pacotes upstream do ecossistema Pi (pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi), outros installers de MCP (codex-taskflow/claude-taskflow/opencode-taskflow) e o usuário. F18 fecha o grupo MULA (F15–F18) definindo: motor de seções (ownership textual), detecção de donos, regras de convivência e uninstall multi-owner.

Fatos verificados (pesquisa 2026-08-05): gentle-ai delimita seções com `<!-- gentle-ai:ID --> ... <!-- /gentle-ai:ID -->` (filemerge/section.go, markerPrefix `"<!-- gentle-ai:"`) em CLAUDE.md; para OpenCode/Codex o gentle-ai usa file replace do AGENTS.md (a validar no Execute); gentle-ai persiste em `~/.gentle-ai/state.json`; o uninstall dele remove só o gerenciado (seções por marcador, JSON paths, TOML keys, arquivos inteiros) com backup antes; o sync dele re-injeta seções ausentes (InjectForSync) — análogo ao nosso sync re-injetar seções `runecraft:` apagadas à mão (MXST edge).

## Motor de seções (src/sections.ts)

**Formato do marcador** (MXST-01 AC 1.1):

```
<!-- runecraft:workflow -->
<conteúdo gerado pelo harness>
<!-- /runecraft:workflow -->
```

- Prefixo exato `<!-- runecraft:` + ID `[a-z0-9-]+` + ` -->`; escrita canônica, parse tolerante a whitespace extra
- **Família de marcadores por tipo de arquivo** (revisão 2026-08-05, revisão WORK): arquivos de texto (CLAUDE.md/AGENTS.md) usam comentário HTML `<!-- runecraft:<id> -->`; **arquivos executáveis (git hooks do F20)** usam comentário shell `# BEGIN runecraft:<id>` / `# END runecraft:<id>` (comentário HTML quebraria o shell). O motor (`sections.ts`) seleciona a família pelo tipo do alvo; ID, operações (insert/update/remove) e contentHash são idênticos entre famílias.
- **IDs estáveis entre versões do CLI** (base do update in-place): v1 usa `workflow` (definido no F15, G1); IDs futuros seguem `<componente>-<area>` — a definir quando o F16 gerar conteúdo de texto além de MCP JSON/TOML (validar no Execute)
- Marcadores **somente em arquivos de texto**; settings.json do Pi é JSON e não recebe marcadores (comentário HTML quebraria o parse) — o ownership lá continua por prefixo de chave (F14)

**Operações** (genéricas sobre IDs; lista canônica de IDs define a ordem de append):

| Operação | Regra |
| --- | --- |
| **Insert (append)** | seção ausente → append no fim do arquivo (garante newline final; arquivo inexistente/vazio → cria com a seção — F15 AC 2.4). Arquivo com conteúdo de outros donos → nada além do append (MXST-01 AC 1.2). Arquivo só-do-usuário → append, **nunca assume posse** (edge da spec) |
| **Update (in-place)** | mesmo ID encontrado → substitui apenas o conteúdo entre os marcadores; marcadores preservados (ID estável). Cobre "instalar 2x com versões diferentes do CLI" (edge da spec) |
| **Remove** | só blocos com prefixo `runecraft:`; seções de outro owner nunca são tocadas (MXST-01 AC 1.3). Após remoção: arquivo vazio (só whitespace) → remove o arquivo (padrão F15 AC 3.2); com conteúdo restante → mantém (F15 AC 3.3/3.4) |
| **Idempotência** | re-executar com o mesmo conteúdo → zero mudanças (padrão F14 SETM edge) |
| **Encoding** | arquivo não legível UTF-8 (NUL bytes/binário) → não gerenciável: warn + skip, nada é escrito (padrão F15: config quebrada aborta para aquele agente). BOM → preservar (a validar no Execute) |

**Registro no state** — integra `agents.<id>.targets` do F17 (schema v1 aditivo, **sem bump**; revisão cruzada 2026-08-05, B1). O campo top-level `sections` foi descartado: o motor de seções registra em `agents.<id>.targets` (kind `rules`: file/section/contentHash; kind `mcp`: file/entry/bin/contentHash), e o uninstall/check de seção/sync iteram `agents.*.targets`. `contentHash` = conteúdo da seção (normalizado) ou entry canônico — base do "editado pelo usuário" (mesmo padrão SETM-05 do F14): valor atual == registrado → remove; ≠ → preserva + reporta. Normalização do hash (ex.: trailing newline único) a validar no Execute. InstalledAt por seção não é registrado (arquivos são distintos por agente — F17 D1; reavaliar só se surgir arquivo compartilhado entre agentes).

**sync (F12 LIFE-06) estendido**: seção registrada no state ausente do arquivo (apagada à mão) → entra no plano como re-injeção (paridade InjectForSync do gentle-ai); `--dry-run` imprime; execução com backup antes (F13).

## Detecção de donos (src/owners.ts)

Fontes de evidência (decisão aprovada: (a)+(b) decidem, (c) só informa):

| # | Fonte | Evidência | Uso |
| --- | --- | --- | --- |
| 1 | Marcadores em arquivos de texto gerenciados | scan por prefixos conhecidos: `<!-- gentle-ai:` (deles), `<!-- runecraft:` (nosso); parse estrito de par aberto/fechado | dono por arquivo |
| 2 | State files conhecidos | `~/.gentle-ai/state.json` existe (parse best-effort; ilegível = "gentle-ai presente" sem detalhes, nunca crash — padrão F12 edge de `pi list`) | dono installer |
| 3 | `pi list` / settings.json `packages` (fallback leitura direta — F12 edge) | pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi | dono package |
| 4 | Configs MCP dos agentes (F16) | `codex-taskflow`, `claude-taskflow`, `opencode-taskflow` em `~/.claude/.mcp.json`, `opencode.json` (`mcp.*`), `~/.codex/config.toml` (`[mcp_servers.*]`) | dono MCP |
| 5 | pr-review.json | pré-existente ao install = dono upstream/usuário (AD-012) — harness nunca é dono do arquivo inteiro, só das keys registradas (F14); exceto `createdFiles` (criado do zero — F12) | dono por key |
| 6 | Heurística de conteúdo | arquivo gerenciado sem nenhum marcador conhecido → "conteúdo do usuário" | **info, nunca bloqueio** |

Saída: `detectOwners(files, opts) → { owners: [{name, kind, evidence}], byFile: {file: [owners]} }`. Scan stateless (roda a cada comando — cobre "upstream instalado depois do harness" sem watcher, edge da spec).

| Owner | kind | Severidade no install |
| --- | --- | --- |
| gentle-ai | installer | warn (gate) |
| upstreams Pi (5) | package | warn (gate — two-driver, F7) |
| taskflow-MCP upstream | MCP | warn (gate — mesmo server name no host) |
| usuário | conteúdo | info (nunca bloqueia) |

## Install com aviso (MXST-04)

```
install:
 1. detectOwners() antes de qualquer escrita; --dry-run (F15 AC 1.4) imprime o plano incluindo donos/colisões
 2. gate de colisão: owners com severidade warn → lista no TTY (owner, arquivo, impacto)
 3. confirmação explícita (não silenciosa):
    - TTY → prompt "continuar? [y/N]" (default N — fail-closed, herança F15)
    - --yes → prossegue; cada aviso é registrado no relatório (seção warnings) — MXST-04 AC 2.4
    - sem TTY e sem --yes → aborta com exit ≠ 0 apontando --yes
 4. avisos info (conteúdo do usuário) → exibidos, sem gate (decisão aprovada 1c)
 5. escrita com backup (F13) + registro no state (sections/settingsChanges)
 6. relatório (SETM-06 estendido): created / updated / conflicts / warnings
```

## Coexistência com gentle-ai (MXST-05)

| Cenário | Regra |
| --- | --- |
| Mesmo arquivo (CLAUDE.md com seções `gentle-ai:`) | append/update só do bloco `runecraft:`; seção `gentle-ai:` nunca é alterada (AC 3.1) |
| gentle-ai roda sync/uninstall depois do nosso | seções `runecraft:` permanecem — o uninstall dele remove só o gerenciado por marcador dele (comportamento verificado); teste independente: fixture com marcadores simulados (ou sync real se disponível) (AC 3.2) |
| gentle-ai faz file replace do AGENTS.md (OpenCode/Codex) | nossa seção some → doctor (check 10) detecta "seção registrada ausente" e sync re-injeta; comportamento real do replace a validar no Execute |
| MCP com mesmo server name (ex.: `taskflow`) | entries de nomes diferentes coexistem; mesmo nome → conflito reportado, entry **nunca sobrescrita** (AC 3.3); install prossegue para o resto e reporta o skip como conflict |
| `~/.gentle-ai/state.json` | somente leitura (detecção); install/uninstall nunca o tocam (out of scope da spec — migração/remoção de config do gentle-ai fora de escopo) |

## Uninstall multi-owner (MXST-02) — estende F12

```
uninstall:
 1. backup (F13) — snapshot passa a incluir os arquivos de texto (CLAUDE.md/AGENTS.md) e configs MCP (extensão do escopo F13)
 2. para cada entry de sections no state:
    - hash atual == registrado → remove o bloco `runecraft:<id>` (MXST-01 AC 1.3)
    - hash ≠ (usuário editou) → preserva + reporta `preserved (edited)` (AC 1.4 — padrão SETM-05)
    - marcador presente sem registro no state → preserva + reporta `preserved (sem registro)` (modo conservador F12: sem evidência, não remove)
 3. arquivo vazio após a remoção → remove o arquivo (F15 AC 3.2); conteúdo restante (usuário/gentle-ai/outros) → mantém intacto (F15 AC 3.3/3.4)
 4. MCP entries do harness (injecção: **F15**; bins/templates: F16) + merge de remoção dos settings (F14 SETM-05) + `pi remove` (F12)
 5. state cleanup: entries de sections/settingsChanges/createdFiles
 6. relatório: removed / preserved (edited) / preserved (outro owner) / conflicts
```

**Nunca tocado** (reafirma F12 no contexto multi-owner): seções `gentle-ai:`, conteúdo do usuário, packages instalados à mão (órfãos), qualquer arquivo sem registro no state.

## Doctor / status (F12)

Checks novos/estendidos (tabela consolidada 7–15 — absorve os checks por agente do F17 D3 e o check 4 do F12; revisão cruzada 2026-08-05, B2). Todos read-only (LIFE-01):

| # | Check | Verifica | Warn/fail quando | Remedy |
| --- | --- | --- | --- | --- |
| 7 | Detecção por agente | `command -v claude\|opencode\|codex` (binário = instalado; dir é informativo) | — (informativo) | — |
| 8 | Gerenciado? | `state.agents.<id>` existe | bin presente, state ausente → "não gerenciado" (nunca "quebrado") | `harness install --agent X` |
| 9 | Configs injetadas | seção `runecraft:workflow` presente; entry MCP `taskflow` presente | registrado mas alvo ausente → "quebrado" | `harness sync --agent X` |
| 10 | Colisão MCP upstream | entry `taskflow` com bin não-runecraft; `codex-taskflow`/`claude-taskflow`/`opencode-taskflow` em configs MCP | presente → warn — conflito de server name no host (F16) | remoção manual/guia; install não sobrescreve |
| 11 | Config do agente parseável | JSON/TOML alvo válido | inválido → fail apontando arquivo | aponta arquivo |
| 12 | Detect-only | binários de agentes sem adapter (cursor, grok, …) | presentes → informativo com guia (sem fail) | guia (F17 D4) |
| 13 | Órfãs de matriz | target no state sem célula na matriz atual (CLI mudou de versão) | presente → warn "órfã (matriz mudou)" | uninstall manual |
| 14 | gentle-ai | `~/.gentle-ai/state.json` OU marcadores `gentle-ai:` em arquivos gerenciados | presente → warn — coexistência suportada (docs) | — |
| 15 | Upstreams Pi (absorve check 4 do F12) | `pi list`/settings: pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi | presente → warn — two-driver (F7) | remover upstream antes do componente do mesmo domínio |

- Dependências: check 14 independe do Pi; checks 7–13 dependem da detecção de agentes do F15 (bin no PATH) — agente ausente → `skip` (padrão F12); check 15 depende de `pi list` (fallback settings.json, F12 edge)

**status**: tabela por package (F12) mantida; estado `colisão` = upstream Pi do mesmo domínio instalado junto com o componente nosso (two-driver); novo estado `upstream` = upstream presente e componente nosso ausente; saída ganha seção **Owners** listando donos detectados por arquivo gerenciado (gentle-ai · upstreams Pi · taskflow-MCP · usuário). `--json` ganha `{owners: [...], warnings: [...]}`.

## Riscos

| Risco | Mitigação | Status |
| --- | --- | --- |
| Falso positivo na detecção (marcador parecido tipo `gentleai:`, seção citada em exemplo do usuário, sem fechamento) | parse estrito de par aberto/fechado com prefixo exato; heurística de conteúdo nunca bloqueia; teste com corpus de arquivos reais | regex a validar no Execute |
| Arquivo binário/encoding estranho (NUL, Latin-1, BOM) | detecção de não-UTF-8 → não gerenciável (warn + skip); nada escrito em arquivo ilegível; BOM preservado | a validar no Execute |
| Seção `runecraft:` apagada à mão | sync re-injeta se registrada no state (MXST edge — paridade InjectForSync); relatório avisa "re-injetada"; sem watcher: doctor mostra pendência (check 10) | — |
| Corrida com outro installer em paralelo (gentle-ai sync, outro harness) | lock de escrita (`~/.runecraft/.lock`, flock) entre operações do harness + optimistic re-check: hash do arquivo re-lido antes da escrita; mudou desde a detecção → aborta com conflito reportado; backup (F13) garante restore | flock no bun a validar no Execute |
| `~/.gentle-ai/state.json` ilegível | "gentle-ai presente" sem detalhes + warn; nunca crash (padrão F12 edge de `pi list`) | — |
| gentle-ai faz file replace do AGENTS.md depois de nós | check 10 + sync re-injeta; comportamento documentado no relatório | replace real a validar no Execute |

## Requisitos cobertos

| ID | Requisito (spec F18) | Onde no design |
| --- | --- | --- |
| MXST-01 | P1 Ownership — AC 1.1/1.2 marcadores em toda seção; nunca alterar outro owner | Motor de seções (Insert/Update; marcadores `runecraft:`) |
| MXST-02 | P1 Ownership — AC 1.3/1.4 uninstall só `runecraft:`; editado pelo usuário → preserva + reporta | Uninstall multi-owner (hash vs SETM-05) |
| MXST-03 | P1 Detecção — AC 2.1/2.2/2.3 gentle-ai, upstreams Pi, taskflow-MCP no doctor | Detecção de donos + Doctor checks 7–9 |
| MXST-04 | P1 Detecção — AC 2.4 aviso explícito no install; `--yes` registra no relatório | Install com aviso (gate + warnings) |
| MXST-05 | P2 Convivência — AC 3.1/3.2/3.3 coexistência no arquivo, sync deles depois, MCP mesmo nome | Coexistência com gentle-ai (tabela de cenários) |

**Edge cases da spec cobertos**: arquivo só-do-usuário → append sem posse (Insert) · instalar 2x com versões diferentes → update in-place por ID (Update) · upstream instalado depois → scan stateless no próximo doctor (Detecção) · seção apagada à mão → sync re-injeta (check 10 + sync estendido).

**Coverage:** 5/5 mapeados.
