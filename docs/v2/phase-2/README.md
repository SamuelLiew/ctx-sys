# Phase 2 — Better Defaults

ctx-sys 2.1+. Picks up where Phase 1 leaves off and improves the day-one experience and document quality without expanding ctx-sys's core surface.

## Theme

Phase 1 (Focus & Sharpen) trims ctx-sys to its core thesis and ships 2.0. Phase 2 (Better Defaults) keeps that core stable and invests in the two areas where the v1 onboarding is weakest:

- **Getting a working installation** — multi-backend support, one-command bootstrap, consolidated diagnostics.
- **Document quality** — structure-aware PDF extraction so headings, tables, and reading order survive into the index.

Neither feature adds an MCP tool. Both are improvements to existing functionality.

## Sub-features

| ID | Title | Priority | Breaking? |
| --- | --- | --- | --- |
| F2.0 | [Local model UX](F2.0-local-model-ux.md) | High | No (config migration shim) |
| F2.1 | [PDF extraction](F2.1-pdf-extraction.md) | Medium | No (additive) |

## Release plan

- F2.0 and F2.1 are independent — either can ship first.
- F2.0 → 2.1.0 (new feature: `ctx-sys setup`, multi-backend provider abstraction, `ctx-sys doctor`).
- F2.1 → 2.2.0 (or merged into the same minor release if both land together).
- No breaking changes; existing configs migrate cleanly via a deprecation shim documented in F2.0.

## Relationship to Phase 1

Phase 2 depends on Phase 1 being merged and 2.0 shipped. Specifically:

- F2.0 builds on F1.2's lighter default models and assumes the provider abstraction lives where F1.6 (MCP init) and F1.4 (MCP polish) put their config plumbing.
- F2.1 plugs into the document indexing pipeline that survives Phase 1 unchanged.

Don't land Phase 2 work on top of unmerged Phase 1. The point of the split is that 2.0 ships clean, then capability expansion follows.
