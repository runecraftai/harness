# F19 Design — Routing & Mental Model

**Status:** Ready for Execute (após aprovação)
**Decisões aprovadas:** doc canônico + template derivado — `ROUTING.md` completo para humanos + template curto por agente renderizado por `rules.ts` do F15 · variação por coluna da matriz (F17): Pi = 4 ferramentas + two-driver; Claude/OpenCode/Codex = só taskflow-MCP + review (sem citar goal-loop/subagents/pr-review — não citar o que não existe) · conteúdo baseado nos fatos verificados da pesquisa 2026-08-05 nos forks locais (nunca inventar capacidades; fatos não verificados marcados "validar no Execute")

## Contexto

Os 4 forks são ferramentas sobrepostas: chain de subagents vs DAG de taskflow vs goal loop com auditor isolado vs review. Escolher errado custa tempo e, no pior caso, quebra a sessão (two-driver rule — F7). F19 fecha o grupo WORK (F19–F20): o harness vira **mental model** (AD-011) — as regras de roteamento são documentadas (doc canônico para humanos) e **injetáveis** (o texto das regras é exatamente o conteúdo da seção `runecraft:workflow` que o F15 injeta nos agentes — F17 D1).

Cadeia que o F19 fecha: F15 entrega o mecanismo (`rules.ts`: marcadores/upsert/BOM/CRLF) e F17 a coluna da matriz (o que cada agente suporta); o **conteúdo** da seção é definido aqui. F18 garante IDs estáveis (`runecraft:workflow`) e update in-place; F12 (doctor/status/sync) ganha o driver ativo (P2) e a propagação de mudanças de template. A base factual é a pesquisa 2026-08-05 nos forks locais (fatos citados na seção D2); o hello world SDLC do F7 é o exemplo canônico — **COEX-05 ainda não executado** (scenarios.md do F7 pendente), então o resultado entra como placeholder preenchido quando o F7 fechar.

**Gray area resolvida (spec):** opção (a) — um `ROUTING.md` canônico no repo do harness + template derivado (mais curto, focado no agente) para a seção `runecraft:workflow`. Opção (b) (o documento É o template) rejeitada: a prosa completa para humanos é longa demais para o contexto do agente e mistura explicação com instrução.

## Decisões

### D1 — `ROUTING.md` canônico em `packages/harness/docs/ROUTING.md` (doc para humanos)

- Arquivo único, versionado por git, embarcado no package npm (files do `packages/harness/package.json`) — a versão publicada = versão do doc. Sem cópia gerada em outro lugar (uma fonte; F8 referencia em vez de duplicar).
- **Idioma: inglês** — é doc do produto (público npm), alinhado à decisão do F8 (v1 em inglês; artefatos `.specs` seguem PT-BR como hoje). Confirmação final no Execute do F8.
- Estrutura (seções fixas, ordem estável para navegação de 30s):

| # | Seção | Conteúdo | Requisito |
| --- | --- | --- | --- |
| 1 | Purpose & 30-second usage | o que é o harness, como usar a tabela | ROUT-01 |

> **Terminologia (seção 1)**: "gate" = fase de checagem de máquina do taskflow (eval/expect) — vs "gates" = delivery hooks pre-commit/pre-push do F20. Os dois sentidos aparecem na tabela (seção 3); a seção 1 define os termos (revisão 2026-08-05).
| 2 | One driver per session | two-driver rule completa (citação dos docs do glla) | ROUT-02 |
| 3 | Tool table | por ferramenta: o que faz / sinal de uso / contra-indicação (fatos D2) | ROUT-01 |
| 4 | Two-driver em profundidade | goal ativo → workers permitidos; sinais de violação; o que NUNCA fazer | ROUT-02 |
| 5 | Hello world SDLC | exemplo canônico versionado (data + resultado F7) | ROUT-03 |
| 6 | Limits per agent | tabela por coluna da matriz (F17): o que cada agente tem | ROUT-05 |
| 7 | Coexistence | gentle-ai (marcadores `gentle-ai:`) e outros owners — sem conflito | edge F18 |
| 8 | Quick reference (5 casos) | checklist caso → ferramenta (base do Independent Test da spec) | ROUT-01 |
| 9 | Appendix: injected text (golden) | o texto exato injetado por coluna (render de `renderRules()` — ver D9) | ROUT-04 |
| 10 | Last verified | data + versões dos forks verificados (D2) | Risco R3 |

### D2 — Tabela por ferramenta = fatos verificados da pesquisa 2026-08-05 (ROUT-01)

Conteúdo das seções 3 e 8 do ROUTING.md. Cada célula cita só capacidades reais dos forks (pins: subagents 0.37.2 · taskflow 0.2.6 · goal-loop-audit 0.28.34 · pr-review 1.11.4 — AD-003):

| Ferramenta | O que faz (fatos) | Sinal de uso | Contra-indicação |
| --- | --- | --- | --- |
| **goal-loop-audit** | goal com contrato "Done when"; "Prose closes nothing... The ONLY way to close it is a complete_goal tool call that survives the isolated auditor"; auditor isolado (fresh pi session, sem extensões/skills/prompts, só read/grep/find/ls/bash, não vê a conversa do implementador); regression_shield: evidência obrigatória por item do contrato (`<approved/>` sem `<evidence>` → disapproval); ciclo drafting→active→auditing→complete; continuação via `agent_end`; `/loop` exige métrica numérica via comando `measure` ("A loop never completes") | tarefa fechável por contrato verificável ("Done when"); iteração com métrica honesta (`/loop`); trabalho que pode ser entregue a um auditor isolado | sem "Done when" verificável; sem métrica honesta para `/loop` (→ use `/goal`); trabalho que exige você dirigir a sessão interativamente |
| **taskflow** | DAG com `dependsOn` ("Phase order in the phases array is documentation, not execution order"); FlowIR com content hash por fase; resume (fork imutável) / replay (offline what-if) / recompute (só stale frontier); approvals (humano) vs gate (agente); budgets maxUSD/maxTokens (run termina blocked); eval (zero tokens) / expect (contrato JSON validado, fail closed) | fluxo multi-fase com dependências; fan-out; reprodutibilidade (resume/replay/recompute); orçamento definido | single-file change; debugging interativo; um bash command; "single quick delegation... the plain subagent tool is fine" |
| **subagents** | chains (sequência; passo recebe `{previous}`); parallel (concorrente; concurrency/failFast); acceptance gates auto/attested/checked/verified (verify roda comandos; "Child-reported command success does not count"); intercom (`contact_supervisor`); worktrees (cada child em worktree próprio; exige árvore limpa); watchdog (adversarial diff reviewer no `agent_end`); "Use only one writer against the active worktree at a time" | delegação ad-hoc; sequência com dependência simples; paralelismo independente; edição concorrente com worktrees; evidência via acceptance gates | fluxo multi-fase com dependências e re-execução (→ taskflow); trabalho que dirige a sessão (→ goal-loop) — contra-indicações derivadas do roteamento (os docs do fork não listam contra-indicação explícita; validar no Execute) |
| **pr-review** | JSON estruturado validado (verdict; findings P0–nit com blocking/confidence); 5 passes default; dispatch paralelo por tiers; verificação opcional contra o head exato; gate dentro de fluxo (F20, AD-011) | revisar um diff pontual; gate pre-commit/pre-push dentro de fluxo | sem contra-indicação documentada nos forks — validar no Execute |

**Quick reference (seção 8 — 5 casos do Independent Test da spec):**

| Caso | Rota |
| --- | --- |
| Feature multi-fase com dependências e re-execução | taskflow |
| Delegação rápida de uma subtarefa | subagents |
| Refinar iterativamente com métrica numérica honesta | goal-loop (`/loop`) |
| Fechar tarefa com contrato verificável + auditor isolado | goal-loop (`/goal`) |
| Revisar um diff antes do merge | pr-review |

### D3 — Two-driver rule explícita (ROUT-02)

Seções 2 e 4 do ROUTING.md + template Pi. Conteúdo (fato dos docs do goal-loop-audit):

> goal-loop dirige a sessão via `agent_end`; "any plugin that drives agent turns on agent_end conflicts — two supervisors scheduling continuations into one session produce contradictory turns. **One driver at a time**".

Definições no doc: **driver** = quem agenda continuações da sessão (o goal-loop quando ativo); **worker** = trabalho disparado dentro da sessão que não agenda continuação (subagents, taskflow). Regra: com goal ativo, subagents/taskflow entram como workers; nunca dois drivers na mesma sessão.

### D4 — Hello world SDLC versionado (ROUT-03)

Seção 5 do ROUTING.md. Formato da entrada de versão (o exemplo **atual** completo + histórico de versões anteriores em tabela curta — data, resultado, deltas; nunca sobrescreve a anterior):

```
## Hello world SDLC — v<data ISO>
- **Fluxo (F7)**: goal trivial com "Done when" → implementação via dispatch (subagents ou taskflow) → auditor isolado verifica com evidência (regression_shield) → review → ciclo fecha (complete_goal sobrevive ao auditor)
- **Resultado F7 (COEX-05)**: PENDENTE — preencher quando o F7 fechar (data + resultado real; transcript/resultado em .specs/features/f7-coexistence-validation/scenarios.md) — validar no Execute
- **Reprodução**: repo de teste descartável; comandos/tempos/tokens aproximados do scenarios.md
```

Regra: qualquer mudança de fluxo/comando entre versões gera nova entrada versionada — nunca editar o exemplo atual em silêncio.

### D5 — Template determinístico em `rules.ts` (ROUT-04)

- `renderRules(agentId: AgentId): string` (F15, `src/adapters/rules.ts`) devolve **só o conteúdo interno** da seção; os marcadores `<!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->` e o upsert (BOM/CRLF/newline) são do F15/F18.
- **Determinismo**: função pura — templates são literais constantes; **nada de** Date/timestamp, locale, env (`RUNECRAFT_*`), versão de fork interpolada ou dados de sessão no texto. Rerun = mesmo texto byte a byte (rerun do inject = zero mudanças, idempotência F15).
- Constante `WORKFLOW_RULES_VERSION = "1"` em `rules.ts`; o header do texto traz "(v1)". Bump manual quando o texto muda intencionalmente (o sync detecta via contentHash — D7).
- **Limite de tamanho** (mitiga poluição de contexto): Pi ≤ ~45 linhas (~2 KB); não-Pi ≤ ~25 linhas (~1 KB). Assert no F21 (teste falha se estourar; calibrar no Execute).
- O texto completo do v1 é definido na seção **Conteúdo dos templates** abaixo — é a fonte de verdade do conteúdo (F15/F17 referenciam o F19 como dono do texto; revisão cruzada no final).

### D6 — Variação por coluna da matriz (ROUT-05)

- **Pi** (`renderRules("pi")`): as 4 ferramentas + two-driver + worker rule (template completo).
- **Claude/OpenCode/Codex** (`renderRules(agentId)` não-Pi): **só** taskflow-MCP + review — a "review" é a capacidade do próprio taskflow (approvals/gate + eval/expect como verificação de contrato dentro do fluxo; resposta ao gray area da spec "taskflow + review via gate MCP?"). Sem menção a goal-loop/subagents/pr-review (nem "subagent tool" — a contra-indicação de delegação rápida é adaptada para "do it directly in the session").
- **v1: um único texto para os 3 não-Pi** (decisão aprovada). A nota do Codex (solo, sem permissions/output styles — F17) fica na matriz/status, não no template; se o Execute revelar necessidade de adaptação por agente, vira bump de template (ROUT-06).
- **Teste de ausência no F21**: grep por `goal|loop|subagent|pr-review|auditor` no render não-Pi → zero matches (AC 1.3 da spec).

### D7 — Sync propaga mudanças de template (ROUT-06)

Extensão do sync do F18 (que só re-injetava seção ausente). Comparação **three-way** por target rules: conteúdo do arquivo × `contentHash` registrado no state (F17 D2) × hash do render atual:

| Arquivo vs state vs render | Estado | Ação do sync |
| --- | --- | --- |
| seção ausente do arquivo (registrada no state) | quebrado (F18) | re-injeta (F18 — seção apagada à mão) |
| arquivo == registrado ≠ render atual | template mudou (CLI nova) | **update in-place** pelo ID estável `runecraft:workflow` (F18 Update) + contentHash novo no state — ROUT-06 |
| arquivo == registrado == render | em sincronia | zero writes (rerun = zero mudanças) |
| arquivo ≠ registrado | usuário editou | **preserva + reporta** `preserved (edited)` (SETM-05/F18) — nunca sobrescrever |

Relatório do sync: re-injetada / atualizada (template vN→vM) / preservada (editada) / already in sync. Doctor check 9 do F18 ganha o sub-estado "desatualizado (template novo)" → remedy `harness sync --agent X`.

### D8 — Driver ativo no status/doctor (ROUT-07)

- Novo módulo `src/sessionDriver.ts` com `detectActiveDriver()`: leitura do estado do goal-loop-audit na sessão Pi.
- **Mecanismo de leitura a validar no Execute** (pesquisa no fork glla em Execute/F21): candidatos — (a) entry/arquivo de estado de sessão do glla em `~/.pi/agent/` (path exato a confirmar no source do fork); (b) tool/command status registrado pela extensão glla na sessão Pi; (c) diretório de estado próprio do fork. Corte de "goal ativo" (drafting conta? só active/auditing?) a validar no Execute.
- **Saída** (status do F12, TTY): goal ativo → `driver: goal-loop`; nenhum goal/loop ativo → `driver: sessão (direto)` + lembrete "subagents/taskflow são workers compatíveis" (AC 3.2). `--json`: `session: { driver: "goal-loop" | "direct" | "unknown" }`.
- Leitura indisponível (estado ilegível/ausente) → `unknown`/"não avaliado", **sem crash** (padrão F12 edge de `pi list`).
- Doctor: **check 16** "Driver ativo" (informativo, read-only — LIFE-01; `skip` se Pi ausente, dependência do check 1). Alocado após a tabela consolidada 7–15 do F18; renumerar no Execute se necessário.
- Escopo: a sessão Pi em que o harness roda; múltiplas sessões paralelas → comportamento a validar no Execute (documentado no doc).
- Não-Pi: linha não se aplica (`—`); goal-loop não existe na coluna (F17).

### D9 — Anti-divergência doc ↔ template (uma fonte de verdade)

- **`rules.ts` é a fonte única do texto injetado** (conteúdo deste design, D5).
- O ROUTING.md **embute o texto exato** na seção 9 (Appendix: injected text — golden, delimitado por marcadores de bloco estáveis).
- Teste F21: `renderRules(agentId)` == bloco golden correspondente do ROUTING.md (extraído por delimitador). Divergência em qualquer par (render × apêndice × state) = **teste vermelho**, nunca drift silencioso.
- Rejeitada: gerar o template do doc via script (parse de markdown = mecânica frágil para ~4KB de texto; o doc tem prosa que não é para injetar).

## Conteúdo dos templates (v1) — fonte de verdade do texto injetado

Conteúdo interno da seção (os marcadores são do F15/F18). Texto em inglês (D1).

### Template Pi — `renderRules("pi")`

```markdown
Runecraft workflow rules (v1)

Four tools overlap. Pick by situation — the wrong pick costs time or breaks the session.
If a goal is active, it drives the session: see "One driver".

## One driver per session
- The goal-loop directs the session: it schedules continuations via agent_end.
- subagents and taskflow run as WORKERS under the active driver.
- Never have two drivers in one session — two supervisors scheduling continuations
  into one session produce contradictory turns.

## goal-loop-audit — verifiable contract with an isolated auditor
- Use when the work can be stated as a goal with a "Done when" contract.
- Prose closes nothing. The ONLY way to close a goal is a complete_goal tool call
  that survives the isolated auditor: a fresh session (no extensions/skills/prompts;
  read/grep/find/ls/bash only) that cannot see your conversation.
- Evidence is required per contract item: <approved/> without <evidence> is disapproved.
- Cycle: drafting → active → auditing → complete; continuation via agent_end.
- /loop requires an honest numeric metric measured with the measure command
  ("A loop never completes" without one). No honest metric? Use /goal.
- Contraindicated: no verifiable "Done when"; no honest metric for /loop; work that
  requires you to drive the session interactively.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- eval (zero tokens) / expect (validated JSON contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (the plain subagent tool is fine).

## subagents — ad-hoc delegation
- Use for chains (each step receives {previous}) or parallel (concurrency/failFast).
- Acceptance gates (auto/attested/checked/verified): verify runs commands —
  child-reported command success does not count.
- intercom (contact_supervisor); worktrees (each child in its own worktree; clean
  tree required); watchdog (adversarial diff review at agent_end).
- One writer against the active worktree at a time.
- Contraindicated: multi-phase flows with dependencies and reruns (use taskflow);
  session-driving work (use goal-loop).

## pr-review — structured review
- Use for reviewing a diff: structured JSON (verdict; findings P0–nit with
  blocking/confidence), 5 passes by default, parallel dispatch by tiers, optional
  verification against the exact head.
```

### Template não-Pi — `renderRules("claude-code" | "opencode" | "codex")`

```markdown
Runecraft workflow rules (v1)

You have taskflow-MCP for structured multi-phase work. Pick by situation.

## taskflow — multi-phase DAG work
- Use when the work is a DAG of phases: dependsOn edges ("phase order in the phases
  array is documentation, not execution order"); FlowIR hashes content per phase.
- resume (immutable fork) / replay (offline what-if) / recompute (stale frontier only).
- approvals (human) vs gate (agent); budgets (maxUSD/maxTokens) end a run as blocked.
- Review/verification inside a flow: eval (zero tokens) and expect (validated JSON
  contract, fail closed).
- Contraindicated: single-file change, interactive debugging, one bash command,
  a single quick delegation (do it directly in the session).
```

## Arquitetura — módulos

```
packages/harness/
├── docs/ROUTING.md            # canônico (D1; fonte do hello world e limites para o F8)
└── src/
    ├── adapters/rules.ts      # renderRules(agentId) — templates v1 (mecanismo: F15; conteúdo: F19 D5)
    ├── sessionDriver.ts       # detectActiveDriver() — leitura do estado do glla (D8; mecanismo a validar no Execute)
    ├── matrix.ts              # coluna por agente (F17 D1 — driver da variação D6)
    ├── commands/status.ts     # linha "driver: ..." + --json session.driver (F12 estendido)
    ├── commands/doctor.ts     # check 16 driver ativo + check 9 estendido (F18 estendido)
    └── commands/sync.ts       # three-way rules (D7 — F18 estendido)
```

## Fluxos

### F1 — Render e injecção (install, F15/F17 intactos)

```
install --agent X
  → matrix.ts coluna de X (D6 escolhe o template: pi | não-pi)
  → rules.ts renderRules(X)     # texto estático (D5), mesmo a cada chamada
  → F15 inject: append/upsert da seção <!-- runecraft:workflow --> ... <!-- /runecraft:workflow -->
  → state: agents.X.targets[].contentHash = hash do conteúdo renderizado (F17 D2)
```

### F2 — Sync atualiza o template (D7)

```
sync --agent X
  por target rules de X:
    seção ausente          → re-injeta (F18)                    [quebrado]
    arquivo == registrado ≠ render(X) → update in-place por ID  [template novo]
    arquivo == registrado == render   → zero writes              [em sincronia]
    arquivo ≠ registrado   → preserva + reporta (edited)        [usuário editou]
```

### F3 — Status mostra o driver (D8)

```
status
  detectActiveDriver()  # leitura do estado do glla na sessão — mecanismo a validar no Execute
  goal ativo  → "driver: goal-loop"
  sem goal    → "driver: sessão (direto)" + "subagents/taskflow são workers compatíveis"
  ilegível    → "driver: não avaliado" (sem crash)
  não-Pi      → "—" (goal-loop não existe na coluna)
```

### F4 — Manutenção do doc e do template (ciclo de mudança)

```
1. Fatos mudaram (fork subiu via F10; nova limitação descoberta no F7/F22)
   → revalidação: checklist "Last verified" do ROUTING.md (data + versões dos forks)
2. Edita ROUTING.md (tabela, quick reference) + regras.ts (template v1 → v2)
   + bump WORKFLOW_RULES_VERSION + nova entrada no apêndice golden
3. F21: golden test renderRules() == apêndice (divergência = vermelho)
4. Publica CLI nova → sync dos usuários aplica o update in-place (F2);
   doctor mostra "desatualizado (template novo)" até lá (D7)
5. F8: README raiz referencia o ROUTING.md (hello world + limits — DOCS-01)
   sem duplicar o conteúdo (fonte única)
```

## Riscos

| Risco | Mitigação |
| --- | --- |
| **Template longo polui o contexto do agente** | Limites: Pi ≤ ~45 linhas / não-Pi ≤ ~25 linhas (assert no F21; calibrar no Execute); template cita só sinal + contra-indicação; prosa/explicação fica no ROUTING.md |
| **Divergência doc ↔ template** | D9: `rules.ts` é a fonte única do texto injetado; apêndice golden no ROUTING.md; teste F21 compara render × apêndice — divergência = teste vermelho |
| **Regras desatualizadas vs versão dos forks (F10 bump)** | Header "Last verified" no ROUTING.md (2026-08-05: subagents 0.37.2, taskflow 0.2.6, glla 0.28.34, pr-review 1.11.4); checklist de revalidação ao subir fork; doctor check 9 estendido ("desatualizado (template novo)") com remedy sync (D7) |
| **Violação da two-driver apesar das regras (v1 é advisory)** | ROUT-07 dá visibilidade (status mostra o driver); template reforça a worker rule; automação de enforcement é Future (out of scope da spec) |
| **Leitura do driver indisponível (estado do glla ilegível/ausente)** | status mostra "não avaliado" sem crash (padrão F12 edge); mecanismo de leitura validado no Execute (D8) |
| **Template não-Pi citando ferramenta fora da coluna** | D6: template por coluna; teste de ausência no F21 (grep `goal|loop|subagent|pr-review|auditor` no render não-Pi) |
| **Usuário editou a seção + template novo** | D7: nunca sobrescrever (SETM-05/F18) — sync preserva + reporta `preserved (edited)`; doctor mostra o estado |
| **Coexistência com gentle-ai** | F18 já cobre (append/upsert só do bloco `runecraft:`; seções `gentle-ai:` intactas); F19 só define conteúdo — sem mecanismo novo |
| **Contra-indicações de subagents/pr-review "derivadas"** | D2 marca: subagents/pr-review não têm contra-indicação explícita nos docs dos forks — as linhas derivam do roteamento (sinais das outras ferramentas) e ficam marcadas "validar no Execute" no ROUTING.md |

## Requisitos cobertos

| Requirement ID | Story | Onde |
| --- | --- | --- |
| ROUT-01 | P1: Trigger rules (AC 1.1 tabela por ferramenta) | D1 (ROUTING.md seções 1/3/8) + D2 (tabela com o que faz / sinal / contra-indicação por ferramenta, baseada nos fatos) |
| ROUT-02 | P1: Trigger rules (AC 1.2 two-driver) | D3 + ROUTING.md seções 2/4 (goal-loop dirige via `agent_end`; subagents/taskflow como workers; nunca dois drivers) |
| ROUT-03 | P1: Trigger rules (AC 1.3 hello world) | D4 + ROUTING.md seção 5 (hello world versionado: data + resultado do F7; pendente COEX-05 — validar no Execute) |
| ROUT-04 | P1: Regras injetáveis (AC 2.1 template determinístico) | D5 (renderRules puro, literais, sem data/env/sessão; rerun = mesmo texto; idempotência F15) + D9 (golden test F21) |
| ROUT-05 | P1: Regras injetáveis (AC 2.2/2.3 variação por agente) | D6 (coluna F17: Pi = 4 ferramentas + two-driver; não-Pi = taskflow + review via gate, sem citar goal-loop/subagents/pr-review; teste de ausência no F21) |
| ROUT-06 | P1: Regras injetáveis (AC 2.4 sync atualiza) | D7 + Fluxo F2 (three-way hash; update in-place por ID estável `runecraft:workflow`; ausente re-injeta; editado preserva) |
| ROUT-07 | P2: Driver ativo (AC 3.1/3.2) | D8 + Fluxo F3 (status: `driver: goal-loop` / `driver: sessão (direto)` + lembrete de workers; `--json session.driver`; doctor check 16 informativo) |

**Cobertura:** 7/7 mapeados. Edge cases da spec: gentle-ai → F18 (append, sem conflito — D1 seção 7) · não-Pi sem citação fora da coluna → D6 + teste de ausência · `/loop` sem métrica → "No honest metric? Use /goal" no template Pi · hello world versionado → D4 (tabela de versões com data + resultado do F7).

**Notas de revisão cruzada:** F15/F17 diziam "texto final das regras definido no F17"; a spec do F19 (grupo WORK, mais recente) define o conteúdo aqui — **F19 é o dono do texto**; F15 entrega o mecanismo (marcadores/upsert/BOM/CRLF) e F17 a coluna. Check 16 do doctor alocado após a tabela 7–15 do F18 (renumerar no Execute se necessário). Hello world do F8 (DOCS-01) referencia o ROUTING.md em vez de duplicar (fonte única).
