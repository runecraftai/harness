# F29 — Memory (runes → Pi) Specification

**Scope:** Large (multi-component: port da camada db SQLite via bun:sqlite + repository + 10 agent tools como tools Pi + wiring de extensão + config no state F13 + bridge F28 promoted.jsonl + CLI + skill + evals — pilar 7 "memória persistente")
**Prereq:** F13 ✓ (state schema v1 aditivo — config surface), F21 ✓ (fixture ScriptedScenario, evalTest → evidência, EVAL-MATRIX). F28 em execução (`.runecraft/lessons/promoted.jsonl` versionado = memória de time — **F29 consome**; contrato cross-feature MEM-06, não bloqueia — bridge idempotente, read-only)
**Grupo:** M7 — Garantias (pilar 7 do doc do usuário: memória persistente cross-session). Decisão 6 do usuário: **runes (SQLite via bun:sqlite) preferido; Engram é fallback SOMENTE se runes for inviável** — verificado VIÁVEL (D12, evidência empírica abaixo)

## Problem Statement

O harness entrega garantias de **execução** (F24), **saída** (F25), **continuidade** (F27) e **observabilidade/lessons** (F28, em execução), mas **não tem memória durável consultável por tool**: lessons promovidas pelo F28 terminam em `.runecraft/lessons/promoted.jsonl` (memória de time versionada) que **nada consome ainda**; decisões/correções/convenções tomadas numa sessão evaporam na próxima (o agente só "lembra" o que está no transcript/continuation). O arcanum resolve isso com `packages/runes` — plugin OpenCode de memória persistente por repo, SQLite, 10 tools `rune_*`; o port ao Pi exige trocar o acoplamento OpenCode (plugin `tool()`/`Plugin`, config JSONC, skill) por mecanismos reais do harness (extensão Pi via manifest `pi.extensions`, `pi.registerTool(defineTool(...))`, config no state F13, kill switch).

**Fatos verificados (sem fabricação — source lido na íntegra):**
1. **Fonte do port** — `/home/rehem/Projects/arcanum/packages/runes` (lido na íntegra: db/, lib/, plugin/, tools/, config/, bin/, tests/): **10 tools** registradas em `src/tools/registry.ts` — `rune_save`, `rune_search`, `rune_get`, `rune_update`, `rune_delete`, `rune_context`, `rune_timeline`, `rune_stats`, `rune_session_start`, `rune_session_end`; **8 categorias** (`db/types.ts`): project_rules, architecture, constraints, config_values, naming, decisions, corrections, learnings; **schema v1** (`db/schema.sql`): `projects`, `sessions`, `memories` + `memories_fts` (FTS5, `tokenize='unicode61 remove_diacritics 2'`, triggers `memories_ai/ad/au/soft_delete_au` em tabela REAL) + `schema_meta` (version, migrations.ts SCHEMA_VERSION=1).
2. **Portabilidade** — `db/sqlite.ts` JÁ tem branch bun:sqlite (`loadDatabaseSync`: isBun → `require("bun:sqlite").Database`); `db/repository.ts` usa só `prepare/exec/run/get/all` + `randomUUID` + zod (validável à mão); tools devolvem strings JSON. Acoplamento OpenCode: (a) helper `tool()` de `@opencode-ai/plugin`, (b) interface `Plugin`, (c) paths de config JSONC (`~/.config/opencode/runes.jsonc` + `<dir>/.opencode/runes.jsonc`), (d) skill `using-runes`, (e) agent hardcoded `"opencode"` em `rune_context`/`rune_session_start`.
3. **Viabilidade bun:sqlite VERIFICADA empiricamente (Bun 1.3.14 do harness, probes em /tmp):** Database abre; `PRAGMA journal_mode = WAL` → `"wal"` em arquivo; FTS5 (`CREATE VIRTUAL TABLE ... USING fts5`) funciona com match "café" E "cafe" (diacríticos removidos); **schema.sql REAL executado** → save + FTS match + soft-delete remove do índice (trigger `memories_au`); triggers em tabela REAL escrevendo em FTS5 OK. → **runes VIÁVEL** (D12).
4. **SDK 0.81.0** — `defineTool` exportado (`dist/index.d.ts`) e `pi.registerTool(defineTool({...}))` verificado no fork glla (`extensions/loops/goal.ts:2621+`) — padrão do port (D3).
5. **appendEntry (SDK) = log de sessão** (append por sessão) — NÃO persiste entre sessões; não é o mecanismo de memória. O DB em arquivo É a memória cross-session (D2 — resolução honesta do wording do roadmap "via appendEntry + state F13").
6. **Sinks atuais** — `events/` + `lessons/promoted.jsonl` (F28, donos), `continuation.json` (F27), `verify-verdicts.jsonl` (F25), ledger glla (F24/F27). Nenhum é memória consultável por tool; fronteiras em D7.
7. **Config do source** — `category_cap` (default 10, usado na compaction), `disabled_tools` (usado), `data_dir` (usado); **`importance_floor` é PARSED mas NUNCA enforced no source** (achado honesto — não portar); `disabled_skills` é skill-system OpenCode (n/a no Pi).

## Goals

- [ ] **Port da camada db**: schema v1 runes AS-IS (projects/sessions/memories/memories_fts + triggers + schema_meta v1) em bun:sqlite (zero deps novas), WAL + foreign_keys + busy_timeout + retry de abertura (semântica `db/client.ts`) — MEM-01
- [ ] **Port do Repository**: semântica completa (save/search/get/update/soft-delete/context/timeline/stats/session start/end + compaction por categoria) com DI de relógio/id para determinismo (F21 D10) e tie-break determinístico em ordenações — MEM-02
- [ ] **10 agent tools como Pi tools**: MESMOS nomes (`rune_*`) e MESMA semântica via `pi.registerTool(defineTool(...))` — offline, local, SQLite; adaptações: `tool()`→`defineTool`, zod→validação manual, agent `"opencode"`→`RUNECRAFT_AGENT_ID`; kill switch `RUNECRAFT_MEMORY=0` → tools ausentes, zero arquivos — MEM-03
- [ ] **Memória cross-session**: o arquivo `.runecraft/memory/runes.db` É a memória (persiste entre sessões por construção); scoping por repo (slug do remote git normalizado — port de `lib/project.ts`); worktrees do mesmo repo compartilham; WAL = leitores concorrentes + escritor serializado — MEM-04
- [ ] **Config surface**: seção `memory` ADITIVA no state F13 (schemaVersion 1 — padrão guards/verification/resilience): `{enabled, categoryCap (10), disabledTools, importLessonsOnStart (false)}` + env `RUNECRAFT_MEMORY_DATA_DIR` + freeze por sessão — MEM-05
- [ ] **Bridge F28**: import IDEMPOTENTE de `.runecraft/lessons/promoted.jsonl` (F28 é dono; F29 lê, nunca reescreve) → memórias categoria `learnings` com marcador `where_ref="lesson:<id>"`; CLI `harness memory import-lessons [--dry-run]` — MEM-06
- [ ] **CLI**: `harness memory search|stats|doctor [--purge]|import-lessons` (port do `bin/runes.ts`) — MEM-07
- [ ] **Skill + docs**: `using-runes` portada como skill Pi (manifest `pi.skills`) + `docs/MEMORY.md` + seção ROUTING + `.gitignore` (`.runecraft/memory/`) — MEM-08
- [ ] **Privacidade**: conteúdo de memória vive SÓ no DB; events/state/continuation/logs guardam só hashes (padrão argsHash F28) — EVAL-038 — MEM-09
- [ ] **Evals**: EVAL-030..038 no EVAL-MATRIX **v7** aditivo (lane F21, offline/$0) — MEM-10

## Out of Scope

| Feature | Reason |
| --- | --- |
| Engram / memória via appendEntry do SDK | Decisão 6: Engram só se runes inviável — verificado VIÁVEL (D12); appendEntry é log de sessão (domínio do F28), não memória (D2) |
| Reescrever/alimentar lessons do F28 | F28 é dono de `lessons/promoted.jsonl`; F29 só IMPORTA (read-only, idempotente — fronteira MEM-06) |
| Memória compartilhada entre repos (memória de time global) | v1 = memória por repo (semântica runes); memória de time = promoted.jsonl do F28 (versionado, commit-worthy) |
| Migração de dados de `~/.runes` legado | QA-1; v1 = `.runecraft/memory/` (migração manual documentada se o usuário escolher (b)) |
| Injeção automática de digest de memória no system prompt (`before_agent_start`) | QA-2; v1 = tool-driven via skill (`rune_context`); injeção = P2 (mecanismo F28/F27 existe, mas adiciona chaining) |
| Criptografia/scrubber de secrets | runes v0.3 planejava scrubber; v1 documenta "não salvar secrets" (skill) — zero deps |
| Replanejar F21..F28 | Reuso de padrões (fixture F21, state F13, kill switch F24/F25/F27/F28, markers F28) |

## Gray area (resolver antes do Execute — 5 decisões do usuário)

Opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Storage**: (a) **recomendado** — `.runecraft/memory/runes.db` por repo (gitignored, WAL, escopo packages/harness, evals em temp dir via env) · (b) `~/.runes/runes.db` (default original — reutiliza dados de uma instalação runes legada)
- **QA-2 — Modelo de recall**: (a) **recomendado** — tool-driven (skill manda o agente chamar `rune_context` no início e `rune_search` antes de agir; zero rewrite de prompt) · (b) auto-digest via `before_agent_start` (injeção de memórias recentes no systemPrompt — mecanismo F28, chaining extra) · (c) ambos. **Honesto:** o wording do roadmap "memória cross-session via appendEntry + state F13" não corresponde aos mecanismos reais — appendEntry é log de sessão (não persiste); o DB é a memória; state F13 carrega a CONFIG (D2)
- **QA-3 — Bridge F28**: (a) **recomendado** — CLI explícito `harness memory import-lessons` + `importLessonsOnStart: false` (determinístico, auditável) · (b) auto=true sempre · (c) sem bridge no v1
- **QA-4 — Skill**: (a) **recomendado** — portar `using-runes` como skill Pi (manifest `pi.skills`, padrão subagents/taskflow) · (b) docs-only
- **QA-5 — CLI**: (a) **recomendado** — port completo (`search|stats|doctor [--purge]|import-lessons`) · (b) só tools + import (CLI mínimo)

**Já decidido (não é gray area):** zero deps novas (bun:sqlite builtin; zod→validação manual; `tool()`→`defineTool` do SDK); offline/$0; escopo packages/harness; requirement IDs MEM-01..10; EVAL-MATRIX v7 aditivo com notas datadas (F21 D9); evidência via `evalTest()` (F21); timestamps nunca em identidades (F21 D10 — created_at/updated_at são payload informacional; evals injetam relógio); kill switch `RUNECRAFT_MEMORY=0` (convenção F24/F25/F27/F28); DB local gitignored; conteúdo de memória nunca logado cru (privacidade — argsHash F28); runes é o caminho (decisão 6) salvo blocker de Execute (D12).

## User Stories

### P1: Memória persistente cross-session (tools + db) ⭐ MVP — MEM-01/02/03/04

**User Story**: Como usuário, quero que decisões, correções, regras do projeto e aprendizados salvos numa sessão estejam disponíveis em qualquer sessão futura do mesmo repo — via tools `rune_*` que o agente chama — para não repetir erros e respeitar convenções já decididas.

**Why P1**: É o pilar 7 na forma mais básica (memória durável + tools); sem o DB/tools, bridge (MEM-06), CLI (MEM-07) e docs (MEM-08) não têm base.

**Acceptance Criteria**:

1. WHEN uma sessão Pi roda com o harness THEN os 10 tools `rune_save/search/get/update/delete/context/timeline/stats/session_start/session_end` estão registrados (MESMOS nomes e semântica do source runes — tabela D3) e operam offline num SQLite local
2. WHEN o agente salva uma memória (`rune_save` com categoria/título/what/why/where_ref/learned/importance) THEN ela persiste em `.runecraft/memory/runes.db` (WAL) e é encontrável por `rune_search` (FTS5; soft-deleted excluído) e `rune_context` (recent + relevant)
3. WHEN uma nova sessão começa no MESMO repo (nova instância de extensão ou novo processo) THEN as memórias da sessão anterior estão lá (cross-session por construção — o DB é a memória; D2)
4. WHEN o repo tem remote git THEN o slug é derivado do remote normalizado (port `lib/project.ts` — regex SSH/HTTPS, strip `.git`); worktrees do mesmo repo compartilham memória; sem remote → path absoluto
5. WHEN `rune_save` faz a categoria estourar o cap THEN compaction sinaliza candidatos (softCap, default 10) e poda acima do hardCap (2×) por `(importance ASC, created_at ASC)` em transação — semântica source
6. WHEN a mesma sequência de ops roda 2x com relógio/id injetados THEN resultados IDÊNTICOS (determinismo; FTS5 rank determinístico para mesmo corpus+query; tie-break explícito — D6)
7. WHEN `RUNECRAFT_MEMORY=0` THEN nenhum tool `rune_*` é registrado e nenhum arquivo é criado (kill switch)

**Independent Test**: fixture F21 — sessão scriptada chama `rune_save` ×2 + `rune_search` + `rune_get` + `rune_context` → resultados com shape do source; 2ª sessão (nova instância de Repository no mesmo DB temp) encontra as memórias; determinismo 2 runs; kill switch → zero tools/arquivos.

### P1: Config + privacidade — MEM-05/09

**User Story**: Como mantenedor, quero controlar a camada de memória via state F13 (padrão da casa) e garantir que conteúdo de memória nunca vaze para o event store/logs (só hashes).

**Why P1**: Config/kill switch é o contrato de governo de toda feature do harness (F24/F25/F27/F28); privacidade é constraint dura do briefing (memória é dado privado do usuário).

**Acceptance Criteria**:

1. WHEN o state F13 tem a seção `memory` THEN a extensão a consome (`enabled`, `categoryCap`, `disabledTools`, `importLessonsOnStart`); ausente → defaults; freeze por sessão (snapshot no init — padrão D12 F24)
2. WHEN `RUNECRAFT_MEMORY=0` THEN a camada fica inerte (sem tools, sem import, zero arquivos criados); CLI recusa com mensagem (fail-visible)
3. WHEN uma sessão grava eventos F28 THEN os `tool:call/result` dos `rune_*` carregam `argsHash` (sha256 normalizado — F28 D2) — NUNCA o conteúdo de memória cru (sentinel assertável ausente do arquivo de eventos)
4. WHEN memória é salva THEN o conteúdo existe apenas no DB (nunca em state.json, continuation.json, lessons.jsonl, events/, logs)
5. WHEN config inválida THEN defaults + problema reportado (doctor) — fail-closed (padrão F24 D10)

**Independent Test**: unit config (defaults/freeze/kill); integração — sessão com `rune_save` de sentinel → scan de `events/*.jsonl` não contém o sentinel; conteúdo presente só no DB (EVAL-038).

### P2: Bridge F28 lessons → memória — MEM-06

**User Story**: Como mantenedor, quero que lessons promovidas pelo F28 (memória de time versionada) virem memórias pesquisáveis do repo — sem duplicação e sem tocar na fonte.

**Why P2**: Fecha o ciclo pilar 7 (lessons aprendidas → memória consultável); a fonte continua dona do F28.

**Acceptance Criteria**:

1. WHEN `harness memory import-lessons` roda THEN cada lesson de `.runecraft/lessons/promoted.jsonl` vira uma memória categoria `learnings` (`title`=trigger, `what`=antiPattern+preferred, `where_ref="lesson:<lessonId>"` — chave de idempotência)
2. WHEN o import roda 2x THEN o 2º run não duplica (mesmo `where_ref` → skip) e o arquivo fonte fica byte-idêntico (F28 é dono)
3. WHEN `importLessonsOnStart=true` THEN o import roda no init da extensão (após registrar tools; idempotente)
4. WHEN `--dry-run` THEN relatório do que seria importado sem escrever nada
5. WHEN promoted.jsonl não existe/está vazio THEN import é no-op (exit 0, sem ruído)

**Independent Test**: fixture promoted.jsonl com 2 lessons → import → 2 memórias com marcador; 2º import → 0 novas; fonte intacta (hash byte-a-byte); dry-run → zero writes.

### P2: CLI + skill + docs — MEM-07/08

**User Story**: Como usuário/mantenedor, quero inspecionar e manter a memória do terminal (search/stats/doctor+purge) e ter o guia de uso do agente (skill `using-runes` portada) + docs.

**Why P2**: O CLI é o port do bin runes (manutenção); a skill é o que faz o agente REALMENTE usar as tools (sem ela, memória fica órfã).

**Acceptance Criteria**:

1. WHEN `harness memory search "q"` roda THEN markdown table de matches (port `bin/runes.ts`; busca no DB local, `searchAllProjects`)
2. WHEN `harness memory stats` roda THEN contagens por categoria + last activity (`getStats`)
3. WHEN `harness memory doctor [--purge]` roda THEN checa drift FTS (memories vs memories_fts) e com `--purge` hard-deleta soft-deleted + rebuild (`rebuildFts`)
4. WHEN a skill `using-runes` está no manifest `pi.skills` THEN o agente recebe a diretriz (rune_context no início; rune_save em decisão/correção; rune_search antes de agir; curadoria top-10; "não salvar secrets")
5. WHEN `docs/MEMORY.md` + ROUTING existem THEN schema/tools/fronteiras/privacidade documentados e roteamento atualizado

**Independent Test**: CLI unit com DB temp (search/stats/doctor drift induzido → purge corrige); manifest contém `skills/using-runes`; docs conferidas contra types.ts/schema.sql (checklist).

### P2: Evals + governança — MEM-10

**User Story**: Como mantenedor, quero EVAL-030..038 provando o port (round-trip, cross-session, determinismo, bridge, kill switch, privacidade) — matriz v7 aditiva — para a memória não regredir.

**Why P2**: Mesma política dos demais pilares (F21 D9 — matriz aditiva, evidência determinística offline).

**Acceptance Criteria**:

1. WHEN a suite `memory` roda THEN EVAL-030..038 executam no runner do F26 offline/$0 (fixture F21 + DB temp via `RUNECRAFT_MEMORY_DATA_DIR`)
2. WHEN o case de determinismo roda THEN 2 runs produzem resultados IDÊNTICOS (mesmos ops, relógio/id injetados — F21 D10)
3. WHEN a matriz roda THEN EVAL-MATRIX v7 aditiva (EVAL-030..038 + nota datada) e o teste de consistência varre a nova suite
4. WHEN `bun test` roda THEN sem regressão (pós-F28) + novos verdes offline/$0; zero chamadas LLM

**Independent Test**: cada case valida schema F26; determinismo 2 runs; consistência matriz↔suites; evidência no last-run.json.

## Edge Cases

- WHEN não há git root THEN slug = path absoluto do cwd (port `lib/project.ts` — fallback)
- WHEN o DB não existe ainda THEN aberto + migrado no init da extensão (idempotente — schema.sql IF NOT EXISTS + schema_meta)
- WHEN a abertura do DB falha (corrompido/lockado) THEN retry (1×/100ms — port `db/client.ts`) e, persistindo, tools ausentes + aviso no guardLog (fail-closed; a sessão segue sem memória)
- WHEN a mesma categoria estoura o hardCap THEN poda os mais antigos de menor importância em transação (BEGIN/COMMIT/ROLLBACK — port `pruneOldestLowestPriority`)
- WHEN duas sessões concorrem no mesmo repo THEN WAL + busy_timeout 5000 serializa escritores (leitura concorrente OK — D4)
- WHEN uma memória é soft-deletada THEN some de search/get/context (trigger FTS remove) mas permanece no storage até `doctor --purge`
- WHEN o mesmo comportamento já é coberto por EVAL-006/007/014/019/022..029 THEN sem duplicação — delta documentado no case (ex.: F28 recorder já observa tool_call; F29 não re-testa o recorder)
- WHEN um caso roda 2x THEN resultados idênticos (mensagens sem $TMP/$TS — F21 D10; asserts excluem payload volátil quando relógio não injetado)
- WHEN promoted.jsonl tem lesson cujo `where_ref` colide com memória existente THEN skip (idempotência por marcador — nunca sobrescreve memória do usuário)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MEM-01 | P1: Port da camada db (bun:sqlite, schema v1 as-is, WAL, migrations idempotentes) | Design | Pending |
| MEM-02 | P1: Port do Repository (CRUD/sessions/stats/compaction + DI relógio/id + tie-break) | Design | Pending |
| MEM-03 | P1: 10 tools rune_* como Pi tools (registerTool, mesma semântica, adaptações) | Design | Pending |
| MEM-04 | P1: Persistência cross-session (DB = memória; scoping por repo; WAL; worktrees) | Design | Pending |
| MEM-05 | P1: Config surface (state `memory` aditivo + kill switch + freeze) | Design | Pending |
| MEM-06 | P2: Bridge F28 promoted.jsonl (import idempotente, fonte intocada) | Design | Pending |
| MEM-07 | P2: CLI `harness memory` (search/stats/doctor+purge/import-lessons) | Design | Pending |
| MEM-08 | P2: Skill using-runes + docs/MEMORY.md + ROUTING + .gitignore | Design | Pending |
| MEM-09 | P1: Privacidade (memória só no DB; eventos/logs só hashes) | Design | Pending |
| MEM-10 | P2: Evals EVAL-030..038 + EVAL-MATRIX v7 + consistência | Design | Pending |

**Coverage:** 10 total, 0 mapeados, 10 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] 10 `rune_*` tools funcionais como Pi tools (mesmo nome/semântica do source; round-trip save→search→get→update→delete em DB temp provado por teste)
- [ ] Schema v1 runes AS-IS em bun:sqlite (FTS5 + triggers + WAL + migrations idempotentes — verificado empiricamente, D12)
- [ ] Cross-session provado: 2 instâncias/processos no mesmo DB → memória persiste; scoping por repo (remote slug); worktrees compartilham
- [ ] Determinismo: mesma sequência de ops com relógio/id injetados → resultados idênticos (2 runs); tie-break explícito em ordenações (D6)
- [ ] Config aditiva `memory` no state (schemaVersion 1) + kill switch `RUNECRAFT_MEMORY=0` inerte (zero tools/arquivos) + freeze por sessão
- [ ] Bridge F28 idempotente (2º import = zero duplicatas; fonte byte-idêntica) + `--dry-run`
- [ ] CLI `harness memory search|stats|doctor [--purge]|import-lessons` funcional (port do bin)
- [ ] Privacidade: conteúdo de memória ausente de events/state/continuation/logs (assert de sentinel no EVAL-038); presente só no DB
- [ ] EVAL-030..038 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v7 aditivo com notas datadas; sem regressão pós-F28
- [ ] Fronteiras explícitas: F28 dono de lessons; F29 importa read-only; events/ dono F28; memory/ dono F29
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
