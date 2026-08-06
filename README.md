# ctx-sys

**Local hybrid RAG over a code knowledge graph.** Index your codebase with tree-sitter AST + embeddings + a relationship graph, and retrieve precise context for any AI coding assistant via MCP. Local-first, code-aware, zero-network, and focused on fast, accurate code retrieval.

> **Alpha — Install from source:**
> ```bash
> git clone https://github.com/SamuelLiew/ctx-sys.git
> cd ctx-sys
> npm install
> npm run build
> npm link
> ```

## Why ctx-sys?

AI coding assistants are limited by context windows. They can't see your whole codebase and miss connections between files. ctx-sys acts as a *smart librarian* — it indexes your code, understands relationships between symbols, and retrieves exactly the right context via MCP.

- **Hybrid RAG** — combines vector search (`sqlite-vec`), keyword/FTS5 (`BM25`), and graph traversal with reciprocal rank fusion (RRF).
- **100% In-Process & Zero-Network** — your code never leaves your machine. Local embeddings run natively on Apple Silicon GPU via MLX without external API servers or Ollama network hops.
- **High-Performance DB & IPC** — cached prepared statements, batched single-query hydration, and line-delimited JSON IPC worker processes.
- **Code-Aware AST Indexing** — tree-sitter AST parsing extracts functions, classes, imports, and relationships across TypeScript/JavaScript, Python, C/C++, C#, Go, Rust, and Java.
- **MCP-Native** — works out-of-the-box with Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.

ctx-sys focuses strictly on retrieval. Conversational/session memory is intentionally out of scope — pair it with lean-ctx, mem0, or your assistant's native memory.

---

## Quick Start (3 minutes)

### 1. Requirements

- **Node.js 20+** (`>=20.0.0`)
- **Python 3 + MLX** (for Apple Silicon GPU embeddings):
  ```bash
  pip install mlx mlx-embeddings
  ```

### 2. Index your project

```bash
cd your-project
ctx-sys init
ctx-sys index
```

This parses your code with tree-sitter, generates 1024-dim embeddings via native MLX GPU acceleration, and indexes documentation — all in one command.

`ctx-sys init` also automatically registers the MCP server in `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, and `.github/copilot-instructions.md`.

### 3. Search

```bash
ctx-sys search "how does authentication work"     # hybrid search (semantic + keyword)
ctx-sys context "error handling in the API layer" # assembled context with expansion
ctx-sys search "database connection pooling" --hyde
```

### 4. Connect to your AI assistant

In **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`) or **Claude Code**:

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

---

## Architecture & How It Works

```text
Your Code                  ctx-sys Engine                         AI Assistant
─────────                  ──────────────                         ────────────
  .ts .py .rs    ──→   AST Parse (tree-sitter)
  .md .html      ──→   Document Chunking
                        ↓
                   Entity & Graph Extraction
                   (functions, classes, imports)
                        ↓
                   Local MLX Worker Process       ←──  "How does auth work?"
                   (mxbai-embed-large on GPU)             ↓
                        ↓                              context_query
                   ┌─────────────┐                          ↓
                   │ SQLite DB   │               ┌─────────────────────┐
                   │ • FTS5      │──────────────→│  Hybrid Search      │
                   │ • vec0      │               │  • Vector similarity│
                   │ • Graph     │               │  • FTS5 BM25        │
                   │ • StmtCache │               │  • Graph traversal  │
                   └─────────────┘               └─────────┬───────────┘
                                                           ↓
                                                    Rank & Assemble (RRF)
                                                           ↓
                                                  Relevant context with
                                                  source attribution
```

### Core Architecture Highlights

- **Native MLX GPU Acceleration**: Uses `scripts/embed_mlx.py` for persistent, line-delimited JSON IPC embedding workers on Apple Silicon unified memory.
- **SQLite + sqlite-vec**: In-process native vector index (`vec0`) paired with SQLite FTS5 for full-text search.
- **Prepared Statement Caching**: `DatabaseConnection` maintains a compiled statement cache to eliminate SQL preparation overhead on hot lookup paths.
- **Single-Query Batch Hydration**: Entity retrieval uses single `WHERE id IN (...)` queries to prevent N+1 DB roundtrips.
- **Process Safety**: Automated signal handlers (`SIGINT`, `SIGTERM`, `exit`) clean up Python worker processes to prevent zombie processes.

---

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
ctx-sys doctor                    # Check native modules, MLX GPU worker, and DB health
ctx-sys setup                     # Bootstrap project configuration and verify health
```

### Key flags

```bash
# Index
ctx-sys index --content docs      # Documentation only (skip code indexing)
ctx-sys index --content code      # Code only (alias: --no-doc)
ctx-sys index --git-sync          # Diff-driven re-sync since last commit
ctx-sys index --no-embed          # Skip embedding generation
ctx-sys index --force             # Re-index everything from scratch

# Search
ctx-sys search "query" --hyde     # HyDE conceptual search
ctx-sys search "query" --limit 20
ctx-sys search "query" --no-semantic  # Keyword-only

# Context
ctx-sys context "query" --max-tokens 8000
ctx-sys context "query" --no-expand
```

---

## MCP Tools

ctx-sys exposes 5 action-based MCP tools:

| Tool | Actions | Description |
| ---- | ------- | ----------- |
| **context_query** | *(standalone)* | Hybrid RAG retrieval with reciprocal rank fusion & source attribution |
| **entity** | add, get, search, delete | Inspect code and document entities |
| **index** | codebase, document, sync, status | Parse and index code and docs |
| **graph** | link, query, stats | Navigate entity relationships (CALLS, IMPORTS, EXTENDS) |
| **project** | create, list, set_active, delete | Multi-project workspace management |

---

## Configuration

### Project Config (`.ctx-sys/config.yaml`)

```yaml
project:
  name: my-project

indexing:
  content: both          # both (default) | code | docs
  git_hooks: true        # auto-sync index on git checkout/merge
  ignore:
    - node_modules
    - dist
    - .git

embeddings:
  provider: local
  model: mxbai-embed-large
```

---

## Supported Languages

Everything below is parsed with tree-sitter.

| Language | Extractor | Entities Extracted |
| -------- | --------- | ------------------ |
| TypeScript/JavaScript | dedicated | Functions, classes, methods, interfaces, types, imports |
| Python | dedicated | Functions, classes, methods, imports |
| C/C++ | dedicated | Functions, classes, structs, enums, namespaces, `#include`s |
| C# | dedicated | Classes, interfaces, structs, records, enums, methods, usings |
| Go | generic | Functions, methods, structs |
| Rust | generic | Functions, structs |
| Java | generic | Classes, methods |

Prose and documentation (`.md`, `.mdx`, `.txt`, `.rst`, `.pdf`, `.json`, `.yaml`, `.toml`) are indexed with semantic chunking. PDF parsing is powered by structured page extraction.

---

## Building from Source

```bash
git clone https://github.com/SamuelLiew/ctx-sys.git
cd ctx-sys
npm install
npm run build
npm link    # Makes ctx-sys command available globally
```

---

## License

MIT — see [LICENSE](LICENSE).
