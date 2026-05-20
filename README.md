# ctx-sys

**Local hybrid RAG over a code knowledge graph.** Index your codebase with tree-sitter AST + embeddings + a relationship graph, and retrieve precise context for any AI coding assistant via MCP. Local-first, code-aware, focused on one thing it does well.

```bash
npm install -g ctx-sys
```

## Status

**ctx-sys 1.x is the current published version.** Install from npm, point your AI assistant at it via MCP, get hybrid retrieval today.

**v2 is in planning** — a scope-reducing release that sharpens the project around its strongest capability (hybrid retrieval over a code knowledge graph) and cuts features that duplicate other tools in the stack (session memory, output compression, agent orchestration are owned better by sibling tools). v2 is not shipped; the [v2 implementation plan](docs/v2/IMPLEMENTATION.md) describes what's planned, with per-phase specs under [docs/v2/phase-1](docs/v2/phase-1/), [docs/v2/phase-2](docs/v2/phase-2/), and [docs/v2/phase-3](docs/v2/phase-3/).

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

> **v2 planned:** a single `ctx-sys setup` command will detect Ollama (or any OpenAI-compatible local backend), install if missing, and pull required models. See [F2.2](docs/v2/phase-2/F2.2-local-model-ux.md). Not available today.

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

> **v2 planned:** `ctx-sys init` will auto-register the MCP server in `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, and `.github/copilot-instructions.md` (default on, opt out with `--no-mcp`). See [F1.6](docs/v2/phase-1/F1.6-mcp-init.md). For now, you wire it up manually as above.

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

### Key flags

```bash
# Index
ctx-sys index --no-doc            # Skip document indexing
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

> **v2 planned:** `ctx-sys doctor` will replace `status --check` as the canonical diagnostic command, with provider preflight, config validation, native-module checks, and PASS / WARN / FAIL output. See [F2.2](docs/v2/phase-2/F2.2-local-model-ux.md).

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

# Knowledge bases
ctx-sys kb create <name>          # Package as shareable .ctx-kb
ctx-sys kb install <file>         # Install a knowledge base

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

If you rely on these today, see the [v2 migration notes](docs/v2/phase-1/F1.0-prune-conversational-memory.md). On schema upgrade, existing session/decision/checkpoint data exports to `.ctx-sys/migration-export-v1.jsonl` so you can move it elsewhere.

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

> **v2 planned:** `.ctxignore` (in addition to / instead of the inline `indexing.ignore` block) seeded with sensible defaults (`.yaao/`, `.lean-ctx/`, build outputs, lockfiles, secrets). See [F1.1](docs/v2/phase-1/F1.1-ignore-file-defaults.md).

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

Documents (Markdown, HTML, YAML, JSON, TOML, PDF, CSV, XML, plain text) are also indexed with semantic chunking. Today PDF extraction uses flat-text via `pdf-parse`; v2's [F2.3](docs/v2/phase-2/F2.3-pdf-extraction.md) plans pluggable structure-aware extraction (headings, tables, reading order).

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

> **1.x today** also stores conversation history (sessions, messages, decisions, checkpoints, reflections, memory tiers). v2's [F1.0](docs/v2/phase-1/F1.0-prune-conversational-memory.md) removes that entire layer; existing data exports to `.ctx-sys/migration-export-v1.jsonl` on upgrade. v1's heuristic reranker is also cut by [F1.5](docs/v2/phase-1/F1.5-cut-heuristic-reranker.md) — RRF over vector + FTS + graph becomes the final ranking, with the LLM reranker as the opt-in high-quality path.

## v2 roadmap

The [v2 implementation plan](docs/v2/IMPLEMENTATION.md) is the working spec. In summary:

- **Phase 1 — Focus & Sharpen (2.0.0 code).** Cut conversational memory + `hooks`; lighter default models; yaao native integration contract (`ctx-sys serve --socket`); MCP server polish (stdio hygiene, `--json` schemas, MCP resources for entities); cut the heuristic reranker; `ctx-sys init --mcp` auto-registration.
- **Phase 2 — Better Defaults (2.1.0+).** Git-aware re-indexing via `post-checkout` / `post-merge` / `post-rewrite` hooks; error message + hint audit (every user-facing `CtxError` carries a `fix:`); one-command `ctx-sys setup` + `ctx-sys doctor` + multi-backend provider abstraction (Ollama / OpenAI-compatible / OpenAI / llama.cpp); structured PDF extraction (Tier 1 pdf-parse → Tier 2 pdfjs → Tier 3 Docling).
- **Phase 3 — Release Engineering (2.0.0 ship).** GitHub Actions release workflow, [Keep a Changelog](https://keepachangelog.com)-style CHANGELOG, dist-tag strategy (`next` for betas), `npm publish --provenance`, minimum two-week beta period exercising the F1.0 schema migration.

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
