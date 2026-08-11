# Harness Docs Index

Technical documentation for the Runecraft Harness. Start with
[ROUTING.md](ROUTING.md) for the mental model, then go deeper where needed.

## Get started

- [intended-usage.md](intended-usage.md) — when to use which tool; the
  versioned hello-world SDLC.
- [usage.md](usage.md) — install, verify, operate, coexistence,
  rollback/backups.

## Reference

- [ROUTING.md](ROUTING.md) — routing & mental model: purposes, tool table,
  two-driver rules, per-capability sections, agent roles and coded routing.
- [PARITY.md](PARITY.md) — tier model & parity roadmap: the gap today, the
  native-surface map per agent, and the phased plan.
- [EVENTS.md](EVENTS.md) — typed event store: schema, kinds, boundaries,
  OTel/Langfuse mapping.
- [MEMORY.md](MEMORY.md) — persistent cross-session memory: `rune_*` tools,
  SQLite layout, sinks.
- [PI.md](PI.md) — Pi first-class: persona, rules, model routing & SDD.
- [EVAL-FRAMEWORK.md](EVAL-FRAMEWORK.md) — eval framework: cases, ratchet,
  goldens.

## Guides

- [agents.md](agents.md) — the 7 objective role agents + non-Pi agent
  matrix.
- [components.md](components.md) — forked components + harness layer
  (guards/verification/evals/resilience/observability/memory/routing).
- [CODEBASE-GUIDE.md](CODEBASE-GUIDE.md) — repository map, mental model,
  maintainer playbook, contract locations.
- [testing.md](testing.md) — landing page for evals: suites, ratchets,
  goldens, E2E.
