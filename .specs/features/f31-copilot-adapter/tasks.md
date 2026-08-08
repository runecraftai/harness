# F31 — Tasks (Copilot/VSCode Adapter)

**Base:** design.md D1–D12 (aguarda QA-1..QA-5 → AD-031) · infra reutilizada: F13 (state `agents.<id>.targets` + contentHash + backups), F15 (AgentAdapter contract — types.ts/registry.ts/shell.ts; inject/remove content-based D5/D7; lições: homes via `env.HOME`, fingerprint lido do arquivo, `command -v` via `sh -c`), F16 (camada MCP vendored — hosts claude/codex/opencode/grok), F17 (matriz declarativa + firstUnsupported + status 3 fontes + sync por conteúdo), F18 (sections html family + owners + gate MXST-04 + lock), F19 (`renderRules` non-Pi — reuso read-only; sync three-way), F21 (fixture, evalTest → evidência, EVAL-MATRIX), F23 (goldens — ratchet F23), F24 (guards Pi-only — honestidade da matriz), F29/F30 (matriz v7→v8; one writer thread)
**Dependências de decisão:** T1 (QA-1 alvo rules — default `.github/copilot-instructions.md`) · T2 (QA-2 host MCP — default reuso claude) · T2/T3 (QA-5 escopo MCP — default workspace `.vscode/mcp.json`) · T1/T3 (QA-3 detecção — default bin + extensions) · T1/T3 (QA-4 workspace root — default cwd) — implementar o recomendado; ajuste barato se o usuário escolher outra opção

## T1 — src/adapters/copilot.ts (D1/D2/D6/D7, COP-01/03/05) — depende QA-1/QA-3/QA-4

- [ ] `copilotAdapter: AgentAdapter` (contrato F15 intacto — types.ts só ganha a union aditiva): `id: "copilot"`, `bin: "code"`, `installHint` display-only (instalar VS Code + extensão GitHub Copilot — nunca executado)
- [ ] `detect(rt)`: (1) `resolveBinaryOnPath("code"|"code-insiders", rt.env)` (shell.ts) OU (2) glob de dirs de extensão `github.copilot*`/`github.copilot-chat*` sob `~/.vscode*`/`extensions` (homeDir via `env.HOME` — lição F15); `installed: true` com `binPath` quando bin; ausente → `installed: false` + `reasons[]` com hint; `configHome = <workspace>/.vscode` (informativo)
- [ ] `paths(rt)`: `rulesFile = <workspace>/.github/copilot-instructions.md`, `mcpFile = <workspace>/.vscode/mcp.json`, `mcpKey = "taskflow"`, `configHome = <workspace>/.vscode` — workspace root = `process.cwd()` (QA-4a recomendado; validar gitRoot no Execute)
- [ ] `inject(ctx)`: rules via `upsertSection(rulesFile, RULES_SECTION, ctx.rulesContent)` (família html F18; `preserveRules` F19 D7 respeitado — nunca reescreve seção editada); MCP via `upsertJsonKey(mcpFile, ["servers", "taskflow"], renderMcpEntry("copilot", ctx))` — entry não registrada → conflict (D5 F15); escrita em `written[]`/`conflicts[]`
- [ ] `remove(ctx)`: section via `removeSection` (arquivo vazio → unlink D6); entry `servers.taskflow` removida SOMENTE quando `target.contentHash === sha256Hex(JSON.stringify(current))` (D7); editada → `edited[]` + `preserved[]`; marcadores não registrados preservados (F18)
- [ ] `readMcpFingerprint(rt)`: sha256 do entry atual de `servers.taskflow` (null quando ausente) — mesma função no registro e na remoção (lição F15); `readMcpEntry(rt)`: entry bruto (objeto) ou null
- [ ] **Verificar:** unit com workspace temp + PATH mínimo (AD-017) — detect (bin fake / extensions dir fake / ausente com reasons), inject idempotente 2 runs byte-idênticos, remove por fingerprint, preserve/editado/deletado, BOM/CRLF (F18), não-UTF8 → NonUtf8FileError fail-closed; TSC limpo; zero deps novas (audit de imports)

## T2 — mcpConfig.ts + registry.ts + types.ts (D1/D4/D5, COP-02/04) — depende T1; QA-2/QA-5

- [ ] `types.ts`: `AgentId` union ADITIVA += `"copilot"` (contrato e demais ids intocados)
- [ ] `registry.ts`: `ADAPTERS["copilot"] = copilotAdapter`; `SUPPORTED_AGENT_IDS` += copilot; `AGENT_ALIASES` += `copilot`/`vscode`/`vscode-copilot`/`github-copilot` → `copilot` (compat com a nomenclatura do gentle-ai); `isSupportedAgentId`/`resolveAgentId` fluem automaticamente
- [ ] `mcpConfig.ts`: case `"copilot"` em `renderMcpEntry` → `{type: "stdio", command, args?, env?}` (schema VS Code verificado — [vscode-docs mcp-configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration); env = `ctx.mcpEnvironment` quando presente; SEM `${input:...}` — Agent Host repassa o resto); `renderMcpConfig("copilot")` → arquivo completo `{"servers": {"taskflow": <entry>}}\n` (2-space; D5 — desvio documentado do F23 D4: nesting 2 níveis); reuso do host: `resolveMcpBin("claude", rt)` (QA-2a recomendado — env `RUNECRAFT_TASKFLOW_CLAUDE_BIN` > dev fork > npx pin; guard anti-upstream passa)
- [ ] **Verificar:** unit — renderMcpEntry("copilot") shape (type/command/args/env opcional), renderMcpConfig bytes, guard anti-upstream com comando upstream → UpstreamReferenceError (nunca injetado), registry resolve aliases; golden `mcp-copilot.golden` gerado do render (F23) — ver T8; TSC limpo; zero deps novas

## T3 — src/matrix.ts (D8, COP-06) — paralelo a T1/T2

- [ ] `AGENTS.copilot = {binary: "code", display: "Copilot (VS Code)", note: "repo-scoped (workspace); sem enforcement — guards são Pi-only (F24)"}`
- [ ] `MATRIX.copilot`: `taskflow: {kind:"mcp", entry:"taskflow"}` + `rules: {kind:"rules", file: ".github/copilot-instructions.md", section: RULES_SECTION}` + 4 células `unsupported` (subagents/goal-loop-audit/pr-review — motivo "é extensão Pi; use --agent pi"; guards — motivo com nota F24 sem enforcement); células existentes INTOCADAS (matriz aditiva — F17 D1)
- [ ] **Verificar:** `columnComponents("copilot")` = [taskflow, rules]; `firstUnsupported(["copilot"], ["subagents"])` retorna o motivo; status/install consomem via API genérica (sem hardcode novo); teste de consistência da matriz (EVAL-054)

## T4 — commands wiring: install/uninstall/doctor/status/sync (D9, COP-07) — depende T1..T3

- [ ] `install --agent copilot`: resolve via registry (aliases ok); detect ausente → recusa fail-closed display-only com hint (zero writes); par agente×componente via matriz (misto com `--component` Pi-only → firstUnsupported recusa); backup F13 + lock F18; dry-run sem lock; gate MXST-04 (owners warn → TTY lista; sem TTY sem --yes → aborta apontando --yes); targets pós-inject registrados no state (contentHash — fingerprint lido do ARQUIVO)
- [ ] `uninstall --agent copilot`: content-based (D7/SETM-05/06 — entry/section só com fingerprint registrado; edição preservada+reportada; arquivo vazio removido; marcador não registrado preservado — F18)
- [ ] `doctor`: check novo (detecção copilot informativa + configs parseáveis + estado gerenciado) — numeração a validar no Execute (pós-F25 check 19); sem crash com copilot ausente
- [ ] `status`: coluna copilot (3 fontes: configs reais × state × matriz; células ok/ausente/não gerenciado/colisão/órfã/—/não suportado; guards = "não suportado (sem enforcement — F24)"); `--json.agents[].components[]` com reason
- [ ] `sync`: three-way por conteúdo (F19 D7) cobre os alvos copilot (re-inject/update vN→vM/preserve/already-in-sync); órfãos reportados nunca removidos
- [ ] **Verificar:** fluxos com workspace temp + PATH mínimo (AD-017); install sem detecção → recusa + hint + zero arquivos; 2 runs byte-idênticos; uninstall preserve/editado/deletado; status JSON shape (superset — F16 AD-016); sync idempotente; sem regressão nos agentes existentes

## T5 — owners/two-driver (D10, COP-08) — depende T4

- [ ] `owners.ts`: scan de alvos copilot ADITIVO (`.github/copilot-instructions.md` no workspace + `.vscode/mcp.json`) na lista de managed files; detecção gentle-ai mantida (state `~/.gentle-ai/state.json` + marcadores `<!-- gentle-ai:` estritos); sobreposição SEMÂNTICA documentada (gentle-ai user-level `~/.copilot/...` × F31 repo-level — ambos fornecidos ao modelo; prioridade personal > repo)
- [ ] `install` com owners warn → gate MXST-04 (warn listado no TTY/report; `--yes` registra `warnings` no relatório)
- [ ] Conteúdo do usuário em `.github/copilot-instructions.md` fora do marcador → preservado (upsert nunca clobber); entry MCP não registrada → conflict (D5)
- [ ] **Verificar:** fixture com gentle-ai state fake + markers → owners detecta (warn + gate sem --yes aborta); usuário com copilot-instructions.md próprio → inject preserva conteúdo; sync com seção editada → "preservada (editada)" (F19 D7)

## T6 — docs (COP-10) — paralelo

- [ ] `docs/ROUTING.md` §nova: Copilot (VS Code) — alvos repo-scoped (`.github/copilot-instructions.md` + `.vscode/mcp.json`), detecção, two-driver gentle-ai (user-level × repo-level), matriz (mcp/rules + unsupported), reuso do host taskflow-claude; F19 dono do conteúdo das regras (renderRules intocado)
- [ ] Tabela de agentes no README do harness (matriz F17 — coluna copilot)
- [ ] **Verificar:** docs conferidas contra src (checklist: paths, markers, aliases, kill-switch n/a — F31 não adiciona kill switch próprio), ROUTING sem quebrar goldens do F19 (renderRules NÃO muda)

## T7 — golden novo + ratchet (D5/D11, COP-04/09) — depende T2

- [ ] `test/golden/mcp-copilot.golden`: bytes de `renderMcpConfig("copilot")` (arquivo mcp.json completo — `{"servers": {"taskflow": ...}}`); gerado via `--update` humano (F23 — recusa CI=true); ratchet F23 cobre (byte-a-byte)
- [ ] **Verificar:** golden == render (EVAL-049); `--update` não roda em CI; demais goldens intocados (mcp-claude/opencode/codex byte-idênticos — sem regressão F23)

## T8 — evals EVAL-049..056 + matriz v9 + MIN_EVIDENCE_FILES (D11, COP-09) — depende T1..T7

- [ ] Suite `test/eval/suites/copilot.ts` + cases EVAL-049..056 (formato F26; delta vs EVAL-017..048 documentado em comentário em cada case — ex.: sync three-way já provado no F19; F31 prova a ADIÇÃO dos alvos copilot): EVAL-049 render/goldens (mcp-copilot.golden byte-a-byte; `renderRules("copilot")` === NON_PI_RULES; ausência `goal|loop|subagent|pr-review|auditor`), EVAL-050 detect (fake `code` bin + fake extensions dir no PATH mínimo; ausente → not installed + reasons), EVAL-051 inject round-trip (2 runs byte-idênticos; conteúdo do usuário preservado; BOM/CRLF), EVAL-052 remove round-trip (fingerprint; edited/preserved; arquivo vazio deletado; marcador não registrado preservado), EVAL-053 fail-closed (install sem detecção → recusa + hint zero writes; misto --component Pi-only → firstUnsupported), EVAL-054 matrix/status (células copilot; status 3 fontes; JSON components; consistência), EVAL-055 two-driver (gentle-ai state/markers → owners warn + gate MXST-04; sync three-way re-inject/update/preserve), EVAL-056 sync/state (targets contentHash; sync idempotente; uninstall preservado; determinismo 2 runs)
- [ ] EVAL-MATRIX v9 aditivo (bump MATRIX_VERSION 8→9 **após F30 fechar v8** — one writer thread; EVAL-049..056 + nota datada); consistência matriz↔suites estendida para varrer a suite copilot; `MIN_EVIDENCE_FILES` bump (AD-025 — novo arquivo com evalTest; valor a validar no Execute pós-F30)
- [ ] **Verificar:** EVAL-049..056 verdes offline/$0 na lane F21 (workspace temp, PATH mínimo, zero fetch externo); evidência no last-run.json; 2 runs idênticos; sem regressão nos EVAL-001..048; consistência v9 verde

## Success Criteria (spec)

- [ ] Adapter copilot no padrão F15 completo (detect/paths/inject/remove/readMcpFingerprint/readMcpEntry) + registro/aliases — zero mudança no contrato `AgentAdapter` (só union aditiva do AgentId)
- [ ] Regras em `.github/copilot-instructions.md` (marker html `runecraft:workflow`; conteúdo = `renderRules("copilot")` == NON_PI_RULES — reuso F19, sem duplicação)
- [ ] MCP em `.vscode/mcp.json` (`servers.taskflow`; schema VS Code verificado; reuso do host taskflow-claude; guard anti-upstream; fingerprint D7) + golden novo `mcp-copilot.golden`
- [ ] Detecção honesta (bin `code`/extensions dir `github.copilot*`) + fail-closed display-only no install; detect-only informativo
- [ ] Coluna copilot na matriz (AGENTS + MATRIX + AgentId union aditiva; células mcp/rules + 4 unsupported com motivo; guards sem enforcement — honestidade F24/F17)
- [ ] Wiring install/uninstall/doctor/status/sync sem regressão (backup F13, lock F18, three-way F19, gate MXST-04, uninstall content-based D7/SETM)
- [ ] Two-driver: gentle-ai user-level detectado (owners) + conteúdo do usuário sempre preservado/reportado (nunca clobber)
- [ ] EVAL-049..056 verdes offline/$0; EVAL-MATRIX v9 aditivo (após F30 fechar v8); MIN_EVIDENCE_FILES bump (AD-025); sem regressão
- [ ] Fronteiras explícitas: F15 dono do contrato; F17 dono da matriz (aditivo); F19 dono do renderRules (reuso read-only); F18 dono de sections/owners (reuso); F31 sem package/deps novos; F32 independente
- [ ] ≤5 open questions para o usuário (QA-1..QA-5)

## Traceability COP → tasks

| Requirement | Tasks |
| --- | --- |
| COP-01 (adapter copilot) | T1, T8 |
| COP-02 (registry/aliases) | T2, T8 |
| COP-03 (rules repo-scoped) | T1, T6, T8 |
| COP-04 (MCP .vscode/mcp.json) | T2, T7, T8 |
| COP-05 (detecção) | T1, T8 |
| COP-06 (coluna matriz) | T3, T8 |
| COP-07 (wiring) | T4, T8 |
| COP-08 (conflitos/two-driver) | T5, T8 |
| COP-09 (evals + governança) | T7, T8 |
| COP-10 (docs) | T6 |

**Cobertura:** 10/10 · toda user story da spec tem requirement ID (COP-01..10) · todo requisito tem task.
