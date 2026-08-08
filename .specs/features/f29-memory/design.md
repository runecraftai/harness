# F29 Design — Memory (runes → Pi)

**Status:** Ready for Execute (QA-1..5 resolvidas — AD-029)
**Decisões aprovadas (usuário/briefing, travadas):** decisão 6 (runes preferido; Engram só fallback) · roadmap M7 (port de `packages/runes` com os 10 agent tools como tools Pi; memória cross-session via mecanismos do Pi + state F13 — **reescrita honesta no D2**) · zero deps novas (bun:sqlite builtin; zod→validação manual; `tool()`→`defineTool`) · offline/$0 · escopo packages/harness · EVAL-MATRIX aditivo v7 com notas datadas (F21 D9) · evidência via evalTest (F21) · timestamps nunca em identidades (F21 D10) · kill switch `RUNECRAFT_MEMORY=0` (convenção) · privacidade (argsHash F28 — conteúdo de memória nunca logado cru) · nada sai sem AD

## Contexto

F13 entregou o state (schema v1 aditivo — config surface). F21 entregou a infra determinística (fixture, ScriptedScenario, evalTest, EVAL-MATRIX). F24/F25/F27 entregaram guards/verificação/resiliência (kill switch + freeze por sessão + continuidade). F28 (em execução) entregará o event store + lessons com promoção em `.runecraft/lessons/promoted.jsonl` (VERSIONADO — memória de time) e **deferiu a memória persistente explicitamente** ("F29 consome se/quando" — Out of Scope do F28). **Nada consome promoted.jsonl ainda** — o F29 fecha o ciclo.

**Fonte do port — `packages/runes` (lido na íntegra, `/home/rehem/Projects/arcanum/packages/runes/`):**
- **db/**: `schema.sql` (v1 — 4 tabelas + FTS5 + 4 triggers em `memories` + índices; idempotente IF NOT EXISTS), `migrations.ts` (SCHEMA_VERSION=1 + `schema_meta`), `client.ts` (openDatabase: `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, retry 1×/100ms), `sqlite.ts` (loadDatabaseSync — JÁ tem branch bun:sqlite via isBun), `types.ts` (8 categorias + Memory/Session/Project/Stats/Compaction*), `repository.ts` (572 linhas — save/search/get/update/softDelete/listSessions/getStats/recentMemories/findActiveSession/startSession/endSession/compaction/rebuildFts/purge; validações com zod; ids `randomUUID`; timestamps `Date.now()`).
- **tools/**: `registry.ts` (10 tools — tabela D3) + 1 arquivo por tool (zod schemas + `tool()` do OpenCode; retorno JSON string).
- **config/**: `schema.ts` + `loader.ts` (JSONC strip + merge user/project — paths OpenCode `~/.config/opencode/runes.jsonc` + `<dir>/.opencode/runes.jsonc`; campos: `disabled_skills`, `disabled_tools`, `data_dir`, `importance_floor`, `category_cap`).
- **lib/**: `paths.ts` (data dir `~/.runes` ou RUNES_DATA_DIR), `project.ts` (findGitRoot + remote origin URL normalizado → slug; fallback path absoluto).
- **plugin/**: `plugin-interface.ts` (resolve project → `{name, tool}`) — shell OpenCode.
- **bin/**: `runes.ts` (CLI search/stats/doctor [--purge]/help; probe node:sqlite/FTS5).
- **skills/using-runes/SKILL.md**: diretriz de uso (rune_context no início; rune_save em decisão/correção; rune_search antes de agir; curadoria top-10 por categoria; 8 categorias).

**Evidência no harness/SDK (verificada):**
1. **bun:sqlite (Bun 1.3.14) VIÁVEL — probes empíricos (2026-08-08):** Database abre; `PRAGMA journal_mode = WAL` em arquivo → `"wal"`; FTS5 `tokenize='unicode61 remove_diacritics 2'` faz match de "café" E "cafe"; **schema.sql REAL executado** → INSERT → match FTS → UPDATE soft_deleted=1 → trigger remove do índice (count 1→0). Triggers em tabela REAL escrevendo em FTS5 OK (nota: trigger em TABELA VIRTUAL é ilegal no SQLite — o schema do runes nunca faz isso).
2. **SDK 0.81.0:** `defineTool` exportado (`dist/index.d.ts`) e `pi.registerTool(defineTool({...}))` verificado no fork glla (`extensions/loops/goal.ts:2621+`) — padrão de registro do port (D3).
3. **Padrão de extensão do harness:** `extensions/guards.ts` / `extensions/resilience.ts` — `export default function registerX(pi)` → `installX(pi)`; manifest `pi.extensions` com paths relativos. F27 usa `ctx.cwd` para resolver paths por repo (src/extensions/resilience.ts:147+).
4. **Config da casa:** state.ts seções aditivas `guards`/`verification`/`resilience` (schemaVersion 1) + defaults fail-closed + kill switches `RUNECRAFT_*_0`; freeze por sessão (F24 D12).
5. **EVAL-MATRIX on disk = v5** (F27); F28 fecha v6 (EVAL-022..029) em execução → F29 bumpa para **v7** (one writer thread — F28 → F29, ordem do STATE.md).
6. **appendEntry (SDK)** = log de sessão por append — **não persiste entre sessões**; não serve de memória (D2).

## Decisões

| # | Decisão | Justificativa |
| --- | --- | --- |
| D1 | **Storage = `<gitRoot>/.runecraft/memory/runes.db`** (QA-1a recomendado): DB por repo (git root detectado via port de `lib/project.ts`; fallback cwd), WAL + foreign_keys ON + busy_timeout 5000 + retry 1×/100ms (semântica `db/client.ts`); override `RUNECRAFT_MEMORY_DATA_DIR` (env — usado nos evals); `.runecraft/memory/` gitignored; port de `openDatabase` direto para `bun:sqlite` (`Database`) — SEM fallback node:sqlite (runtime do harness é Bun; documentado) | (1) Padrão da casa: sinks de runtime vivem em `.runecraft/` (events F28, lessons F28, continuation F27, verify-verdicts F25); (2) DB por repo = isolamento multi-repo sem tabelas extras e backup/limpeza trivial; (3) worktrees do mesmo repo compartilham `.runecraft` (mesmo git root — semântica source "worktrees share data"); (4) WAL = leitores concorrentes + escritor serializado (concorrência multi-sessão); (5) evals controlam o path via env (temp dir) sem tocar no repo real |
| D2 | **O DB É a memória cross-session — resolução honesta do wording do roadmap** ("memória cross-session via mecanismos do Pi (appendEntry) + state do F13"): `appendEntry` do SDK é log de sessão por append (domínio do event store F28) e **não persiste entre sessões** — não é mecanismo de memória; `state.json` F13 carrega CONFIG e estado do harness (global `~/.runecraft/`), não conteúdo de memória. A memória durável é o arquivo SQLite (`runes.db`) — persiste entre sessões/processos por construção (D1). state F13 entra como superfície de CONFIG (`memory` — D5) e o F28 continua dono do trilho auditável de sessão (events/) | Honestidade com os mecanismos reais (regra do briefing: sem fabricação; appendEntry NÃO dá memória — afirmar o contrário seria inventar API); a decisão preserva o ESPÍRITO do roadmap (memória cross-session gerenciada pelo harness) com o mecanismo que existe; QA-2 valida com o usuário |
| D3 | **Tool surface = 10/10 PORTADAS como Pi tools, MESMOS nomes (`rune_*`) e MESMA semântica** via `pi.registerTool(defineTool({name, description, inputSchema, run}))` (padrão glla, SDK 0.81.0). Adaptações: `tool()` de `@opencode-ai/plugin` → `defineTool` (SDK); zod → validação manual em `validate.ts` (zero deps, mesmas mensagens de erro); agent hardcoded `"opencode"` em `rune_context`/`rune_session_start` → `RUNECRAFT_AGENT_ID` (F24) ?? `"pi"`; `description`/args = texto e shapes do source (evidência em tabela abaixo). NENHUM tool dropado — todos são host-agnósticos (só usam repository + projectId). Drops de infra OpenCode: interface `Plugin`, config JSONC (→ state F13 D5), skill (→ skill Pi D9), bin (→ CLI harness D8), campos mortos (`importance_floor` parsed-não-enforced; `disabled_skills` skill-system OpenCode) | 10 tools = a semântica comprovada do source; nomes idênticos = fidelidade de port (evals comparam contra fixtures do source); registro via registerTool = mecanismo REAL do Pi (evidência glla); validação manual mantém zero-deps sem perder as mensagens (zod 4.1.8 do source seria dep nova) |
| D4 | **Schema = v1 runes AS-IS + política de migração aditiva**: copiar `schema.sql` integral (projects/sessions/memories/memories_fts/triggers/índices) + `schema_meta` com SCHEMA_VERSION=1; `runMigrations` idempotente (IF NOT EXISTS + upsert version — port de `migrations.ts`); mudanças futuras = ADITIVAS (novas tabelas/colunas + bump de SCHEMA_VERSION; nunca destrutivo — política F13). Atribuição: schema/código do arcanum (org própria, MIT — nota em docs/MEMORY.md; decisão AD-002 vigente para trechos de terceiros) | Fidelidade de port (evals rodam contra o schema REAL — já verificado executável em bun:sqlite, D12); política aditiva = mesma do state F13 (sem migração destrutiva); `schema_meta` dá o contrato de versão |
| D5 | **Config surface = seção `memory` ADITIVA no state F13 (schemaVersion 1)**: `{enabled: true, categoryCap: 10, disabledTools: [], importLessonsOnStart: false}` (padrão guards/verification/resilience — defaults fail-closed, validação runtime, freeze por sessão = snapshot no init da extensão — F24 D12); env `RUNECRAFT_MEMORY_DATA_DIR` (override do path — evals); kill switch `RUNECRAFT_MEMORY=0` → extensão inerte: **nenhum tool registrado, nenhum arquivo criado**; CLI recusa com mensagem (fail-visible, nada criado). Campos do source não portados: `importance_floor` (achado honesto — parsed, nunca enforced), `disabled_skills` (n/a no Pi), `data_dir` JSONC (→ env + state) | Padrão da casa (F24/F25/F27/F28); "tools ausentes" é mais forte que "handlers no-op" (o agente não vê a superfície — sem tentação de chamar); freeze evita drift mid-session (D12 F24); kill switch testável (EVAL-036) |
| D6 | **Determinismo**: (a) DI no `Repository` — `clock: () => number` e `idGen: () => string` (defaults `Date.now`/`randomUUID`) — evals injetam sequências fixas (F21 D10: timestamps são payload informacional, nunca identidade); (b) tie-break explícito em ordenações sem chave total: `recentMemories` → `ORDER BY created_at DESC, rowid DESC`; `selectOldestLowestPriority` → `... importance ASC, created_at ASC, rowid ASC`; `listSessions` → `... started_at DESC, id DESC` (aditivo determinístico — não muda semântica prod); (c) FTS5 `rank` é determinístico para mesmo corpus+query (mesmo runtime) — asserts de EVAL-037 comparam resultados completos com relógio/id injetados | F21 D10 + ratchet F23 exigem identidade estável; sem tie-break, dois registros com mesmo timestamp injetado dariam ordem não-determinística (bug latente do source, corrigido no port — documentado); DI é o padrão do F28 (relógio/uso injetáveis) |
| D7 | **Fronteiras + bridge F28** (MEM-06): `lessons/promoted.jsonl` é DONO do F28 (versionado, memória de time); F29 **importa read-only e idempotente** — `harness memory import-lessons [--dry-run]` e (se `importLessonsOnStart`) no init da extensão; por lesson → memória `category="learnings"`, `title=trigger`, `what="Anti-padrão: <antiPattern>\nPadrão preferido: <preferred>"`, `where_ref="lesson:<lessonId>"` (chave de idempotência — SELECT por where_ref antes de inserir; colisão → skip, nunca sobrescreve memória do usuário); fonte NUNCA reescrita (abertura read-only). Tabela de fronteiras: events/ + lessons/ (F28 donos), continuation.json (F27), verify-verdicts.jsonl (F25), ledger (F24/F27), memory/ (F29 dono) | F28 Out of Scope explícito ("F29 consome se/quando"); idempotência por marcador = re-runs seguros; `where_ref` é coluna existente do schema v1 (zero mudança de schema); bridge não duplica escrita (cada sink continua dono) |
| D8 | **CLI = `harness memory search|stats|doctor [--purge]|import-lessons`** (QA-5a recomendado): port do `bin/runes.ts` (search → markdown table via `searchAllProjects`; stats → per-category; doctor → drift memories vs memories_fts + `--purge` hard-delete + `rebuildFts`; probe FTS5 no startup); subcomando novo no dispatch do F11; kill switch → recusa com mensagem (fail-visible) | CLI de inspeção/manutenção é o port fiel do bin (o plugin original tinha CLI); sem ela, drift de FTS ficaria invisível (doctor) |
| D9 | **Skill + docs**: `skills/using-runes/SKILL.md` portada para skill Pi (manifest `pi.skills`, padrão subagents/taskflow — QA-4a recomendado) com conteúdo do source (uso das 10 tools, 8 categorias, curadoria top-10, "não salvar secrets"); `docs/MEMORY.md` (schema, tools, categorias, storage/WAL, fronteiras, privacidade, determinismo, concurrency, CLI, config); seção Memory no `docs/ROUTING.md`; `.gitignore` += `.runecraft/memory/` (entry no mesmo local das demais `.runecraft/*` — validar no Execute) | A skill é o contrato de uso que faz o agente chamar as tools (sem ela a memória fica órfã); docs = política F8 (fonte real, sem fabricação) |
| D10 | **Privacidade — memória só no DB**: conteúdo de memória (title/what/why/…) NUNCA gravado cru em events/ (`tool:call/result` com argsHash — F28 D2), state.json, continuation.json, lessons.jsonl ou logs (guardLog da camada memory só com metadados: ids, contagens); o retorno das tools para o agente é o mecanismo (transcript) — inerente à função de memória; CLI escreve no stdout do TERMINAL (inspeção explícita — propósito do port). EVAL-038 asserta sentinel ausente do event file | Constraint dura do briefing ("memory content never logged raw"); argsHash é o precedente exato do F28; o DB local é o único repositório de conteúdo |
| D11 | **Evals = EVAL-030..038, EVAL-MATRIX v7 aditivo** (D10 abaixo): suite `test/eval/suites/memory.ts` — round-trip db/repository, 10 tools no fixture, cross-session, semântica search/context, compaction, bridge F28, config/kill switch, determinismo, privacidade; lane F21 (fixture + DB temp via env); delta vs EVAL-006/007/014/019/022..029 documentado no case; consistência estendida + `MIN_EVIDENCE_FILES` bump (F23 AD-025) | F26 framework + fixture F21 provam o padrão; política aditiva (F21 D9) |
| D12 | **Engram fallback — critérios de viabilidade do runes**: runes é o caminho (decisão 6). **VIÁVEL — evidência empírica (2026-08-08, Bun 1.3.14):** (1) bun:sqlite presente e funcional (Database + pragmas); (2) WAL em arquivo → `"wal"`; (3) FTS5 + tokenizer `unicode61 remove_diacritics 2` operacional (match com/sem diacríticos); (4) schema.sql REAL executa com triggers (tabela REAL → FTS5) e round-trip save/match/soft-delete OK. **Gatilhos de inviabilidade (qualquer um no Execute → STOP e flag Engram por decisão 6):** (a) FTS5 indisponível no bun:sqlite do runtime (probe no teste); (b) triggers real-table→FTS5 falhando; (c) WAL indisponível; (d) violação de zero-deps/offline no port. Nenhum gatilho observado — risco residual baixo (validar no Execute via EVAL-030) | Critérios explícitos = a decisão 6 vira check empírico, não fé; o probe já executou o schema real (nada inventado); Engram só entra com evidência de blocker |

## Arquitetura — módulos

```
packages/harness/
├── src/memory/
│   ├── index.ts              # exports públicos
│   ├── types.ts              # port db/types.ts (8 categorias, Memory, Session, Project, Stats, CompactionSignal/Candidate)
│   ├── schema.sql            # port AS-IS (v1 runes) — FTS5 + triggers + índices
│   ├── migrations.ts         # SCHEMA_VERSION=1, runMigrations idempotente + schema_meta (port)
│   ├── client.ts             # openDatabase: bun:sqlite Database; WAL/FK/busy_timeout; retry 1×/100ms (port, sem node:sqlite)
│   ├── project.ts            # port lib/project.ts: findGitRoot + remote slug (regex SSH/HTTPS) + fallback path
│   ├── paths.ts              # resolveMemoryDir(cwd): <gitRoot| cwd>/.runecraft/memory; RUNECRAFT_MEMORY_DATA_DIR override
│   ├── validate.ts           # validação manual (substitui zod — mesmas mensagens/códigos de erro)
│   ├── repository.ts         # port repository.ts + DI clock/idGen (D6) + tie-breaks (D6)
│   ├── tools.ts              # 10 × defineTool (rune_*; inputSchema JSON; run → repository; agent via RUNECRAFT_AGENT_ID)
│   ├── config.ts             # seção `memory` no state F13 (D5) + kill switch + freeze
│   ├── import-lessons.ts     # bridge F28 promoted.jsonl → memories (idempotente, where_ref=lesson:<id>, read-only fonte) (D7)
│   └── cli.ts                # harness memory search|stats|doctor [--purge]|import-lessons (D8)
├── src/extensions/memory.ts  # installMemory(pi, deps?): resolve cwd (ctx.cwd — F27), open+migrate, freeze config, registerTool ×10, auto-import (D3/D5/D7); kill switch → no-op
├── extensions/memory.ts      # export default (padrão guards/resilience) + manifest pi.extensions
├── skills/using-runes/SKILL.md  # port da skill (D9) + manifest pi.skills
├── docs/MEMORY.md            # schema/tools/fronteiras/privacidade/CLI/config (D9)
└── test/
    ├── memory/               # unit puro (client/migrations/repository/validate/config/cli — relógio/id fake, DB temp) + integração fixture
    └── eval/suites/memory.ts # cases EVAL-030..038 (D11)
```

## Fluxos

### F1 — Sessão → tools (MEM-03/04)

```
1. init da extensão (sessão Pi gerenciada): RUNECRAFT_MEMORY=0? → no-op (zero arquivos)
2. resolve cwd (ctx.cwd — a validar no Execute) → memoryDir (RUNECRAFT_MEMORY_DATA_DIR ?? <gitRoot| cwd>/.runecraft/memory)
3. openDatabase + runMigrations (idempotente) + freeze da config `memory` (D5)
4. resolve project (slug do remote git normalizado; fallback path) → getOrCreateProject
5. pi.registerTool ×10 (rune_* com repository bound) — tools ausentes se abertura falhar (fail-closed + aviso)
6. importLessonsOnStart? → import idempotente (D7)
7. agente chama rune_context/rune_save/rune_search/... → repository (SQLite local; WAL)
```

### F2 — Cross-session (MEM-04)

```
sessão A (repo X): rune_save → INSERT em <X>/.runecraft/memory/runes.db (WAL)
sessão B (mesmo repo X, outro processo/dia): rune_context → SELECT recentes — memórias de A presentes
worktree W de X: mesmo git root → mesmo .runecraft → mesma memória
```

### F3 — Bridge F28 (MEM-06)

```
harness memory import-lessons [--dry-run]
→ lê .runecraft/lessons/promoted.jsonl (read-only; F28 dono)
→ por lesson: SELECT where_ref='lesson:<id>'? → skip : INSERT memory learnings (title=trigger, what=antiPattern+preferred)
→ 2º run → zero inserts (idempotente); fonte byte-idêntica
```

### F4 — CLI (MEM-07)

```
harness memory search "q" → markdown table (searchAllProjects, FTS rank)
harness memory stats → per-category counts + last activity
harness memory doctor [--purge] → drift memories vs memories_fts; --purge → purgeSoftDeleted + rebuildFts
harness memory import-lessons [--dry-run] → F3
kill switch → "memory disabled (RUNECRAFT_MEMORY=0)" + exit, nada criado
```

### F5 — Determinismo (MEM-02)

```
Repository(db, {clock: seq fixa, idGen: seq fixa}) → ops scriptadas → resultados serializados
2º run (DB temp novo, mesmas sequências) → JSON IDÊNTICO (inclui created_at/updated_at injetados)
tie-breaks (rowid/id) garantem ordem total nas queries
```

### F6 — CI

```
bun test test/eval (preloads F21/F24/F25/F26/F27/F28) → EVAL-030..038 offline/$0;
consistência matriz↔suites (v7); evidência last-run.json; MIN_EVIDENCE_FILES bump;
RUNECRAFT_MEMORY=0 não afeta a suite (kill switch testado); sem regressão pós-F28
```

## Tabela de mapeamento runes → harness (10 tools + infra)

| runes (source) | Decisão | Adaptação no port | Evidência |
| --- | --- | --- | --- |
| `rune_save` (src/tools/save.ts) | PORT (Pi, mesmo nome/semântica) | `tool()`→`defineTool`; zod→validate.ts; compaction signal mantido | `saveMemory` + `checkAndEnforceCompaction` (repository.ts) |
| `rune_search` (search.ts) | PORT | idem; inputSchema JSON | FTS5 MATCH + filtro categoria + `ORDER BY rank` |
| `rune_get` (get.ts) | PORT | idem | `getMemory` (soft_deleted=0) |
| `rune_update` (update.ts) | PORT | idem | `updateMemory` (patch; NOT_FOUND) |
| `rune_delete` (delete.ts) | PORT | idem | `softDeleteMemory` (soft-delete; NOT_FOUND) |
| `rune_context` (context.ts) | PORT | agent `"opencode"` → `RUNECRAFT_AGENT_ID` ?? `"pi"` | `findActiveSession(projectId, agent)` |
| `rune_timeline` (timeline.ts) | PORT | idem | `listSessions` |
| `rune_stats` (stats.ts) | PORT | idem | `getStats` |
| `rune_session_start` (session-start.ts) | PORT | agent default `"opencode"` → `"pi"` | `findActiveSession` idempotente |
| `rune_session_end` (session-end.ts) | PORT | idem | `endSession` |
| `plugin/plugin-interface.ts` (Plugin OpenCode) | DROP → extensão Pi | `extensions/memory.ts` + `src/extensions/memory.ts` (installMemory) | padrão F24/F27 |
| `tool()` de `@opencode-ai/plugin` | DROP → SDK | `defineTool` + `pi.registerTool` (0.81.0) | glla goal.ts:2621+ |
| `zod` (4.1.8) | DROP → validação manual | `validate.ts` (mesmas mensagens/códigos) | zero deps novas (constraint) |
| config JSONC (opencode paths) | DROP → state F13 | seção `memory` (D5) + env | padrão guards/verification/resilience |
| `importance_floor` (parsed, não enforced) | DROP | não portado (achado honesto — source nunca aplica) | config/schema.ts vs tools/ |
| `disabled_skills` | DROP | n/a no Pi (skill própria — D9) | skill-system OpenCode |
| `bin/runes.ts` | ADAPT → CLI harness | `harness memory search|stats|doctor [--purge]|import-lessons` (D8) | dispatch F11 |
| `skills/using-runes/SKILL.md` | ADAPT → skill Pi | `skills/using-runes/` no manifest `pi.skills` (D9) | padrão subagents/taskflow |
| `node:sqlite` fallback (db/sqlite.ts) | DROP | bun:sqlite only (runtime do harness) | Bun 1.3.14 do repo |

## Tabela de mecanismos (o que existe → o que F29 constrói)

| Mecanismo | Existe (SDK 0.81.0 / harness / runes) — evidência | F29 constrói |
| --- | --- | --- |
| SQLite + FTS5 + WAL em Bun | bun:sqlite builtin (Bun 1.3.14) ✓ — probes: WAL `"wal"`, FTS5 diacríticos, schema real executa | `client.ts` + `schema.sql` AS-IS (D1/D4) |
| Registro de tools Pi | `pi.registerTool(defineTool(...))` ✓ (glla goal.ts:2621+) | `tools.ts` 10 × rune_* (D3) |
| Extensão Pi do harness | `extensions/{guards,resilience}.ts` + manifest `pi.extensions` ✓ | `extensions/memory.ts` (D3) |
| Config aditiva + freeze + kill switch | state.ts `guards`/`verification`/`resilience` ✓ (F24 D12) | `config.ts` seção `memory` (D5) |
| Fixture determinística | F21 ScriptedScenario + materialização de extensões ✓ | evals EVAL-030..038 (D11) |
| Memória de time versionada | F28 `lessons/promoted.jsonl` (em execução) ✓ | bridge import-lessons (D7) |
| DRY relógio/id (determinismo) | F28 monitor injetável ✓ (F21 D10) | DI clock/idGen no Repository (D6) |
| CLI subcomando | dispatch F11 (install/verify/lessons...) ✓ | `harness memory` (D8) |
| Drift check FTS | `bin/runes.ts` doctor ✓ | `cli.ts` doctor [--purge] (D8) |
| argsHash (privacidade) | F28 D2 (tool:call/result hashed) ✓ | garantia MEM-09 + EVAL-038 (D10) |
| Engram / appendEntry memória | NENHUM (appendEntry é log de sessão — não persiste) | NÃO usado (D2/D12 — decisão 6) |

## EVAL-MATRIX — entradas aditivas v7 (política F21 D9)

| ID | Fluxo | Script esperado | Notas |
| --- | --- | --- | --- |
| EVAL-030 | port round-trip (db+repository) | DB temp: migrate → save → get → search → stats → soft-delete → get NOT_FOUND; schema_meta version=1; migrations 2× idempotente | schema.sql AS-IS executa em bun:sqlite (D12) |
| EVAL-031 | 10 tools no fixture Pi | sessão F21 materializada lista `rune_*` ×10 (nomes + inputSchema); `rune_save` → `rune_search` round-trip real no loop | defineTool/registerTool (glla) |
| EVAL-032 | cross-session | instância A salva + fecha; instância B (novo Repository, mesmo arquivo) busca → acha; 2 runs idênticos | DB é a memória (D2) |
| EVAL-033 | semântica search/context | FTS5 match (com/sem diacríticos); filtro categoria; soft-deleted excluído; ordem rank; rune_context recent+relevant; session_start idempotente | port fiel |
| EVAL-034 | compaction | >hardCap poda (importance ASC, created_at ASC — tie-break); sinal candidatos ≤5; transação; categoryCap do config | semântica source (D6) |
| EVAL-035 | bridge F28 | promoted.jsonl fixture (2 lessons) → import → 2 memórias learnings com `where_ref=lesson:<id>`; 2º import 0 novas; fonte byte-idêntica; dry-run zero writes | MEM-06 (D7) |
| EVAL-036 | config/kill switch | state `memory` defaults/freeze; `RUNECRAFT_MEMORY=0` → zero tools + zero arquivos; CLI recusa | padrão F24/F25/F27/F28 |
| EVAL-037 | determinismo | ops scriptadas com relógio/id injetados → 2 runs resultado JSON idêntico (inclui created_at injetado; tie-breaks) | F21 D10 (D6) |
| EVAL-038 | privacidade | `rune_save` com sentinel → `events/*.jsonl` sem o sentinel (só argsHash); conteúdo presente só no DB | MEM-09 (D10) |

Nota datada v7: memória agora com entradas (pilar 7 — port de runes); tool-use/routing (F32) e failover (F30) seguem SEM entradas (política aditiva — nada sai sem AD). Bump de MATRIX_VERSION 6→7 depende do F28 fechar a v6 (one writer thread).

## Integração CI

- **Roda com**: mesma lane F21/F24/F25/F26/F27/F28 — `bun test test/eval` (offline/$0: loopback, apiKey literal, agentDir temp, `GIT_CONFIG_*=/dev/null`); zero chamadas LLM (F29 é determinístico por construção)
- **Evidência**: `evalTest()` grava nos mesmos `evidence/partial/*.jsonl`; merge F21 inclui os novos checks; ratchet F23 cobre (identidade estável — F21 D10; asserts excluem payload volátil quando relógio não injetado)
- **Consistência**: `matrix-consistency.test.ts` v7 varre `test/eval/suites` incluindo memory; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- **Kill switch**: `RUNECRAFT_MEMORY=0` testado (camada inerte; suite continua verde)
- **Falha em regressão**: exit ≠ 0 → turbo vermelho → PR bloqueada (padrão F21 D12)

## Riscos

| Risco | Mitigação |
| --- | --- |
| **FTS5/triggers indisponíveis no bun:sqlite do runtime** | Verificado empiricamente (probe do schema REAL — D12); EVAL-030 re-prova no harness; gatilho de inviabilidade → Engram (decisão 6) |
| **Shape do `inputSchema` aceito por `defineTool`** (JSON Schema vs typebox) não verificado | Validar no Execute (ler types.d.ts/uso do glla); fallback: inputSchema mínimo + validação real no `run()` (validate.ts já existe) |
| **Colisão de nomes de tools com forks (glla/subagents)** | Prefixo `rune_` é exclusivo do source; validar no Execute a lista real de tools registradas no fixture (assert no EVAL-031) |
| **`ctx.cwd` no ExtensionContext** (fonte do diretório do repo) | F27 já usa `ctx.cwd` (src/extensions/resilience.ts:147) — confirmar no Execute; fallback `process.cwd()` |
| **F28 ainda em execução** (promoted.jsonl shape final / v6 da matriz) | Bridge por contrato mínimo (lessonId, trigger, antiPattern, preferred — campos já definidos no F28 D5); F29 lê read-only e trata linha malformada com skip (fail-soft); bump v7 após F28 fechar |
| **Corrupção/lock do DB** | Retry 1×/100ms (port) + WAL/busy_timeout; falha persistente → tools ausentes + aviso (fail-closed, sessão segue); doctor diagnostica |
| **Vazamento de conteúdo de memória** | D10: eventos só argsHash (F28 D2); guardLog só metadados; EVAL-038 asserta sentinel ausente; docs de privacidade |
| **Concorrência multi-sessão no mesmo repo** | WAL (leitores concorrentes) + busy_timeout 5000 (escritor serializado); transações na compaction; documentado |
| **Determinismo de FTS5 rank cross-runtime** | Mesmo runtime (Bun) → determinístico; asserts comparam 2 runs no MESMO ambiente; tie-breaks nas queries sem chave total |
| **Fronteira F28/F29 borrada** | F28 dono de lessons; F29 importa read-only idempotente; events/ dono F28 (recorder observa tool_call — zero código F29 no store) |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| MEM-01 | P1: Port db | D1/D4 + client.ts/migrations.ts/schema.sql + EVAL-030 |
| MEM-02 | P1: Port Repository | D6 + repository.ts/validate.ts + EVAL-030/033/034/037 |
| MEM-03 | P1: 10 tools Pi | D3 + tools.ts + extensions/memory.ts + EVAL-031 |
| MEM-04 | P1: Cross-session | D1/D2 + client.ts/project.ts + EVAL-032 |
| MEM-05 | P1: Config | D5 + config.ts + EVAL-036 |
| MEM-06 | P2: Bridge F28 | D7 + import-lessons.ts + EVAL-035 |
| MEM-07 | P2: CLI | D8 + cli.ts + dispatch F11 |
| MEM-08 | P2: Skill + docs | D9 + skills/using-runes + docs/MEMORY.md + ROUTING + .gitignore |
| MEM-09 | P1: Privacidade | D10 + EVAL-038 + guardLog metadados |
| MEM-10 | P2: Evals + governança | D11 + suite memory.ts + EVAL-MATRIX v7 |

**Cobertura:** 10/10 mapeados. Edges da spec: sem git root → slug path (D1/project.ts) · DB ausente → migrate idempotente (D4) · abertura falha → tools ausentes fail-closed (D1/D5) · hardCap → poda transacional (D2/repository) · concorrência → WAL (D1) · soft-delete → fora de search/get/context (D4 triggers) · duplicação EVAL → delta no case (D11) · 2 runs → idênticos (D6) · colisão where_ref → skip (D7).

**Pontos a validar no Execute** (consolidado): shape do `inputSchema` do defineTool (JSON Schema vs typebox); `ctx.cwd` no ExtensionContext (fonte do diretório); lista real de tools registradas no fixture (colisão de prefixo `rune_`); F28 fecha v6 antes do bump v7; local das entries `.runecraft/*` no .gitignore (root vs package); formato de resolução de skill no manifest `pi.skills` (paths relativos — padrão subagents); byte-shape do promoted.jsonl real (campos exatos); comportamento do FTS5 rank com corpus grande (não bloqueia — documentar).

## Open questions para o usuário (QA-1..QA-5 — necessárias antes do Execute)

1. **QA-1 — Storage** (D1): (a) **recomendado — `.runecraft/memory/runes.db` por repo** (gitignored, WAL, evals via env); (b) `~/.runes/runes.db` (default original — reutiliza dados legados)
2. **QA-2 — Modelo de recall** (D2/D3): (a) **recomendado — tool-driven** (skill manda `rune_context`/`rune_search`; zero rewrite de prompt); (b) auto-digest via `before_agent_start`; (c) ambos. **Honesto:** appendEntry não persiste entre sessões — o DB é a memória; state F13 = config
3. **QA-3 — Bridge F28** (D7): (a) **recomendado — CLI explícito + `importLessonsOnStart: false`**; (b) auto=true sempre; (c) sem bridge no v1
4. **QA-4 — Skill** (D9): (a) **recomendado — portar `using-runes` como skill Pi** (manifest `pi.skills`); (b) docs-only
5. **QA-5 — CLI** (D8): (a) **recomendado — port completo** (`search|stats|doctor [--purge]|import-lessons`); (b) só tools + import
