# ctx-sys

**Local hybrid RAG over a code knowledge graph.** Index your codebase with tree-sitter AST + embeddings + a relationship graph, and retrieve precise context for any AI coding assistant via MCP. Local-first, code-aware, focused on one thing it does well.

```bash
npm install -g ctx-sys
```

## Why ctx-sys?

AI coding assistants are limited by context windows. They can't see your whole codebase and they miss connections between files. ctx-sys acts as a *smart librarian* — it indexes your code, understands relationships between symbols, and retrieves exactly the right context via MCP.

- **Hybrid RAG** — combines vector search, keyword/FTS5, and graph traversal with reciprocal rank fusion.
- **Local-first** — your code never leaves your machine. Ollama handles embeddings and (optional) summarization.
- **Code-aware** — tree-sitter AST parsing extracts functions, classes, imports, and relationships, with dedicated extractors for TypeScript/JavaScript, Python, C/C++, and C# (Go, Rust, and Java are parsed with tree-sitter too but use a lighter generic extractor — see [Supported languages](#supported-languages)).
- **MCP-native** — works with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.

ctx-sys focuses on retrieval. Conversational/session memory is intentionally out of scope — pair it with [lean-ctx](https://github.com/davidfranz/lean-ctx), mem0, or your assistant's native memory if you need that.

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

Or let ctx-sys do the setup for you: `ctx-sys setup` detects available backends (Ollama, OpenAI-compatible servers, llamafile), optionally installs Ollama on macOS/Linux when missing, pulls the required models with progress, writes a starter config, and runs `ctx-sys doctor` to confirm. Flags: `--yes` (non-interactive), `--install` / `--no-install`, `--backend ollama|openai-compatible|openai`, `--no-models`, `--json`.

### 2. Index your project

```bash
cd your-project
ctx-sys init
ctx-sys index
```

This parses your code with tree-sitter, generates embeddings with Ollama, and indexes documentation — all in one command. `ctx-sys init` also registers the MCP server in `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, and `.github/copilot-instructions.md` (opt out with `--no-mcp`; `--mcp-name X` for side-by-side indexes), and installs git hooks that keep the index in sync across `git checkout` / `pull` / `rebase` (opt out with `--no-git-hooks`).

### 3. Search

```bash
ctx-sys search "how does authentication work"     # hybrid search (semantic + keyword)
ctx-sys context "error handling in the API layer" # assembled context with expansion
ctx-sys search "database connection pooling" --hyde
```

### 4. Connect to your AI assistant

`ctx-sys init` registers the MCP server automatically. To wire it up by hand instead — for **Claude Desktop** (in `~/Library/Application Support/Claude/claude_desktop_config.json`) or **Claude Code** (in your MCP settings):

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
ctx-sys init [directory]          # Initialize project config (+ MCP + git hooks)
ctx-sys index [directory]         # Index code + docs + embeddings
ctx-sys search <query>            # Hybrid search (semantic + keyword)
ctx-sys context <query>           # Assembled context with expansion
ctx-sys status [directory]        # Project info and health checks
ctx-sys serve                     # Start MCP server
ctx-sys watch [directory]         # Watch files and auto-reindex
ctx-sys doctor                    # Provider + native-module + Node version checks (PASS/WARN/FAIL)
ctx-sys setup                     # One-command bootstrap (backends, models, config)
```

### Key flags

```bash
# Index
ctx-sys index --content docs      # Documentation only (skip code indexing)
ctx-sys index --content code      # Code only (alias: --no-doc)
ctx-sys index --git-sync          # Diff-driven re-sync since last indexed commit (also runs from git hooks)
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

### Subcommands

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

## MCP Tools

ctx-sys exposes 5 action-based MCP tools, focused on hybrid retrieval:

| Tool | Actions | What it does |
| ---- | ------- | ------------ |
| **context_query** | *(standalone)* | Hybrid RAG retrieval with source attribution |
| **entity** | add, get, search, delete | Manage code and document entities |
| **index** | codebase, document, sync, status | Parse and index code and docs |
| **graph** | link, query, stats | Navigate entity relationships |
| **project** | create, list, set_active, delete | Multi-project management |

## Configuration

### Project config (`.ctx-sys/config.yaml`)

```yaml
project:
  name: my-project

indexing:
  content: both          # both (default) | code | docs (documentation only)
  git_hooks: true        # install git-aware sync hooks; `index` reconciles to this
  # doc_extensions:      # override which extensions count as docs.
  #   - .md              # 'docs' mode defaults to prose (.md, .mdx, .txt, .rst, .pdf);
  #   - .txt             # 'both' mode otherwise indexes the full document set.
  ignore:
    - node_modules
    - dist
    - .git

embeddings:
  provider: ollama
  model: mxbai-embed-large:latest

summarization:           # optional, opt-in
  provider: ollama
  model: gemma3:270m

hyde:                    # optional, opt-in
  model: gemma3:270m
```

**`indexing.content`** controls what gets indexed: `both` (default, code + docs), `code` (AST entities only — same as `--no-doc`), or `docs` (documentation only, skips code). In `docs` mode the documentation set defaults to prose (`.md`, `.mdx`, `.txt`, `.rst`, `.pdf`) — set `indexing.doc_extensions` to widen or narrow it in any mode. Embeddings still run over the indexed documents. `index`, `index --git-sync`, and `watch` all respect `content`, routing each changed file to the code or document indexer. `watch` also refuses to run inside a git worktree and excludes `.yaao/` worktree churn. Switching an existing project to `docs` won't remove already-indexed code entities — delete `.ctx-sys/` and re-index for a clean docs-only store. The `--content <mode>` CLI flag overrides config per run.

**`indexing.git_hooks`** declares whether the git-aware sync hooks (post-checkout/merge/rewrite/applypatch → `ctx-sys index --git-sync`) are installed. `ctx-sys index` reconciles the hooks to match on every run: `true` (default) installs/updates them, `false` removes the ctx-sys-managed ones. Only ctx-sys-managed hooks are ever touched; `ctx-sys init --no-git-hooks` seeds `git_hooks: false`.

**Ignore rules.** `ctx-sys init` writes a seeded `.ctxignore` (build outputs, dependencies, `.yaao/` / `.lean-ctx/`, lockfiles, secrets). `.gitignore` is not read by default — opt in with `indexing.use_gitignore: true` in config, or pass `--use-gitignore` on the CLI.

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

The provider abstraction also covers OpenAI-compatible servers (vLLM, LM Studio, llamafile, LiteLLM, llama.cpp) via the `openai-compatible` backend.

## Supported languages

Everything below is parsed with tree-sitter. Entity extraction comes in two tiers: **dedicated extractors** pull rich, language-specific symbols, while the **generic extractor** is a fallback that detects functions and classes/structs by node type (no imports, and no language-specific kinds like traits or interfaces) for grammars without a dedicated extractor yet.

| Language | Extractor | Entities extracted |
| -------- | --------- | ------------------ |
| TypeScript/JavaScript | dedicated | Functions, classes, methods, interfaces, types, imports |
| Python | dedicated | Functions, classes, methods, imports |
| C/C++ | dedicated | Functions, classes, structs, enums, namespaces, `#include`s |
| C# | dedicated | Classes, interfaces, structs, records, enums, methods, usings |
| Go | generic | Functions, methods, and structs only |
| Rust | generic | Functions and structs only |
| Java | generic | Classes and methods only |

Go, Rust, and Java are on the roadmap for dedicated extractors (structs/impls/traits for Rust, interfaces/embedded types for Go, generics/annotations for Java). All grammars ship bundled as WASM via `@vscode/tree-sitter-wasm` — no per-language native compilation.

Documents (Markdown, HTML, YAML, JSON, TOML, PDF, CSV, XML, plain text) are also indexed with semantic chunking. PDF extraction is pluggable behind a `PdfExtractor` interface with two tiers: Tier 1 (pdf-parse with structured markdown + page headings) and Tier 2 (pdfjs-dist with font-height-based heading detection + stable per-page reading order). A content-addressed cache makes re-indexing the same PDF a no-op; a structure-aware Docling tier can plug in behind the same interface.

## Requirements

- **Node.js 20+** (`engines.node: ">=20.0.0"`).
- **Ollama** (for local embeddings; optional cloud OpenAI fallback works without it).
  - `mxbai-embed-large:latest` — embedding model (1024 dimensions, auto-detected).
  - `gemma3:270m` — summarization (optional).
  - `gemma3:270m` — HyDE query expansion (optional).

## Architecture

ctx-sys stores everything in a single SQLite database (via `better-sqlite3` — ships its own SQLite, including FTS5, so no system-level install) with:

- **Entities** — code symbols and document sections.
- **Relationships** — CONTAINS, IMPORTS, CALLS, EXTENDS, IMPLEMENTS (auto-extracted from AST).
- **Vectors** — embeddings via `sqlite-vec` for fast KNN search.
- **FTS5** — full-text search with BM25 ranking.

Search combines vector + FTS + graph retrieval using reciprocal rank fusion (RRF) as the final ranking, with score normalization applied once at the end of the fusion path. Advanced features include HyDE query expansion, query decomposition, retrieval gating, and smart context expansion.

## Where ctx-sys fits

```text
caveman      → compresses model output + CLAUDE.md         (output side)
lean-ctx     → compresses tool I/O: file reads, shell      (input side, generic)
ctx-sys      → semantic + graph retrieval over codebase    (input side, intelligent)
yaao         → multi-agent orchestrator (uses ctx-sys as native retrieval peer)
```

[yaao](https://github.com/david-franz/yaao) integrates with ctx-sys natively: when enabled, it gives each orchestrated agent its own `ctx-sys serve` MCP server so agents query your codebase for context before writing code.

## Building from source

```bash
git clone https://github.com/davidfranz/ctx-sys.git
cd ctx-sys
npm install
npm run build
npm link    # Makes ctx-sys available globally
```

## Contributing

Contributions welcome. See the [`docs/`](docs/) directory for the implementation specs (each feature has acceptance criteria and out-of-scope lines) and the whitepaper for the architecture rationale.

## License

MIT — see [LICENSE](LICENSE).
