# F13 — Estado + Backups Specification

**Scope:** Medium (state.json + snapshot tar.gz com dedupe/prune; lógica copiável do gentle-ai com atribuição — AD-002/AD-008)
**Prereq:** F11 ✓ (CLI existe; state alimenta doctor/sync/uninstall do F12)
**Grupo:** SERV (F11–F14) — serving layer estilo gentle-ai em TS (AD-008)

## Problem Statement

Sync e uninstall seguros exigem saber o que o harness instalou (state), e toda modificação de config precisa de proteção reversível (backup). O gentle-ai resolve com `state.json` + snapshots tar.gz (dedupe/prune, 5 recentes); adotamos o mesmo desenho em TS, com atribuição MIT (AD-002).

## Goals

- [ ] `state.json` registra o que o harness instalou/removeu (components, versões, timestamps, escopo) — fonte para F12 e F18
- [ ] Snapshot tar.gz antes de toda modificação de config (global e projeto), com dedupe por hash e prune mantendo 5 recentes
- [ ] `harness restore <backup>` documentado e funcional

## Out of Scope

| Feature | Reason |
| --- | --- |
| Criptografia dos backups | Config local sem segredos no v1 |
| Backup remoto/cloud | Future |
| Versões pinadas de backup (pin TUI) | O gentle-ai tem TUI; aqui CLI flag `--keep` basta |

## Gray area (resolver no Design)

**Localização e formato do state**: `~/.runecraft/state.json` (global, recomendado — AD-008) com `.runecraft/state.json` no projeto quando `--scope=workspace`. Formato proposto (validar no design):

```json
{
  "version": 1,
  "installed": {
    "pi": {
      "components": {
        "subagents": { "version": "0.37.2", "installedAt": "...", "source": "npm:@runecraft/subagents" }
      },
      "scope": "global" | "workspace"
    }
  },
  "settingsChanges": ["subagents.defaultModel", "..."]  // chaves adicionadas pelo F14
}
```

**Dedupe/prune**: hash do conteúdo do snapshot (idênticos não são re-backupeados) e prune dos 5 mais recentes, com `--keep` para pinar. Validar contra a implementação do gentle-ai (trecho MIT).

## User Stories

### P1: state.json ⭐ MVP

**User Story**: Como mantenedor, quero um registro confiável do que o harness instalou, para sync/uninstall saberem o que é gerenciado.

**Why P1**: Sem state, uninstall e sync adivinham (F12 G2/G3 dependem dele).

**Acceptance Criteria**:

1. WHEN `install` roda THEN o state SHALL registrar cada component com versão, timestamp e source
2. WHEN `uninstall` roda THEN o state SHALL refletir a remoção (component removido do registro)
3. WHEN `--scope=workspace` é usado THEN o state SHALL viver em `.runecraft/state.json` do projeto (versionável no repo)
4. WHEN o state está corrompido (JSON inválido) THEN o CLI SHALL avisar e operar em modo conservador (F12 edge case), nunca sobrescrevendo o arquivo sem backup

**Independent Test**: install → ler state (json válido, 4 components); uninstall --all → state limpo.

### P1: backup antes de modificar ⭐ MVP

**User Story**: Como dev usuário, quero que toda modificação de config seja reversível, para nunca perder settings por causa do harness.

**Why P1**: É a garantia de não-destruição que permite fail-closed e não-clobber.

**Acceptance Criteria**:

1. WHEN install/sync/uninstall vai modificar `~/.pi/agent/settings.json`, `.pi/settings.json` ou `npm/package.json` THEN um snapshot tar.gz SHALL ser criado antes (nome datado, conteúdo hashado)
2. WHEN o snapshot é idêntico a um existente (mesmo hash) THEN um novo arquivo SHALL não ser criado (dedupe)
3. WHEN o número de snapshots excede 5 THEN os mais antigos SHALL ser pruned, exceto os pinados com `--keep`
4. WHEN o diretório de backups não tem espaço THEN o CLI SHALL abortar a operação antes de modificar (fail-safe)

**Independent Test**: install 2x no mesmo estado → 1 snapshot (dedupe); 7 operações → 5 snapshots.

### P2: restore

**User Story**: Como dev usuário, quero restaurar uma config a partir de um backup, para recuperar de um erro ou teste.

**Why P2**: Fecha o ciclo reversível; barato (tar.gz).

**Acceptance Criteria**:

1. WHEN `harness restore <backup>` roda THEN os arquivos do snapshot SHALL ser restaurados nos paths originais
2. WHEN o backup referenciado não existe THEN o CLI SHALL falhar listando os backups disponíveis
3. WHEN `harness backups` roda THEN SHALL listar snapshots com data, tamanho e arquivos incluídos

**Independent Test**: quebrar settings.json → restore do último backup → settings voltam (diff vazio).

## Edge Cases

- WHEN o mesmo arquivo aparece em snapshots de scopes diferentes (global/projeto) THEN o dedupe SHALL considerar path completo
- WHEN um arquivo do snapshot não existe mais no disco THEN o restore SHALL reportar e continuar com os demais
- WHEN o state.json muda mas nenhum settings muda THEN backup SHALL não ser criado (state não é config do usuário)
- WHEN symlinks aparecem nos paths de config THEN SHALL ser preservados como symlinks (não seguir/expandir)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| STBK-01 | P1: state (AC 1.1/1.2 registro) | Design | Pending |
| STBK-02 | P1: state (AC 1.3 workspace) | Design | Pending |
| STBK-03 | P1: state (AC 1.4 corrompido) | Design | Pending |
| STBK-04 | P1: backup (AC 2.1 antes de modificar) | Design | Pending |
| STBK-05 | P1: backup (AC 2.2 dedupe) | Design | Pending |
| STBK-06 | P1: backup (AC 2.3 prune) | Design | Pending |
| STBK-07 | P1: backup (AC 2.4 fail-safe) | Design | Pending |
| STBK-08 | P2: restore (AC 3.1/3.2/3.3) | Design | Pending |

**Coverage:** 8 total, 0 mapeados, 8 unmapped

## Success Criteria

- [ ] Todo install/sync/uninstall precedido por snapshot (verificável no diretório de backups)
- [ ] Dedupe e prune verificados (2x mesmo estado = 1 snapshot; >5 = 5)
- [ ] Restore documentado e funcional
