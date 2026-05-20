# Phase 1 — Focus & Sharpen

ctx-sys 2.0. First phase of the v2 plan. Cut the conversational-memory layer, sharpen defaults, make the yaao integration purpose-built, and polish the MCP surface.

## Theme

ctx-sys is strongest as a **local hybrid-RAG over a code knowledge graph**. Everything else is either a different product (session memory, output compression) or duplicates what siblings in the stack (lean-ctx, caveman, Claude Code, yaao) already do.

Phase 1 (v2) trims ctx-sys to that core, picks defaults a first-time user can actually run on a laptop, and turns ctx-sys into a clean MCP citizen the rest of the stack can compose with.

## Sub-features

| ID | Title | Priority | Breaking? |
| --- | --- | --- | --- |
| F1.0 | [Prune conversational memory (+ `hooks`)](F1.0-prune-conversational-memory.md) | High | Yes — 2.0.0 |
| F1.1 | [Ignore file defaults](F1.1-ignore-file-defaults.md) | High | Behavioral |
| F1.2 | [Lighter default models](F1.2-lighter-default-models.md) | Medium | No (config only) |
| F1.3 | [yaao native integration](F1.3-yaao-native-integration.md) | Medium | No |
| F1.4 | [MCP server polish](F1.4-mcp-server-polish.md) | High | No |
| F1.5 | [Cut the heuristic reranker](F1.5-cut-heuristic-reranker.md) | Medium | Quality-affecting |
| F1.6 | [MCP init integration](F1.6-mcp-init.md) | Medium | Behavioral |

F1.0 drops 7 of the 12 MCP tools (6 conversation + `hooks`). ADRs move to plain markdown — ctx-sys's document indexer already handles them. No reframed `decision` node; no special pipeline. F1.5 cuts the hand-tuned reranker that fights RRF, keeping just the `[0, 1]` normalization. F1.6 makes `ctx-sys init` register the MCP server in `.mcp.json` by default.

The actual `npm publish` of 2.0.0 lives in [Phase 3](../phase-3/) (F3.0). Phase 1 is the *code* cut; Phase 3 is the *ship* cut. They were one phase in earlier drafts but separating them keeps Phase 1 scoped to behavior changes and lets the release pipeline evolve independently.

Local-model UX (`ctx-sys setup`, multi-backend support, `ctx-sys doctor`) and structure-aware PDF extraction were originally scoped here but moved to [Phase 2](../phase-2/) — they're capability expansion, not "Focus & Sharpen," and shouldn't block the 2.0 cut.

## Stack positioning (post-Phase-1)

```text
caveman      → compresses model output + CLAUDE.md         (output side)
lean-ctx     → compresses tool I/O: file reads, shell      (input side, generic)
ctx-sys      → semantic + graph retrieval over codebase    (input side, intelligent)
yaao         → multi-agent orchestrator (uses ctx-sys as native retrieval peer)
```

Each layer owns one job. After F1.0 the overlap between ctx-sys and lean-ctx's CCP memory disappears; after F1.3 + F1.4 yaao + ctx-sys is a first-class pairing rather than a generic MCP coexistence.

## Release plan

- Land F1.1, F1.2, F1.6 first — low-risk, unblock new-user onboarding. F1.6 in particular changes the day-one experience.
- Land F1.5 (heuristic reranker cut) next — small, contained, improves the retrieval pipeline.
- Land F1.0 + F1.3 + F1.4 together as the meat of 2.0. Lockstep with a yaao point release that verifies the directive stays retrieval-only (F1.3 §2) and removes the dead `hooks.ts` integration (F1.3 §3).
- Once all of F1.0–F1.6 are merged, [Phase 3](../phase-3/) (F3.0) cuts the `2.0.0` tag. Beta cuts under dist-tag `next` (e.g., `2.0.0-beta.1` after F1.0 + F1.4 land) are part of Phase 3's beta window, not Phase 1's.

## Relationship to v1

The previous 12-phase plan lives at [../../v1/](../../v1/) as historical record. v2 supersedes it; do not edit v1 docs.
