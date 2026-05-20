# Phase 3 — Release Engineering

ctx-sys 2.0.0 ships. This phase is the release pipeline itself: repo hygiene, CHANGELOG discipline, a tagged GitHub Actions workflow, dist-tags, provenance, and a beta period. It's the smallest phase by code volume and the largest by "this is how 2.0 actually reaches users."

## Theme

Phase 1 (Focus & Sharpen) lands all the code changes for 2.0. Phase 2 (Better Defaults) layers capability on top, but does not block 2.0. Phase 3 (Release Engineering) is the cut event — once Phase 1 is merged and stable, Phase 3 ships it.

Splitting "build the release machinery" out of Phase 1 keeps that phase scoped to behavior changes, and gives the release pipeline room to evolve independently of any single release. The pipeline this phase puts in place is what every subsequent ctx-sys version ships through.

## Sub-features

| ID | Title | Priority | Breaking? |
| --- | --- | --- | --- |
| F3.0 | [npm publish](F3.0-npm-publish.md) | High | No (release engineering, not a behavior change) |

## Release plan

- Phase 3 cannot start until all of F1.0–F1.6 are merged. The pipeline F3.0 builds is the thing that ships them.
- Beta cuts under dist-tag `next` are fine as Phase 1 work converges (e.g., once F1.0 + F1.4 are merged, a `2.0.0-beta.1` is reasonable for migration testing). The `2.0.0` tag waits for the full Phase 1 set.
- Phase 2 work is not blocking. F2.0/F2.1/F2.2 ship in their own minor releases through the pipeline this phase puts in place.

## Relationship to other phases

- **Depends on Phase 1.** F1.0 (the schema-breaking prune) is what makes 2.0 a major bump in the first place. F1.4 (MCP polish) is the contract surface the beta period exercises. F1.6 (init --mcp) changes the day-one flow and needs beta exposure before going to `latest`.
- **Does not depend on Phase 2.** Multi-backend / PDF / git-aware reindex are 2.1+ features and ship as minor releases later.
- **Sets the pattern for all future releases.** The workflow, CHANGELOG discipline, dist-tag strategy, and provenance setup F3.0 introduces become the standard for every ctx-sys release going forward.
