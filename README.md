# ctx-sys

**Local hybrid RAG over a code knowledge graph.** Index your codebase with tree-sitter AST + embeddings + a relationship graph, and retrieve precise context for any AI coding assistant via MCP. Local-first, code-aware, focused on one thing it does well.

```bash
npm install -g ctx-sys
```

## Status

**ctx-sys 1.x is the current published version.** Install from npm, point your AI assistant at it via MCP, get hybrid retrieval today.

**v2 is in progress.** **Phases 1 and 2 are first-pass-merged on `main`**:

- **Phase 1 (code-complete)** — F1.0 (prune conversational memory + hooks; V1 DB detection), F1.1 (.ctxignore defaults), F1.2 (lighter default models), F1.3 (`ctx-sys serve --socket` + ready signal for yaao integration), F1.4 (stdio hygiene + `status --json` schema), F1.5 (heuristic reranker cut), F1.6 (`ctx-sys init` auto-registers MCP in four targets).
- **Phase 2 (code-complete)** — F2.0 (post-checkout/merge/rewrite/applypatch hooks + `ctx-sys index --git-sync` with worktree gate), F2.1 (every `CtxError` carries a `fix:` + CLI `addHelpText` examples on the top-level commands + no bare `throw new Error(` in `src/cli/`), F2.2 (top-level `ctx-sys doctor` with native-module checks for better-sqlite3 / sqlite-vec / Node version, `ctx-sys setup` one-command bootstrap, multi-backend provider abstraction with `openai-compatible` covering vLLM / LM Studio / llamafile / LiteLLM / llama.cpp, preflight + first-call loading indicator, sqlite-vec pinned to stable `^0.1.9`), F2.3 (Tier 1 + Tier 2 pdfjs extractor with heading detection + content-addressed cache wired into the document indexer). Tier 3 Docling integration is the one remaining deferral — it plugs in behind the existing `PdfExtractor` interface as additive work whenever a user reports needing it.
- **Phase 3 (planned)** — the npm release pipeline that actually ships 2.0.0.

The [v2 implementation plan](docs/v2/IMPLEMENTATION.md) is the working spec with per-phase detail under [docs/v2/phase-1](docs/v2/phase-1/), [docs/v2/phase-2](docs/v2/phase-2/), and [docs/v2/phase-3](docs/v2/phase-3/).

Where this README mentions a v2 change, it's flagged inline.

## Why ctx-sys?

AI coding assistants are limited by context windows. They can't see your whole codebase and they miss connections between files. ctx-sys acts as a *smart librarian* — it indexes your code, understands relationships between symbols, and retrieves exactly the right context via MCP.

- **Hybrid RAG** — combines vector search, keyword/FTS5, and graph traversal with reciprocal rank fusion.
- **Local-first** — your code never leaves your machine. Ollama handles embeddings and (optional) summarization.
- **Code-aware** — tree-sitter AST parsing extracts functions, classes, imports, and relationships across TypeScript/JavaScript, Python, Go, Rust, Java, C/C++, and C#.
- **MCP-native** — works with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.

## Quick Start (5 minutes)

### 1. Install

```bash
npm install -g ctx-sys

# Install and start Ollama (for embeddings)
# macOS: brew install ollama
# Linux: curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull mxbai-embed-large:latest
```

> **v2 (merged on `main`; ships in 2.0):** `ctx-sys setup` detects available backends (Ollama, OpenAI-compatible servers, llamafile), optionally installs Ollama on macOS / Linux when missing, pulls required models with progress, writes a starter config, and runs the F2.2 doctor to confirm. See [F2.2](docs/v2/phase-2/F2.2-local-model-ux.md). Flags: `--yes` (non-interactive), `--install` / `--no-install`, `--backend ollama|openai-compatible|openai`, `--no-models`, `--json`.

### 2. Index your project

```bash
cd your-project
ctx-sys init
ctx-sys index
```

This parses your code with tree-sitter, generates embeddings with Ollama, and indexes markdown docs — all in one command.

### 3. Search

```bash
ctx-sys search "how does authentication work"     # hybrid search (semantic + keyword)
ctx-sys context "error handling in the API layer" # assembled context with expansion
ctx-sys search "database connection pooling" --hyde
```

### 4. Connect to your AI assistant

Add ctx-sys as an MCP server. For **Claude Desktop** (in `~/Library/Application Support/Claude/claude_desktop_config.json`) or **Claude Code** (in your MCP settings):

```json
{
  "mcpServers": {
    "ctx-sys": {
      "command": "ctx-sys",
      "args": ["serve"]
    }
  }
}
```

Your AI assistant now has tools for hybrid retrieval, entity inspection, and graph traversal across your codebase.

> **v2 (merged on `main`; ships in 2.0):** `ctx-sys init` auto-registers the MCP server in `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, and `.github/copilot-instructions.md` (default on, opt out with `--no-mcp`, `--mcp-name X` for side-by-side indexes). See [F1.6](docs/v2/phase-1/F1.6-mcp-init.md). On the published 1.x, you wire it up manually as above; building from source gets you the auto-register flow today.

## How It Works

```text
Your Code                  ctx-sys                         AI Assistant
─────────                  ───────                         ────────────
  .ts .py .rs    ──→   AST Parse (tree-sitter)
  .md .html      ──→   Document Chunking
                        ↓
                   Entity Extraction
                   (functions, classes, imports)
                        ↓
                   Embed with Ollama              ←──  "How does auth work?"
                   (mxbai-embed-large)                        ↓
                        ↓                              context_query
                   ┌─────────────┐                          ↓
                   │  SQLite DB  │               ┌─────────────────────┐
                   │  + FTS5     │──────────────→│  Hybrid Search      │
                   │  + vec0     │               │  • Vector similarity│
                   │  + Graph    │               │  • FTS5 keyword     │
                   └─────────────┘               │  • Graph traversal  │
                                                 └─────────┬───────────┘
                                                           ↓
                                                    Rank & Assemble
                                                           ↓
                                                  Relevant context with
                                                  source attribution
```

## CLI Reference

### Core commands

```bash
ctx-sys init [directory]          # Initialize project config
ctx-sys index [directory]         # Index code + docs + embeddings
ctx-sys search <query>            # Hybrid search (semantic + keyword)
ctx-sys context <query>           # Assembled context with expansion
ctx-sys status [directory]        # Project info and health checks
ctx-sys serve                     # Start MCP server
ctx-sys watch [directory]         # Watch files and auto-reindex
```

v2 adds another top-level command (already on `main`, ships in 2.0):

```bash
ctx-sys doctor                    # v2 F2.2: provider + native-module + Node version checks (PASS/WARN/FAIL)
```

### Key flags

```bash
# Index
ctx-sys index --no-doc            # Skip document indexing (alias for --content code)
ctx-sys index --content docs      # v2: documentation only (skip code indexing)
ctx-sys index --content code      # v2: code only
ctx-sys index --git-sync          # v2: diff-driven re-sync since last indexed commit (also runs from git hooks)
ctx-sys index --no-embed          # Skip embedding generation
ctx-sys index --force             # Re-index everything from scratch

# Search
ctx-sys search "query" --hyde     # HyDE-enhanced conceptual search
ctx-sys search "query" --limit 20
ctx-sys search "query" --no-semantic  # Keyword-only

# Context
ctx-sys context "query" --max-tokens 8000
ctx-sys context "query" --no-expand
ctx-sys context "query" --hyde

# Status
ctx-sys status --check            # Full health diagnostics
```

> **v2 (merged on `main`; ships in 2.0):** `ctx-sys doctor` is now a top-level command with provider preflight, config validation, native-module checks (better-sqlite3 + sqlite-vec PASS/WARN + Node version), and PASS / WARN / FAIL output. The `ctx-sys setup` interactive bootstrap and the full multi-backend provider abstraction (Ollama / OpenAI-compatible / OpenAI / llama.cpp) are still in scope for F2.2 but deferred to a follow-up commit before 2.0 ships. See [F2.2](docs/v2/phase-2/F2.2-local-model-ux.md).

### Subcommands (stable across versions)

```bash
# Entity management
ctx-sys entity list               # List indexed entities
ctx-sys entity stats              # Type breakdown
ctx-sys entity get <id>           # Entity details

# Relationship graph
ctx-sys graph query <entity>      # Traverse relationships
ctx-sys graph stats               # Graph statistics

# Embeddings
ctx-sys embed run                 # Generate/update embeddings
ctx-sys embed status              # Coverage report

# Summarization
ctx-sys summarize run             # Generate LLM summaries
ctx-sys summarize status          # Coverage report

# Configuration
ctx-sys config get <key>          # Read a config value
ctx-sys config set <key> <value>  # Set a config value
ctx-sys config list               # Show resolved configuration

# Knowledge bases
ctx-sys kb create <name>          # Package as shareable .ctx-kb
ctx-sys kb install <file>         # Install a knowledge base

# Team instructions (project-scoped guidance entities)
ctx-sys instruction add <name>    # Add an instruction
ctx-sys instruction list          # List instructions

# Debug
ctx-sys debug health              # System health check
ctx-sys debug inspect             # Database tables
ctx-sys debug export <file>       # Export project data
```

### Subcommands removed in v2

```bash
# v1 only — removed in v2 (F1.0)
ctx-sys session list              # Conversation sessions
ctx-sys session messages [id]     # View session messages
ctx-sys hooks install             # Pre-commit impact_report
```

If you rely on these today, see the [v2 upgrade notes](docs/v2/phase-1/F1.0-prune-conversational-memory.md). **There is no automatic data migration:** to upgrade from 1.x to 2.0, delete `.ctx-sys/` and run `ctx-sys index` to rebuild a clean 2.x index. If you want to keep historical session / decision / checkpoint data, export it from 1.x *before* upgrading and store it elsewhere (lean-ctx, mem0, or a flat markdown log).

## MCP Tools

ctx-sys 1.x exposes 12 action-based MCP tools. **v2 reduces this to 5** — the conversational-memory layer (sessions / messages / decisions / checkpoints / reflections / memory) and the pre-commit `hooks` tool are cut so ctx-sys can focus on hybrid retrieval. Sibling tools (lean-ctx, mem0, Claude Code's native memory) own the session-memory job better.

### Stable surface (today and in v2)

| Tool | Actions | What it does |
| ---- | ------- | ------------ |
| **context_query** | *(standalone)* | Hybrid RAG retrieval with source attribution |
| **entity** | add, get, search, delete | Manage code and document entities |
| **index** | codebase, document, sync, status | Parse and index code and docs |
| **graph** | link, query, stats | Navigate entity relationships |
| **project** | create, list, set_active, delete | Multi-project management |

### Deprecated — removed in v2 ([F1.0](docs/v2/phase-1/F1.0-prune-conversational-memory.md))

| Tool | Replacement / migration |
| ---- | ----------------------- |
| **session** | Pair ctx-sys with [lean-ctx](https://github.com/davidfranz/lean-ctx) for CCP session memory, or use mem0 / Claude Code's native memory. |
| **message** | ↑ same |
| **decision** | Write ADRs as markdown in your repo (e.g. `docs/decisions/0042-event-store.md`); ctx-sys's document indexer already surfaces them via `context_query`. |
| **checkpoint** | Pair with lean-ctx or use Claude Code's native checkpoint flow. |
| **reflection** | ↑ same |
| **memory** | ↑ same |
| **hooks** | Pre-commit `impact_report` is replaced by on-demand `context_query`. |

## Configuration

### Project config (`.ctx-sys/config.yaml`)

```yaml
project:
  name: my-project

indexing:
  content: both          # v2: both (default) | code | docs (documentation only)
  git_hooks: true         # v2: install git-aware sync hooks; `index` reconciles to this
  # doc_extensions:      # v2: override which extensions count as docs.
  #   - .md              # 'docs' mode defaults to prose (.md, .mdx, .txt, .rst, .pdf);
  #   - .txt             # 'both' mode otherwise indexes the full document set.
  ignore:
    - node_modules
    - dist
    - .git

embeddings:
  provider: ollama
  model: mxbai-embed-large:latest

summarization:           # optional
  provider: ollama
  model: qwen3:0.6b      # v2: gemma3:270m (lighter; remains opt-in)

hyde:                    # optional
  model: gemma3:12b      # v2: gemma3:270m (lighter; remains opt-in)
```

> **v2 — `indexing.content` (merged on `main`; ships in 2.0).** Controls what gets indexed: `both` (default, code + docs), `code` (AST entities only — same as `--no-doc`), or `docs` (documentation only, skips code). In `docs` mode the documentation set defaults to prose (`.md`, `.mdx`, `.txt`, `.rst`, `.pdf`) — set `indexing.doc_extensions` to widen or narrow it in any mode. Embeddings still run over the indexed documents. `index`, `index --git-sync` (the git-hook sync path), and `watch` all respect `content`. Switching an existing project to `docs` won't remove already-indexed code entities — delete `.ctx-sys/` and re-index for a clean docs-only store. The `--content <mode>` CLI flag overrides config per run.

<!-- -->

> **v2 — `indexing.git_hooks` (merged on `main`; ships in 2.0).** Declares whether the git-aware sync hooks (post-checkout/merge/rewrite/applypatch → `ctx-sys index --git-sync`) are installed. `ctx-sys index` reconciles the hooks to match on every run: `true` (default) installs/updates them, `false` removes the ctx-sys-managed ones. Only ctx-sys-managed hooks are ever touched; `ctx-sys init --no-git-hooks` seeds `git_hooks: false`.

<!-- -->

> **v2 (merged on `main`; ships in 2.0):** `ctx-sys init` writes a seeded `.ctxignore` (build outputs, dependencies, `.yaao/` / `.lean-ctx/`, lockfiles, secrets) and `.gitignore` is no longer read by default. Opt in with `indexing.use_gitignore: true` in config, or pass `--use-gitignore` on the CLI. See [F1.1](docs/v2/phase-1/F1.1-ignore-file-defaults.md).

### Global config (`~/.ctx-sys/config.yaml`)

```yaml
database:
  path: ~/.ctx-sys/ctx-sys.db

providers:
  ollama:
    base_url: http://localhost:11434
  openai:
    api_key: ${OPENAI_API_KEY}  # Optional cloud fallback
```

## Supported languages

| Language | Parsing | Entities extracted |
| -------- | ------- | ------------------ |
| TypeScript/JavaScript | tree-sitter | Functions, classes, methods, interfaces, types, imports |
| Python | tree-sitter | Functions, classes, methods, imports |
| Rust | tree-sitter | Functions, structs, impls, traits, imports |
| Go | tree-sitter | Functions, structs, methods, interfaces, imports |
| Java | tree-sitter | Classes, methods, interfaces, imports |
| C/C++ | tree-sitter | Functions, classes, structs, enums, namespaces, `#include`s |
| C# | tree-sitter | Classes, interfaces, structs, records, enums, methods, usings |

All grammars ship bundled as WASM via `@vscode/tree-sitter-wasm` — no per-language native compilation.

Documents (Markdown, HTML, YAML, JSON, TOML, PDF, CSV, XML, plain text) are also indexed with semantic chunking. Today (1.x) PDF extraction uses flat-text via `pdf-parse`; v2's [F2.3](docs/v2/phase-2/F2.3-pdf-extraction.md) introduces a pluggable `PdfExtractor` interface with two tiers wired on `main`: Tier 1 (pdf-parse with structured markdown + page headings) and Tier 2 (pdfjs-dist with font-height-based heading detection + stable per-page reading order). A content-addressed cache makes re-indexing the same PDF a no-op. Tier 3 (Docling structure-aware extraction with table reconstruction) is the one remaining deferral and plugs in behind the same interface when added.

## Requirements

- **Node.js 20+** (`engines.node: ">=20.0.0"`).
- **Ollama** (for local embeddings; optional cloud OpenAI fallback works without it).
  - `mxbai-embed-large:latest` — embedding model (1024 dimensions, auto-detected).
  - `qwen3:0.6b` — summarization (optional). *v2: lighter default `gemma3:270m`.*
  - `gemma3:12b` — HyDE query expansion (optional). *v2: lighter default `gemma3:270m`.*

## Architecture

ctx-sys stores everything in a single SQLite database (via `better-sqlite3` — ships its own SQLite, including FTS5, so no system-level install) with:

- **Entities** — code symbols and document sections.
- **Relationships** — CONTAINS, IMPORTS, CALLS, EXTENDS, IMPLEMENTS (auto-extracted from AST).
- **Vectors** — embeddings via `sqlite-vec` for fast KNN search.
- **FTS5** — full-text search with BM25 ranking.

Search combines vector + FTS + graph retrieval using reciprocal rank fusion (RRF). An optional LLM reranker is available for high-quality paths. Advanced features include HyDE query expansion, query decomposition, retrieval gating, and smart context expansion.

> **1.x today** also stores conversation history (sessions, messages, decisions, checkpoints, reflections, memory tiers). v2's [F1.0](docs/v2/phase-1/F1.0-prune-conversational-memory.md) removes that entire layer with **no automatic migration** — upgraders delete `.ctx-sys/` and re-index against the 2.x schema. v1's heuristic reranker is also cut by [F1.5](docs/v2/phase-1/F1.5-cut-heuristic-reranker.md) — RRF over vector + FTS + graph becomes the final ranking, with the LLM reranker as the opt-in high-quality path.

## v2 roadmap

The [v2 implementation plan](docs/v2/IMPLEMENTATION.md) is the working spec. In summary:

- **Phase 1 — Focus & Sharpen (2.0.0 code).** Cut conversational memory + `hooks`; lighter default models; yaao native integration contract (`ctx-sys serve --socket`); MCP server polish (stdio hygiene, `--json` schemas, MCP resources for entities); cut the heuristic reranker; `ctx-sys init --mcp` auto-registration.
- **Phase 2 — Better Defaults (2.1.0+).** Git-aware re-indexing via `post-checkout` / `post-merge` / `post-rewrite` hooks; user-facing strings audit (every `CtxError` carries a `fix:`, every CLI `--help` gains usage examples and tightened descriptions); one-command `ctx-sys setup` + `ctx-sys doctor` + multi-backend provider abstraction (Ollama / OpenAI-compatible / OpenAI / llama.cpp); structured PDF extraction (Tier 1 pdf-parse → Tier 2 pdfjs → Tier 3 Docling).
- **Phase 3 — Release Engineering (2.0.0 ship).** GitHub Actions release workflow, [Keep a Changelog](https://keepachangelog.com)-style CHANGELOG, dist-tag strategy (`next` for betas), `npm publish --provenance`, minimum two-week beta period exercising the trimmed tool surface and the "delete `.ctx-sys/` and re-index" upgrade path.

Stack positioning after v2:

```text
caveman      → compresses model output + CLAUDE.md         (output side)
lean-ctx     → compresses tool I/O: file reads, shell      (input side, generic)
ctx-sys      → semantic + graph retrieval over codebase    (input side, intelligent)
yaao         → multi-agent orchestrator (uses ctx-sys as native retrieval peer)
```

## Building from source

```bash
git clone https://github.com/davidfranz/ctx-sys.git
cd ctx-sys
npm install
npm run build
npm link    # Makes ctx-sys available globally
```

## Contributing

Contributions welcome. Start with:

- The [v2 implementation plan](docs/v2/IMPLEMENTATION.md) for what's planned and where it fits.
- Per-feature specs under [docs/v2/phase-1](docs/v2/phase-1/), [docs/v2/phase-2](docs/v2/phase-2/), and [docs/v2/phase-3](docs/v2/phase-3/) — each has acceptance criteria and out-of-scope lines.
- The [v1 whitepaper](docs/v1/whitepaper/whitepaper.pdf) and [v1 implementation history](docs/v1/) for context on the 1.x architecture and retired features. A v2 whitepaper is planned.

## License

MIT — see [LICENSE](LICENSE).
