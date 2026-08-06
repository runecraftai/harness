# F11 Design — CLI @runecraft/harness

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** G3 híbrido (pi install para packages; escrita direta só para config) · detecção por binário no PATH · presets minimal/full · dry-run · --json

## Contexto

O CLI é a serving layer do harness (AD-008): um binário Node/TS dentro do package `@runecraft/harness` (que também é o umbrella do F6). Roda via `npx @runecraft/harness`; a sessão Pi ganha `/harness` pela extensão do mesmo package. Zero deps de runtime além das do Node (node:child_process, node:fs, node:zlib, node:util.parseArgs).

## Estrutura de módulos

```
packages/harness/
├── package.json          # bin.harness + manifest pi (F6) + deps bundled
├── bin/harness.ts        # entry do CLI = wrapper FINO sobre dispatch() (contrato F21 D1, revisão 2026-08-05 — I3:
│                         #   shebang + exit code; parseArgs migra para dentro de cli.ts/dispatch())
├── src/
│   ├── cli.ts            # parser de flags: install|doctor|status|sync|uninstall|restore|backups
│   ├── pi.ts             # interop com o binário pi (detect/install/remove/list)
│   ├── state.ts          # load/save state.json (schema F13), modo conservador
│   ├── backup.ts         # snapshot engine (F13)
│   ├── merge.ts          # merge engine (F14)
│   ├── plan.ts           # presets + componentes → plano de install
│   ├── report.ts         # saída TTY e --json (created/kept/conflicts)
│   └── commands/
│       ├── install.ts    # orquestração do install (fluxo abaixo)
│       ├── doctor.ts     # checks (F12)
│       ├── status.ts     # tabela cruzada (F12)
│       ├── sync.ts       # reconciliação (F12)
│       ├── uninstall.ts  # remoção gerenciada (F12)
│       └── restore.ts    # F13
└── extensions/
    └── harness-status.ts # slash command /harness (F11 CLI-07)
```

## Fluxo do install (CLI-01..10)

```
install [--component a,b] [--preset minimal|full] [--dry-run] [--json] [--scope global|workspace] [--yes]
```

1. **detectPi** (`src/pi.ts`): `command -v pi` + `pi --version`. Ausente → stderr com o comando exato de instalação do Pi + exit 1 (CLI-04). `~/.pi/agent/settings.json` ausente → warn (segue; `pi install` cria).
2. **Plano** (`src/plan.ts`): presets = lista de specs npm pinados. Fonte de versão: **`src/versions.ts` gerado no build a partir do `vendor.manifest.json`** — o vendor.manifest.json não é publicado no package npm (revisão 2026-08-05):
   - `minimal` → 6 packages: `npm:@runecraft/subagents@0.37.2`, `npm:@runecraft/taskflow-core@0.2.6`, `npm:@runecraft/taskflow@0.2.6`, `npm:@runecraft/taskflow-dsl@0.2.6`, `npm:@runecraft/goal-loop-audit@0.28.34`, `npm:@runecraft/pr-review@1.11.4`
   - Components expostos no CLI (`--component`): `subagents` (1 pkg) · `taskflow` (3 pkgs: core+pi+dsl) · `goal-loop-audit` (1 pkg) · `pr-review` (1 pkg) — o state (F13) registra por package com `group`
   - `full` → minimal + merge de defaults (F14)
   - `--component` filtra o preset; `--preset` default = `minimal`
3. **dry-run** → imprime plano (componentes, specs, arquivos que serão tocados) e sai sem aplicar (CLI-03).
4. **Backup** (F13): snapshot dos arquivos que serão modificados antes de qualquer write (STBK-04).
5. **Instalação**: para cada spec → spawn `pi install <spec>` (G3: delegação — resolução/dedup/scope são do Pi). Falha de um componente → registra, segue os demais, exit ≠ 0 no final (edge F11).
6. **State** (F13): registra cada **package** instalado (6 entries) com seu `group` — revisão 2026-08-05 (STBK-01). Em `--scope=workspace`, state e instalação vão para `.pi/`/`.runecraft/` do projeto (`pi install -l`).
7. **Se full**: merge (F14) + `settingsChanges` (SETM-03).
8. **Relatório** (`src/report.ts`): TTY → tabela; `--json` → `{installed: [...], kept: [...], conflicts: [...], failed: [...]}` (SETM-06).

**Idempotência** (CLI-08): `pi install` dedupa por identidade (docs/packages.md); merge é idempotente; state é upsert. Rerun = sem duplicatas, sem clobber.

**Colisão** (CLI-09): antes de instalar, `pi list` + scan do settings por upstreams (`pi-subagents`, `pi-taskflow`, `pi-goal-list-loop-audit`, `pi-pr-review`, `gentle-pi`) → warn com sugestão de remoção (nunca remove sozinho; tratamento completo no F18).

**Rollback** (CLI-10): componente falho não entra no state; backup do passo 4 permite `harness restore` manual; retry sugerido. Rollback automático completo = Future.

## Interop com o binário pi (`src/pi.ts`)

| Operação | Chamada | Uso |
| --- | --- | --- |
| detect | `pi --version` | existência + versão (CLI-04) |
| install | `pi install <spec>` / `pi install -l <spec>` | packages (G3) |
| remove | `pi remove <spec>` | uninstall (F12) |
| list | `pi list` | estado real (F12 G3) |

- Exit code do `pi` é autoritativo; stdout/stderr capturados para o relatório.
- Parse do `pi list`: defensivo (formato pode variar entre versões) → fallback: ler `packages` do settings.json diretamente.
- **Testabilidade**: env `RUNECRAFT_PI_BIN` aponta para um fake pi (script) — base da suite determinística do F21.
- **Contrato (F21 D1, revisão 2026-08-05 — I3)**: `ctx.piInterop` default = spawn via `RUNECRAFT_PI_BIN` — um único mecanismo de fake do pi; `dispatch(argv, ctx)` é o entry testável (in-process) da camada 1 do F21.

## Presets — documentação

`--help` lista presets e components com o que cada um inclui (CLI-06). Components expostos: `subagents`, `taskflow` (core+pi+dsl como unidade), `goal-loop-audit`, `pr-review`.

## /harness (CLI-07)

`extensions/harness-status.ts` registra o slash command; delega para a mesma lógica de `status` (F12) importando os módulos do próprio package (mesmo module root — sem problema de isolamento). `/harness` ausente → instrução de install (AC 2.2).

## Riscos

- `npx` baixa a cada execução → doc `npm i -g @runecraft/harness` como alternativa; decisão de distribuição no F9.
- Node < 22.19 no PATH do usuário → warn (edge F11), não bloquear.
- Mudança de formato do `pi list` → parse defensivo + fallback settings.
- F6 não executado ainda → este design assume o mecanismo H1 (validado no experimento do F6); se H1a (postinstall copy) for necessário, os paths do plano de backup mudam — revisitar.

## Requisitos cobertos

CLI-01..CLI-10 (tabela da spec F11).
