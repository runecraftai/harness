# F12 Design — Lifecycle: doctor / status / sync / uninstall

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** G3 estado cruzado (pi list × state.json × vendor.manifest.json)

## doctor (LIFE-01/02) — read-only garantido

Checks executados em ordem, cada um com pass/warn/fail + remedy hint:

| # | Check | Verifica | Fail/warn quando | Remedy |
| --- | --- | --- | --- | --- |
| 1 | Pi bin | `command -v pi` + `pi --version` | ausente | comando exato de instalação do Pi (CLI-04 mesmo texto) |
| 2 | Pi config | `~/.pi/agent/settings.json` (e `.pi/settings.json` se workspace) existe + JSON válido | ausente/quebrado | aponta arquivo e o erro de parse |
| 3 | Components | cada componente do state presente em `pi list`; versão instalada vs. esperada (vendor.manifest.json) | ausente/versão diverge | `harness install --component X` / `harness sync` |
| 4 | Colisão | `pi list` contém upstreams (pi-subagents, pi-taskflow, pi-goal-list-loop-audit, pi-pr-review, gentle-pi) | presente | warn: sugestão de remoção (tratamento real no F18) |
| 5 | Settings dos forks | blocos `subagents.*`/`taskflow.*` no settings parseáveis; `pr-review.json` válido se existir | inválido | aponta arquivo/bloco |
| 6 | Disco | espaço livre no dir de backups > threshold (ex.: 50 MB) | baixo | warn |

**Read-only (LIFE-01)**: nenhum check escreve; verificação por diff de mtime/hash antes/depois no teste independente.

**Dependência entre checks** (revisão 2026-08-05): checks 3–6 dependem do Pi; quando o check 1 falha (Pi ausente), os dependentes são **pulados com status `skip`** — não falham em cascata com erro enganoso.

## status (LIFE-07) — estado cruzado G3

Fonte tripla: `pi list` (real) × `state.json` (gerenciado pelo harness) × `vendor.manifest.json` (esperado).

| Coluna | Origem |
| --- | --- |
| package | versions.ts (catálogo fixo — 6 packages) |
| group | componente lógico (subagents · taskflow · goal-loop-audit · pr-review) |
| instalado | pi list (versão parseada da spec) |
| esperado | versions.ts (pin) |
| estado | ok · ausente · colisão · órfão (definições abaixo) |

Estado por **package** (6 linhas) agrupado por componente lógico — revisão 2026-08-05, alinhado com o schema do F13.

Saída TTY = tabela; `--json` = `[{component, installed, expected, state}]` (LIFE 4.2). Sem harness instalado → tabela vazia + sugestão de install (LIFE 4.3).

## sync (LIFE-06) — idempotente

```
sync [--dry-run] [--json]
```

1. Estado cruzado (status): componentes do state ausentes do pi list → plano de reinstall
2. Versões divergentes (instalada ≠ esperada) → plano de reinstall com a versão pinada
3. `--dry-run` → imprime o plano; sem flag, executa com backup antes (F13) se houver mudança
4. Após reinstalar, o state é atualizado (version/installedAt) — revisão 2026-08-05
5. Nada a fazer → "already in sync", zero writes (rerun = zero mudanças, LIFE 3.2)
5. Assets (skills/prompts/agents) não são copiados pelo sync — o package os entrega via manifest pi; divergência de assets = reinstall do package (LIFE 3.3)

**Observação de design**: sync NÃO toca settings do usuário (blocos configurados) — só restaura packages. O F14 é dono de config.

## uninstall (LIFE-03/04/05) — remoção gerenciada

```
uninstall [--component a,b] [--all] [--json] [--yes]
```

**O que é "gerenciado"** (fonte: state.json — G2+G3):

- Packages instalados via harness (specs registrados no state) → `pi remove <spec>`
- Chaves de config registradas em `settingsChanges` (F14) → remoção via merge engine (SETM-05)
- Entry do state → cleanup

**O que NUNCA é tocado**: entries pré-existentes ao install (diff registrado no state no momento do install — `preInstall` do F13), packages instalados à mão (órfãos — edge F12), qualquer config sem registro no state.

**Arquivos criados vs. pré-existentes** (revisão 2026-08-05): arquivo de config criado do zero pelo harness (ex.: `pr-review.json` inexistente antes do install) é registrado como `createdFiles` no state e **removido inteiro** no uninstall; arquivo pré-existente recebe apenas a remoção das chaves de `settingsChanges`.

**Scope** (revisão 2026-08-05): `uninstall --scope global|workspace`; default = workspace se existir `.runecraft/state.json`, senão global. State de scopes é independente (F13).

Fluxo: backup (F13) → `pi remove` por componente → merge de remoção (F14) → state cleanup → relatório (removidos / preservados / reportados). `--component` parcial (LIFE 2.1); `--all` completo (LIFE 2.2); chaves do usuário preservadas (LIFE 2.3); backup antes (LIFE 2.4); state atualizado (LIFE 2.5).

**Modo conservador** (state corrompido/ausente — edge F12): uninstall avisa e só remove o que `pi list` + settings permitem atribuir com segurança; nada de varredura agressiva.

## Falhas de `pi list` (edge)

`pi list` falha/crash → doctor/status reportam fail com erro bruto + hint, sem crash do CLI; sync/uninstall operam com fallback de leitura direta do settings.json (packages) + warn.

## Requisitos cobertos

LIFE-01..LIFE-07 (tabela da spec F12).
