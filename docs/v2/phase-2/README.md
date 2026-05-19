# Phase 2 — Better Defaults

ctx-sys 2.1+. Picks up where Phase 1 leaves off and improves the day-one experience, document quality, and git-aware behavior — without expanding ctx-sys's core surface.

## Theme

Phase 1 (Focus & Sharpen) trims ctx-sys to its core thesis and ships 2.0. Phase 2 (Better Defaults) keeps that core stable and invests in three areas where the v1 experience is weakest:

- **Getting a working installation** — multi-backend support, one-command bootstrap, consolidated diagnostics.
- **Document quality** — structure-aware PDF extraction so headings, tables, and reading order survive into the index.
- **Index freshness** — post-* git hooks so the index follows the working tree across branch switches, pulls, and rebases.

None of these add an MCP tool. All are improvements to existing functionality.

## Sub-features

| ID | Title | Priority | Breaking? |
| --- | --- | --- | --- |
| F2.0 | [Local model UX](F2.0-local-model-ux.md) | High | No (config migration shim) |
| F2.1 | [PDF extraction](F2.1-pdf-extraction.md) | Medium | No (additive) |
| F2.2 | [Git-aware re-indexing](F2.2-git-aware-reindex.md) | High | No (additive; default-on hooks) |

## Release plan

- F2.0, F2.1, F2.2 are independent — any can ship first.
- F2.0 → 2.1.0 (new feature: `ctx-sys setup`, multi-backend provider abstraction, `ctx-sys doctor`).
- F2.1 → 2.2.0 (or merged into the same minor release if both land together).
- F2.2 → 2.3.0 (closes the "stale index after `git checkout`" failure mode).
- No breaking changes; existing configs migrate cleanly via a deprecation shim documented in F2.0.

## Relationship to Phase 1

Phase 2 depends on Phase 1 being merged and 2.0 shipped. Specifically:

- F2.0 builds on F1.2's lighter default models and assumes the provider abstraction lives where F1.6 (MCP init) and F1.4 (MCP polish) put their config plumbing.
- F2.1 plugs into the document indexing pipeline that survives Phase 1 unchanged.
- F2.2 builds on F1.6's `ctx-sys init` flow — hooks install via the same default-on / opt-out / `--force` pattern as the MCP config writes. Explicitly distinct from the cut F1.0 `hooks` MCP tool (which was pre-commit; F2.2 is post-checkout / post-merge / post-rewrite).

Don't land Phase 2 work on top of unmerged Phase 1. The point of the split is that 2.0 ships clean, then capability expansion follows.
