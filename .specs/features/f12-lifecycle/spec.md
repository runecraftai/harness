# F12 — Lifecycle: doctor / status / sync / uninstall Specification

**Scope:** Large (4 subcomandos; interage com estado e backups do F13)
**Prereq:** F11 ✓ (CLI existe)
**Grupo:** SERV (F11–F14) — serving layer estilo gentle-ai em TS (AD-008)

## Problem Statement

Instalar é metade da proposta; o ciclo de vida é o que transforma 4 packages num produto servido: health check read-only (doctor), reconciliação idempotente pós-upgrade (sync), visão de estado (status) e remoção limpa do que o harness gerenciou (uninstall) — sem tocar no que é do usuário.

## Goals

- [ ] `doctor` read-only com checks pass/warn/fail e remedy hint (nunca modifica config)
- [ ] `sync` idempotente: reinstala ausentes, reconcilia versões e assets; rerun = zero mudanças
- [ ] `uninstall` remove só o que o harness gerenciou (componentes selecionáveis + `--all`), preservando config do usuário
- [ ] `status` tabela: componente, versão instalada, versão esperada, estado

## Out of Scope

| Feature | Reason |
| --- | --- |
| Auto-update do CLI (`update`/`upgrade`) | F9 (publishing); v1 documenta `npm update -g` |
| Verificação de assinatura de releases | Aparato do gentle-ai (minisign); não aplicável a npm no v1 |
| CI lane automatizada dos checks | F9/F21 (evals) |
| Uninstall de configs de agentes não-Pi | M3 — F15+ |

## Gray area (resolver no Design)

**Fonte de verdade do estado**: `doctor`/`sync`/`status` leem (a) `pi list` (estado real do Pi), (b) `state.json` do F13 (o que o harness instalou), ou (c) ambos com reconciliação. Hipóteses:

- **G1 — pi list como verdade**: estado real manda; state.json é só histórico. Simples, mas não distingue "instalado pelo harness" de "instalado à mão".
- **G2 — state.json como verdade**: sync restaura o que o state registra. Distingue gerenciado vs. manual, mas pode divergir da realidade (removido à mão).
- **G3 — Estado cruzado**: `status` cruza os dois (instalado/esperado/órfão). Recomendado — necessário para uninstall seguro e para o F18 detectar upstreams.

**Semântica do uninstall**: o que conta como "gerenciado pelo harness" (entries em settings, chaves de config do F14, state) e o que é preservado (qualquer coisa pré-existente ou editada pelo usuário). Definir a linha de corte no design, registrando no state (F13) o estado pré-install.

## User Stories

### P1: doctor read-only ⭐ MVP

**User Story**: Como dev usuário, quero checar a saúde do harness sem que nada seja alterado, para saber o que está quebrado antes de pedir ajuda.

**Why P1**: É o primeiro reflexo de troubleshooting (pegada gentle-ai: "run gentle-ai doctor at any time").

**Acceptance Criteria**:

1. WHEN `harness doctor` roda THEN cada check SHALL reportar pass/warn/fail com hint de remedy, e nenhum arquivo SHALL ser modificado (verificado por diff antes/depois)
2. WHEN o Pi está ausente do PATH THEN o check de Pi SHALL falhar com o comando exato de instalação
3. WHEN um dos 4 components não está instalado THEN o check SHALL falhar apontando o componente e o comando de fix (`harness install --component X`)
4. WHEN settings.json do Pi está com JSON inválido THEN o check SHALL falhar apontando o arquivo e a linha/problema
5. WHEN um upstream original (ex.: pi-subagents) está instalado junto THEN o check SHALL reportar warn de colisão

**Independent Test**: remover um component via `pi remove` → doctor falha nesse check com hint; `pi list`/settings intactos após o doctor.

### P1: uninstall ⭐ MVP

**User Story**: Como dev usuário, quero remover o harness (ou parte dele) sem deixar lixo nem quebrar minha config, para testar ou desistir com segurança.

**Why P1**: Sem remoção limpa, instalar é um compromisso irreversível — a pegada gentle-ai tem uninstall gerenciado com backup.

**Acceptance Criteria**:

1. WHEN `harness uninstall --component goal-loop-audit` roda THEN esse component SHALL ser removido (`pi remove`) e os demais SHALL permanecer
2. WHEN `harness uninstall --all` roda THEN os 4 components SHALL ser removidos e as chaves de config adicionadas pelo F14 SHALL ser removidas
3. WHEN o usuário tem settings próprios (pré-existentes ou editados) THEN eles SHALL ser preservados intactos
4. WHEN o uninstall roda THEN um backup (F13) SHALL ser criado antes de qualquer modificação
5. WHEN o state.json (F13) registra o que foi instalado THEN o uninstall SHALL atualizá-lo para refletir a remoção

**Independent Test**: install full → editar settings com chave custom → uninstall --all → `pi list` vazio de runecraft, chave custom presente, settings do Pi válidos.

### P2: sync idempotente

**User Story**: Como dev usuário, quero que o harness se reconcilie após updates, para que packages ausentes ou desatualizados voltem ao estado esperado sem edição manual.

**Why P2**: É o que mantém o harness saudável após `pi update` ou instalações parciais.

**Acceptance Criteria**:

1. WHEN um component é removido manualmente (`pi remove`) e `harness sync` roda THEN o component SHALL ser reinstalado conforme o state (F13)
2. WHEN `harness sync` roda duas vezes THEN a segunda execução SHALL produzir zero mudanças
3. WHEN versões divergem do manifesto do harness THEN o sync SHALL reportar a divergência (instalada vs. esperada) e aplicar a esperada
4. WHEN o sync vai modificar algo THEN um backup (F13) SHALL ser criado antes

**Independent Test**: `pi remove npm:@runecraft/taskflow` → sync → `pi list` restaurado; sync 2x → diff vazio.

### P2: status

**User Story**: Como dev usuário, quero ver num relance o que está instalado e saudável, para saber o estado do meu harness.

**Why P2**: Visibilidade barata; alimenta `/harness status` (F11).

**Acceptance Criteria**:

1. WHEN `harness status` roda THEN SHALL imprimir tabela: componente, versão instalada, versão esperada, estado (ok/ausente/colisão)
2. WHEN `--json` é passado THEN a saída SHALL ser JSON válido consumível por scripts
3. WHEN nada do harness está instalado THEN SHALL imprimir estado vazio + sugestão de install

**Independent Test**: install → status mostra 4 ok; uninstall 1 → status mostra ausente.

## Edge Cases

- WHEN `pi list` falha (Pi corrompido) THEN doctor/status SHALL reportar fail com o erro bruto e hint, sem crash
- WHEN o state.json (F13) está ausente ou corrompido THEN sync/uninstall SHALL avisar e operar em modo conservador (não remover nada que não possa atribuir ao harness)
- WHEN o usuário moveu configs entre global e projeto (`-l`) THEN os checks SHALL considerar ambos os scopes
- WHEN um component foi instalado à mão (não pelo harness) THEN uninstall SHALL não removê-lo (fora do state)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LIFE-01 | P1: doctor (AC 1.1 read-only) | Design | Pending |
| LIFE-02 | P1: doctor (AC 1.2/1.3/1.4/1.5 checks) | Design | Pending |
| LIFE-03 | P1: uninstall (AC 2.1/2.2) | Design | Pending |
| LIFE-04 | P1: uninstall (AC 2.3 preserva usuário) | Design | Pending |
| LIFE-05 | P1: uninstall (AC 2.4/2.5 backup+state) | Design | Pending |
| LIFE-06 | P2: sync (AC 3.1/3.2/3.3/3.4) | Design | Pending |
| LIFE-07 | P2: status (AC 4.1/4.2/4.3) | Design | Pending |

**Coverage:** 7 total, 0 mapeados, 7 unmapped

## Success Criteria

- [ ] Doctor read-only verificado por diff (zero modificações)
- [ ] Uninstall deixa `pi list` limpo de runecraft e config do usuário intacta
- [ ] Sync idempotente (rerun sem mudanças)
