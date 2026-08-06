# F6 Design — Mecanismo de Agregação

**Status:** Ready for Execute (após aprovação)
**Base:** docs/packages.md do Pi (validado em 2026-08-05)

## Contexto

O F6 precisa que `pi install npm:@runecraft/harness` carregue os 4 forks (7 packages, AD-007) numa sessão. O docs de packages do Pi confirma o padrão nativo de meta-package: dependências bundled + manifest `pi` referenciando recursos via paths `node_modules/`.

## Decisão: H1 vence (meta-package com bundledDependencies)

`packages/harness/package.json`:

```json
{
  "name": "@runecraft/harness",
  "dependencies": {
    "@runecraft/subagents": "0.37.2",
    "@runecraft/taskflow-core": "0.2.6",
    "@runecraft/taskflow": "0.2.6",
    "@runecraft/taskflow-dsl": "0.2.6",
    "@runecraft/goal-loop-audit": "0.28.34",
    "@runecraft/pr-review": "1.11.4"
  },
  "bundledDependencies": [
    "@runecraft/subagents", "@runecraft/taskflow-core", "@runecraft/taskflow",
    "@runecraft/taskflow-dsl", "@runecraft/goal-loop-audit", "@runecraft/pr-review"
  ],
  "bin": {
    "harness": "./bin/harness.ts"
  },
  "files": ["bin/", "src/", "extensions/", "dist/", "README.md"],
  "pi": {
    "extensions": [
      "./extensions/*.ts",
      "node_modules/@runecraft/subagents/index.ts",
      "node_modules/@runecraft/taskflow/dist/index.js",
      "node_modules/@runecraft/goal-loop-audit/extensions/loops/goal.ts",
      "node_modules/@runecraft/pr-review/extensions/index.ts"
    ],
    "skills": [
      "node_modules/@runecraft/subagents/skills",
      "node_modules/@runecraft/taskflow/skills"
    ],
    "prompts": [
      "node_modules/@runecraft/subagents/prompts",
      "node_modules/@runecraft/pr-review/prompts"
    ]
  }
}
```

**Por que H1 e não H2/H3:**

| Hipótese | Veredito | Razão |
| --- | --- | --- |
| H1 — shims + bundledDeps | ✅ Adotada | Padrão documentado do Pi ("bundle other pi packages... reference their resources through `node_modules/` paths") |
| H2 — manifest apontando node_modules | ✅ Caso particular do H1 | O docs valida paths `node_modules/` no manifest — H2 vira a mecânica interna do H1 |
| H3 — meta-package que edita settings | ➡️ Move para o CLI (F11) | `pi install` já é o mecanismo nativo de edição; o CLI orquestra (G3 aprovado) |

**Detalhes:**

- **Shims em `./extensions/*.ts`**: o umbrella adiciona extensões próprias (ex.: `/harness status` do F11) e re-exports quando um fork precisa de wrapper — sem wrapper, aponta direto para o `index.ts` do fork.
- **Peers**: `@earendil-works/pi-*` e `typebox` ficam em `peerDependencies` (não bundled) — o Pi fornece.
- **Pins**: versões dos forks vêm do `vendor.manifest.json` (fonte única de versão — F10).
- **Entry points verificados** (revisão 2026-08-05, manifest `pi` real de cada fork): subagents → `index.ts` · taskflow → `dist/index.js` (+ `skills/`) · goal-loop-audit → `extensions/loops/goal.ts` (sem skills/prompts no manifest) · pr-review → `extensions/index.ts` (+ `prompts/`). taskflow-core e taskflow-dsl não declaram recursos pi (só libs). Re-validar no experimento.

## Validação obrigatória no Execute (experimento local)

1. `npm pack --dry-run` → tarball inclui `node_modules/@runecraft/*` (bundled) e os paths do manifest
2. `pi install ./packages/harness` (path local) → `pi list` mostra o umbrella
3. Sessão Pi de teste → `/tf`, `/goal`, `subagent({action:"list"})`, pr-review respondem
4. Skills/prompts dos forks consultáveis (como se instalados individualmente — UMBR-01/02/03)

**Fallback se node_modules paths falharem (H1a):** copiar skills/prompts para dirs do umbrella via `postinstall` — registrado como decisão de Execute se necessário.

## Riscos

- `files` do package.json do umbrella cobre `bin/`, `src/`, `extensions/` e `dist/` gerado (o resto dos forks vem bundled) — revisado em 2026-08-05
- Multi-versão de peers entre forks → Pi isola module roots (docs: "separate installs do not collide") — validar no experimento com os 4 juntos (F7 baseline)

## Requisitos cobertos

UMBR-01 (mecanismo), UMBR-02 (4 surfaces), UMBR-03 (settings default → F14), UMBR-04 (doctor → F12).
