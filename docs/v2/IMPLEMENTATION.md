# v2 Implementation Plan

The v2 plan for ctx-sys. v2 is a **scope-reducing release**: it removes features that duplicate other tools in the stack, sharpens defaults, and polishes the MCP surface. ctx-sys becomes a tightly-scoped *local hybrid-RAG over a code knowledge graph* — and pairs cleanly with lean-ctx, caveman, yaao, and Claude Code.

For the v1 plan (historical), see [../v1/IMPLEMENTATION.md](../v1/IMPLEMENTATION.md).

## Theme

v1 grew 12 MCP tools across 12 phases, including a full conversational-memory layer (sessions, messages, checkpoints, reflections, tiered memory) and an SaaS-flavored phase 11–12 (VS Code extension, team KB, auth/SSO, desktop app, licensing). v2 rejects the "more features" trajectory and focuses on the one thing ctx-sys is uniquely good at: indexing a codebase with tree-sitter + embeddings + a relationship graph, and serving precise hybrid retrieval over it.

Everything else — session memory, output compression, agent orchestration — is owned better by sibling tools:

```text
caveman      → compresses model output + CLAUDE.md         (output side)
lean-ctx     → compresses tool I/O: file reads, shell      (input side, generic)
ctx-sys      → semantic + graph retrieval over codebase    (input side, intelligent)
yaao         → multi-agent orchestrator (uses ctx-sys as native retrieval peer)
```

## Phases

| Phase | Focus | Release | Status |
| --- | --- | --- | --- |
| 1 | Focus & Sharpen | 2.0.0 | Planned |
| 2 | Better Defaults | 2.1.0+ | Planned, post-2.0 |

Additional phases will be added here as they're scoped. Each is expected to be small and improvement-flavored, not feature-driven.

---

## Phase 1: Focus & Sharpen (2.0.0)

The 2.0 cut. Reduces ctx-sys's surface area, picks defaults a laptop can actually run, turns the MCP server into a clean composable peer, and ships the result via a proper release pipeline.

| Feature | Description | Doc |
| --- | --- | --- |
| **F1.0** | Prune conversational memory (+ `hooks`) | [phase-1/F1.0-prune-conversational-memory.md](phase-1/F1.0-prune-conversational-memory.md) |
| **F1.1** | Ignore file defaults | [phase-1/F1.1-ignore-file-defaults.md](phase-1/F1.1-ignore-file-defaults.md) |
| **F1.2** | Lighter default models | [phase-1/F1.2-lighter-default-models.md](phase-1/F1.2-lighter-default-models.md) |
| **F1.3** | yaao native integration | [phase-1/F1.3-yaao-native-integration.md](phase-1/F1.3-yaao-native-integration.md) |
| **F1.4** | MCP server polish | [phase-1/F1.4-mcp-server-polish.md](phase-1/F1.4-mcp-server-polish.md) |
| **F1.5** | Cut the heuristic reranker | [phase-1/F1.5-cut-heuristic-reranker.md](phase-1/F1.5-cut-heuristic-reranker.md) |
| **F1.6** | MCP init integration | [phase-1/F1.6-mcp-init.md](phase-1/F1.6-mcp-init.md) |
| **F1.7** | npm publish (ships last) | [phase-1/F1.7-npm-publish.md](phase-1/F1.7-npm-publish.md) |

**Key deliverables:**

- 12 → 5 MCP tools. `session`, `message`, `decision`, `checkpoint`, `reflection`, `memory`, `hooks` removed. Schema migration exports v1 data to `.ctx-sys/migration-export-v1.jsonl`.
- ADRs are markdown documents indexed by the existing document indexer — no special node type.
- `ctx-sys init` writes a seeded `.ctxignore` (with `.yaao/`, `.lean-ctx/`, build outputs, lockfiles, secrets). `.gitignore` is no longer read by default.
- `gemma3:270m` is the default for both HyDE and summarization (was `gemma3:12b` + `qwen3:0.6b`). Both features remain opt-in.
- `ctx-sys serve --socket <path>` formalized as a stable contract for yaao spawn.
- yaao's `directive.ts` shipped in lockstep with the F1.0 cut to drop session/memory language; yaao's pre-commit `hooks.ts` integration is also removed lockstep.
- Stdio hygiene: CI enforces nothing but JSON-RPC on stdout from `ctx-sys serve`.
- `--json` flag on all read-only commands with published JSON Schemas under `schema/`.
- MCP resources for entities: `ctx-sys://entity/<id>` lets agents read by URI without a tool roundtrip.
- `ctx-sys status --json` is the canonical workspace snapshot, with a stable schema yaao can consume.
- Heuristic reranker removed. RRF over vector + FTS + graph is the final ranking; LLM reranker remains for opt-in high-quality paths. Score `[0, 1]` normalization extracted as a standalone helper and preserved.
- `ctx-sys init` auto-registers the MCP server in `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, and `.github/copilot-instructions.md` (default on, opt out with `--no-mcp`, `--force` replaces a mismatched entry). Mirrors yaao's F14.2 semantics so both tools behave identically. No standalone `ctx-sys mcp` subcommand — re-running `ctx-sys init --mcp` is the canonical way to wire or re-wire MCP.
- A repeatable release pipeline ships 2.0 via `npm publish --provenance` from a GitHub Actions workflow on tag push, with a beta period and a maintainer `RELEASING.md` checklist. F1.7 is the last feature merged; it's how 2.0 actually ships.

**Out of scope for Phase 1:**

- Worktree-parent resolver (handled by `.ctxignore` + shared-process-at-root design).
- yaao journal ingestion (ctx-sys is current-state-of-code, yaao owns run history).
- Bundled `ctx-query` skill (sharp MCP tool descriptions are sufficient).
- MCP prompts (agents can compose their own).
- Multi-backend support and the `setup` / `doctor` flow — moved to Phase 2.
- Structured PDF extraction — moved to Phase 2.
- Anything from v1 Phase 11 / Phase 12 (VS Code extension, SaaS, telemetry, auth).

---

## Phase 2: Better Defaults (2.1.0+)

Capability expansion on top of the stable 2.0 core. Improves the day-one experience and document quality without growing ctx-sys's MCP surface.

| Feature | Description | Doc |
| --- | --- | --- |
| **F2.0** | Local model UX | [phase-2/F2.0-local-model-ux.md](phase-2/F2.0-local-model-ux.md) |
| **F2.1** | PDF extraction | [phase-2/F2.1-pdf-extraction.md](phase-2/F2.1-pdf-extraction.md) |

**Key deliverables:**

- `ctx-sys setup` is a one-command bootstrap (backend detection, install, model pulls, sanity check).
- Multi-backend provider abstraction supports Ollama, OpenAI-compatible (vLLM / LM Studio / llamafile / LiteLLM), OpenAI, and llama.cpp.
- `ctx-sys doctor` is the canonical diagnostic command for "is my setup right?"
- PDF extraction is pluggable with three tiers (pdf-parse → pdfjs → Docling); structured markdown preserves headings, tables, lists, and reading order on multi-column documents.
- No new MCP tools. No breaking changes. F2.0 ships a config-migration shim for existing setups.

---

## What v2 is not doing

For clarity, here's what v2 explicitly drops or defers from v1's roadmap:

- **Phase 11 (Integration & Team)** — VS Code extension, automatic context injection, team knowledge base. The VS Code extension is a separate product; team KB is a SaaS feature; automatic context injection is what MCP already provides.
- **Phase 12 (Commercial & Enterprise)** — Auth/SSO, desktop app, licensing/billing, telemetry. All require a hosted backend that doesn't fit the local-first thesis.
- **All six conversational-memory tools + `hooks`** — Cut in F1.0. `hooks` was a low-traffic git-integration tool whose value is now better served by on-demand `context_query`. yaao's pre-commit integration that depended on it is removed lockstep (see F1.3).

The `kb` packaging feature stays — it's working and useful for sharing indexed corpora.

These exclusions can be reconsidered in later v2 phases if real users ask. The default answer is "no."
