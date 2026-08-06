# F17 Design — Matriz de componentes por agente

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** matriz v1 = tabela da spec F17 (Pi full; Claude/OpenCode/Codex = taskflow-MCP + regras; outros = detect-only) · fail-closed por célula com motivo · grok vendorado mas detect-only · state registra por agente (sem deduplicar components entre agentes)

## Contexto

F11–F14 entregam o CLI Pi-only; F15/F16 entregam adapters (3 agentes) e a camada MCP do taskflow. A matriz é o contrato que liga os dois lados: define exatamente o que cada agente recebe, e o CLI a aplica por coluna — recusando com motivo o que não é suportado (fail-closed por célula) e oferecendo detect-only com guia para o resto (honestidade da matriz, AD-009). Este design orquestra F15/F16 dentro do fluxo do F11 e estende F12 (doctor/status) e F13 (state/backup) para agentes não-Pi.

## Decisões

### D1 — Matriz declarativa em `src/matrix.ts` (fonte única)

A matriz vive em código, como tabela declarativa agente × componente. É a única fonte de "o que cada agente suporta" — install/doctor/status/sync leem dela (nunca de strings espalhadas):

```ts
// packages/harness/src/matrix.ts
export type AgentId = "pi" | "claude-code" | "opencode" | "codex";
export type ComponentId = "subagents" | "taskflow" | "goal-loop-audit" | "pr-review" | "rules";

export const AGENTS: Record<AgentId, AgentDef> = {
  pi:          { binary: "pi",       display: "Pi",          note: "nativo (F2–F5)" },
  "claude-code": { binary: "claude", display: "Claude Code", note: "" },
  opencode:    { binary: "opencode", display: "OpenCode",    note: "" },
  codex:       { binary: "codex",    display: "Codex",       note: "solo-agent (sem permissions/output styles — regras adaptadas)" },
};

export type Cell =
  | { kind: "pi-packages"; group: string }          // spec(s) resolvidos via versions.ts (F11)
  | { kind: "mcp"; entry: string }                  // entry MCP no config do host (bin via F16/versions.ts)
  | { kind: "rules"; file: string; section: string }// seção com marcador runecraft: em arquivo de texto
  | { kind: "native" }                              // entregue por outros componentes; sem ação no install
  | { kind: "unsupported"; reason: string };        // fail-closed por célula

export const MATRIX: Record<AgentId, Partial<Record<ComponentId, Cell>>> = {
  pi:          { subagents: { kind: "pi-packages", group: "subagents" },
                 taskflow:  { kind: "pi-packages", group: "taskflow" },
                 "goal-loop-audit": { kind: "pi-packages", group: "goal-loop-audit" },
                 "pr-review": { kind: "pi-packages", group: "pr-review" },
                 rules:     { kind: "native" } },
  "claude-code": { taskflow: { kind: "mcp", entry: "taskflow" },
                   rules:    { kind: "rules", file: "~/.claude/CLAUDE.md", section: "runecraft:workflow" },
                   subagents: { kind: "unsupported", reason: "subagents é extensão Pi; use --agent pi" },
                   "goal-loop-audit": { kind: "unsupported", reason: "goal-loop-audit é extensão Pi; use --agent pi" },
                   "pr-review": { kind: "unsupported", reason: "pr-review é extensão Pi; use --agent pi" } },
  opencode:    { taskflow: { kind: "mcp", entry: "taskflow" },
                 rules:    { kind: "rules", file: "~/.config/opencode/AGENTS.md", section: "runecraft:workflow" },
                 ...células unsupported idênticas ao claude-code },
  codex:       { taskflow: { kind: "mcp", entry: "taskflow" },
                 rules:    { kind: "rules", file: "~/.codex/AGENTS.md", section: "runecraft:workflow" },
                 ...células unsupported idênticas },
};
```

- **Célula `pi-packages`**: a spec vem do versions.ts (F11) — a matriz só carrega o `group`; não duplica pins. `taskflow` no Pi = 3 packages (core+pi+dsl), como no F11.
- **Célula `mcp`**: o entry `taskflow` aponta para o bin do fork (`@runecraft/taskflow-<host>`); a resolução do path (local no dev / publicado) é do F15 (gray area (b) do F16) — **validar no Execute**.
- **Célula `rules`**: arquivo alvo + id de seção (padrão F18 `runecraft:<section>`). Arquivos são **distintos por agente** (CLAUDE.md / AGENTS.md do opencode / AGENTS.md do codex) — sem arquivo compartilhado entre agentes; a seção tem o mesmo id por arquivo, a posse por agente vem do state (D2).
- **Célula `rules` no Pi = `native`**: as regras chegam ao Pi via forks/extensão do harness (F6) — sem ação do CLI no install. **Validar no Execute** como exatamente a regra chega ao Pi.
- **Nota por agente**: limitação verificada do gentle-ai (Codex é solo, sem permissions/output styles) aparece como `note` no `AGENTS` e é refletida na tabela de status e no conteúdo das regras injetadas (F15 renderiza templates por agente; conteúdo exato **validar no Execute**).
- **Detect-only**: `--agent` fora da matriz → não há célula; o CLI trata como detect-only (D4). Lista curada opcional (`cursor`, `grok`, …) só para guia melhor (grok tem adapter vendorado no F16 mas fora da matriz — decisão 3) — **validar no Execute** a lista curada e os paths da guia (F8).

### D2 — State (F13) ganha `agents`; schemaVersion permanece 1

Aditivo, sem mudança de semântica de nenhum campo existente → **sem migração**. O parser do state deve ignorar campos desconhecidos (parse tolerante, mesmo espírito do parse defensivo do `pi list` no F12); se um dia mudarmos semântica de campo existente, aí sim schemaVersion 2 + migração.

```jsonc
{
  "schemaVersion": 1,
  "scope": "global" | "workspace",
  "components": { /* inalterado — F13: 6 packages Pi com group */ },
  "createdFiles": ["~/.pi/agent/pr-review.json", "~/.claude/CLAUDE.md", "~/.claude/.mcp.json"],
  "settingsChanges": [ /* inalterado — dono F14 (merge do settings do Pi) */ ],
  "preInstall": [ /* inalterado — F13 */ ],
  "agents": {
    "claude-code": {
      "installedAt": "ISO",
      "harnessVersion": "0.1.0",              // diagnóstico de órfãs de matriz (D7)
      "targets": [
        { "component": "rules",    "kind": "rules", "file": "~/.claude/CLAUDE.md", "section": "runecraft:workflow",
          "contentHash": "sha256:<conteúdo da seção normalizado>" },
        { "component": "taskflow", "kind": "mcp",    "file": "~/.claude/.mcp.json", "entry": "taskflow", "bin": "<path resolvido do fork>",
          "contentHash": "sha256:<entry JSON canônico (command/args)>" }
      ]
    },
    "opencode": { "installedAt": "ISO", "targets": [ /* rules AGENTS.md + mcp opencode.json */ ] }
  }
}
```

Regras:

- **Registro por agente, nunca deduplicado entre agentes** (decisão 4): `taskflow-MCP` em claude-code e opencode = 2 entries `agents.*.targets` independentes. Cada config é independente; o uninstall de um agente não consulta nem afeta o outro (os arquivos alvo são distintos — D1).
- **Relação com `createdFiles`**: continua sendo a lista global de arquivos criados do zero pelo harness — agora inclui CLAUDE.md/AGENTS.md/.mcp.json/opencode.json/config.toml criados do zero. **Revisão da regra do F12 para alvos de adapters**: arquivo criado do zero é removido inteiro no uninstall **somente se, após a remoção das seções/entries `runecraft:`, ficar vazio** (ou JSON `{}`); se o usuário adicionou conteúdo, o arquivo permanece e é reportado (F15 AC 3.2/3.3). A regra antiga (remoção integral) permanece para createdFiles do Pi (ex.: pr-review.json).
- **Relação com `settingsChanges`**: permanece dono do merge do Pi (F14). Os upserts MCP de agentes não-Pi **não** entram lá — são registrados em `agents.*.targets` (kind `mcp`), que é a fonte de verdade do uninstall para não-Pi.
- **`preInstall`**: inalterado — registra hash dos arquivos tocados (agora incluindo configs de agentes) no momento do install; o snapshot cobre os arquivos novos (D5).
- **F17 é o dono do schema `agents`** (revisão cruzada 2026-08-05, B1): F15 e F18 referenciam este schema; o campo top-level `sections` do F18 foi descartado — uninstall/check 10/sync do F18 iteram `agents.*.targets`. Bump de schemaVersion fica reservado a mudança de semântica de campo existente.
- **`contentHash` gravado por target** (rules: conteúdo da seção normalizado; mcp: entry canônico command/args) é a base do "editado pelo usuário" (padrão SETM-05 do F14) — cobre edição de `args`/`command`, não só `bin` (que permanece como diagnóstico no target mcp).

### D3 — Doctor/status (F12) estendidos por agente

**doctor** ganha checks por agente, depois do check 6 (mesma regra de skip: binário do agente ausente → `skip`, nunca falha em cascata). A numeração final da tabela consolidada (7–15) vive no F18 (revisão cruzada 2026-08-05, B2); aqui ficam os checks funcionais:

| Check (funcional) | Verifica | Fail/warn quando | Remedy |
| --- | --- | --- | --- |
| Detecção por agente | `command -v claude\|opencode\|codex` (binário = instalado; dir é informativo) | — (informativo) | — |
| Gerenciado? | `state.agents.<id>` existe | binário presente e state ausente → **"não gerenciado"** (nunca "quebrado") | `harness install --agent X` |
| Configs injetadas | seção `runecraft:workflow` presente; entry MCP `taskflow` presente | state registra mas alvo ausente → **"quebrado"** | `harness sync --agent X` |
| Colisão MCP upstream | entry `taskflow` aponta para bin não-runecraft (ex.: npx pin upstream) | presente → warn (F18) | remoção manual/guia; install não sobrescreve |
| Config do agente parseável | JSON/TOML alvo válido | inválido → fail apontando arquivo + erro | aponta arquivo |
| Detect-only | binários de agentes sem adapter (cursor, grok, …) | presentes → **informativo** com guia manual (sem fail) | guia (D4) |
| Órfãs de matriz | target no state cuja célula não existe mais na coluna da matriz (CLI mudou de versão) | presente → warn "órfã (matriz mudou)" | uninstall manual |

**status** cruza agora 3 fontes por agente — **configs reais × state × coluna esperada da matriz** (espelho do cruzamento do F12 para packages):

- TTY: tabela de packages (F12, inalterada) + seção **Agentes** com uma linha por agente da matriz e uma coluna por componente. Célula: `ok` · `ausente` · `não gerenciado` · `colisão` · `órfã` · `—` (agente não detectado: não avaliado) · `não suportado` (célula `unsupported`, com motivo no tooltip/legenda). A `note` do Codex (solo) aparece na legenda.
- `--json`: ganha chave `agents` ao lado da lista de packages existente (forma atual preservada — compatibilidade):

```jsonc
{ "packages": [ /* F12 inalterado */ ],
  "agents": [
    { "agent": "claude-code", "detected": true, "managed": true,
      "components": [ { "component": "rules",    "supported": true,  "state": "ok" },
                      { "component": "taskflow", "supported": true,  "state": "colisão" },
                      { "component": "subagents", "supported": false, "reason": "subagents é extensão Pi; use --agent pi" } ] }
  ] }
```

Sem harness instalado → mesma regra do F12 (tabela vazia + sugestão de install), agora por agente.

### D4 — Detect-only: reportar com guia, nunca falhar

- **install**: `--agent cursor` (fora da matriz) → sem fail-closed (não há célula para recusar); o CLI reporta detect-only com guia de instalação manual (arquivos/configs a editar à mão) e exit 0. Em `--agent pi,cursor` (misto), o Pi prossegue e o cursor é reportado (F15 AC 1.3).
- **doctor**: check 8 — binário presente → linha informativa com guia; ausente → nada.
- **status**: linha na seção Agentes marcada "detect-only (guia)" quando o binário é detectado.
- **Guia**: template estático por agente curado (ex.: grok → apontar MCP manualmente para o bin do `@runecraft/taskflow-grok` vendorado, fora da matriz); agente desconhecido → guia genérica apontando para a doc (F8) de configuração manual de MCP stdio. Paths exatos da guia **validar no Execute** (depende de F8).

### D5 — Fluxo install multi-agente (orquestra o F11)

```
install [--agent pi,claude-code,...] [--component a,b] [--preset minimal|full] [--dry-run] [--json] [--scope global|workspace] [--yes]
```

Default `--agent` = `pi` (F11 preservado, sem breaking change). `--preset` só afeta o Pi (lista de packages); agentes não-Pi recebem **sempre a coluna completa** da matriz (2 componentes fixos no v1); `--component` filtra por célula com fail-closed. Ordem:

| Passo | Ação | Origem |
| --- | --- | --- |
| 1 | Detecta os agentes pedidos (`command -v`) | F15 (binário = instalado; dir informativo) |
| 2 | Fail-closed de detecção: agente da matriz pedido com binário ausente → recusa com o comando exato de instalação do binário (display-only, nunca executado), exit ≠ 0 | F15 AC 1.1 |
| 3 | **Valida matriz por par (agente × componente)**: célula `unsupported` → recusa com motivo (D1); agente fora da matriz → detect-only (D4). `detectPi` só roda se o plano incluir células `pi-packages` | F17 (MATR-01/03) |
| 4 | **Plano por agente** (`src/plan.ts` + `src/matrix.ts`): por agente, itens `pi-spec` (versions.ts) / `rules` (file+section) / `mcp` (file+entry+bin); refusals e detect-only anexados | F11 plan estendido |
| 5 | `--dry-run` → imprime o plano por agente (arquivos alvo) sem escrever | F15 AC 1.4 |
| 6 | **Backup único antes de qualquer write** (F13): snapshot dos arquivos que a operação vai tocar = união de settings do Pi (se houver) + arquivos de regras + configs MCP dos agentes. Engine do F13 não muda (é dirigido por lista de paths) | F13 STBK-04 |
| 7 | **Aplicar por agente** (ordem da matriz): Pi → `pi install <spec>` (G3 F11, falha de componente registrada e segue); adapters → F15 injeta (seção `runecraft:` append, upsert MCP JSON/TOML). Config quebrada de um agente → aborta **só** aquele agente, apontando o arquivo, sem tocar os demais | F11 passo 5 + F15 edge |
| 8 | State: `components` (packages Pi, como hoje) + `agents.<id>.targets` (novo); `createdFiles`/`preInstall` atualizados | F13 + D2 |
| 9 | Relatório por agente (TTY tabela / `--json` com `agents`): aplicado / refusals (motivo) / detect-only (guia) / falhas | F11 report estendido |

**Idempotência** (rerun = zero mudanças): append de seção com marcador é idempotente (F15); upsert MCP é idempotente; state é upsert (F13 STBK-01).

**Exit codes**: 0 = ok (inclui detect-only puro); ≠ 0 = recusa fail-closed, binário ausente, config quebrada ou falha de componente (mesmo contrato do F11 — falha parcial reportada, exit ≠ 0 no final).

### D6 — Fluxos derivados (uninstall/sync estendidos)

- **uninstall `--agent X`**: backup (F13) → remoção das seções `runecraft:` e entries MCP via `agents.<id>.targets` (kind rules/mcp; bin editado → preserva+reporta, padrão SETM-05) → createdFiles: remove arquivo só se vazio após a remoção (D2) → cleanup do state. `--agent pi` = fluxo F12 atual. Componentes do Pi nunca são tocados por uninstall de agente não-Pi e vice-versa. `--scope` segue o F12.
- **sync `[--agent a,b]`**: (1) packages Pi — fluxo F12 inalterado; (2) agentes gerenciados: seção/entry ausente → re-injeta (backup antes); (3) **matriz mudou entre versões**: aplica a coluna nova (re-injeta o que entrou) **sem remover** targets de versões anteriores que a matriz atual não mapeia — reporta como "órfã (matriz mudou)" (check 9). Sync nunca remove: remoção é contrato do uninstall (modo conservador, mesmo espírito do F12).

## Riscos

- **Matriz desatualizada vs versão do CLI** (state gravado por CLI antiga, matriz nova): sync aplica a coluna nova sem remover órfãs — reportar (D6). Mitigação: `harnessVersion` por agente no state (D2) para diagnóstico; fixture da matriz no F21.
- **Mesmo componente em 2+ agentes**: não deduplicar (decisão 4) — risco de "economia" errada que quebraria o uninstall independente; teste de fixture cobre (install em 2 agentes → uninstall de 1 → o outro intacto).
- **Upstream instalado à mão** (ex.: entry `taskflow` apontando para `claude-taskflow@0.2.6` do registry): colisão → F18; doctor 7c warn; install **aborta para o agente** (nunca sobrescreve entry com bin diferente); `--yes` registra o aviso no relatório (F18 AC 2.4).
- **TOML upsert** (`config.toml` do codex): sem parser TOML de runtime (zero deps — F11) → upsert por bloco/linhas (estilo marcadores), preservando comentários e conteúdo desconhecido; mecânica é do F15 — **validar no Execute** (strings com `#`, arrays multiline).
- **Parser do state**: CLIs antigas (pré-F17) lendo state com `agents` → parse tolerante obrigatório (campos desconhecidos ignorados); se não for tolerante, modo conservador do F12. **Validar no Execute** a implementação atual do parser.
- **Guia detect-only com paths errados** → dano de confiança; paths validados no Execute contra docs reais (F8); lista curada começa mínima (grok) ou vazia.

## Requisitos cobertos

| Requirement | Como o design cobre |
| --- | --- |
| MATR-01 (install aplica a coluna) | D1 (matriz declarativa, célula por par) + D5 passos 3–4 (validação e plano por agente a partir da coluna; `--agent pi` = coluna completa via F11). Nuance (revisão cruzada 2026-08-05, I1): `--agent pi` aplica a coluna de **packages**; os **settings** do Pi (AC 1.2) entram com `--preset full` (default = minimal — F11) — AC 1.2 mapeia para preset full |
| MATR-02 (doctor/status por agente) | D3 (checks 7–7d por agente com estado; status cruza configs reais × state × matriz; `--json.agents` com component/state) |
| MATR-03 (fail-closed por célula) | D1 (células `unsupported` com motivo — "goal-loop-audit é extensão Pi; use --agent pi") + D5 passo 3 (recusa antes de qualquer write, exit ≠ 0, falha parcial reportada) |
| MATR-04 (detect-only com guia) | D4 (install sem fail + guia manual, doctor check 8, status; misto prossegue o suportado) |
| MATR-05 (estado/backup multi-agente) | D2 (`agents.*.targets` por agente; createdFiles/preInstall estendidos; uninstall com backup; sync reconcilia seções `runecraft:` + entries MCP) |

**Cobertura:** 5/5. Edge cases da spec endereçados: sem dedup entre agentes (D2), "não gerenciado" ≠ "quebrado" (D3 check 7a), órfãs de matriz sem remoção (D6), colisão upstream → F18 (Riscos).
