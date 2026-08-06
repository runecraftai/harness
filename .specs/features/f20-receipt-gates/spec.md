# F20 — Receipt Leve (delivery gates) Specification

**Scope:** Large (extensão do pr-review p/ captura de diff + receipt JSON + gates pre-commit/pre-push)
**Prereq:** F19 ✓ (routing define quando o review acontece); F5 ✓ (pr-review fork)
**Grupo:** WORK (F19–F20) — RDD simplificado sem authority store (AD-011)

## Problem Statement

O gentle-ai resolve "revisar e entregar com segurança" com o RDD: o review congela o candidato e emite **um receipt** que os delivery gates (pre-commit/pre-push/pre-PR) validam — sempre fail-closed, nunca fabricando aprovação. Nosso pr-review produz um review JSON validado com `head_sha` e `reviewHash`, mas (pesquisa 2026-08-05): (a) **não captura o hash do diff** (só o SHA do head — force-push com mesmo head é indistinguível), (b) o resultado vive no cache da sessão (sem export), (c) é não-determinístico (mesmo diff → findings diferentes). F20 adiciona a camada de receipt: hash do candidato capturado no momento do review + artefato persistido + gates que re-derivam a evidência do Git vivo e negam em caso de drift — versão simplificada do RDD (sem authority store, sem lineage, sem álgebra completa — AD-011).

## Goals

- [ ] Receipt JSON persistido após review aprovado: `{schema, candidate: {head_sha, diff_hash, base}, verdict, reviewHash, issuedAt}`
- [ ] `diff_hash` capturado no momento do review (extensão mínima do fork pr-review ou wrapper do harness — decidir no design)
- [ ] Gates `pre-commit` e `pre-push` (git hooks instalados pelo CLI, opt-in por repo) validam o receipt: ausente/drift → nega com mensagem; kill switch global
- [ ] Uninstall remove os hooks; receipts em `.runecraft/receipts/` (gitignored)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Authority store, lineage, `terminal_state`, threat model | AD-011: receipt leve sem o aparato Go |
| Ágebra de relação completa (7 condições do gentle-ai) | v1 = `exact` + `compatible_base_advance` simplificado; resto Future |
| Gates `pre-pr` e `release` | Future; v1 cobre commit/push |
| Review obrigatório em todo commit | Opt-in por repo (`gates.enabled`); default OFF no install (não surpreender) |
| Gates para agentes não-Pi | pr-review é Pi-only (AD-009/F17); não-Pi ficam sem gates no v1 (documentado) |

## Gray area (resolver no Design)

**Onde o diff_hash é capturado**: (a) extensão no fork pr-review (no fluxo do `/pr-review`, após `gh pr diff`, computar `git diff base...head --binary --full-index | sha256` e incluir no ReviewLike), ou (b) wrapper do harness (o CLI roda o review via RPC, captura o diff externamente e monta o receipt). **Recomendado: (b)** — não mexe no fork (menos diff de sync, F10), o receipt é responsabilidade da serving layer; o pr-review continua puro. Validar no Execute a viabilidade do wrapper via RPC não-interativo (pesquisa: "só inicia por input interactive ou rpc").

**Onde os gates vivem**: (a) git hooks (`pre-commit`/`pre-push` no `.git/hooks/` — o CLI instala com seção `runecraft:` preservando hooks existentes, padrão F18; burlável com `--no-verify`, aceito no v1), ou (b) wrapper (`harness commit`/`harness push` — zero conflito, mas só protege quem usa o wrapper). **Recomendado: (a)** — gates reais no fluxo git; wrapper fica como aliase opcional (P3).

**Comparação no gate**: v1 só `exact` (diff_hash do receipt == diff_hash re-derivado do working tree/index) + `compatible_base_advance` simplificado (merge-base preservado + paths do diff idênticos + diff_hash do candidate idêntico — para o caso de rebase/novos commits no base). `changed`/`unrelated` → nega; `ambiguous` → nega com mensagem. Validar no Execute as condições exatas com casos reais.

**Receipt para fluxo sem review**: com `gates.enabled` e sem receipt para o diff atual → gate nega com "rode /pr-review primeiro" (fail-closed, padrão gentle-ai); kill switch `harness gates disable` → gates ausentes/desativados, exit 0, "nunca fabrica aprovação" (padrão organic-rdd).

## User Stories

### P1: Receipt gerado após review ⭐ MVP

**User Story**: Como dev usuário, quero que um review aprovado vire um artefato verificável, para que a entrega prove o que foi revisado.

**Why P1**: Sem o artefato, o review é conversa; com ele, é contrato (conceito RDD).

**Acceptance Criteria**:

1. WHEN um review do pr-review termina com verdict aprovado (sem P0/P1) THEN um receipt SHALL ser persistido em `.runecraft/receipts/<ts>.json` com `{schema, candidate: {head_sha, diff_hash, base}, verdict, reviewHash, issuedAt}`
2. WHEN o diff revisado não é o diff atual do working tree/index THEN o receipt SHALL registrar o diff_hash do momento do review (não o atual)
3. WHEN o review termina com `request_changes` THEN nenhum receipt SHALL ser emitido (apenas se P0/P1 forem resolvidos e o review re-rodar)
4. WHEN o receipt é escrito THEN ele SHALL ser validado contra o schema (JSON estrito — padrão `parsePublishableReview` do pr-review)

**Independent Test**: PR de teste com diff conhecido → review → receipt existe com diff_hash = sha256 esperado; review com P0 → sem receipt.

### P1: Gate pre-commit ⭐ MVP

**User Story**: Como dev usuário, quero que o commit seja bloqueado se o que estou commitando não foi o que foi revisado, para nunca entregar o que não passou por review.

**Why P1**: É o gate que protege a entrega (fail-closed).

**Acceptance Criteria**:

1. WHEN `gates.enabled` está ativo e um receipt cobre o diff do index THEN o commit SHALL prosseguir
2. WHEN `gates.enabled` está ativo e NENHUM receipt cobre o diff do index THEN o gate SHALL negar com a mensagem "rode /pr-review (ou review equivalente) antes de commitar"
3. WHEN o diff do index difere do diff_hash do receipt (drift: mudou algo depois do review) THEN o gate SHALL negar com mensagem de drift (diff re-derivado ≠ registrado)
4. WHEN `gates.enabled` está inativo THEN o hook SHALL não bloquear (exit 0) e SHALL reportar `disabled/unmanaged` — nunca fabricar aprovação

**Independent Test**: repo de teste com gates on → commit sem review nega; review → commit passa; editar arquivo após review → commit nega (drift).

### P1: Gate pre-push ⭐ MVP

**User Story**: Como dev usuário, quero que o push valide o mesmo receipt, para que rebase/amend não burlem a revisão.

**Why P1**: O push é o gate de fronteira (o gentle-ai valida em todos os gates).

**Acceptance Criteria**:

1. WHEN o push contém apenas commits cujo diff agregado casa com um receipt (exact) THEN SHALL prosseguir
2. WHEN o base avançou mas o candidate é compatível (merge-base preservado + paths idênticos + diff do candidate idêntico — `compatible_base_advance` simplificado) THEN SHALL prosseguir com aviso
3. WHEN o diff agregado não casa nenhum receipt (changed/unrelated/ambiguous) THEN SHALL negar com mensagem
4. WHEN `gates.enabled` está inativo THEN SHALL não bloquear (exit 0)

**Independent Test**: push após review → passa; rebase sem mudar o candidate → passa (compatible) ou nega conforme condição; mudar um arquivo do candidate → nega.

### P2: Kill switch e uninstall

**User Story**: Como dev usuário, quero desligar os gates globalmente ou por repo, para não ser bloqueado quando o review não faz sentido (WIP, experimentos).

**Why P2**: O gentle-ai tem kill switch user-owned; sem ele, o produto vira obstáculo.

**Acceptance Criteria**:

1. WHEN `harness gates disable` roda THEN os hooks SHALL parar de bloquear (exit 0) e reportar `disabled/unmanaged`
2. WHEN `harness uninstall` roda THEN os hooks instalados pelo harness SHALL ser removidos (seção `runecraft:` no hook — hooks pré-existentes preservados)
3. WHEN um receipt existe mas os gates estão desligados THEN os gates SHALL não validar nada (o receipt continua válido para consulta — nunca invalidado por gate, padrão gentle-ai)

**Independent Test**: disable → commit sem review passa; uninstall → hook limpo (sem seção runecraft:).

## Edge Cases

- WHEN `--no-verify` é usado THEN o hook não roda (limite documentado do v1 — não é authority store)
- WHEN o working tree está sujo além do diff revisado THEN o gate SHALL comparar APENAS o diff do index (projeção index, não workspace — padrão `--projection staged` do gentle-ai)
- WHEN o repo não tem `.runecraft/` (receipts de outro clone) THEN o gate SHALL negar com "receipts não encontrados" (fail-closed) e sugerir `harness doctor`
- WHEN o hook já existe com conteúdo do usuário THEN o harness SHALL fazer append com seção `runecraft:` (nunca sobrescrever — F18)
- WHEN o receipt é corrompido (JSON inválido) THEN o gate SHALL negar com mensagem apontando o arquivo (fail-closed)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| RCPT-01 | P1: Receipt (AC 1.1 persistência) | Design | Pending |
| RCPT-02 | P1: Receipt (AC 1.2 diff no momento do review) | Design | Pending |
| RCPT-03 | P1: Receipt (AC 1.3 sem receipt p/ request_changes) | Design | Pending |
| RCPT-04 | P1: Receipt (AC 1.4 schema estrito) | Design | Pending |
| RCPT-05 | P1: Gate pre-commit (AC 2.1/2.2/2.3/2.4) | Design | Pending |
| RCPT-06 | P1: Gate pre-push (AC 3.1/3.2/3.3/3.4) | Design | Pending |
| RCPT-07 | P2: Kill switch (AC 4.1) | Design | Pending |
| RCPT-08 | P2: Uninstall (AC 4.2/4.3) | Design | Pending |

**Coverage:** 8 total, 0 mapeados, 8 unmapped

## Success Criteria

- [ ] Review aprovado → receipt com diff_hash correto (teste independente)
- [ ] Gates pre-commit/pre-push fail-closed: sem receipt nega, drift nega, off não bloqueia
- [ ] Uninstall remove os hooks preservando hooks pré-existentes
