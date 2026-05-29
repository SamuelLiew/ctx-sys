/**
 * Database schema definitions for ctx-sys.
 *
 * The database uses:
 * - Global tables for cross-project data
 * - Per-project tables (prefixed) for isolation
 * - FTS5 full-text search with BM25 ranking (F10.10)
 * - sqlite-vec vec0 virtual tables for native vector search (F10h.2)
 */

export const GLOBAL_SCHEMA = `
-- Projects registry
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  config JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_indexed_at DATETIME,
  last_sync_commit TEXT
);

-- Embedding model registry (for model-agnostic vectors)
CREATE TABLE IF NOT EXISTS embedding_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Global config
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value JSON
);

-- Shared entities (common libraries, patterns)
CREATE TABLE IF NOT EXISTS shared_entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT,
  metadata JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cross-project links (explicit only)
CREATE TABLE IF NOT EXISTS cross_project_links (
  id TEXT PRIMARY KEY,
  source_project TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_project TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_project) REFERENCES projects(id),
  FOREIGN KEY (target_project) REFERENCES projects(id)
);

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Generate SQL for creating project-specific tables.
 * Tables are prefixed with a sanitized project ID.
 */
export function createProjectTables(projectId: string): string {
  const prefix = sanitizeProjectId(projectId);

  return `
-- Entities (all types: code, docs, concepts, etc.)
CREATE TABLE IF NOT EXISTS ${prefix}_entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT,
  content TEXT,
  summary TEXT,
  metadata JSON,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_${prefix}_entities_type ON ${prefix}_entities(type);
CREATE INDEX IF NOT EXISTS idx_${prefix}_entities_file ON ${prefix}_entities(file_path);
CREATE INDEX IF NOT EXISTS idx_${prefix}_entities_name ON ${prefix}_entities(name);
CREATE INDEX IF NOT EXISTS idx_${prefix}_entities_qualified ON ${prefix}_entities(qualified_name);
CREATE INDEX IF NOT EXISTS idx_${prefix}_entities_hash ON ${prefix}_entities(hash);

-- Vector metadata (F10h.2: replaces JSON-based _vectors table)
-- Links entity_id/model_id/chunk_index/content_hash to vec0 rowids
-- chunk_index supports multi-vector embedding for large entities
CREATE TABLE IF NOT EXISTS ${prefix}_vector_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  content_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES ${prefix}_entities(id) ON DELETE CASCADE,
  UNIQUE(entity_id, model_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_${prefix}_vector_meta_entity ON ${prefix}_vector_meta(entity_id);
CREATE INDEX IF NOT EXISTS idx_${prefix}_vector_meta_model ON ${prefix}_vector_meta(model_id);

-- Note: vec0 virtual table (${prefix}_vec) is created on demand by EmbeddingManager
-- with the correct dimensions for the configured embedding model.

-- Graph relationships
CREATE TABLE IF NOT EXISTS ${prefix}_relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  metadata JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES ${prefix}_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES ${prefix}_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_${prefix}_rel_source ON ${prefix}_relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_${prefix}_rel_target ON ${prefix}_relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_${prefix}_rel_type ON ${prefix}_relationships(relationship);

-- AST cache (for incremental updates)
CREATE TABLE IF NOT EXISTS ${prefix}_ast_cache (
  file_path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,
  ast_json JSON,
  symbols JSON,
  parsed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 full-text search index (F10.10: enabled by better-sqlite3)
CREATE VIRTUAL TABLE IF NOT EXISTS ${prefix}_entities_fts USING fts5(
  name, content, summary,
  content=${prefix}_entities,
  content_rowid=rowid
);

-- Triggers to keep FTS5 in sync with entity table
CREATE TRIGGER IF NOT EXISTS ${prefix}_entities_ai AFTER INSERT ON ${prefix}_entities BEGIN
  INSERT INTO ${prefix}_entities_fts(rowid, name, content, summary)
  VALUES (new.rowid, new.name, new.content, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS ${prefix}_entities_ad AFTER DELETE ON ${prefix}_entities BEGIN
  INSERT INTO ${prefix}_entities_fts(${prefix}_entities_fts, rowid, name, content, summary)
  VALUES ('delete', old.rowid, old.name, old.content, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS ${prefix}_entities_au AFTER UPDATE ON ${prefix}_entities BEGIN
  INSERT INTO ${prefix}_entities_fts(${prefix}_entities_fts, rowid, name, content, summary)
  VALUES ('delete', old.rowid, old.name, old.content, old.summary);
  INSERT INTO ${prefix}_entities_fts(rowid, name, content, summary)
  VALUES (new.rowid, new.name, new.content, new.summary);
END;

`;
}

/**
 * Generate SQL for dropping project-specific tables.
 */
export function dropProjectTables(projectId: string): string {
  const prefix = sanitizeProjectId(projectId);

  // Also drops the v1 conversational-memory tables on a best-effort basis
  // so an upgrader who manually wants to clean per-project state via
  // `project delete` can do so. The V1 startup check in DatabaseConnection
  // is the first line of defence; this stays here belt-and-braces.
  return `
DROP TRIGGER IF EXISTS ${prefix}_entities_ai;
DROP TRIGGER IF EXISTS ${prefix}_entities_ad;
DROP TRIGGER IF EXISTS ${prefix}_entities_au;
DROP TABLE IF EXISTS ${prefix}_entities_fts;
DROP TABLE IF EXISTS ${prefix}_relationships;
DROP TABLE IF EXISTS ${prefix}_vec;
DROP TABLE IF EXISTS ${prefix}_vector_meta;
DROP TABLE IF EXISTS ${prefix}_ast_cache;
DROP TABLE IF EXISTS ${prefix}_entities;
-- v1 leftovers (no-ops on a 2.x DB):
DROP TABLE IF EXISTS ${prefix}_messages_fts;
DROP TABLE IF EXISTS ${prefix}_decisions_fts;
DROP TABLE IF EXISTS ${prefix}_decisions;
DROP TABLE IF EXISTS ${prefix}_session_summaries;
DROP TABLE IF EXISTS ${prefix}_context_suggestions;
DROP TABLE IF EXISTS ${prefix}_context_subscriptions;
DROP TABLE IF EXISTS ${prefix}_reflections;
DROP TABLE IF EXISTS ${prefix}_memory_items;
DROP TABLE IF EXISTS ${prefix}_checkpoints;
DROP TABLE IF EXISTS ${prefix}_messages;
DROP TABLE IF EXISTS ${prefix}_sessions;
`;
}

/**
 * Sanitize project ID for use as table prefix.
 * Replaces non-alphanumeric characters with underscores and
 * prefixes with 'p_' to ensure valid SQL identifiers (can't start with digit).
 */
export function sanitizeProjectId(projectId: string): string {
  const sanitized = projectId.replace(/[^a-zA-Z0-9]/g, '_');
  // Prefix with 'p_' to ensure table names don't start with a digit
  return `p_${sanitized}`;
}

/**
 * Create the vec0 virtual table for a project with specific dimensions.
 * Called by EmbeddingManager and import functions rather than createProjectTables()
 * so dimensions can match the configured embedding model.
 */
export function createVecTable(projectId: string, dimensions: number = 768): string {
  const prefix = sanitizeProjectId(projectId);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${prefix}_vec USING vec0(
    embedding float[${dimensions}] distance_metric=cosine
  );`;
}

/**
 * Get list of project table names for a given project ID.
 */
export function getProjectTableNames(projectId: string): string[] {
  // v2 F1.0: trimmed to the tables createProjectTables actually creates.
  const prefix = sanitizeProjectId(projectId);
  return [
    `${prefix}_entities`,
    `${prefix}_vector_meta`,
    `${prefix}_vec`,
    `${prefix}_relationships`,
    `${prefix}_ast_cache`
  ];
}
