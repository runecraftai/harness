# F29 — Tasks (Memory: runes → Pi)

**Base:** design.md D1–D12 (aguarda QA-1..QA-5 → AD-029) · infra reutilizada: F13 (state schema v1 aditivo), F21 (fixture, ScriptedScenario, evalTest → evidência, EVAL-MATRIX, consistência), F24 (RUNECRAFT_AGENT_ID, guardLog, freeze D12), F25 (recordSessionVerdict best-effort), F26 (framework eval), F27 (ctx.cwd, extension wiring — mecanismos reutilizados), F28 (em execução: lessons/promoted.jsonl — contrato MEM-06; argsHash — privacidade), fonte runes (`/home/rehem/Projects/arcanum/packages/runes` — port, AD-001; bun:sqlite verificado VIÁVEL — D12)
**Dependências de decisão:** T1/T2/T3 (QA-1 storage) · T3 (QA-2 recall — afeta só a extensão/skill) · T5 (QA-3 bridge) · T7 (QA-4 skill) · T6 (QA-5 CLI) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/memory/{types.ts, schema.sql, migrations.ts, client.ts, project.ts, paths.ts} (D1/D4, MEM-01) — depende QA-1

- [ ] `types.ts`: port de `db/types.ts` (8 categorias `MEMORY_CATEGORIES`; `Memory`, `Session`, `Project`, `Stats`, `CompactionCandidate`, `CompactionSignal`) — sem zod (types puros)
- [ ] `schema.sql`: cópia AS-IS do `schema.sql` v1 runes (projects/sessions/memories/memories_fts + triggers memories_ai/ad/au/soft_delete_au + índices) — idempotente (IF NOT EXISTS); nota de atribuição no header (org própria/arcanum, AD-002)
- [ ] `migrations.ts`: `SCHEMA_VERSION = 1`; `runMigrations(db)` idempotente (exec schema.sql + `schema_meta` version upsert — port de `migrations.ts`); resolução do schema.sql por caminho relativo ao módulo (port `loadSchema`)
- [ ] `client.ts`: `openDatabase(memoryDir, {retryCount=1, retryDelayMs=100})` — `Database` de `bun:sqlite` (SEM fallback node:sqlite — runtime Bun, D1); `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`; retry de abertura (port `db/client.ts`)
- [ ] `project.ts`: port de `lib/project.ts` — `findGitRoot`, `readRemoteUrl` (git config remote.origin.url, timeout 1s), `deriveSlugFromRemote` (regex SSH/HTTPS, strip .git), fallback path absoluto; env `RUNECRAFT_MEMORY_PROJECT_SLUG` (rename do RUNES_PROJECT_SLUG)
- [ ] `paths.ts`: `resolveMemoryDir(cwd)` → `RUNECRAFT_MEMORY_DATA_DIR` ?? `<gitRoot | cwd>/.runecraft/memory`; `ensureMemoryDir` (mkdir recursive — precedente recordSessionVerdict F25)
- [ ] **Verificar:** unit — openDatabase em arquivo temp → `journal_mode == "wal"`; migrations 2× idempotentes (schema_meta version=1); schema.sql REAL executa (FTS5 + triggers + round-trip save/match/soft-delete — espelho do probe D12); slug por remote (fixture git com remote fake) e fallback path; zero deps novas (audit de imports — só bun:sqlite + node builtins); TSC limpo

## T2 — src/memory/repository.ts + validate.ts (D6, MEM-02) — depende T1

- [ ] `validate.ts`: validação MANUAL (substitui zod 4.1.8 — zero deps): categoria enum (8), título 1..200, what 1..4000, why ≤2000, where_ref ≤500, learned ≤2000, importância int 1..10 (clamp 5 default); `ValidationError {code, message}` com MESMOS códigos do source (INVALID_CATEGORY, EMPTY_TITLE, TITLE_TOO_LONG, EMPTY_WHAT, WHAT_TOO_LONG, INVALID_TITLE, INVALID_WHAT)
- [ ] `repository.ts`: port completo (saveMemory, searchMemories com FTS5 MATCH + category + LIMIT, getMemory, updateMemory patch, softDeleteMemory, listSessions, listProjects, searchAllProjects, findActiveSession, getStats, recentMemories, countMemoriesByCategory, checkAndEnforceCompaction + pruneOldestLowestPriority transacional, rebuildFts, purgeSoftDeleted, ftsRowCount, memoriesRowCount, getOrCreateProject/startSession/endSession) — **DI**: constructor `(db, {clock = Date.now, idGen = randomUUID})` (D6); **tie-breaks**: recentMemories `ORDER BY created_at DESC, rowid DESC`; selectOldestLowestPriority `... importance ASC, created_at ASC, rowid ASC`; listSessions `... started_at DESC, id DESC` (aditivo determinístico — documentado no código)
- [ ] **Verificar:** unit espelhando `tests/repository.test.ts` do source (referência de semântica); validações com códigos do source; soft-delete exclui de search/get; compaction (hardCap poda os mais antigos de menor importância em transação; sinal candidatos ≤5); determinismo: 2 runs com clock/idGen injetados → resultados JSON idênticos; sem relógio injetado, identidades continuam estáveis (id ≠ timestamp)

## T3 — src/memory/tools.ts + src/extensions/memory.ts + extensions/memory.ts + manifest (D3/D5, MEM-03/05) — depende T2; QA-2 afeta só a extensão

- [ ] `tools.ts`: 10 × `defineTool` (SDK 0.81.0 — padrão glla goal.ts:2621+): `rune_save/search/get/update/delete/context/timeline/stats/session_start/session_end` — MESMOS nomes, descriptions e shapes de args do source (tabela D3); `inputSchema` em JSON Schema (shape a validar no Execute — verificar types.d.ts; fallback: inputSchema mínimo + validação no run via validate.ts); `run` retorna as MESMAS strings JSON do source; agent em `rune_context`/`rune_session_start` = `RUNECRAFT_AGENT_ID` (F24) ?? `"pi"` (substitui "opencode" hardcoded — adaptação documentada); `disabledTools` do config filtra (port `filterToolsByDisabled`); compaction signal no rune_save (categoryCap do config — default 10)
- [ ] `src/extensions/memory.ts`: `installMemory(pi, deps?)` — kill switch `RUNECRAFT_MEMORY=0` → no-op (zero tools/arquivos); resolve cwd (`ctx.cwd` — validar no Execute; fallback process.cwd()); open+migrate (T1); freeze do config `memory` (snapshot no init — D12 F24); `getOrCreateProject`; `pi.registerTool` ×10; auto-import se `importLessonsOnStart` (T5); falha de abertura → tools ausentes + aviso via guardLog (fail-closed, sessão segue)
- [ ] `extensions/memory.ts`: `export default function registerMemory(pi)` → `installMemory(pi)` (padrão guards/resilience); manifest `pi.extensions` += `./extensions/memory.ts`
- [ ] **Verificar:** fixture F21 — sessão com extensões materializadas lista os 10 `rune_*` (nomes + inputSchema) e executa `rune_save`→`rune_search` round-trip real (EVAL-031); chaining com guards/resilience intacto (registro aditivo; sem colisão de nomes — validar lista real de tools no fixture); kill switch → zero tools + zero arquivos; `disabledTools` remove do registro; freeze (mudança de config mid-session não afeta)

## T4 — src/memory/config.ts (D5, MEM-05) — pode rodar em paralelo com T2/T3

- [ ] Seção `memory` ADITIVA no state F13 (schemaVersion 1 — padrão guards/verification/resilience): `{enabled: true, categoryCap: 10, disabledTools: [], importLessonsOnStart: false}`; `defaultMemoryConfig()` + `loadMemoryConfig(state)` com validação runtime fail-closed (config inválida → defaults + problema reportado ao doctor); freeze por sessão (snapshot); env `RUNECRAFT_MEMORY_DATA_DIR` (override do path — evals); kill switch `RUNECRAFT_MEMORY=0|false|off` (convenção F20)
- [ ] **Verificar:** unit — defaults; seção ausente → defaults; seção inválida → defaults + reporte (fail-closed); freeze (mudança mid-session não afeta); kill switch parse; TSC limpo

## T5 — src/memory/import-lessons.ts (D7, MEM-06) — depende T2 + T4; QA-3

- [ ] `importLessons(lessonsFile, repo, {dryRun})`: lê `.runecraft/lessons/promoted.jsonl` READ-ONLY (F28 é dono — linha malformada pulada, fail-soft); por lesson → `SELECT memories WHERE where_ref = 'lesson:<lessonId>'` → existe? skip : INSERT `category="learnings"`, `title=trigger`, `what="Anti-padrão: <antiPattern>\nPadrão preferido: <preferred>"`, `where_ref="lesson:<lessonId>"`, `importance` mapeado de priority (low=3/med=5/high=8 — tabela documentada); `--dry-run` → relatório sem escrever; arquivo ausente/vazio → no-op exit 0; retorna `{imported, skipped, total}`
- [ ] Fonte NUNCA reescrita (abre só para leitura; hash do arquivo antes/depois no teste); idempotência por marcador (colisão → skip — nunca sobrescreve memória do usuário)
- [ ] **Verificar:** unit com fixture promoted.jsonl (2 lessons) → 2 memórias com marcador; 2º import → imported=0, skipped=2; fonte byte-idêntica (hash); dry-run → zero writes (DB inalterado); arquivo ausente → no-op; linha malformada → skip + contagem

## T6 — src/memory/cli.ts + dispatch (D8, MEM-07) — depende T2; QA-5

- [ ] `harness memory search <query>` → markdown table (port `cmdSearch` do bin/runes.ts: `searchAllProjects`, truncate título 60, ordem da tabela); `harness memory stats` → per-category + last activity (port `cmdStats`); `harness memory doctor [--purge]` → probe FTS5 + drift (memoriesRowCount vs ftsRowCount) + `--purge` → purgeSoftDeleted + rebuildFts (port `reportDriftAndRebuild`); `harness memory import-lessons [--dry-run]` → T5; subcomando novo no dispatch do F11 (contrato F21 D1 — testável com RUNECRAFT_PI_BIN? não — CLI puro, DB por env); kill switch → recusa "memory disabled (RUNECRAFT_MEMORY=0)" exit 0 (nada criado)
- [ ] **Verificar:** unit com DB temp (RUNECRAFT_MEMORY_DATA_DIR) — search/stats/doctor; drift induzido (DELETE direto de linha do memories_fts) → doctor reporta; `--purge` corrige (counts iguais); exit codes; kill switch recusa sem criar arquivo; comando no dispatch (contrato F11)

## T7 — skill + docs/MEMORY.md + ROUTING + .gitignore (D9, MEM-08) — paralelo

- [ ] `skills/using-runes/SKILL.md`: port da skill do source (10 tools; 8 categorias + o que salvar em cada; rune_context no início; rune_save em decisão/correção; rune_search antes de agir; curadoria top-10; **não salvar secrets**) — manifest `pi.skills` += `skills/using-runes` (resolução de paths a validar no Execute — padrão subagents/taskflow)
- [ ] `docs/MEMORY.md`: schema (4 tabelas + FTS5 + triggers + schema_meta v1), 10 tools (tabela D3), 8 categorias, storage/WAL + concurrency, fronteiras (F28 dono de lessons; events/ F28; memory/ F29), privacidade (D10), determinismo (D6), CLI (T6), config (T4), bridge (T5), atribuição runes/arcanum
- [ ] Seção Memory no `docs/ROUTING.md` (padrão F19 D9); `.gitignore` += `.runecraft/memory/` (mesmo local das demais entries `.runecraft/*` — validar no Execute: root vs package)
- [ ] **Verificar:** manifest contém `skills/using-runes`; docs conferidas contra types.ts/schema.sql/tools.ts (checklist: 10 tools, 8 categorias, schema_meta version, kill switch); entry .gitignore presente; ROUTING atualizado (sem quebrar goldens do F19? renderRules NÃO muda — F29 não altera templates)

## T8 — Privacidade (D10, MEM-09) — depende T3; integração com F28

- [ ] Garantia: conteúdo de memória NUNCA em events/ (F28 recorder já hasha tool:call/result com argsHash — verificar), state.json, continuation.json, lessons.jsonl, guardLog (log da camada memory só com metadados: ids/contagens); auditoria de código (grep de writes na camada memory — nenhum path além do DB)
- [ ] **Verificar:** integração — sessão fixture com `rune_save` de sentinel (`SENTINEL_F29_XYZ`) → scan de `.runecraft/events/<session>.jsonl` não contém o sentinel; conteúdo presente SÓ no DB (assert de leitura direta); sem sentinel em stderr capturado (guardLog)

## T9 — evals EVAL-030..038 + matriz v7 + consistência (D11, MEM-10) — depende T1..T8

- [ ] Suite `test/eval/suites/memory.ts` + cases EVAL-030..038 (formato F26; DB temp via `RUNECRAFT_MEMORY_DATA_DIR`): EVAL-030 port round-trip (migrate 2× idempotente + save/get/search/stats/soft-delete + schema_meta version=1), EVAL-031 10 tools no fixture (nomes + inputSchema + rune_save→rune_search round-trip real), EVAL-032 cross-session (instância B no mesmo arquivo encontra memórias de A), EVAL-033 semântica search/context (diacríticos, filtro categoria, soft-deleted excluído, rank order, session_start idempotente), EVAL-034 compaction (hardCap poda + sinal ≤5 + categoryCap do config), EVAL-035 bridge F28 (import idempotente + fonte byte-idêntica + dry-run zero writes), EVAL-036 config/kill switch (defaults/freeze/`RUNECRAFT_MEMORY=0` → zero tools + zero arquivos + CLI recusa), EVAL-037 determinismo (ops scriptadas com clock/idGen injetados → 2 runs JSON idênticos), EVAL-038 privacidade (sentinel ausente de events; presente só no DB); delta vs EVAL-006/007/014/019/022..029 documentado em comentário em cada case (sem double-test)
- [ ] EVAL-MATRIX v7 aditivo (bump MATRIX_VERSION 6→7 após F28 fechar v6; EVAL-030..038 + nota datada; tool-use/routing F32 e failover F30 seguem SEM entradas); teste de consistência estendido para varrer `test/eval/suites` (confirmar inclusão da suite memory); `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest)
- [ ] **Verificar:** EVAL-030..038 verdes offline/$0 na lane F21 (loopback, apiKey literal, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..029; consistência matriz↔suites v7 verde

## Success Criteria (spec)

- [ ] 10 `rune_*` tools funcionais como Pi tools (mesmo nome/semântica do source; round-trip save→search→get→update→delete em DB temp provado por teste)
- [ ] Schema v1 runes AS-IS em bun:sqlite (FTS5 + triggers + WAL + migrations idempotentes — verificado empiricamente)
- [ ] Cross-session provado: 2 instâncias/processos no mesmo DB → memória persiste; scoping por repo (remote slug); worktrees compartilham
- [ ] Determinismo: mesma sequência de ops com relógio/id injetados → resultados idênticos (2 runs); tie-break explícito em ordenações
- [ ] Config aditiva `memory` no state (schemaVersion 1) + kill switch `RUNECRAFT_MEMORY=0` inerte (zero tools/arquivos) + freeze por sessão
- [ ] Bridge F28 idempotente (2º import = zero duplicatas; fonte byte-idêntica) + `--dry-run`
- [ ] CLI `harness memory search|stats|doctor [--purge]|import-lessons` funcional (port do bin)
- [ ] Privacidade: conteúdo de memória ausente de events/state/continuation/logs (assert de sentinel no EVAL-038); presente só no DB
- [ ] EVAL-030..038 verdes offline/$0 na lane F21 (framework F26); EVAL-MATRIX v7 aditivo com notas datadas; sem regressão pós-F28
- [ ] Fronteiras explícitas: F28 dono de lessons; F29 importa read-only; events/ dono F28; memory/ dono F29
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)

## Traceability MEM → tasks

| Requirement | Tasks |
| --- | --- |
| MEM-01 (port db) | T1, T9 |
| MEM-02 (port Repository) | T2, T9 |
| MEM-03 (10 tools Pi) | T3, T9 |
| MEM-04 (cross-session) | T1, T3, T9 |
| MEM-05 (config) | T3, T4, T9 |
| MEM-06 (bridge F28) | T5, T6, T9 |
| MEM-07 (CLI) | T6, T9 |
| MEM-08 (skill + docs) | T7 |
| MEM-09 (privacidade) | T8, T9 |
| MEM-10 (evals + governança) | T9 |

**Cobertura:** 10/10 · toda user story da spec tem requirement ID (MEM-01..10) · todo requisito tem task.
