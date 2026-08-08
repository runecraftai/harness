# F31 — Copilot/VSCode Adapter — Specification

**Scope:** Large (multi-component: adapter novo no padrão F15 `AgentAdapter` + registro/aliases + injeção repo-scoped (rules `.github/copilot-instructions.md` + MCP `.vscode/mcp.json`) + coluna nova na matriz F17 + wiring install/uninstall/doctor/status/sync + conflitos two-driver + evals EVAL-049..056 — M8). Menor que F30 (sem mecanismos novos de prompt/modelo — reuso de F15/F17/F18/F19).
**Prereq (roadmap):** F15 ✓, F16 ✓, F17 ✓. **Efetivos:** F13 (state `agents.<id>.targets` + contentHash), F18 (sections html family + owners + gate MXST-04 + lock), F19 (`renderRules` non-Pi — reuso read-only), F21 (fixture, evalTest, EVAL-MATRIX), F23 (goldens — ratchet), F24 (guards Pi-only — honestidade da matriz), F29/F30 (matriz v7→v8; one writer thread → F31 adiciona **v9**). **Não depende de** F32/F33.
**Grupo:** M8 — Pi First-Class & Multi-Agent Expansion (AD-022 decisão 8: agentes = pi, opencode, claude, codex, **copilot/vscode**)

## Problem Statement

O harness serve agentes não-Pi via `AgentAdapter` (F15: claude-code/opencode/codex — detect/inject/remove/readMcpFingerprint), matriz honesta (F17), coexistência (F18) e rules por coluna (F19). **Copilot (VS Code) é o 5º agente do M8 e ainda não tem presença no harness** — grep em src/adapters/ + src/matrix.ts: zero referências a copilot/vscode (verificado). O roadmap F31 trava o escopo: "Adapter novo no padrão F15 (AgentAdapter): detecção, injecção (AGENTS.md / `.github/copilot-instructions.md`) + MCP taskflow, fail-closed, detect-only; coluna nova na matriz (F17)".

**Fatos verificados (sem fabricação — docs oficiais + source lidos):**
1. **Instruções do Copilot (rules)** — o VS Code detecta automaticamente `.github/copilot-instructions.md` na raiz do workspace e aplica a TODOS os requests de chat; `AGENTS.md` na raiz do workspace também é suportado (always-on; toggle `chat.useAgentsMdFile`); prioridade: personal > repository (`.github/copilot-instructions.md` **ou** `AGENTS.md`) > organization — todos os conjuntos são fornecidos ao modelo ([vscode-docs custom-instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions); [docs.github add-repository-instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)). O **Copilot coding agent** suporta `AGENTS.md` desde 2025-08-28, "alongside" `.github/copilot-instructions.md` e `.github/instructions/**/*.instructions.md` ([github.blog changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/)). **Conclusão: os dois alvos do roadmap são reais e suportados** — decisão de alvo = QA-1.
2. **MCP do Copilot (VS Code)** — a config de MCP vive no arquivo `mcp.json`: workspace `.vscode/mcp.json` (versionável, compartilhável — "Include this file in source control") ou perfil do usuário; schema `{"servers": {<nome>: {type: "stdio", command, args?, env?, cwd?, envFile?}}, "inputs"?: [], "sandbox"?: {}}` ([vscode-docs mcp-configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration); [vscode-docs mcp-servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers); [docs.github extend-copilot-chat-with-mcp](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) — "create a `.vscode/mcp.json` file in the root of your repository"; "use only one location per server"). **Nuance Agent Host (verificada):** o Agent Host (coding agent) NÃO lê `.vscode/mcp.json` diretamente — o VS Code **repassa** os servers configurados, exceto os que exigem `${input:...}`; config portátil nativa do Agent Host = `.mcp.json` na raiz do workspace ou `~/.copilot/mcp-config.json` do usuário. **Conclusão: `.vscode/mcp.json` funciona para Copilot Chat E coding agent (sem `input` vars no nosso entry); `~/.copilot/mcp-config.json` é a alternativa user-level** — decisão de escopo = QA-5.
3. **Marcadores HTML em markdown** — o motor de seções F18 (`src/sections.ts`, família `html`: `<!-- runecraft:<id> -->`) é BOM/CRLF-aware e opera em qualquer arquivo texto; `copilot-instructions.md`/`AGENTS.md` são Markdown e aceitam comentários HTML (sintaxe Markdown) — mesmo padrão já usado em CLAUDE.md/AGENTS.md dos outros adapters. **Validar no Execute** apenas se o Copilot tiver parsing peculiar de comentários HTML (improvável — o arquivo é ingerido como texto; os markers são visíveis ao modelo como nos demais agentes, inofensivos).
4. **Host MCP do taskflow** — `packages/taskflow/` tem adapters `claude|codex|opencode|grok` (+ `mcp-core` + `hosts`); **NÃO existe `mcp-copilot`** (verificado). Os bins são `@runecraft/taskflow-<host>` com `dist/mcp/bin.js` (ex.: `packages/taskflow/claude/dist/mcp/bin.js`) — servidores MCP stdio; o `resolveMcpBin` (F15 D4) resolve env > dev fork > npx `@runecraft/<host>@<pin>` com guard anti-upstream. **Conclusão: para Copilot, REUSAR um host existente (stdio genérico) — NUNCA inventar `@runecraft/taskflow-copilot`** — decisão = QA-2.
5. **`renderRules("copilot")` já funciona** — `src/adapters/rulesContent.ts`: `renderRules(agentId)` retorna `PI_RULES` só para `pi`; **qualquer outro id recebe `NON_PI_RULES`** (13 linhas, "só taskflow+review", golden `section-workflow-nonpi.golden`). Copilot = reuso read-only do template non-Pi (zero mudança no F19; zero golden novo de conteúdo).
6. **gentle-ai já serve Copilot (fonte lida)** — `docs/agents.md`: id `vscode-copilot`, config path `~/.copilot` + VS Code User profile, delegação "Full (runSubagent) — Parallel execution", SDD orchestrator sim; workspace scope escreve "system prompts, skills, SDD agents, persona files into the current project root when the agent supports project-local configuration". `docs/copilot.md` **NÃO existe** (404 verificado — fonte honesta é agents.md + source). No source (`internal/components/persona/inject.go`): a persona do VSCode usa `StrategyInstructionsFile` → `adapter.SystemPromptFile(homeDir)`; o path LEGACY era `~/.github/copilot-instructions.md` (HOME do usuário, instruções globais do VS Code) e versões novas **auto-removem** esse arquivo legado ("VS Code still reads that path for global instructions, so the two files would conflict"). `copilot-instructions.md` é tratado como convention file de projeto em `internal/reviewtransaction/risk.go` (junto de agents.md/CLAUDE.md/GEMINI.md). **Conclusão two-driver: os arquivos do gentle-ai são USER-level (`~/.copilot/...`, legado `~/.github/copilot-instructions.md` na HOME); o alvo do harness F31 é REPO-level (`.github/copilot-instructions.md` na raiz do workspace) — sem colisão de path, mas com sobreposição SEMÂNTICA (VS Code fornece ambos ao modelo; prioridade personal > repo) → owners.ts detecta via state `~/.gentle-ai/state.json` + marcadores `<!-- gentle-ai:` (F18, já existente).**
7. **Contrato existente (lido na íntegra)** — `AgentAdapter {id, bin, installHint, detect, paths, inject, remove, readMcpFingerprint, readMcpEntry}` (`src/adapters/types.ts`; `AgentId = "claude-code"|"opencode"|"codex"` — union ADITIVA para "copilot"); `HostPaths {rulesFile, mcpFile, mcpKey, configHome}`; `AgentContext {rt, mcpBin, mcpBinCommand?, rulesContent, preserveRules?, mcpArgs, mcpEnvironment?, targets?}`; `src/matrix.ts` (AGENTS + MATRIX com células pi-packages/mcp/rules/native/unsupported); `src/adapters/mcpConfig.ts` (`renderMcpEntry(host)` switch por AgentId + `renderMcpConfig` + guard anti-upstream + `mcpEntryContentHash`); `src/adapters/rules.ts` (RULES_SECTION `runecraft:workflow`, família html — API F15 intacta); `src/owners.ts` (gentle-ai state + marcadores estritos); goldens F23 (`test/golden/mcp-claude.golden` etc. via `test/eval/goldens.ts`).

## Goals

- [ ] **Adapter copilot completo** no padrão F15 (`AgentAdapter`: detect/paths/inject/remove/readMcpFingerprint/readMcpEntry) + registro/aliases (`copilot`; alias `vscode`/`vscode-copilot`/`github-copilot`) — COP-01/02
- [ ] **Regras repo-scoped** em `.github/copilot-instructions.md` (marker `runecraft:workflow` família html; conteúdo = `renderRules("copilot")` = NON_PI_RULES — reuso F19, zero duplicação); alternativa `AGENTS.md` documentada (QA-1) — COP-03
- [ ] **MCP taskflow** em `.vscode/mcp.json` (`servers.taskflow`, schema VS Code verificado: `type: "stdio"` + command/args/env; reuso do host `@runecraft/taskflow-claude` — QA-2; guard anti-upstream; fingerprint D7) — COP-04
- [ ] **Detecção honesta** (bin `code`/`code-insiders` no PATH OU dirs de extensão `github.copilot*`/`github.copilot-chat*`; fail-closed com hint display-only quando ausente; detect-only informativo) — COP-05
- [ ] **Coluna copilot na matriz F17** (AGENTS + MATRIX.copilot: células mcp+rules acionáveis + 4 unsupported Pi-only; `firstUnsupported` fail-closed; célula guards = sem enforcement em Copilot — honestidade F24/F17) — COP-06
- [ ] **Wiring install/uninstall/doctor/status/sync** (--agent copilot; backup F13 + lock F18; uninstall content-based D7/SETM; doctor check novo; status 3 fontes; sync three-way F19 por conteúdo) — COP-07
- [ ] **Conflitos/two-driver** (gentle-ai user-level → owners warn + gate MXST-04; conteúdo do usuário em `.github/copilot-instructions.md`/`.vscode/mcp.json` preservado e reportado) — COP-08
- [ ] **Evals EVAL-049..056** (golden novo `mcp-copilot.golden`; detect/inject/remove round-trips em workspace temp; fail-closed; matriz; two-driver; sync) + EVAL-MATRIX **v9 aditiva** (após F30 fechar v8 — one writer thread) + MIN_EVIDENCE_FILES bump (AD-025) — COP-09
- [ ] **Docs** (ROUTING.md §nova — F19 dono; tabela de agentes; STATE.md) — COP-10

## Out of Scope

| Feature | Reason |
| --- | --- |
| Novo host `@runecraft/taskflow-copilot` (package novo) | Zero deps novas + escopo packages/harness; o servidor MCP é stdio genérico — reuso do host existente (QA-2); inventar package = fabricação |
| Enforcement dentro de sessões Copilot (guards F24) | Decisão do briefing: fail-closed + detect-only honesto; guards são Pi-only (F24/F17) — a matriz declara `unsupported` com motivo |
| Alvo user-level (`~/.copilot/copilot-instructions.md`, `~/.copilot/mcp-config.json`) como default | QA-5 (recomendado: workspace). User-level seria global demais para o padrão repo-scoped do harness e colidiria semanticamente com a persona do gentle-ai |
| Paridade com gentle-ai (delegação runSubagent, skills SDD no Copilot) | Outro produto (Go, orquestração SDD própria); o harness entrega rules+MCP (matriz) — delegação = F32 (papéis) |
| Copilot cloud agent / code review (github.com, remoto) | Adapter é LOCAL (VS Code) — cloud agent é superfície web, fora do padrão F15 |
| Cursor/Windsurf/Kiro etc. | Detect-only existente (F15 ADPT-03); adapters adicionais = Future Considerations |
| Mudanças no F15/F17/F18/F19 (retrofit) | Reuso read-only: contrato AgentAdapter, matriz, sections/owners, renderRules intactos |
| Replanejar F29/F30 | Matriz v9 só entra após F30 fechar v8 (one writer thread) |

## Gray area (resolver antes do Execute — 5 decisões)

Opções + recomendação no design (QA-1..QA-5); o Execute NÃO começa sem as respostas:

- **QA-1 — Alvo das regras**: (a) **recomendado — `.github/copilot-instructions.md`** (repo-wide do Copilot, docs verificado; específico do Copilot — não toca AGENTS.md que outros agentes/ferramentas leem) · (b) `AGENTS.md` na raiz (padrão agentsmd, lido pelo Copilot coding agent e por outras ferramentas — mais superfície de conflito) · (c) ambos com flag de config
- **QA-2 — Host MCP**: (a) **recomendado — reuso `@runecraft/taskflow-claude`** (servidor MCP stdio; resolveMcpBin("claude") env > dev fork > npx pin; zero package novo) · (b) reuso `@runecraft/taskflow-grok` · (c) package novo `taskflow-copilot` (FORA do escopo — zero deps)
- **QA-3 — Detecção**: (a) **recomendado — bin `code`/`code-insiders` no PATH OU dirs de extensão `github.copilot*`** (bin + extensão = honesto; CLI do VS Code nem sempre está no PATH) · (b) só bin `code` · (c) presença de config (`.vscode/` no repo / settings)
- **QA-4 — Raiz do workspace**: (a) **recomendado — cwd** (harness roda na raiz do repo; determinístico em testes com dirs temp; precedente F29 `gitRoot` documentado) · (b) `git rev-parse --show-toplevel`
- **QA-5 — Escopo do MCP**: (a) **recomendado — `.vscode/mcp.json` (workspace)** (versionável/compartilhável — docs; repassado pelo VS Code ao Agent Host; "use only one location per server") · (b) `~/.copilot/mcp-config.json` (user, lido nativamente pelo Agent Host) · (c) ambos (contraindicado pelos docs)

**Já decidido (não é gray area):** zero deps novas; offline/$0; escopo packages/harness; requirement IDs COP-01..10; EVAL-MATRIX v9 aditivo com notas datadas (F21 D9 — v9 após F30 fechar v8, one writer thread); evidência via evalTest() (F21); fail-closed + detect-only honesto (sem enforcement em sessões Copilot — F24/F17); conteúdo de regras = template non-Pi do F19 (reuso read-only — zero texto novo); golden novo para o render MCP; marcadores família html (F18); id `copilot` + aliases; agentes = pi, opencode, claude, codex, copilot (AD-022 decisão 8); TUI fora (AD-005).

## User Stories

### P1: Adapter Copilot + coluna na matriz — COP-01..07 ⭐ MVP

**User Story**: Como usuário, quero que o harness detecte, injete (rules `.github/copilot-instructions.md` + MCP `.vscode/mcp.json`) e remova (content-based) a integração do Copilot/VS Code no padrão dos demais adapters — com a coluna copilot na matriz e wiring completo (install/uninstall/doctor/status/sync) — para que o 5º agente do M8 entre com as mesmas garantias fail-closed dos outros.

**Why P1**: Roadmap F31 (prereq F15/F16/F17); AD-022 decisão 8 (copilot/vscode é alvo M8); hoje zero presença do harness no Copilot.

**Acceptance Criteria**:

1. WHEN `harness install --agent copilot` roda com VS Code+Copilot detectado THEN escreve a seção `runecraft:workflow` em `.github/copilot-instructions.md` (família html; conteúdo = `renderRules("copilot")` byte-idêntico ao NON_PI_RULES do F19) E o entry `servers.taskflow` em `.vscode/mcp.json` (schema VS Code: `type:"stdio"` + command/args; reuso do bin `@runecraft/taskflow-claude` via resolveMcpBin) — fail-closed display-only com hint quando NÃO detectado (zero writes)
2. WHEN o install roda 2x THEN os dois arquivos ficam byte-idênticos (idempotência F15); targets registrados no state `agents.copilot.targets` com contentHash (F17)
3. WHEN `status` roda THEN há coluna copilot com células das 3 fontes (config real × state × matriz) — mcp ok/ausente, rules ok/ausente, 4 células `unsupported` com motivo "é extensão Pi; use --agent pi"
4. WHEN `harness uninstall --agent copilot` roda THEN remove a seção/entry somente quando o fingerprint atual == registrado (D7); edição do usuário → preserved+edited reportado (SETM-05/06); arquivo vazio removido (D6); marcadores não registrados preservados (F18)
5. WHEN `harness sync` roda THEN re-injecta/atualiza/preserva por conteúdo (three-way F19) incluindo os alvos copilot; órfãos reportados, nunca removidos
6. WHEN o doctor roda THEN check novo informa detecção copilot (bin/extensão), configs parseáveis e estado gerenciado — numeração a validar no Execute

**Independent Test**: fixture env (workspace temp + fake `code` bin no PATH mínimo — padrão AD-017 + fake extensions dir): detect → inject (goldens byte-a-byte) → 2ª inject idêntico → remove por fingerprint → preserve quando editado; fail-closed sem detecção; matrix-consistency cobre a coluna.

### P1: Conflitos/two-driver honestos — COP-08

**User Story**: Como usuário, quero que o harness NUNCA sobrescreva conteúdo meu ou do gentle-ai nos arquivos do Copilot — detectando donos e reportando — para que a coexistência multi-agente (F18) valha também para o Copilot.

**Why P1**: gentle-ai já gerencia o Copilot (user-level); usuários já têm `.github/copilot-instructions.md` próprios; o padrão da casa é detectar donos (F18) e preservar por conteúdo (SETM/D6).

**Acceptance Criteria**:

1. WHEN o repo/usuário tem arquivos do gentle-ai para o Copilot (`~/.gentle-ai/state.json`, `~/.copilot/*` ou marcadores `<!-- gentle-ai:` em arquivos de regras gerenciados) THEN o owners.ts reporta (warn) e o install com colisão exige `--yes` (gate MXST-04); sem TTY sem --yes → aborta apontando --yes
2. WHEN `.github/copilot-instructions.md` já existe com conteúdo do usuário THEN a seção `runecraft:workflow` é adicionada sem tocar no resto (upsert por marcador); sync NUNCA reescreve a seção se o usuário a editou (preserveRules — three-way "preservada (editada)")
3. WHEN `servers.taskflow` já existe em `.vscode/mcp.json` sem registro no state THEN conflict reportado, nunca sobrescrito (D5 F15 — mesmo padrão claude/opencode)
4. WHEN o fingerprint do MCP difere do registrado THEN o remove preserva e reporta `edited` (D7 — gate do REMOVE)

**Independent Test**: workspace temp com copilot-instructions.md do usuário (conteúdo fora do marcador) + entry MCP manual → inject preserva ambos; gentle-ai markers plantados → owners warn + gate; sync three-way com seção editada → preservada.

### P2: Evals + governança — COP-09/10

**User Story**: Como mantenedor, quero EVAL-049..056 offline/$0 provando detecção/injeção/remoção/fail-closed/matriz/two-driver/sync do Copilot — matriz v9 aditiva — para o adapter não regredir.

**Why P2**: Política da casa (F21 D9); qualquer adapter novo entra com a mesma disciplina de evidência.

**Acceptance Criteria**:

1. WHEN a suite `copilot` roda THEN EVAL-049..056 executam na lane F21 offline/$0 (fixture; PATH mínimo; zero LLM; zero rede)
2. WHEN o case de golden roda THEN `renderMcpConfig("copilot")` == `test/golden/mcp-copilot.golden` byte-a-byte (F23) e `renderRules("copilot")` == NON_PI_RULES (ausência `goal|loop|subagent|pr-review|auditor`)
3. WHEN a matriz roda THEN EVAL-MATRIX v9 aditiva (EVAL-049..056 + nota datada; bump 8→9 após F30 fechar v8 — one writer thread); consistência varre a suite nova; MIN_EVIDENCE_FILES bump (AD-025)
4. WHEN um caso roda 2x THEN resultados idênticos (sem $TMP/$TS — F21 D10)

**Independent Test**: cada case valida schema F26; determinismo 2 runs; goldens byte-a-byte; consistência matriz↔suites.

## Edge Cases

- WHEN VS Code está instalado mas o CLI `code` não está no PATH THEN a detecção cai para os dirs de extensão (`~/.vscode*/extensions/github.copilot*`); nenhum dos dois → not installed + reasons (fail-closed no install)
- WHEN `.github/copilot-instructions.md` existe com conteúdo do usuário THEN upsert por marcador preserva tudo fora da seção (nunca clobber); arquivo sem marcador e sem registro → nosso? sim → re-inject idempotente (F19 three-way)
- WHEN `servers.taskflow` em `.vscode/mcp.json` não é registrado como nosso THEN conflict (D5) — install reporta e não sobrescreve; remove NUNCA toca
- WHEN o usuário edita a seção `runecraft:workflow` THEN sync classifica "preservada (editada)" (contentHash ≠ render; benigno, nunca auto-cura — F19 D7)
- WHEN o entry MCP editado THEN fingerprint ≠ registrado → remove preserva + edited (D7)
- WHEN um dos arquivos é ilegível/não-UTF8 THEN NonUtf8FileError → fail-closed reportado (F18), nunca crash
- WHEN há gentle-ai user-level (state ou marcadores) THEN owners warn + gate MXST-04 (sem TTY sem --yes aborta)
- WHEN o mesmo comportamento já é coberto por EVAL-017..021/022..029/030..038/039..048 THEN delta documentado no case (ex.: sync three-way provado no F19 — F31 prova a ADIÇÃO dos alvos copilot, não o mecanismo)
- WHEN um caso roda 2x THEN resultados idênticos (workspace temp fixo por case; asserts excluem payload volátil)

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| COP-01 | P1: Adapter copilot (AgentAdapter completo — padrão F15) | Design | Pending |
| COP-02 | P1: Registry/aliases (id copilot; vscode/vscode-copilot/github-copilot) | Design | Pending |
| COP-03 | P1: Rules repo-scoped `.github/copilot-instructions.md` (reuso NON_PI_RULES) | Design | Pending |
| COP-04 | P1: MCP `.vscode/mcp.json` servers.taskflow (schema VS Code; reuso host claude) | Design | Pending |
| COP-05 | P1: Detecção (bin code + extensions dir; fail-closed; detect-only honesto) | Design | Pending |
| COP-06 | P1: Coluna copilot na matriz F17 (células mcp/rules/unsupported) | Design | Pending |
| COP-07 | P1: Wiring install/uninstall/doctor/status/sync (backup, lock, three-way) | Design | Pending |
| COP-08 | P1: Conflitos/two-driver (gentle-ai user-level; conteúdo do usuário preservado) | Design | Pending |
| COP-09 | P2: Evals EVAL-049..056 + mcp-copilot.golden + EVAL-MATRIX v9 | Design | Pending |
| COP-10 | P2: Docs (ROUTING §nova, tabela de agentes, STATE.md) | Design | Pending |

**Coverage:** 10 total, 0 mapeados, 10 unmapped (mapeamento em design.md e tasks.md)

## Success Criteria

- [ ] Adapter copilot no padrão F15 completo (detect/paths/inject/remove/readMcpFingerprint/readMcpEntry) + registro/aliases — zero mudança no contrato `AgentAdapter`
- [ ] Regras em `.github/copilot-instructions.md` (marker html `runecraft:workflow`; conteúdo = `renderRules("copilot")` == NON_PI_RULES — reuso F19, sem duplicação; golden do conteúdo já coberto pelo F19)
- [ ] MCP em `.vscode/mcp.json` (`servers.taskflow`; schema VS Code verificado; reuso do host taskflow-claude; guard anti-upstream; fingerprint D7) + golden novo `mcp-copilot.golden`
- [ ] Detecção honesta (bin `code`/extensions dir) + fail-closed display-only no install; detect-only informativo
- [ ] Coluna copilot na matriz (AGENTS + MATRIX + AgentId union aditiva; células mcp/rules + 4 unsupported com motivo; guards sem enforcement — honestidade F24/F17)
- [ ] Wiring install/uninstall/doctor/status/sync sem regressão (backup F13, lock F18, three-way F19, gate MXST-04, uninstall content-based D7/SETM)
- [ ] Two-driver: gentle-ai user-level detectado (owners) + conteúdo do usuário sempre preservado/reportado (nunca clobber)
- [ ] EVAL-049..056 verdes offline/$0; EVAL-MATRIX v9 aditivo (após F30 fechar v8); MIN_EVIDENCE_FILES bump (AD-025); sem regressão
- [ ] Fronteiras explícitas: F15 dono do contrato; F17 dono da matriz (aditivo); F19 dono do renderRules (reuso read-only); F18 dono de sections/owners (reuso); F31 sem package/deps novos; F32 independente
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)
