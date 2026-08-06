# F20 Design — Receipt Leve (delivery gates)

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas (reabertas não):** (1) wrapper do harness captura o `diff_hash` — fork pr-review intocado (F10) · (2) gates = git hooks `pre-commit`/`pre-push` com seção `runecraft:` (F18) · (3) comparação v1 = `exact` + `compatible_base_advance` simplificado, projeção staged · (4) opt-in por repo (`gates.enabled`, default OFF no install) + kill switch global `harness gates disable`; com gates off os hooks reportam `disabled/unmanaged` e saem 0

## Contexto

F20 fecha o grupo WORK (AD-011): um receipt JSON imutável liga o review do pr-review ao **conteúdo** revisado (hash do diff), e gates `pre-commit`/`pre-push` re-derivam a evidência do Git vivo e negam em caso de drift — versão simplificada do RDD do gentle-ai, sem authority store, sem lineage, sem álgebra completa.

Fatos verificados (pesquisa 2026-08-05) que moldam este design:

- **pr-review**: o loop só inicia por input **interactive ou rpc** (`ReviewLoopCoordinator.begin`); em `print`/`json`/`rpc` o Pi devolve o JSON puro do review; o review validado fica no cache da sessão (entry `pr-review-completed`, schemaVersion 2) — inacessível ao CLI fora da sessão; `reviewHash` = sha256 de `JSON.stringify(review)` (função privada do fork, não exportada); o fluxo usa `gh pr view --json headRefOid` + `gh pr diff`; NÃO captura hash do diff (só `head_sha`); não-determinístico (mesmo diff → findings diferentes).
- **RDD gentle-ai** (referência conceitual): receipt imutável emitido 1x por lineage; gates read-only re-derivam evidência do Git vivo e **nunca mutam/invalidam** o receipt; fail-closed quando não bate; `--projection staged` compara a projeção do index, não o workspace; RDD off → `disabled/unmanaged` exit 0.
- **Nosso estado (F13)**: `.runecraft/state.json` (schema v1 aditivo), backups tar.gz dedupe/prune antes de modificar, escrita atômica tmp+rename, modo conservador se corrompido. **F18**: motor de seções `<!-- runecraft:<id> -->` (append/upsert/remove, nunca toca outro owner).

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Receipt é artefato da serving layer**: `harness receipt capture` produz o receipt; o fork pr-review não muda uma linha (F10 — menos diff de sync) | Decisão aprovada (1); o pr-review continua puro (review = conversa; receipt = contrato) |
| D2 | **Captura v1 = `harness receipt capture <pr>` via RPC** (fluxo automático, aprovado), com `--from <file>` (fluxo manual) como caminho garantido; hook de sessão = alternativa a validar no Execute | Fato: o loop só inicia por interactive/rpc e o RPC devolve o JSON puro — RPC é caminho de primeira classe, não hack; self-contained (CLI orquestra, deriva tudo do git local); manual cobre "rode /pr-review no TUI e salve o JSON" sem re-review; hook de sessão exigiria extensão do harness escutando entries `pr-review-completed` (API de sessão do Pi a validar) |
| D3 | **Config em `.runecraft/config.json`** (repo: `gates.enabled`) + `~/.runecraft/config.json` (global: kill switch); hooks decidem **no momento da execução** lendo os dois arquivos | Separa config do usuário do bookkeeping (`state.json` — F13 é schema de estado, não config); `enable`/`disable` viram só escrita de config — zero churn de hook; kill switch global funciona mesmo em repo cujo hook já foi instalado |
| D4 | **Hook = shim POSIX mínimo** que delega a `harness gates run <pre-commit\|pre-push>`; toda a lógica (hash, álgebra, mensagens) em TS testado no CLI | Hash/diff em shell portátil (sha256sum vs shasum) seria frágil; shim de ~10 linhas revisável; custo ~100–300 ms de Node por hook aceitável |
| D5 | **Base de comparação = `receipt.candidate.base.sha`** (nunca HEAD); comando canônico único e constante: `git diff <base> <head> --binary --full-index --no-ext-diff --no-renames` (+ `--cached` no pre-commit) | O receipt define o diff revisado; comparar contra HEAD quebraria com amend/reset/position; flags explícitas (`--no-ext-diff --no-renames`) tornam o hash imune a config do usuário (diff.external/diff.renames) — self-consistência captura↔gate |
| D6 | **Receipts append-only** em `.runecraft/receipts/<ts>.json`; gitignored (`.runecraft/` garantido no `.gitignore` pelo `gates enable`); **nunca invalidados/removidos por gate, disable ou uninstall** | RDD: receipt imutável; consultável a qualquer momento (RCPT-08 AC 4.3) |
| D7 | **Receipt só para `verdict === "approve"` E nenhum finding P0/P1**; `request_changes`/`comment`/P0/P1 → sem receipt, exit ≠ 0 | RCPT-01/03; defensivo: o pr-review garante "request_changes só com P0/P1", mas o validator não confia — verifica os dois |
| D8 | **pre-commit = `exact` apenas; pre-push = `exact` + `compatible_base_advance`**; `changed`/`unrelated`/`ambiguous`/`unknown` → nega com mensagem | O index do pre-commit não tem conceito de "base avançou" (o conteúdo candidato É o que será commitado); compatible só faz sentido no agregado do push |

## Fluxos

### 1. Schema do receipt — `.runecraft/receipts/<ts>.json`

```json
{
  "schema": "runecraft.receipt/v1",
  "candidate": {
    "head_sha": "<40hex>",
    "diff_hash": "<64hex>",
    "base": { "sha": "<40hex>", "ref": "main", "remote": "origin" }
  },
  "verdict": "approve",
  "reviewHash": "<64hex>",
  "issuedAt": "2026-08-05T14:03:22.123Z"
}
```

- `diff_hash` = sha256 do stdout de `git diff <base.sha> <head_sha> --binary --full-index --no-ext-diff --no-renames` (via node:crypto — mesmo hasher do fork).
- `base.sha` = merge-base do PR na hora do review: `git merge-base refs/remotes/<remote>/<ref> <head_sha>`; `ref` = `baseRefName` do `gh pr view`; `remote` = `branch.<atual>.remote` (fallback `origin`).
- **Validação estrita** (padrão `parsePublishableReview` — RCPT-04): schema exato `"runecraft.receipt/v1"`; `head_sha` regex `^[0-9a-f]{40}(?:[0-9a-f]{24})?$` (mesma do fork); `diff_hash`/`reviewHash` `^[0-9a-f]{64}$`; `base.sha` hex completo; `base.ref` string sem whitespace; `base.remote` string sem whitespace; `verdict === "approve"`; `issuedAt` ISO-8601 parseável. **Campos extras → rejeita** (fail-closed, sem campos livres). Falha → erro nomeando o arquivo e o campo.
- Nome do arquivo: `YYYYMMDD-HHmmss-SSS.json` (do `issuedAt`); colisão (raro) → sufixo `-1`, `-2`… Escrita atômica tmp+rename (F13 STBK-03).

### 2. Captura do diff_hash (RCPT-02)

**Fluxo automático (RPC) — v1 recomendado: `harness receipt capture <pr>`** (roda no repo dono do PR; exige `pi` + `gh` autenticado + base/head presentes localmente):

```
1. gh pr view --json number,headRefOid,baseRefName,state   → valida PR aberto (fechado: exigir --include-closed)
2. git cat-file -e <head_sha>^{commit}  e  git cat-file -e <base.sha>^{commit}
   → ausente: erro com hint (git fetch origin <ref> <head_sha>)
3. invoca o Pi não-interativo com /pr-review <pr> (forma exata — print|json|rpc — e flags
   a validar no Execute; o RPC devolve o JSON puro do review; exit code autoritativo)
4. valida o JSON do review com validator estrito próprio (espelho do parsePublishableReview —
   subset equivalente a validar no Execute; NÃO importa do fork: zero dependência)
5. verdict == "approve" && sem findings P0/P1
   → reviewHash = sha256(JSON.stringify(review)); diff_hash = sha256(git diff <base> <head> …)
   → escreve .runecraft/receipts/<ts>.json (mkdir -p + escrita atômica) → relatório
   senão → SEM receipt, exit ≠ 0, mensagem com verdict/findings bloqueantes (RCPT-03)
```

O `diff_hash` é derivado de commits imutáveis (`base..head`): mudanças posteriores no working tree/index **não** alteram o receipt — satisfaz RCPT-02 AC 1.2/1.3 por construção.

**Fluxo manual (--from) — zero re-review: `harness receipt capture <pr> --from <review.json>`**: o usuário roda `/pr-review` no TUI e manda o agente salvar o JSON final do review num arquivo; o CLI deriva head/base/diff_hash do git e monta o receipt sem custo de modelo. Cobre também "review aconteceu em outra sessão".

**Alternativa — auto-capture por hook de sessão (validar no Execute)**: extensão do harness escutando a entry `pr-review-completed` (schemaVersion 2) do cache de sessão → escreve o receipt sem re-review e sem passo manual. Depende de: API de sessão do Pi para observar entries custom + parser do `PersistedCompletedReview` (acoplamento a schema do fork, estável). Se validar, vira o fluxo default; automático/manual ficam como fallback.

**Quando o receipt é escrito**: só após review completo com `verdict === "approve"` e sem P0/P1 (D7). Review não-determinístico (fato): cada capture gera UM receipt para o diff daquela head; re-review após correções → novo receipt (append — D6).

### 3. Instalação dos hooks + config

```
harness gates enable    → 1. escreve .runecraft/config.json {schemaVersion:1, gates:{enabled:true}} (atômico)
                           2. instala hooks pre-commit/pre-push via motor de seções (F18) — família shell:
                              append/upsert do bloco `# BEGIN runecraft:gates` … `# END runecraft:gates`
                              (arquivo pré-existente preservado; criado com shebang se ausente; chmod +x;
                              SEM BOM — BOM antes de shebang quebra a execução)
                           3. garante as linhas `.runecraft/receipts/` e `.runecraft/config.json` no .gitignore
                              (append idempotente; escopo fino — não engole state.json/backups de workspace do F13)
                           4. backup F13 (snapshot dos arquivos tocados) + registra no state:
                              createdFiles (config.json; .gitignore se criado) + entry settingsChanges
                              para as linhas adicionadas no .gitignore (remoção só se inalterada — padrão SETM-05)
harness gates disable   → backup (F13) antes de escrever; kill switch global (default, decisão 4):
                          ~/.runecraft/config.json gates.enabled=false
                          [--scope workspace] → .runecraft/config.json gates.enabled=false
                          [--dry-run] [--json]; TTY: prompt de confirmação no global (não surpreender)
harness gates status    → repo/global/effective + hooks (presente? bloco runecraft:?) + receipts
                          (n, mais recente) + .gitignore + --json
harness gates run <hook>→ interno (chamado pelos hooks; também executável p/ debug)
```

**Conteúdo da seção do hook (shim, D4):**

```sh
# BEGIN runecraft:gates — gerenciado pelo harness, não editar
if command -v harness >/dev/null 2>&1; then
  exec harness gates run pre-commit
elif command -v npx >/dev/null 2>&1; then
  exec npx --no-install @runecraft/harness gates run pre-commit
else
  echo "runecraft gates: harness não encontrado (npm i -g @runecraft/harness)" >&2
  exit 1
fi
# END runecraft:gates
```

- Resolução de binário: env `RUNECRAFT_BIN` (testabilidade, padrão F11) > `harness` no PATH > `npx --no-install` (sem download; falha rápido). Binário ausente → **deny** fail-closed com remedy (instalação quebrada ≠ gates off).
- O hook resolve o root do repo e delega com stdin preservado (pre-push lê as refs via stdin).

**Config no momento da execução** (`gates run`): `effective = repo.gates.enabled === true && !(global.gates.enabled === false)`. Exit 0 (`disabled/unmanaged`) **somente** com config presente e `enabled:false` (global ou repo — kill switch consciente; nunca fabrica aprovação, padrão organic-rdd). **Hook executou + config.json ausente** (nunca habilitado, outro clone, uninstall incompleto) → **deny** "config de gates ausente — rode `harness gates enable` ou `harness doctor`" (fail-closed; revisão 2026-08-05: hook presente implica enable rodou — ausência é estado anormal, alinhado à spec edge). Config presente mas ilegível (JSON quebrado) → **deny** apontando o arquivo (o usuário pediu gates on; não arriscar interpretação).

### 4. Comparação no gate (álgebra v1 — projeção staged)

`harness gates run` re-deriva **apenas do index** no pre-commit (nunca do workspace — working tree sujo é ignorado por construção) e do **agregado de commits** no pre-push.

| Relação | Condições (git concretas) | Resultado |
| --- | --- | --- |
| `exact` (pre-commit) | sha256(`git diff --cached <base.sha> --binary --full-index --no-ext-diff --no-renames`) == `diff_hash` do receipt | passa |
| `exact` (pre-push) | `<local_sha> == head_sha` E sha256(`git diff <base.sha> <local_sha> --binary --full-index --no-ext-diff --no-renames`) == `diff_hash` | passa |
| `compatible_base_advance` (pre-push) | (1) merge-base preservado: `git merge-base refs/remotes/<base.remote>/<base.ref> <local_sha>` == `base.sha`; (2) paths idênticos: `git diff --name-only <base.sha>...<local_sha>` == `git diff --name-only <base.sha>...<head_sha>` (fast-fail diagnóstico; subsumido por 3); (3) diff idêntico: sha256(`git diff <base.sha> <local_sha> --binary --full-index --no-ext-diff --no-renames`) == `diff_hash` | passa **com aviso** ("base avançou, candidate intacto — compatible_base_advance") |
| `changed` / `unrelated` | diff_hash difere (conteúdo mudou) / merge-base preservado falha (história reescrita ou divergente) | **nega** |
| `ambiguous` / `unknown` | ref remota do base não resolvível localmente, `head_sha` ausente do repo, ou base ref ausente (fetch pendente) | **nega** com hint `git fetch` |
| sem receipt cobrindo | nenhum receipt casa | **nega** "rode /pr-review (ou review equivalente) antes de commitar" |
| receipt corrompido | JSON inválido na varredura | **nega** apontando o arquivo (fail-closed) |

- **Iteração**: receipts do mais recente para o mais antigo; primeiro match vence. Receipt inválido → erro registrado, não casa.
- **pre-push** lê stdin (`<local_ref> <local_sha> <remote_ref> <remote_sha>` por linha): `refs/tags/*` → skip (v1 não tem conceito de receipt de tag — documentado); deleção (`local_sha` zeros) → skip; `refs/heads/*` → valida **todos** (um falhou = push negado, fail-closed).
- **Casos de uso reais** (fatos de git): amend de mensagem / commit vazio → pre-push passa como compatible (conteúdo idêntico); rebase sobre base avançado → merge-base mudou → nega (conteúdo novo não revisado); merge do base no branch → diff agregado muda → nega; `--no-verify` → hook não roda (limite documentado — não é authority store, AD-011).
- **Mensagens de negação** (sempre: o quê falhou + o que fazer): sem receipt → `"runecraft gates: nenhum receipt cobre o diff do index — rode /pr-review (ou review equivalente) antes de commitar (ou: harness gates disable para bypass consciente)"`; drift → `"runecraft gates: drift — o diff atual difere do receipt <arquivo> (esperado <hash8>, obtido <hash8>)"`; changed/unrelated/ambiguous → variações com o campo que falhou; corrompido → `"receipt corrompido: <arquivo> (JSON inválido) — fail-closed, rode harness doctor"`.
- **Relação com o receipt do gentle-ai**: nossos gates nunca mutam o receipt nem o invalidam (D6); `provable_contraction` (commits parciais do conteúdo revisado) fica para Future — v1 exige o diff agregado completo (tudo ou nada, documentado).

### 5. Kill switch, status e uninstall

- **Kill switch global** (`harness gates disable`, decisão 4): escreve `~/.runecraft/config.json` → todos os hooks do usuário passam a reportar `disabled (kill switch global)` e sair 0. Hooks continuam instalados (inertes) — `enable` de volta é só config.
- **Repo off** (`--scope workspace`): idem, escopo repo.
- **Uninstall (F12 estendido)**: backup → remove o bloco shell `runecraft:gates` dos hooks (F18 família shell: só o bloco runecraft; hook pré-existente volta ao estado original; hook **criado do zero** pelo harness que ficou só com shebang → remove o arquivo inteiro — regra createdFiles, F17 D2) → remove `.runecraft/config.json` e as linhas `.runecraft/receipts/`/`.runecraft/config.json` do .gitignore **se inalteradas** (SETM-05) → **uninstall global também remove `~/.runecraft/config.json`** (kill switch criado por disable — não deixar órfão; revisão 2026-08-05) → state cleanup. **Receipts preservados** (RCPT-08 AC 4.3 — contrato de entrega, nunca apagado por gate/uninstall; remoção manual documentada).
- **doctor (F12) ganha check 17 — gates** (read-only; 16 já é do F19 — driver ativo; revisão 2026-08-05): config parseável; hooks presentes conforme config (habilitado sem hook → warn com remedy `gates enable`); receipts do dir parseáveis (corrompido → fail apontando arquivo); kill switch global ativo (info). **status (F12) ganha seção gates** (mesmos dados do `gates status`).

## Riscos

| Risco | Mitigação | Status |
| --- | --- | --- |
| `--no-verify` burla os gates | Limite documentado (não é authority store — AD-011); wrapper `harness commit`/`harness push` como alias opcional fica P3 da spec | — |
| Capture (a) re-roda o review (custo de modelo; não-determinismo → verdict pode divergir do TUI) | Fluxo (b) `--from` = caminho zero re-review; tiers leves no pr-review.json; (c) auto-capture = evolução preferida | (a) RPC a validar no Execute; (c) a validar no Execute |
| Receipts são locais (gitignored) — clone novo não os tem | Por design (AD-011, sem authority store): re-enable em clone → deny "sem receipts" fail-closed com hint doctor; documentado | — |
| Performance: diff grande (repo velho, binários) → hash caro no hook | Flags canônicas; warn stderr > 50 MB (threshold a validar no Execute); medição com repo de teste no Execute | a validar no Execute |
| Worktrees linkados: `.git/hooks` e `.runecraft/` do main root | Root resolvido por `dirname(git rev-parse --git-common-dir)` (funciona p/ repo normal e worktree); submodules/core.worktree a validar no Execute | a validar no Execute |
| Config de git do usuário (diff.external, diff.renames) muda o hash entre capture e gate | Flags canônicas `--no-ext-diff --no-renames` (D5); paridade com o diff do GitHub (renames) a validar no Execute | a validar no Execute |
| Corrida: capture concorrente / hook vs capture | Escrita atômica (F13); receipts append-only; hook só lê; sem lock no v1 (reavaliar se surgir caso real) | — |
| Hooks do gentle-ai no mesmo `pre-commit` | Seções distintas (F18): nosso bloco nunca toca o deles; se o sync deles remover o nosso → doctor 16 + sync re-injeta (paridade InjectForSync) | replace real a validar no Execute |
| `gates disable` global sem flag surpreende (desliga outros repos) | Default global por decisão aprovada (4); prompt de confirmação no TTY; `status` mostra effective; `--scope workspace` para repo | UX a validar no Execute |
| Merge do base no branch antes do push → diff inclui conteúdo não revisado → nega | Comportamento correto (fail-closed); fluxo documentado: novo review + capture, ou disable consciente | — |
| Config quebrado / binário harness ausente no hook | Deny com mensagem + remedy (nunca interpretar nem fabricar aprovação) | — |

## Requisitos cobertos

| ID | Requisito (spec F20) | Onde no design |
| --- | --- | --- |
| RCPT-01 | P1 Receipt — AC 1.1 persistência após review aprovado | Fluxo 2 (capture escreve `receipts/<ts>.json`) + schema (Fluxo 1) |
| RCPT-02 | P1 Receipt — AC 1.2/1.3 diff do momento do review | Fluxo 2: diff_hash sobre commits imutáveis `base..head`; (b) pós-review preserva o mesmo valor |
| RCPT-03 | P1 Receipt — AC 1.4 sem receipt p/ request_changes | D7: só `verdict === "approve"` e sem P0/P1; senão exit ≠ 0 sem arquivo |
| RCPT-04 | P1 Receipt — AC 1.4 schema estrito | Fluxo 1: validação estrita padrão `parsePublishableReview` (campos extras rejeitados) |
| RCPT-05 | P1 Gate pre-commit — AC 2.1/2.2/2.3/2.4 | Fluxo 4: `exact` do index vs `base.sha`; sem receipt → nega; drift → nega; off → `disabled/unmanaged` exit 0 |
| RCPT-06 | P1 Gate pre-push — AC 3.1/3.2/3.3/3.4 | Fluxo 4: `exact` + `compatible_base_advance` (3 condições); changed/unrelated/ambiguous → nega; off → exit 0 |
| RCPT-07 | P2 Kill switch — AC 4.1 | Fluxo 5: `gates disable` (global default) lido no momento da execução; hooks saem 0 reportando `disabled/unmanaged` |
| RCPT-08 | P2 Uninstall — AC 4.2/4.3 | Fluxo 5: remove seção `runecraft:gates` (F18, hooks pré-existentes preservados); receipts nunca invalidados |

**Edge cases da spec cobertos**: `--no-verify` (Riscos, limite documentado) · working tree sujo → projeção staged do index apenas (Fluxo 4) · repo sem `.runecraft/` → **deny** + hint doctor (fail-closed; revisão 2026-08-05 — ver "Config no momento da execução") · hook pré-existente → append do bloco shell `runecraft:gates`, nunca sobrescreve (Fluxo 3, F18) · receipt corrompido → deny apontando o arquivo (Fluxo 4).

**Coverage:** 8/8 mapeados.

## Módulos novos em `packages/harness` (estrutura F11)

```
src/commands/gates.ts    # enable | disable | status | run (dispatch do cli.ts F11)
src/commands/receipt.ts  # capture [<pr>] [--from <file>] | list [--json]
src/gates/config.ts      # config.json repo/global, resolução effective, kill switch
src/gates/hook.ts        # render do shim, install/remove via motor de seções (F18), chmod +x
src/gates/compare.ts     # álgebra v1 (exact/compatible/changed/unrelated/ambiguous/unknown) + mensagens
src/gates/run.ts         # gates run pre-commit|pre-push: re-derivação git + decisão + exit code
src/receipt/schema.ts    # validação estrita do receipt (padrão parsePublishableReview)
src/receipt/store.ts     # dir receipts, escrita atômica, scan + parse
src/receipt/capture.ts   # fluxo RPC (pi.ts estendido), --from, reviewHash, diff_hash
```

**Validar no Execute**: forma exata de invocar o Pi não-interativo com `/pr-review` (print|json|rpc) e capturar JSON final + exit code; PR fechado (`--include-closed`); viabilidade de ler entries `pr-review-completed` da sessão (alternativa c); equivalência do subset do validator de review; paridade `git diff` local vs `gh pr diff` (renames); resolução de root em worktrees/submodules; thresholds de performance; prompt do `gates disable` global.
