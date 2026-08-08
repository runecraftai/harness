<p align="center">
  <img src="https://img.shields.io/badge/Skill-spec--driven-blue?style=for-the-badge" alt="skill badge" />
  <img src="https://img.shields.io/badge/Stack-Agnostic-green?style=for-the-badge" alt="stack agnostic" />
  <img src="https://img.shields.io/badge/Version-5.0.0-purple?style=for-the-badge" alt="version" />
</p>

<h1 align="center">🎯 spec-driven</h1>

<p align="center">
  <strong>Spec-driven planning with 4 adaptive phases and an independent Verifier.<br/>Tests derive from spec. One atomic commit per task. Lessons improve over time.</strong>
</p>

---

## ✨ What Is This Skill?

**spec-driven** is a feature planning skill that turns a description into traceable requirements, an atomic task breakdown, a verifiable implementation, and a self-improving lessons log. It auto-sizes depth by complexity — using inline execution for small changes and a full phase workflow for large or ambiguous features.

```
SPECIFY → (DESIGN) → (TASKS) → EXECUTE → VERIFY → LEARN
```

| Scope | Effort | What happens |
|-------|--------|--------------|
| **Small** | ≤3 files, one sentence | One-liner spec inline, implement + verify inline |
| **Medium** | Clear feature, <10 tasks | Brief spec, design and tasks implicit in Execute |
| **Large** | Multi-component | Full spec with requirement IDs, architecture, task breakdown |
| **Complex** | Ambiguity, new domain | Full spec, gray-area discussion, research-backed design, interactive UAT |

> **The complexity is in the system, not in your workflow.** Trigger naturally — the skill decides how deep to go.

---

## 🚀 Quick Start

### Installation

```bash
# npm
npm install @runecraft/spells

# bun
bun add @runecraft/spells

# pnpm
pnpm add @runecraft/spells

# yarn
yarn add @runecraft/spells
```

Copy to your agent:
```bash
cp -r node_modules/@runecraft/spells/skills/spec-driven ~/.config/opencode/skills/spec-driven
```

### First Commands

| What You Want | Say This |
|---------------|----------|
| Specify a feature | `/spec` or `specify feature` or `vamos especificar` |
| Discuss gray areas | `discuss feature` or `discutir este caso` |
| Design the approach | `design` or `design da feature` |
| Break into tasks | `plan this` or `quebrar em tarefas` |
| Implement | `/build` or `implement` or `implementar` |
| Validate / verify | `validate`, `verify work`, `UAT`, `validar implementação` |
| Pause session | `/spec pause` or `pausar trabalho` |
| Resume session | `/spec resume` or `retomar trabalho` |

**🇵🇹 🇬🇧 PT/EN — both languages are first-class triggers; the skill body is English.**

---

## 📁 Project Structure

The skill creates and maintains a `.specs/` directory:

```
.specs/
├── STATE.md                 # Project memory: Decisions log (AD-NNN) + Handoff snapshot
├── LESSONS.md               # Self-improving lessons playbook (rendered, do not hand-edit)
├── lessons.json             # Canonical lessons state (machine-owned)
└── features/
    └── <name>/              # One per feature
        ├── spec.md          # Requirements with traceable IDs
        ├── context.md       # User decisions for gray areas (Complex scope)
        ├── design.md        # Architecture & components (Large/Complex)
        ├── tasks.md         # Atomic tasks with verification
        └── validation.md    # Verifier report: PASS/FAIL, evidence, sensor result
```

---

## 🔄 The Four Phases

#### SPECIFY — Requirements & Traceability
**Goal:** Capture what to build with testable, traceable requirements.  
**Triggers:** `/spec`, `specify feature`, `vamos especificar`  
**Skipped when:** Never — always required.  
**Output:** `spec.md` with `[FEAT-NN]` requirement IDs.

#### DESIGN — Architecture & Components
**Goal:** Define the technical approach, code reuse analysis, and component boundaries.  
**Triggers:** `design`, `design da feature`  
**Skipped when:** Small/Medium scope (no architectural decisions).  
**Output:** `design.md` with architecture overview, components, data models, decisions.

#### TASKS — Atomic Breakdown
**Goal:** Decompose the spec into atomic, independently verifiable, sequentially ordered tasks.  
**Triggers:** `break into tasks`, `quebrar em tarefas`  
**Skipped when:** ≤3 obvious steps (implicit in Execute).  
**Output:** `tasks.md` with What, Where, Requirement IDs, and Done-when criteria.

#### EXECUTE — Implement + Verify
**Goal:** Implement each task sequentially with one atomic commit per task.  
**Triggers:** `/build`, `implement`, `implementar`  
**Skipped when:** Never — always required.  
**Output:** Code changes, task checkmarks, atomic commits, `validation.md` from the Verifier.

---

## 🛡️ The Verifier

After the last task is committed, a **fresh Verifier sub-agent** runs automatically — never optional, never prompted. The author is not the verifier: the Verifier re-derives coverage independently.

The Verifier:

1. **Spec-anchored outcome check** — confirms each test's asserted value matches the spec-defined expected outcome. Flags spec-precision gaps.
2. **Discrimination sensor** — injects behavior-level faults in scratch state, confirms tests kill them. Surviving mutants become fix tasks.
3. **Writes `validation.md`** — PASS/FAIL, per-AC evidence, sensor result, diff range.
4. **Returns a compact verdict** + ranked gap list to the orchestrator.
5. **Distills lessons** — turns each grounded failure into a reusable project-local lesson via `scripts/lessons.py`. A clean PASS records nothing.

The fix→re-verify loop is bounded to 3 iterations before escalating.

---

## 📚 Lessons

The lessons layer turns verification failures into project-local guidance:

```bash
# Load confirmed lessons at Specify / Design
python3 scripts/lessons.py list --status confirmed

# Record a new lesson
python3 scripts/lessons.py add --rule "..." --rationale "..." --source feature-x
```

`LESSONS.md` is rendered from `lessons.json` — do not hand-edit. Confirmed lessons only are loaded into planning context; candidates are kept isolated to avoid noise.

---

## 🎯 Complete Trigger Reference

### English Triggers

| Phase | Triggers |
|-------|----------|
| **SPECIFY** | `/spec`, `specify feature`, `write spec`, `what should we build` |
| **DISCUSS** | `discuss feature`, `capture context`, `how should this work` |
| **DESIGN** | `design`, `design the feature` |
| **TASKS** | `break into tasks`, `create tasks` |
| **EXECUTE** | `/build`, `implement`, `execute tasks` |
| **VALIDATE** | `validate`, `verify work`, `UAT`, `walk me through it` |
| **MEMORY** | `record decision`, `pause work`, `resume work` |
| **LESSONS** | `load lessons`, `record lesson`, `distill lessons` |

### Portuguese Triggers

| Fase | Triggers |
|------|----------|
| **SPECIFY** | `vamos especificar`, `preciso de um spec`, `especificar feature` |
| **DISCUSS** | `discutir feature`, `discutir este caso` |
| **DESIGN** | `design da feature`, `arquitetura` |
| **TASKS** | `quebrar em tarefas`, `criar tarefas` |
| **EXECUTE** | `implementar`, `build`, `construir` |
| **VALIDATE** | `validar implementação`, `verificar`, `testar comigo` |
| **MEMORY** | `pausar trabalho`, `retomar trabalho`, `salvar decisão` |
| **LESSONS** | `carregar lições`, `registrar lição` |

### Special Triggers

| Trigger | Action |
|---------|--------|
| `/spec pause` or `pausar trabalho` | Save handoff snapshot, update STATE.md |
| `/spec resume` or `retomar trabalho` | Load handoff, re-confirm Decisions, propose next step |

---

## 🔁 Workflow Examples

### Greenfield Feature

```
/spec payment-flow → /build → Verifier (auto) → done
```

Full pipeline: write spec with traceable IDs, design the architecture, break into atomic tasks, implement, independent Verifier.

### Brownfield Fix

```
specify: fix dark mode persistence → inline execute → Verifier (auto) → done
```

Small scope: one-liner spec, inline implementation, automatic verification.

### Session Continuity

```
Session 1: /spec → /build (partial) → /spec pause
Session 2: /spec resume → continue /build → Verifier (auto) → done
```

Pause at any point, resume exactly where you left off via STATE.md Handoff.

---

## 🧠 Context Management

The skill manages a **40k context token budget** for planning, with 160k+ reserved for work, reasoning, and outputs:

| Tier | Documents | When loaded |
|------|-----------|-------------|
| **Always-on-demand** | `.specs/STATE.md` (Decisions at Design, Handoff on resume) | Per phase |
| **Confirmed lessons** | `python3 scripts/lessons.py list --status confirmed` | Specify, Design |
| **Feature context** | `spec.md`, `context.md`, `design.md`, `tasks.md` | Per feature |
| **Never simultaneous** | Multiple feature specs, multiple architecture docs | — |

If context exceeds 40k, display status and apply the [context-limits](references/context-limits.md) strategy.

---

## 🔗 Skill Integrations

| Skill | When activated | Behavior |
|-------|---------------|----------|
| **mermaid-studio** | During DESIGN, for architecture diagrams | Delegates diagram generation |
| **codenavi** | During SPECIFY/DESIGN | Deep codebase navigation for context |

Detected automatically. Gracefully falls back if not installed.

---

## 📚 Reference Files

12 supporting files, loaded on-demand within the 40k budget:

### Phase files
| File | Purpose |
|------|---------|
| `specify.md` | Spec writing discipline, requirement IDs, traceability |
| `discuss.md` | Gray-area discussion, user-decision capture |
| `design.md` | Architecture, code reuse analysis, components |
| `tasks.md` | Atomic task breakdown, dependencies, verification |
| `implement.md` | Build cycle, atomic commit policy, gate enforcement |
| `validate.md` | Verifier behavior, spec-anchored check, discrimination sensor |

### Memory & patterns
| File | Purpose |
|------|---------|
| `memory.md` | STATE.md (Decisions log + Handoff), pause/resume |
| `lessons.md` | Lessons layer, machine-owned state, distillation rules |
| `sub-agents.md` | Sub-agent delegation contracts, Verifier payload |
| `code-analysis.md` | Code search & structural analysis tools |
| `coding-principles.md` | Coding standards enforced during BUILD |
| `context-limits.md` | Token budget strategy, what to drop under pressure |

### Script
| File | Purpose |
|------|---------|
| `scripts/lessons.py` | Lessons CLI — list, add, confirm, render LESSONS.md |

---

## ⚡ Tips for Best Results

### Do's ✅
- Trigger naturally in PT or EN — the skill understands both
- Trust the auto-sizing — the skill decides phase depth from scope
- Read reference files completely (to EOF) before acting on them
- Say `/spec pause` before ending a session
- Let the Verifier run — never skip it, never self-validate

### Don'ts ❌
- Don't weaken, skip, or delete tests to make them pass
- Don't batch multiple tasks into a single commit
- Don't load multiple feature specs simultaneously
- Don't fabricate APIs or patterns — follow the Knowledge Verification Chain
- Don't accept "tests pass" without checking the test asserts spec outcomes, not implementation details

---

## 🤖 Compatibility

Tested and verified on:

| Agent | Status | Notes |
|-------|--------|-------|
| **Claude Code** | ✅ Fully supported | Primary reference agent |
| **Cursor** | ✅ Fully supported | Excellent for inline editing |
| **Opencode** | ✅ Fully supported | Multi-agent routing works natively |
| **GitHub Copilot** | ✅ Fully supported | Via custom instructions |

Works with any agent supporting custom instructions and tool use.

---

## ❓ FAQ

**Q: Why is the Verifier separate from the executor?**  
A: Author ≠ verifier prevents the executor's mental model from biasing the validation. The Verifier re-derives coverage independently using evidence-or-zero: each AC either has test evidence or counts as a gap.

**Q: What if a test passes but doesn't actually test the spec outcome?**  
A: The spec-anchored outcome check flags this as a spec-precision gap. The test asserts implementation details instead of the spec-defined behavior; the test must be rewritten.

**Q: What is the discrimination sensor?**  
A: A mutation-testing pass. The Verifier injects behavior-level faults in scratch state and confirms the test suite kills them. Surviving mutants mean tests are too weak; those mutants become fix tasks.

**Q: How do lessons work?**  
A: Each grounded failure (surviving mutant, spec-precision gap, failed AC) becomes a lesson via `scripts/lessons.py`. Confirmed lessons load into Specify and Design context. A clean PASS records nothing — the skill stays quiet when nothing went wrong.

**Q: Why did the auto-sizing skip TASKS for my Medium feature?**  
A: When there are ≤3 obvious steps, tasks become implicit in Execute. The safety valve: Execute ALWAYS lists atomic steps inline first. If the list reveals >5 steps or complex dependencies, STOP and create a formal `tasks.md`.

**Q: Can I use this for small bug fixes?**  
A: Yes — that's the Small scope (≤3 files, one sentence). One-liner spec inline, implement, verify. No ceremony.

**Q: What if I close my session mid-task?**  
A: Say `/spec pause` before ending. The Handoff snapshot in STATE.md captures the in-flight state; `/spec resume` next session continues from there.

**Q: PT or EN?**  
A: Both. All triggers work in Portuguese and English as first-class citizens. The skill body is English.

**Q: Does this work with any tech stack?**  
A: Yes. Stack-agnostic. Works with any language, framework, or architecture.

**Q: Will the agent fabricate APIs or patterns?**  
A: No. The Knowledge Verification Chain enforces: codebase → project docs → Context7 MCP → web search → flag as uncertain. It never guesses silently.

---

## 📄 License

MIT

---

<p align="center">
  <sub>Part of the <a href="https://github.com/runecraft-dev/arcanum">Arcanum</a> ecosystem</sub>
</p>
