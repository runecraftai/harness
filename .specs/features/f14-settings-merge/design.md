# F14 Design — Settings Merge real

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** G3 híbrido (blocos por package + top-level limitado) · conflito reportado, nunca clobber

## Achado de pesquisa (2026-08-05): config surface é heterogênea

| Fork | Onde lê config | Shape |
| --- | --- | --- |
| subagents | settings.json do Pi | bloco `subagents.*` (`subagents.watchdog.main.model`, `subagents.modelScope.enforce`, …) |
| taskflow | settings.json do Pi | bloco `taskflow.*` (`taskflow.piChild.resourceProfile`, `taskflow.piChild.extensions`, …) |
| pr-review | **arquivo próprio `pr-review.json`** (user `~/.pi/agent/`, projeto `<repo>/.pi`) | model por tier via `/pr-review-config` |
| goal-loop-audit | nenhuma surface de settings identificada no src (config via args/env) | — |

**Implicação de design**: o merge engine NÃO opera só no settings.json do Pi — opera sobre **targets** por componente:

```
Target = { file, scope: "global"|"workspace", prefix?: string }
- subagents       → { file: settings.json,       prefix: "subagents" }
- taskflow        → { file: settings.json,       prefix: "taskflow" }
- pr-review       → { file: pr-review.json,      prefix: null (arquivo próprio — user `~/.pi/agent/pr-review.json` no global, `.pi/pr-review.json` no workspace) }
- goal-loop-audit → sem defaults no v1 (a validar no Execute — se surgir surface, vira target)
```

## Defaults v1 (propostos — validar no Execute contra o comportamento real dos forks)

Princípio: o harness **não inventa valores** — aplica os defaults do próprio upstream quando a chave está ausente, e chaves de conveniência (model por role) quando o fork suporta. Proposta inicial:

```jsonc
// settings.json do Pi — aplicado apenas se a chave NÃO existe
{
  "subagents": {
    "modelScope": { "enforce": false },          // default upstream (segurança: não forçar)
    "watchdog": { "main": { "enabled": true } }  // se default upstream
  },
  "taskflow": {
    "piChild": { "resourceProfile": "allowlist" } // validar default real no Execute
  }
}
// pr-review.json — tiers com modelo herdado (default do upstream)
```

**Validação no Execute**: experimento por fork — instalar, ler o que o fork lê (grep/rodar), registrar os defaults reais; valores propostos acima podem mudar.

## Merge algorithm (G3 híbrido)

`merge(targets, defaults, mode: "apply" | "remove")` em `src/merge.ts`:

1. **Leitura**: parse do arquivo alvo; JSON inválido → abort apontando arquivo (SETM-04), nada é modificado
2. **Merge profundo por chave** dentro do bloco gerenciado (prefix do componente); fora do bloco: nada é tocado (SETM edge: chaves desconhecidas intactas)
3. **Regra do usuário vence**: chave existente no alvo (qualquer valor) → keep; se ≠ default → **conflito reportado** no relatório (path + valor do usuário + valor do harness) (SETM-02)
4. **Arrays**: chave existente → substitui (blocos de config não são concat-enáveis com segurança); o concat dedupe só se aplica a `packages` no settings — e esse é o Pi quem gerencia, não o merge (G3: CLI não toca `packages`)
5. **Criação**: chave ausente → aplica default + registra em `settingsChanges` (SETM-03)
6. **Idempotência**: re-aplicar com os mesmos defaults → zero mudanças (SETM edge)
7. **Precedência de scope do Pi respeitada**: merge roda no alvo do scope selecionado; projeto vence global (docs/packages.md) — o harness não "corrige" a precedência (SETM edge)
8. **Fork não instalado** → defaults do fork não aplicados (SETM edge)

**Mode remove** (uninstall, SETM-05): para cada entry de `settingsChanges` do componente: valor atual == valor registrado → remove a chave; valor atual ≠ registrado (usuário editou) → preserva + reporta. Alternativa: output aponta `harness restore <backup pré-install>` (SETM 2.3).

## Relatório (SETM-06)

TTY: seções `created` / `kept (conflict)` / `removed` / `preserved (edited)`. `--json`: `{created: [{file, path}], conflicts: [{file, path, user, harness}], removed: [...], preserved: [...]}`.

## Requisitos cobertos

SETM-01..SETM-06 (tabela da spec F14).
