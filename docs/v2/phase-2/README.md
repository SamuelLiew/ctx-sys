# Phase 2 — Better Defaults

ctx-sys 2.1+. Picks up where Phase 1 leaves off and improves the day-one experience, document quality, and git-aware behavior — without expanding ctx-sys's core surface.

## Theme

Phase 1 (Focus & Sharpen) trims ctx-sys to its core thesis and ships 2.0. Phase 2 (Better Defaults) keeps that core stable and invests in four areas where the v1 experience is weakest:

- **Index freshness** — post-* git hooks so the index follows the working tree across branch switches, pulls, and rebases.
- **User-facing strings** — every user-facing `CtxError` carries a `fix:` hint; bare `throw new Error(...)` paths in the CLI are lifted into the structured error system; every surviving CLI `--help` surface gets usage examples, tightened descriptions, and cross-references between chained commands.
- **Getting a working installation** — multi-backend support, one-command bootstrap, consolidated diagnostics.
- **Document quality** — structure-aware PDF extraction so headings, tables, and reading order survive into the index.

None of these add an MCP tool. All are improvements to existing functionality.

## Sub-features

| ID | Title | Priority | Breaking? |
| --- | --- | --- | --- |
| F2.0 | [Git-aware re-indexing](F2.0-git-aware-reindex.md) | High | No (additive; default-on hooks) |
| F2.1 | [User-facing strings audit](F2.1-user-facing-strings.md) | Medium | No (content-only) |
| F2.2 | [Local model UX](F2.2-local-model-ux.md) | High | No (config migration shim) |
| F2.3 | [PDF extraction](F2.3-pdf-extraction.md) | Medium | No (additive) |

## Release plan

The order above is the recommended landing order, not a strict gate. Within Phase 2 the features are mostly independent, but the ordering minimises rework:

- **F2.0 first.** Closes the largest "feels broken" failure mode in current ctx-sys (silently stale index after `git checkout`). Smallest change for the biggest perceived quality lift. → 2.1.0.
- **F2.1 next.** Cheap audit that newly-introduced F2.0 error paths (`STALE_INDEX_*`, hook-install conflicts) want to participate in, plus a CLI `--help` polish pass across the same surfaces. Lifting bare `throw new Error(...)` calls and adding usage examples to every command also makes the CLI more consistent before F2.2 adds preflight surfaces and `ctx-sys doctor`. → 2.1.x (can ride 2.1.0).
- **F2.2 third.** Provider abstraction + `ctx-sys setup` + `ctx-sys doctor`. Bigger change; benefits from F2.1's typed errors at every new preflight throw site. → 2.2.0.
- **F2.3 last.** PDF extraction depends on F2.2's provider-abstraction shape (Docling runs as an external process and reuses the `healthCheck()` contract). → 2.3.0.

No breaking changes anywhere in Phase 2. Existing configs migrate cleanly via a deprecation shim documented in F2.2.

## Relationship to Phase 1

Phase 2 depends on Phase 1 being merged and 2.0 shipped. Specifically:

- **F2.0** builds on F1.6's `ctx-sys init` flow — git hooks install via the same default-on / opt-out / `--force` pattern as the MCP config writes. Explicitly distinct from the cut F1.0 `hooks` MCP tool (which was pre-commit; F2.0 is post-checkout / post-merge / post-rewrite).
- **F2.1** depends on F1.0 having removed obsolete error codes (`SESSION_NOT_FOUND` and friends) and CLI subcommands (`session`, `hooks`) so the audit isn't chasing dead paths, and on F1.4's `--json` error shape being the canonical serialisation for `CtxError.toMcpResponse()`. Covers both error-hint and CLI `--help` strings in one pass.
- **F2.2** builds on F1.2's lighter default models and assumes the provider config plumbing follows the shape laid down by F1.4 (MCP polish) and F1.6 (MCP init).
- **F2.3** plugs into the document indexing pipeline that survives Phase 1 unchanged.

Don't land Phase 2 work on top of unmerged Phase 1. The point of the split is that 2.0 ships clean, then capability expansion follows.
