# @runecraft/pr-review

Part of [Runecraft Companion](../../README.md), the multi-agent harness for the [Pi coding agent](https://pi.dev).

Inside the harness, `@runecraft/pr-review` provides parallel, tiered code review of GitHub pull requests: five focused passes (correctness, contracts, security, performance, hygiene) run in parallel with models you choose, findings are validated before reporting, and a structured review with severity and verdict is rendered (`/pr-review <n>`).

## Install

Installed automatically as part of `@runecraft/companion`. Standalone:

    pi install npm:@runecraft/pr-review

## Docs

- Full guide, quickstart & agent matrix: [root README](../../README.md)
- Mental model / when to use this vs the other tools: [ROUTING.md](../harness/docs/ROUTING.md)

## Relationship to upstream

Fork of `pi-pr-review` (10ego, MIT), pinned at v1.11.4 (SHA `dbb4ad7d7d993e737da26543240d787405683cf8`). Notable divergence: hardcoded upstream references (`pi-pr-review` / 10ego) were fixed in the verify-package-contents step so the packaged artifact validates under the `@runecraft/*` identity.
