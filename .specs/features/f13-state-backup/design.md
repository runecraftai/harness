# F13 Design — Estado + Backups

**Status:** Ready for Execute (após aprovação)
**Referência de design:** gentle-ai (state.json + snapshots tar.gz dedupe/prune) — trechos MIT com atribuição em LICENSE-THIRD-PARTY (AD-002/AD-008)

## state.json

**Paths**: `~/.runecraft/state.json` (global, default) · `.runecraft/state.json` (projeto, `--scope=workspace`) (STBK-02)

**Schema** (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "scope": "global" | "workspace",
  "installedAt": "2026-08-05T12:00:00Z",
  "components": {
    "subagents":       { "group": "subagents",       "source": "npm:@runecraft/subagents",       "version": "0.37.2",  "installedAt": "ISO" },
    "taskflow-core":   { "group": "taskflow",        "source": "npm:@runecraft/taskflow-core",   "version": "0.2.6",   "installedAt": "ISO" },
    "taskflow":        { "group": "taskflow",        "source": "npm:@runecraft/taskflow",        "version": "0.2.6",   "installedAt": "ISO" },
    "taskflow-dsl":    { "group": "taskflow",        "source": "npm:@runecraft/taskflow-dsl",    "version": "0.2.6",   "installedAt": "ISO" },
    "goal-loop-audit": { "group": "goal-loop-audit", "source": "npm:@runecraft/goal-loop-audit", "version": "0.28.34", "installedAt": "ISO" },
    "pr-review":       { "group": "pr-review",       "source": "npm:@runecraft/pr-review",       "version": "1.11.4",  "installedAt": "ISO" }
  },
  "createdFiles": ["~/.pi/agent/pr-review.json"],
  "settingsChanges": [
    { "file": "~/.pi/agent/settings.json", "path": ["subagents", "watchdog", "main", "model"], "value": "<default aplicado>" }
  ],
  "preInstall": [
    { "file": "~/.pi/agent/settings.json", "hash": "sha256:<hash pré-install>", "backup": "runecraft-<ts>.tar.gz" }
  ]
}
```

**Regras de escrita:**

- `config.json` do F20 (gates) é **config, não estado** — não entra no schema do state; entra nos backups (F13) e em `createdFiles` quando criado pelo harness (revisão 2026-08-05)

- Registro por **package** (6 entries) com `group` = componente lógico — revisão 2026-08-05 (alinhado com o preset do F11 e o status do F12); `createdFiles` lista arquivos de config criados do zero pelo harness (removidos inteiros no uninstall — F12)

- Escrita atômica: tmp + rename (crash não corrompe) (STBK-03)
- Upsert por componente: install/uninstall/sync atualizam apenas as entries afetadas (STBK-01)
- Corrompido/ausente → warn + modo conservador no F12; **nunca** sobrescrever sem backup (STBK-03)
- `settingsChanges` registra exatamente o que o F14 adicionou (SETM-03) — usado pelo uninstall (F12) e pelo F18
- `preInstall` registra o hash dos arquivos tocados no momento do install — base para o uninstall distinguir "mudou depois" de "era do harness" (SETM-05)

## Backup engine (`src/backup.ts`)

**Dir**: `~/.runecraft/backups/` (global) · `.runecraft/backups/` (workspace)

**Snapshot**: tar.gz contendo apenas os arquivos que a operação vai tocar (settings.json do Pi, `.pi/settings.json`, `npm/package.json`, `pr-review.json`) + um manifest interno (`paths.json` com os paths originais, relativos ao dir de backups). Nome: `runecraft-<YYYYMMDD-HHmmss>.tar.gz` (STBK-04).

**Dedupe** (STBK-05): sha256 do tar.gz; hash já existente → descarta o novo, reusa o existente no registro.

**Prune** (STBK-06): mantém os 5 mais recentes por mtime; `--keep <id>` pina (renomeia para `*.keep` ou lista de pins em `pins.json`); pinados nunca são pruned.

**Fail-safe** (STBK-07): antes de qualquer modificação, checa espaço livre no dir de backups (statvfs, threshold 50 MB) e o sucesso do snapshot; qualquer falha → aborta a operação (nada é modificado).

**Scopes**: global e workspace têm dirs separados; dedupe considera o path completo dos arquivos (edge F13).

## restore / backups

- `harness backups` → lista snapshots (data, tamanho, arquivos incluídos, pinado?) (STBK 3.3)
- `harness restore <name>` → extrai para os paths originais via manifest; arquivo ausente no disco atual → reporta e continua (edge F13); backup inexistente → falha listando disponíveis (STBK 3.2)
- Symlinks preservados como symlinks (edge F13)

## Relação com o gentle-ai (atribuição)

Lógica de snapshot/dedupe/prune espelha o gentle-ai (`~/.gentle-ai/backups`, dedupe por conteúdo, prune 5 recentes). Trechos copiados → `LICENSE-THIRD-PARTY.md` na raiz com copyright original (AD-002). Não há cópia de estado entre projetos.

## Requisitos cobertos

STBK-01..STBK-08 (tabela da spec F13).
